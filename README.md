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

The Orbital has its own weather. A simulation runs round the whole band in the background
(`weather/`, the `vereda-weather` user service): a grid of 3016 x 104 cells of 25 km that
closes on itself round the ring, at the pace of real weather. The day travelling round the ring
heats it, land quickly and sea slowly, the shallow shelves faster than the deep basins; clouds
form where air saturates, rain out, and build into storms over warm land and sea. An Orbital
spins about its own axis, so the Coriolis force never turns the wind sideways along the floor:
there are no cyclones, and the weather organises itself round the travelling heat instead, with
sea breezes, afternoon storms, dawn fog and cloud streets lined up with the wind. Every few
minutes it writes two maps of the band to `~/.cache/vereda-orbital/weather/` (`weather.png`:
low cloud, high cloud, how convective, rain; `wind.png`: wind along and across, sea fog,
thunderstorms) and a `status.json` summing up each workspace's place and listing the storms.
The land it runs on is drawn by the shader itself (`weather/landmap.sh`), so it matches the
drawn land exactly.

Workspace 1's place follows the real sky: `OrbitalWeather` reads the weather where you are
from Open-Meteo every 15 minutes (for the bar's location), leaves it in `observed.json`, and
the simulation pulls the weather within a few hundred km of that place toward it, fading into
its own weather further out. There, `Scene.weatherLook` also greys rainy cloud and hazes fog;
everywhere else the simulation alone decides.

The shader draws the maps as two decks. Low cloud (2 km) takes the shape of its kind: smooth
sheets and fog, stratocumulus as rounded cells pressed together, cumulus as popcorn in clumps,
storm towers as great rounded heads, all frayed at the edges. High cloud (10 km) is cirrus drawn
out along the wind, or a smooth anvil over a storm. Clouds have a thickness, so sunward faces
catch the light and lee sides fall into shade, thin edges glow when you look toward the sun,
and their shadows fall on the floor along the sun's direction, from the tops of storm towers.
On a ring the sun sets for a whole column of air at once (the floor curves up, not away), so
high cloud doesn't keep the light after the low cloud loses it, as it would on a planet.
`OrbitalLightning` strikes inside the storm cells in view, more often the stronger and more
numerous they are; `flash.frag.qsb` lights the cloud around each strike, and thunder follows.
Without the simulation, a procedural sky stands in. The new clouds cost no more GPU time than
the old single sheet did.

Preview a real-weather touch at home (cloud cover itself comes from the simulation):

    omarchy-shell orbital weather '{"code":95,"precip":8,"wind":40}'
    omarchy-shell orbital weather ''
    omarchy-shell orbital status

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

## Places

Each workspace is its own place on the Orbital (`Scene.atPlace`): workspace 1 at the look's
`phi`, each next one `places` degrees further (36 by default, so ten go once round the ring).
The sun is left where it is, so each place keeps its own local time, one hour per 15 degrees:
each place is 2.4 hours later than the one before, and over the day the daylight travels
back through the workspaces. The session ships moor off whichever place you're at.

`OrbitalStudio` draws every place as a still every ten minutes (in slices, about seven seconds
in all) into `~/.cache/vereda-orbital/places/`, plus the whole ring from above as the map
(`Scene.overhead`). Changing workspace fades the new place's still in over half a second
(`OrbitalCover`), the live Orbital moves there underneath and the still lifts once it's back.
With windows open the still stays, so each workspace keeps its own place behind them, and the
lock screen's image becomes the place you were on. `omarchy-shell orbital stills` redraws them.

The bar's workspace widget is a clone of Omarchy's (`workspaces/`): lights along a gentle arc,
bright where you are, lit where there are windows, faint where it's empty, with the number on
hover. The workspace overview (Super+` or a palm push, in the `vereda.hands` plugin) draws the
map with each workspace's plate inside its place on the ring; the map's `.json` says where.

## Idle flyover

After `flyover` seconds without input (150), a window over everything sets out from the place
you left and drifts on along the band (`Scene.flyoverMotion`, `flyoverSpeed` degrees a second),
at the wallpaper's own frame rate, half that on battery. The drift pad (`sound/out/drift.wav`, a
seamless 64-second loop) fades in under it when the sky's sounds are on. A key, the mouse, or a
hand in view with hyprhands on ends it, and so does the lock screen, which keeps Omarchy's own
timer. Omarchy's text screensaver is turned off (its timer set to 0; `revert.sh` restores it).
`omarchy-shell orbital flyover` starts it to have a look, and `omarchy-shell orbital land` ends it.

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

## Sound

Every sound is synthesised in `sound/motifs.js` (no samples) and rendered to WAVs by
`sound/render.js` at install: a Rhodes, soft glass, analog pads under a slow filter, a round
bass and a convolution hall, leaning on Jamiroquai and Interstella 5555. All of it grows from
one cell shaped like the mark, E5 down to A4 up to B5.

- **The way in**: the intro's song, following the Windows 95 startup's shape (a sparkle, a
  warm chord, the cell as a chime melody, a lift, a bloom as the ivory dissolves) over
  Dmaj9, E9sus, Amaj9. Flavours: funk (default), boot, disco, and digital (an homage to Daft
  Punk's Digital Love in sound and feel: a filtered disco loop at 125 BPM opening through the
  zoom), or shuffle.
- **Ships**: a session comes alongside, needs you, finishes its turn, leaves.
- **Signals**: each notification by urgency (swept, tight point, broadcast).
- **Sky**: thunder a second or few after each lightning strike.

`OrbitalSound.qml` plays them through PipeWire; ships and signals keep quiet under Do Not
Disturb. `orbital-sound` sets them up:

    orbital-sound song funk|boot|disco|digital|shuffle
    orbital-sound on|off [theme|ships|signals|sky]
    orbital-sound volume 0.6
    orbital-sound play needs-you

`sound/lab/` builds the listening page the sounds were chosen on.

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
