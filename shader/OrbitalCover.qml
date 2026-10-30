import QtQuick

// A place's still laid over the live Orbital while it moves to another place. Showing a still
// fades it in over whatever is on screen, the live frame or the still before it, so changing
// workspace reads as a crossfade; hiding lifts the cover once the live Orbital has caught up
// underneath. Two images take turns, so a new still can fade in over the last one.
Item {
  id: cover

  property int fadeIn: 500
  property int fadeOut: 700
  readonly property bool up: onTop >= 0              // a still is showing, or on its way
  signal shown()                                   // the new still has fully faded in

  property int onTop: -1                             // which image is on top, or -1 for none
  readonly property var images: [first, second]

  function show(url) {
    lift.stop()
    var next = images[onTop === 0 ? 1 : 0], under = images[onTop === 0 ? 0 : 1]
    under.z = 1
    next.z = 2
    next.opacity = 0
    onTop = next === first ? 0 : 1
    if (next.source.toString() === url && next.status === Image.Ready) arrive.restart()
    else next.source = url
  }

  function hide() {
    if (onTop < 0) return
    arrive.stop()
    lift.target = images[onTop]
    lift.restart()
  }

  function loaded(image) {
    if (onTop < 0 || images[onTop] !== image) return
    if (image.status === Image.Ready) arrive.restart()
    else if (image.status === Image.Error) { image.source = ""; onTop = -1; shown() }
  }

  NumberAnimation {
    id: arrive
    target: cover.onTop >= 0 ? cover.images[cover.onTop] : null
    property: "opacity"
    to: 1
    duration: cover.fadeIn
    easing.type: Easing.InOutQuad
    onFinished: {
      var under = cover.images[cover.onTop === 0 ? 1 : 0]
      under.opacity = 0
      under.source = ""
      cover.shown()
    }
  }

  NumberAnimation {
    id: lift
    property: "opacity"
    to: 0
    duration: cover.fadeOut
    easing.type: Easing.InOutQuad
    onFinished: {
      for (var i = 0; i < 2; i++) { cover.images[i].opacity = 0; cover.images[i].source = "" }
      cover.onTop = -1
    }
  }

  Image {
    id: first
    anchors.fill: parent
    opacity: 0
    visible: opacity > 0
    fillMode: Image.PreserveAspectCrop
    asynchronous: true
    cache: false
    onStatusChanged: cover.loaded(first)
  }

  Image {
    id: second
    anchors.fill: parent
    opacity: 0
    visible: opacity > 0
    fillMode: Image.PreserveAspectCrop
    asynchronous: true
    cache: false
    onStatusChanged: cover.loaded(second)
  }
}
