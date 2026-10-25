// Installs the app (and, if built, the add-on jar) for a JMRI installation. Nothing in the JMRI
// program folder is touched:
//   - dist/ goes to <profile>/web/modern, which JMRI's web server serves at /web/modern/
//   - addon/dist/jmri-modern-ui-addon.jar goes to the JMRI settings folder
//   - with --configure, jmri.conf in the settings folder gets "--cp:a=<jar>" so JMRI's launcher loads it
//
//   npm run deploy                                   # the only profile in the default JMRI settings folder
//   npm run deploy -- "/path/to/My Railroad.jmri"
//   npm run deploy -- --configure                    # also edit jmri.conf to load the add-on
//   npm run deploy -- --settings=/path/to/settings   # non-default settings folder
import { copyFileSync, cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const positional = args.filter((a) => !a.startsWith('--'))

const settings =
  option('settings') ??
  (platform() === 'darwin'
    ? join(homedir(), 'Library/Preferences/JMRI')
    : platform() === 'win32'
      ? join(homedir(), 'JMRI')
      : join(homedir(), '.jmri'))

let profile = positional[0]
if (!profile) {
  const found = existsSync(settings) ? readdirSync(settings).filter((d) => d.endsWith('.jmri')) : []
  if (found.length !== 1) {
    console.error(
      found.length
        ? `Several JMRI profiles in ${settings}; pass one:\n  ${found.map((f) => join(settings, f)).join('\n  ')}`
        : `No JMRI profile found in ${settings}; pass the profile folder path.`,
    )
    process.exit(1)
  }
  profile = join(settings, found[0])
}
if (!existsSync('dist/index.html')) {
  console.error('dist/ is missing; run `npm run build` first.')
  process.exit(1)
}

const target = join(profile, 'web', 'modern')
rmSync(target, { recursive: true, force: true })
cpSync('dist', target, { recursive: true })
console.log(`App installed in ${target}\n  → open http://<jmri-host>:12080/web/modern/`)

const jar = 'addon/dist/jmri-modern-ui-addon.jar'
if (!existsSync(jar)) {
  console.log('\nAdd-on not built (needs a JDK): run `npm run build:addon` to enable programming, Logix/LogixNG and train building.')
  process.exit(0)
}
const installedJar = join(settings, 'jmri-modern-ui-addon.jar')
copyFileSync(jar, installedJar)
console.log(`\nAdd-on copied to ${installedJar}`)

const option_ = `--cp:a=${installedJar}`
const conf = join(settings, 'jmri.conf')
const existing = existsSync(conf) ? readFileSync(conf, 'utf8') : ''
if (existing.includes(installedJar)) {
  console.log(`jmri.conf already loads it. Restart JMRI if it is running.`)
} else if (!flag('configure')) {
  console.log(`To load it, add this to ${conf} (or rerun with --configure) and restart JMRI:\n  default_options="${option_}"`)
} else if (/\s/.test(installedJar) || platform() === 'win32') {
  // The launcher splits default_options on spaces, and the Windows launcher has its own configuration.
  console.log(`Can't configure automatically here. Copy ${installedJar} into JMRI's lib folder instead, then restart JMRI.`)
} else {
  const line = /^default_options="([^"]*)"/m
  const updated = line.test(existing)
    ? existing.replace(line, (_, opts) => `default_options="${`${opts} ${option_}`.trim()}"`)
    : `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}default_options="${option_}"\n`
  if (existing) writeFileSync(`${conf}.bak`, existing)
  writeFileSync(conf, updated)
  console.log(`Updated ${conf}${existing ? ` (previous version in jmri.conf.bak)` : ''}. Restart JMRI to load the add-on.`)
}
