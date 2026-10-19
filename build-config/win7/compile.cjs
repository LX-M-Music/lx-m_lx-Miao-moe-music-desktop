const fs = require('node:fs')
const path = require('node:path')
const webpack = require('webpack')
const { auditPackages } = require('./audit.cjs')
const root = path.resolve(__dirname, '../..')
const target = process.argv[2]
if (!['main', 'renderer', 'renderer-lyric', 'renderer-scripts', 'musicfree'].includes(target)) throw new Error('Unknown build target')
const configPath = target === 'musicfree' ? '../musicfree/webpack.config.js' : `../${target}/webpack.config.prod.js`
const compiler = webpack(require(configPath))
compiler.run((error, stats) => compiler.close(() => {
  if (error || stats.hasErrors()) {
    console.error(error ?? stats.toString({ all: false, errors: true, errorDetails: true }))
    process.exitCode = 1
    return
  }
  try {
    const files = []
    const visit = modules => {
      for (const module of modules ?? []) {
        if (module.nameForCondition) files.push(module.nameForCondition)
        visit(module.modules)
      }
    }
    visit(stats.toJson({ all: false, modules: true, nestedModules: true, modulesSpace: Infinity, nestedModulesSpace: Infinity, groupModulesByPath: false, groupModulesByType: false, groupModulesByAttributes: false }).modules)
    const packages = auditPackages([], files)
    fs.writeFileSync(path.join(root, `dist/win7-${target}-audit.json`), JSON.stringify({ target, sourceModules: files.filter(file => file.startsWith(path.join(root, 'src'))).length, packages }, null, 2))
    console.log(stats.toString({ all: false, timings: true, errors: true, warnings: true }))
    console.log(`${target}: checked ${files.length} modules and ${packages.length} runtime packages for Node 16`)
  } catch (error) { console.error(error); process.exitCode = 1 }
}))
