import Quickshell
import Quickshell.Wayland
import QtQuick

import "Scene.js" as Scene

// Renders one Orbital frame to a PNG and exits. Run through render-still.sh.
// A 1px click-through overlay hosts the scene; the frame itself is rendered offscreen.
ShellRoot {
  id: root
  readonly property int w: Number(Quickshell.env("ORBITAL_W") || 1920)
  readonly property int h: Number(Quickshell.env("ORBITAL_H") || 1080)
  readonly property string out: Quickshell.env("ORBITAL_OUT") || "/tmp/orbital.png"
  readonly property int bench: Number(Quickshell.env("ORBITAL_BENCH") || 0)

  PanelWindow {
    implicitWidth: 1
    implicitHeight: 1
    anchors { top: true; left: true }
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    WlrLayershell.namespace: "vereda-orbital-still"
    mask: Region {}

    OrbitalPainter {
      id: painter
      width: root.w
      height: root.h
      params: Scene.weatherLook(Scene.merge(Scene.defaults, JSON.parse(Quickshell.env("ORBITAL_PARAMS") || "{}")), JSON.parse(Quickshell.env("ORBITAL_WEATHER") || "null"))
      sceneTime: Number(Quickshell.env("ORBITAL_T") || 0)
    }

    Timer {
      id: go
      interval: 400
      running: true
      property int n: 0
      property real t0: 0
      onTriggered: {
        t0 = Date.now()
        painter.grabToImage(function(result) {
          var ms = Date.now() - go.t0
          if (root.bench > 0) console.log("orbital frame " + go.n + ": " + ms + " ms")
          if (go.n === 0) result.saveToFile(root.out)
          go.n++
          if (go.n < Math.max(1, root.bench)) { go.interval = 50; go.restart() }
          else Qt.quit()
        }, Qt.size(root.w, root.h))
      }
    }
  }
}
