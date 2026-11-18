const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack, settled, showDetail } = require('./helpers/motion-fixture.cjs')

const rendererPath = path.resolve('dist/index.html')
// A running dev session rewrites dist/main.js in development mode; point at a
// production copy with LX_TEST_MAIN_PATH when that happens.
const mainPath = process.env.LX_TEST_MAIN_PATH ? path.resolve(process.env.LX_TEST_MAIN_PATH) : path.resolve('dist/main.js')
const options = {
  rendererPath,
  mainPath,
  disableHardwareAcceleration: false,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-backgrounding-occluded-windows'],
}
const update = (page, values) => page.evaluate(values => window.lxData.updateSetting(values), values)
const invoke = (page, channel, params) => page.evaluate(({ channel, params }) => require('electron').ipcRenderer.invoke(channel, params), { channel, params })

const makeSong = (id, name, source = 'tx') => ({
  id,
  name,
  singer: '测试歌手',
  source,
  interval: '01:00',
  meta: { songId: id, albumName: '', picUrl: '' },
})

// Completed downloads carry a composite task id (`musicId_quality_ext`), while
// playlists store the plain music id. The UI must look up the latter.
const makeDownload = song => ({
  id: `${song.id}_320k_mp3`,
  isComplate: true,
  status: 'completed',
  statusText: '',
  downloaded: 1,
  total: 1,
  progress: 100,
  speed: '',
  writeQueue: 0,
  metadata: {
    musicInfo: song,
    url: null,
    quality: '320k',
    ext: 'mp3',
    fileName: `${song.name}.mp3`,
    filePath: '',
  },
})

const play = (page, info) => page.evaluate(info => {
  const base = 'progress' in info ? info.metadata.musicInfo : info
  Object.assign(window.lxData.musicInfo, { id: info.id, name: base.name, singer: base.singer, source: base.source, pic: null })
  Object.assign(window.lxData.playMusicInfo, { musicInfo: info, listId: 'download' })
}, info)

const seedLists = (page, { defaultList = [], loveList = [], tempList = [], userList = [] }) => invoke(page, 'player_list_data_overwire', { defaultList, loveList, tempList, userList })

const addLabel = page => page.evaluate(() => window.i18n.t('player__add_music_to'))

// ---------------------------------------------------------------------------
// Color scope: the popup is teleported to #root by default. On the playback
// detail page #root only carries the library palette (or none at all when
// "auto contrast" is off), so a #root popup cannot follow the detail palette.
// ---------------------------------------------------------------------------
test('add-to-list popup opened on the playback detail inherits the detail adaptive scope', { timeout: 120000 }, async() => {
  const fixture = await launch(options)
  const { app, page, errors } = fixture
  try {
    page.setDefaultTimeout(10000)
    await update(page, {
      'common.langId': 'zh-cn',
      'common.isShowAnimation': false,
      'ui.ambientBackground': true,
      'ui.ambientBackgroundAutoContrast': false,
      'ui.ambientBackgroundQuality': 'static',
      'ui.lowPowerMode': false,
    })
    await seedTrack(page)
    await showDetail(page, true)
    await settled(page)

    // Wait until the shared adaptive palette has reached the detail page.
    await page.waitForFunction(() => {
      const detail = document.querySelector('[data-player-detail]')
      return !!detail?.dataset.ambientControls && !!getComputedStyle(detail).getPropertyValue('--color-surface-elevated').trim()
    })
    const label = await addLabel(page)
    await page.evaluate(label => {
      const button = Array.from(document.querySelectorAll('[data-player-detail] button')).find(button => button.getAttribute('aria-label') === label)
      if (!button) throw new Error('playback detail add button is missing')
      button.click()
    }, label)
    await page.locator('button[aria-label^="把该歌曲添加到「"]').first().waitFor()

    const scope = await page.evaluate(() => {
      const button = document.querySelector('button[aria-label^="把该歌曲添加到「"]')
      const detail = document.querySelector('[data-player-detail]')
      const root = document.getElementById('root')
      const styleOf = element => element ? getComputedStyle(element).getPropertyValue('--color-surface-elevated').trim() : ''
      return {
        inDetail: !!button?.closest('[data-player-detail]'),
        detailControls: detail?.dataset.ambientControls ?? '',
        popup: styleOf(button),
        detail: styleOf(detail),
        root: styleOf(root),
        popupBackground: button ? getComputedStyle(button.closest('main').parentElement).backgroundColor : '',
      }
    })

    assert.ok(scope.detailControls, 'the playback detail keeps its adaptive scope marker')
    assert.ok(scope.detail, 'the playback detail publishes an adaptive elevated surface')
    assert.ok(scope.popup, 'the popup resolves --color-surface-elevated')
    assert.equal(scope.inDetail, true, 'the popup lives in the adaptive scope it is drawn on')
    assert.equal(scope.popup, scope.detail, 'the popup elevated surface follows the detail palette')
    assert.equal(scope.popupBackground, scope.detail, 'the popup content paints the adaptive elevated surface')

    // The popup must be above the detail page in hit testing, not just inherit
    // its colors. The detail uses contain:strict, so clipping is possible.
    const hit = await page.evaluate(() => {
      const button = document.querySelector('button[aria-label^="把该歌曲添加到「"]')
      const main = button?.closest('main')
      if (!button || !main) return { ok: false, tag: '', label: '' }
      const rect = button.getBoundingClientRect()
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return {
        ok: main.contains(target),
        tag: target?.tagName ?? '',
        label: target?.closest?.('button')?.getAttribute('aria-label') ?? '',
      }
    })
    assert.equal(hit.ok, true, `elementFromPoint must hit the popup buttons (got ${hit.tag} / ${hit.label})`)

    // A real click proves the popup is not only painted but interactive.
    const songId = await page.evaluate(() => window.lxData.playMusicInfo.musicInfo.id)
    await page.getByRole('button', { name: '把该歌曲添加到「我的收藏」', exact: true }).click()
    await page.locator('button[aria-label^="把该歌曲添加到「"]').first().waitFor({ state: 'detached' })
    const savedIds = await invoke(page, 'player_list_music_get_list_ids', songId)
    assert.ok(savedIds.includes('love'), `the clicked list really contains the song: ${JSON.stringify(savedIds)}`)
    assert.ok(await page.locator('[data-player-detail]').evaluate(element => !!element.dataset.ambientControls), 'the detail keeps data-ambient-controls')
    assert.deepEqual(errors, [])
  } finally {
    await app.close()
  }
})

// ---------------------------------------------------------------------------
// The detail page can close behind an open popup (shortcut, deeplink). A popup
// teleported into it must close instead of staying inside the hidden container,
// and the next open from the library must still work.
// ---------------------------------------------------------------------------
test('closing the playback detail while the popup is open closes the popup and the next open works', { timeout: 120000 }, async() => {
  const fixture = await launch(options)
  const { app, page, errors } = fixture
  try {
    page.setDefaultTimeout(10000)
    await update(page, {
      'common.langId': 'zh-cn',
      'common.isShowAnimation': false,
      'ui.ambientBackground': true,
      'ui.ambientBackgroundAutoContrast': false,
      'ui.ambientBackgroundQuality': 'static',
      'ui.lowPowerMode': false,
    })
    await seedTrack(page)
    await showDetail(page, true)
    await settled(page)
    await page.waitForFunction(() => !!document.querySelector('[data-player-detail]')?.dataset.ambientControls)
    const label = await addLabel(page)
    // A popup opened from the detail's own play bar unmounts together with that
    // bar. The main play bar instance stays mounted, so it is the one that can
    // remain trapped in a hidden detail container; open it programmatically to
    // cover that "other entry" path.
    await page.evaluate(label => {
      const button = document.querySelector(`#player button[aria-label="${label}"]`)
      if (!button) throw new Error('main play bar add button is missing')
      button.click()
    }, label)
    const popupSelector = 'button[aria-label^="把该歌曲添加到「"]'
    await page.locator(popupSelector).first().waitFor()
    assert.equal(await page.evaluate(selector => !!document.querySelector(selector)?.closest('[data-player-detail]'), popupSelector), true, 'the popup starts inside the detail scope')

    // Close the detail behind the popup. The popup must not remain inside the
    // hidden detail container.
    await showDetail(page, false)
    await page.locator(popupSelector).first().waitFor({ state: 'detached', timeout: 8000 })
    await settled(page)

    // A later open from the library still resolves the root scope.
    const barButton = page.locator(`#player button[aria-label="${label}"]`)
    await barButton.waitFor()
    await barButton.click()
    await page.locator(popupSelector).first().waitFor()
    assert.equal(await page.evaluate(selector => !!document.querySelector(selector)?.closest('[data-player-detail]'), popupSelector), false, 'the reopened popup uses the root scope')

    // The same popup closes when the playing song changes underneath it.
    const other = makeSong('detail-close-other', '切换后的歌曲')
    await play(page, other)
    await page.locator(popupSelector).first().waitFor({ state: 'detached', timeout: 8000 })
    assert.deepEqual(errors, [])
  } finally {
    await app.close()
  }
})

// ---------------------------------------------------------------------------
// Badge identity: a playing download task stores `musicInfo_quality_ext` as its
// id, while playlists contain the plain music id.
// ---------------------------------------------------------------------------
test('the add-to-list badge resolves a downloaded track to its saved playlist entry', { timeout: 120000 }, async() => {
  const fixture = await launch({ rendererPath, mainPath })
  const { app, page, errors } = fixture
  try {
    page.setDefaultTimeout(10000)
    await update(page, { 'common.langId': 'zh-cn' })
    const song = makeSong('download-badge-song', '下载中的歌曲')
    await seedLists(page, { loveList: [] })
    const label = await addLabel(page)
    const barButton = page.locator(`#player button[aria-label="${label}"]`)
    const loveButton = page.getByRole('button', { name: '把该歌曲添加到「我的收藏」', exact: true })

    await play(page, makeDownload(song))
    await barButton.waitFor()
    await page.waitForFunction(label => document.querySelector(`#player button[aria-label="${label}"]`)?.getAttribute('aria-pressed') === 'false', label, { timeout: 8000 })

    // Adding the download task must flip the badge for the saved plain entry.
    await barButton.click()
    await loveButton.waitFor()
    assert.equal(await loveButton.isDisabled(), false)
    await loveButton.click()
    await page.waitForFunction(label => document.querySelector(`#player button[aria-label="${label}"]`)?.getAttribute('aria-pressed') === 'true', label, { timeout: 8000 })

    // The popup resolves the same download task to its saved playlist entry.
    await barButton.click()
    await loveButton.waitFor()
    await page.waitForFunction(name => Array.from(document.querySelectorAll('button')).some(button => button.getAttribute('aria-label') === name && button.disabled), '把该歌曲添加到「我的收藏」', { timeout: 8000 })
    const height = await page.evaluate(() => window.innerHeight)
    await page.mouse.click(20, Math.floor(height / 2))
    await loveButton.waitFor({ state: 'detached' })

    // The playback detail control uses the same composable.
    await showDetail(page, true)
    await settled(page)
    await page.waitForFunction(label => {
      const button = Array.from(document.querySelectorAll('[data-player-detail] button')).find(button => button.getAttribute('aria-label') === label)
      return button?.getAttribute('aria-pressed') === 'true'
    }, label, { timeout: 8000 })
    await showDetail(page, false)
    await settled(page)

    // A plain music object keeps working.
    await play(page, song)
    await page.waitForFunction(label => document.querySelector(`#player button[aria-label="${label}"]`)?.getAttribute('aria-pressed') === 'true', label)
    assert.deepEqual(errors, [])
  } finally {
    await app.close()
  }
})

// ---------------------------------------------------------------------------
// The temporary list is not a saved playlist (see useMusicExistInList comment).
// Adding through the popup must flip the badge and disable the same list button.
// ---------------------------------------------------------------------------
test('temporary list does not count as saved, and adding through the popup keeps the badge and popup in sync', { timeout: 120000 }, async() => {
  const fixture = await launch({ rendererPath, mainPath })
  const { app, page, errors } = fixture
  try {
    page.setDefaultTimeout(10000)
    await update(page, { 'common.langId': 'zh-cn' })
    const song = makeSong('temp-and-add-song', '临时与添加')
    const other = makeSong('temp-and-add-other', '另一首歌')
    const listName = '一致性测试'
    const label = await addLabel(page)
    const barButton = page.locator(`#player button[aria-label="${label}"]`)

    // Only in the temporary list: the badge must stay off.
    await seedLists(page, { tempList: [song] })
    await play(page, song)
    await barButton.waitFor()
    await page.waitForFunction(label => document.querySelector(`#player button[aria-label="${label}"]`)?.getAttribute('aria-pressed') === 'false', label, { timeout: 8000 })

    // A real user list: adding through the popup must flip the badge.
    await seedLists(page, { userList: [{ id: 'userlist_consistency', name: listName, locationUpdateTime: null, list: [] }] })
    await page.waitForTimeout(400)
    await barButton.click()
    const listButton = page.getByRole('button', { name: `把该歌曲添加到「${listName}」`, exact: true })
    await listButton.waitFor()
    assert.equal(await listButton.isDisabled(), false)
    await listButton.click()
    await page.waitForFunction(label => document.querySelector(`#player button[aria-label="${label}"]`)?.getAttribute('aria-pressed') === 'true', label, { timeout: 8000 })

    // Reopening disables the same list button instead of offering a duplicate add.
    await barButton.click()
    await listButton.waitFor()
    await page.waitForFunction(name => Array.from(document.querySelectorAll('button')).some(button => button.getAttribute('aria-label') === name && button.disabled), `把该歌曲添加到「${listName}」`, { timeout: 8000 })
    const height = await page.evaluate(() => window.innerHeight)
    await page.mouse.click(20, Math.floor(height / 2))
    await listButton.waitFor({ state: 'detached' })

    // Switching to another song clears the badge.
    await play(page, makeDownload(other))
    await page.waitForFunction(label => document.querySelector(`#player button[aria-label="${label}"]`)?.getAttribute('aria-pressed') === 'false', label, { timeout: 8000 })
    assert.deepEqual(errors, [])
  } finally {
    await app.close()
  }
})

// ---------------------------------------------------------------------------
// Rapidly reopening the popup for a different song must not let the previous
// song's list lookup paint the new popup.
// ---------------------------------------------------------------------------
test('a late list lookup for the previous song cannot contaminate the reopened popup', { timeout: 120000 }, async() => {
  const fixture = await launch({ rendererPath, mainPath })
  const { app, page, errors } = fixture
  try {
    page.setDefaultTimeout(10000)
    await update(page, { 'common.langId': 'zh-cn' })
    const songA = makeSong('stale-song-a', '旧歌曲')
    const songB = makeSong('stale-song-b', '新歌曲')
    const label = await addLabel(page)
    const barButton = page.locator(`#player button[aria-label="${label}"]`)
    await seedLists(page, {
      userList: [
        { id: 'userlist_stale_a', name: '列表A', locationUpdateTime: null, list: [songA] },
        { id: 'userlist_stale_b', name: '列表B', locationUpdateTime: null, list: [] },
      ],
    })

    // Make the popup lookup slow enough to close the previous popup and open the
    // next one before the first reply returns.
    await page.evaluate(() => {
      const ipc = require('electron').ipcRenderer
      const original = ipc.invoke.bind(ipc)
      window.__originalInvoke = original
      ipc.invoke = (channel, ...args) => {
        if (channel !== 'player_list_music_get_list_ids') return original(channel, ...args)
        const delay = args[0] === 'stale-song-a' ? 600 : args[0] === 'stale-song-b' ? 1400 : 0
        return new Promise((resolve, reject) => setTimeout(() => original(channel, ...args).then(resolve, reject), delay))
      }
    })

    const open = async song => {
      await play(page, song)
      await barButton.waitFor()
      await barButton.click()
      await page.getByRole('button', { name: '把该歌曲添加到「列表B」', exact: true }).waitFor()
    }
    const close = async() => {
      const height = await page.evaluate(() => window.innerHeight)
      await page.mouse.click(20, Math.floor(height / 2))
      await page.getByRole('button', { name: '把该歌曲添加到「列表B」', exact: true }).waitFor({ state: 'detached' })
    }

    await open(songA)
    await close()
    await open(songB)
    // A's reply arrives here; B's own reply is still pending.
    await page.waitForTimeout(850)
    const listADisabled = await page.getByRole('button', { name: '把该歌曲添加到「列表A」', exact: true }).isDisabled()
    assert.equal(listADisabled, false, 'the previous song lookup must not mark this popup')

    // Let B's slow reply land as well; B is in no saved list.
    await page.waitForTimeout(900)
    assert.equal(await page.getByRole('button', { name: '把该歌曲添加到「列表A」', exact: true }).isDisabled(), false)
    assert.deepEqual(errors, [])
  } finally {
    await app.close()
  }
})
