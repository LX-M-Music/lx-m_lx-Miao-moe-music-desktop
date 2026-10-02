// Only NSIS Setup assets can be installed silently. Prefer a matching single-arch
// installer, then the x86/x64 bundle or an installer without an architecture suffix.
export const getWindowsSetupPriority = (fileName: string, arch: string, win7 = process.platform === 'win32' && process.versions?.electron?.split('.')[0] === '22'): number => {
  if (!fileName || /[/\\\0]/.test(fileName) || !/(?:^|[-_. ])setup\.exe$/i.test(fileName)) return 0
  const name = fileName.toLowerCase()
  if (/(?:^|[-_. ])win7(?:[-_. ]|$)/.test(name) !== win7) return 0
  if (/(?:^|[-_. ])(?:portable|green)(?:[-_. ]|$)/.test(name)) return 0
  if (/(?:^|[-_. ])x86_64(?:[-_. ]|$)/.test(name)) return arch == 'x64' || arch == 'ia32' ? 1 : 0
  const architectures = name.match(/(?:^|[-_. ])(x64|x86|ia32|arm64)(?=[-_. ]|$)/g)
  if (!architectures) return 1
  const keyword = arch == 'ia32' ? '(?:x86|ia32)' : arch
  return new RegExp(`(?:^|[-_. ])${keyword}(?:[-_. ]|$)`).test(name) ? 2 : 0
}

export const getWindowsUpdatePriority = (fileName: string, runtime: LX.UpdateRuntime, differential?: 'manifest' | 'payload'): number => {
  if (runtime.edition === 'development' || !fileName || /[/\\\0]/.test(fileName)) return 0
  const name = fileName.toLowerCase()
  if (/(?:^|[-_. ])win7(?:[-_. ]|$)/.test(name) !== runtime.win7) return 0
  if (differential) {
    if (runtime.edition !== 'portable' || !name.endsWith(`-green-update.${differential === 'manifest' ? 'json' : 'bin'}`)) return 0
  } else if (runtime.edition === 'installed') {
    if (!getWindowsSetupPriority(fileName, runtime.arch, runtime.win7)) return 0
  } else if (runtime.edition === 'single-file') {
    if (!/(?:^|[-_. ])portable\.exe$/.test(name) || /(?:^|[-_. ])(?:setup|green)(?:[-_. ]|$)/.test(name)) return 0
  } else if (!/(?:^|[-_. ])green\.(?:7z|zip)$/.test(name) || /(?:^|[-_. ])(?:setup|portable)(?:[-_. ]|$)/.test(name)) return 0
  const architectures = Array.from(name.matchAll(/(?:^|[-_. ])(x86_64|x64|x86|ia32|arm64)(?=[-_. ]|$)/g), match => match[1])
  if (architectures.length !== 1) return 0
  const arch = architectures[0]
  if (arch === 'x86_64') return runtime.edition !== 'portable' && ['x64', 'ia32'].includes(runtime.arch) ? 1 : 0
  return arch === runtime.arch || (runtime.arch === 'ia32' && arch === 'x86') ? 2 : 0
}
