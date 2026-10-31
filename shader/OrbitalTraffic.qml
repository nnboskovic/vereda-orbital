import QtQuick
import Quickshell
import Quickshell.Io
import "Scene.js" as Scene

// Air traffic over the band, flown by the weather simulation: weather/sim.py writes traffic.json
// every minute, aircraft between the cities on routes that go round the storms, at true speeds,
// jets up at 10 km and airships low down. At night each is a small light, some with a blinking
// beacon; by day a jet in moist air aloft draws a contrail, a faint soft hairline from this
// height, that spreads and fades over a quarter of an hour (the simulation turns the old ones
// into cirrus). Between updates each craft is
// carried on along its heading.
//   traffic.json: {"at": ISO time, "craft": [{"id", "kind": "jet" | "airship", "phi": deg,
//   "z": km, "alt": km, "dphi": deg/s, "dz": km/s, "beacon": bool,
//   "trail": [[phi, z, unix seconds], ...]}]}
Item {
  id: traffic

  property var painter: null            // the live painter: craft share its camera
  property bool animate: false
  property var craft: []
  property real at: 0                   // when the simulation wrote them, ms
  property real now: Date.now()

  FileView {
    path: Quickshell.env("HOME") + "/.cache/vereda-orbital/weather/traffic.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      try {
        var t = JSON.parse(text())
        traffic.at = t.at ? Date.parse(t.at) : Date.now()
        traffic.craft = t.craft || []
        trails.requestPaint()
      } catch (e) {}
    }
  }

  function rad(d) { return d * Math.PI / 180 }
  // where a craft is at time t (ms), carried on from the simulation's last word
  function posOf(c, t) {
    var dt = (t - at) / 1000
    return Scene.ringPt(rad(c.phi + (c.dphi || 0) * dt), c.alt || 10, c.z + (c.dz || 0) * dt)
  }
  // the sun's height over a point: below zero it's night there
  function sunUp(pos) { return painter ? Scene.dot(Scene.upAt(pos), painter.view.sun) : 1 }

  Timer {
    interval: 83                        // a dozen moves a second, only while the wallpaper shows
    repeat: true
    running: traffic.animate && traffic.craft.length > 0
    onTriggered: traffic.now = Date.now()
  }
  // contrails change slowly: redraw them with each new frame of the Orbital
  Connections {
    target: traffic.painter
    function onHourChanged() { if (traffic.animate && traffic.craft.length > 0) trails.requestPaint() }
  }

  Canvas {
    id: trails
    anchors.fill: parent
    renderStrategy: Canvas.Cooperative
    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      // until the live Orbital starts a frame, the painter's sun is a placeholder
      if (!traffic.painter || traffic.painter.hour < 0) return
      var v = traffic.painter.view, aspect = width / height, nowS = Date.now() / 1000
      ctx.lineCap = "round"
      ctx.shadowColor = Qt.rgba(1, 1, 1, 0.5)
      ctx.shadowBlur = 2.5                                         // soft, never a drawn line
      for (var i = 0; i < traffic.craft.length; i++) {
        var c = traffic.craft[i], tr = c.trail
        if (!tr || tr.length < 2) continue
        var prev = null
        for (var k = 0; k < tr.length; k++) {
          var pos = Scene.ringPt(traffic.rad(tr[k][0]), c.alt || 10, tr[k][1])
          var sp = Scene.project(v, pos, aspect), age = Math.max(0, nowS - tr[k][2]) / 60
          var pt = sp ? [(sp[0] + 1) / 2 * width, (1 - sp[1]) / 2 * height] : null
          var day = traffic.sunUp(pos)
          if (prev && pt && day > 0.05) {
            if (age > 15) { prev = pt; continue }
            ctx.strokeStyle = Qt.rgba(1, 1, 1, 0.15 * (1 - age / 15) * Math.min(1, day * 5))
            ctx.lineWidth = 0.5 + age / 15 * 0.9                  // spreading a little as it ages
            ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(pt[0], pt[1]); ctx.stroke()
          }
          prev = pt
        }
      }
    }
  }

  Repeater {
    model: traffic.craft

    Item {
      id: light
      required property var modelData
      readonly property var pos: traffic.posOf(modelData, traffic.now)
      readonly property var sp: traffic.painter ? Scene.project(traffic.painter.view, pos, traffic.width / Math.max(1, traffic.height)) : null
      readonly property bool airship: modelData.kind === "airship"
      // a beacon blinks once every 1.3 s, briefly
      readonly property bool blink: !!modelData.beacon && (traffic.now % 1300) < 160
      visible: !!sp && Math.abs(sp[0]) < 1.05 && Math.abs(sp[1]) < 1.05 && traffic.sunUp(pos) < -0.03
      x: sp ? (sp[0] + 1) / 2 * traffic.width - width / 2 : 0
      y: sp ? (1 - sp[1]) / 2 * traffic.height - height / 2 : 0
      width: 6
      height: 6

      Rectangle {
        anchors.centerIn: parent
        width: light.blink ? 3.2 : (light.airship ? 2.2 : 1.8)
        height: width
        radius: width / 2
        color: light.blink ? "#ff8a7a" : (light.airship ? "#ffd9a0" : "#f4f1e8")
        opacity: light.airship ? 0.7 : 0.85
      }
    }
  }
}
