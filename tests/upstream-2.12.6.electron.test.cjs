const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const NodeID3 = require('node-id3')
const { launch, route } = require('./helpers/motion-fixture.cjs')
const { mp3 } = require('./helpers/tag-fixtures.cjs')
const { WIN_MAIN_RENDERER_EVENT_NAME: ipc } = require('./helpers/load-typescript.cjs')()('src/common/ipcNames.ts')
const rendererPath = path.resolve('dist/index.html')
const label = (page, key) => page.evaluate(key => window.i18n.t(key), key)

test('production MP3 worker embeds title, artist, album, cover and lyrics with the current webpack', { timeout: 60000 }, async t => {
  const cover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(cover) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async() => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const fixture = await launch({ rendererPath, hidden: true })
  t.after(() => fixture.app.close())
  const filePath = path.join(fixture.output, '标签 (MP3) #100%.mp3')
  await fs.writeFile(filePath, mp3().bytes)
  await fixture.page.evaluate(async({ filePath, coverUrl }) => {
    await window.lx.worker.download.writeMeta({
      filePath, title: '上游合入测试', artist: 'LX-M artist', album: 'LX-M album', APIC: coverUrl,
      isEmbedLyricLx: false, isEmbedLyricT: true, isEmbedLyricR: false,
    }, { lyric: '[00:01.000]歌词测试', tlyric: '', rlyric: '', lxlyric: '' })
  }, { filePath, coverUrl: `http://127.0.0.1:${server.address().port}/cover.png` })
  const tags = NodeID3.read(await fs.readFile(filePath))
  assert.equal(tags.title, '上游合入测试')
  assert.equal(tags.artist, 'LX-M artist')
  assert.equal(tags.album, 'LX-M album')
  assert.deepEqual(tags.image.imageBuffer, cover)
  assert.match(tags.unsynchronisedLyrics.text, /歌词测试/)
  assert.deepEqual(await fs.readdir(fixture.output).then(files => files.filter(file => file.endsWith('.artwork') || file.endsWith('.lxmtemp'))), [])
  assert.deepEqual(fixture.errors, [])
})

test('saved custom theme colors initialize the picker correctly after reopening and restarting', { timeout: 60000 }, async t => {
  let fixture = await launch({ rendererPath, hidden: true })
  t.after(() => fixture.app.close())
  const profilePath = fixture.output
  const themeName = 'Upstream picker regression'
  await fixture.page.evaluate(async({ ipc, themeName }) => {
    const { ipcRenderer } = require('electron')
    const { themes } = await ipcRenderer.invoke(ipc.get_themes)
    const theme = JSON.parse(JSON.stringify(themes[0]))
    theme.id = 'upstream-picker-regression'
    theme.name = themeName
    theme.isCustom = true
    theme.config.themeColors['--color-primary'] = 'rgb(36, 123, 103)'
    await ipcRenderer.invoke(ipc.save_theme, theme)
  }, { ipc, themeName })
  const openEditor = async() => {
    const { page } = fixture
    await route(page, '/setting?search=主题')
    const more = page.getByLabel(await label(page, 'theme_more_btn_show'), { exact: true })
    if (await more.isVisible()) await more.click()
    await page.getByLabel(themeName, { exact: true }).click({ button: 'right' })
    await page.getByRole('heading', { name: await label(page, 'theme_edit_modal__title_edit'), exact: true }).waitFor()
    const swatch = page.getByText(await label(page, 'theme_edit_modal__primary'), { exact: true }).locator('..').locator('div').first()
    await page.waitForFunction(el => getComputedStyle(el).backgroundColor === 'rgb(36, 123, 103)', await swatch.elementHandle())
    await swatch.click()
    const input = page.locator('.pcr-app.visible .pcr-result')
    await input.waitFor()
    assert.match(await input.inputValue(), /36.*123.*103/)
    await page.screenshot({ path: path.join(profilePath, 'theme-picker.png') })
    await page.locator('.pcr-app.visible .pcr-cancel').click()
    await page.locator('#view header').getByRole('button', { name: await label(page, 'close'), exact: true }).click()
    assert.deepEqual(fixture.errors, [])
  }
  await openEditor()
  await fixture.app.close()
  fixture = await launch({ rendererPath, hidden: true, profilePath })
  await openEditor()
  t.diagnostic('Theme picker screenshot: ' + path.join(profilePath, 'theme-picker.png'))
})

test('QQ public recommendations remain distinct from personalized recommendations and migrate old hottest sorting', { timeout: 45000 }, async t => {
  const fixture = await launch({ rendererPath, hidden: true })
  t.after(() => fixture.app.close())
  await route(fixture.page, '/songList/list?source=tx&sortId=5&tagId=')
  await fixture.page.waitForFunction(() => new URLSearchParams(location.hash.split('?')[1]).get('sortId') === '3')
  await fixture.page.getByText('广场推荐', { exact: true }).waitFor()
  await fixture.page.getByText(await label(fixture.page, 'recommend'), { exact: true }).waitFor()
  assert.deepEqual(fixture.errors, [])
})

test('opaque windows enter F11 fullscreen from maximized mode, restore sizing and reopen in fullscreen', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  let fixture = await launch({ rendererPath, hidden: true, args: ['-dt'] })
  t.after(() => fixture.app.close())
  const profilePath = fixture.output
  let nativeWindow = await fixture.app.browserWindow(fixture.page)
  const state = () => fixture.page.evaluate(channel => require('electron').ipcRenderer.invoke(channel), ipc.get_window_state)
  const maximize = () => fixture.page.evaluate(channel => require('electron').ipcRenderer.send(channel), ipc.max)
  await fixture.page.locator('html.disableTransparent').waitFor()
  assert.equal(await nativeWindow.evaluate(window => window.isResizable()), true)
  await maximize()
  await fixture.page.locator('html.maximized').waitFor()
  assert.equal(await nativeWindow.evaluate(window => window.isResizable()), false)
  await fixture.page.keyboard.press('F11')
  await fixture.page.locator('html.fullscreen').waitFor()
  assert.equal(await nativeWindow.evaluate(window => window.isFullScreen()), true)
  assert.equal(await nativeWindow.evaluate(window => window.isResizable()), true)
  assert.equal((await state()).isFullscreen, true)
  assert.deepEqual(await fixture.page.evaluate(() => {
    const style = getComputedStyle(document.body)
    return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
  }), ['0px', '0px', '0px', '0px'])
  await fixture.page.screenshot({ path: path.join(profilePath, 'opaque-fullscreen.png') })
  await fixture.page.keyboard.press('Escape')
  await fixture.page.locator('html:not(.fullscreen).maximized').waitFor()
  assert.equal(await nativeWindow.evaluate(window => window.isResizable()), false)
  await maximize()
  await fixture.page.locator('html:not(.maximized)').waitFor()
  assert.equal(await nativeWindow.evaluate(window => window.isResizable()), true)
  for (const [os, expected] of [['windows windows-10', [1, 0, 0, 0]],
    ['windows windows-11', [0, 0, 0, 0]], ['linux linux-6', [1, 1, 1, 1]]]) {
    const borders = await fixture.page.evaluate(os => {
      const root = document.documentElement
      const original = root.className
      root.className = 'disableTransparent ' + os
      const style = getComputedStyle(document.body)
      const borders = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
      root.className = original
      return borders
    }, os)
    for (let edge = 0; edge < 4; edge++) {
      const width = parseFloat(borders[edge])
      if (expected[edge]) assert(width > 0 && width <= 1, `${os} edge ${edge}: thin border at the active display zoom`)
      else assert.equal(width, 0, `${os} edge ${edge}`)
    }
  }
  await fixture.page.evaluate(() => window.lxData.updateSetting({ 'common.startInFullscreen': true }))
  await fixture.app.close()
  fixture = await launch({ rendererPath, hidden: true, args: ['-dt'], profilePath })
  nativeWindow = await fixture.app.browserWindow(fixture.page)
  await fixture.page.locator('html.fullscreen').waitFor()
  assert.equal(await nativeWindow.evaluate(window => window.isFullScreen()), true)
  await fixture.page.keyboard.press('Escape')
  await fixture.page.locator('html:not(.fullscreen)').waitFor()
  assert.equal(await nativeWindow.evaluate(window => window.isResizable()), true)
  assert.deepEqual(fixture.errors, [])
  t.diagnostic('Opaque fullscreen screenshot: ' + path.join(profilePath, 'opaque-fullscreen.png'))
})
