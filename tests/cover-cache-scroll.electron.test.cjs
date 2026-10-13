const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#297c88"/><circle cx="320" cy="320" r="180" fill="#deb695"/></svg>'
const loaded = page => page.waitForFunction(() => {
  const cells = [...document.querySelectorAll('#view [data-music-cell="cover"]')]
  return cells.length > 5 && cells.every(cell => {
    const image = cell.querySelector('[data-cover-image]')
    return image?.naturalWidth === 640 && !cell.hasAttribute('data-cover-error')
  })
}, undefined, { timeout: 7000 })

test('cleared artwork remains usable when a large playlist scrolls away and back', { timeout: 65000 }, async t => {
  const output = path.resolve('output/playwright/cover-cache-scroll')
  await fs.mkdir(output, { recursive: true })
  let requests = 0
  const server = http.createServer((_request, response) => {
    requests++
    response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' })
    response.end(artwork)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let fixture
  t.after(async() => {
    if (fixture) await fixture.app.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  fixture = await launch({ initializeMotion: false })
  const { page } = fixture
  page.setDefaultTimeout(8000)
  await page.evaluate(() => {
    Object.assign(window.lxData.appSetting, { 'common.isShowAnimation': false, 'list.loadingMode': 'immediate', 'ui.lowPowerMode': false })
    window.__coverFailures = []
    document.addEventListener('error', event => {
      if (event.target.matches?.('[data-cover-image]')) window.__coverFailures.push({ src: event.target.src, song: event.target.closest('[data-song-id]')?.dataset.songId })
    }, true)
  })
  const urls = Array.from({ length: 100 }, (_, index) => `http://127.0.0.1:${server.address().port}/${index}.svg`)
  const songs = urls.map((url, index) => ({
    id: `cover-scroll-${index}`, name: `滚动封面 ${index + 1}`, singer: '缓存回归验证', source: 'wy', interval: '03:40',
    meta: { picUrl: url, songId: String(index), albumName: 'Fixture', qualitys: [], _qualitys: {} },
  }))
  await page.evaluate(() => require('electron').ipcRenderer.invoke('player_list_add', {
    position: 0, listInfos: [{ id: 'cover-scroll', name: '滚动封面验证', locationUpdateTime: null }],
  }))
  await fixture.app.evaluate(async(_, songs) => global.lx.worker.dbService.musicOverwrite('cover-scroll', songs), songs)
  await route(page, '/list?id=cover-scroll')
  await settled(page)
  await loaded(page)
  await route(page, '/setting')
  await settled(page)
  await page.locator('[data-setting-tab="SettingOther"]').click()
  await page.getByRole('button', { name: '清理全部缓存', exact: true }).click()
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('[data-cache-manager] button')].find(button => button.textContent.trim() === '清理全部缓存')
    return button && !button.disabled
  })
  const persisted = await page.evaluate(() => require('electron').ipcRenderer.invoke('player_list_music_get', 'cover-scroll'))
  assert.equal(persisted.length, songs.length, 'clearing artwork leaves the persisted songs intact')
  const diskEntries = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('lx-artwork-cache')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const entries = request.result.transaction('metadata').objectStore('metadata').count()
      entries.onerror = () => reject(entries.error)
      entries.onsuccess = () => { request.result.close(); resolve(entries.result) }
    }
  }))
  assert.equal(diskEntries, 0)
  await route(page, '/list?id=cover-scroll')
  await settled(page)
  await loaded(page)
  await page.screenshot({ path: path.join(output, 'after-clear.png') })
  try {
    for (const mode of ['immediate', 'progressive']) {
      await page.evaluate(mode => { window.lxData.appSetting['list.loadingMode'] = mode }, mode)
      for (const index of [25, 0, 50, 0, 25, 0]) {
        await page.locator('#view .music-column-scroll').evaluate((element, index) => { element.scrollTop = index * 36; element.dispatchEvent(new Event('scroll')) }, index)
        await page.waitForFunction(index => {
          const row = document.querySelector('#view [data-song-id]')
          return row && Number(row.dataset.songId.split('-').pop()) > 0 === (index > 0)
        }, index)
        await loaded(page)
      }
    }
    assert.deepEqual(await page.evaluate(() => window.__coverFailures), [])
    assert.deepEqual(fixture.errors, [])
    await page.screenshot({ path: path.join(output, 'after-scroll.png') })
    t.diagnostic(`${requests} artwork downloads; every rendered cover decoded after clearing and scrolling`)
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'scroll-failure.png') })
    t.diagnostic(JSON.stringify(await page.evaluate(() => ({
      failures: window.__coverFailures,
      placeholders: [...document.querySelectorAll('#view [data-cover-error]')].map(cell => ({ song: cell.closest('[data-song-id]')?.dataset.songId, title: cell.title })),
    }))))
    throw error
  }
})
