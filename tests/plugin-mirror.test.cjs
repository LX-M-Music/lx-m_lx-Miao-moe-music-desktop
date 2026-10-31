const assert = require('node:assert/strict')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

test('plugin mirror sources default off and always keep the official source as fallback', () => {
  const load = loader()
  const defaults = load('src/common/defaultSetting.ts').default
  const { OFFICIAL_PLUGIN_ROOT, PLUGIN_CATALOG_FILE, PLUGIN_MIRROR_PREFIXES, pluginSourceUrls } = load('src/common/optionalPlugins.ts')
  const catalog = OFFICIAL_PLUGIN_ROOT + PLUGIN_CATALOG_FILE

  assert.equal(defaults['plugin.useMirror'], false)
  assert(PLUGIN_MIRROR_PREFIXES.length >= 3)
  for (const prefix of PLUGIN_MIRROR_PREFIXES) {
    assert.match(prefix, /^https:\/\/[^/]+\/$/)
    assert.equal(new URL(prefix + catalog).protocol, 'https:')
  }

  assert.deepEqual(pluginSourceUrls(catalog, false), [catalog])
  assert.deepEqual(pluginSourceUrls(catalog, true), [
    ...PLUGIN_MIRROR_PREFIXES.map(prefix => prefix + catalog),
    catalog,
  ])
  const pkg = OFFICIAL_PLUGIN_ROOT + 'audio-visualizer/1.2.2/package.lxplugin'
  assert.deepEqual(pluginSourceUrls(pkg, true).at(-1), pkg)
  assert.equal(new Set(pluginSourceUrls(pkg, true)).size, PLUGIN_MIRROR_PREFIXES.length + 1)
})
