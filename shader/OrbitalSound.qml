import Quickshell
import Quickshell.Io
import QtQuick

// The Orbital's sounds (sound/out/*.wav, rendered by sound/render.js), played through PipeWire.
// Settings are in ~/.config/vereda-orbital/sound.json, which orbital-sound edits: on, volume,
// song (funk, boot, disco, digital or shuffle) and a switch per group (theme, ships, signals, sky).
// Ships and signals stay quiet while notifications are silenced (Do Not Disturb).
Item {
  id: snd

  readonly property string home: Quickshell.env("HOME")
  readonly property string dir: home + "/.local/share/vereda-orbital/sound/out/"
  property var settings: ({})
  property bool dnd: false
  property var lastAt: ({})
  property int next: 0
  readonly property var groups: ({
    "theme": "theme", "theme-disco": "theme", "theme-funk": "theme", "theme-digital": "theme",
    "arrive": "ships", "needs-you": "ships", "done": "ships", "depart": "ships",
    "swept": "signals", "tight-point": "signals", "broadcast": "signals",
    "thunder": "sky", "drift": "sky"
  })

  function setting(key, fallback) { return settings && settings[key] !== undefined ? settings[key] : fallback }

  // The intro's song: the chosen one, or any of the four on shuffle.
  function songId() {
    var s = String(setting("song", "funk"))
    if (s === "shuffle") s = ["boot", "disco", "funk", "digital"][Math.floor(Math.random() * 4)]
    return s === "boot" ? "theme" : "theme-" + s
  }

  // Plays a motif by id ("song" for the intro's), unless its group is off, it is too soon after
  // the same one, or notifications are silenced. Returns whether it played.
  function play(id, gain) {
    if (id === "song") id = songId()
    var group = groups[id]
    if (!group || !setting("on", true) || setting(group, true) === false) return false
    if (dnd && (group === "ships" || group === "signals")) return false
    var now = Date.now()
    if (lastAt[id] && now - lastAt[id] < (group === "sky" ? 3500 : 1200)) return false
    lastAt[id] = now
    var volume = Math.max(0, Math.min(1, Number(setting("volume", 0.8)) * (gain === undefined ? 1 : gain)))
    for (var k = 0; k < players.length; k++) {
      var p = players[(next + k) % players.length]
      if (p.running) continue
      p.command = ["pw-play", "--media-role", "Notification", "--volume", volume.toFixed(3), dir + id + ".wav"]
      p.running = true
      next = (next + k + 1) % players.length
      return true
    }
    return false
  }

  property list<QtObject> players: [Process {}, Process {}, Process {}, Process {}]

  FileView {
    id: settingsFile
    path: snd.home + "/.config/vereda-orbital/sound.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: { try { snd.settings = JSON.parse(text()) } catch (e) { snd.settings = {} } }
    onLoadFailed: snd.settings = {}
  }
  FileView {
    id: dndFile
    path: snd.home + "/.local/state/omarchy/notifications.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: { try { snd.dnd = !!JSON.parse(text()).dnd } catch (e) { snd.dnd = false } }
    onLoadFailed: snd.dnd = false
  }
  // the files are replaced rather than edited at times, which a watch can miss
  Timer { interval: 10000; repeat: true; running: true; onTriggered: { settingsFile.reload(); dndFile.reload() } }
}
