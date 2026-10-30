import Quickshell
import Quickshell.Io
import QtQuick

// The Claude Code sessions on this machine, as presence.sh records them from Claude Code's
// hooks: [{id, state, project, since}], oldest first. A session that ends lingers a few
// seconds as "gone" so its light can fade out.
Item {
  id: presence

  property bool enabled: true
  property var sessions: []
  readonly property string home: Quickshell.env("HOME")
  property var departing: ({})          // id -> {session, until}

  function update(raw) {
    var o = {}
    try { o = JSON.parse(raw || "{}") } catch (e) { return }    // a half-written file: keep the last
    var now = Date.now(), list = [], seen = {}, id
    for (id in o) {
      seen[id] = true
      list.push({id: id, state: o[id].state || "idle", project: o[id].project || "", since: o[id].since || 0})
    }
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i]
      if (!seen[s.id] && !departing[s.id] && s.state !== "gone") departing[s.id] = {session: s, until: now + 3000}
    }
    for (id in departing) {
      if (seen[id] || departing[id].until < now) delete departing[id]
      else list.push({id: id, state: "gone", project: departing[id].session.project, since: departing[id].session.since})
    }
    list.sort(function (a, b) { return a.since - b.since || (a.id < b.id ? -1 : 1) })
    if (JSON.stringify(list) !== JSON.stringify(sessions)) sessions = list
  }

  FileView {
    id: file
    path: presence.home + "/.cache/vereda-orbital/sessions.json"
    printErrors: false
    onLoaded: presence.update(text())
    onLoadFailed: presence.update("{}")
  }

  // The file is replaced on every change, which a watch would lose; reading it every two seconds is cheap.
  Timer { interval: 2000; repeat: true; running: presence.enabled; triggeredOnStart: true; onTriggered: file.reload() }

  Process { id: prune; command: [presence.home + "/.local/share/vereda-orbital/presence.sh", "prune"] }
  Timer { interval: 60000; repeat: true; running: presence.enabled; triggeredOnStart: true; onTriggered: if (!prune.running) prune.running = true }
}
