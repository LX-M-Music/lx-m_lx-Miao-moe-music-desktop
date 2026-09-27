const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/utils/coverThumbnail.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})
const exportsObject = {}
vm.runInNewContext(compiled.outputText, { exports: exportsObject, URL })
const { getCoverThumbnail } = exportsObject

test('small covers use stable thumbnail URLs and replace existing large sizes', () => {
  const url = 'https://p1.music.126.net/cover/album.jpg?param=1400y1400'
  assert.equal(getCoverThumbnail(url, 28), 'https://p1.music.126.net/cover/album.jpg?param=96y96')
  assert.equal(getCoverThumbnail(url, 28), getCoverThumbnail(url, 56))
  assert.equal(getCoverThumbnail(url, 180), 'https://p1.music.126.net/cover/album.jpg?param=320y320')
  assert.equal(url, 'https://p1.music.126.net/cover/album.jpg?param=1400y1400')
})

test('QQ album and artist covers use the CDN thumbnail sizes', () => {
  for (const type of ['T001', 'T002']) {
    const url = `https://y.gtimg.cn/music/photo_new/${type}R500x500M000album.jpg`
    assert.equal(getCoverThumbnail(url, 28), `https://y.gtimg.cn/music/photo_new/${type}R90x90M000album.jpg`)
    assert.equal(getCoverThumbnail(url, 160), `https://y.gtimg.cn/music/photo_new/${type}R300x300M000album.jpg`)
  }
})

test('Kuwo legacy cover links use its working HTTPS image host', () => {
  const path = '/star/albumcover/500/s4s49/58/3052577581.jpg'
  for (const scheme of ['http', 'https']) {
    assert.equal(getCoverThumbnail(`${scheme}://img1.kwcdn.kuwo.cn${path}`, 28), `https://img1.kuwo.cn${path}`)
  }
  const signed = `https://img1.kwcdn.kuwo.cn${path}?token=abc`
  assert.equal(getCoverThumbnail(signed, 28), signed)
})

test('unknown sources, local artwork and authenticated links stay unchanged', () => {
  for (const url of [
    '', 'data:image/png;base64,AAA', 'blob:local-cover', 'file:///D:/Music/cover.jpg',
    'https://example.com/album.jpg?size=1400', 'https://p1.music.126.net.example.com/cover.jpg',
    'https://y.gtimg.cn/other/cover.jpg', 'https://p1.music.126.net/cover.jpg?signature=abc',
    'https://p1.music.126.net/cover.jpg?token=abc', 'https://img1.kwcdn.kuwo.cn/other/cover.jpg', 'https://invalid url',
  ]) assert.equal(getCoverThumbnail(url, 28), url)
})

test('invalid sizes are bounded and never produce unbounded image requests', () => {
  const url = 'https://p2.music.126.net/cover.jpg'
  for (const pixels of [NaN, Infinity, -100, 0]) assert.equal(getCoverThumbnail(url, pixels), url + '?param=96y96')
  assert.equal(getCoverThumbnail(url, 100000), url + '?param=640y640')
})
