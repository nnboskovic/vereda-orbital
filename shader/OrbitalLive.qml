import QtQuick
import "Scene.js" as Scene

// The Orbital, alive. A full frame costs ~40 ms on an iGPU, so each new frame is
// rendered one slice per tick into a spare buffer while the two newest finished
// frames crossfade; no single GPU job is long enough to make other windows stutter.
// Three buffers rotate roles: back (finished, opaque), front (finished, fading in
// over back) and work (being built, hidden under back).
Item {
  id: orbital

  property var params: Scene.defaults
  property var weather: null            // local weather (Scene.weatherLook); changes ease in
  property bool previewing: false       // a weather preview shows at once instead of easing
  property var sessions: []             // Claude Code sessions, shown as moored ships (OrbitalLights)
  property var meteorDate: null         // a preview date for the meteor calendar; null follows the clock
  signal frameFinished()

  // Saves what the Orbital shows right now (frames only, no lights or flashes) as an image.
  function snapshot(path, done) {
    if (!ready) { done(false); return }
    frames.grabToImage(function (result) { done(result.saveToFile(path)) }, Qt.size(width, height))
  }
  property real dpr: 1
  property bool running: false          // tick only while someone can see it
  property int slices: 12
  property int tickMs: 60               // one slice per tick: a new frame every ~0.7 s
  property real startTime: 0            // scene time of the first frame (match the still)

  readonly property bool ready: finished >= 1
  property int finished: 0              // frames completed since start
  property real sceneTime: startTime    // time of the frame being built
  property int work: 0
  property int back: -1
  property int front: -1
  property int slice: 0
  property real fade: 0
  property int burst: 0                 // ticks to run while paused, to bring the light up to date
  // A capture happens at the next render, not when asked; moving the painter on before it has
  // would capture the wrong slice, so wait for it (with a watchdog in case a render never comes).
  property bool pending: false
  property real pendingSince: 0
  property bool owed: false             // a tick came while waiting; take it as soon as the capture lands
  // What frames are rendered with: params plus weather, eased so a change of weather settles
  // over a couple of minutes (the first report after start shows at once).
  property var look: null
  property real lookAt: 0
  property bool lookWeathered: false

  function updateLook() {
    var target = Scene.weatherLook(params, weather), now = Date.now()
    if (!look || previewing || (weather && !lookWeathered)) look = target
    else look = Scene.blend(look, target, 1 - Math.exp(-(now - lookAt) / 120000))
    lookAt = now
    lookWeathered = lookWeathered || !!weather
  }

  readonly property int pxW: Math.round(width * dpr)
  readonly property int pxH: Math.round(height * dpr)
  // Slice height in pixels, a multiple that keeps slice edges on whole logical and physical pixels.
  readonly property int step: {
    for (var k = 1; k <= 8; k++) if (Math.abs(k / dpr - Math.round(k / dpr)) < 1e-4) return k
    return 1
  }
  readonly property int sliceH: Math.ceil(pxH / slices / step) * step
  property var sources: [[], [], []]

  function speed() { return look && look.speed !== undefined ? look.speed : 1 }

  // One timer beat: render the next slice, or note that one is owed while a capture is in flight.
  function beat() {
    if (!running && burst <= 0) return
    if (pending && Date.now() - pendingSince < 2000) { owed = true; return }
    owed = false
    if (tick() && !running && burst > 0) burst--
  }
  function captured() {
    pending = false
    if (owed) beat()
  }

  // Renders the next slice of the work frame.
  function tick() {
    if (pxW <= 0 || pxH <= 0) return false
    // Each frame is lit for the local hour and weather it starts in; its slices share them.
    if (slice === 0) {
      updateLook()
      painter.params = look
      painter.hour = Scene.clockHour()
    }
    painter.frameOrigin = Qt.point(0, slice * sliceH)
    painter.sceneTime = sceneTime
    var s = sources[work][slice]
    if (s) { pending = true; pendingSince = Date.now(); s.scheduleUpdate() }
    slice++
    if (front >= 0) fade = slice / slices
    if (slice < slices) return true
    // the work frame is done: it becomes the front, fading in over the old front
    slice = 0
    finished++
    frameFinished()
    if (back < 0) { back = work; work = (work + 1) % 3 }
    else if (front < 0) { front = work; work = 3 - back - front; fade = 0 }
    else { var f = front; back = f; front = work; work = 3 - back - front; fade = 0 }
    sceneTime += slices * tickMs / 1000 * speed()
    return true
  }

  // Restart from the first frame, e.g. when the look changes.
  function reset() {
    finished = 0; slice = 0; fade = 0; work = 0; back = -1; front = -1; sceneTime = startTime; pending = false; owed = false; look = null; lookWeathered = false
  }
  onParamsChanged: reset()
  onPxWChanged: reset()
  onPxHChanged: reset()

  OrbitalPainter {
    id: painter
    width: orbital.width
    height: orbital.sliceH / orbital.dpr
    frameSize: Qt.size(orbital.pxW, orbital.pxH)
    pixelSize: Qt.size(orbital.pxW, orbital.sliceH)
  }

  Item {
    id: frames
    anchors.fill: parent

    Repeater {
      model: 3
      Item {
        id: buffer
        required property int index
        anchors.fill: parent
        z: index === orbital.front ? 2 : index === orbital.back ? 1 : 0
        // Never fully transparent: Qt skips captures in an opacity-0 subtree, and the frame just
        // finished becomes the front at fade 0 while its last slice is still being captured.
        opacity: index === orbital.front ? Math.max(orbital.fade, 0.002) : 1
        visible: index === orbital.work || index === orbital.back || index === orbital.front

        Repeater {
          model: orbital.slices
          ShaderEffectSource {
            required property int index
            y: index * orbital.sliceH / orbital.dpr
            width: orbital.width
            height: orbital.sliceH / orbital.dpr
            sourceItem: painter
            hideSource: true
            live: false
            smooth: false
            textureSize: Qt.size(orbital.pxW, orbital.sliceH)
            onScheduledUpdateCompleted: orbital.captured()
            Component.onCompleted: orbital.sources[buffer.index][index] = this
            Component.onDestruction: if (orbital.sources[buffer.index][index] === this) orbital.sources[buffer.index][index] = null
          }
        }
      }
    }

  }

  OrbitalMeteors {
    anchors.fill: parent
    z: 3
    painter: painter
    date: orbital.meteorDate
    active: orbital.running && orbital.ready
  }

  OrbitalLightning {
    anchors.fill: parent
    z: 3
    painter: painter
    dpr: orbital.dpr
    active: orbital.running && orbital.ready && !!orbital.look && orbital.look.storm > 0.5
  }

  OrbitalLights {
    anchors.fill: parent
    z: 4
    painter: painter
    sessions: orbital.sessions
    animate: orbital.running
  }

  Timer {
    interval: orbital.tickMs
    repeat: true
    running: (orbital.running || orbital.burst > 0) && orbital.visible && orbital.width > 0
    onTriggered: orbital.beat()
  }

  // Paused behind windows, the gaps still follow the day: every few minutes finish the
  // frame in progress and one more, so the newest light has fully faded in.
  Timer {
    interval: 5 * 60 * 1000
    repeat: true
    running: !orbital.running && orbital.visible && orbital.ready
    onTriggered: orbital.burst = 2 * orbital.slices - orbital.slice
  }
}
