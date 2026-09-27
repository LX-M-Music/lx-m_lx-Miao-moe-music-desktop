const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

test('local metadata failures are reported per file without discarding valid songs', async() => {
  const worker = loader({
    '@common/constants': {},
    '@common/utils/common': {},
    '@common/utils/nodejs': {},
    '@renderer/utils/music': {
      createLocalMusicInfo: async filename => {
        if (filename === 'throws.mp3') throw Error('Unreadable')
        return filename === 'bad.mp3' ? null : { id: filename, meta: { filePath: filename } }
      },
    },
  })('src/renderer/worker/main/list.ts')
  const result = await worker.createLocalMusicInfos(['good.mp3', 'bad.mp3', 'throws.mp3', 'later.mp3'])
  assert.deepEqual(result.musicInfos.map(item => item.id), ['good.mp3', 'later.mp3'])
  assert.deepEqual(result.failedPaths, ['bad.mp3', 'throws.mp3'])
})

for (const failure of ['worker', 'database', 'partial', 'none', 'cancel']) {
  test(`local import clears loading and reports failed paths after ${failure}`, async t => {
    const previous = global.window
    t.after(() => { global.window = previous })
    const paths = Array.from({ length: 201 }, (_, i) => `song-${i}.mp3`)
    const status = []; const added = []; const dialogs = []
    let batches = 0
    global.window = {
      i18n: { t: key => key },
      lx: {
        worker: {
          main: {
            createLocalMusicInfos: async batch => {
              batches++
              if (failure === 'worker' && batches === 1) throw Error('Worker failed')
              return {
                musicInfos: batch.filter(filename => failure !== 'partial' || filename !== paths[0]).map(id => ({ id })),
                failedPaths: failure === 'partial' && batches === 1 ? [paths[0]] : [],
              }
            },
          },
        },
      },
    }
    const actions = loader({
      '@renderer/utils/ipc': { showSelectDialog: async() => ({ canceled: failure === 'cancel', filePaths: paths }) },
      '@renderer/store/list/action': {
        setFetchingListStatus: (id, busy) => status.push(busy),
        addListMusics: async(_id, items) => {
          if (failure === 'database' && batches === 1) throw Error('Database failed')
          added.push(...items)
        },
      },
      '@renderer/plugins/Dialog': { dialog: { error: async options => { assert.equal(status.at(-1), false); dialogs.push(options) } } },
    })('src/renderer/views/List/MyList/actions.ts')
    await actions.addLocalFile({ id: 'playlist' })
    assert.deepEqual(status, failure === 'cancel' ? [] : [true, false])
    if (['worker', 'database', 'partial'].includes(failure)) {
      assert.equal(dialogs.length, 1)
      assert(dialogs[0].message.includes(paths[0]))
      assert(!dialogs[0].message.includes('\n' + paths[200]))
      assert(added.some(item => item.id === paths[200]), 'later batches still import')
    } else assert.equal(dialogs.length, 0)
  })
}

test('same-name local covers in different folders and changed files get independent cache paths', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-local-cover-'))
  t.after(async() => {
    assert(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'lx-local-cover-')))
    await fs.rm(directory, { recursive: true, force: true })
  })
  const files = [path.join(directory, 'first', 'song.mp3'), path.join(directory, 'second', 'song.mp3')]
  for (const filename of files) { await fs.mkdir(path.dirname(filename)); await fs.writeFile(filename, 'audio') }
  const picture = fill => {
    const data = Buffer.alloc(400001, fill)
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64').copy(data)
    return data
  }
  const pictures = new Map(files.map((filename, i) => [filename, { data: picture(i + 1), format: 'image/png' }]))
  const worker = loader({
    'image-size': require('image-size'),
    '@renderer/utils/music': { getLocalMusicFilePic: async filename => pictures.get(filename) },
    '@common/utils/nodejs': { checkPath: async filename => !!await fs.stat(filename).catch(() => null) },
    'node:path': path,
    'node:os': { tmpdir: () => directory },
    'node:fs/promises': fs,
    'node:crypto': require('node:crypto'),
  })('src/renderer/worker/main/music.ts')
  const first = await worker.getMusicFilePic(files[0])
  const second = await worker.getMusicFilePic(files[1])
  assert.notEqual(first, second)
  assert.deepEqual(await fs.readFile(first), pictures.get(files[0]).data)
  await fs.writeFile(files[0], 'changed audio')
  pictures.get(files[0]).data = picture(3)
  const updated = await worker.getMusicFilePic(files[0])
  assert.notEqual(updated, first)
  assert.deepEqual(await fs.readFile(second), pictures.get(files[1]).data)
  assert.deepEqual(await fs.readFile(updated), pictures.get(files[0]).data)
})

test('local metadata is cached by file version and refreshed after edits', async() => {
  let version = 1; let calls = 0
  const music = loader({
    '@common/utils/nodejs': { extname: path.extname, getFileStats: async filename => filename.endsWith('.mp3') ? { isFile: () => true, size: 10, mtimeMs: version, ctimeMs: version } : null },
    '@common/utils/common': {},
    '@common/utils/lyricUtils/kg': {},
    'music-metadata': { parseFile: async() => { calls++; return { common: { picture: [{ version }] } } }, selectCover: pictures => pictures[0] },
  })('src/renderer/utils/music.ts')
  assert.equal((await music.getLocalMusicFilePic('song.mp3')).version, 1)
  await music.getLocalMusicFilePic('song.mp3')
  assert.equal(calls, 1)
  version = 2
  assert.equal((await music.getLocalMusicFilePic('song.mp3')).version, 2)
  assert.equal(calls, 2)
})
