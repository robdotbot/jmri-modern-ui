// Copies dist/ into a JMRI profile's web/modern folder, which JMRI's web server
// serves at http://<jmri-host>:12080/web/modern/ — no changes to the JMRI install needed.
//
//   npm run deploy                         # the only profile in the default JMRI prefs folder
//   npm run deploy -- "/path/to/My Railroad.jmri"
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

const prefsRoot =
  platform() === 'darwin'
    ? join(homedir(), 'Library/Preferences/JMRI')
    : platform() === 'win32'
      ? join(homedir(), 'JMRI')
      : join(homedir(), '.jmri')

let profile = process.argv[2]
if (!profile) {
  const found = existsSync(prefsRoot) ? readdirSync(prefsRoot).filter((d) => d.endsWith('.jmri')) : []
  if (found.length !== 1) {
    console.error(
      found.length
        ? `Several JMRI profiles in ${prefsRoot}; pass one:\n  ${found.map((f) => join(prefsRoot, f)).join('\n  ')}`
        : `No JMRI profile found in ${prefsRoot}; pass the profile folder path.`,
    )
    process.exit(1)
  }
  profile = join(prefsRoot, found[0])
}
if (!existsSync('dist/index.html')) {
  console.error('dist/ is missing; run `npm run build` first.')
  process.exit(1)
}
const target = join(profile, 'web', 'modern')
rmSync(target, { recursive: true, force: true })
cpSync('dist', target, { recursive: true })
console.log(`Deployed to ${target}\nOpen http://<jmri-host>:12080/web/modern/`)
