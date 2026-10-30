# Vereda Orbital desktop

A Vereda Labs theme for Omarchy with a live background: the Orbital from
veredalabs.dev's lookdev, framed after the Culture "Orbital" painting (band
sweeping up into a ribbon, black sky, no ship).

The sun follows your clock, the clouds follow your weather, thunderstorms bring
lightning, meteor showers fall on their real dates, and each Claude Code session
can ride alongside as a named ship.

- `install.sh` builds the shader, installs the theme and the live background, applies them.
- `hooks.py add` turns on the session lights (it edits Claude Code's settings, so it is its own step).
- `revert.sh` goes back to the previous theme and the stock background, and removes the hooks.

Clone it to `~/.local/share/vereda-orbital` (the hooks and the plugin look for it there).
It needs Omarchy 4 (its Quickshell shell, Hyprland 0.56), `qt6-shadertools` for `qsb`,
`jq`, `curl` and ImageMagick; Python 3 for the hooks.

## How the live background works

`plugin/Background.qml` is Omarchy's background plugin with one addition: when
the current background file is named `orbital-live.*`, `OrbitalLive` draws the
scene on top of it, with the look read from `orbital-live.json` beside it. The
image is the same scene at t=0, so the hand-over is invisible, and it is what the
lock screen and theme picker show.

A full 1080p frame costs ~40 ms on the Intel iGPU, so `OrbitalLive` renders each
new frame one horizontal slice per tick (12 slices, 60 ms apart) into a spare
buffer while the two newest frames crossfade. It only runs while the desktop on
that screen has no windows, and ticks half as often on battery. Measured on this
laptop: GPU ~37% busy at its lowest clock (~166 MHz) while animating, idle otherwise.

## Day and night

The sun follows the local clock: the Orbital turns under its star once a day, on a
path tilted 12.7° out of the ring plane (chosen so 14:33 is exactly the approved
afternoon look). Evenings, the band below goes dark while the ribbon climbing into
the sky stays sunlit; nights are navy with town lights on the sea and faint
ringshine from the lit far side; at dawn the sun rises past the band's edge with
its diffraction spikes. Each live frame takes the hour it starts in, and while
windows cover the desktop a short refresh every five minutes keeps the light in
the gaps current. `dayCycle`, `noon`, `sunTilt`, `lights`, `ringshine` and
`nightExposure` in `look.json` tune it; `"hour": 19.5` pins a time for stills.
The theme's still (lock screen, startup) stays the afternoon look.

## Weather

`OrbitalWeather` reads the current weather every 15 minutes from Open-Meteo, for
the same place as the bar's weather (a location set in its panel, else wttr.in's
guess from the connection). `Scene.weatherLook` turns it into the look: cloud
cover through a curve measured on the afternoon look (40% outside covers 40% of
the band), high cloud longer and wispier, rain greyer and darker, fog hazier,
snow whiter, wind faster, and a full overcast exposed darker so its texture
shows. Changes ease in over a couple of minutes. In a thunderstorm,
`OrbitalLightning` strikes every few seconds: `flash.frag.qsb` (the same shader
built with `-DFLASH`) lights the real cloud deck around a point on the band, in a
small box, as added light that flickers for under half a second. `"weather": false`
in `look.json` turns it off.

Preview any weather on the desktop, and go back to the real one:

    omarchy-shell orbital weather '{"cover":100,"code":95,"precip":8,"wind":40}'
    omarchy-shell orbital weather ''
    omarchy-shell orbital status

or as a still: `ORBITAL_WEATHER='{"cover":95,"code":63,"precip":3}' ./render-still.sh /tmp/rain.png 1280 720`.
Fields: `cover`/`low`/`mid`/`high` (%), `code` (WMO), `precip` (mm/h), `wind` (km/h), `visibility` (m).

## Session lights

Each Claude Code session on this machine is a ship moored off the band's near
edge, oldest nearest, named from the site's list (`Scene.shipsFor`) with its
project: a steady cool light while it works ("underway"), an amber pulse when a
permission prompt or question is waiting on you ("needs you"), a dim warm light
with a flare when its turn ends ("holding"); it fades out when the session ends.
`presence.sh`, run by Claude Code's hooks, keeps `~/.cache/vereda-orbital/sessions.json`
(and prunes sessions whose process has gone); `OrbitalSessions` reads it every
two seconds. The hooks live in Claude Code's own settings, so turning them on is
a step of its own: `./hooks.py add` (and `./hooks.py remove`). Sessions already
running pick them up after a restart.

## Lock screen

The lock screen shows a blur of the background image file, so every ten minutes
(and on the first frame) the Orbital as it is right now, frames only, replaces
that file in the current theme state; the next lock, and the next start, show
the current hour and weather.

## Meteors

`Scene.meteorsOn(date)` holds the major showers on their real dates (Quadrantids
to Ursids, with the broad autumn Taurids and their fireballs) plus sporadic ones.
At the night's rate, `OrbitalMeteors` burns one through the Orbital's air ~90 km
over the band, along its shower's direction, bright over the night side and faint
by day. Preview a peak with `omarchy-shell orbital meteors geminids` (`''` goes
back); `omarchy-shell orbital status` lists tonight's showers and rate.

## The ship, its drone and its signals

This machine is a ship too: `"ship"` in `look.json` (GCU *Still Reading The
Manual*, the studio's own) names it for the pieces below.

- **The drone** (`drone/`, the `vereda.drone` bar widget): a small casing in an
  aura field that shows the sessions' mood, as Culture drones do: quiet grey-blue
  with nothing alongside, calm blue with sessions holding, a slow cyan breath while
  any are underway, an amber pulse when one needs you, a green flash as one
  finishes its turn. Hover lists the sessions as ships; a click jumps to the
  terminal of the one that needs you (`presence.sh focus`). It breathes at about
  12 frames a second, not the display's rate.
- **The ship's field**: while the theme is on, the drone tints the active window's
  border amber whenever a session needs you, and puts the theme's colours back after.
- **Signal traffic**: `notifications/patch.py` patches a clone of Omarchy's
  notifications so each arrives as in *Excession*: a transmission line (tight point,
  M16 for normal; broadcast, M32 for critical; swept, M4 for low), then `x` the sender
  (a ship named for the app, or the Hub for Omarchy's own) and `o` this machine's ship,
  the text in Manrope. Re-running it on a fresh clone patches it again.

## The way in

At login the Vereda Labs mark sits centred on black and names the ship, then zooms into
the Orbital in one smooth 3D move: its long stroke, a strip in space, grows in place while
it turns and tilts toward the band, both ends reaching outward together, and bends onto the
ring until it is the band's whole visible arc, edge to edge. Once it covers most of the band (70%, measured as the intro starts) its ivory thins into the
Orbital beneath as it goes and the dark lifts around it (`OrbitalIntro.qml`, about six
seconds). Every frame is projected through the scene's own camera (`Scene.introRibbon3`),
so the near end widens because it really comes toward you, and the strip ends exactly on
the band.
It plays when the shell starts within 90 s of Hyprland (whose instance signature
carries its start time), so restarting the shell later does not replay it;
`omarchy-shell orbital intro` does.

The theme's `unlock.png` is the same mark at the size the intro starts from, so the
boot screen leads straight into it. Applying it to the boot screen needs root, so it
is yours to run: `omarchy plymouth set by theme vereda-orbital`
(`omarchy plymouth reset` undoes it).

## Changing the look

Edit `theme/look.json` (camera, sun, clouds, colours; every key is described in
`shader/Scene.js`) and run `install.sh`. To try values without installing:

    ./render-still.sh /tmp/try.png 1280 720 '{"clouds":0.5,"roll":-45}'

`render-still.sh` takes logical sizes; output is scaled by the display (1.5 here).
`ORBITAL_BENCH=4` times four frames. `quickshell -p shader/live-test.qml` runs the
live component offscreen and saves snapshots (set `ORBITAL_OUT`);
`quickshell -p shader/burst-test.qml` checks the paused refresh;
`quickshell -p shader/storm-peak.qml` saves a thunderstorm frame at a flash's peak;
`quickshell -p shader/extras-test.qml` shows three fake sessions and meteors and
writes a lock-screen snapshot.

Two Qt rules the live component depends on: a slice is captured at the next
render, not when asked, so it waits for `scheduledUpdateCompleted` before moving
the painter; and Qt skips captures inside a fully transparent subtree, so nothing
holding a pending capture is ever at opacity 0 (0.002 instead).

The shader is `shader/orbital.frag` (Qt GLSL 440; `build.sh` compiles it with qsb).

## Credits

`plugin/Background.qml` is Omarchy's own background plugin (MIT) with the Orbital
added. The scene, its look and the ship names come from the veredalabs.dev
lookdev. Manrope is under the SIL Open Font License (`shader/Manrope-OFL.txt`).
