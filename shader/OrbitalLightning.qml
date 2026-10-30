import QtQuick
import "Scene.js" as Scene

// Lightning in the cloud deck during a real thunderstorm. A strike lights the clouds around
// a point on the band: the flash shader evaluates the real cloud deck in a small box there
// and adds light that flickers for under half a second, faint by day, bright at night.
// Between strikes nothing is drawn.
Item {
  id: storm

  property bool active: false
  property var painter: null            // the live painter: strikes share its camera, look and time
  property real dpr: 1
  readonly property real flashLevel: bolt.uFlash   // for tests

  function strike(nearX, nearY) {
    if (!painter || width <= 0 || height <= 0) return
    var v = painter.view, aspect = width / height
    for (var i = 0; i < 16; i++) {
      // a second strike lands close to the first, as storms do
      var x = nearX !== undefined ? nearX + (Math.random() - 0.5) * 0.12 : Math.random() * 2 - 1
      var y = nearY !== undefined ? nearY + (Math.random() - 0.5) * 0.12 : Math.random() * 2 - 1
      var hit = Scene.cloudPoint(v, painter.params.width, x, y, aspect)
      if (!hit) continue
      var r = 90 + Math.random() * 80                       // km of cloud lit by this strike
      // the box covers the lit patch as the camera sees it, foreshortened along the band
      var phi = Math.atan2(hit.pos[1], hit.pos[0]), along = [-Math.sin(phi), Math.cos(phi), 0], across = [0, 0, 1]
      var x0 = x, x1 = x, y0 = y, y1 = y
      var reach = [Scene.mul(along, 2.6 * r), Scene.mul(along, -2.6 * r), Scene.mul(across, 2.6 * r), Scene.mul(across, -2.6 * r)]
      for (var k = 0; k < 4; k++) {
        var sp = Scene.project(v, Scene.add(hit.pos, reach[k]), aspect)
        if (!sp) continue
        x0 = Math.min(x0, sp[0]); x1 = Math.max(x1, sp[0]); y0 = Math.min(y0, sp[1]); y1 = Math.max(y1, sp[1])
      }
      var left = Math.max(0, (x0 + 1) / 2 * width - 4), right = Math.min(width, (x1 + 1) / 2 * width + 4)
      var top = Math.max(0, (1 - y1) / 2 * height - 4), bottom = Math.min(height, (1 - y0) / 2 * height + 4)
      if (right - left < 8 || bottom - top < 8) continue
      bolt.x = left
      bolt.y = top
      bolt.width = Math.min(right - left, width * 0.6)
      bolt.height = Math.min(bottom - top, height * 0.6)
      bolt.uBolt = Qt.vector3d(hit.pos[0], hit.pos[1], hit.pos[2])
      bolt.uBoltR = r
      flicker.peak = 0.35 + 0.85 * (v.dark || 0)
      flicker.restart()
      if (nearX === undefined && Math.random() < 0.35) { again.x0 = x; again.y0 = y; again.restart() }
      return
    }
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
    property real x0: 0
    property real y0: 0
    interval: 450
    onTriggered: storm.strike(x0, y0)
  }

  Timer {
    running: storm.active
    repeat: true
    interval: 2000
    onTriggered: { storm.strike(); interval = 700 + Math.random() * 3800 }
  }
}
