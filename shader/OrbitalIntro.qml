import QtQuick
import QtQuick.Effects
import QtQuick.Shapes

// The login intro: the Vereda Labs mark, centred on black at the boot logo's size (so it
// carries on from the boot screen), names this machine's ship, then its long stroke
// stretches and turns to lie along the Orbital's band, becomes a window onto it, and opens
// out to the whole screen while the short stroke falls away. About four seconds.
Item {
  id: intro

  property real dpr: 1
  property real markPixels: 240         // the boot logo's width in screen pixels (theme unlock.png)
  property string ship: ""
  property string fontFamily: ""
  readonly property bool playing: run.running

  function play() { visible = true; run.restart() }

  visible: false

  // Animated by the timeline below.
  property real t: 0                    // the stroke's journey from mark to band, 0..1
  property real fill: 1                 // the stroke's ivory, fading to reveal the Orbital through it
  property real shortStroke: 1
  property real nameShown: 0
  property real veil: 1

  // The mark, in its own SVG units (178 x 116). The long stroke's centre line runs from
  // (71, 116) to (155, 0): 143.2 long, 40.5 thick, at -54.1 deg on screen.
  readonly property real s0: markPixels / dpr / 178
  readonly property real len0: 143.2
  readonly property real thick0: 40.5
  // Where the band sweeps across the frame, as a fraction of the screen: its centre line.
  readonly property point bandFrom: Qt.point(width * 0.12, height * 0.93)
  readonly property point bandTo: Qt.point(width * 1.02, height * -0.05)
  readonly property real bandLen: Math.sqrt(Math.pow(bandTo.x - bandFrom.x, 2) + Math.pow(bandTo.y - bandFrom.y, 2))
  readonly property real bandAngle: Math.atan2(bandTo.y - bandFrom.y, bandTo.x - bandFrom.x) * 180 / Math.PI

  function mix(a, b, k) { return a + (b - a) * k }
  function grow(a, b, k) { return a * Math.pow(b / a, k) }           // zooms read evenly in log space
  readonly property real ease: t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  readonly property real along: grow(s0, bandLen / len0, ease)
  readonly property real across: grow(s0, Math.sqrt(width * width + height * height) * 1.6 / thick0, Math.pow(ease, 1.6))
  readonly property real angle: mix(-54.1, bandAngle, ease)
  // the stroke's midpoint starts where it sits in the centred mark, and ends mid-band
  readonly property real cx: mix(width / 2 + (113 - 89) * s0, (bandFrom.x + bandTo.x) / 2, ease)
  readonly property real cy: mix(height / 2, (bandFrom.y + bandTo.y) / 2, ease)

  component Stroke: Item {
    id: stroke
    property color color: "white"
    width: 178
    height: 116
    transform: [
      Translate { x: -113; y: -58 },
      Rotation { angle: 54.1 },
      Scale { xScale: intro.along; yScale: intro.across },
      Rotation { angle: intro.angle },
      Translate { x: intro.cx; y: intro.cy }
    ]
    Shape {
      preferredRendererType: Shape.CurveRenderer
      ShapePath {
        fillColor: stroke.color
        strokeColor: "transparent"
        startX: 46; startY: 116
        PathLine { x: 132; y: 0 }
        PathLine { x: 178; y: 0 }
        PathLine { x: 96; y: 116 }
        PathLine { x: 46; y: 116 }
      }
    }
  }

  // The hole the stroke cuts in the dark.
  Item {
    id: hole
    anchors.fill: parent
    visible: false
    layer.enabled: true
    Stroke { color: "white" }
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
      maskSpreadAtMin: 0.3
    }
  }

  // The mark itself: the long stroke, whose ivory fades into the Orbital, and the short one.
  Stroke { color: "#F2ECDD"; opacity: intro.fill }
  Shape {
    preferredRendererType: Shape.CurveRenderer
    opacity: intro.shortStroke
    x: intro.width / 2 - 89 * intro.s0 - (1 - intro.shortStroke) * 30
    y: intro.height / 2 - 58 * intro.s0 + (1 - intro.shortStroke) * 18
    scale: intro.s0
    transformOrigin: Item.TopLeft
    ShapePath {
      fillColor: "#F2ECDD"
      strokeColor: "transparent"
      startX: 0; startY: 35
      PathLine { x: 40; y: 35 }
      PathLine { x: 62; y: 72 }
      PathLine { x: 39; y: 101 }
      PathLine { x: 0; y: 35 }
    }
  }

  Text {
    anchors.horizontalCenter: parent.horizontalCenter
    y: intro.height / 2 + 58 * intro.s0 + 26
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
    ScriptAction { script: { intro.t = 0; intro.fill = 1; intro.shortStroke = 1; intro.nameShown = 0; intro.veil = 1 } }
    NumberAnimation { target: intro; property: "nameShown"; to: 1; duration: 700; easing.type: Easing.InOutQuad }
    PauseAnimation { duration: 900 }
    ParallelAnimation {
      NumberAnimation { target: intro; property: "nameShown"; to: 0; duration: 450; easing.type: Easing.InQuad }
      NumberAnimation { target: intro; property: "shortStroke"; to: 0; duration: 700; easing.type: Easing.InQuad }
      NumberAnimation { target: intro; property: "t"; to: 1; duration: 2300 }
      SequentialAnimation {
        PauseAnimation { duration: 350 }
        NumberAnimation { target: intro; property: "fill"; to: 0; duration: 900; easing.type: Easing.InOutQuad }
      }
    }
    NumberAnimation { target: intro; property: "veil"; to: 0; duration: 500; easing.type: Easing.OutQuad }
    ScriptAction { script: intro.visible = false }
  }
}
