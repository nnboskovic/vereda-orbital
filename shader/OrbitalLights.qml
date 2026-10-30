import QtQuick
import "Scene.js" as Scene

// Claude Code sessions as ships moored off the band's near edge, oldest nearest, each with a
// name from the site's list and its project. Underway (working): a steady cool light. Needs
// you (a permission prompt or question): an amber pulse. Holding (turn done, your move): a
// dim warm light, with a flare as it comes in. Leaving: it fades out.
Item {
  id: lights

  property var painter: null            // the live painter: moorings share its camera
  property var sessions: []             // [{id, state, project, since}], oldest first
  property bool animate: false          // pulses run only while the desktop is showing

  FontLoader { id: manrope; source: "Manrope-latin.woff2" }

  // Keep one delegate per session id, so a light's animations survive each refresh.
  ListModel { id: ships }
  onSessionsChanged: {
    var list = sessions || [], names = Scene.shipsFor(list.map(function (s) { return s.id }))
    for (var i = ships.count - 1; i >= 0; i--) {
      var keep = false
      for (var j = 0; j < list.length; j++) if (list[j].id === ships.get(i).sid) keep = true
      if (!keep) ships.remove(i)
    }
    for (var k = 0; k < list.length && k < 8; k++) {
      var s = list[k], at = -1
      for (var m = 0; m < ships.count; m++) if (ships.get(m).sid === s.id) at = m
      var row = {sid: s.id, sstate: s.state, project: s.project || "", cls: names[k].cls, sname: names[k].name, slot: k}
      if (at < 0) ships.append(row)
      else ships.set(at, row)
    }
  }

  function screenAt(slot) {
    if (!painter || width <= 0) return [-100, -100]
    var p = Scene.project(painter.view, Scene.mooring(painter.params, slot), width / height)
    return p ? [(p[0] + 1) / 2 * width, (1 - p[1]) / 2 * height] : [-100, -100]
  }

  Repeater {
    model: ships
    Item {
      id: ship
      required property string sid
      required property string sstate
      required property string project
      required property string cls
      required property string sname
      required property int slot
      readonly property var at: lights.screenAt(slot)
      readonly property color hue: sstate === "working" ? "#cfeaff" : sstate === "waiting" ? "#ffc27a" : "#e8dccb"
      readonly property string doing: sstate === "working" ? "underway" : sstate === "waiting" ? "needs you" : sstate === "gone" ? "leaving" : "holding"
      property real glow: sstate === "working" ? 1 : sstate === "waiting" ? 0.6 + 0.4 * pulse : 0.5
      property real pulse: 0
      property real flare: 0
      x: at[0]
      y: at[1]
      opacity: sstate === "gone" ? 0 : 1
      Behavior on opacity { NumberAnimation { duration: 2500; easing.type: Easing.InOutQuad } }
      Component.onCompleted: { opacity = 0; opacity = Qt.binding(function () { return ship.sstate === "gone" ? 0 : 1 }) }

      onSstateChanged: if (sstate === "idle") flareAnim.restart()

      SequentialAnimation on pulse {
        running: lights.animate && ship.sstate === "waiting"
        loops: Animation.Infinite
        NumberAnimation { to: 1; duration: 700; easing.type: Easing.InOutSine }
        NumberAnimation { to: 0; duration: 900; easing.type: Easing.InOutSine }
      }
      SequentialAnimation {
        id: flareAnim
        NumberAnimation { target: ship; property: "flare"; to: 1; duration: 180; easing.type: Easing.OutQuad }
        NumberAnimation { target: ship; property: "flare"; to: 0; duration: 1600; easing.type: Easing.InOutQuad }
      }

      readonly property real level: Math.min(1.6, glow + flare)

      // the light: a soft halo, a core and the Vereda diffraction cross
      Rectangle { width: 18; height: 18; radius: 9; x: -9; y: -9; color: ship.hue; opacity: 0.22 * ship.level }
      Rectangle { width: 4.4; height: 4.4; radius: 2.2; x: -2.2; y: -2.2; color: Qt.lighter(ship.hue, 1.15); opacity: Math.min(1, ship.level) }
      Repeater {
        model: [35, 125]
        Rectangle {
          required property int modelData
          width: 26 * (0.7 + 0.3 * Math.min(1, ship.level)); height: 1; x: -width / 2; y: -0.5
          rotation: modelData
          opacity: 0.55 * Math.min(1, ship.level)
          gradient: Gradient {
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: "transparent" }
            GradientStop { position: 0.5; color: ship.hue }
            GradientStop { position: 1; color: "transparent" }
          }
        }
      }

      // its name and what it is doing, to the right (to the left near the screen edge)
      Column {
        id: label
        spacing: 1
        x: ship.x + 16 + width > lights.width - 8 ? -16 - width : 16
        y: -10
        opacity: 0.55 + 0.45 * Math.min(1, ship.level)
        Text {
          text: ship.cls + " <i>" + ship.sname + "</i>"
          textFormat: Text.StyledText
          font.family: manrope.name
          font.weight: Font.Medium
          font.pixelSize: 12
          font.letterSpacing: 0.3
          color: "#e6edf2"
          style: Text.Raised
          styleColor: "#000000"
        }
        Text {
          text: (ship.project ? ship.project + " · " : "") + ship.doing
          font.family: manrope.name
          font.pixelSize: 10
          font.letterSpacing: 0.4
          color: ship.hue
          opacity: 0.85
        }
      }
    }
  }
}
