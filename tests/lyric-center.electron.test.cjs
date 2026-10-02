const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack, showDetail, settled } = require('./helpers/motion-fixture.cjs')

const wav = Buffer.alloc(44 + 8000 * 12 * 2)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)

const centered = async(page, index) => page.waitForFunction(index => {
  const viewport = document.querySelector('.lyric')?.getBoundingClientRect()
  const row = document.querySelectorAll('.lyric .line-content')[index]
  if (!viewport || !row?.classList.contains('active')) return false
  const rect = row.getBoundingClientRect()
  return Math.abs(rect.top + rect.height / 2 - viewport.top - viewport.height / 2) < 1.5
}, index).catch(async error => {
  console.error('Lyric center state:', await page.evaluate(index => {
    const viewport = document.querySelector('.lyric')
    const row = viewport.querySelectorAll('.line-content')[index]
    const frame = viewport.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    const audio = window.__lxPluginHost.player.getAudioElement()
    return { index, active: row.classList.contains('active'), lyricLine: window.__lxPluginHost.mainLyricState.lyric.line,
      audioTime: audio.currentTime, paused: audio.paused, scrollTop: viewport.scrollTop,
      row: rect.toJSON(), frame: frame.toJSON(), rowOffset: row.offsetTop, rowHeight: row.offsetHeight,
      clientHeight: viewport.clientHeight, centerError: rect.top + rect.height / 2 - frame.top - frame.height / 2 }
  }, index))
  throw error
})

const seek = async(page, index) => {
  await page.evaluate(async index => {
    const audio = window.__lxPluginHost.player.getAudioElement()
    audio.currentTime = index + 0.1
    await audio.play()
    audio.pause()
  }, index)
  await centered(page, index)
}

test('the playing lyric group stays centered through zoom, wrapped text and viewport changes', { timeout: 65000 }, async t => {
  const { app, page, errors, output } = await launch({ rendererPath: path.resolve('dist/index.html') })
  page.setDefaultTimeout(7000)
  try {
    await seedTrack(page)
    await showDetail(page, true)
    await settled(page)
    await page.evaluate(async source => {
      Object.assign(window.lxData.appSetting, {
        'playDetail.isZoomActiveLrc': true,
        'playDetail.isDelayScroll': true,
        'playDetail.style.align': 'center',
        'playDetail.style.fontSize': 140,
        'player.isShowLyricTranslation': false,
        'player.isShowLyricRoma': false,
      })
      const texts = ['晚风轻轻掠过海面', '把日落留在你身边', '沿着光慢慢向前，这句歌词需要换行，并且每一行都应该随着当前歌曲平稳移动到歌词区域中央', '听见远处潮声绵延']
      const timed = fn => texts.map((text, i) => `[00:${String(i).padStart(2, '0')}.000]${fn(text, i)}`).join('\n')
      Object.assign(window.lxData.musicInfo, {
        lrc: timed(text => text),
        lxlrc: timed(text => `<0,500>${text.slice(0, 4)}<500,500>${text.slice(4)}`),
        tlrc: timed((_text, i) => i === 2 ? 'Follow the light slowly while this translated lyric wraps across several lines, remaining centered together with the original lyric and its romanization.' : 'Translation ' + i),
        rlrc: timed((_text, i) => i === 2 ? 'yan zhe guang man man xiang qian, zhe ju ge ci xu yao huan hang' : 'wan feng qing qing'),
      })
      window.app_event.lyricUpdated()
      await window.__lxPluginHost.vue.nextTick()
      const player = window.__lxPluginHost.player
      player.getAudioElement().muted = true
      window.lx.isPlayedStop = false
      player.setResource(source)
      await player.getAudioElement().play()
      player.getAudioElement().pause()
    }, 'data:audio/wav;base64,' + wav.toString('base64'))
    await page.waitForFunction(() => document.querySelectorAll('.lyric .line-content').length === 4)

    await t.test('first and final lyrics can reach the center with enlargement enabled or disabled', async() => {
      for (const zoom of [true, false]) {
        await page.evaluate(zoom => { window.lxData.appSetting['playDetail.isZoomActiveLrc'] = zoom }, zoom)
        for (const index of [0, 3]) await seek(page, index)
      }
      await page.evaluate(() => { window.lxData.appSetting['playDetail.isZoomActiveLrc'] = true })
      await seek(page, 0)
      await page.waitForTimeout(450)
    })

    await t.test('disabling application animations centers first and final lyrics immediately', async() => {
      await page.evaluate(() => { window.lxData.appSetting['common.isShowAnimation'] = false })
      await page.waitForFunction(() => document.documentElement.dataset.motionEnabled === 'false')
      for (const index of [0, 3]) await seek(page, index)
      await page.evaluate(() => { window.lxData.appSetting['common.isShowAnimation'] = true })
      await page.waitForFunction(() => document.documentElement.dataset.motionEnabled === 'true')
    })

    for (const wordMode of [false, true]) {
      await t.test(`audio-driven ${wordMode ? 'word' : 'line'} lyrics move into the center while enlarging`, async() => {
        await page.evaluate(wordMode => { window.lxData.appSetting['player.isPlayLxlrc'] = wordMode }, wordMode)
        await page.waitForFunction(wordMode => document.querySelectorAll(`.lyric .line-content.${wordMode ? 'font' : 'line'}-mode`).length === 4, wordMode)
        await seek(page, 0)
        await page.waitForTimeout(450)
        const frames = await page.evaluate(async() => {
          const audio = window.__lxPluginHost.player.getAudioElement()
          audio.currentTime = 0.5
          await audio.play()
          const viewport = document.querySelector('.lyric')
          const rows = Array.from(viewport.querySelectorAll('.line-content'))
          const frames = []
          const start = performance.now()
          await new Promise(resolve => {
            const sample = () => {
              const frame = viewport.getBoundingClientRect()
              const row = rows[1].getBoundingClientRect()
              frames.push({ time: performance.now() - start, active: rows[1].classList.contains('active'),
                scale: new DOMMatrixReadOnly(getComputedStyle(rows[1]).transform).a,
                followingTop: rows[2].getBoundingClientRect().top,
                centerError: Math.abs(row.top + row.height / 2 - frame.top - frame.height / 2) })
              if (performance.now() - start < 1300) requestAnimationFrame(sample)
              else resolve()
            }
            requestAnimationFrame(sample)
          })
          audio.pause()
          return frames
        })
        const zoomStarts = frames.find(frame => frame.scale > 1.001)
        const moveStarts = frames.find(frame => frame.followingTop < frames[0].followingTop - 1)
        assert(zoomStarts && moveStarts && Math.abs(zoomStarts.time - moveStarts.time) <= 100, 'enlargement and upward scrolling begin together')
        assert(frames.some(frame => frame.scale > 1.005 && frame.scale < 1.135 && frame.followingTop < frames[0].followingTop - 1), 'lower lyrics move up during enlargement')
        assert(frames.at(-1).active && frames.at(-1).centerError < 1.5, 'the playing lyric settles at the viewport center')
        const settledZoom = frames.find(frame => frame.scale >= 1.1395)
        assert(settledZoom.centerError < 2, 'scrolling centers the lyric as its enlargement finishes')
      })
    }

    await t.test('wrapped lyrics and translation/romaji toggles keep the complete active group centered', async() => {
      await seek(page, 2)
      for (const enabled of [true, false, true]) {
        await page.evaluate(enabled => {
          window.lxData.appSetting['player.isShowLyricTranslation'] = enabled
          window.lxData.appSetting['player.isShowLyricRoma'] = enabled
        }, enabled)
        await page.waitForFunction(enabled => document.querySelector('.lyric .line-content.active').querySelectorAll('.extended').length === (enabled ? 2 : 0), enabled)
        await centered(page, 2)
      }
      await page.screenshot({ path: path.join(output, 'lyric-centered-extended.png') })
    })

    await t.test('font size, horizontal alignment and window reflow recenter without changing the playing line', async() => {
      for (const align of ['left', 'center', 'right']) {
        await page.evaluate(align => {
          window.lxData.appSetting['playDetail.style.align'] = align
          window.lxData.appSetting['playDetail.style.fontSize'] = 220
        }, align)
        await centered(page, 2)
      }
      const window = await app.browserWindow(page)
      try { await window.evaluate(window => window.setContentSize(930, 650)) } finally { await window.dispose() }
      await centered(page, 2)
      await page.evaluate(() => { window.lxData.appSetting['playDetail.style.align'] = 'center' })
      await page.screenshot({ path: path.join(output, 'lyric-centered-reflow.png') })
    })

    await t.test('manual scrolling stays under user control after resize and Jump resumes centered following', async() => {
      const box = await page.locator('.lyric').boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, 180)
      await page.locator('[data-lyric-seek-guide]').waitFor({ state: 'visible' })
      const window = await app.browserWindow(page)
      try { await window.evaluate(window => window.setContentSize(930, 600)) } finally { await window.dispose() }
      await page.waitForTimeout(150)
      const deviation = await page.locator('.lyric').evaluate(viewport => {
        const frame = viewport.getBoundingClientRect()
        const row = viewport.querySelector('.line-content.active').getBoundingClientRect()
        return Math.abs(row.top + row.height / 2 - frame.top - frame.height / 2)
      })
      assert(deviation > 25, 'automatic following cannot override manual browsing during reflow')
      await page.locator('[data-lyric-seek-guide] button').click()
      await page.locator('[data-lyric-seek-guide]').waitFor({ state: 'hidden' })
      const index = await page.evaluate(() => window.__lxPluginHost.mainLyricState.lyric.line)
      await centered(page, index)
      await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().pause())
    })

    assert.deepEqual(errors, [])
    t.diagnostic(`Centered lyric screenshots: ${output}`)
  } finally { await app.close() }
})
