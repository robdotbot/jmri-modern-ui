# JMRI Modern UI

A modern, mobile-first web front end for [JMRI](https://github.com/JMRI/JMRI). It replaces the Swing panels and the jQuery-era web pages for day-to-day operating and keeps JMRI itself as the engine: hardware connections (DCC-EX/DCC++, LocoNet, …), roster, turnouts, sensors, routes and logic.

It has two parts:

- **The web app** talks to JMRI only through JMRI's built-in **JSON/WebSocket server** (protocol v5, `ws://<host>:12080/json/`). It works with JMRI 5.x (tested against 5.6; the protocol is unchanged through 5.17).
- **An optional add-on jar** (`addon/`) adds what that server lacks: CV programming, Logix/LogixNG, a signal's valid aspects, and building/resetting trains. It plugs into JMRI's own extension point, so the JMRI install itself is never modified.

## What's in it

| Screen | What it does | Needs add-on |
|---|---|---|
| **Throttles** | Several throttles side by side. Roster or raw DCC address (short/long). Drag/keyboard speed slider that snaps to the decoder's step count. % or step readout. Fwd/Rev, Stop, E-Stop, 25/50/75/100% presets. Function buttons named from the roster's function labels; non-lockable ones (horn, whistle, coupler) are momentary (on only while held). Shows when another throttle shares the loco. Held throttles survive a page reload and a JMRI restart. If JMRI stops confirming a throttle's commands (see *Known JMRI issue* below), the card says so and offers **Turn track power off** and **Get a fresh throttle**. | |
| **Roster** | Cards with the roster photo, roster-group filter, search across name/road/number/address/model, details sheet with function map, one-tap **Drive**. | |
| **Consists** | Create an advanced consist on a short address, add locos from the roster or by address, set each loco's facing, remove locos, delete, and **Drive** the consist address. | |
| **Panels** | Your PanelPro panels, drawn in the browser: Layout Editor track (straight, arc and bezier segments, turnouts with the selected leg, block occupancy colours) and Panel/Control Panel Editor icons and labels. Turnouts, sensors (including momentary buttons), lights, signal masts and heads are live and clickable, with the same click behaviour as JMRI's classic web panel. Fit-to-screen and zoom. | |
| **Turnouts / Routes / Sensors / Lights / Blocks** | Live state grid (tap to throw/close, set a route, toggle sensors and lights). Search, create new objects, JMRI's internal bookkeeping objects hidden by default. | |
| **Signals** | Masts show the signal system's real aspect image; tap one to choose any valid aspect, hold it or turn it dark. Heads show a lamp (flashing ones animate) with their valid appearances. | Exact per-mast aspects (falls back to the signal system's appearance file) |
| **Memories** | Inline-editable values. | |
| **Operations** | **Trains**: status, route timeline with the current stop, **Build**, **Move to next stop**, **Terminate**, **Reset**, and the manifest (pick-ups and set-outs per stop). **Locations** with tracks and car counts. **Cars** and **Engines**: search everything, see location, destination and train, and move a car or engine to another location/track. | Build and reset |
| **Programming** | Programming track or on the main (address or roster loco). **Read decoder** identifies the maker and possible models from CV7/CV8 using JMRI's own decoder index, and shows the active address. Change address (short or long; CV1/17/18/29 computed for you). CV29 as switches. Read/write any CV with a bit view. Log of every operation. | Yes |
| **Logic** | Every Logix and LogixNG: enable or disable it, see what it does (conditionals with their variables and actions; the LogixNG tree), and run a ConditionalNG now. | Yes |
| **Top bar** | Connection status, fast clock, track power toggle, **STOP** (e-stops every throttle on this device), light/dark theme. | |
| **Settings** | JMRI server address, per-connection track power, fast clock run/rate, JMRI and protocol versions. | |

Everything updates live: changes made from DecoderPro, PanelPro, WiThrottle, Engine Driver or another browser are pushed to every open page. On a phone the four most-used screens sit in the bottom bar and the rest are under **More**.

## Use it with your JMRI

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
npm run test:e2e           # tests/e2e.mjs (40 checks) + tests/e2e-features.mjs (30 checks)
```

Every UI action is verified independently, never through the UI under test:
- Throttle speed, direction and functions, through a second WebSocket throttle sharing the loco.
- CVs, through a separate programmer client.
- Turnouts, sensors, lights, memories, power, signal aspects, held state, Logix/LogixNG enable state, consist members and directions, train build/move/terminate and car locations, through JMRI's REST API.

The tests also cover:
- reload persistence and live pushes of changes made elsewhere;
- block occupancy colour;
- a 390 px phone layout on every screen;
- the throttle safety net: with JMRI's throttle replies cut off, the card must warn, its power-off button must work, and a stalled acquisition must be explained.

Headless JMRI can't open panels. The panel tests therefore serve the panel XML captured from PanelPro (`tests/fixtures/panels/`) in place of `/panel`, while every turnout, sensor and signal they click is live JMRI.

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
src/state.tsx          React bindings (useSyncExternalStore), routing, theme, persistence
src/views/*            Screens
addon/                 JMRI add-on: JSON types programmer, logix, logixng, signalAspects, trainAction
scripts/deploy.mjs     Installs the app and add-on
```

### The add-on's JSON types

| Type | Messages |
|---|---|
| `programmer` | `get` returns the programmer's status and modes. `post {op:"read"\|"write", cv, value?, mode?, address?, isLongAddress?}` answers with `{op, cv, value, ok, status, message, mode}`, tagged with your request `id`, once the decoder replies. With `address` it programs on the main. A second request while one is running gets a 409 error. |
| `logix`, `logixng` | `list` and `get` return each Logix/LogixNG with its conditionals or ConditionalNG trees. `post {name, enabled}` enables or disables one; for a ConditionalNG, `post {name, execute:true}` runs it. A `list` subscribes you to enable/disable changes. |
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

## Not yet

- Editing panels or Logix/LogixNG. Both are shown and operable here; build and change them in PanelPro.
- DecoderPro's decoder-definition panes (sound, lighting, speed tables by name). Programming here works at the CV level, plus decoder identification, address and CV29.
- Signal mast logic, warrants, dispatcher, and switch lists. Train manifests are covered.
- Slip, turntable and traverser drawing on Layout Editor panels.
