#!/usr/bin/env python3
"""Patches a clone of Omarchy's notifications plugin so that, while the Vereda Orbital theme
is on, notifications arrive as Culture signal traffic: a transmission line in the manner of
Excession, then who the signal is from (x, a ship named for the app, or the Orbital's Hub for
Omarchy's own) and to (o, this machine's ship from the theme's look), with the text in Manrope.

    patch.py <plugin-folder>     (idempotent: an already patched clone is left alone)
"""
import sys
from pathlib import Path

MARK = "Vereda Orbital"
folder = Path(sys.argv[1])
service = folder / "Service.qml"
card = folder / "components" / "NotificationCard.qml"


def patch(path, edits):
    text = path.read_text()
    if MARK in text:
        return
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
  function veredaSender(app) {
    var a = String(app || "")
    if (a === "" || /omarchy|notify-send/i.test(a)) return "Hub, Vereda Orbital"
    var s = Scene.shipsFor([a.toLowerCase()])[0]
    return s.cls + " " + s.name
  }
'''),
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
