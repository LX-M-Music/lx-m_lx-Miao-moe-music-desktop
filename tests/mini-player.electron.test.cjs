const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const { dragWindow, nativeHitTest, nativeIgnoresMouse, resizeWindow } = require('./helpers/native-window-drag.cjs')

const label = (page, key) => page.evaluate(key => window.i18n.t(key), key)
const update = (page, values) => page.evaluate(values => window.lxData.updateSetting(values), values)
const makeWav = () => {
  const rate = 8000
  const buffer = Buffer.alloc(44 + rate * 90 * 2)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40)
  // The fixture deliberately supplies cached artwork, so give the WAV a real
  // identifying tag. Untagged files must ignore online metadata (separate tests).
  const title = Buffer.from('Mini player fixture\0')
  const tags = Buffer.alloc(20 + title.length + title.length % 2)
  tags.write('LIST'); tags.writeUInt32LE(tags.length - 8, 4); tags.write('INFOINAM', 8)
  tags.writeUInt32LE(title.length, 16); title.copy(tags, 20)
  const tagged = Buffer.concat([buffer, tags])
  tagged.writeUInt32LE(tagged.length - 8, 4)
  return tagged
}

test('mini player replaces desktop lyrics and controls the real player in a separate window', { timeout: 150000 }, async t => {
  const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-mini-player-'))
  const colors = ['#3c9b84', '#cb8067', '#5b72b3']
  const songs = await Promise.all(colors.map(async(color, i) => {
    const filePath = path.join(profilePath, `track-${i}.wav`)
    await fs.writeFile(filePath, makeWav())
    await fs.writeFile(path.join(profilePath, `track-${i}.lrc`), '[00:00.00]晚风轻轻掠过海面\n[00:15.00]把日落留在你身边\n[00:30.00]沿着光慢慢向前')
    const picUrl = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${color}"/><circle cx="130" cy="64" r="31" fill="#f8dda9"/><path d="M0 120 Q60 80 110 140 T200 130 V200 H0Z" fill="#163b53"/></svg>`)
    return { id: `mini-${i}`, name: ['晚风与海', '蓝色时刻', '沿途的光'][i], singer: '迷你播放器测试', source: 'local', interval: '01:30', meta: { albumName: 'Evening Tide', filePath, ext: 'wav', picUrl } }
  }))
  let fixture = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') })
  let { app, page } = fixture
  let mini
  const errors = []
  const getMini = async() => {
    let window = app.windows().find(window => window.url().includes('lyric.html'))
    window ??= await app.waitForEvent('window', { predicate: window => window.url().includes('lyric.html') })
    // In lyrics-only mode this section deliberately has no layout height.
    await window.locator('[data-mini-player]').waitFor({ state: 'attached' })
    await window.locator('#main').waitFor()
    window.on('pageerror', error => errors.push(error.message))
    window.setDefaultTimeout(7000)
    return window
  }
  const button = async key => mini.getByRole('button', { name: await label(page, key), exact: true })
  const pointerInside = async inside => {
    const window = await app.browserWindow(mini)
    try {
      const bounds = await window.evaluate(window => window.getContentBounds())
      await app.evaluate((_, { inside, bounds }) => {
        const point = inside ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : { x: -10000, y: -10000 }
        global.__miniPointer = point
        if (global.__miniLockPoint) global.__miniLockPoint = point
      }, { inside, bounds })
    } finally { await window.dispose() }
  }
  const options = async() => {
    await pointerInside(true)
    await mini.mouse.move(80, 20)
    await (await button('mini_player__options')).click()
    await mini.locator('#mini-options').waitFor()
  }
  const closeOptions = async() => {
    await mini.locator('#mini-options').getByRole('button', { name: await label(page, 'close'), exact: true }).click()
    await mini.locator('#mini-options').waitFor({ state: 'hidden' })
    await pointerInside(false)
  }
  const headerIs = async visible => mini.waitForFunction(visible => getComputedStyle(document.querySelector('.mini-header')).opacity === (visible ? '1' : '0'), visible)
  const trackIs = async index => {
    await page.waitForFunction(id => window.lxData.musicInfo.id === id, songs[index].id)
    await mini.locator('h1').filter({ hasText: songs[index].name }).waitFor()
    await mini.waitForFunction(() => document.querySelector('.mini-cover img')?.complete && document.querySelector('.mini-cover img')?.naturalWidth > 0)
  }
  const lyricCentered = async(vertical = false) => {
    await mini.waitForFunction(vertical => {
      const viewport = document.querySelector('[data-mini-lyrics]')?.getBoundingClientRect()
      const line = document.querySelector('[data-mini-lyrics] .line-content.active')?.getBoundingClientRect()
      if (!viewport || !line) return false
      return vertical ? Math.abs(line.x + line.width / 2 - viewport.x - viewport.width / 2) < 2
        : Math.abs(line.y + line.height / 2 - viewport.y - viewport.height / 2) < 2
    }, vertical)
  }
  try {
    page.setDefaultTimeout(8000)
    // Synthetic renderer hover must not conflict with the user's actual pointer.
    await app.evaluate(({ screen }) => {
      global.__miniPointer = { x: -10000, y: -10000 }
      screen.getCursorScreenPoint = () => global.__miniPointer
    })
    await page.evaluate(songs => require('electron').ipcRenderer.invoke('player_list_data_overwire', { defaultList: [], loveList: songs, tempList: [], userList: [] }), songs)
    await route(page, '/list?id=love')
    await settled(page)
    await page.locator('[data-song-id="mini-0"] [data-music-cell="index"]').dblclick()
    await page.waitForFunction(() => !window.__lxPluginHost.player.getAudioElement().paused && window.__lxPluginHost.player.getDuration() > 0)
    await update(page, { 'desktopLyric.style.backgroundOpacity': 92 })
    await page.locator('#player').getByRole('button', { name: /开启迷你播放器/ }).click()
    mini = await getMini()

    await t.test('entry opens cover, song, lyrics and usable playback controls', async() => {
      await trackIs(0)
      assert.equal(await mini.locator('.mini-track-info p').textContent(), songs[0].singer)
      assert.equal(await mini.locator('.mini-track-info small').textContent(), 'Evening Tide')
      assert.match(await mini.locator('.mini-cover img').getAttribute('src'), /^data:image\/webp/)
      await mini.waitForFunction(() => Number(document.querySelector('.mini-progress input').max) >= 89)
      await mini.waitForFunction(() => document.querySelector('[data-mini-lyrics]').textContent.includes('晚风轻轻掠过海面'))
      assert.equal(await mini.locator('#background').evaluate(el => Number(getComputedStyle(el).opacity)), 0.92)
      assert.equal(await mini.title(), 'Mini Player - LX-M Music')
      assert.notEqual(await mini.locator('[data-mini-lyrics]').evaluate(el => getComputedStyle(el).webkitMaskImage), 'none', 'lyric edge fading works on Chromium 108 too')
      await lyricCentered()
      await mini.screenshot({ path: path.join(profilePath, 'mini-player.png') })
    })

    await t.test('pause and play affect audio without hiding the player', async() => {
      await (await button('player__pause')).click()
      await page.waitForFunction(() => window.__lxPluginHost.player.getAudioElement().paused)
      await (await button('player__play')).waitFor()
      await update(page, { 'desktopLyric.pauseHide': true })
      await mini.waitForTimeout(300)
      assert.equal(await mini.locator('#container').evaluate(el => getComputedStyle(el).opacity), '1')
      await (await button('player__play')).click()
      await page.waitForFunction(() => !window.__lxPluginHost.player.getAudioElement().paused)
      await (await button('player__pause')).click()
    })

    await t.test('seeking and volume synchronize in both directions, including mute', async() => {
      await mini.locator('.mini-progress input').evaluate(el => {
        el.value = '30'
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await page.waitForFunction(() => Math.abs(window.__lxPluginHost.player.getCurrentTime() - 30) < 1)
      await mini.waitForFunction(() => document.querySelector('.mini-times span').textContent === '00:30')
      await mini.locator('.mini-volume input').evaluate(el => { el.value = '0.27'; el.dispatchEvent(new Event('input', { bubbles: true })) })
      await page.waitForFunction(() => Math.abs(window.__lxPluginHost.player.getAudioElement().volume - 0.27) < 0.001)
      await (await button('mini_player__mute')).click()
      await page.waitForFunction(() => window.__lxPluginHost.player.getAudioElement().muted)
      await (await button('mini_player__unmute')).click()
      await page.waitForFunction(() => !window.__lxPluginHost.player.getAudioElement().muted)
      await page.evaluate(() => { window.app_event.setVolume(0.64); window.app_event.setProgress(17) })
      await mini.waitForFunction(() => document.querySelector('.mini-volume input').value === '0.64' && document.querySelector('.mini-times span').textContent === '00:17')
    })

    await t.test('previous and next use the queue and replace the cover', async() => {
      const firstCover = await mini.locator('.mini-cover img').getAttribute('src')
      await (await button('player__next')).click()
      await trackIs(1)
      await mini.waitForFunction(first => document.querySelector('.mini-cover img')?.src !== first, firstCover)
      await (await button('player__prev')).click()
      await trackIs(0)
      await mini.waitForFunction(first => document.querySelector('.mini-cover img')?.src === first, firstCover)
      await (await button('player__pause')).click()
    })

    await t.test('a seek begun on an old track cannot seek the next song', async() => {
      await mini.locator('.mini-progress input').dispatchEvent('pointerdown')
      await (await button('player__next')).click()
      await trackIs(1)
      await mini.locator('.mini-progress input').evaluate(el => { el.value = '65'; el.dispatchEvent(new Event('change', { bubbles: true })) })
      assert(await page.evaluate(() => window.__lxPluginHost.player.getCurrentTime()) < 10)
      await (await button('player__pause')).click()
    })

    await t.test('lyrics remain readable with hidden options outside in both directions', async() => {
      await update(page, { 'desktopLyric.showPlayer': false, 'desktopLyric.autoHideControls': true, 'desktopLyric.style.backgroundOpacity': 0, 'desktopLyric.pauseHide': true, 'desktopLyric.isHoverHide': true })
      for (const direction of ['horizontal', 'vertical']) {
        await update(page, { 'desktopLyric.direction': direction })
        await mini.mouse.move(-20, -20)
        await headerIs(false)
        await mini.waitForFunction(() => getComputedStyle(document.querySelector('[data-mini-lyrics]')).opacity === '0.7')
        await lyricCentered(direction === 'vertical')
        const effectiveOpacity = await mini.locator('.line-content.active .font-lrc').first().evaluate(el => {
          let opacity = 1
          for (let node = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
          return opacity
        })
        assert(effectiveOpacity >= 0.65, 'paused text must remain readable outside the window')
        assert.equal(await mini.locator('[data-mini-recovery]').evaluate(el => getComputedStyle(el).opacity), '0')
        await mini.screenshot({ path: path.join(profilePath, `mini-player-outside-${direction}.png`), omitBackground: true })
        await page.locator('#player').getByRole('button', { name: await label(page, 'player__play'), exact: true }).click()
        await mini.waitForFunction(() => !document.querySelector('[data-mini-lyrics]').classList.contains('paused') && getComputedStyle(document.querySelector('[data-mini-lyrics]')).opacity === '1')
        assert.equal(await mini.locator('#container').evaluate(el => getComputedStyle(el).opacity), '1')
        await page.locator('#player').getByRole('button', { name: await label(page, 'player__pause'), exact: true }).click()
      }
      await pointerInside(true)
      await mini.locator('[data-mini-recovery]').click()
      await mini.locator('#mini-options').waitFor()
      assert(await mini.evaluate(() => document.querySelector('.mini-window-buttons').getBoundingClientRect().right < document.querySelector('[data-mini-recovery]').getBoundingClientRect().left), 'the corner button must not overlap the close button')
      for (const key of ['mini_player__lyrics_only', 'mini_player__hide_controls', 'mini_player__transparent']) await mini.getByLabel(await label(page, key), { exact: true }).uncheck()
      await closeOptions()
      await update(page, { 'desktopLyric.direction': 'horizontal', 'desktopLyric.isHoverHide': false })
    })

    await t.test('transparent background and hidden controls recover on hover and keyboard focus', async() => {
      await options()
      await mini.getByLabel(await label(page, 'mini_player__transparent'), { exact: true }).check()
      await mini.getByLabel(await label(page, 'mini_player__hide_controls'), { exact: true }).check()
      await closeOptions()
      await mini.mouse.move(-20, -20)
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#background')).opacity === '0' && getComputedStyle(document.querySelector('.mini-header')).opacity === '0')
      if (process.platform === 'win32') assert.notEqual(await nativeHitTest(app, mini, '.mini-brand'), 2, 'an invisible header cannot intercept lyrics as a drag region')
      await mini.screenshot({ path: path.join(profilePath, 'mini-player-transparent.png'), omitBackground: true })
      await mini.mouse.move(80, 45)
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('.mini-header')).opacity === '1')
      await mini.mouse.move(-20, -20)
      await mini.keyboard.press('Tab')
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('.mini-header')).opacity === '1')
    })

    await t.test('lyrics-only controls reveal only at the top or with the keyboard and hide after closing options', async() => {
      await update(page, { 'desktopLyric.pauseHide': false })
      await options()
      await mini.getByLabel(await label(page, 'mini_player__lyrics_only'), { exact: true }).check()
      await closeOptions()
      assert.equal(await mini.locator('[data-mini-track]').count(), 0)
      await mini.locator('[data-mini-lyrics]').hover()
      await headerIs(false)
      if (process.platform === 'win32') assert.notEqual(await nativeHitTest(app, mini, '.mini-brand'), 2, 'hovering lyrics must not activate a hidden drag region')
      await lyricCentered()
      await mini.screenshot({ path: path.join(profilePath, 'mini-player-lyrics-only.png'), omitBackground: true })
      await mini.mouse.move(80, 20)
      await headerIs(true)
      if (process.platform === 'win32') assert.equal(await nativeHitTest(app, mini, '.mini-brand'), 2, 'the revealed header remains draggable')
      await mini.locator('[data-mini-lyrics]').hover()
      await headerIs(false)
      await options()
      await mini.locator('#mini-options label').first().hover()
      await headerIs(true)
      await closeOptions()
      await mini.locator('[data-mini-lyrics]').hover()
      await headerIs(false)
      // The lyrics-only options button is deliberately unavailable outside.
      // Bring the system pointer inside before exercising its keyboard access.
      await pointerInside(true)
      await mini.waitForFunction(() => document.querySelector('[data-mini-recovery]').classList.contains('native-window-hover'))
      await mini.keyboard.press('Tab')
      await headerIs(true)
      await (await button('mini_player__options')).focus()
      await mini.keyboard.press('Enter')
      await mini.locator('#mini-options').waitFor()
      await mini.keyboard.press('Escape')
      await mini.locator('#mini-options').waitFor({ state: 'hidden' })
      assert(await (await button('mini_player__options')).evaluate(el => el === document.activeElement), 'Escape restores keyboard focus to the options button')
      await headerIs(true)
      await mini.locator('[data-mini-lyrics]').click()
      await headerIs(false)
      await update(page, { 'desktopLyric.direction': 'vertical' })
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('[data-mini-lyrics] > div')).writingMode === 'vertical-rl')
      await lyricCentered(true)
      await update(page, { 'desktopLyric.direction': 'horizontal' })
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('[data-mini-lyrics] > div')).writingMode !== 'vertical-rl')
      await lyricCentered()
      await update(page, { 'desktopLyric.autoHideControls': false })
      await mini.waitForFunction(() => !document.querySelector('.mini-player').classList.contains('auto-hide-controls'))
      await mini.locator('[data-mini-lyrics]').hover()
      await headerIs(false)
      await options()
      await mini.getByLabel(await label(page, 'mini_player__lyrics_only'), { exact: true }).uncheck()
      await mini.getByLabel(await label(page, 'mini_player__transparent'), { exact: true }).uncheck()
      await mini.getByLabel(await label(page, 'mini_player__hide_controls'), { exact: true }).uncheck()
      await closeOptions()
      await mini.locator('[data-mini-track]').waitFor()
      await lyricCentered()
    })

    await t.test('small and large windows keep controls visible and window dragging is saved', async() => {
      const window = await app.browserWindow(mini)
      try {
        for (const [width, height] of [[280, 180], [360, 240], [600, 430]]) {
          await window.evaluate((window, size) => window.setContentSize(...size), [width, height])
          await mini.waitForTimeout(250)
          const outside = await mini.locator('button:visible, .mini-progress input, .mini-volume input').evaluateAll(elements => elements.filter(el => {
            const rect = el.getBoundingClientRect()
            return rect.x < -1 || rect.y < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1
          }).map(el => el.outerHTML))
          assert.deepEqual(outside, [], `${width}x${height}`)
          await lyricCentered()
        }
        await window.evaluate(window => window.setBounds({ x: 140, y: 140, width: 450, height: 300 }))
        const original = await window.evaluate(window => window.getBounds())
        const movement = await dragWindow(app, mini, '.mini-brand', { stallRenderer: true })
        if (movement) {
          assert.equal(movement.x, movement.expectedX, 'native dragging follows the pointer even while the renderer is busy')
          assert.equal(movement.y, movement.expectedY)
        }
        await mini.waitForTimeout(700)
        const moved = await window.evaluate(window => window.getBounds())
        assert(moved.x !== original.x || moved.y !== original.y)
        const saved = await page.evaluate(() => [window.lxData.appSetting['desktopLyric.x'], window.lxData.appSetting['desktopLyric.y']])
        assert.deepEqual(saved, [moved.x, moved.y])
      } finally { await window.dispose() }
    })

    await t.test('native cover dragging keeps buttons, sliders and the options panel interactive', { skip: process.platform !== 'win32' }, async() => {
      // Whole physical pixels at common 125/150/175% scales avoid comparing
      // Electron 22's enclosing DIP rounding with fractional pointer pixels.
      const movement = await dragWindow(app, mini, '.mini-cover', { dx: 40, dy: 20 })
      assert.equal(movement.x, 40)
      assert.equal(movement.y, 20)
      assert.deepEqual([movement.width, movement.height], [movement.expectedWidth, movement.expectedHeight], 'dragging must not resize the window')
      assert.equal(await nativeHitTest(app, mini, '.mini-window-buttons button'), 1)
      assert.equal(await nativeHitTest(app, mini, '.mini-progress input'), 1)
      await options()
      assert.equal(await nativeHitTest(app, mini, '#mini-options label'), 1, 'the options overlay must take priority over the cover drag region')
      await closeOptions()
    })

    await t.test('lyric margins drag natively in both layouts while text scrolls and locking stops movement', { skip: process.platform !== 'win32' }, async() => {
      const window = await app.browserWindow(mini)
      const keys = ['desktopLyric.showPlayer', 'desktopLyric.direction', 'desktopLyric.autoHideControls', 'desktopLyric.pauseHide', 'desktopLyric.isHoverHide']
      const previous = await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, window.lxData.appSetting[key]])), keys)
      const original = await window.evaluate(window => window.getBounds())
      const songId = await page.evaluate(() => window.lxData.musicInfo.id)
      try {
        if (!await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().paused)) await (await button('player__pause')).click()
        await page.waitForFunction(() => window.__lxPluginHost.player.getAudioElement().paused)
        await update(page, { 'desktopLyric.pauseHide': false, 'desktopLyric.isHoverHide': false, 'desktopLyric.autoHideControls': true })
        await window.evaluate(window => window.setBounds({ x: 120, y: 120, width: 600, height: 430 }))
        for (const showPlayer of [true, false]) {
          for (const direction of ['horizontal', 'vertical']) {
            await update(page, { 'desktopLyric.showPlayer': showPlayer, 'desktopLyric.direction': direction })
            await mini.waitForFunction(({ showPlayer, direction }) => {
              const lyrics = document.querySelector('[data-mini-lyrics]')
              return lyrics.classList.contains('with-player') === showPlayer && lyrics.classList.contains('vertical') === (direction === 'vertical')
            }, { showPlayer, direction })
            await lyricCentered(direction === 'vertical')
            const rect = await mini.locator('[data-mini-lyrics]').boundingBox()
            for (const x of [12, rect.width - 12]) {
              const position = { x, y: rect.height / 2 }
              const movement = await dragWindow(app, mini, '[data-mini-lyrics]', { dx: x === 12 ? 30 : -30, dy: 0, position, stallRenderer: showPlayer && direction === 'horizontal' && x === 12 })
              assert.equal(movement.x, movement.expectedX, `${direction}, player=${showPlayer}: blank margin movement follows the pointer exactly`)
              assert.equal(movement.y, 0)
              assert.deepEqual([movement.width, movement.height], [movement.expectedWidth, movement.expectedHeight])
            }
            const text = '[data-mini-lyrics] .line-content.active .font-lrc'
            assert.equal(await nativeHitTest(app, mini, text), 1, 'lyric text remains available for scrolling')
            const before = await window.evaluate(window => window.getBounds())
            const scrollBefore = await mini.locator('[data-mini-lyrics] > div').evaluate(el => [el.scrollLeft, el.scrollTop])
            const line = await mini.locator(text).first().boundingBox()
            await mini.mouse.move(line.x + line.width / 2, line.y + line.height / 2)
            await mini.mouse.down()
            await mini.mouse.move(line.x + line.width / 2 + (direction === 'vertical' ? 25 : 0), line.y + line.height / 2 + (direction === 'horizontal' ? -25 : 0), { steps: 5 })
            await mini.mouse.up()
            const scrollAfter = await mini.locator('[data-mini-lyrics] > div').evaluate(el => [el.scrollLeft, el.scrollTop])
            const axis = direction === 'vertical' ? 0 : 1
            assert(Math.abs(scrollAfter[axis] - scrollBefore[axis]) >= 20, `${direction}: dragging text scrolls lyrics`)
            await mini.mouse.move(12, 80)
            assert.deepEqual(await window.evaluate(window => window.getBounds()), before, 'text dragging and mouse movement after release cannot move the window')
          }
        }
        await options()
        assert.equal(await nativeHitTest(app, mini, '#mini-options label:last-of-type'), 1, 'the options overlay excludes the lyric drag region')
        assert.equal(await nativeHitTest(app, mini, '.mini-font-buttons button'), 1, 'controls over the lyric margins remain clickable')
        await closeOptions()
        await update(page, { 'desktopLyric.isLock': true })
        await mini.waitForFunction(() => !document.querySelector('[data-mini-lyrics]').classList.contains('native-lyric-drag'))
        assert.notEqual(await nativeHitTest(app, mini, '[data-mini-lyrics]', { x: 12, y: 100 }), 2, 'locked lyric margins are not native drag regions')
        assert.deepEqual(await page.evaluate(() => ({ id: window.lxData.musicInfo.id, paused: window.__lxPluginHost.player.getAudioElement().paused })), { id: songId, paused: true }, 'window and lyric gestures cannot change the song or resume playback')
      } finally {
        await update(page, { ...previous, 'desktopLyric.isLock': false })
        await window.evaluate((window, original) => window.setBounds(original), original)
        await mini.waitForTimeout(650)
        await window.dispose()
      }
    })

    await t.test('sliding the title bar along every screen edge preserves its size at the current display scale', { skip: process.platform !== 'win32' }, async() => {
      const window = await app.browserWindow(mini)
      try {
        await update(page, { 'desktopLyric.isLockScreen': true })
        await mini.waitForTimeout(650)
        const results = await window.evaluate(async window => {
          const area = global.envParams.workAreaSize
          const expected = { width: global.lx.appSetting['desktopLyric.width'], height: global.lx.appSetting['desktopLyric.height'] }
          const samples = []
          for (const edge of ['left', 'right', 'top', 'bottom']) {
            for (let i = 0; i < 40; i++) {
              const target = { ...window.getBounds(), x: 100 + i, y: 100 + i }
              if (edge === 'left') target.x = -20
              if (edge === 'right') target.x = area.width + 20
              if (edge === 'top') target.y = -20
              if (edge === 'bottom') target.y = area.height + 20
              let prevented = false
              window.emit('will-move', { preventDefault() { prevented = true } }, target)
              // Let ordinary resize/move events and debounced settings writes run.
              await new Promise(resolve => setTimeout(resolve, i === 20 ? 600 : 12))
              samples.push({ edge, prevented, ...window.getBounds() })
            }
            await new Promise(resolve => setTimeout(resolve, 600))
            samples.push({ edge, saved: true, width: global.lx.appSetting['desktopLyric.width'], height: global.lx.appSetting['desktopLyric.height'] })
          }
          return { expected, samples, rounding: process.versions.electron.startsWith('22.') ? 2 : 1 }
        })
        for (const sample of results.samples) {
          if (sample.saved) {
            assert.equal(sample.width, results.expected.width, `${sample.edge}: dragging must not save a different width`)
            assert.equal(sample.height, results.expected.height, `${sample.edge}: dragging must not save a different height`)
          } else {
            assert(sample.prevented)
            // Electron 22 rounds both corners when reporting fractional-DPI
            // bounds (up to 2 DIP); neither version may accumulate or save it.
            assert(Math.abs(sample.width - results.expected.width) <= results.rounding, JSON.stringify(sample))
            assert(Math.abs(sample.height - results.expected.height) <= results.rounding, JSON.stringify(sample))
          }
        }
      } finally { await window.dispose() }
    })

    await t.test('native movement respects screen limits and locking without snapping back', { skip: process.platform !== 'win32' }, async() => {
      const window = await app.browserWindow(mini)
      const move = async(x, y) => window.evaluate((window, { x, y }) => {
        const target = { ...window.getBounds(), x, y }
        let prevented = false
        window.emit('will-move', { preventDefault() { prevented = true } }, target)
        if (!prevented) window.setPosition(target.x, target.y)
        return { prevented, bounds: window.getBounds() }
      }, { x, y })
      try {
        await update(page, { 'desktopLyric.isLockScreen': true })
        await mini.waitForTimeout(900)
        let result = await move(-80, -60)
        assert.equal(result.prevented, true)
        assert.deepEqual([result.bounds.x, result.bounds.y], [0, 0])
        await mini.waitForTimeout(900)
        assert.deepEqual(await page.evaluate(() => [window.lxData.appSetting['desktopLyric.x'], window.lxData.appSetting['desktopLyric.y']]), [0, 0])
        await update(page, { 'desktopLyric.isLockScreen': false })
        await mini.waitForTimeout(100)
        result = await move(-40, 20)
        assert.equal(result.prevented, false)
        await mini.waitForTimeout(900)
        assert.deepEqual(await window.evaluate(window => [window.getBounds().x, window.getBounds().y]), [-40, 20])
        await update(page, { 'desktopLyric.isLock': true })
        await mini.waitForFunction(() => document.querySelector('#container').classList.contains('lock'))
        result = await move(100, 100)
        assert.equal(result.prevented, true)
        assert.deepEqual([result.bounds.x, result.bounds.y], [-40, 20])
        assert.notEqual(await nativeHitTest(app, mini, '.mini-cover'), 2)
      } finally {
        await update(page, { 'desktopLyric.isLock': false, 'desktopLyric.isLockScreen': true })
        await mini.waitForFunction(() => !document.querySelector('#container').classList.contains('lock'))
        await move(140, 140)
        await window.dispose()
      }
    })

    await t.test('releasing resized edges keeps their final dimensions, including after reopening', { skip: process.platform !== 'win32' }, async() => {
      const states = [
        ['top-left', { x: 200, y: 200, width: 490, height: 340 }],
        ['bottom-right', { x: 200, y: 200, width: 600, height: 400 }],
        ['top', { x: 200, y: 220, width: 600, height: 380 }],
        ['left', { x: 220, y: 220, width: 580, height: 380 }],
      ]
      for (const [edge, bounds] of states) {
        assert.deepEqual(await resizeWindow(app, mini, bounds, edge), bounds)
        await page.waitForFunction(bounds => ['x', 'y', 'width', 'height'].every(key => window.lxData.appSetting[`desktopLyric.${key}`] === bounds[key]), bounds)
        await mini.waitForTimeout(1000)
        const window = await app.browserWindow(mini)
        try { assert.deepEqual(await window.evaluate(window => window.getBounds()), bounds, `${edge} must not snap back after release`) } finally { await window.dispose() }
      }
      const closed = mini.waitForEvent('close')
      await update(page, { 'desktopLyric.enable': false })
      await closed
      await update(page, { 'desktopLyric.enable': true })
      mini = await getMini()
      const window = await app.browserWindow(mini)
      try { assert.deepEqual(await window.evaluate(window => window.getBounds()), states.at(-1)[1]) } finally { await window.dispose() }
    })

    await t.test('pin, lock, unlock, return to main and close use the existing entry', async() => {
      const songId = await page.evaluate(() => window.lxData.musicInfo.id)
      const songIndex = songs.findIndex(song => song.id === songId)
      assert.notEqual(songIndex, -1)
      await (await button('mini_player__pin')).click()
      // The native window updates after the setting has been durably saved.
      await page.waitForFunction(() => window.lxData.appSetting['desktopLyric.isAlwaysOnTop'])
      const window = await app.browserWindow(mini)
      assert.equal(await window.evaluate(window => window.isAlwaysOnTop()), true)
      await options()
      await (await button('desktop_lyric__lock')).click()
      await mini.waitForFunction(() => document.querySelector('#container').classList.contains('lock'))
      await page.locator('#player').getByRole('button', { name: /关闭迷你播放器/ }).click({ button: 'right' })
      await mini.waitForFunction(() => !document.querySelector('#container').classList.contains('lock'))
      await (await button('mini_player__show_main')).click()
      const mainWindow = await app.browserWindow(page)
      assert.equal(await mainWindow.evaluate(window => window.isVisible()), true)
      await mainWindow.dispose()
      await window.dispose()
      const closed = mini.waitForEvent('close')
      await mini.locator('.mini-window-buttons').getByRole('button', { name: await label(page, 'desktop_lyric__close'), exact: true }).click()
      await closed
      await page.waitForFunction(() => !window.lxData.appSetting['desktopLyric.enable'])
      await page.locator('#player').getByRole('button', { name: /开启迷你播放器/ }).click()
      mini = await getMini()
      await trackIs(songIndex)
    })

    await t.test('hidden and locked controls can be unlocked locally, including lyrics-only, hover-hide and reopening', async() => {
      // Coordinate the native hit region with renderer input without moving the user's pointer.
      await app.evaluate(({ screen }) => {
        global.__miniLockPoint = { x: -10000, y: -10000 }
        global.__miniLockGetCursor = screen.getCursorScreenPoint
        screen.getCursorScreenPoint = () => global.__miniLockPoint
      })
      const move = async(x, y) => {
        const window = await app.browserWindow(mini)
        let bounds
        try { bounds = await window.evaluate(window => window.getContentBounds()) } finally { await window.dispose() }
        await app.evaluate(async(_, point) => {
          global.__miniLockPoint = point
          // Apply the native hit-region update before synthetic renderer input.
          await new Promise(resolve => setTimeout(resolve, 150))
        }, { x: bounds.x + x, y: bounds.y + y })
        await mini.mouse.move(x, y)
        await mini.waitForTimeout(200)
      }
      const revealUnlock = async() => {
        const rect = await mini.locator('[data-mini-unlock]').boundingBox()
        assert(rect)
        await move(rect.x + rect.width / 2, rect.y + rect.height / 2)
        await mini.waitForFunction(() => getComputedStyle(document.querySelector('[data-mini-unlock]')).opacity === '1').catch(async error => {
          console.error('Unlock hover state:', await mini.evaluate(() => {
            const el = document.querySelector('[data-mini-unlock]')
            const rect = el.getBoundingClientRect()
            return { opacity: getComputedStyle(el).opacity, rect: rect.toJSON(), target: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.outerHTML, hovered: Array.from(document.querySelectorAll(':hover')).map(el => el.id || el.className), size: [innerWidth, innerHeight] }
          }))
          throw error
        })
        assert.equal(await mini.locator('[data-mini-unlock]').evaluate(el => !!el.closest('#container')), false, 'the unlock button must not inherit lyric fading')
      }
      const lock = async() => {
        await options()
        await (await button('desktop_lyric__lock')).click()
        await mini.waitForFunction(() => document.querySelector('#container').classList.contains('lock'))
      }
      const unlock = async() => {
        await (await button('desktop_lyric__unlock')).click()
        await mini.waitForFunction(() => !document.querySelector('#container').classList.contains('lock'))
        await page.waitForFunction(() => !window.lxData.appSetting['desktopLyric.isLock'])
      }
      try {
        for (const showPlayer of [true, false]) {
          for (const hoverHide of [false, true]) {
            await update(page, { 'desktopLyric.showPlayer': showPlayer, 'desktopLyric.autoHideControls': true, 'desktopLyric.style.backgroundOpacity': 0, 'desktopLyric.isHoverHide': hoverHide })
            await lock()
            await move(120, 100)
            await mini.waitForFunction(() => getComputedStyle(document.querySelector('[data-mini-unlock]')).opacity === '0.85')
            assert.equal(await mini.locator('.mini-header').evaluate(el => getComputedStyle(el).visibility), 'hidden')
            if (process.platform === 'win32' && hoverHide) assert.equal(await nativeIgnoresMouse(app, mini), true, 'locked lyrics stay click-through')
            await revealUnlock()
            if (hoverHide) await mini.waitForFunction(() => Number(getComputedStyle(document.querySelector('#container')).opacity) <= 0.05)
            if (process.platform === 'win32' && hoverHide) assert.equal(await nativeIgnoresMouse(app, mini), false, 'the actual Windows window accepts clicks over the unlock button')
            await mini.screenshot({ path: path.join(profilePath, `mini-player-lock-${showPlayer}-${hoverHide}.png`), omitBackground: true })
            await unlock()
          }
        }
        await lock()
        const closed = mini.waitForEvent('close')
        await update(page, { 'desktopLyric.enable': false })
        await closed
        await update(page, { 'desktopLyric.enable': true })
        mini = await getMini()
        await mini.locator('[data-mini-unlock]').waitFor()
        await move(120, 100)
        await revealUnlock()
        if (process.platform === 'win32') assert.equal(await nativeIgnoresMouse(app, mini), false, 'reopening a saved locked window keeps recovery usable')
        await unlock()
        await update(page, { 'desktopLyric.showPlayer': true })
        await mini.locator('[data-mini-track]').waitFor()
        await mini.mouse.move(80, 20)
        await headerIs(true)
        // Screen-lock boundary checks above can leave the reopened window at
        // an edge. Start inside the screen to test unlocking, not clamping.
        await update(page, { 'desktopLyric.x': 140, 'desktopLyric.y': 140, 'desktopLyric.width': 450, 'desktopLyric.height': 300 })
        await mini.waitForTimeout(650)
        const movement = await dragWindow(app, mini, '.mini-brand', { dx: -20, dy: -20 })
        if (movement) assert.equal(movement.x, -20, 'unlocking restores native dragging')
        await options()
        await closeOptions()
      } finally {
        await app.evaluate(({ screen }) => {
          screen.getCursorScreenPoint = global.__miniLockGetCursor
          delete global.__miniLockGetCursor
          delete global.__miniLockPoint
        })
        await update(page, { 'desktopLyric.isLock': false, 'desktopLyric.showPlayer': true, 'desktopLyric.isHoverHide': false })
      }
    })

    await t.test('appearance persists after an application restart and settings use the new name', async() => {
      await options()
      await mini.getByLabel(await label(page, 'mini_player__transparent'), { exact: true }).check()
      await mini.getByLabel(await label(page, 'mini_player__hide_controls'), { exact: true }).check()
      await closeOptions()
      await page.waitForFunction(() => window.lxData.appSetting['desktopLyric.autoHideControls'] && window.lxData.appSetting['desktopLyric.style.backgroundOpacity'] === 0)
      await route(page, '/setting')
      await page.locator('[data-setting-tab="SettingDesktopLyric"]').click()
      await page.locator('#setting_mini_player_show_player').waitFor({ state: 'attached' })
      assert.match(await page.locator('#desktop_lyric').textContent(), /迷你播放器/)
      assert.deepEqual(fixture.errors, [])
      await app.close()
      fixture = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') })
      app = fixture.app; page = fixture.page
      mini = await getMini()
      await mini.waitForFunction(() => getComputedStyle(document.querySelector('#background')).opacity === '0' && document.querySelector('.mini-player').classList.contains('auto-hide-controls'))
      assert.equal(await mini.locator('[data-mini-track]').count(), 1)
    })
    assert.deepEqual(errors, [])
    assert.deepEqual(fixture.errors, [])
    console.log('Mini player screenshots:', profilePath)
  } finally {
    await app.close()
  }
})
