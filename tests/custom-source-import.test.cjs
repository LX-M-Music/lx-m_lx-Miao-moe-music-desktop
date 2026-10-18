const assert = require('node:assert/strict')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

const fixture = (lxCount = 0, musicFreeError) => {
  const calls = []
  const userApi = { list: Array.from({ length: lxCount }, (_, index) => ({ id: `lx-${index}` })) }
  const load = loader({
    '@renderer/store': { userApi },
    '@renderer/utils/ipc': { importUserApi: async script => {
      calls.push({ type: 'lx', script })
      const apiInfo = { id: 'lx-imported', name: 'LX fixture' }
      return { apiInfo, apiList: [...userApi.list, apiInfo] }
    } },
    '@renderer/store/musicFree': { importMusicFree: async input => {
      calls.push({ type: 'musicfree', ...input })
      if (musicFreeError) throw musicFreeError
      return { imported: ['MusicFree fixture'], errors: [], plugins: [] }
    } },
  })
  return { ...load('src/renderer/core/customSourceImport.ts'), calls, userApi }
}

test('existing import detects commented/minified CommonJS plugins and JSON subscriptions without treating them as LX', async() => {
  const { importCustomSource, calls, userApi } = fixture()
  for (const script of [
    "module.exports={platform:'Fixture',search(){}}",
    "/**\n * @name MusicFree fixture\n */\nmodule.exports={platform:'Fixture',search(){}}",
    "/* metadata */ module['exports']={default:{platform:'Fixture',search(){}}}",
    "/* metadata */ exports.default={platform:'Fixture',search(){}}",
    '{"plugins":[{"url":"plugin.js"}]}',
    '["https://example.com/plugin.js"]',
  ]) assert.deepEqual((await importCustomSource({ script })).imported, ['MusicFree fixture'])
  assert(calls.every(call => call.type === 'musicfree'))
  assert.equal(userApi.list.length, 0)
  const input = { script: '{"plugins":[{"url":"./plugin.js"}]}', url: 'https://example.com/sub/list.json' }
  await importCustomSource(input)
  assert.deepEqual(calls.at(-1), { type: 'musicfree', ...input })
})

test('existing LX imports preserve metadata, bundled dependencies and store updates', async() => {
  const { importCustomSource, calls, userApi } = fixture()
  for (const script of [
    '/**\n * @name LX fixture\n */\nlx.send(lx.EVENT_NAMES.inited, {sources:{}})',
    '/**\n * @name Bundled LX\n */\n(function(module){module.exports=1})({exports:{}}); const {send}=window.lx;',
    '/* legacy metadata */ console.log("legacy")',
  ]) assert.deepEqual((await importCustomSource({ script })).imported, ['LX fixture'])
  assert(calls.every(call => call.type === 'lx'))
  assert.equal(userApi.list.length, 3)
})

test('LX source limit does not block MusicFree imports or updates', async() => {
  const { importCustomSource, calls, userApi } = fixture(20)
  await assert.rejects(importCustomSource({ script: '/* LX */ lx.on(lx.EVENT_NAMES.request,()=>{})' }), /SOURCE_IMPORT_LIMIT/)
  await importCustomSource({ script: "/* MusicFree */module.exports={platform:'Fixture',search(){}}" })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].type, 'musicfree')
  assert.equal(userApi.list.length, 20)
})

test('failed MusicFree inspection never falls back to LX and invalid files do not reach either backend', async() => {
  const { importCustomSource, calls, userApi } = fixture(0, new Error('MusicFree plugin invalid'))
  await assert.rejects(importCustomSource({ script: '/* metadata */module.exports={}' }), /MusicFree plugin invalid/)
  for (const script of ['', ' '.repeat(10), '中'.repeat(2 * 1024 * 1024 / 3 + 1)]) await assert.rejects(importCustomSource({ script }), /SOURCE_IMPORT_INVALID/)
  assert.deepEqual(calls.map(call => call.type), ['musicfree'])
  assert.equal(userApi.list.length, 0)
})
