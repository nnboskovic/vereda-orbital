import Quickshell
import "Scene.js" as Scene
import Quickshell.Wayland
import QtQuick
// Checks the paused refresh: run, pause, request a refresh, expect exactly two more frames.
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
      width: 640; height: 360
      dpr: win.devicePixelRatio || 1
      running: true
      onFinishedChanged: console.log("frame " + finished + " running=" + running + " burst=" + burst + " hour=" + Scene.clockHour().toFixed(3))
    }
    Timer { interval: 2600; running: true; onTriggered: { live.running = false; console.log("paused at slice " + live.slice + ", finished " + live.finished) } }
    Timer { interval: 4000; running: true; onTriggered: { live.burst = 2 * live.slices - live.slice; console.log("refresh requested: burst " + live.burst) } }
    Timer { interval: 9000; running: true; onTriggered: { console.log("end: finished " + live.finished + ", burst " + live.burst + ", slice " + live.slice); Qt.quit() } }
  }
}
