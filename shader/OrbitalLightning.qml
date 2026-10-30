import QtQuick
import "Scene.js" as Scene

// Lightning in the storms the weather simulation has in view (or, without the simulation, all
// over the deck during a real thunderstorm). A strike lights the clouds around a point on the
// band: the flash shader evaluates the real cloud deck in a small box there and adds light that
// flickers for under half a second, faint by day, bright at night. Between strikes nothing is
// drawn. Stronger storms, and more of them in view, strike more often.
Item {
  id: storm

  property bool active: false
  property var painter: null            // the live painter: strikes share its camera, look and time
  property var storms: []               // the simulation's storm cells: [[phi deg, z km, intensity 0..1], ...]
  property real dpr: 1
  readonly property real flashLevel: bolt.uFlash   // for tests
  signal struck()                       // for the thunder

  // The simulation's storm cells the camera can see: [{pos, w}], w their intensity.
  function stormsInView() {
    var out = []
    if (!painter || !storms) return out
    var v = painter.view, aspect = width / height
    for (var i = 0; i < storms.length; i++) {
      var s = storms[i], pos = Scene.ringPt(s[0] * Math.PI / 180, 2, s[1]), sp = Scene.project(v, pos, aspect)
      if (sp && Math.abs(sp[0]) < 1.05 && Math.abs(sp[1]) < 1.05) out.push({pos: pos, w: Math.max(0.05, s[2])})
    }
    return out
  }

  // A strike somewhere the weather allows: in a storm in view, picked by its strength and
  // landing within a few tens of km of its heart; or without the simulation, anywhere on the deck.
  function strike() {
    if (!painter || width <= 0 || height <= 0) return
    if (storms && storms.length) {
      var seen = stormsInView(), total = 0
      for (var i = 0; i < seen.length; i++) total += seen[i].w
      if (total <= 0) return
      var pick = Math.random() * total, k = 0
      while (k < seen.length - 1 && pick > seen[k].w) { pick -= seen[k].w; k++ }
      strikeNear(seen[k].pos, 45)
      return
    }
    var v = painter.view, aspect = width / height
    for (var n = 0; n < 16; n++) {
      var hit = Scene.cloudPoint(v, painter.params.width, Math.random() * 2 - 1, Math.random() * 2 - 1, aspect)
      if (hit && strikeAt(hit.pos)) return
    }
  }

  // A strike within `spread` km of a point on the deck.
  function strikeNear(pos, spread) {
    var phi = Math.atan2(pos[1], pos[0]), along = [-Math.sin(phi), Math.cos(phi), 0]
    var off = Scene.add(Scene.mul(along, (Math.random() - 0.5) * 2 * spread), [0, 0, (Math.random() - 0.5) * 2 * spread])
    strikeAt(Scene.add(pos, off))
  }

  // Lights the cloud around a point on the deck; false if the camera can't see it.
  function strikeAt(pos) {
    var v = painter.view, aspect = width / height, sp = Scene.project(v, pos, aspect)
    if (!sp) return false
    var x = sp[0], y = sp[1]
    var r = 90 + Math.random() * 80                       // km of cloud lit by this strike
    // the box covers the lit patch as the camera sees it, foreshortened along the band
    var phi = Math.atan2(pos[1], pos[0]), along = [-Math.sin(phi), Math.cos(phi), 0], across = [0, 0, 1]
    var x0 = x, x1 = x, y0 = y, y1 = y
    var reach = [Scene.mul(along, 2.6 * r), Scene.mul(along, -2.6 * r), Scene.mul(across, 2.6 * r), Scene.mul(across, -2.6 * r)]
    for (var k = 0; k < 4; k++) {
      var q = Scene.project(v, Scene.add(pos, reach[k]), aspect)
      if (!q) continue
      x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1])
    }
    var left = Math.max(0, (x0 + 1) / 2 * width - 4), right = Math.min(width, (x1 + 1) / 2 * width + 4)
    var top = Math.max(0, (1 - y1) / 2 * height - 4), bottom = Math.min(height, (1 - y0) / 2 * height + 4)
    if (right - left < 8 || bottom - top < 8) return false
    bolt.x = left
    bolt.y = top
    bolt.width = Math.min(right - left, width * 0.6)
    bolt.height = Math.min(bottom - top, height * 0.6)
    bolt.uBolt = Qt.vector3d(pos[0], pos[1], pos[2])
    bolt.uBoltR = r
    flicker.peak = 0.35 + 0.85 * (v.dark || 0)
    flicker.restart()
    if (!again.running) {
      struck()
      // a second strike lands close to the first, as storms do
      if (Math.random() < 0.35) { again.pos = pos; again.restart() }
    }
    return true
  }

  OrbitalPainter {
    id: bolt
    shaderFile: "flash.frag.qsb"
    blending: true
    visible: uFlash > 0.002
    params: storm.painter ? storm.painter.params : Scene.defaults
    hour: storm.painter ? storm.painter.hour : -1
    sceneTime: storm.painter ? storm.painter.sceneTime : 0
    frameSize: storm.painter ? storm.painter.frameSize : Qt.size(1, 1)
    frameOrigin: Qt.point(x * storm.dpr, y * storm.dpr)
    pixelSize: Qt.size(width * storm.dpr, height * storm.dpr)
  }

  SequentialAnimation {
    id: flicker
    property real peak: 1
    NumberAnimation { target: bolt; property: "uFlash"; to: flicker.peak; duration: 40 }
    NumberAnimation { target: bolt; property: "uFlash"; to: flicker.peak * 0.15; duration: 70 }
    NumberAnimation { target: bolt; property: "uFlash"; to: flicker.peak * 1.1; duration: 35 }
    PauseAnimation { duration: 30 }
    NumberAnimation { target: bolt; property: "uFlash"; to: flicker.peak * 0.3; duration: 60 }
    NumberAnimation { target: bolt; property: "uFlash"; to: 0; duration: 260; easing.type: Easing.OutQuad }
  }

  Timer {
    id: again
    property var pos: [0, 0, 0]
    interval: 450
    onTriggered: storm.strikeNear(pos, 15)
  }

  Timer {
    running: storm.active
    repeat: true
    interval: 2000
    onTriggered: {
      storm.strike()
      var seen = storm.storms && storm.storms.length ? storm.stormsInView() : [{w: 1}], total = 0
      for (var i = 0; i < seen.length; i++) total += seen[i].w
      interval = (700 + Math.random() * 3800) / Math.min(3, Math.max(0.5, total))
    }
  }
}
