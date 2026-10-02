const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, seedTrack, showDetail, settled } = require('./helpers/motion-fixture.cjs')
const themes = require('../src/common/theme/index.json')

const update = async(page, values) => {
  await page.evaluate(values => window.lxData.updateSetting(values), values)
  await page.waitForFunction(values => Object.entries(values).every(([key, value]) => window.lxData.appSetting[key] === value), values)
}
const label = (page, key) => page.evaluate(key => window.i18n.t(key), key)
const centered = page => page.waitForFunction(() => {
  const viewport = document.querySelector('[data-player-detail] .lyric')?.getBoundingClientRect()
  const row = document.querySelector('[data-player-detail] .lyric .line-content.active')?.getBoundingClientRect()
  return viewport && row && Math.abs(row.top + row.height / 2 - viewport.top - viewport.height / 2) < 1.5
})

test('play-detail font weight is adjustable, inherited consistently and persisted', { timeout: 90000 }, async t => {
  let fixture = await launch({ disableHardwareAcceleration: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  let { app, page } = fixture
  const profilePath = fixture.output
  const output = path.resolve('output/playwright/play-detail-font-weight', process.env.LX_TEST_ELECTRON ? 'compatible' : 'ordinary')
  await fs.mkdir(output, { recursive: true })
  const slider = () => page.getByRole('slider', { name: '字体粗细', exact: true })
  const setWeight = async weight => {
    let current = Number(await slider().getAttribute('aria-valuenow'))
    while (current !== weight) {
      const next = current + (current < weight ? 100 : -100)
      await slider().press(current < weight ? 'ArrowRight' : 'ArrowLeft')
      await page.waitForFunction(next => window.lxData.appSetting['playDetail.style.fontWeight'] === next, next)
      current = next
    }
  }
  const weights = () => page.evaluate(() => {
    const root = document.querySelector('[data-player-detail]')
    const weight = selector => [...root.querySelectorAll(selector)].map(el => getComputedStyle(el).fontWeight)
    return { root: getComputedStyle(root).fontWeight, original: weight('.line > .font-lrc'), extended: weight('.extended .font-lrc'), words: weight('.font-mode > .line > .font-lrc > span'), info: weight('[data-detail-part="info"] p'), time: weight('[data-detail-part="controls"] > div > div:last-child span'), select: weight('.lyricSelectContent span'), outside: getComputedStyle(document.querySelector('#player')).fontWeight }
  })
  const assertWeight = async expected => {
    await page.waitForFunction(expected => getComputedStyle(document.querySelector('[data-player-detail]')).fontWeight === String(expected), expected)
    const state = await weights()
    assert.equal(state.root, String(expected))
    for (const key of ['original', 'extended', 'info']) {
      assert(state[key].length > 0, key)
      assert(state[key].every(weight => weight === String(expected)), `${key}: ${state[key]}`)
    }
    for (const key of ['words', 'time', 'select']) assert(state[key].every(weight => weight === String(expected)), `${key}: ${state[key]}`)
    assert.equal(state.outside, '400', 'the detail option does not change other pages or the main player')
  }
  try {
    page.setDefaultTimeout(7500)
    await update(page, { 'common.langId': 'zh-cn', 'playDetail.isDelayScroll': false })
    await route(page, '/setting?name=SettingPlayDetail')
    await page.locator('[data-setting-tab="SettingPlayDetail"]').click()

    await t.test('the real slider supports keyboard adjustment, bounds, search and reset', async() => {
      assert.equal(await slider().getAttribute('aria-valuenow'), '400')
      const search = page.getByPlaceholder('搜索设置项', { exact: true })
      await search.fill('字体粗细')
      await slider().waitFor()
      await search.fill('')
      await setWeight(100)
      await slider().press('ArrowLeft')
      assert.equal(await slider().getAttribute('aria-valuenow'), '100')
      await setWeight(900)
      await slider().press('ArrowRight')
      assert.equal(await slider().getAttribute('aria-valuenow'), '900')
      await page.getByRole('button', { name: '恢复标准粗细', exact: true }).click()
      await page.waitForFunction(() => window.lxData.appSetting['playDetail.style.fontWeight'] === 400)
      await setWeight(700)
      await page.locator('#play_detail_font_weight').locator('..').screenshot({ path: path.join(output, 'settings.png') })
    })

    await seedTrack(page)
    await showDetail(page, true)
    await settled(page)
    await page.evaluate(() => {
      const texts = ['晚风轻轻掠过海面', '把日落留在你身边', '沿着光慢慢向前，这是一句需要换行的歌词，调整字体粗细时它和下面的翻译、罗马音应该一起保持在歌词区域中央', '听见远处潮声绵延']
      const timed = fn => texts.map((text, i) => `[00:${String(i).padStart(2, '0')}.000]${fn(text, i)}`).join('\n')
      const lrc = timed(text => text)
      Object.assign(window.lxData.musicInfo, {
        lrc, rawlrc: lrc,
        tlrc: timed((_text, i) => i === 2 ? 'Follow the light slowly while this translated lyric wraps onto several lines.' : 'Translation ' + i),
        rlrc: timed((_text, i) => i === 2 ? 'yan zhe guang man man xiang qian, zi ti cu xi bao chi yi zhi' : 'wan feng qing qing'),
        lxlrc: timed(text => `<0,500>${text.slice(0, 4)}<500,500>${text.slice(4)}`),
      })
      window.app_event.lyricUpdated()
    })
    await update(page, { 'player.isShowLyricTranslation': true, 'player.isShowLyricRoma': true })
    await page.waitForFunction(() => document.querySelectorAll('.lyric .line-content').length === 4 && document.querySelectorAll('.lyric .extended').length === 8)

    await t.test('light/dark themes and dynamic backgrounds retain the selected weight', async() => {
      for (const id of ['green', 'black']) {
        const theme = themes.find(theme => theme.id === id)
        await page.evaluate(colors => window.setTheme(colors), { ...theme.config.themeColors, ...theme.config.extInfo })
        for (const ambient of [false, true]) {
          await update(page, { 'ui.ambientBackground': ambient, 'ui.ambientBackgroundAutoContrast': true })
          if (ambient) await page.locator('[data-ambient-background="shared"]').waitFor()
          else await page.locator('[data-ambient-background="shared"]').waitFor({ state: 'detached' })
          await assertWeight(700)
          await centered(page)
          await page.screenshot({ path: path.join(output, `${id}-${ambient ? 'ambient' : 'plain'}.png`) })
        }
      }
    })

    await t.test('live changes, word lyrics, wrapped rows and the copy view follow the setting', async() => {
      const rate = 8000
      const wav = Buffer.alloc(44 + rate * 12 * 2)
      wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
      wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
      wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
      await page.evaluate(async source => {
        const player = window.__lxPluginHost.player
        player.getAudioElement().muted = true
        window.lx.isPlayedStop = false
        player.setResource(source)
        await player.getAudioElement().play()
        player.getAudioElement().pause()
      }, 'data:audio/wav;base64,' + wav.toString('base64'))
      for (const wordMode of [false, true]) {
        await update(page, { 'player.isPlayLxlrc': wordMode })
        await page.waitForFunction(wordMode => document.querySelectorAll(`.lyric .line-content.${wordMode ? 'font' : 'line'}-mode`).length === 4, wordMode)
        await page.evaluate(async() => {
          const audio = window.__lxPluginHost.player.getAudioElement()
          audio.currentTime = 2.1
          await audio.play(); audio.pause()
        })
        for (const weight of [300, 900]) {
          await update(page, { 'playDetail.style.fontWeight': weight })
          await assertWeight(weight)
          await centered(page)
          assert.equal(await page.evaluate(() => window.__lxPluginHost.mainLyricState.lyric.line), 2)
          await page.screenshot({ path: path.join(output, `${wordMode ? 'words' : 'lines'}-${weight}.png`) })
        }
      }
      const select = page.locator('[data-player-detail]').getByRole('button', { name: await label(page, 'lyric__select'), exact: true })
      await select.click()
      await page.locator('.lyricSelectContent').waitFor()
      await assertWeight(900)
      await update(page, { 'playDetail.style.fontWeight': 300 })
      await assertWeight(300)
      await page.screenshot({ path: path.join(output, 'copy-view-300.png') })
      await select.click()
      await showDetail(page, false)
      await settled(page)
    })

    await t.test('reload and application restart keep the saved value and UI state', async() => {
      await route(page, '/setting?name=SettingPlayDetail')
      await setWeight(600)
      await page.reload()
      await page.waitForFunction(() => window.lxData?.appSetting?.['playDetail.style.fontWeight'] === 600)
      assert.deepEqual(fixture.errors, [])
      await app.close()
      fixture = await launch({ profilePath }); app = fixture.app; page = fixture.page
      await route(page, '/setting?name=SettingPlayDetail')
      await page.locator('[data-setting-tab="SettingPlayDetail"]').click()
      assert.equal(await slider().getAttribute('aria-valuenow'), '600')
      await seedTrack(page)
      await showDetail(page, true)
      await settled(page)
      assert.equal(await page.locator('[data-player-detail]').evaluate(el => getComputedStyle(el).fontWeight), '600')
    })
    assert.deepEqual(fixture.errors, [])
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ electron: await app.evaluate(() => process.versions.electron), profilePath, completed: true, errors: fixture.errors }, null, 2))
  } finally {
    await app.close()
  }
})
