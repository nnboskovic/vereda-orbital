import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import Quickshell.Services.UPower
import QtQuick
import QtQuick.Effects
import QtQuick.Shapes
import QtMultimedia
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

  // Each workspace is its own place on the Orbital (Scene.atPlace). Every screen draws a still
  // of each place every ten minutes, for a workspace switch to fade to; they're kept here.
  readonly property string orbitalPlacesDir: home + "/.cache/vereda-orbital/places"
  property int orbitalStillsRequests: 0
  property var orbitalPlaceInfo: null
  Process { command: ["mkdir", "-p", root.orbitalPlacesDir]; running: true }

  // The lock screen shows the place you locked from: on every change of place the place's
  // still replaces the background image, as the ten-minute snapshot does.
  function orbitalLockFrom(path) {
    if (!root.orbitalActive || !path || !root.currentBackground || lockCopy.running) return
    lockCopy.command = ["sh", "-c", 'cp -f "$1" "$2.next" && mv -f "$2.next" "$2"', "sh", path, root.currentBackground]
    lockCopy.running = true
    root.orbitalSnapshotAt = Date.now()
  }
  Process { id: lockCopy }

  // The idle flyover. After `flyover` seconds without input (Omarchy's own screensaver is off),
  // a window over everything sets out from the place you left and drifts on along the band
  // (Scene.flyoverMotion), with the quiet drift pad when the sky's sounds are on. A key, the
  // mouse, or a hand in view (with hyprhands on) ends it, and so does the lock taking over.
  readonly property int flyoverAfter: root.orbitalParams ? (root.orbitalParams.flyover || 0) : 0
  property bool flying: false
  property real flyingSince: 0
  property bool flyoverWanted: false
  onFlyingChanged: {
    if (flying) {
      flyingSince = Date.now()
      flyoverHandsProbe.reload()
      if (orbitalSound.setting("on", true) && orbitalSound.setting("sky", true) !== false) {
        driftFadeOut.stop()
        driftOut.volume = 0
        driftPad.play()
        driftFadeIn.to = Math.max(0, Math.min(1, Number(orbitalSound.setting("volume", 0.8))))
        driftFadeIn.restart()
      }
    } else {
      flyoverHands.connected = false
      driftFadeIn.stop()
      if (driftPad.playbackState === MediaPlayer.PlayingState) driftFadeOut.restart()
    }
  }
  function startFlyover() {
    if (!root.orbitalActive || root.flying) return
    root.flyoverWanted = true
    if (!lockCheck.running) lockCheck.running = true
  }
  IdleMonitor {
    enabled: root.orbitalActive && root.flyoverAfter > 0
    respectInhibitors: true
    timeout: Math.max(1, root.flyoverAfter)
    onIsIdleChanged: isIdle ? root.startFlyover() : (root.flying = false)
  }
  // Not over the lock screen: check before setting out, and every few seconds while flying.
  Process {
    id: lockCheck
    command: ["omarchy-shell", "-q", "lock", "isLocked"]
    stdout: StdioCollector {
      onStreamFinished: {
        var locked = String(text || "").trim() === "true"
        if (locked) root.flying = false
        else if (root.flyoverWanted) root.flying = true
        root.flyoverWanted = false
      }
    }
  }
  Timer { interval: 3000; repeat: true; running: root.flying; onTriggered: if (!lockCheck.running) lockCheck.running = true }
  // A hand in view ends it, when hyprhands is running (its socket is there: a socket isn't a
  // regular file, so finding it reads as NotAFile).
  FileView {
    id: flyoverHandsProbe
    path: Quickshell.env("XDG_RUNTIME_DIR") + "/hyprhands.sock"
    printErrors: false
    onLoadFailed: error => { if (root.flying && error !== FileViewError.FileNotFound) flyoverHands.connected = true }
  }
  Socket {
    id: flyoverHands
    path: flyoverHandsProbe.path
    onConnectedChanged: if (connected) { write('{"role":"flyover"}\n'); flush() }
    parser: SplitParser {
      onRead: line => {
        try {
          var m = JSON.parse(line)
          if (m.hands && m.hands.length && Date.now() - root.flyingSince > 1500) root.flying = false
        } catch (e) {}
      }
    }
  }
  MediaPlayer {
    id: driftPad
    source: "file://" + root.home + "/.local/share/vereda-orbital/sound/out/drift.wav"
    loops: MediaPlayer.Infinite
    audioOutput: AudioOutput { id: driftOut; volume: 0 }
  }
  NumberAnimation { id: driftFadeIn; target: driftOut; property: "volume"; duration: 4000; easing.type: Easing.InOutQuad }
  NumberAnimation {
    id: driftFadeOut
    target: driftOut
    property: "volume"
    to: 0
    duration: 1200
    easing.type: Easing.InOutQuad
    onFinished: driftPad.stop()
  }

  // omarchy-shell orbital weather '{"cover":100,"code":95}' previews a weather;
  // omarchy-shell orbital weather '' goes back to the real one; status shows both.
  IpcHandler {
    target: "orbital"

    function weather(json: string): void {
      try { root.orbitalWeatherPreview = json ? JSON.parse(json) : null }
      catch (e) { console.warn("orbital weather preview: " + e) }
    }

    function intro(): void { root.orbitalIntroRequests++ }

    // omarchy-shell orbital stills draws every workspace's place again now.
    function stills(): void { root.orbitalStillsRequests++ }

    // omarchy-shell orbital flyover starts the idle flyover now, to see it; any key or the mouse ends it.
    function flyover(): void { root.startFlyover() }
    function land(): void { root.flying = false }

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
                             places: root.orbitalPlaceInfo,
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
        params: Scene.atPlace(root.orbitalParams || Scene.defaults, panel.livePlace)
        weather: root.orbitalWeatherPreview || orbitalWeather.conditions
        previewing: root.orbitalWeatherPreview !== null
        sessions: orbitalSessions.sessions
        meteorDate: root.orbitalMeteorPreview
        onFrameFinished: if (panel.modelData === Quickshell.screens[0]) root.orbitalSnapshot(orbitalLive)
        onLightning: if (panel.modelData === Quickshell.screens[0]) root.orbitalLightning()
        // Only spend the GPU while the desktop on this screen is actually showing.
        readonly property bool desktopShowing: !panel.hyprWorkspace || panel.hyprWorkspace.toplevels.values.length === 0
        visible: root.orbitalActive
        running: visible && root.incomingBackground === "" && desktopShowing
        // Never fully transparent: Qt skips rendering an opacity-0 subtree, captures included,
        // so while the first frames build it sits at a practically invisible 0.002 instead.
        opacity: ready && root.incomingBackground === "" ? 1 : 0.002
        Behavior on opacity { NumberAnimation { duration: 700; easing.type: Easing.InOutQuad } }
        // Half the frame rate on battery; the clouds keep their pace, just in coarser steps.
        tickMs: UPower.onBattery ? 120 : 60
      }

      // Places. `place` is where this screen's workspace is; `livePlace` is what the live Orbital
      // draws. On a switch the new place's still fades in over the screen, the live Orbital moves
      // there underneath, and the still lifts once the live one is back. With windows open the
      // still stays, so each workspace keeps its own place behind them.
      readonly property var hyprMonitor: Hyprland.monitorFor(panel.screen)
      readonly property var hyprWorkspace: hyprMonitor ? hyprMonitor.activeWorkspace : null
      property int place: 1
      property int livePlace: 1
      property var stills: ({})             // place -> its still, for the places drawn this session
      property int stillsVersion: 0
      readonly property bool caughtUp: orbitalLive.ready && orbitalLive.running && livePlace === place && orbitalLive.opacity >= 0.999

      function updatePlace() {
        var n = Scene.placeOf(hyprWorkspace ? hyprWorkspace.id : 1)
        if (n > 0) place = n
      }
      onHyprWorkspaceChanged: updatePlace()
      Component.onCompleted: { updatePlace(); livePlace = place }
      onPlaceChanged: {
        if (place === livePlace) { cover.hide(); return }
        var still = stills[place]
        if (!root.orbitalActive || !still) { livePlace = place; return }
        cover.show(root.imageUrl(still) + "?v=" + stillsVersion)
        if (panel.modelData === Quickshell.screens[0]) root.orbitalLockFrom(still)
      }
      onCaughtUpChanged: if (caughtUp) cover.hide()

      function drawPlaces() {
        if (!root.orbitalActive) return
        var order = [place]
        for (var n = 1; n <= 10; n++) if (n !== place) order.push(n)
        order.push(0)                       // and the map
        studio.render(order)
      }

      // Beside the map, where each workspace's place and the hub land on it, as fractions of
      // the screen, for the overview to put its plates on (vereda.hands, Overview.qml).
      function writeMapKey(path) {
        var look = Scene.merge(root.orbitalParams || Scene.defaults, {overhead: true})
        var view = Scene.frame(look, 0, Scene.clockHour()), aspect = panel.width / Math.max(1, panel.height)
        var key = {places: {}, hub: null}
        function frac(q) { return q ? [Math.round((q[0] + 1) / 2 * 1e4) / 1e4, Math.round((1 - q[1]) / 2 * 1e4) / 1e4] : null }
        for (var n = 1; n <= 10; n++) key.places[n] = frac(Scene.placeOnScreen(root.orbitalParams || Scene.defaults, view, n, aspect))
        key.hub = frac(Scene.project(view, [0, 0, 0], aspect))
        mapKey.command = ["sh", "-c", 'printf %s "$1" > "$2.next" && mv -f "$2.next" "$2"', "sh", JSON.stringify(key),
                          path.replace(/\.png$/, ".json")]
        mapKey.running = true
      }
      Process { id: mapKey }

      OrbitalCover {
        id: cover
        anchors.fill: parent
        visible: root.orbitalActive
        onShown: panel.livePlace = panel.place
      }

      OrbitalStudio {
        id: studio
        anchors.fill: parent
        z: -1
        dpr: panel.devicePixelRatio || 1
        params: root.orbitalParams || Scene.defaults
        weather: root.orbitalWeatherPreview || orbitalWeather.conditions
        tickMs: UPower.onBattery ? 120 : 60
        folder: root.orbitalPlacesDir
        prefix: panel.screen ? panel.screen.name : "screen"
        onPlaceDone: (place, path) => {
          if (place === 0) { panel.writeMapKey(path); return }
          var next = {}
          for (var k in panel.stills) next[k] = panel.stills[k]
          next[place] = path
          panel.stills = next
          panel.stillsVersion++
          if (place === panel.place && panel.modelData === Quickshell.screens[0]) root.orbitalLockFrom(path)
        }
      }
      // every ten minutes, and soon after the shell starts (past the login intro)
      Timer { interval: 10 * 60 * 1000; repeat: true; running: root.orbitalActive; onTriggered: panel.drawPlaces() }
      Timer { interval: 12000; running: root.orbitalActive; onTriggered: panel.drawPlaces() }
      Connections {
        target: root
        function onOrbitalStillsRequestsChanged() { panel.drawPlaces() }
        function onOrbitalParamsChanged() { panel.drawPlaces() }
      }
      // The idle flyover on this screen, setting out from this screen's place.
      LazyLoader {
        active: root.flying && root.orbitalActive

        PanelWindow {
          id: flyover
          screen: panel.modelData
          anchors { top: true; bottom: true; left: true; right: true }
          color: "transparent"
          WlrLayershell.namespace: "vereda-orbital-flyover"
          WlrLayershell.layer: WlrLayer.Overlay
          // It holds the keyboard, so the key that ends it isn't typed into a window underneath.
          WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
          exclusionMode: ExclusionMode.Ignore

          // the pointer arriving under a new window can look like a move; give it a moment
          function touched() { if (Date.now() - root.flyingSince > 1000) root.flying = false }

          Item {
            id: flight
            anchors.fill: parent
            opacity: 0
            Component.onCompleted: opacity = 1
            Behavior on opacity { NumberAnimation { duration: 1500; easing.type: Easing.InOutQuad } }

            Image {
              anchors.fill: parent
              source: panel.stills[panel.place] ? root.imageUrl(panel.stills[panel.place]) + "?v=" + panel.stillsVersion : ""
              fillMode: Image.PreserveAspectCrop
              asynchronous: true
              cache: false
            }

            OrbitalLive {
              id: flyoverLive
              anchors.fill: parent
              dpr: flyover.devicePixelRatio || 1
              params: Scene.atPlace(root.orbitalParams || Scene.defaults, panel.place)
              motion: (look, t) => Scene.flyoverMotion(look, t)
              weather: root.orbitalWeatherPreview || orbitalWeather.conditions
              running: true
              tickMs: UPower.onBattery ? 120 : 60
              opacity: ready ? 1 : 0.002
              Behavior on opacity { NumberAnimation { duration: 700; easing.type: Easing.InOutQuad } }
            }
          }

          MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            onPositionChanged: flyover.touched()
            onPressed: flyover.touched()
            onWheel: flyover.touched()
          }

          Item {
            anchors.fill: parent
            focus: true
            Component.onCompleted: forceActiveFocus()
            Keys.onPressed: flyover.touched()
          }
        }
      }

      Binding {
        target: root
        property: "orbitalPlaceInfo"
        when: panel.modelData === Quickshell.screens[0]
        value: ({place: panel.place, live: panel.livePlace, stills: Object.keys(panel.stills).length,
                 drawing: studio.busy, covered: cover.up})
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
