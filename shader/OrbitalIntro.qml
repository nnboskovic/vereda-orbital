import QtQuick
import QtQuick.Effects
import QtQuick.Shapes
import "Scene.js" as Scene

// The login intro: the Vereda Labs mark, centred on black at the boot logo's size (so it
// carries on from the boot screen), names this machine's ship, then turns in space and flies
// down into the Orbital, its long stroke landing along the band toward the ribbon and then
// spreading over the band's whole visible arc, edge to edge (all projected through the
// scene's own camera, so it lies exactly on the band). Its ivory fades into the Orbital
// beneath, and the dark falls away around it. About eight seconds.
Item {
  id: intro

  property real dpr: 1
  property real markPixels: 240         // the boot logo's width in screen pixels (theme unlock.png)
  property var params: Scene.defaults
  property string ship: ""
  property string fontFamily: ""
  readonly property bool playing: run.running

  function play() {
    var p = Scene.merge(params, {introX: 0.35, introY: 0.45, introLength: 10000})
    setup = Scene.introSetup(p, Scene.frame(p, 0, Scene.clockHour()), width, height, markPixels / dpr)
    if (!setup) return
    visible = true
    run.restart()
  }

  visible: false

  property var setup: null
  property real k: 0                    // the mark's journey, one smooth move from the screen to the arc
  property real nameShown: 0
  function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x) }
  // All tied to the one move: the short stroke goes early, the long one's ivory thins into
  // the Orbital as it stretches over it, and the dark lifts as it arrives.
  readonly property real shortStroke: 1 - smooth((k - 0.05) / 0.35)
  readonly property real fill: 1 - smooth((k - 0.4) / 0.55)
  readonly property real veil: 1 - smooth((k - 0.72) / 0.28)

  function outline(poly, spread) {
    if (!setup) return []
    return Scene.introOutline(setup, poly, k, spread).map(function (q) { return Qt.point(q[0], q[1]) })
  }
  readonly property var longPath: outline(Scene.markLong, true)
  readonly property var shortPath: outline(Scene.markShort, false)

  // The hole the long stroke cuts in the dark.
  Item {
    id: hole
    anchors.fill: parent
    visible: false
    layer.enabled: true
    Shape {
      anchors.fill: parent
      preferredRendererType: Shape.CurveRenderer
      ShapePath { fillColor: "white"; strokeColor: "transparent"; PathPolyline { path: intro.longPath } }
    }
  }

  Rectangle {
    anchors.fill: parent
    color: "#05080d"
    opacity: intro.veil
    layer.enabled: true
    layer.effect: MultiEffect {
      maskEnabled: true
      maskInverted: true
      maskSource: hole
      maskThresholdMin: 0.5
      maskSpreadAtMin: 0.06
    }
  }

  // The mark: the long stroke, whose ivory fades into the Orbital, and the short one.
  Shape {
    anchors.fill: parent
    preferredRendererType: Shape.CurveRenderer
    opacity: intro.fill
    ShapePath { fillColor: "#F2ECDD"; strokeColor: "transparent"; PathPolyline { path: intro.longPath } }
  }
  Shape {
    anchors.fill: parent
    preferredRendererType: Shape.CurveRenderer
    opacity: intro.shortStroke
    ShapePath { fillColor: "#F2ECDD"; strokeColor: "transparent"; PathPolyline { path: intro.shortPath } }
  }

  Text {
    anchors.horizontalCenter: parent.horizontalCenter
    y: intro.height / 2 + intro.markPixels / intro.dpr * 58 / 178 + 26
    text: intro.ship
    color: "#d3dce2"
    opacity: intro.nameShown
    font.family: intro.fontFamily
    font.pixelSize: 13
    font.letterSpacing: 2.5
    font.weight: Font.Medium
  }

  SequentialAnimation {
    id: run
    ScriptAction { script: { intro.k = 0; intro.nameShown = 0 } }
    NumberAnimation { target: intro; property: "nameShown"; to: 1; duration: 700; easing.type: Easing.InOutQuad }
    PauseAnimation { duration: 700 }
    ParallelAnimation {
      NumberAnimation { target: intro; property: "nameShown"; to: 0; duration: 450; easing.type: Easing.InQuad }
      NumberAnimation { target: intro; property: "k"; to: 1; duration: 4400 }
    }
    ScriptAction { script: intro.visible = false }
  }
}
