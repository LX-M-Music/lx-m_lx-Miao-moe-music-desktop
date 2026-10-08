const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')()
const { parseFontStack, makeFontStack, fontChoices, getLyricDetailFontFamily, MAX_FONT_BYTES } = load('src/common/fonts.ts')
const { FontLibrary } = load('src/main/utils/customFonts.ts')

test('font names round-trip commas, quotes, escapes and generic families', () => {
  for (const [primary, secondary] of [['Family, with comma', 'Fallback'], ['Name "quoted"', 'Font\\name'], ['serif', 'monospace'], ['', '中文字体'], ['', '']]) {
    assert.deepEqual(fontChoices(makeFontStack(primary, secondary)), [primary, secondary])
  }
  assert.deepEqual(parseFontStack('"Microsoft YaHei", "Segoe UI"'), ['Microsoft YaHei', 'Segoe UI'])
  assert.equal(makeFontStack('Same', 'Same'), '"Same"')
  assert.equal(makeFontStack('', 'serif'), 'system-ui, serif')
})

test('lyric details isolate secondary families and preserve hosts without a detail switch', () => {
  const stack = makeFontStack('Primary Font', 'Secondary, "quoted" Font')
  assert.deepEqual(parseFontStack(getLyricDetailFontFamily(stack, true)), ['Secondary, "quoted" Font'])
  assert.equal(getLyricDetailFontFamily(stack, false), '')
  assert.equal(getLyricDetailFontFamily(makeFontStack('Primary Font', ''), true), '')
  assert.equal(getLyricDetailFontFamily(makeFontStack('', 'serif'), true), 'serif')
  assert.equal(getLyricDetailFontFamily(stack, undefined), stack)
})

test('imported fonts are copied, deduplicated and remain readable after restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-fonts-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const library = new FontLibrary(directory)
  assert.deepEqual(await library.list(), [])
  const data = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.from('fixture payload')])
  const first = await library.import({ name: 'Preview.ttf', data })
  const second = await library.import({ name: 'Preview.ttf', data })
  assert.equal(first.id, second.id)
  assert.equal((await library.list()).length, 1)
  const reopened = new FontLibrary(directory)
  assert.deepEqual(await reopened.list(), [first])
  assert.deepEqual((await reopened.read(first.id)).data, data)
  await fs.writeFile(path.join(directory, first.id), Buffer.concat([data, Buffer.from('changed')]))
  await assert.rejects(reopened.read(first.id), { code: 'FONT_FILE_CHANGED' })
})

test('font library rejects invalid files, oversize input and traversal', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-fonts-invalid-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const library = new FontLibrary(directory)
  await assert.rejects(library.import({ name: 'bad.ttf', data: Buffer.from('not a font') }), { code: 'FONT_FORMAT_INVALID' })
  await assert.rejects(library.import({ name: 'big.ttf', data: Buffer.alloc(MAX_FONT_BYTES + 1) }), { code: 'FONT_SIZE_LIMIT' })
  await assert.rejects(library.read('../config_v2.json'), { code: 'FONT_ID_INVALID' })
  await assert.rejects(library.read('LXCustom-' + '0'.repeat(64)), { code: 'FONT_FILE_MISSING' })
  assert.deepEqual(await library.list(), [])
})
