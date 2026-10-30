import Quickshell
import Quickshell.Wayland
import QtQuick
import "Scene.js" as Scene
// Plays the login intro offscreen over the current Orbital still and saves six moments of it.
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
    FontLoader { id: manrope; source: "Manrope-latin.woff2" }
    Item {
      id: stage
      width: 1280; height: 720
      Image { anchors.fill: parent; source: "file://" + Quickshell.env("HOME") + "/.local/state/omarchy/current/theme/backgrounds/orbital-live.png"; cache: false }
      OrbitalIntro { id: intro; anchors.fill: parent; dpr: win.devicePixelRatio || 1.5; params: Scene.merge(Scene.defaults, {hour: 0.5}); ship: Scene.defaults.ship; fontFamily: manrope.name }
    }
    property var times: [1500, 3400, 4300, 4700, 5100, 5500, 5800, 6100, 6500, 7000]
    property int k: 0
    property real t0: 0
    Timer { interval: 600; running: true; onTriggered: { win.t0 = Date.now(); intro.play(); shot.interval = win.times[0]; shot.start() } }
    Timer {
      id: shot
      onTriggered: {
        var n = win.k
        stage.grabToImage(function (r) { r.saveToFile(Quickshell.env("ORBITAL_OUT") + "-" + n + ".png") }, Qt.size(640, 360))
        win.k++
        if (win.k < win.times.length) { interval = win.times[win.k] - (Date.now() - win.t0); start() } else quit.start()
      }
    }
    Timer { id: quit; interval: 400; onTriggered: Qt.quit() }
  }
}
