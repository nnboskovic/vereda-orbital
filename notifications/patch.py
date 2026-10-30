#!/usr/bin/env python3
"""Patches a clone of Omarchy's notifications plugin so that, while the Vereda Orbital theme
is on, notifications arrive as Culture signal traffic: a transmission line in the manner of
Excession, then who the signal is from (x, a ship named for the app, or the Orbital's Hub for
Omarchy's own) and to (o, this machine's ship from the theme's look), with the text in Manrope.

With the theme's sound on, each notification also chimes by its urgency (OrbitalSound).

    patch.py <plugin-folder>     starts from Omarchy's own files each time, so it can be re-run
"""
import os
import shutil
import sys
from pathlib import Path

folder = Path(sys.argv[1])
service = folder / "Service.qml"
card = folder / "components" / "NotificationCard.qml"
source = Path(os.environ.get("OMARCHY_PATH", "/usr/share/omarchy")) / "shell" / "plugins" / "notifications"
for name in ["Service.qml", "NotificationLogic.js", "components/NotificationCard.qml"]:
    shutil.copyfile(source / name, folder / name)


def patch(path, edits):
    text = path.read_text()
    for old, new in edits:
        if old not in text:
            sys.exit(f"{path.name}: cannot find {old.strip()[:60]!r}; Omarchy's plugin has changed")
        text = text.replace(old, new, 1)
    path.write_text(text)


patch(service, [
    ('import "NotificationLogic.js" as NotificationLogic\n',
     'import "NotificationLogic.js" as NotificationLogic\nimport "Scene.js" as Scene\n'),
    ("  id: service\n", '''  id: service

  // Vereda Orbital (patched in by vereda-orbital/notifications/patch.py): while that theme is
  // on, notifications arrive as Culture signal traffic, from a ship named for each app (the
  // Orbital's Hub for Omarchy's own) to this machine's ship, set in the theme's look.
  property var vereda: null
  FileView {
    id: veredaLook
    path: service.home + "/.local/state/omarchy/current/theme/backgrounds/orbital-live.json"
    printErrors: false
    onLoaded: { try { service.vereda = JSON.parse(text()) } catch (e) { service.vereda = null } }
    onLoadFailed: service.vereda = null
  }
  Timer { interval: 5000; repeat: true; running: true; triggeredOnStart: true; onTriggered: veredaLook.reload() }
  FontLoader { id: veredaFont; source: "Manrope-latin.woff2" }
  OrbitalSound { id: veredaSound }
  function veredaSender(app) {
    var a = String(app || "")
    if (a === "" || /omarchy|notify-send/i.test(a)) return "Hub, Vereda Orbital"
    var s = Scene.shipsFor([a.toLowerCase()])[0]
    return s.cls + " " + s.name
  }
'''),
    ("    persistPopupFile(snapshot)\n    watchForUpdates(notification, snapshot)\n",
     "    if (service.vereda) veredaSound.play(snapshot.urgency === 2 ? \"broadcast\" : snapshot.urgency === 0 ? \"swept\" : \"tight-point\")\n"
     "    persistPopupFile(snapshot)\n    watchForUpdates(notification, snapshot)\n"),
    ("              glyph: cardSlot.glyph\n", '''              glyph: cardSlot.glyph
              signalOn: service.vereda !== null
              signalFrom: service.veredaSender(cardSlot.app)
              signalTo: service.vereda ? (service.vereda.ship || Scene.defaults.ship) : ""
              signalFont: veredaFont.name
'''),
])

patch(card, [
    ('  property string fontFamily: ""\n', '''  property string fontFamily: ""

  // Vereda Orbital: Culture signal traffic. A transmission line in the manner of Excession,
  // then who the signal is from (x) and to (o); the text itself set in Manrope.
  property bool signalOn: false
  property string signalFrom: ""
  property string signalTo: ""
  property string signalFont: ""
  readonly property string signalHeader: "[" + (urgency === 2 ? "broadcast, M32" : urgency === 0 ? "swept, M4" : "tight point, M16")
                                         + ", tra. @" + Qt.formatTime(new Date(timestamp || Date.now()), "HH:mm:ss") + "]"
  readonly property string textFont: signalOn && signalFont ? signalFont : "Liberation Sans"
'''),
    ("    // Text content.\n", '''    ColumnLayout {
      visible: root.signalOn
      Layout.fillWidth: true
      Layout.leftMargin: Style.space(12)
      Layout.rightMargin: Style.space(12)
      Layout.topMargin: Style.space(9)
      spacing: Style.space(1)

      Text {
        Layout.fillWidth: true
        textFormat: Text.PlainText
        text: root.signalHeader
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        color: root.dimColor
        elide: Text.ElideRight
      }
      Text {
        Layout.fillWidth: true
        textFormat: Text.PlainText
        text: "x" + root.signalFrom
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        color: root.bodyColor
        elide: Text.ElideRight
      }
      Text {
        Layout.fillWidth: true
        visible: root.signalTo !== ""
        textFormat: Text.PlainText
        text: "o" + root.signalTo
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        color: root.bodyColor
        elide: Text.ElideRight
      }
    }

    // Text content.
'''),
    ("      Layout.topMargin: root.singleLineToast ? Style.space(7) : Style.space(10)\n",
     "      Layout.topMargin: root.signalOn ? Style.space(6) : (root.singleLineToast ? Style.space(7) : Style.space(10))\n"),
    ('          font.family: "Liberation Sans"\n          color: Commons.Color.notifications.text\n',
     '          font.family: root.textFont\n          color: Commons.Color.notifications.text\n'),
    ('          font.family: "Liberation Sans"\n          color: root.bodyColor\n',
     '          font.family: root.textFont\n          color: root.bodyColor\n'),
])
print("notifications patched:", folder)
