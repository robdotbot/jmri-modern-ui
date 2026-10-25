// Builds addon/dist/jmri-modern-ui-addon.jar against an installed JMRI.
//   node addon/build.mjs                      # JMRI in /Applications/JMRI (macOS) or $JMRI_HOME
//   JMRI_HOME=/opt/JMRI node addon/build.mjs
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const here = new URL('.', import.meta.url).pathname
const jmri = process.env.JMRI_HOME ?? (process.platform === 'darwin' ? '/Applications/JMRI' : '/opt/JMRI')
if (!existsSync(join(jmri, 'jmri.jar'))) {
  console.error(`jmri.jar not found in ${jmri}; set JMRI_HOME to your JMRI install folder.`)
  process.exit(1)
}

const classpath = [join(jmri, 'jmri.jar'), ...readdirSync(join(jmri, 'lib')).filter((f) => f.endsWith('.jar')).map((f) => join(jmri, 'lib', f))].join(delimiter)
const classes = join(here, 'build', 'classes')
const dist = join(here, 'dist')
rmSync(join(here, 'build'), { recursive: true, force: true })
mkdirSync(classes, { recursive: true })
mkdirSync(dist, { recursive: true })

const src = join(here, 'src', 'org', 'jmri', 'modernui')
const sources = readdirSync(src).filter((f) => f.endsWith('.java')).map((f) => join(src, f))
execFileSync('javac', ['--release', '11', '-Xlint:-options', '-cp', classpath, '-d', classes, ...sources], { stdio: 'inherit' })
cpSync(join(here, 'resources'), classes, { recursive: true })
const jar = join(dist, 'jmri-modern-ui-addon.jar')
execFileSync('jar', ['--create', '--file', jar, '-C', classes, '.'], { stdio: 'inherit' })
console.log(`Built ${jar}`)
