const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack, showDetail, settled } = require('./helpers/motion-fixture.cjs')

const guideSelector = '[data-lyric-seek-guide]'
const prepareAudio = async page => {
  const sampleRate = 8000
  const bytes = Buffer.alloc(44 + sampleRate * 60 * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(bytes.length - 44, 40)
  await page.evaluate(async source => {
    const { player } = window.__lxPluginHost
    const audio = player.getAudioElement()
    audio.muted = true
    window.lx.isPlayedStop = false
    window.__seekEvents = []
    window.app_event.on('setProgress', time => window.__seekEvents.push(time))
    window.lxData.appSetting['player.isShowLyricTranslation'] = true
    const texts = ['晚风掠过海面', '把日落留在身边', '沿着光慢慢向前', '听见远处潮声绵延', '让这一刻缓缓浮现', '每一次切换都自然一点', '晚风又吹过蓝色海面', '我们在这里等下一篇']
    Object.assign(window.lxData.musicInfo, {
      lrc: texts.map((text, index) => `[00:${String(index * 5).padStart(2, '0')}.000]${text}`).join('\n'),
      tlrc: texts.map((_text, index) => `[00:${String(index * 5).padStart(2, '0')}.000]${index === 3 ? 'A long translated lyric that wraps over several lines and keeps the same playback timestamp. '.repeat(3) : 'Translation ' + index}`).join('\n'),
      lxlrc: '', rlrc: '',
    })
    window.app_event.lyricUpdated()
    await window.__lxPluginHost.vue.nextTick()
    player.setResource(source)
    await audio.play()
    audio.pause()
  }, 'data:audio/wav;base64,' + bytes.toString('base64'))
  await page.waitForFunction(() => document.querySelectorAll('.lyric .line-content').length === 8)
  await page.waitForTimeout(700)
}

const scrollToLine = async(page, index, fraction = 0.5) => {
  const position = await page.locator('.lyric').evaluate((element, { index, fraction }) => {
    const viewport = element.getBoundingClientRect()
    const row = element.querySelectorAll('.line-content')[index].getBoundingClientRect()
    return { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2,
      delta: row.top + row.height * fraction - viewport.top - viewport.height / 2 }
  }, { index, fraction })
  // Chromium 108 multiplies CDP wheel deltas by the display scale. Supply CSS
  // pixels on both supported Electron runtimes without changing actual input.
  const wheelScale = await page.evaluate(() => Number(process.versions.chrome.split('.')[0]) === 108 ? devicePixelRatio : 1)
  await page.mouse.move(position.x, position.y)
  await page.mouse.wheel(0, (Math.abs(position.delta) < 1 ? 1 : position.delta) / wheelScale)
  await page.locator(guideSelector).waitFor({ state: 'visible' })
  await page.waitForTimeout(100)
}
const displayedTime = page => page.locator(`${guideSelector} > span`).textContent()

test('native lyric scrolling previews and seeks the actual audio position', { timeout: 100000 }, async t => {
  const { app, page, errors, output } = await launch({ rendererPath: path.resolve('dist/index.html') })
  page.setDefaultTimeout(10000)
  try {
    assert.equal(await page.evaluate(() => window.lxData.appSetting['playDetail.isShowLyricProgressSetting']), true)
    await seedTrack(page)
    await showDetail(page, true)
    await settled(page)
    await prepareAudio(page)

    await t.test('the guide stays hidden during playback and scrolling only previews a position', async() => {
      assert.equal(await page.locator(guideSelector).isVisible(), false)
      await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().play())
      await page.waitForTimeout(200)
      assert.equal(await page.locator(guideSelector).isVisible(), false)
      await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().pause())
      const before = await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().currentTime)
      await scrollToLine(page, 3, 0.8)
      assert.equal(await displayedTime(page), '00:14') // Native line lyrics include a 60 ms lead-in.
      assert.equal(await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().currentTime), before)
      const centered = await page.locator(guideSelector).evaluate(element => {
        const guide = element.getBoundingClientRect()
        const viewport = document.querySelector('.lyric').getBoundingClientRect()
        return Math.abs(guide.y + guide.height / 2 - viewport.y - viewport.height / 2)
      })
      assert.ok(centered < 1, 'the guide crosses the vertical center of the lyric viewport')
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(output, 'lyric-seek-guide.png') })
    })

    await t.test('clicking Jump seeks the audio and resumes following the active lyric', async() => {
      await page.locator(`${guideSelector} button`).click()
      await page.waitForFunction(() => {
        const audio = window.__lxPluginHost.player.getAudioElement()
        return !audio.paused && Math.abs(audio.currentTime - 15) < 0.8 && window.__lxPluginHost.mainLyricState.lyric.line === 3
      })
      await page.waitForTimeout(100)
      await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().pause())
      assert.equal(await page.evaluate(() => window.__seekEvents.at(-1)), 14.94)
      await page.locator(guideSelector).waitFor({ state: 'hidden' })
    })

    await t.test('wrapped translations, alignment, font size and resizing retain the correct line', async() => {
      for (const align of ['left', 'center', 'right']) {
        await page.evaluate(align => {
          window.lxData.appSetting['playDetail.style.align'] = align
          window.lxData.appSetting['playDetail.style.fontSize'] = 180
        }, align)
        await page.waitForTimeout(350)
        await scrollToLine(page, 3, 0.75)
        assert.equal(await displayedTime(page), '00:14', align)
      }
      const window = await app.browserWindow(page)
      await window.evaluate(window => window.setContentSize(930, 650))
      await window.dispose()
      await page.waitForTimeout(350)
      await scrollToLine(page, 4)
      assert.equal(await displayedTime(page), '00:19')
    })

    await t.test('dragging holds the guide until released, and hovering or focusing Jump keeps it available', async() => {
      const box = await page.locator('.lyric').boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 80, { steps: 5 })
      await page.waitForTimeout(3200)
      assert.equal(await page.locator(guideSelector).isVisible(), true)
      await page.mouse.up()
      await page.locator(`${guideSelector} button`).hover()
      await page.waitForTimeout(3200)
      assert.equal(await page.locator(guideSelector).isVisible(), true)
      await page.locator(`${guideSelector} button`).focus()
      await page.mouse.move(20, 20)
      await page.waitForTimeout(3200)
      assert.equal(await page.locator(guideSelector).isVisible(), true)
      await page.locator(`${guideSelector} button`).evaluate(element => element.blur())
      await page.locator(guideSelector).waitFor({ state: 'hidden' })
    })

    await t.test('offset changes update the preview without another scroll and keyboard activation seeks it', async() => {
      await scrollToLine(page, 4)
      await page.evaluate(() => {
        const lyric = window.__lxPluginHost.mainLyricState.lyric
        lyric.offset = 1200
        lyric.tempOffset = 300
      })
      await page.waitForFunction(() => document.querySelector('[data-lyric-seek-guide] > span').textContent === '00:18')
      await page.locator(`${guideSelector} button`).press('Space')
      await page.waitForFunction(() => window.__seekEvents.at(-1) === 18.5)
      await page.waitForFunction(() => Math.abs(window.__lxPluginHost.player.getAudioElement().currentTime - 18.5) < 0.8)
      await page.waitForTimeout(100)
      await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().pause())
      await page.locator(guideSelector).waitFor({ state: 'hidden' })
    })

    await t.test('seek bounds handle beginning, end and unknown audio duration', async() => {
      await scrollToLine(page, 0)
      assert.equal(await displayedTime(page), '00:00')
      await page.evaluate(() => {
        const host = window.__lxPluginHost
        host.mainLyricState.lyric.offset = 0
        host.mainLyricState.lyric.tempOffset = 0
        host.playProgress.playProgress.maxPlayTime = 0
      })
      await scrollToLine(page, 7)
      assert.equal(await displayedTime(page), '00:35', 'an unknown duration must not clamp the time to zero')
      await page.evaluate(() => { window.__lxPluginHost.playProgress.playProgress.maxPlayTime = 30 })
      await page.waitForFunction(() => document.querySelector('[data-lyric-seek-guide] > span').textContent === '00:30')
      await page.evaluate(() => { window.__lxPluginHost.playProgress.playProgress.maxPlayTime = 60 })
    })

    await t.test('disabling the guide, reopening details and changing tracks clear stale seek positions', async() => {
      await page.evaluate(() => { window.lxData.appSetting['playDetail.isShowLyricProgressSetting'] = false })
      await page.locator(guideSelector).waitFor({ state: 'detached' })
      await page.mouse.wheel(0, -80)
      assert.equal(await page.locator(guideSelector).count(), 0)
      await page.evaluate(() => { window.lxData.appSetting['playDetail.isShowLyricProgressSetting'] = true })
      await scrollToLine(page, 2)
      await showDetail(page, false)
      await settled(page)
      await showDetail(page, true)
      await settled(page)
      assert.equal(await page.locator(guideSelector).isVisible(), false)
      await scrollToLine(page, 2)
      await page.evaluate(() => { window.lxData.musicInfo.id = 'lyric-seek-next-track' })
      await page.locator(guideSelector).waitFor({ state: 'hidden' })
      await page.evaluate(async() => {
        window.lxData.musicInfo.lrc = ''
        window.lxData.musicInfo.tlrc = ''
        window.app_event.stop()
        await window.__lxPluginHost.vue.nextTick()
        document.querySelector('.lyric').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }))
      })
      await page.waitForFunction(() => !document.querySelectorAll('.lyric .line-content').length)
      await page.mouse.wheel(0, 100)
      await page.waitForTimeout(200)
      assert.equal(await page.locator(guideSelector).isVisible(), false)
    })
    assert.deepEqual(errors, [])
    t.diagnostic(`Screenshot: ${path.join(output, 'lyric-seek-guide.png')}`)
  } finally {
    await app.close()
  }
})
