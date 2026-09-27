const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route } = require('./helpers/motion-fixture.cjs')

test('error dialog setting hides details by default and restores them when enabled', { timeout: 60000 }, async t => {
  const server = http.createServer((_req, res) => { res.writeHead(404); res.end('missing artwork') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const f = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { page, output } = f
  try {
    page.setDefaultTimeout(6000)
    await page.evaluate(() => {
      const ipc = require('electron').ipcRenderer, original = ipc.invoke.bind(ipc)
      window.__errorFixtureFail = true
      ipc.invoke = async(channel, ...args) => {
        if (channel === 'player_list_music_get' && args[0] === 'diagnostic-list') {
          if (window.__errorFixtureFail) throw Object.assign(Error('fixture library cannot be read'), { code: 'EACCES' })
          return []
        }
        if (channel === 'winMain_download_list_get' && window.__errorFixtureFail) throw Object.assign(Error('fixture downloads cannot be read'), { code: 'SQLITE_CORRUPT' })
        return original(channel, ...args)
      }
      window.__restoreErrorFixture = () => { ipc.invoke = original }
    })
    await route(page, '/list?id=diagnostic-list')
    const error = page.locator('#view .ui-state-error:visible')
    await error.waitFor()
    assert.match(await error.innerText(), /加载失败|loading failed/i)
    assert.doesNotMatch(await error.innerText(), /EACCES|fixture library cannot be read|原因|Reason/)
    await route(page, '/setting?name=SettingAdvanced')
    const toggle = page.locator('#setting_advanced_show_error_dialog')
    await toggle.waitFor({ state: 'attached' })
    assert.equal(await toggle.isChecked(), false)
    await page.locator('label[for="setting_advanced_show_error_dialog"]').click()
    await page.waitForFunction(() => window.lxData.appSetting['common.showErrorDialog'] === true)
    await route(page, '/list?id=diagnostic-list')
    await error.filter({ hasText: 'EACCES' }).waitFor()
    assert.match(await error.innerText(), /fixture library cannot be read/)
    assert.match(await error.innerText(), /原因|Reason/)
    await page.screenshot({ path: path.join(output, 'local-list-error.png') })
    await page.evaluate(() => { window.__errorFixtureFail = false })
    await error.locator('.ui-state-retry').click()
    await error.waitFor({ state: 'hidden' })
    await page.evaluate(() => { window.__errorFixtureFail = true })
    await route(page, '/download')
    await error.filter({ hasText: 'SQLITE_CORRUPT' }).waitFor()
    assert.match(await error.innerText(), /fixture downloads cannot be read/)
    await page.evaluate(() => { window.__errorFixtureFail = false })
    await error.locator('.ui-state-retry').click()
    await error.waitFor({ state: 'hidden' })
    await page.evaluate(() => window.__restoreErrorFixture())

    await route(page, '/list?id=love')
    await page.waitForFunction(() => window.__motionComponents().some(c => c.type.name === 'MusicList' && 'list' in c.setupState))
    await page.evaluate(port => {
      const component = window.__motionComponents().find(c => c.type.name === 'MusicList' && 'list' in c.setupState)
      component.setupState.list = [{ id: 'error-art', source: 'wy', name: 'Missing cover', singer: 'Fixture', interval: '03:00', meta: { picUrl: `http://127.0.0.1:${port}/missing.jpg`, songId: 'error-art', albumName: 'Fixture', qualitys: [], _qualitys: {} } }]
    }, server.address().port)
    const cover = page.locator('#view [data-cover-error]')
    await cover.waitFor()
    assert.match(await cover.getAttribute('title'), /HTTP_404/)
    assert.match(await cover.getAttribute('title'), /原因|Reason/)

    await page.evaluate(port => {
      window.lxData.playQueueList.push({ listId: 'default', musicInfo: { id: 'queue-error-art', source: 'wy', name: 'Queue missing cover', singer: 'Fixture', interval: '03:00', meta: { picUrl: `http://127.0.0.1:${port}/queue.jpg`, songId: 'queue-error-art', albumName: 'Fixture', qualitys: [], _qualitys: {} } } })
    }, server.address().port)
    const queueButton = page.getByRole('button', { name: await page.evaluate(() => window.i18n.t('player__play_list')), exact: true }).first()
    await queueButton.click()
    const queueCover = page.locator('[data-play-queue] [data-cover-error]')
    await queueCover.waitFor()
    assert.match(await queueCover.getAttribute('title'), /HTTP_404/)
    await queueButton.click()

    // Emit a real browser error event without throwing into the test runner.
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: Object.assign(Error('fixture view import failed'), { code: 'MODULE_NOT_FOUND' }) }))
    })
    const notice = page.locator('[data-app-load-error]')
    await notice.filter({ hasText: 'MODULE_NOT_FOUND' }).waitFor()
    assert.match(await notice.innerText(), /fixture view import failed/)
    await page.screenshot({ path: path.join(output, 'loading-error-notice.png') })
    await notice.getByRole('button').last().click()
    await notice.waitFor({ state: 'detached' })
    await route(page, '/setting?name=SettingAdvanced')
    await page.locator('label[for="setting_advanced_show_error_dialog"]').click()
    await page.waitForFunction(() => window.lxData.appSetting['common.showErrorDialog'] === false)
    await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { error: Error('hidden loading error') })))
    assert.equal(await notice.count(), 0)
    await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { error: Object.assign(Error('cancelled'), { name: 'AbortError' }) })))
    assert.equal(await notice.count(), 0)
    assert.deepEqual(f.errors, [])
    t.diagnostic('Loading error screenshots: ' + output)
  } finally {
    await f.app.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
