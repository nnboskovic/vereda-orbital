import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import Quickshell.Services.UPower
import QtQuick
import QtQuick.Effects
import QtQuick.Shapes
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Scene.js" as Scene

Item {
  id: root

  readonly property string home: Quickshell.env("HOME")
  readonly property string stateHome: home + "/.local/state"
  readonly property string currentBackgroundLink: stateHome + "/omarchy/current/background"

  // Vereda Orbital: a background named orbital-live.* is drawn live by OrbitalLive,
  // with its look read from the .json beside it. The image stays as the still frame
  // shown while the live one starts, during transitions and to the lock screen.
  readonly property bool orbitalBackground: /(^|\/)orbital-live\.[^\/]+$/.test(currentBackground)
  readonly property bool orbitalActive: orbitalBackground && orbitalParams !== null
  property var orbitalParams: null

  FileView {
    path: root.orbitalBackground ? root.currentBackground.replace(/\.[^.\/]+$/, ".json") : ""
    watchChanges: true
    onFileChanged: reload()
    onLoaded: {
      try { root.orbitalParams = Scene.merge(Scene.defaults, JSON.parse(text())) }
      catch (e) { console.warn("orbital look: " + e); root.orbitalParams = null }
    }
    onLoadFailed: root.orbitalParams = null
    onPathChanged: if (!path) root.orbitalParams = null
  }

  // The weather where you are, shared by every screen's Orbital.
  OrbitalWeather {
    id: orbitalWeather
    enabled: root.orbitalActive && root.orbitalParams.weather !== false
  }
  property var orbitalWeatherPreview: null

  // Claude Code sessions, as moored ships; and a preview date for the meteor calendar.
  OrbitalSessions {
    id: orbitalSessions
    enabled: root.orbitalActive
  }
  property var orbitalMeteorPreview: null

  // Sound: the intro's song, the ships' leitmotifs from the sessions' changes, thunder after
  // lightning (OrbitalSound plays them; orbital-sound sets them).
  OrbitalSound { id: orbitalSound }
  property var orbitalShipStates: null
  function orbitalShipStatesNow() {
    var now = {}, list = orbitalSessions.sessions
    for (var i = 0; i < list.length; i++) now[list[i].id] = list[i].state
    return now
  }
  Connections {
    target: orbitalSessions
    function onSessionsChanged() {
      var now = root.orbitalShipStatesNow(), prev = root.orbitalShipStates
      if (prev !== null) {
        for (var id in now) {
          var was = prev[id], is = now[id]
          if (was === undefined && is !== "gone") orbitalSound.play("arrive")
          else if (is === "waiting" && was !== "waiting") orbitalSound.play("needs-you")
          else if (is === "idle" && (was === "working" || was === "waiting")) orbitalSound.play("done")
          else if (is === "gone" && was !== undefined && was !== "gone") orbitalSound.play("depart")
        }
      }
      root.orbitalShipStates = now
    }
  }
  // the sessions already alongside when the shell starts are not news
  Timer { interval: 4000; running: true; onTriggered: if (root.orbitalShipStates === null) root.orbitalShipStates = root.orbitalShipStatesNow() }
  // thunder, a second or few after the flash, as from a storm some way off
  Timer { id: orbitalThunder; onTriggered: orbitalSound.play("thunder") }
  function orbitalLightning() {
    if (orbitalThunder.running) return
    orbitalThunder.interval = 1200 + Math.random() * 3000
    orbitalThunder.start()
  }

  // The login intro: the Vereda Labs mark opening into the Orbital. It plays when the shell
  // starts within a minute and a half of Hyprland (its instance signature carries its start
  // time), so a shell restart later does not replay it; omarchy-shell orbital intro replays it.
  readonly property bool orbitalFreshLogin: {
    var parts = String(Quickshell.env("HYPRLAND_INSTANCE_SIGNATURE") || "").split("_")
    var started = parts.length > 1 ? parseInt(parts[1]) : NaN
    return !isNaN(started) && Date.now() / 1000 - started < 90
  }
  property int orbitalIntroRequests: 0
  FontLoader { id: orbitalFont; source: "Manrope-latin.woff2" }

  // The lock screen blurs the background image file, so every ten minutes the Orbital as it
  // is now (hour and weather) replaces it; the image is also what shows at startup.
  property real orbitalSnapshotAt: 0
  function orbitalSnapshot(live) {
    if (!root.orbitalActive || Date.now() - root.orbitalSnapshotAt < 600000 || snapshotMove.running) return
    root.orbitalSnapshotAt = Date.now()
    var target = root.currentBackground, next = target.replace(/[^\/]+$/, ".orbital-live-next.png")
    live.snapshot(next, function (ok) {
      if (!ok) return
      snapshotMove.command = ["mv", "-f", next, target]
      snapshotMove.running = true
    })
  }
  Process { id: snapshotMove }

  // omarchy-shell orbital weather '{"cover":100,"code":95}' previews a weather;
  // omarchy-shell orbital weather '' goes back to the real one; status shows both.
  IpcHandler {
    target: "orbital"

    function weather(json: string): void {
      try { root.orbitalWeatherPreview = json ? JSON.parse(json) : null }
      catch (e) { console.warn("orbital weather preview: " + e) }
    }

    function intro(): void { root.orbitalIntroRequests++ }

    // omarchy-shell orbital meteors geminids previews a shower at its peak; '' goes back to tonight.
    function meteors(name: string): void {
      root.orbitalMeteorPreview = name ? Scene.showerPeak(name, new Date().getFullYear()) : null
    }

    function status(): string {
      var sky = Scene.meteorsOn(root.orbitalMeteorPreview || new Date())
      return JSON.stringify({active: root.orbitalActive, weather: orbitalWeather.conditions,
                             preview: root.orbitalWeatherPreview, lat: orbitalWeather.lat, lon: orbitalWeather.lon,
                             meteorsPerMinute: Math.round(sky.reduce(function (a, m) { return a + m.rate }, 0) / 15 * 100) / 100,
                             showers: sky.map(function (m) { return m.shower.name + " " + m.rate.toFixed(1) }),
                             meteorPreview: root.orbitalMeteorPreview, sessions: orbitalSessions.sessions,
                             snapshotAt: root.orbitalSnapshotAt ? new Date(root.orbitalSnapshotAt).toISOString() : null})
    }
  }

  property string currentBackground: ""
  property string displayedBackground: ""
  property string incomingBackground: ""
  property string oldBackground: ""
  property bool finishingTransition: false
  property int backgroundVersion: 0
  property int revealStartedVersion: -1
  property int pendingThemeVersion: -1
  property string pendingColorsRaw: ""
  property string pendingShellRaw: ""
  property real revealProgress: 1

  function imageUrl(path) {
    return Util.fileUrl(path)
  }

  function refreshBackground() {
    if (!readlinkProc.running) readlinkProc.running = true
  }

  function setBackground(path, instant) {
    transitionBackground("", path, path, instant, false)
  }

  function transitionBackground(fromPath, path, finalPath, instant, force) {
    path = String(path || "").trim()
    finalPath = String(finalPath || path).trim()
    fromPath = String(fromPath || "").trim()
    if (!path || (!force && finalPath === currentBackground)) return
    currentBackground = finalPath
    backgroundVersion += 1
    revealStartedVersion = -1

    revealAnimation.stop()
    finishingTransition = false

    if (instant || !displayedBackground) {
      oldBackground = ""
      incomingBackground = ""
      displayedBackground = path
      revealProgress = 1
      return
    }

    oldBackground = fromPath || displayedBackground
    incomingBackground = path
    revealProgress = 0
  }

  function setPendingTheme(colorsB64, shellB64) {
    pendingColorsRaw = Util.decodeBase64(colorsB64)
    pendingShellRaw = Util.decodeBase64(shellB64)
    pendingThemeVersion = backgroundVersion
    pendingThemeFallbackTimer.restart()
  }

  function applyPendingTheme() {
    // Background polling can advance backgroundVersion while a theme switch is
    // pending; the latest theme payload should still apply.
    if (pendingThemeVersion < 0) return
    pendingThemeFallbackTimer.stop()
    Commons.Color.loadColors(pendingColorsRaw)
    // Commons.Color.loadShell also refreshes Style so the type scale flips with the
    // background reveal instead of waiting for a separate reload path.
    Commons.Color.loadShell(pendingShellRaw)
    Style.scheduleRefresh()
    pendingThemeVersion = -1
    pendingColorsRaw = ""
    pendingShellRaw = ""
  }

  function transitionBackgroundWithTheme(fromPath, path, finalPath, colorsB64, shellB64) {
    transitionBackground(fromPath, path, finalPath, false, true)
    setPendingTheme(colorsB64, shellB64)
    if (!incomingBackground || revealProgress >= 1) applyPendingTheme()
  }

  function startReveal(panel) {
    if (!incomingBackground) return
    panel.maskReady = true
    if (revealStartedVersion === backgroundVersion) return
    revealStartedVersion = backgroundVersion
    applyPendingTheme()
    revealAnimation.restart()
  }

  function openSelector() {
    if (!bgSwitchProc.running) bgSwitchProc.running = true
  }

  function openThemeSwitcher() {
    if (!themeSwitchProc.running) themeSwitchProc.running = true
  }

  Process {
    id: bgSwitchProc
    command: ["bash", "-c", "background=$(omarchy-theme-bg-switcher); [[ -n $background ]] && omarchy-theme-bg-set \"$background\""]
    onExited: root.refreshBackground()
  }

  Process {
    id: themeSwitchProc
    command: ["bash", "-c", "theme=$(omarchy-theme-switcher); [[ -n $theme ]] && omarchy-theme-set \"$theme\" >/dev/null 2>&1 &"]
    onExited: root.refreshBackground()
  }

  Process {
    id: readlinkProc
    command: ["readlink", "-f", root.currentBackgroundLink]
    stdout: StdioCollector {
      onStreamFinished: root.setBackground(String(text || "").trim(), false)
    }
  }

  IpcHandler {
    target: "background"

    function refresh(): void {
      root.refreshBackground()
    }

    function set(path: string): void {
      root.setBackground(path, false)
    }

    function setInstant(path: string): void {
      root.setBackground(path, true)
    }

    function transition(fromPath: string, path: string): void {
      root.transitionBackground(fromPath, path, path, false, false)
    }

    function themeTransition(fromPath: string, path: string, finalPath: string, colorsB64: string, shellB64: string): void {
      root.transitionBackgroundWithTheme(fromPath, path, finalPath, colorsB64, shellB64)
    }
  }

  Timer {
    id: pendingThemeFallbackTimer
    interval: 300
    repeat: false
    onTriggered: root.applyPendingTheme()
  }

  NumberAnimation {
    id: revealAnimation
    target: root
    property: "revealProgress"
    from: 0
    to: 1
    duration: 420
    easing.type: Easing.InOutCubic
    onFinished: {
      if (root.incomingBackground) {
        root.displayedBackground = root.currentBackground || root.incomingBackground
        root.finishingTransition = true
      }
      root.revealProgress = 1
    }
  }

  Component.onCompleted: refreshBackground()

  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: panel
      required property var modelData

      screen: modelData
      visible: !remapGuard.remapping
      anchors { top: true; bottom: true; left: true; right: true }

      ScreenMoveRemap {
        id: remapGuard
        window: panel
      }
      color: "transparent"
      // Keep render updates enabled. The background layer has been observed to
      // lose its committed buffer while parked with updatesEnabled=false,
      // leaving a black desktop until omarchy-shell is restarted. The wallpaper
      // itself is static, so this favors correctness over a small render-loop
      // optimization.
      updatesEnabled: true

      property bool maskReady: false

      function maybeStartReveal() {
        if (!root.incomingBackground || root.revealProgress !== 0 || maskReady) return
        if (incomingFrame.status !== Image.Ready) return
        Qt.callLater(function() {
          if (!root.incomingBackground || root.revealProgress !== 0 || maskReady) return
          if (incomingFrame.status !== Image.Ready) return
          root.startReveal(panel)
        })
      }

      WlrLayershell.namespace: "omarchy-background"
      WlrLayershell.layer: WlrLayer.Background
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
      exclusionMode: ExclusionMode.Ignore

      Image {
        id: base
        anchors.fill: parent
        source: root.imageUrl(root.displayedBackground)
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        cache: true
        onStatusChanged: {
          if (status === Image.Ready && root.finishingTransition) {
            root.incomingBackground = ""
            root.oldBackground = ""
            root.finishingTransition = false
          }
        }
      }

      OrbitalLive {
        id: orbitalLive
        anchors.fill: parent
        dpr: panel.devicePixelRatio || 1
        params: root.orbitalParams || Scene.defaults
        weather: root.orbitalWeatherPreview || orbitalWeather.conditions
        previewing: root.orbitalWeatherPreview !== null
        sessions: orbitalSessions.sessions
        meteorDate: root.orbitalMeteorPreview
        onFrameFinished: if (panel.modelData === Quickshell.screens[0]) root.orbitalSnapshot(orbitalLive)
        onLightning: if (panel.modelData === Quickshell.screens[0]) root.orbitalLightning()
        // Only spend the GPU while the desktop on this screen is actually showing.
        readonly property var monitor: Hyprland.monitorFor(panel.screen)
        readonly property var workspace: monitor ? monitor.activeWorkspace : null
        readonly property bool desktopShowing: !workspace || workspace.toplevels.values.length === 0
        visible: root.orbitalActive
        running: visible && root.incomingBackground === "" && desktopShowing
        // Never fully transparent: Qt skips rendering an opacity-0 subtree, captures included,
        // so while the first frames build it sits at a practically invisible 0.002 instead.
        opacity: ready && root.incomingBackground === "" ? 1 : 0.002
        Behavior on opacity { NumberAnimation { duration: 700; easing.type: Easing.InOutQuad } }
        // Half the frame rate on battery; the clouds keep their pace, just in coarser steps.
        tickMs: UPower.onBattery ? 120 : 60
      }

      Image {
        id: oldFrame
        anchors.fill: parent
        source: root.imageUrl(root.oldBackground)
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        cache: false
        smooth: true
        mipmap: true
        visible: root.oldBackground !== "" && root.revealProgress < 1
        onStatusChanged: panel.maybeStartReveal()
      }

      Item {
        id: incomingLayer
        anchors.fill: parent
        visible: root.incomingBackground !== "" && incomingFrame.status === Image.Ready && (root.revealProgress >= 1 || panel.maskReady)
        layer.enabled: root.incomingBackground !== "" && root.revealProgress < 1
        layer.smooth: true
        layer.effect: MultiEffect {
          maskEnabled: true
          maskSource: revealMask
          maskThresholdMin: 0.5
          maskSpreadAtMin: 0.02
        }

        Image {
          id: incomingFrame
          anchors.fill: parent
          source: root.imageUrl(root.incomingBackground)
          fillMode: Image.PreserveAspectCrop
          asynchronous: true
          cache: false
          smooth: true
          mipmap: true
          onStatusChanged: panel.maybeStartReveal()
        }
      }

      Item {
        id: revealMask
        anchors.fill: parent
        visible: false
        layer.enabled: true

        readonly property real slant: -0.18
        readonly property real centerTop: width / 2 - slant * height / 2
        readonly property real centerBottom: width / 2 + slant * height / 2
        readonly property real reach: width / 2 + Math.abs(slant) * height / 2 + 4
        readonly property real spread: reach * root.revealProgress

        Shape {
          anchors.fill: parent
          antialiasing: true
          preferredRendererType: Shape.CurveRenderer
          ShapePath {
            fillColor: "white"
            strokeColor: "transparent"
            startX: revealMask.centerTop - revealMask.spread; startY: 0
            PathLine { x: revealMask.centerTop + revealMask.spread; y: 0 }
            PathLine { x: revealMask.centerBottom + revealMask.spread; y: revealMask.height }
            PathLine { x: revealMask.centerBottom - revealMask.spread; y: revealMask.height }
            PathLine { x: revealMask.centerTop - revealMask.spread; y: 0 }
          }
        }
      }

      Connections {
        target: root
        function onIncomingBackgroundChanged() {
          panel.maskReady = false
          panel.maybeStartReveal()
        }
      }

      MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        onDoubleClicked: function(mouse) {
          if (mouse.button === Qt.RightButton) root.openThemeSwitcher()
          else root.openSelector()
          mouse.accepted = true
        }
      }

      OrbitalIntro {
        id: orbitalIntro
        anchors.fill: parent
        z: 10
        dpr: panel.devicePixelRatio || 1
        params: root.orbitalParams || Scene.defaults
        ship: (root.orbitalParams || Scene.defaults).ship || ""
        fontFamily: orbitalFont.name
        onStarted: if (panel.modelData === Quickshell.screens[0]) orbitalSound.play("song")
        // at a fresh login, cover the screen as soon as the background is known, then play
        property bool autoPlayed: false
        readonly property bool wanted: root.orbitalFreshLogin && root.orbitalBackground && !autoPlayed
        onWantedChanged: if (wanted) { autoPlayed = true; play() }
        Connections {
          target: root
          function onOrbitalIntroRequestsChanged() { if (root.orbitalBackground) orbitalIntro.play() }
        }
      }
    }
  }
}
