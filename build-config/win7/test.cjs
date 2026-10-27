const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { workspace } = require('./run.cjs')
const root = path.resolve(__dirname, '../..')
const marker = JSON.parse(fs.readFileSync(path.join(workspace, 'dist/win7-build.json'), 'utf8'))
if (marker.electron !== '22.3.27') throw new Error('Build the Win7 edition before testing')
const unit = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.cjs') && !name.endsWith('.electron.test.cjs'))
const ui = [
  'win7-audio-output', 'bug-fixes', 'builtin-features', 'audio-tag-editor-downloads',
  'plugin-devkit', 'plugin-source', 'plugin-formats', 'folia-lyrics', 'audio-visualizer',
  'volume-normalization', 'auto-update', 'list-trash', 'song-drag',
  'mini-player', 'mini-player-recovery', 'mini-player-edge-drag', 'mini-player-edge-hide', 'mini-player-edge-motion-preference', 'desktop-lyric-drag', 'desktop-lyric-controls', 'settings-reveal', 'settings-session',
  'settings-search-extended', 'webdav', 'window-controls', 'upstream-2.12', 'upstream-2.12.6',
  'kawarp-renderer', 'kawarp-background', 'adaptive-background-colors',
].map(name => name + '.electron.test.cjs')
const files = process.argv.includes('--core') ? unit : [...unit, ...ui]
const env = { ...process.env, LX_TEST_PROJECT: workspace, NODE_OPTIONS: '--max-old-space-size=8192' }
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=240000', ...files.map(name => path.join(root, 'tests', name))], { cwd: root, env, stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
