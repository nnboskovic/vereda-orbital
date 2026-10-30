import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Scene.js" as Scene

// A Culture drone in the bar. As in the books, it shows its mood in an aura field: a quiet
// grey-blue with nothing alongside, a calm blue with sessions holding, a slow cyan breath
// while any are underway, an amber pulse when one needs you, and a green flash as one
// finishes its turn. Hover lists the sessions as ships; a click jumps to the terminal of the
// one that needs you (else the busiest, else the newest).
// While the Vereda Orbital theme is on, it also tints the active window's border, the ship's
// field, amber whenever a session needs you.
BarWidget {
  id: root
  moduleName: "vereda.drone"

  readonly property string home: Quickshell.env("HOME")
  readonly property string presenceScript: home + "/.local/share/vereda-orbital/presence.sh"
  property var look: null               // the Orbital's look while the Vereda Orbital theme is on
  readonly property string ship: look && look.ship ? look.ship : Scene.defaults.ship

  OrbitalSessions { id: presence }
  readonly property var sessions: presence.sessions.filter(function (s) { return s.state !== "gone" })
  readonly property var ships: Scene.shipsFor(presence.sessions.map(function (s) { return s.id }))
  readonly property int waiting: sessions.filter(function (s) { return s.state === "waiting" }).length
  readonly property int working: sessions.filter(function (s) { return s.state === "working" }).length

  // a session that has just finished its turn
  property bool pleased: false
  property var lastStates: ({})
  onSessionsChanged: {
    var next = {}
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i]
      if ((lastStates[s.id] === "working" || lastStates[s.id] === "waiting") && s.state === "idle") { pleased = true; pleasedTimer.restart() }
      next[s.id] = s.state
    }
    lastStates = next
  }
  Timer { id: pleasedTimer; interval: 3500; onTriggered: root.pleased = false }

  readonly property string mood: waiting > 0 ? "waiting" : pleased ? "pleased" : working > 0 ? "busy" : sessions.length > 0 ? "calm" : "quiet"
  readonly property color aura: mood === "waiting" ? "#ffc27a" : mood === "pleased" ? "#8fe3a6" : mood === "busy" ? "#72d7df"
                              : mood === "calm" ? "#8fb4e6" : "#5f7384"

  // The aura breathes at ~12 frames a second, and only while the mood moves, so the bar
  // is not redrawn at the display's full rate for hours while a session works.
  property real phase: 0
  Timer {
    interval: 80
    repeat: true
    running: root.mood === "waiting" || root.mood === "busy"
    onTriggered: root.phase = (root.phase + interval / (root.mood === "waiting" ? 1500 : 3800)) % 1
  }
  readonly property real breath: 0.5 - 0.5 * Math.cos(root.phase * 2 * Math.PI)
  readonly property real level: mood === "waiting" ? 0.4 + 0.6 * breath : mood === "busy" ? 0.55 + 0.3 * breath
                              : mood === "pleased" ? 1 : mood === "calm" ? 0.5 : 0.3

  implicitWidth: 30
  implicitHeight: barSize

  Item {
    id: drone
    anchors.centerIn: parent
    width: 24
    height: 14

    // the aura field, which carries the mood
    Rectangle { anchors.centerIn: parent; width: 26; height: 17; radius: 8.5; color: root.aura; opacity: 0.22 * root.level }
    Rectangle { anchors.centerIn: parent; width: 20; height: 12.5; radius: 6.25; color: root.aura; opacity: 0.42 * root.level }
    Rectangle { anchors.centerIn: parent; width: 15; height: 9; radius: 4.5; color: root.aura; opacity: 0.6 * root.level }
    // the drone itself: a small plain casing, darker than its field, with a lit seam
    Rectangle {
      anchors.centerIn: parent
      width: 11
      height: 6.5
      radius: 2
      color: "#1b2433"
      border.width: 1
      border.color: "#c9d4dc"
      Rectangle { anchors.centerIn: parent; width: 6; height: 1; color: root.aura; opacity: 0.6 + 0.4 * root.level }
    }
  }

  function describe() {
    var lines = [root.ship]
    if (presence.sessions.length === 0) lines.push("nothing alongside")
    for (var i = 0; i < presence.sessions.length; i++) {
      var s = presence.sessions[i], n = root.ships[i]
      var doing = s.state === "working" ? "underway" : s.state === "waiting" ? "needs you" : s.state === "gone" ? "leaving" : "holding"
      lines.push(n.cls + " " + n.name + " · " + (s.project ? s.project + " · " : "") + doing)
    }
    return lines.join("\n")
  }

  function target() {
    var pickFrom = function (state) { for (var i = sessions.length - 1; i >= 0; i--) if (sessions[i].state === state) return sessions[i]; return null }
    return pickFrom("waiting") || pickFrom("working") || (sessions.length ? sessions[sessions.length - 1] : null)
  }

  Process { id: focusProc }

  property bool tooltipHovered: false
  onMoodChanged: if (tooltipHovered && bar) bar.showTooltip(root, describe())

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onEntered: { root.tooltipHovered = true; if (root.bar) root.bar.showTooltip(root, root.describe()) }
    onExited: { root.tooltipHovered = false; if (root.bar) root.bar.hideTooltip(root) }
    onClicked: {
      var s = root.target()
      if (!s) return
      focusProc.command = [root.presenceScript, "focus", s.id]
      focusProc.running = true
    }
  }

  // --- The ship's field: the active window's border, amber while a session needs you.
  FileView {
    id: lookFile
    path: root.home + "/.local/state/omarchy/current/theme/backgrounds/orbital-live.json"
    printErrors: false
    onLoaded: { try { root.look = JSON.parse(text()) } catch (e) { root.look = null } }
    onLoadFailed: root.look = null
  }
  FileView {
    id: themeColors
    path: root.home + "/.local/state/omarchy/current/theme/colors.toml"
    printErrors: false
  }
  // theme changes replace these files; looking again every few seconds is cheap
  Timer { interval: 5000; repeat: true; running: true; triggeredOnStart: true; onTriggered: { lookFile.reload(); themeColors.reload() } }

  readonly property bool fieldOn: look !== null
  readonly property bool alarmed: fieldOn && waiting > 0
  property string fieldShown: ""

  function themeBorder() {
    var m = String(themeColors.text() || "").match(/hyprland_active_border\s*=\s*"([^"]+)"/)
    return m ? m[1] : "rgba(72d7dfee) rgba(eff2eaee) 45deg"
  }

  function applyField() {
    if (!fieldOn) { fieldShown = ""; return }
    var spec = themeBorder()
    if (alarmed) spec = spec.replace(/rgba?\([^)]*\)/, "rgba(ffc27aee)")
    if (spec === fieldShown) return
    var colors = spec.match(/rgba?\([^)]*\)/g) || []
    var angle = (spec.match(/(-?\d+)\s*deg/) || [0, 0])[1]
    var lua = "hl.config({ general = { col = { active_border = { colors = { " + colors.map(function (c) { return "\"" + c + "\"" }).join(", ")
            + " }, angle = " + angle + " } } } })"
    fieldProc.command = ["hyprctl", "eval", lua]
    fieldProc.running = true
    fieldShown = spec
  }
  Process { id: fieldProc }
  onAlarmedChanged: applyField()
  onFieldOnChanged: applyField()
}
