const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled, seedTrack, showDetail } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, install, label, startSilentAudio } = require('./helpers/plugin-fixture.cjs')

const update = async(page, values) => {
  await page.evaluate(values => window.lxData.updateSetting(values), values)
  await page.waitForFunction(values => Object.entries(values).every(([key, value]) => window.lxData.appSetting[key] === value), values)
}
const detailFont = (page, enabled) => update(page, { 'playDetail.useAppFont': enabled })
const waitFrameFont = (frame, enabled) => frame.waitForFunction(enabled => {
  const node = document.querySelector('#root [style*="font-family"]')
  return node && getComputedStyle(node).fontFamily.includes('LXCustom-') === enabled
}, enabled)
const close = async app => {
  let timer
  try {
    await Promise.race([app.close(), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Electron close timed out')), 15000) })])
  } catch (error) { app.process().kill(); throw error } finally { clearTimeout(timer) }
}

const openFonts = async page => {
  await route(page, '/setting?name=SettingBasic')
  await settled(page)
  await page.locator('[data-font-primary]').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-font-primary] .label')].some(node => node.textContent))
}
const choose = async(page, target, label) => {
  const field = page.locator(`[data-font-${target}]`)
  await field.getByRole('combobox').click()
  await field.locator('li').filter({ hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).click()
}
const importFile = async(app, page, filename) => {
  await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [filename] }) }, filename)
  await page.locator('[data-font-import]').click()
  await page.waitForFunction(() => !document.querySelector('[data-font-import]').disabled)
}
const usedFonts = async(page, selector = '[data-font-preview]') => {
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('DOM.enable')
    await session.send('CSS.enable')
    const { root } = await session.send('DOM.getDocument')
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    return (await session.send('CSS.getPlatformFontsForNode', { nodeId })).fonts
  } finally { await session.detach() }
}

test('custom fonts render, apply the secondary font independently to lyric details and persist', { timeout: 150000, skip: process.platform !== 'win32' }, async t => {
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = fixture.output
  let { app, page } = fixture
  const original = path.join(profilePath, 'Imported Arial.ttf')
  const invalid = path.join(profilePath, 'Broken.ttf')
  try {
    page.setDefaultTimeout(10000)
    await fs.copyFile(path.join(process.env.WINDIR || 'C:/Windows', 'Fonts/arial.ttf'), original)
    await fs.writeFile(invalid, Buffer.from([0, 1, 0, 0, 1, 2, 3, 4]))
    await openFonts(page)
    await t.test('the default-on detail switch is searchable and supports keyboard control', async() => {
      const control = page.locator('[data-font-play-detail]').getByRole('checkbox', { name: await label(page, 'setting__font_play_detail'), exact: true })
      assert.equal(await control.getAttribute('aria-checked'), 'true')
      const search = page.getByPlaceholder(await label(page, 'setting__filter_placeholder'), { exact: true })
      await search.fill(await label(page, 'setting__font_play_detail'))
      try {
        await control.waitFor()
        await control.press('Space')
        await page.waitForFunction(() => window.lxData.appSetting['playDetail.useAppFont'] === false)
        await control.press('Space')
        await page.waitForFunction(() => window.lxData.appSetting['playDetail.useAppFont'] === true)
      } finally { await search.fill('') }
    })
    await t.test('both labeled font controls are available, including fallback with default primary', async() => {
      assert.equal(await page.locator('[data-font-fallback] [role="combobox"]').isVisible(), true)
      await choose(page, 'fallback', 'Microsoft YaHei UI')
      await page.waitForFunction(() => window.lxData.appSetting['common.font'] === 'system-ui, "Microsoft YaHei UI"')
      await choose(page, 'primary', 'Arial')
      await page.waitForFunction(() => window.lxData.appSetting['common.font'] === '"Arial", "Microsoft YaHei UI"')
      const fonts = await usedFonts(page)
      assert(fonts.some(font => /Arial/i.test(font.familyName) && font.glyphCount > 0), JSON.stringify(fonts))
      assert(fonts.some(font => /YaHei/i.test(font.familyName) && font.glyphCount > 0), JSON.stringify(fonts))
    })
    let importedId
    await t.test('a real imported font renders immediately and repeated imports share one saved copy', async() => {
      await importFile(app, page, original)
      await page.waitForFunction(() => document.documentElement.style.fontFamily.includes('LXCustom-') && [...document.fonts].some(face => face.family.includes('LXCustom-') && face.status === 'loaded'))
      importedId = await page.evaluate(() => window.lxData.appSetting['common.font'])
      assert(importedId.endsWith(', "Microsoft YaHei UI"'))
      const fonts = await usedFonts(page)
      assert(fonts.some(font => font.isCustomFont && font.glyphCount > 0), JSON.stringify(fonts))
      assert(fonts.some(font => /YaHei/i.test(font.familyName) && font.glyphCount > 0), JSON.stringify(fonts))
      await importFile(app, page, original)
      const directory = path.join(profilePath, 'portable/userData/LxDatas/fonts')
      assert.equal((await fs.readdir(directory)).filter(name => name.endsWith('.json')).length, 1)
      await page.screenshot({ path: path.join(profilePath, 'custom-font-selection.png') })
    })
    const secondaryImported = '"Times New Roman", ' + importedId.split(', ')[0]
    const protectedSettings = await page.evaluate(() => Object.fromEntries(['playDetail.style.fontSize', 'playDetail.style.fontWeight', 'desktopLyric.style.font'].map(key => [key, window.lxData.appSetting[key]])))
    const nativeFamily = () => page.locator('[data-player-detail]').evaluate(node => getComputedStyle(node).fontFamily)
    const nativeDefaults = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-default-font-family').trim())
    await seedTrack(page)
    await page.evaluate(() => {
      Object.assign(window.lxData.musicInfo, {
        lrc: '[00:00.000]Custom font 音乐与歌词\n[00:04.000]Default font 字体开关', lxlrc: '',
        tlrc: '[00:00.000]Translation 翻译\n[00:04.000]Only lyric details 仅歌词详情页',
        rlrc: '[00:00.000]Romanization luo ma yin\n[00:04.000]zi ti kai guan',
      })
      Object.assign(window.lxData.appSetting, { 'player.isPlayLxlrc': false, 'player.isShowLyricTranslation': true, 'player.isShowLyricRoma': true })
      window.app_event.lyricUpdated()
      window.__lxPluginHost.player.getAudioElement().muted = true
    })
    await startSilentAudio(page, 8)
    await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().pause())
    await t.test('ordinary lyrics, translation, romanization and metadata use only the secondary font', async() => {
      await showDetail(page, true)
      await settled(page)
      await page.waitForFunction(() => document.querySelectorAll('.lyric .line-content').length === 2 && document.querySelectorAll('.lyric .extended').length === 4)
      const families = await page.locator('[data-player-detail] .font-lrc, [data-detail-part="info"] p').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontFamily))
      assert(families.length >= 9 && families.every(family => family.startsWith('"Microsoft YaHei UI"') && !family.includes('LXCustom-')), JSON.stringify(families))
      for (const selector of ['.lyric .line > .font-lrc', '.lyric .extended .font-lrc']) {
        const fonts = await usedFonts(page, selector)
        assert(fonts.some(font => /YaHei/i.test(font.familyName) && font.glyphCount > 0), JSON.stringify(fonts))
        assert.equal(fonts.some(font => font.isCustomFont), false)
      }
      await page.screenshot({ path: path.join(profilePath, 'custom-font-native-on.png') })
      await showDetail(page, false)
      await settled(page)
    })
    await t.test('switching off through font settings uses defaults only in the native detail', async() => {
      await page.locator('label[for="setting_font_play_detail"]').click()
      await page.waitForFunction(() => window.lxData.appSetting['playDetail.useAppFont'] === false)
      await page.locator('[data-font-play-detail]').locator('..').screenshot({ path: path.join(profilePath, 'custom-font-detail-switch-off.png') })
      await showDetail(page, true)
      await settled(page)
      assert.equal(await nativeFamily(), await nativeDefaults())
      assert.equal((await usedFonts(page, '.lyric .line > .font-lrc')).some(font => font.isCustomFont), false)
      assert.equal((await usedFonts(page, '.lyric .extended .font-lrc')).some(font => font.isCustomFont), false)
      assert((await usedFonts(page)).some(font => font.isCustomFont && font.glyphCount > 0), 'the settings preview keeps the selected font')
      assert.equal(await page.locator('#player').evaluate(node => getComputedStyle(node).fontFamily.includes('LXCustom-')), true)
      await page.screenshot({ path: path.join(profilePath, 'custom-font-native-off.png') })
    })
    await t.test('live font and language changes respect the disabled scope and reenabling is immediate', async() => {
      await update(page, { 'common.font': '"Times New Roman", "Microsoft YaHei UI"' })
      assert.equal(await nativeFamily(), await nativeDefaults())
      assert.equal(await page.locator('#player').evaluate(node => getComputedStyle(node).fontFamily.includes('Times New Roman')), true)
      const chinese = await nativeDefaults()
      await update(page, { 'common.langId': 'en-us' })
      await page.waitForFunction(() => document.documentElement.lang === 'en')
      assert.equal(await nativeFamily(), await nativeDefaults())
      assert.notEqual(await nativeDefaults(), chinese)
      await update(page, { 'common.langId': 'zh-cn', 'common.font': importedId })
      await page.waitForFunction(() => [...document.fonts].some(face => face.family.includes('LXCustom-') && face.status === 'loaded'))
      await detailFont(page, true)
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-player-detail]')).fontFamily.startsWith('"Microsoft YaHei UI"'))
      assert((await usedFonts(page, '.lyric .line > .font-lrc')).some(font => /YaHei/i.test(font.familyName) && font.glyphCount > 0))
      assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, window.lxData.appSetting[key]])), Object.keys(protectedSettings)), protectedSettings)
    })
    await t.test('changing or clearing the secondary font updates native lyrics without using the primary', async() => {
      const primary = importedId.split(', ')[0]
      await update(page, { 'common.font': primary + ', "Times New Roman"' })
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-player-detail]')).fontFamily.startsWith('"Times New Roman"'))
      const fonts = await usedFonts(page, '.lyric .line > .font-lrc')
      assert(fonts.some(font => /Times/i.test(font.familyName) && font.glyphCount > 0), JSON.stringify(fonts))
      assert.equal(fonts.some(font => font.isCustomFont), false)
      assert((await usedFonts(page)).some(font => font.isCustomFont && font.glyphCount > 0), 'the rest of the app keeps its primary font')
      await update(page, { 'common.font': primary })
      assert.equal(await nativeFamily(), await nativeDefaults(), 'no secondary font uses the defaults')
      assert.equal((await usedFonts(page, '.lyric .line > .font-lrc')).some(font => font.isCustomFont), false)
      await update(page, { 'common.font': 'system-ui, "Microsoft YaHei UI"' })
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-player-detail]')).fontFamily.startsWith('"Microsoft YaHei UI"'))
      await update(page, { 'common.font': importedId })
      await showDetail(page, false)
      await settled(page)
    })
    await t.test('an imported secondary face renders in native lyrics while other pages use the primary', async() => {
      await update(page, { 'common.font': secondaryImported })
      await page.waitForFunction(() => [...document.fonts].some(face => face.family.includes('LXCustom-') && face.status === 'loaded'))
      await showDetail(page, true)
      await settled(page)
      assert.match(await nativeFamily(), /^LXCustom-[a-f0-9]{64},/)
      assert((await usedFonts(page, '.lyric .line > .font-lrc')).some(font => font.isCustomFont && font.glyphCount > 0))
      const previewFonts = await usedFonts(page)
      assert(previewFonts.some(font => /Times/i.test(font.familyName) && font.glyphCount > 0), JSON.stringify(previewFonts))
      assert.equal(previewFonts.some(font => font.isCustomFont), false)
      await page.screenshot({ path: path.join(profilePath, 'custom-font-native-secondary.png') })
      await showDetail(page, false)
      await settled(page)
    })
    await t.test('Folia receives only the imported secondary family and switches in place', async() => {
      await mockGitHub(app)
      await openStore(page)
      await install(page, 'folia-lyrics')
      await page.locator('[data-plugin-id="folia-lyrics"]').getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
      const element = await page.locator('[data-folia-stage="preview"] iframe').elementHandle()
      const frame = await element.contentFrame()
      await page.locator('[data-folia-mode]').selectOption('still')
      await frame.waitForFunction(() => document.documentElement.dataset.mode === 'still' && [...document.fonts].some(face => face.family.includes('LXCustom-') && face.status === 'loaded'))
      const family = await frame.locator('#root [style*="font-family"]').first().evaluate(node => window.getComputedStyle(node).fontFamily)
      assert.match(family, /^LXCustom-[a-f0-9]{64},/)
      assert.equal(family.includes('Times New Roman'), false, 'the primary font is excluded from Folia')
      assert.equal(family.includes('\\"'), false, 'font choices must not become one quoted composite name')
      await page.locator('[data-folia-stage="preview"]').screenshot({ path: path.join(profilePath, 'custom-font-folia.png') })
      await update(page, { 'common.font': '"Times New Roman", "Microsoft YaHei UI"' })
      await frame.waitForFunction(() => getComputedStyle(document.querySelector('#root [style*="font-family"]')).fontFamily.startsWith('"Microsoft YaHei UI"'))
      await update(page, { 'common.font': '"Times New Roman"' })
      await frame.waitForFunction(() => {
        const family = getComputedStyle(document.querySelector('#root [style*="font-family"]')).fontFamily
        return !family.includes('Microsoft YaHei UI') && !family.includes('Times New Roman') && !family.includes('LXCustom-')
      })
      await update(page, { 'common.font': secondaryImported })
      await waitFrameFont(frame, true)
      await detailFont(page, false)
      await waitFrameFont(frame, false)
      await page.locator('[data-folia-stage="preview"]').screenshot({ path: path.join(profilePath, 'custom-font-folia-preview-default.png') })
      await detailFont(page, true)
      await waitFrameFont(frame, true)
      assert.equal(await element.evaluate(node => node === document.querySelector('[data-folia-stage="preview"] iframe')), true, 'the live font change retains the iframe')
      await openFonts(page)
    })
    await t.test('Folia player switches in place, remains independent and reopens with default fonts', async() => {
      await showDetail(page, true)
      await settled(page)
      const element = await page.locator('[data-folia-stage="player"] iframe').elementHandle()
      const frame = await element.contentFrame()
      await waitFrameFont(frame, true)
      await frame.evaluate(() => {
        addEventListener('message', event => {
          if (event.data?.channel === 'lx-m:folia-lyrics' && event.data.type === 'config') window.__fontConfig = event.data.data
        })
      })
      await page.screenshot({ path: path.join(profilePath, 'custom-font-folia-player-on.png') })
      await detailFont(page, false)
      await waitFrameFont(frame, false)
      assert.deepEqual(await frame.evaluate(() => ({ family: window.__fontConfig.fontFamily, families: window.__fontConfig.fontFamilies })), { family: '', families: [] })
      assert.equal(await page.locator('#player').evaluate(node => getComputedStyle(node).fontFamily.startsWith('"Times New Roman"')), true)
      await page.screenshot({ path: path.join(profilePath, 'custom-font-folia-player-off.png') })
      await detailFont(page, true)
      await waitFrameFont(frame, true)
      assert.equal(await element.evaluate(node => node === document.querySelector('[data-folia-stage="player"] iframe')), true)
      await detailFont(page, false)
      await waitFrameFont(frame, false)
      await showDetail(page, false)
      await settled(page)
      await showDetail(page, true)
      await settled(page)
      const reopened = await (await page.locator('[data-folia-stage="player"] iframe').elementHandle()).contentFrame()
      await waitFrameFont(reopened, false)
      await showDetail(page, false)
      await settled(page)
      await update(page, { 'common.font': importedId })
    })
    await t.test('a corrupt font reports its error and preserves the active font', async() => {
      await importFile(app, page, invalid)
      const message = await page.locator('[data-font-error]').innerText()
      assert.match(message, /FONT_IMPORT_FAILED|SYNTAX|12/)
      assert.equal(await page.evaluate(() => window.lxData.appSetting['common.font']), importedId)
    })
    await fs.unlink(original)
    assert.deepEqual(fixture.errors, [])
    await close(app)
    fixture = await launch({ rendererPath: path.resolve('dist/index.html'), profilePath })
    ;({ app, page } = fixture)
    page.setDefaultTimeout(10000)
    await openFonts(page)
    await t.test('fonts and fallback survive restart without the original file', async() => {
      assert.equal(await page.evaluate(() => window.lxData.appSetting['common.font']), importedId)
      assert.equal(await page.evaluate(() => window.lxData.appSetting['playDetail.useAppFont']), false)
      assert.equal(await page.locator('[data-font-play-detail] [role="checkbox"]').getAttribute('aria-checked'), 'false')
      await page.waitForFunction(() => [...document.fonts].some(face => face.family.includes('LXCustom-') && face.status === 'loaded'))
      await page.waitForFunction(() => document.querySelector('[data-font-primary] .label').textContent.includes('Imported Arial'))
      assert((await usedFonts(page)).some(font => font.isCustomFont && font.glyphCount > 0))
    })
    await t.test('restore defaults clears both choices and unloads custom faces', async() => {
      await page.locator('[data-font-reset]').click()
      await page.waitForFunction(() => window.lxData.appSetting['common.font'] === '' && document.documentElement.style.fontFamily === '')
      assert.equal(await page.locator('#lx-custom-fonts').textContent(), '')
      assert.equal((await usedFonts(page)).some(font => font.isCustomFont), false)
      assert.equal(await page.evaluate(() => window.lxData.appSetting['playDetail.useAppFont']), false, 'resetting font choices preserves the independent detail switch')
    })
    assert.deepEqual(fixture.errors, [])
    console.log('Custom font UI evidence:', profilePath)
  } catch (error) {
    console.error('Custom font profile:', profilePath, fixture.errors)
    await page.screenshot({ path: path.join(profilePath, 'custom-font-failure.png') }).catch(() => {})
    throw error
  } finally { await showDetail(page, false).catch(() => {}); await settled(page).catch(() => {}); await close(app) }
})
