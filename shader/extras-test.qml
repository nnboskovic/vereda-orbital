import Quickshell
import Quickshell.Wayland
import QtQuick
import "Scene.js" as Scene
// Session lights, meteors and the lock-screen snapshot, offscreen: three fake sessions,
// the Geminids at peak, three meteors launched on cue and grabbed mid-flight.
ShellRoot {
  PanelWindow {
    id: win
    implicitWidth: 1; implicitHeight: 1
    anchors { top: true; left: true }
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    mask: Region {}
    OrbitalLive {
      id: live
      width: 1280; height: 720
      dpr: win.devicePixelRatio || 1
      running: true
      meteorDate: Scene.showerPeak("geminids", 2026)
      sessions: [{id: "a", state: "working", project: "fleet-admiral", since: 1},
                 {id: "b", state: "waiting", project: "claude-memory", since: 2},
                 {id: "c", state: "idle", project: "veredalabs-dev", since: 3}]
    }
    Timer {
      interval: 3000; running: true
      onTriggered: {
        for (var i = 0; i < live.children.length; i++) if (live.children[i].perMinute !== undefined) { var m = live.children[i]; m.launch(); m.launch(); m.launch() }
        grab.start()
      }
    }
    Timer {
      id: grab; interval: 260
      onTriggered: {
        live.grabToImage(function (r) { r.saveToFile(Quickshell.env("ORBITAL_OUT") + "-live.png") }, Qt.size(1280, 720))
        live.snapshot(Quickshell.env("ORBITAL_OUT") + "-snapshot.png", function (ok) { console.log("snapshot " + ok); Qt.quit() })
      }
    }
    Timer { interval: 15000; running: true; onTriggered: Qt.quit() }
  }
}
