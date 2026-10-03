const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const texts = ['晚风轻轻掠过海面', '把日落留在你身边', '沿着光慢慢向前，这是一句很长的歌词，用来检查窗口变小时始终只占一行而且不会滚动或换行']
const timed = (lines) => lines.map((line, index) => `[00:${String(index * 15).padStart(2, '0')}.00]${line}`).join('\n')
const update = (page, values) => page.evaluate(values => window.lxData.updateSetting(values), values)

test('mini-player single-line lyrics replace immediately and preserve multi-line preferences', { timeout: 100000 }, async t => {
  const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-mini-single-line-'))
  const output = path.resolve('output/playwright/mini-player-inline-lyrics', process.env.LX_TEST_ELECTRON ? 'compatible' : 'ordinary')
  await fs.mkdir(output, { recursive: true })
  const rate = 8000
  const wav = Buffer.alloc(44 + rate * 90 * 2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
  const filePath = path.join(profilePath, 'single-line.wav')
  await fs.writeFile(filePath, wav)
  await fs.writeFile(path.join(profilePath, 'single-line.lrc'), timed(texts))
  const song = { id: 'single-line', name: '单行歌词测试', singer: 'LX-M', source: 'local', interval: '01:30', meta: { albumName: '歌词预览', filePath, ext: 'wav' } }
  let fixture = await launch({ profilePath })
  let { app, page } = fixture
  let mini
  const errors = []
  const getMini = async() => {
    const window = app.windows().find(window => window.url().includes('lyric.html')) ?? await app.waitForEvent('window', { predicate: window => window.url().includes('lyric.html') })
    await window.locator('[data-mini-lyrics]').waitFor()
    window.on('pageerror', error => errors.push(error.message))
    window.setDefaultTimeout(7000)
    return window
  }
  const seek = async time => {
    await mini.locator('.mini-progress input').evaluate((el, time) => {
      el.value = String(time)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, time)
    await page.waitForFunction(time => Math.abs(window.__lxPluginHost.player.getAudioElement().currentTime - time) < 0.2, time)
  }
  const options = async() => {
    const window = await app.browserWindow(mini)
    const bounds = await window.evaluate(window => window.getContentBounds())
    await window.dispose()
    await app.evaluate((_, bounds) => {
      global.__miniSinglePoint = { x: bounds.x + 70, y: bounds.y + 20 }
    }, bounds)
    await mini.mouse.move(70, 20)
    await mini.getByRole('button', { name: '外观与窗口', exact: true }).click()
    await mini.locator('#mini-options').waitFor()
  }
  const closeOptions = async() => {
    await mini.locator('#mini-options').getByRole('button', { name: '关闭', exact: true }).click()
    await mini.locator('#mini-options').waitFor({ state: 'hidden' })
  }
  const lineIs = async text => {
    try {
      await mini.waitForFunction(text => document.querySelector('[data-mini-single-line] .line > .font-lrc')?.textContent === text, text)
    } catch (error) {
      console.error('Single-line state:', await mini.locator('[data-mini-lyrics]').evaluate(el => ({ text: el.textContent, html: el.innerHTML, classes: el.className })))
      console.error('Player state:', await page.evaluate(() => ({ time: window.__lxPluginHost.player.getAudioElement().currentTime, info: { lrc: window.lxData.musicInfo.lrc, tlrc: window.lxData.musicInfo.tlrc, lxlrc: window.lxData.musicInfo.lxlrc } })))
      throw error
    }
  }
  const extendedIs = async expected => {
    await mini.waitForFunction(expected => {
      const lines = [...document.querySelectorAll('[data-mini-single-line] .extended > .font-lrc')]
      return JSON.stringify(lines.map(line => line.textContent)) === JSON.stringify(expected) && lines.every(line => line.getBoundingClientRect().width > 0)
    }, expected)
  }
  try {
    await app.evaluate(({ screen }) => {
      global.__miniSinglePoint = { x: -10000, y: -10000 }
      screen.getCursorScreenPoint = () => global.__miniSinglePoint
    })
    await page.evaluate(song => require('electron').ipcRenderer.invoke('player_list_data_overwire', { defaultList: [], loveList: [song], tempList: [], userList: [] }), song)
    await route(page, '/list?id=love')
    await settled(page)
    await page.locator('[data-song-id="single-line"] [data-music-cell="index"]').dblclick()
    await page.waitForFunction(() => !window.__lxPluginHost.player.getAudioElement().paused && window.__lxPluginHost.player.getDuration() > 0)
    await page.locator('#player').getByRole('button', { name: /开启迷你播放器/ }).click()
    mini = await getMini()
    await mini.getByRole('button', { name: '暂停', exact: true }).click()
    await page.waitForFunction(() => window.__lxPluginHost.player.getAudioElement().paused)
    await seek(0)

    await t.test('main settings enable one current row with no line transitions', async() => {
      assert.equal(await page.evaluate(() => window.lxData.appSetting['desktopLyric.singleLine']), false)
      await route(page, '/setting')
      await page.locator('[data-setting-tab="SettingDesktopLyric"]').click()
      await page.locator('label[for="setting_mini_player_single_line"]').click()
      await lineIs(texts[0])
      assert.equal(await mini.locator('[data-mini-lyrics] .line-content').count(), 1)
      assert.equal(await mini.locator('[data-mini-lyrics]').evaluate(el => getComputedStyle(el).webkitMaskImage), 'none')
      assert(await mini.locator('[data-mini-single-line]').evaluate(el => [...el.querySelectorAll('*')].every(node => getComputedStyle(node).transitionDuration === '0s')))
      await page.locator('label[for="setting_mini_player_single_line"]').scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(output, 'settings.png') })
      await mini.screenshot({ path: path.join(output, 'single-line.png') })
    })

    await t.test('paused seeking, long lines, font size and multi-line preferences survive toggling', async() => {
      await page.evaluate(({ translations, romanizations }) => {
        Object.assign(window.lxData.musicInfo, { tlrc: translations, rlrc: romanizations })
      }, { translations: timed(['Translation one', 'Translation two', 'Translation three']), romanizations: timed(['Roma one', 'Roma two', 'Roma three']) })
      await update(page, { 'desktopLyric.direction': 'vertical', 'desktopLyric.style.isZoomActiveLrc': true, 'desktopLyric.isDelayScroll': true, 'player.isShowLyricTranslation': true, 'player.isShowLyricRoma': true, 'player.isSwapLyricTranslationAndRoma': false, 'desktopLyric.style.fontSize': 27 })
      await seek(31)
      await lineIs(texts[2])
      await extendedIs(['Roma three', 'Translation three'])
      assert.equal(await mini.locator('[data-mini-single-line] .extended:visible').count(), 2)
      const metrics = await mini.locator('[data-mini-single-line] .line > .font-lrc').evaluate(el => {
        const style = getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        const viewport = el.closest('[data-mini-lyrics]').getBoundingClientRect()
        const range = document.createRange(); range.selectNodeContents(el)
        return { whiteSpace: style.whiteSpace, ellipsis: style.textOverflow, fontSize: style.fontSize, rows: new Set([...range.getClientRects()].map(rect => rect.y.toFixed(1))).size, height: rect.height, viewportWidth: viewport.width, width: rect.width, centered: Math.abs(rect.y + rect.height / 2 - viewport.y - viewport.height / 2) < 1, writingMode: style.writingMode, transform: getComputedStyle(el.closest('.line')).transform }
      })
      await mini.screenshot({ path: path.join(output, 'single-long-line.png') })
      assert.equal(metrics.whiteSpace, 'nowrap'); assert.equal(metrics.ellipsis, 'ellipsis'); assert.equal(metrics.fontSize, '27px')
      assert.equal(metrics.rows, 1); assert(metrics.centered); assert(metrics.width < metrics.viewportWidth); assert.equal(metrics.writingMode, 'horizontal-tb'); assert.equal(metrics.transform, 'none')
      assert.equal(await mini.locator('[data-mini-single-line]').getAttribute('title'), [texts[2], 'Roma three', 'Translation three'].join(' · '))
      await options()
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#mini-options')).opacity === '1')
      await mini.screenshot({ path: path.join(output, 'options.png') })
      await mini.getByLabel('单行歌词', { exact: true }).uncheck()
      await closeOptions()
      await mini.waitForFunction(() => document.querySelector('[data-mini-lyrics]').classList.contains('vertical') && document.querySelectorAll('[data-mini-lyrics] .line-content').length === 3)
      assert.equal(await page.locator('#setting_mini_player_single_line').isChecked(), false)
      await mini.waitForFunction(text => document.querySelector('[data-mini-lyrics] .line-content.active > .line > .font-lrc')?.textContent === text, texts[2])
      assert.equal(await mini.locator('[data-mini-lyrics] .line-content.active .extended').count(), 2)
      await options()
      await mini.getByLabel('单行歌词', { exact: true }).check()
      await closeOptions()
      await lineIs(texts[2])
      assert.equal(await page.locator('#setting_mini_player_single_line').isChecked(), true)
      assert.deepEqual(await page.evaluate(() => ['desktopLyric.direction', 'desktopLyric.style.isZoomActiveLrc', 'desktopLyric.isDelayScroll', 'player.isShowLyricTranslation', 'player.isShowLyricRoma'].map(key => window.lxData.appSetting[key])), ['vertical', true, true, true, true])
      assert.equal(await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().paused), true)
    })

    await t.test('translation and romanization share one row and follow visibility, order and current timestamps', async() => {
      await seek(0)
      await lineIs(texts[0])
      await extendedIs(['Roma one', 'Translation one'])
      const row = await mini.locator('[data-mini-single-line] .line-content').evaluate(el => {
        const rect = el.getBoundingClientRect()
        const parts = [...el.querySelectorAll(':scope > .line, :scope > .extended')].map(part => {
          const box = part.getBoundingClientRect()
          const style = getComputedStyle(part.querySelector('.font-lrc'))
          return { center: box.y + box.height / 2, left: box.left, right: box.right, width: box.width, whiteSpace: style.whiteSpace, ellipsis: style.textOverflow }
        })
        return { center: rect.y + rect.height / 2, left: rect.left, right: rect.right, parts }
      })
      assert.equal(row.parts.length, 3)
      for (const part of row.parts) {
        assert(Math.abs(part.center - row.center) < 1)
        assert(part.width > 0 && part.left >= row.left - 1 && part.right <= row.right + 1)
        assert.equal(part.whiteSpace, 'nowrap'); assert.equal(part.ellipsis, 'ellipsis')
      }
      await mini.screenshot({ path: path.join(output, 'single-inline-all.png') })
      await update(page, { 'player.isShowLyricRoma': false })
      await extendedIs(['Translation one'])
      await update(page, { 'player.isShowLyricTranslation': false, 'player.isShowLyricRoma': true })
      await extendedIs(['Roma one'])
      await update(page, { 'player.isShowLyricRoma': false })
      await extendedIs([])
      assert.equal(await mini.locator('[data-mini-single-line]').getAttribute('title'), texts[0])
      await update(page, { 'player.isShowLyricTranslation': true, 'player.isShowLyricRoma': true, 'player.isSwapLyricTranslationAndRoma': true, 'desktopLyric.style.isFontWeightExtended': true })
      await extendedIs(['Translation one', 'Roma one'])
      assert.equal(await mini.locator('[data-mini-single-line] .extended').first().evaluate(el => getComputedStyle(el).fontWeight), '700')
      assert.equal(await mini.locator('[data-mini-single-line]').getAttribute('title'), [texts[0], 'Translation one', 'Roma one'].join(' · '))
      await mini.screenshot({ path: path.join(output, 'single-inline-swapped.png') })
      await update(page, { 'player.isSwapLyricTranslationAndRoma': false, 'desktopLyric.style.isFontWeightExtended': false })
      await page.evaluate(({ translations, romanizations }) => {
        Object.assign(window.lxData.musicInfo, { tlrc: translations, rlrc: romanizations })
        window.app_event.lyricUpdated()
      }, { translations: timed(['Translation one', '', 'Translation three']), romanizations: timed(['Roma one', 'Roma two', '']) })
      await seek(15.1)
      await lineIs(texts[1])
      await extendedIs(['Roma two'])
      await seek(30.1)
      await lineIs(texts[2])
      await extendedIs(['Translation three'])
      await page.evaluate(({ translations, romanizations }) => {
        Object.assign(window.lxData.musicInfo, { tlrc: translations, rlrc: romanizations })
        window.app_event.lyricUpdated()
      }, { translations: timed(['Translation one', 'Translation two', 'Translation three']), romanizations: timed(['Roma one', 'Roma two', 'Roma three']) })
      await seek(0)
      await extendedIs(['Roma one', 'Translation one'])
    })

    await t.test('real playback changes the row at the next timestamp without delayed scrolling', async() => {
      await seek(14.7)
      await lineIs(texts[0])
      await mini.evaluate(() => {
        window.__singleLineChanges = []
        const el = document.querySelector('[data-mini-single-line]')
        new MutationObserver(() => {
          const line = el.querySelector('.line-content')
          if (!line) return
          window.__singleLineChanges.push({ text: line.querySelector('.line > .font-lrc').textContent, rows: el.querySelectorAll('.line-content').length, transform: getComputedStyle(line).transform, transitions: [...line.querySelectorAll('*')].map(node => getComputedStyle(node).transitionDuration), animations: line.getAnimations({ subtree: true }).length })
        }).observe(el, { childList: true, subtree: true })
      })
      await mini.getByRole('button', { name: '播放', exact: true }).click()
      await lineIs(texts[1])
      await extendedIs(['Roma two', 'Translation two'])
      const changedAt = await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().currentTime)
      assert(changedAt < 15.45, `line switched at ${changedAt}s; delay-scroll preference must not delay the single row`)
      await mini.getByRole('button', { name: '暂停', exact: true }).click()
      const changes = await mini.evaluate(() => window.__singleLineChanges)
      assert(changes.some(change => change.text === texts[1]))
      for (const change of changes) {
        assert.equal(change.rows, 1); assert.equal(change.transform, 'none'); assert.equal(change.animations, 0)
        assert(change.transitions.every(duration => duration === '0s'))
      }
    })

    await t.test('word-progress highlighting remains available without line movement', async() => {
      await page.evaluate(() => {
        window.lxData.musicInfo.lxlrc = '[00:00.00]<0,5000>晚风<5000,5000>轻轻<10000,5000>掠过海面\n[00:15.00]<0,5000>把日落<5000,5000>留在<10000,5000>你身边\n[00:30.00]<0,5000>沿着光<5000,5000>慢慢<10000,5000>向前'
      })
      await update(page, { 'player.isPlayLxlrc': true })
      await page.waitForFunction(() => window.lxData.appSetting['player.isPlayLxlrc'])
      await page.evaluate(() => window.app_event.lyricUpdated())
      await seek(1)
      try {
        await mini.waitForFunction(() => !!document.querySelector('[data-mini-single-line] .font-mode > .line > .font-lrc > span'))
      } catch (error) {
        console.error('Word lyric state:', await mini.locator('[data-mini-lyrics]').innerHTML(), await page.evaluate(() => ({ lxlrc: window.lxData.musicInfo.lxlrc, enabled: window.lxData.appSetting['player.isPlayLxlrc'] })))
        throw error
      }
      const progress = await mini.locator('[data-mini-single-line] .font-mode > .line > .font-lrc > span').first().evaluate(el => ({ size: getComputedStyle(el).backgroundSize, frames: el.getAnimations().flatMap(animation => animation.effect.getKeyframes()) }))
      assert.match(progress.size, /100%$/)
      await mini.getByRole('button', { name: '播放', exact: true }).click()
      await mini.waitForFunction(() => {
        const el = document.querySelector('[data-mini-single-line] .font-mode > .line > .font-lrc > span')
        return el.getAnimations().some(animation => animation.playState === 'running')
      })
      const frames = await mini.locator('[data-mini-single-line] .font-mode > .line > .font-lrc > span').first().evaluate(el => el.getAnimations()[0].effect.getKeyframes().map(frame => frame.backgroundSize))
      assert.match(frames[0], /^0(?:px|%)? 100%$/)
      assert.equal(frames[1], '100% 100%')
      await mini.getByRole('button', { name: '暂停', exact: true }).click()
      assert.equal(await mini.locator('[data-mini-lyrics] .line-content').count(), 1)
      await extendedIs(['Roma one', 'Translation one'])
      await mini.screenshot({ path: path.join(output, 'single-word-progress.png') })
    })

    await t.test('a short transparent lyrics-only window still displays a single centered row', async() => {
      const window = await app.browserWindow(mini)
      const bounds = await window.evaluate(window => window.getBounds())
      try {
        await update(page, { 'desktopLyric.showPlayer': false, 'desktopLyric.style.backgroundOpacity': 0 })
        await window.evaluate(window => window.setContentSize(340, 72))
        await app.evaluate(() => { global.__miniSinglePoint = { x: -10000, y: -10000 } })
        await mini.mouse.move(-20, -20)
        await mini.waitForFunction(() => !document.querySelector('[data-mini-lyrics]').classList.contains('with-player') && getComputedStyle(document.querySelector('#background')).opacity === '0')
        const position = await mini.locator('[data-mini-single-line] .line-content').evaluate(el => {
          const row = el.getBoundingClientRect()
          const viewport = el.closest('[data-mini-lyrics]').getBoundingClientRect()
          return { delta: Math.abs(row.y + row.height / 2 - viewport.y - viewport.height / 2), top: row.top, bottom: row.bottom, windowHeight: innerHeight }
        })
        assert(position.delta < 1); assert(position.top >= 0); assert(position.bottom <= position.windowHeight)
        assert.equal(await mini.locator('[data-mini-lyrics] .line-content').count(), 1)
        await mini.screenshot({ path: path.join(output, 'single-lyrics-only.png'), omitBackground: true })
      } finally {
        await update(page, { 'desktopLyric.showPlayer': true, 'desktopLyric.style.backgroundOpacity': 92 })
        await window.evaluate((window, bounds) => window.setBounds(bounds), bounds)
        await window.dispose()
      }
    })

    await t.test('the setting persists after restart and can be disabled in main settings', async() => {
      assert.deepEqual(fixture.errors, [])
      await app.close()
      fixture = await launch({ profilePath }); app = fixture.app; page = fixture.page
      mini = await getMini()
      await mini.locator('[data-mini-single-line]').waitFor()
      assert.equal(await page.evaluate(() => window.lxData.appSetting['desktopLyric.singleLine']), true)
      await route(page, '/setting')
      await page.locator('[data-setting-tab="SettingDesktopLyric"]').click()
      await page.locator('label[for="setting_mini_player_single_line"]').click()
      await mini.locator('[data-mini-single-line]').waitFor({ state: 'detached' })
      await mini.waitForFunction(() => document.querySelector('[data-mini-lyrics]').classList.contains('vertical'))
    })
    assert.deepEqual(errors, [])
    assert.deepEqual(fixture.errors, [])
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ electron: await app.evaluate(() => process.versions.electron), profilePath, errors, passed: true }, null, 2))
  } finally {
    await app.close()
  }
})
