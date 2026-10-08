import type { PluginContext } from '@common/optionalPluginTypes'
import { activate as activateAnalyser } from './analyser'
import { initPreferences } from './preferences'
import Settings from './Settings.vue'

const activate = (context: PluginContext) => {
  const stopPreferences = initPreferences(context)
  const stopAnalyser = activateAnalyser()
  return () => { stopAnalyser(); stopPreferences() }
}
export default { activate, components: { Settings } }
