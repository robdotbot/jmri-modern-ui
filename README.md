# JMRI Modern UI

A modern, mobile-first web front end for [JMRI](https://github.com/JMRI/JMRI). It replaces the Swing panels and the jQuery-era web pages for day-to-day operating and keeps JMRI itself as the engine: hardware connections (DCC-EX/DCC++, LocoNet, …), roster, turnouts, sensors, routes and logic.

It has two parts:

- **The web app** talks to JMRI only through JMRI's built-in **JSON/WebSocket server** (protocol v5, `ws://<host>:12080/json/`). It works with JMRI 5.x (tested against 5.6; the protocol is unchanged through 5.17).
- **An optional add-on jar** (`addon/`) adds what that server lacks: CV programming and DecoderPro's decoder definitions, viewing and editing Logix/LogixNG, editing panels, storing the configuration, a signal's valid aspects, and building/resetting trains. It plugs into JMRI's own extension point, so the JMRI install itself is never modified.

## What's in it

| Screen | What it does | Needs add-on |
|---|---|---|
| **Throttles** | Several throttles side by side. Roster or raw DCC address (short/long). Drag/keyboard speed slider that snaps to the decoder's step count. % or step readout. Fwd/Rev, Stop, E-Stop, 25/50/75/100% presets. Function buttons named from the roster's function labels; non-lockable ones (horn, whistle, coupler) are momentary (on only while held). Shows when another throttle shares the loco. Held throttles survive a page reload and a JMRI restart. If JMRI stops confirming a throttle's commands (see *Known JMRI issue* below), the card says so and offers **Turn track power off** and **Get a fresh throttle**. | |
| **Roster** | Cards with the roster photo, roster-group filter, search across name/road/number/address/model, details sheet with function map, one-tap **Drive**. | |
| **Consists** | Create an advanced consist on a short address, add locos from the roster or by address, set each loco's facing, remove locos, delete, and **Drive** the consist address. | |
| **Panels** | Your PanelPro panels, drawn in the browser: Layout Editor track (straight, arc and bezier segments, turnouts with the selected leg, single and double slips showing their route, turntables with the bridge on the lined-up ray, block occupancy colours) and Panel/Control Panel Editor icons and labels. Turnouts, slips (click either side, as in JMRI), turntable rays, sensors (including momentary buttons), lights, signal masts and heads are live and clickable, with the same click behaviour as JMRI's classic web panel. Fit-to-screen and zoom. **Edit** mode: drag icons and labels, add labels and sensor/turnout/light/signal mast/memory icons, change a label's text, delete items, and drag Layout Editor turnouts, slips, turntables and anchor points (connected track follows). | Editing |
| **Turnouts / Routes / Sensors / Lights / Blocks** | Live state grid (tap to throw/close, set a route, toggle sensors and lights). Search, create new objects, JMRI's internal bookkeeping objects hidden by default. | |
| **Signals** | Masts show the signal system's real aspect image; tap one to choose any valid aspect, hold it or turn it dark. Heads show a lamp (flashing ones animate) with their valid appearances. | Exact per-mast aspects (falls back to the signal system's appearance file) |
| **Memories** | Inline-editable values. | |
| **Operations** | **Trains**: status, route timeline with the current stop, **Build**, **Move to next stop**, **Terminate**, **Reset**, and the manifest (pick-ups and set-outs per stop). **Switch lists**: per location, every built train that stops there in time order with its pick-ups and set-outs by track, trains not yet built, and the cars on hand; printable. **Locations** with tracks and car counts. **Cars** and **Engines**: search everything, see location, destination and train, and move a car or engine to another location/track. | Build and reset |
| **Programming** | Programming track or on the main (address or roster loco). **Quick setup**: **Read decoder** identifies the maker and possible models from CV7/CV8 using JMRI's own decoder index, and shows the active address. Change address (short or long; CV1/17/18/29 computed for you). CV29 as switches. Read/write any CV with a bit view. **Decoder settings**: DecoderPro's panes for a roster loco's decoder (or one picked by maker and model, optionally detected): Basic, Motor, Speed Table, Function Map, Lights, Sound and the decoder's own panes, with named settings (lists, numbers, sliders, check boxes, split and indexed CVs, speed tables), read/write a pane or just the changes, and **Save to roster** like DecoderPro. Log of every operation. | Yes |
| **Logic** | Every Logix and LogixNG: enable or disable it, see what it does, and run a ConditionalNG now. Create, rename and delete them. Logix: add and delete conditionals and edit their conditions (sensors, turnouts, lights, memories, signals, other conditionals, fast clock), how they combine (all AND, all OR or an expression such as `R1 and (R2 or not R3)`) and their actions. LogixNG: add and delete ConditionalNGs and edit the tree: add an action or expression to an empty socket (If/then/else, Many, set turnout/sensor/light/memory/signal mast, delay; sensor/turnout/light/signal mast conditions, And, Or, Not), change an item's bean, state and other settings, disable or remove it. **Store…** saves the changes, as PanelPro's *Store tables and panels* does. | Yes |
| **Top bar** | Connection status, fast clock, track power toggle, **STOP** (e-stops every throttle on this device), light/dark theme. | |
| **Settings** | JMRI server address, per-connection track power, fast clock run/rate, JMRI and protocol versions. | |

Everything updates live: changes made from DecoderPro, PanelPro, WiThrottle, Engine Driver or another browser are pushed to every open page. On a phone the four most-used screens sit in the bottom bar and the rest are under **More**.

## Screenshots

Taken from JMRI 5.6 running the test railroad (`tests/fixtures/TestRailroad.jmri`) with the add-on.

### Throttles

Two locos on throttles; UP 844 at 50% with its headlight and bell on. Function names come from the roster.

![Throttles](docs/screenshots/throttles.png)

### Roster

![Roster](docs/screenshots/roster.png)

### Consists

An advanced consist on address 12, with the trailing loco reversed.

![Consists](docs/screenshots/consists.png)

### Panels

A Layout Editor panel with live turnouts, sensors and signal masts:

![Layout Editor panel](docs/screenshots/panel-layout-editor.png)

A Panel Editor panel (the Operations demo railroad):

![Panel Editor panel](docs/screenshots/panel-editor.png)

### Turnouts, Routes, Sensors, Lights, Blocks

![Turnouts](docs/screenshots/turnouts.png)

![Sensors](docs/screenshots/sensors.png)

### Signals

![Signals](docs/screenshots/signals.png)

Tapping a mast offers its valid aspects, with Held and Lit:

![Signal aspects](docs/screenshots/signal-aspects.png)

### Memories

![Memories](docs/screenshots/memories.png)

### Operations

Trains with their route timeline; train BB is built and waiting to move to Port Arthur:

![Trains](docs/screenshots/operations-trains.png)

Its manifest:

![Manifest](docs/screenshots/operations-manifest.png)

Cars (engines work the same way):

![Cars](docs/screenshots/operations-cars.png)

### Programming

**Read decoder** on the programming track: the maker and possible models from CV7/CV8, and the active address.

![Programming](docs/screenshots/programming.png)

### Logic

![Logic](docs/screenshots/logic.png)

A LogixNG's tree:

![LogixNG](docs/screenshots/logic-logixng.png)

### Settings

![Settings](docs/screenshots/settings.png)

### Dark theme

![Dark theme](docs/screenshots/throttles-dark.png)

### On a phone

<p>
  <img src="docs/screenshots/phone-throttle.png" width="260" alt="Throttle on a phone">
  <img src="docs/screenshots/phone-panel.png" width="260" alt="Panel on a phone">
  <img src="docs/screenshots/phone-more.png" width="260" alt="The More menu on a phone">
</p>

## Install

Download the installer for your computer from the [latest release](https://github.com/robdotbot/jmri-modern-ui/releases/latest), quit JMRI and run it. Both installers contain the app and the add-on.

- **Windows** (`JMRI-Modern-UI-<version>-windows-setup.exe`): puts the app in `%USERPROFILE%\JMRI\web\modern` and the add-on in JMRI's `lib` folder (it finds JMRI in Program Files, or asks). Remove it from **Settings → Apps**. If the release's installer is unsigned, SmartScreen warns about an unrecognised app: **More info → Run anyway**.
- **Mac** (`JMRI-Modern-UI-<version>-macos.pkg`): puts the app in `~/Library/Preferences/JMRI/web/modern` and the add-on next to it, loaded through `jmri.conf`. If the release's package isn't notarized, open it the first time with **right-click → Open**. Remove it with `sudo "/Library/Application Support/JMRI Modern UI/uninstall.sh"`.

The app goes in the JMRI settings folder, which JMRI's web server serves for every profile, so it survives JMRI upgrades. The Windows add-on lives in JMRI's `lib` folder, so run the installer again after upgrading JMRI. Then follow steps 1, 2 and 4 below.

To make a release: set the version in `package.json`, then push a matching tag (`git tag v0.3.0 && git push origin v0.3.0`). `.github/workflows/release.yml` builds the app, compiles the add-on against JMRI 5.6, builds both installers and publishes them as a GitHub release. On pull requests it builds the installers as workflow artifacts without publishing.

### Code signing

The workflow signs the installers when these repository secrets (**Settings → Secrets and variables → Actions**) are set, and builds them unsigned when they aren't. The release notes say which.

**Mac** (needs an [Apple Developer Program](https://developer.apple.com/programs/) membership):

| Secret | Value |
|---|---|
| `MACOS_INSTALLER_P12_BASE64` | A **Developer ID Installer** certificate with its private key: create it in your developer account (Certificates → +), install it, export it from Keychain Access as `.p12`, then `base64 -i installer.p12 \| pbcopy`. |
| `MACOS_INSTALLER_P12_PASSWORD` | The password you gave the `.p12`. |
| `APPLE_ID` | The Apple ID of the developer account. |
| `APPLE_APP_PASSWORD` | An [app-specific password](https://support.apple.com/102654) for that Apple ID. |
| `APPLE_TEAM_ID` | Your team ID (Membership details in the developer account). |

The package is signed, sent to Apple's notary service, and the notarization ticket is stapled to it, so Gatekeeper opens it without a warning. With only the first two secrets it is signed but not notarized, which Gatekeeper still blocks.

**Windows**, either of:

- **[Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/)** (Microsoft's signing service, about $10 a month). Create a Trusted Signing account and a public-trust certificate profile, and an app registration with a client secret that has the *Trusted Signing Certificate Profile Signer* role on the account. Secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`; variables (same page, **Variables** tab) `TRUSTED_SIGNING_ENDPOINT` (e.g. `eus.codesigning.azure.net`), `TRUSTED_SIGNING_ACCOUNT`, `TRUSTED_SIGNING_PROFILE`.
- **A code-signing certificate in a `.pfx` file**: secrets `WINDOWS_CERT_PFX_BASE64` (`base64 -w0 cert.pfx`) and `WINDOWS_CERT_PASSWORD`. Certificates issued since mid-2023 are kept on a hardware token or a cloud HSM and can't be exported to a `.pfx`; for those, use the provider's signing service or Trusted Signing.

The installer and the uninstaller inside it are signed with [jsign](https://ebourg.github.io/jsign/) from `installer/windows/sign.sh`, timestamped, and checked with Windows' own `Get-AuthenticodeSignature`. SmartScreen can still warn about a newly signed installer until it has been downloaded enough to build a reputation.

## Use it with your JMRI (from source)

1. In JMRI (PanelPro/DecoderPro): **Preferences → Start Up → Add → Perform action → Start Web Server**. Restart JMRI.
2. To let browsers switch track power: **Preferences → Web Server**, untick **"Web clients can't change track power"**.
3. Build and install:
   ```sh
   npm install
   npm run build:addon            # optional; needs a JDK 11+ and JMRI in /Applications/JMRI (or set JMRI_HOME)
   npm run deploy -- --configure  # app into your profile, add-on into the JMRI settings folder, jmri.conf updated
   ```
   `deploy` finds your profile in the JMRI settings folder (`~/Library/Preferences/JMRI` on a Mac, `~/.jmri` on Linux, `%USERPROFILE%\JMRI` on Windows), or pass one: `npm run deploy -- "/path/to/Profile.jmri"`. Without `--configure` it only prints the `jmri.conf` line to add.
4. Restart JMRI, then open **`http://<jmri-computer>:12080/web/modern/`** on any phone, tablet or laptop on the same network. On a phone, use "Add to Home Screen" to get a full-screen app.

What `deploy` changes, and how to undo it:

- The app goes in `<profile>/web/modern/`, which JMRI's web server already serves. Delete that folder to remove it.
- The add-on goes to `<settings>/jmri-modern-ui-addon.jar`. With `--configure`, `<settings>/jmri.conf` gets `--cp:a=<that jar>` added to `default_options`, keeping any options already there; the old file is saved as `jmri.conf.bak`.
- On Windows, or when the settings path contains spaces, the launcher can't take the jar from `jmri.conf`. Copy the jar into JMRI's `lib` folder instead; JMRI loads every jar there.

**Panels** come from PanelPro: a panel shows up once it is open in PanelPro, for example loaded at Start Up. JMRI can't provide panels when it runs without a screen (JmriFaceless).

## Develop

```sh
npm run dev                                    # proxies /json, /panel, /operations, images… to localhost:12080
JMRI_URL=http://192.168.0.50:12080 npm run dev # or another JMRI
npm run build && npm run typecheck && npm run lint
npm run build:addon                            # the Java add-on
```

You don't need a real layout for development. A JMRI profile whose connection is the **DCC++ Simulator** behaves like a command station: it acquires throttles, records speed and functions, toggles power, and answers programming-track reads and writes.

### Testing

`tests/fixtures/TestRailroad.jmri` is a throwaway JMRI profile. It uses the DCC++ Simulator connection, starts the web server, and loads:
- four roster locos with function labels;
- signal masts, Logix, layout blocks and a Layout Editor panel (`layout/signals-logix-panel.xml`);
- a LogixNG (`layout/logixng.xml`);
- the JMRI Operations demo railroad: trains, routes, locations, 210 cars, 19 engines and its Panel Editor panel.

These files come from JMRI's own test suite (GPL-2.0).

```sh
cp -R tests/fixtures/TestRailroad.jmri /tmp/              # JMRI writes into the profile
npm run build && npm run build:addon
(cd /Applications/JMRI && java -Djava.awt.headless=true -Dorg.jmri.profile=/tmp/TestRailroad.jmri \
  -cp "jmri.jar:lib/*:$OLDPWD/addon/dist/jmri-modern-ui-addon.jar" apps.JmriFaceless) &
npm run deploy -- /tmp/TestRailroad.jmri --settings=/tmp
npx playwright install chromium
npm run test:e2e           # tests/e2e.mjs (40 checks) + tests/e2e-features.mjs (55 checks)
```

`tests/e2e-panel-edit.mjs` (10 checks) needs panels JMRI really has open, which takes a JMRI with a screen: run PanelPro on the same profile instead of JmriFaceless, then `npm run test:e2e:panels`. Without open panels it reports SKIP.

Every UI action is verified independently, never through the UI under test:
- Throttle speed, direction and functions, through a second WebSocket throttle sharing the loco.
- CVs, through a separate programmer client (including an indexed CV programmed through a decoder definition's facades).
- Named decoder settings, by reading the CVs they map to; Save to roster, by reading the roster entry back.
- Logix and LogixNG built in the UI, by changing their sensor through REST and checking the turnout they drive; Store, by reading the file JMRI wrote.
- Panel edits, in the XML JMRI's panel servlet produces from the live panel.
- Switch lists, against each train's manifest.
- Turnouts, sensors, lights, memories, power, signal aspects, held state, Logix/LogixNG enable state, consist members and directions, train build/move/terminate and car locations, through JMRI's REST API.

The tests also cover:
- reload persistence and live pushes of changes made elsewhere;
- block occupancy colour;
- slips and turntables (route and bridge drawn from their turnouts, clicks set the right turnouts);
- a 390 px phone layout on every screen;
- the throttle safety net: with JMRI's throttle replies cut off, the card must warn, its power-off button must work, and a stalled acquisition must be explained.

With the same JMRI running, `node scripts/screenshots.mjs` retakes the README screenshots into `docs/screenshots/`. It sets up some state (turnout and sensor states, a consist, a built train, decoder CVs) and removes the consist and resets the train afterwards.

Headless JMRI can't open panels. The panel tests therefore serve the panel XML captured from PanelPro (`tests/fixtures/panels/`) in place of `/panel`, while every turnout, sensor and signal they click is live JMRI. `Layout-Yard Throat.xml` is made by hand in the servlet's format to cover slips and a turntable.

`tests/e2e-noaddon.mjs` checks the app with JMRI started *without* the add-on:
- Programming and Logic explain how to install it.
- Signals fall back to the appearance files.
- Train building is disabled.

### Layout

```
src/jmri/protocol.ts   JSON protocol v5 types and state constants (from JMRI's JSON.java)
src/jmri/client.ts     WebSocket client: connect/heartbeat/reconnect, subscriptions, store, requests, throttles
src/jmri/panel.ts      Parser for /panel XML (Layout Editor geometry, positionable icons)
src/jmri/decoders.ts   Decoder identification from JMRI's decoder index; CV29/long-address helpers
src/jmri/decoderDef.ts DecoderPro decoder definitions and panes: variables, masks, split CVs, qualifiers, pane merging
src/state.tsx          React bindings (useSyncExternalStore), routing, theme, persistence
src/views/*            Screens
addon/                 JMRI add-on: JSON types programmer, logix, logixng, signalAspects, trainAction,
                       decoderDefinition, rosterCvs, storeConfig, panelEdit
scripts/deploy.mjs     Installs the app and add-on
scripts/screenshots.mjs  Retakes the README screenshots
```

### The add-on's JSON types

| Type | Messages |
|---|---|
| `programmer` | `get` returns the programmer's status and modes. `post {op:"read"\|"write", cv, value?, mode?, address?, isLongAddress?, decoderFile?}` answers with `{op, cv, value, ok, status, message, mode}`, tagged with your request `id`, once the decoder replies. With `address` it programs on the main. With `decoderFile` it programs through the facades that decoder definition declares, as DecoderPro does (needed for indexed CVs such as `16.2.257`). A second request while one is running gets a 409 error. |
| `decoderDefinition` | `get {file}` returns a decoder definition from `xml/decoders`, `get {programmer}` a programmer (pane) file (`""` for DecoderPro's default), as `{xml}` with XIncludes resolved by JMRI. |
| `rosterCvs` | `get {name}` returns a roster entry's decoder family/model, its definition file and the CV values DecoderPro stored. `post {name, values:{cv:{value,state}}, decoderFamily?, decoderModel?}` stores them in the roster entry (a backup is kept). |
| `logix`, `logixng` | `list` and `get` return each Logix/LogixNG with its conditionals (variables and actions as editable fields) or ConditionalNGs (text tree plus a node tree with each item's editable settings). `post {name, enabled}` enables or disables one; for a ConditionalNG, `post {name, execute:true}` runs it. `post {op, ...}` edits: Logix `create`, `rename`, `delete`, `addConditional`, `deleteConditional`, `updateConditional`; LogixNG `create`, `rename`, `delete`, `addConditionalNG`, `deleteConditionalNG`, and on a ConditionalNG's tree (`path` of socket indexes) `add`, `edit`, `remove`, `setEnabled`. A `list` subscribes you to enable/disable changes. |
| `storeConfig` | `get` lists the configuration files JMRI loaded; `post {file}` stores tables and panels to one of them, like PanelPro's *Store*. |
| `panelEdit` | `post {name: panel title, op}`: `move`, `delete` and `text` (with `target {tag, x, y, bean?}` as the panel servlet describes the item), `add` (`kind` label/sensor/turnout/light/signalMast/memory, `bean` or `text`, `x`, `y`), `moveTrack` (`ident`, `x`, `y`). Needs panels open in a JMRI with a screen. |
| `signalAspects` | `get {name}` returns a mast's valid aspects with their image URLs, plus its held and dark images, or a head's valid appearances. |
| `trainAction` | `post {name:<train id>, action:"build"\|"reset"\|"move"\|"terminate"}` |
| `modernUiAddon` | `get` returns `{version}`, so the app can tell the add-on is installed. |

### Protocol notes that shaped the client

- The server sends `hello` on connect. The client **never sends `hello` back**: doing so resets every service on that connection, which drops all subscriptions and releases all throttles.
- A `list` does not subscribe to anything. The client sends a `get` for every listed object to receive change pushes. Whenever a manager's contents change, JMRI also pushes the whole list unprompted.
- The server idles a socket out after `heartbeat × 1.1`. The client pings at the interval given in `hello`.
- Throttle replies never carry the request `id`, and acquisition is asynchronous. Updates arrive as partial pushes (`{speed}`, `{"F3":true}`), which the client merges by throttle `name`.
- E-stop shows up as a negative speed.
- Signal `held` and `lit` are only honoured when sent as strings (`"true"`).
- Consists:
  - A loco's direction only applies when it joins a consist, so the client flips a loco by removing it and adding it back.
  - Any WebSocket message about a consist makes JMRI attach a listener that re-creates the consist when it is deleted. So the client makes every consist change through REST, which attaches nothing. JMRI 5.6 also needs a JSON body on that `DELETE`, or it answers 500.
  - Each membership change writes CV19 on the locos, so it takes a few seconds.
- JMRI 5.6 doesn't push layout block colour changes. The panel renderer works out occupancy from each block's occupancy sensor instead.
- The panel servlet labels its XML as `application/json`, and its list uses `URL` (upper case).

## Known JMRI issue: a shared throttle can stop responding

When two clients share a loco (two phones, or a phone and Engine Driver) and one of them vanishes without closing its connection (it goes to sleep or drops off Wi-Fi), JMRI 5.6 can stop applying the other client's commands for that loco, **Stop included**. It also stops pushing updates for it, and sometimes no new client can acquire the loco until JMRI is restarted. Other locos keep working.

- **Reproducing it:** `node tests/jmri-issues/shared-throttle-ghost.mjs <address>` reproduces it against a running JMRI in most runs.
- **Cause:** not found yet. Guarding `JsonThrottle.release()` against releasing the same client twice did *not* fix it.

This app can't fix it, but it makes it visible:
- Every command that changes something must be confirmed by JMRI within about 2.5 s. If not, the throttle card turns red, says its Stop may not work, and offers **Turn track power off** and **Get a fresh throttle**.
- If a loco can't be acquired at all, the card says so after a few seconds and suggests turning power off and restarting JMRI.

## Edits and storing

Logic and panel edits change JMRI straight away (PanelPro and every browser see them), but like edits in PanelPro they are only kept if the configuration is stored. **Store…** on the Logic and Panels screens does what PanelPro's *Store tables and panels* does, to one of the files JMRI loaded at start up; it writes everything JMRI has loaded into that file and keeps a backup of the old one. Until then the screens show *Not stored yet*.

## Not yet

- Signal mast logic, warrants and dispatcher.
- Traversers (new in JMRI 5.13) aren't drawn on Layout Editor panels.
- Panel editing covers moving, adding (labels and the common icons, with PanelPro's default look) and deleting items, label text, and moving Layout Editor track. Drawing new track, icon sets, rotation and scaling, and Switchboards still need PanelPro.
- LogixNG items other than the common ones listed above can be changed, disabled and removed here but not added; Logix condition and action types other than those listed are kept as they are and edited in PanelPro.
- Decoder settings: DecoderPro's Roster, Function Labels and Print panes, and a few rarely used value types (text, date/time, indexed pairs), which show their CV numbers instead.
