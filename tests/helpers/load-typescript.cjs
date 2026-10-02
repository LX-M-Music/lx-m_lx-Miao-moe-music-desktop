const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

module.exports = function loader(overrides = {}) {
  if (overrides['electron-log/node'] && !overrides['electron-log/node'].hooks) overrides['electron-log/node'].hooks = []
  const cache = new Map()
  const load = filename => {
    filename = path.resolve(filename)
    if (!path.extname(filename)) filename += fs.existsSync(filename + '.ts') ? '.ts' : '.js'
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const execute = vm.runInThisContext('(function(require,module,exports,__dirname){' + code + '\n})', { filename })
    execute(name => {
      if (Object.hasOwn(overrides, name)) return overrides[name]
      if (name === 'original-fs') return require('node:fs')
      if (name.startsWith('node:')) return require(name)
      if (name.startsWith('@common/')) return load(path.resolve('src/common', name.slice(8)))
      if (name === '@renderer/utils/requestContext') return load('src/renderer/utils/requestContext.js')
      if (name === '@renderer/utils/musicSdk/requestCache') return load('src/renderer/utils/musicSdk/requestCache.js')
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name))
      throw Error('Unexpected dependency: ' + name)
    }, module, module.exports, path.dirname(filename))
    return module.exports
  }
  return load
}
