import QtQuick
import Quickshell.Io
import "Scene.js" as Scene

// Draws each workspace's place as a still, one after another: what a workspace switch fades
// to, and what shows behind windows. Place 0 is the whole ring from above (Scene.overhead),
// the workspace overview's map. It renders the way the live Orbital does, a slice per
// tick, so no single GPU job is long; ten places take about seven seconds. A copy of the live
// renderer is loaded only while it works.
Item {
  id: studio

  property var params: Scene.defaults
  property var weatherFor: null         // place -> the real weather to apply there, or null
  property real dpr: 1
  property int tickMs: 60
  property string folder: ""            // stills are saved here as <prefix>-<place>.png
  property string prefix: "screen"
  readonly property bool busy: queue.length > 0 || loader.active
  property var queue: []
  property int current: 1

  signal placeDone(int place, string path)
  signal finished()

  function nameOf(place) { return prefix + "-" + (place === 0 ? "map" : place) }
  function pathOf(place) { return folder + "/" + nameOf(place) + ".png" }
  function lookOf(place) { return place === 0 ? Scene.merge(params, {overhead: true}) : Scene.atPlace(params, place) }

  // Render these places in order; a request while busy waits for the next round.
  function render(places) {
    if (busy || !folder) return
    queue = places.slice()
    next()
  }

  function next() {
    if (!queue.length) { loader.active = false; finished(); return }
    var rest = queue.slice()
    current = rest.shift()
    queue = rest
    if (!loader.active) loader.active = true
    else if (loader.item) loader.item.burst = loader.item.slices
  }

  Loader {
    id: loader
    anchors.fill: parent
    active: false
    onLoaded: item.burst = item.slices

    sourceComponent: OrbitalLive {
      dpr: studio.dpr
      params: studio.lookOf(studio.current)
      weather: studio.weatherFor ? studio.weatherFor(studio.current) : null
      tickMs: studio.tickMs
      running: false
      // the frame's last slice is captured at the next render, so let that land first
      onFrameFinished: settle.restart()
    }
  }

  // A change of look mid-frame restarts the frame, but not the count of ticks it was given;
  // if a frame has stalled that way, give it a fresh count.
  Timer {
    interval: 3000
    repeat: true
    running: loader.active
    onTriggered: {
      var item = loader.item
      if (item && item.finished === 0 && item.burst <= 0 && !settle.running && !move.running) item.burst = item.slices
    }
  }

  Timer {
    id: settle
    interval: 250
    onTriggered: {
      var place = studio.current, path = studio.pathOf(place)
      var temp = studio.folder + "/." + studio.nameOf(place) + "-next.png"
      loader.item.snapshot(temp, function (ok) {
        if (!ok) { studio.next(); return }
        move.place = place
        move.path = path
        move.command = ["mv", "-f", temp, path]
        move.running = true
      })
    }
  }

  Process {
    id: move
    property int place: 0
    property string path: ""
    onExited: {
      studio.placeDone(place, path)
      studio.next()
    }
  }
}
