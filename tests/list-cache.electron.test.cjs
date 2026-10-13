const assert = require('node:assert/strict')
const http = require('node:http')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#297c88"/></svg>'
const songs = (prefix, count, base) => Array.from({ length: count }, (_, i) => ({
  id: `${prefix}-${i}`, name: `${prefix} song ${i}`, singer: 'Cache fixture', source: 'wy', interval: '03:40',
  meta: { picUrl: `${base}/${i % 12}.svg`, songId: String(i), albumName: 'Fixture', qualitys: [], _qualitys: {} },
}))
const invoke = (page, channel, params) => page.evaluate(({ channel, params }) => require('electron').ipcRenderer.invoke(channel, params), { channel, params })
const listState = page => page.evaluate(() => {
  const list = window.__motionComponents().find(c => c.type.name === 'MusicList')?.setupState.list ?? []
  return { count: list.length, first: list[0]?.id, last: list[list.length - 1]?.id }
})
const coversLoaded = page => page.waitForFunction(() => {
  const images = [...document.querySelectorAll('#view [data-cover-image]')]
  return images.length > 5 && images.every(image => image.complete && image.naturalWidth === 96)
})

test('local playlists and artwork survive switching, edits and a full offline restart', { timeout: 65000 }, async t => {
  let requests = 0
  let offline = false
  const server = http.createServer((req, res) => {
    requests++
    // no-store proves the application cache works independently of Chromium's HTTP cache.
    res.writeHead(offline ? 503 : 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
    res.end(offline ? '' : artwork)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  let fixture = await launch({ initializeMotion: false })
  const profilePath = fixture.output
  try {
    if (process.env.LX_TEST_RENDERER_PATH) assert.equal(new URL(fixture.page.url()).protocol, 'file:')
    const { app, page } = fixture
    const first = songs('cache-a', 1000, base)
    const second = songs('cache-b', 75, base)
    await invoke(page, 'player_list_add', { position: 0, listInfos: [
      { id: 'cache-a', name: 'Cache A', locationUpdateTime: null },
      { id: 'cache-b', name: 'Cache B', locationUpdateTime: null },
    ] })
    // Populate the real SQLite database without warming the renderer's cache.
    await app.evaluate(async({ app }, { first, second }) => {
      await global.lx.worker.dbService.musicOverwrite('cache-a', first)
      await global.lx.worker.dbService.musicOverwrite('cache-b', second)
    }, { first, second })
    await page.evaluate(() => {
      const ipc = require('electron').ipcRenderer
      const original = ipc.invoke.bind(ipc)
      window.__listReads = []
      ipc.invoke = async(channel, ...args) => {
        const value = await original(channel, ...args)
        if (channel === 'player_list_music_get') {
          window.__listReads.push(args[0])
          // Make an old A request finish after B is already visible.
          if (args[0] === 'cache-a') await new Promise(resolve => setTimeout(resolve, 250))
        }
        return value
      }
    })

    await t.test('late reads cannot replace the selected playlist', async() => {
      await route(page, '/list?id=cache-a')
      await page.waitForFunction(() => window.__listReads.includes('cache-a'))
      await route(page, '/list?id=cache-b')
      await page.waitForFunction(() => window.__motionComponents().find(c => c.type.name === 'MusicList')?.setupState.list[0]?.id === 'cache-b-0')
      await page.waitForTimeout(300)
      assert.deepEqual(await listState(page), { count: 75, first: 'cache-b-0', last: 'cache-b-74' })
    })

    await t.test('warm switches reuse songs and deduplicate identical cover URLs', async() => {
      await coversLoaded(page)
      const readsBefore = await page.evaluate(() => window.__listReads.length)
      const requestsBefore = requests
      const elapsed = await page.evaluate(async() => {
        const router = document.querySelector('#root').__vue_app__.config.globalProperties.$router
        const start = performance.now()
        await router.push('/list?id=cache-a')
        await new Promise(requestAnimationFrame)
        return performance.now() - start
      })
      await coversLoaded(page)
      assert.deepEqual(await listState(page), { count: 1000, first: 'cache-a-0', last: 'cache-a-999' })
      assert.equal(await page.evaluate(() => window.__listReads.length), readsBefore)
      assert.equal(requests, requestsBefore)
      assert.equal(requests, 12, 'each of the 12 shared artwork URLs downloads once')
      t.diagnostic(`Cached 1,000-song switch to first frame: ${Math.round(elapsed)} ms`)
    })

    await t.test('add, delete and reorder update the cached list and SQLite', async() => {
      const added = { ...first[0], id: 'cache-added', name: 'Added after caching' }
      await invoke(page, 'player_list_music_add', { id: 'cache-a', musicInfos: [added], addMusicLocationType: 'bottom' })
      await page.waitForFunction(() => window.__motionComponents().find(c => c.type.name === 'MusicList').setupState.list.length === 1001)
      await invoke(page, 'player_list_music_remove', { listId: 'cache-a', ids: ['cache-a-0'] })
      await invoke(page, 'player_list_music_update_position', { listId: 'cache-a', ids: ['cache-added'], position: 0 })
      await page.waitForFunction(() => window.__motionComponents().find(c => c.type.name === 'MusicList').setupState.list[0]?.id === 'cache-added')
      assert.deepEqual(await listState(page), { count: 1000, first: 'cache-added', last: 'cache-a-999' })
      await route(page, '/list?id=cache-b')
      await route(page, '/list?id=cache-a')
      assert.equal((await listState(page)).first, 'cache-added')
      // Persist startup navigation in the isolated profile using the app's data IPC.
      await page.evaluate(() => {
        const ipc = require('electron').ipcRenderer
        ipc.send('winMain_save_data', { path: 'listPrevSelectId', data: 'cache-a' })
        ipc.send('winMain_save_data', { path: 'viewPrevState', data: { path: '/list', query: { id: 'cache-a' } } })
      })
      await coversLoaded(page)
      await invoke(page, 'winMain_get_data', 'listPrevSelectId')
    })

    assert.deepEqual(fixture.errors, [])
    await app.close()
    fixture = null
    offline = true
    const requestsBeforeRestart = requests
    fixture = await launch({ profilePath, initializeMotion: false })
    await t.test('a new Electron process restores the edited songs and cover pixels offline', async() => {
      await route(fixture.page, '/list?id=cache-a')
      await coversLoaded(fixture.page)
      assert.deepEqual(await listState(fixture.page), { count: 1000, first: 'cache-added', last: 'cache-a-999' })
      assert.equal(requests, requestsBeforeRestart, 'no image server requests after a full restart')
      const cache = await fixture.page.evaluate(() => new Promise((resolve, reject) => {
        const open = indexedDB.open('lx-artwork-cache', 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const request = open.result.transaction('metadata').objectStore('metadata').getAll()
          request.onsuccess = () => { resolve(request.result.map(row => ({ key: row.key, bytes: row.bytes }))); open.result.close() }
        }
      }))
      assert.equal(cache.filter(row => row.key.startsWith('image:')).length, 12)
      assert.ok(cache.every(row => row.bytes > 0))
      assert.equal(await fixture.page.evaluate(() => document.documentElement.dataset.motionEnabled), 'true')
    })

    await t.test('the artwork-cache button clears artwork without deleting playlists', async() => {
      offline = false
      await route(fixture.page, '/setting')
      await settled(fixture.page)
      const label = await fixture.page.evaluate(() => window.i18n.t('setting__other'))
      await fixture.page.getByRole('tab', { name: label, exact: true }).click()
      await settled(fixture.page)
      const row = fixture.page.locator('[data-cache-manager] > div').filter({ hasText: /^封面磁盘缓存/ })
      await row.getByRole('button', { name: '清理', exact: true }).click()
      await fixture.page.waitForFunction(() => {
        const row = [...document.querySelectorAll('[data-cache-manager] > div')].find(row => row.textContent.startsWith('封面磁盘缓存'))
        return row && !row.querySelector('button').disabled && row.textContent.includes('0 B')
      })
      await route(fixture.page, '/list?id=cache-a')
      await coversLoaded(fixture.page)
      assert.equal((await listState(fixture.page)).count, 1000)
      assert.equal(requests, requestsBeforeRestart + 12)
    })
    assert.deepEqual(fixture.errors, [])
  } finally {
    if (fixture) await fixture.app.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
