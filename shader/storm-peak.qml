import Quickshell
import Quickshell.Wayland
import QtQuick
import "Scene.js" as Scene
// Thunderstorm in OrbitalLive offscreen, grabbed the moment a flash peaks.
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
      previewing: true
      weather: ({cover: 100, low: 80, mid: 90, high: 70, code: 95, precip: 8, wind: 40})
    }
    property var bolt: null
    property bool grabbed: false
    Timer {
      interval: 10; repeat: true; running: !win.grabbed
      onTriggered: {
        if (!win.bolt) for (var i = 0; i < live.children.length; i++) if (live.children[i].flashLevel !== undefined) win.bolt = live.children[i]
        if (win.bolt && win.bolt.flashLevel > 0.9) {
          win.grabbed = true
          console.log("peak, z=" + win.bolt.z + " visible=" + win.bolt.visible)
          live.grabToImage(function(r) { r.saveToFile(Quickshell.env("ORBITAL_OUT")); Qt.quit() }, Qt.size(1280, 720))
        }
      }
    }
    Timer { interval: 15000; running: true; onTriggered: Qt.quit() }
  }
}
