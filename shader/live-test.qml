import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import QtQuick
import "Scene.js" as Scene

// Runs OrbitalLive offscreen for a few seconds and saves snapshots of what it shows.
ShellRoot {
  id: root
  readonly property string out: Quickshell.env("ORBITAL_OUT") || "/tmp/orbital-live"

  PanelWindow {
    id: win
    implicitWidth: 1
    implicitHeight: 1
    anchors { top: true; left: true }
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    WlrLayershell.namespace: "vereda-orbital-test"
    mask: Region {}

    OrbitalLive {
      id: live
      width: 1280
      height: 720
      dpr: win.devicePixelRatio || 1
      params: Scene.merge(Scene.defaults, JSON.parse(Quickshell.env("ORBITAL_PARAMS") || "{}"))
      running: true
      property int lastFinished: 0
      onFinishedChanged: console.log("frame " + finished + " at " + (Date.now() - t0.start) + " ms, scene t=" + sceneTime.toFixed(2))
    }

    QtObject { id: t0; property real start: Date.now() }

    Component.onCompleted: {
      var m = Hyprland.monitorFor(win.screen)
      console.log("screen dpr " + Screen.devicePixelRatio + ", window dpr " + win.devicePixelRatio + ", monitor " + (m ? m.name : "?") + ", workspace " + (m && m.activeWorkspace ? m.activeWorkspace.name + " windows=" + m.activeWorkspace.toplevels.values.length : "?"))
    }

    Timer {
      interval: 2600; running: true; repeat: true
      property int n: 0
      onTriggered: {
        var k = n++
        live.grabToImage(function(r) { r.saveToFile(root.out + "-" + k + ".png") }, Qt.size(1280, 720))
        if (n >= 3) Qt.callLater(function() { quitTimer.start() })
      }
    }
    Timer { id: quitTimer; interval: 600; onTriggered: Qt.quit() }
  }
}
