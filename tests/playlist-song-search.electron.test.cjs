const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const rendererPath = path.resolve('dist/index.html')
const output = path.resolve('output/playwright/playlist-song-search')
const invoke = (page, channel, params) => page.evaluate(({ channel, params }) => require('electron').ipcRenderer.invoke(channel, params), { channel, params })
const readIds = async(page, id = 'search') => (await invoke(page, 'player_list_music_get', id)).map(song => song.id)

test('playlist search filters songs and preserves real song actions, selection and saved positions', { timeout: 180000 }, async t => {
  const fixture = await launch({ rendererPath })
  const { app, page } = fixture
  await fs.mkdir(output, { recursive: true })
  const audio = path.join(fixture.output, 'silence.wav')
  const wav = Buffer.alloc(44 + 8000 * 2 * 60)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40)
  await fs.writeFile(audio, wav)
  const song = (id, name, singer, albumName = '') => ({ id, name, singer, source: 'local', interval: '01:00', meta: { filePath: audio, ext: 'wav', albumName, picUrl: '' } })
  const songs = [
    song('first', '晨光', '林间', '清晨'),
    song('title', 'Echo', 'Alice', '北岸'),
    song('artist', '海风', 'Echo', '远行'),
    song('album', '夜行', 'Bob', 'Echo'),
    song('title-two', 'echo live', 'Alice', '合辑'),
    song('literal', '[a+b] & 晚风', '测试歌手'),
  ]
  const bar = page.locator('#my-list [data-playlist-search]')
  const input = bar.locator('input')
  const scope = bar.getByRole('combobox')
  const rows = page.locator('#my-list [data-song-id]')
  const row = id => page.locator(`#my-list [data-song-id="${id}"]`)
  const viewport = page.locator('#my-list .music-column-scroll')
  const label = key => page.evaluate(key => window.i18n.t(key), key)
  const visible = async expected => {
    await page.waitForFunction(expected => {
      const state = window.__motionComponents().find(c => c.type.name === 'MusicList' && c.props.listId === 'search')?.setupState
      return state && JSON.stringify(state.visibleList.map(song => song.id)) === JSON.stringify(expected)
    }, expected)
    await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('#my-list [data-song-id]')].map(row => row.dataset.songId)) === JSON.stringify(expected), expected)
    assert.deepEqual(await rows.evaluateAll(rows => rows.map(row => row.dataset.songId)), expected)
  }
  const selectScope = async(field, keyboard = false) => {
    if (keyboard) { await scope.focus(); await scope.press('Enter') } else await scope.click()
    const option = bar.locator('.selection-list').getByText(await label(`list__search_field_${field}`), { exact: true })
    if (keyboard) await option.press('Enter'); else await option.click()
    await page.waitForFunction(() => document.querySelector('[data-playlist-search] [role="combobox"]')?.getAttribute('aria-expanded') === 'false')
    await bar.locator('.selection-list').waitFor({ state: 'hidden' })
  }
  const reset = async(buttons = true, tracks = songs) => {
    await page.mouse.up()
    await page.keyboard.press('Escape')
    await route(page, '/list?id=other')
    await settled(page)
    await page.evaluate(buttons => window.lxData.updateSetting({
      'common.langId': 'zh-cn', 'list.actionButtonsVisible': buttons, 'list.isSaveScrollLocation': true,
      'ui.ambientBackground': false, 'theme.id': 'green', 'common.fontSize': 16,
    }), buttons)
    await invoke(page, 'player_list_data_overwire', {
      defaultList: songs, loveList: [], tempList: [],
      userList: [
        { id: 'search', name: '搜索测试歌单', locationUpdateTime: null, list: tracks },
        { id: 'other', name: '另一个歌单', locationUpdateTime: null, list: [songs[0]] },
      ],
    })
    await route(page, '/list?id=search')
    await settled(page)
    await input.waitFor()
    await page.waitForFunction(length => window.__motionComponents().find(c => c.type.name === 'MusicList' && c.props.listId === 'search')?.setupState.list.length === length, tracks.length)
    await input.fill('')
    await viewport.evaluate(el => { el.scrollTop = 0 })
    await page.waitForTimeout(200)
  }
  const selected = () => page.evaluate(() => window.__motionComponents().find(c => c.type.name === 'MusicList' && c.props.listId === 'search').setupState.selectedList.map(song => song.id))
  const contextAction = async(id, action) => {
    await row(id).locator('[data-music-cell="index"]').click({ button: 'right' })
    await page.getByRole('tab', { name: await label(action), exact: true }).click()
  }

  try {
    page.setDefaultTimeout(7000)
    await t.test('permanent search defaults to all; each scope filters only its matching songs', async() => {
      await reset()
      assert.equal((await scope.textContent()).trim(), '全部')
      await input.fill('  ＥＣＨＯ  ')
      await visible(['title', 'artist', 'album', 'title-two'])
      assert.deepEqual(await rows.locator('[data-music-cell="index"] .num').allTextContents(), ['2', '3', '4', '5'])
      await page.screenshot({ path: path.join(output, 'normal.png'), animations: 'disabled' })
      for (const [field, expected] of [['name', ['title', 'title-two']], ['singer', ['artist']], ['album', ['album']], ['all', ['title', 'artist', 'album', 'title-two']]]) {
        await selectScope(field)
        await visible(expected)
      }
      await scope.click()
      await page.screenshot({ path: path.join(output, 'scope-open.png'), animations: 'disabled' })
      await scope.press('Escape')
      assert.equal(await input.inputValue(), '  ＥＣＨＯ  ')
      assert.equal(await scope.getAttribute('aria-expanded'), 'false')
    })

    await t.test('empty results, clearing and literal queries keep the original playlist intact', async() => {
      await input.fill('no-such-song-98765')
      await visible([])
      await page.getByText(await label('list__search_no_result'), { exact: true }).waitFor()
      await page.screenshot({ path: path.join(output, 'empty.png'), animations: 'disabled' })
      await input.press('Escape')
      await visible(songs.map(song => song.id))
      assert.equal(await input.evaluate(el => el === document.activeElement), true)
      await input.fill('[a+b]')
      await visible(['literal'])
      await bar.getByRole('button', { name: await label('list__search_clear'), exact: true }).click()
      await visible(songs.map(song => song.id))
      assert.deepEqual(await readIds(page), songs.map(song => song.id))
    })

    await t.test('keyboard focus, dropdown selection and input Ctrl+A work without selecting songs', async() => {
      await viewport.focus()
      await page.keyboard.press('Control+f')
      assert.equal(await input.evaluate(el => el === document.activeElement), true)
      await input.fill('Echo')
      await input.press('Control+a')
      assert.deepEqual(await selected(), [])
      assert.equal(await input.evaluate(el => el.selectionEnd - el.selectionStart), 4)
      await selectScope('singer', true)
      await visible(['artist'])
      await selectScope('all', true)
      await visible(['title', 'artist', 'album', 'title-two'])
      await input.press('Escape')
    })

    await t.test('composition waits for the final Chinese text before filtering', async() => {
      await input.evaluate(el => {
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        el.value = 'hai'
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'hai', isComposing: true }))
      })
      await visible(songs.map(song => song.id))
      await input.evaluate(el => {
        el.value = '海风'
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '海风' }))
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: '海风' }))
      })
      await visible(['artist'])
      await input.press('Escape')
    })

    for (const buttons of [true, false]) {
      await t.test(`filtered playback and context removal target source songs (buttons: ${buttons})`, async() => {
        await reset(buttons)
        await input.fill('Echo')
        await selectScope('album')
        await visible(['album'])
        if (buttons) await row('album').getByRole('button', { name: await label('list__play'), exact: true }).click()
        else await row('album').locator('[data-music-cell="name"]').dblclick()
        await page.waitForFunction(() => window.lxData.playMusicInfo.musicInfo?.id === 'album')
        assert.equal(await row('album').locator('.playing-equalizer').count(), 1)
        await contextAction('album', 'list__remove')
        await visible([])
        assert.deepEqual(await readIds(page), songs.filter(song => song.id !== 'album').map(song => song.id))
      })
    }

    await t.test('adding a filtered row persists the exact song in favorites', async() => {
      await reset()
      await input.fill('Echo')
      await selectScope('album')
      await visible(['album'])
      await row('album').getByRole('button', { name: await label('list__add_to'), exact: true }).click()
      const destination = page.getByRole('button', { name: '把该歌曲添加到「我的收藏」', exact: true })
      await destination.click()
      await destination.waitFor({ state: 'hidden' })
      assert.deepEqual(await readIds(page, 'love'), ['album'])
      assert.deepEqual(await readIds(page), songs.map(song => song.id))
    })

    await t.test('bulk selection includes only results, and filtering clears hidden selections', async() => {
      await invoke(page, 'player_list_music_remove', { listId: 'default', ids: songs.map(song => song.id) })
      await input.press('Escape')
      await row('first').locator('[data-music-cell="index"]').click({ modifiers: ['Control'] })
      assert.deepEqual(await selected(), ['first'])
      await input.fill('Echo')
      await selectScope('all')
      await visible(['title', 'artist', 'album', 'title-two'])
      assert.deepEqual(await selected(), [])
      await row('title').locator('[data-music-cell="index"]').click({ modifiers: ['Control'] })
      await row('album').locator('[data-music-cell="index"]').click({ modifiers: ['Shift'] })
      assert.deepEqual(await selected(), ['title', 'artist', 'album'])
      await viewport.focus()
      await page.keyboard.press('Control+a')
      assert.deepEqual(await selected(), ['title', 'artist', 'album', 'title-two'])
      await contextAction('title', 'list__add_to')
      const destination = page.getByRole('button', { name: '把这些歌曲添加到「试听列表」', exact: true })
      await destination.click()
      await destination.waitFor({ state: 'hidden' })
      assert.deepEqual(await selected(), [])
      assert.deepEqual((await readIds(page, 'default')).sort(), ['title', 'artist', 'album', 'title-two'].sort())
      await viewport.focus()
      await page.keyboard.press('Control+a')
      await contextAction('title', 'list__remove')
      await page.getByRole('button', { name: await label('lists__remove_tip_button'), exact: true }).click()
      await visible([])
      assert.deepEqual(await readIds(page), ['first', 'literal'])
    })

    await t.test('filter changes hide stale menus, refresh with list changes and disable drag sorting', async() => {
      await reset()
      await input.fill('Echo')
      await visible(['title', 'artist', 'album', 'title-two'])
      await row('album').locator('[data-music-cell="index"]').click({ button: 'right' })
      await page.getByRole('tab', { name: await label('list__remove'), exact: true }).waitFor()
      await input.fill('Alice')
      await visible(['title', 'title-two'])
      assert.equal(await page.locator('[role="toolbar"][aria-hidden="false"]').count(), 0)
      await invoke(page, 'player_list_music_add', { id: 'search', musicInfos: [song('new-match', 'New', 'Alice', '更新专辑')], addMusicLocationType: 'bottom' })
      await visible(['title', 'title-two', 'new-match'])
      const box = await row('title-two').locator('[data-music-cell="index"]').boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(600)
      assert.equal(await page.locator('[data-song-drag-preview]').count(), 0)
      await page.mouse.up()
      assert.deepEqual(await readIds(page), [...songs.map(song => song.id), 'new-match'])
    })

    await t.test('filtered scrolling does not overwrite the saved full-list position, and changing playlists clears search', async() => {
      const large = [...songs, ...Array.from({ length: 180 }, (_, n) => song(`extra-${n}`, `歌曲 ${n}`, '其他歌手', '其他专辑'))]
      await reset(true, large)
      await viewport.evaluate(el => { el.scrollTop = 900 })
      await page.waitForTimeout(250)
      await input.fill('Echo')
      await visible(['title', 'artist', 'album', 'title-two'])
      assert.equal(await viewport.evaluate(el => el.scrollTop), 0)
      await route(page, '/list?id=other')
      await settled(page)
      assert.equal(await input.inputValue(), '')
      await route(page, '/list?id=search')
      await settled(page)
      await page.waitForFunction(() => document.querySelector('#my-list .music-column-scroll')?.scrollTop >= 800)
      assert.equal(await input.inputValue(), '')
      await route(page, '/list?id=default')
      await settled(page)
      assert.equal(await input.isVisible(), true)
      await input.fill('Echo')
      await page.waitForFunction(() => window.__motionComponents().find(c => c.type.name === 'MusicList' && c.props.listId === 'default')?.setupState.visibleList.length === 4)
    })

    await t.test('normal, narrow, dark and translated search controls remain usable', async() => {
      await reset()
      await input.fill('Echo')
      const window = await app.browserWindow(page)
      const bounds = await window.evaluate(window => window.getBounds())
      try {
        await window.evaluate(window => window.setSize(850, 600))
        await page.evaluate(() => window.lxData.updateSetting({ 'common.fontSize': 19 }))
        await scope.click()
        const metrics = await bar.evaluate(el => {
          const bar = el.getBoundingClientRect(), input = el.querySelector('input').getBoundingClientRect(), scope = el.querySelector('[role="combobox"]').getBoundingClientRect(), list = el.querySelector('.selection-list').getBoundingClientRect()
          return { bar: { left: bar.left, right: bar.right }, input: { width: input.width, right: input.right }, scope: { left: scope.left, right: scope.right }, list: { left: list.left, right: list.right }, width: innerWidth }
        })
        assert(metrics.input.width > 100)
        assert(metrics.input.right < metrics.scope.left)
        assert(metrics.bar.right <= metrics.width + 1)
        assert(metrics.list.left >= metrics.bar.left && metrics.list.right <= metrics.width + 1)
        await page.mouse.move(120, 70)
        await page.screenshot({ path: path.join(output, 'narrow.png'), animations: 'disabled' })
        await scope.press('Escape')
        const lightInputBackground = await input.evaluate(el => getComputedStyle(el).backgroundColor)
        await page.evaluate(() => window.lxData.updateSetting({ 'theme.id': 'black' }))
        await page.waitForFunction(light => getComputedStyle(document.querySelector('[data-playlist-search] input')).backgroundColor !== light, lightInputBackground)
        await scope.click()
        await page.mouse.move(120, 70)
        await page.screenshot({ path: path.join(output, 'dark.png'), animations: 'disabled' })
        await scope.press('Escape')
        await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'en-us' }))
        await page.waitForFunction(() => document.querySelector('[data-playlist-search] input')?.placeholder === 'Search this playlist')
      assert.equal((await scope.textContent()).trim(), 'All')
        await selectScope('album')
        await visible(['album'])
        await page.screenshot({ path: path.join(output, 'english.png'), animations: 'disabled' })
      } finally { await window.evaluate((window, bounds) => window.setBounds(bounds), bounds); await window.dispose() }
    })
    assert.deepEqual(fixture.errors, [])
    console.log('Playlist search screenshots:', output)
  } finally { await app.close() }
})
