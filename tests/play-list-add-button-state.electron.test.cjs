const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, settled, showDetail } = require('./helpers/motion-fixture.cjs')

const rendererPath = path.resolve('dist/index.html')
const invoke = (page, channel, params) => page.evaluate(({ channel, params }) => require('electron').ipcRenderer.invoke(channel, params), { channel, params })
const label = (page, key) => page.evaluate(key => window.i18n.t(key), key)
const makeSong = (id, name) => ({ id, name, singer: '测试歌手', source: 'local', interval: '01:00', meta: { filePath: '', ext: 'wav', albumName: '', picUrl: '' } })

test('the add-to-list button shows whether the song is already in a saved or synced playlist', { timeout: 120000 }, async() => {
  const fixture = await launch({ rendererPath })
  const { app, page } = fixture
  try {
    page.setDefaultTimeout(8000)
    await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'zh-cn' }))
    const addLabel = await label(page, 'player__add_music_to')
    const song = makeSong('state-song', '状态测试')
    const seedLists = userList => invoke(page, 'player_list_data_overwire', { defaultList: [song], loveList: [], tempList: [], userList })
    const barSelector = `#player button[aria-label="${addLabel}"]`
    const waitBarPressed = expected => page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.getAttribute('aria-pressed') === String(expected), { selector: barSelector, expected })
    const barButton = page.locator(barSelector)
    const loveButton = page.getByRole('button', { name: '把该歌曲添加到「我的收藏」', exact: true })
    const closeModal = async() => {
      const height = await page.evaluate(() => window.innerHeight)
      await page.mouse.click(20, Math.floor(height / 2))
      await loveButton.waitFor({ state: 'detached' })
    }

    await seedLists([])
    await page.evaluate(song => {
      Object.assign(window.lxData.musicInfo, { id: song.id, name: song.name, singer: song.singer, source: song.source })
      Object.assign(window.lxData.playMusicInfo, { musicInfo: song, listId: 'default' })
    }, song)
    await barButton.waitFor()
    await waitBarPressed(false)

    // Adding through the unchanged popup flips the button without a reload.
    await barButton.click()
    await loveButton.waitFor()
    await loveButton.click()
    await waitBarPressed(true)

    // The active button still opens the same popup.
    await barButton.click()
    await loveButton.waitFor()
    await closeModal()

    await seedLists([])
    await waitBarPressed(false)

    // Cookie-synced playlists are normal user lists with source metadata.
    await seedLists([{ id: 'userlist_wy_sync_42', name: '网易云音乐 - 测试歌单', source: 'wy', sourceListId: '42', locationUpdateTime: null, list: [song] }])
    await waitBarPressed(true)

    // The play-detail control shares the same state.
    await showDetail(page, true)
    await settled(page)
    const detailButton = page.locator('[data-player-detail]').getByRole('button', { name: addLabel, exact: true })
    await detailButton.waitFor()
    const detailPressed = () => page.evaluate(label => [...document.querySelectorAll('[data-player-detail] button')].find(button => button.getAttribute('aria-label') === label)?.getAttribute('aria-pressed'), addLabel)
    await page.waitForFunction(label => [...document.querySelectorAll('[data-player-detail] button')].some(button => button.getAttribute('aria-label') === label && button.getAttribute('aria-pressed') === 'true'), addLabel)
    assert.equal(await detailPressed(), 'true')

    // The play-detail button also keeps the popup behaviour while active.
    await detailButton.click()
    await loveButton.waitFor()
    await closeModal()

    await seedLists([])
    await page.waitForFunction(label => [...document.querySelectorAll('[data-player-detail] button')].some(button => button.getAttribute('aria-label') === label && button.getAttribute('aria-pressed') === 'false'), addLabel)

    assert.deepEqual(fixture.errors, [])
  } finally {
    await app.close()
  }
})
