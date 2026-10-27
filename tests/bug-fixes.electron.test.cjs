const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const { mp3 } = require('./helpers/tag-fixtures.cjs')

const label = (page, key) => page.evaluate(key => window.i18n.t(key), key)
const requestedPlatforms = calls => new Set(calls.flatMap(({ host }) => {
  if (/^(search|www)\.kuwo\.cn$/.test(host)) return ['kw']
  if (host.endsWith('.kugou.com')) return ['kg']
  if (['c.y.qq.com', 'u.y.qq.com'].includes(host)) return ['tx']
  if (host === 'interface.music.163.com') return ['wy']
  if (host.endsWith('.migu.cn')) return ['mg']
  return []
}))

test('production UI recovers search failures, local imports and missing downloads', { timeout: 180000 }, async t => {
  const calls = []
  let recoverKw = false
  const server = http.createServer((req, res) => {
    const host = req.headers.host
    const url = new URL(req.url, 'http://' + host)
    calls.push({ host, path: url.pathname, query: url.search })
    req.resume()
    let body
    if (recoverKw && /^(search|www)\.kuwo\.cn$/.test(host)) {
      switch (url.searchParams.get('ft')) {
        case 'artist': body = { TOTAL: '1', abslist: [{ ARTISTID: '42', ARTIST: 'recovered singer', PICPATH: '' }] }; break
        case 'album': body = { total: 1, albumlist: [{ albumid: '42', name: 'recovered album', artist: 'artist' }] }; break
        case 'playlist': body = { TOTAL: '1', abslist: [{ playlistid: 42, name: 'recovered songlist', nickname: 'artist', songnum: 1, playcnt: 0, pic: '', intro: '' }] }; break
        default: body = { TOTAL: '1', HIT: '1', abslist: [{ MUSICRID: 'MUSIC_42', SONGNAME: 'recovered music', ARTIST: 'artist', N_MINFO: 'level:standard,bitrate:128,format:mp3,size:4M', DURATION: '12', ALBUMID: '7' }] }
      }
    }
    res.writeHead(body ? 200 : 403, { 'Content-Type': url.searchParams.get('ft') === 'playlist' ? 'text/plain' : 'application/json' })
    res.end(JSON.stringify(body ?? {}))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let fixture
  try {
    fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
    const { app, page, errors, output } = fixture
    page.setDefaultTimeout(15000)
    await page.evaluate(port => {
      const http = require('node:http'); const https = require('node:https')
      const originalHttp = http.request; const originalHttps = https.request
      const intercept = original => function(options, ...args) {
        const hostname = options.hostname ?? options.host
        if (!hostname || ['localhost', '127.0.0.1'].includes(hostname)) return original.call(this, options, ...args)
        return originalHttp.call(http, { ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port, agent: undefined, headers: { ...options.headers, Host: hostname } }, ...args)
      }
      http.request = intercept(originalHttp)
      https.request = intercept(originalHttps)
      window.lxData.updateSetting({ 'list.loadingMode': 'immediate' })
      window.__aggregateState = () => window.__motionComponents().find(c => Array.isArray(c.props.state?.failedSources))?.props.state
    }, server.address().port)

    for (const kind of ['music', 'songlist', 'singer', 'album']) {
      await t.test(`${kind} names failed platforms and uses one button to retry all failures`, async() => {
        recoverKw = false
        await route(page, `/search?source=all&type=${kind}&text=bugs-${kind}`)
        await page.waitForFunction(() => window.__aggregateState()?.status === 'failed').catch(async error => {
          t.diagnostic(JSON.stringify({ kind, state: await page.evaluate(() => window.__aggregateState()), calls: calls.slice(-15) }))
          throw error
        })
        const failed = await page.evaluate(() => window.__aggregateState().failedSources)
        assert(failed.includes('kw') && failed.length > 1)
        const notice = page.locator('[data-search-failures]')
        assert(!/错误代码|原因：/.test(await notice.textContent()), 'aggregate failures must not expose codes or reasons')
        const sourceNames = await page.evaluate(() => {
          const sources = window.__motionComponents().find(c => Array.isArray(c.setupState.sources) && c.setupState.sources.some(source => source.id === 'all')).setupState.sources
          return Object.fromEntries(sources.map(source => [source.id, source.label]))
        })
        const failedNames = notice.locator('[data-failed-sources]')
        for (const source of failed) assert((await failedNames.textContent()).includes(sourceNames[source]))
        const retry = notice.getByRole('button', { name: await label(page, 'search__retry_failed'), exact: true })
        assert.equal(await notice.locator('[data-retry-source]').count(), failed.length)
        assert.equal(await notice.locator('[data-retry-failed-sources]').count(), 1)
        assert.equal(await page.locator('.ui-state-retry').count(), 0, 'the empty list must not add a second retry button')
        const beforeRetry = calls.length
        recoverKw = true
        await retry.click()
        await page.waitForFunction(() => window.__aggregateState()?.status === 'partial')
        await page.getByText('recovered ' + kind, { exact: true }).first().waitFor()
        assert.equal(await notice.locator('[data-retry-source]').count(), failed.length - 1)
        assert.equal(await notice.locator('[data-retry-failed-sources]').count(), 1)
        assert(!(await failedNames.textContent()).includes(sourceNames.kw))
        for (const source of failed.filter(source => source !== 'kw')) assert((await failedNames.textContent()).includes(sourceNames[source]))
        assert((await failedNames.textContent()).includes(sourceNames[failed.find(source => source !== 'kw')]))
        assert.deepEqual(requestedPlatforms(calls.slice(beforeRetry)), new Set(failed))
        const beforeSecondRetry = calls.length
        await retry.click()
        await page.waitForFunction(() => window.__aggregateState()?.status === 'partial')
        assert.deepEqual(requestedPlatforms(calls.slice(beforeSecondRetry)), new Set(failed.filter(source => source !== 'kw')))
        await page.getByText('recovered ' + kind, { exact: true }).first().waitFor()
        await page.screenshot({ path: path.join(output, `recovered-search-${kind}.png`) })
      })
    }

    const chosenPath = path.join(output, 'relocated-song.mp3')
    await fs.writeFile(chosenPath, mp3({ title: 'Imported valid' }).bytes)
    await t.test('unknown sizes show bytes and relocating a missing file updates the database', async() => {
      await app.evaluate(({ dialog, shell }, filePath) => {
        dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [filePath] })
        global.__shownFiles = []
        shell.showItemInFolder = path => { global.__shownFiles.push(path) }
      }, chosenPath)
      await page.evaluate(async directory => {
        const path = require('node:path')
        const task = (id, complete) => ({
          id,
          isComplate: complete,
          status: complete ? 'completed' : 'pause',
          statusText: complete ? 'completed' : 'pause',
          downloaded: 2048,
          total: complete ? 2048 : 0,
          progress: complete ? 100 : -1,
          speed: '',
          writeQueue: 0,
          metadata: {
            url: null,
            quality: '128k',
            ext: 'mp3',
            fileName: id + '.mp3',
            filePath: path.join(directory, id + '.mp3'),
            listId: 'default',
            musicInfo: { id, name: id, singer: 'Artist', source: 'wy', interval: '01:00', meta: { songId: id, albumName: '', picUrl: '', qualitys: [], _qualitys: {} } },
          },
        })
        await require('electron').ipcRenderer.invoke('winMain_download_list_add', { list: [task('missing-download', true), task('unknown-size', false)], addMusicLocationType: 'bottom' })
        window.lxData.appSetting['download.savePath'] = directory
        window.lxData.appSetting['download.enable'] = true
      }, output)
      await route(page, '/download')
      await settled(page)
      const progress = page.locator('.list-item').filter({ hasText: 'unknown-size' }).locator('[data-music-cell="progress"]')
      await progress.waitFor()
      assert.match(await progress.textContent(), /2(?:\.0+)?\s*K/i)
      assert(!(await progress.textContent()).includes('%'))
      await page.locator('.list-item').filter({ hasText: 'missing-download' }).click({ button: 'right' })
      await page.getByRole('tab', { name: await label(page, 'download__relocate'), exact: true }).waitFor()
      await page.getByRole('tab', { name: await label(page, 'list__file'), exact: true }).click()
      await page.getByText(await label(page, 'download__file_missing'), { exact: true }).waitFor()
      assert.deepEqual(await app.evaluate(() => global.__shownFiles), [])
      await page.getByRole('button', { name: await label(page, 'download__relocate'), exact: true }).click()
      await page.waitForFunction(async filePath => {
        const tasks = await require('electron').ipcRenderer.invoke('winMain_download_list_get')
        return tasks.find(task => task.id === 'missing-download')?.metadata.filePath === filePath
      }, chosenPath)
      assert.deepEqual(await app.evaluate(() => global.__shownFiles), [chosenPath])
      await page.screenshot({ path: path.join(output, 'download-recovery.png') })
    })

    await t.test('mixed local import lists failed files and clears loading while retaining valid songs', async() => {
      await page.evaluate(() => window.lxData.updateSetting({ 'common.showErrorDialog': true }))
      const missing = path.join(output, 'failed-import.mp3')
      await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async() => ({ canceled: false, filePaths: paths }) }, [chosenPath, missing])
      await route(page, '/list?id=love')
      await settled(page)
      const list = page.locator('li.default-list').nth(1)
      await list.click({ button: 'right' })
      await page.getByRole('tab', { name: await label(page, 'lists__select_local_file'), exact: true }).click()
      await page.getByText(missing, { exact: false }).waitFor()
      assert(!/fetching/.test(await list.getAttribute('class')))
      await page.screenshot({ path: path.join(output, 'local-import-failure.png') })
      await page.getByRole('button', { name: await label(page, 'confirm_button_text'), exact: true }).click()
      await page.getByText('Imported valid', { exact: true }).first().waitFor()
    })
    assert.deepEqual(errors, [])
    t.diagnostic('Production UI regression evidence: ' + output)
  } finally {
    if (fixture) await fixture.app.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
