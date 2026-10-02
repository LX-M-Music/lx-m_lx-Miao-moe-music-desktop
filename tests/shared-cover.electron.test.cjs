const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled, showDetail } = require('./helpers/motion-fixture.cjs')

const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#297c88"/></svg>'
const song = (id, url) => ({ id, source: 'wy', name: id, singer: 'Shared artwork', interval: '03:40', meta: { picUrl: url, songId: id, albumName: 'Shared cover', qualitys: [], _qualitys: {} } })
const seedList = (page, musicInfo) => page.evaluate(musicInfo => {
  window.__motionComponents().find(c => c.type.name === 'MusicList' && 'list' in c.setupState).setupState.list = [musicInfo]
}, musicInfo)
const seedPlayer = (page, musicInfo) => page.evaluate(musicInfo => {
  Object.assign(window.lxData.playMusicInfo, { musicInfo, listId: 'default' })
  Object.assign(window.lxData.musicInfo, { id: musicInfo.id, pic: musicInfo.meta.picUrl, name: musicInfo.name, singer: musicInfo.singer, album: musicInfo.meta.albumName })
}, musicInfo)
const listSrc = async page => {
  await page.waitForFunction(() => {
    const info = window.__motionComponents().find(c => c.type.name === 'MusicList' && 'list' in c.setupState).setupState.list[0]
    return document.querySelector('#view [data-cover-image]')?.naturalWidth === 640 &&
      document.querySelector('#view [data-music-cell="name"] [aria-label]')?.getAttribute('aria-label') === info.name
  })
  return page.locator('#view [data-cover-image]').first().getAttribute('src')
}
const playerSrc = async page => {
  await page.waitForFunction(() => {
    const src = window.__motionComponents().find(c => c.type.name === 'CorePlayBar').setupState.playerCover
    return src && [...document.querySelectorAll('#player [data-player-cover] img')].some(image => image.src === src && image.naturalWidth === 640)
  })
  return page.evaluate(() => window.__motionComponents().find(c => c.type.name === 'CorePlayBar').setupState.playerCover)
}
const updateSettings = async(page, values) => {
  await page.evaluate(values => window.lxData.updateSetting(values), values)
  await page.waitForFunction(values => Object.entries(values).every(([key, value]) => window.lxData.appSetting[key] === value), values)
}

test('song lists, all player covers and media metadata share loaded artwork', { timeout: 70000 }, async t => {
  const requests = new Map()
  const gates = new Map()
  let offline = false
  const server = http.createServer((req, res) => {
    const key = new URL(req.url, 'http://fixture').pathname
    requests.set(key, (requests.get(key) ?? 0) + 1)
    const send = () => {
      res.writeHead(offline || key === '/missing.svg' ? 503 : 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
      res.end(artwork)
    }
    const gate = gates.get(key)
    if (gate) { gate.release = send; gate.started() } else send()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const block = key => {
    let started
    const gate = { requested: new Promise(resolve => { started = resolve }), started, release: () => {} }
    gates.set(key, gate)
    return gate
  }
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  t.after(async() => {
    for (const gate of gates.values()) gate.release()
    if (fixture) await fixture.app.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  const { page, output } = fixture
  page.setDefaultTimeout(6000)
  await updateSettings(page, { 'common.isShowAnimation': false, 'list.loadingMode': 'progressive' })
  await route(page, '/list')
  await settled(page)
  const first = song('list-first', `${base}/first.svg`)

  await t.test('a loaded row is reused by every player bar, detail, ambient background and Media Session', async() => {
    await seedList(page, first)
    const src = await listSrc(page)
    assert.match(src, /^blob:/)
    await seedPlayer(page, first)
    assert.equal(await playerSrc(page), src)
    for (const style of ['mini', 'middle', 'full']) {
      await updateSettings(page, { 'common.playBarProgressStyle': style })
      assert.equal(await playerSrc(page), src)
      await page.locator('#player [data-player-cover]').click()
      await page.locator('[data-player-detail]').waitFor()
      await page.waitForFunction(src => {
        const images = [...document.querySelectorAll('[data-player-detail] img')]
        return images.length > 0 && images.every(image => image.src === src && image.naturalWidth === 640)
      }, src)
      await showDetail(page, false)
      await settled(page)
    }
    await page.waitForFunction(src => navigator.mediaSession.metadata?.artwork[0]?.src === src, src)
    assert.equal(requests.get('/first.svg'), 1)
    assert.equal(await page.evaluate(() => window.lxData.musicInfo.pic), first.meta.picUrl, 'original metadata remains portable')
  })

  await t.test('a cover loaded by playback is reused by a newly opened list', async() => {
    await route(page, '/setting')
    await settled(page)
    const next = song('player-first', `${base}/player-first.svg`)
    await seedPlayer(page, next)
    const src = await playerSrc(page)
    await route(page, '/list')
    await settled(page)
    await seedList(page, next)
    assert.equal(await listSrc(page), src)
    assert.equal(requests.get('/player-first.svg'), 1)
    await updateSettings(page, { 'list.coverSize': 48 })
    assert.equal(await listSrc(page), src)
    assert.equal(requests.get('/player-first.svg'), 1)
  })

  await t.test('concurrent list and player loads wait for the same request', async() => {
    const pending = block('/pending.svg')
    const next = song('pending', `${base}/pending.svg`)
    await seedList(page, next)
    await pending.requested
    await seedPlayer(page, next)
    await page.waitForTimeout(80)
    assert.equal(requests.get('/pending.svg'), 1)
    pending.release()
    gates.delete('/pending.svg')
    assert.equal(await playerSrc(page), await listSrc(page))
    assert.equal(requests.get('/pending.svg'), 1)
  })

  await t.test('different CDN size URLs use one clear image without modifying song metadata', async() => {
    const urls = []
    await page.route('https://p1.music.126.net/lx-shared-cover/**', async request => {
      urls.push(request.request().url())
      await request.fulfill({ contentType: 'image/svg+xml', body: artwork, headers: { 'Cache-Control': 'no-store' } })
    })
    const original = 'https://p1.music.126.net/lx-shared-cover/album.jpg'
    await seedList(page, song('cdn', original + '?param=96y96'))
    const src = await listSrc(page)
    await seedPlayer(page, song('cdn', original + '?param=1400y1400'))
    assert.equal(await playerSrc(page), src)
    assert.deepEqual(urls, [original + '?param=640y640'])
    assert.equal(await page.evaluate(() => window.lxData.musicInfo.pic), original + '?param=1400y1400')
  })

  await t.test('late artwork cannot replace a newer song or its media metadata', async() => {
    const pending = block('/slow.svg')
    await seedPlayer(page, song('old', `${base}/slow.svg`))
    await pending.requested
    await seedPlayer(page, song('new', `${base}/new.svg`))
    const src = await playerSrc(page)
    pending.release()
    gates.delete('/slow.svg')
    // Mount the old song in the list to wait for that same pending request to complete.
    await seedList(page, song('old', `${base}/slow.svg`))
    const oldSrc = await listSrc(page)
    assert.notEqual(oldSrc, src)
    assert.equal(await playerSrc(page), src)
    assert.equal(await page.evaluate(() => window.lxData.musicInfo.id), 'new')
    await page.waitForFunction(src => navigator.mediaSession.metadata?.title === 'new' && navigator.mediaSession.metadata.artwork[0]?.src === src, src)
    assert.equal(requests.get('/slow.svg'), 1)
  })

  await t.test('failed artwork leaves the player placeholder and the next song recovers', async() => {
    await seedPlayer(page, song('missing', `${base}/missing.svg`))
    await page.waitForFunction(() => window.lxData.musicInfo.pic === null)
    assert.equal(await page.locator('#player [data-player-cover] img').count(), 0)
    assert.equal(requests.get('/missing.svg'), 1)
    await seedPlayer(page, first)
    await seedList(page, first)
    assert.equal(await playerSrc(page), await listSrc(page))
    assert.equal(requests.get('/first.svg'), 1)
    await page.screenshot({ path: path.resolve('logs/shared-cover.png') })
  })

  assert.deepEqual(fixture.errors, [])
  const previous = fixture
  fixture = null
  await previous.app.close()
  offline = true
  const restarted = await launch({ rendererPath: path.resolve('dist/index.html'), profilePath: output })
  // Cleanup runs after the sequential restart checks have finished.
  // eslint-disable-next-line require-atomic-updates
  fixture = restarted
  await t.test('one persistent image serves lists and playback after an offline restart', async() => {
    await route(restarted.page, '/list')
    await settled(restarted.page)
    await seedList(restarted.page, first)
    const src = await listSrc(restarted.page)
    await seedPlayer(restarted.page, first)
    assert.equal(await playerSrc(restarted.page), src)
    assert.equal(requests.get('/first.svg'), 1)
  })
  assert.deepEqual(restarted.errors, [])
})
