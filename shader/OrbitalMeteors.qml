import QtQuick
import "Scene.js" as Scene

// Meteors on the real calendar: Scene.meteorsOn(date) gives tonight's showers and rates, and
// each meteor burns through the Orbital's air ~90 km over the band, streaking along its
// shower's direction, bright over the night side and faint by day. Fireball showers (the
// Taurids) bring the odd big slow one. A few small rectangles; nothing drawn between meteors.
Item {
  id: sky

  property bool active: false
  property var painter: null            // the live painter: meteors share its camera and sun
  property var date: null               // a preview date; null follows the clock
  readonly property var tonight: Scene.meteorsOn(date || new Date())
  readonly property real perMinute: tonight.reduce(function (a, m) { return a + m.rate }, 0) / 15

  function pick() {
    var total = tonight.reduce(function (a, m) { return a + m.rate }, 0), r = Math.random() * total
    for (var i = 0; i < tonight.length; i++) { r -= tonight[i].rate; if (r <= 0) return tonight[i].shower }
    return tonight[0].shower
  }

  function launch() {
    if (!painter || width <= 0 || height <= 0) return
    var slot = null
    for (var k = 0; k < pool.count; k++) if (!pool.itemAt(k).flying) { slot = pool.itemAt(k); break }
    if (!slot) return
    var v = painter.view, aspect = width / height, s = pick()
    for (var i = 0; i < 12; i++) {
      var x = Math.random() * 2 - 1, y = Math.random() * 2 - 1
      var hit = Scene.skyPoint(v, painter.params.width, x, y, aspect, 90)
      if (!hit) continue
      var phi = Math.atan2(hit.pos[1], hit.pos[0])
      var az = (s.az < 0 ? Math.random() * 360 : s.az + (Math.random() - 0.5) * 8) * Math.PI / 180
      var dir = [-Math.sin(phi) * Math.cos(az), Math.cos(phi) * Math.cos(az), Math.sin(az)]
      var fireball = !!s.fireballs && Math.random() < 0.3 || Math.random() < 0.02
      var seconds = Math.min(1.1, Math.max(0.3, 18 / s.speed)) * (fireball ? 1.6 : 1)
      var km = s.speed * seconds * 7                      // drawn longer than life, to read from this high
      var a = Scene.project(v, hit.pos, aspect), b = Scene.project(v, Scene.add(hit.pos, Scene.mul(dir, km)), aspect)
      if (!a || !b) continue
      // bright over the night side, faint where the sun is up
      var up = Scene.norm([-hit.pos[0], -hit.pos[1], 0]), mu = Scene.dot(up, v.sun)
      var dark = Math.min(1, Math.max(0, (0.1 - mu) / 0.25))
      slot.fly((a[0] + 1) / 2 * width, (1 - a[1]) / 2 * height, (b[0] + 1) / 2 * width, (1 - b[1]) / 2 * height,
               Qt.rgba(s.color[0], s.color[1], s.color[2], 1), (0.25 + 0.75 * dark) * (0.55 + 0.45 * Math.random()),
               fireball, seconds * 1000)
      return
    }
  }

  Repeater {
    id: pool
    model: 4
    Item {
      id: meteor
      property real ax: 0
      property real ay: 0
      property real bx: 0
      property real by: 0
      property color tint: "white"
      property real bright: 1
      property bool fireball: false
      property real p: 0
      readonly property bool flying: run.running
      readonly property real len: Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay))
      readonly property real hx: ax + (bx - ax) * p
      readonly property real hy: ay + (by - ay) * p
      readonly property real angle: Math.atan2(ay - by, ax - bx) * 180 / Math.PI
      // in fast, out slow; a fireball flares near its end
      readonly property real envelope: (p < 0.12 ? p / 0.12 : p > 0.7 ? (1 - p) / 0.3 : 1)
                                       * (fireball ? 1 + 1.2 * Math.exp(-Math.pow((p - 0.82) / 0.06, 2)) : 1)
      visible: flying

      function fly(x0, y0, x1, y1, color, b, big, ms) {
        ax = x0; ay = y0; bx = x1; by = y1; tint = color; bright = b; fireball = big
        run.duration = ms
        run.restart()
      }

      NumberAnimation { id: run; target: meteor; property: "p"; from: 0; to: 1 }

      Rectangle {
        // the trail, from the head back along the path
        x: meteor.hx
        y: meteor.hy - height / 2
        width: meteor.len * Math.min(meteor.p, meteor.fireball ? 0.6 : 0.5)
        height: meteor.fireball ? 2.6 : 1.4
        radius: height / 2
        transformOrigin: Item.Left
        rotation: meteor.angle
        opacity: Math.min(1, meteor.envelope * meteor.bright)
        gradient: Gradient {
          orientation: Gradient.Horizontal
          GradientStop { position: 0; color: Qt.rgba(meteor.tint.r, meteor.tint.g, meteor.tint.b, 0.95) }
          GradientStop { position: 1; color: Qt.rgba(meteor.tint.r, meteor.tint.g, meteor.tint.b, 0) }
        }
      }
      Rectangle {
        // a soft glow round the head
        width: meteor.fireball ? 16 : 7
        height: width
        radius: width / 2
        x: meteor.hx - width / 2
        y: meteor.hy - height / 2
        color: meteor.tint
        opacity: 0.3 * Math.min(1.5, meteor.envelope * meteor.bright)
      }
      Rectangle {
        width: meteor.fireball ? 4.5 : 2.4
        height: width
        radius: width / 2
        x: meteor.hx - width / 2
        y: meteor.hy - height / 2
        color: Qt.lighter(meteor.tint, 1.25)
        opacity: Math.min(1, meteor.envelope * meteor.bright * 1.2)
      }
    }
  }

  Timer {
    id: next
    running: sky.active && sky.perMinute > 0
    interval: 4000
    onTriggered: {
      sky.launch()
      // a Poisson process at tonight's rate
      interval = Math.max(200, -Math.log(1 - Math.random()) / sky.perMinute * 60000)
      restart()
    }
  }
}
