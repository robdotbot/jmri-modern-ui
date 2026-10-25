# JMRI Modern UI

A modern, mobile-first web front end for [JMRI](https://github.com/JMRI/JMRI). It replaces the Swing panels and the jQuery-era web pages for day-to-day operating and keeps JMRI itself as the engine: hardware connections (DCC-EX/DCC++, LocoNet, …), roster, turnouts, sensors, routes and logic.

It talks to JMRI only through JMRI's built-in **JSON/WebSocket server** (protocol v5, `ws://<host>:12080/json/`). Nothing in JMRI is patched, and it works with JMRI 5.x (tested against 5.6; the protocol is unchanged through 5.17).

## What's in it

| Screen | What it does |
|---|---|
| **Throttles** | Several throttles side by side. Roster or raw DCC address (short/long). Drag/keyboard speed slider that snaps to the decoder's step count. % or step readout. Fwd/Rev, Stop, E-Stop, 25/50/75/100% presets. Function buttons named from the roster's function labels; non-lockable ones (horn, whistle, coupler) are momentary (on only while held). Shows when another throttle shares the loco. Held throttles survive a page reload and a JMRI restart. |
| **Roster** | Cards with the roster photo, roster-group filter, search across name/road/number/address/model, details sheet with function map, one-tap **Drive**. |
| **Turnouts / Routes / Sensors / Lights / Blocks** | Live state grid (tap to throw/close, set a route, toggle sensors and lights). Search, create new objects, JMRI's internal bookkeeping objects hidden by default. |
| **Memories** | Inline-editable values. |
| **Top bar** | Connection status, fast clock, track power toggle, **STOP** (e-stops every throttle on this device), light/dark theme. |
| **Settings** | JMRI server address, per-connection track power, fast clock run/rate, JMRI and protocol versions. |

Everything updates live: changes made from DecoderPro, PanelPro, WiThrottle, Engine Driver or another browser are pushed to every open page.

## Use it with your JMRI

1. In JMRI (PanelPro/DecoderPro): **Preferences → Start Up → Add → Perform action → Start Web Server**. Restart JMRI.
2. To let browsers switch track power: **Preferences → Web Server**, untick **"Web clients can't change track power"**. Your current profile has this set to read-only (`jmri-web-server.readonlyPower=true`).
3. Build and install into your JMRI profile:
   ```sh
   npm install
   npm run deploy            # auto-finds the single profile in ~/Library/Preferences/JMRI
   # or: npm run deploy -- "/path/to/Profile.jmri"
   ```
4. Open **`http://<jmri-computer>:12080/web/modern/`** on any phone, tablet or laptop on the same network. On a phone, use "Add to Home Screen" to get a full-screen app.

Deploying only copies the built files into `<profile>/web/modern/`. JMRI's web server already serves that folder. Delete the folder to uninstall.

## Develop

```sh
npm run dev                                    # proxies /json and /roster to localhost:12080
JMRI_URL=http://192.168.0.50:12080 npm run dev # or another JMRI
npm run build && npm run typecheck && npm run lint
```

You don't need a real layout for development. A JMRI profile whose connection is the **DCC++ Simulator** behaves like a command station: it acquires throttles, records speed and functions, and toggles power.

### Testing

`tests/fixtures/TestRailroad.jmri` is a throwaway JMRI profile. It uses the DCC++ Simulator connection, starts the web server, and has four roster locos with function labels. Run JMRI headless on it, deploy, then run the end-to-end test:

```sh
cp -R tests/fixtures/TestRailroad.jmri /tmp/                     # JMRI writes into the profile
(cd /Applications/JMRI && java -Djava.awt.headless=true \
  -Dorg.jmri.profile=/tmp/TestRailroad.jmri -cp "jmri.jar:lib/*" apps.JmriFaceless) &
npm run deploy -- /tmp/TestRailroad.jmri
npx playwright install chromium && npm run test:e2e
```

The test checks 29 things. Every UI action is verified independently: throttle speed, direction and functions through a second WebSocket throttle sharing the loco; turnouts, sensors, lights, memories and power through JMRI's REST API. It also covers reload persistence, live pushes of changes made elsewhere, and a 390 px phone layout with no horizontal overflow.

### Layout

```
src/jmri/protocol.ts   JSON protocol v5 types and state constants (from JMRI's JSON.java)
src/jmri/client.ts     WebSocket client: connect/heartbeat/reconnect, subscriptions, store, throttles
src/state.tsx          React bindings (useSyncExternalStore), routing, theme, persistence
src/views/*            Screens
scripts/deploy.mjs     Copies dist/ into a JMRI profile
```

### Protocol notes that shaped the client

- The server sends `hello` on connect. The client **never sends `hello` back**: doing so resets every service on that connection, which drops all subscriptions and releases all throttles.
- A `list` does not subscribe to anything. The client sends a `get` for every listed object to receive change pushes. Whenever a manager's contents change, JMRI also pushes the whole list unprompted.
- The server idles a socket out after `heartbeat × 1.1`. The client pings at the interval given in `hello`.
- Throttle replies never carry the request `id`, and acquisition is asynchronous. Updates arrive as partial pushes (`{speed}`, `{"F3":true}`), which the client merges by throttle `name`.
- E-stop shows up as a negative speed.

## Not yet

This covers operating sessions, not everything JMRI does. Still Swing-only:
- CV programming (DecoderPro).
- Layout and panel editors. Panels can still be viewed in the classic web UI at `/panel/`.
- Signal masts and heads.
- Logix/LogixNG editing.
- Operations (trains, cars, switch lists).
- Consists.

Signals, consists and panel rendering are all available over the same JSON API and are the natural next screens.
