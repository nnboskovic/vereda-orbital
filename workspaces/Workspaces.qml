import QtQuick
import Quickshell.Hyprland
import qs.Commons
import qs.Ui

// Workspaces as lights along a gentle arc, the way their places lie along the Orbital (each
// workspace is a place on the ring; see Scene.atPlace). Bright where you are, lit where a
// workspace has windows, faint where it's empty. Hover for its number, click to go there.
// As in Omarchy's own widget, workspaces 1 to 5 always show, and 6 to 10 while they exist.
BarWidget {
  id: root
  moduleName: "omarchy.workspaces"

  function workspaceById(id) {
    var values = Hyprland.workspaces.values
    for (var i = 0; i < values.length; i++) {
      if (values[i].id === id) return values[i]
    }
    return null
  }

  function workspaceIds() {
    var ids = [1, 2, 3, 4, 5]
    var values = Hyprland.workspaces.values
    for (var i = 0; i < values.length; i++) {
      var id = values[i].id
      if (id > 0 && id <= 10 && ids.indexOf(id) === -1) ids.push(id)
    }
    ids.sort(function(left, right) { return left - right })
    return ids
  }

  function focusWorkspace(id) {
    if (!root.bar) return
    root.bar.run("hyprctl dispatch " + Util.shellQuote("hl.dsp.focus({ workspace = \"" + id + "\" })"))
  }

  function tinted(c, alpha) { return Qt.rgba(c.r, c.g, c.b, alpha) }

  readonly property var ids: workspaceIds()
  readonly property real step: Style.space(16)                 // between lights, along the arc
  readonly property real sag: Math.max(2, root.barSize * 0.12)  // how far the arc's middle dips
  readonly property real trailingGap: root.vertical ? 0 : Style.spaceReal(1.5)

  implicitWidth: root.vertical ? root.barSize : ids.length * step + trailingGap
  implicitHeight: root.vertical ? ids.length * step : root.barSize

  Repeater {
    model: root.ids

    Item {
      id: light
      required property int modelData
      required property int index

      readonly property var workspace: root.workspaceById(modelData)
      readonly property bool occupied: workspace !== null && workspace.toplevels.values.length > 0
      readonly property bool focused: Hyprland.focusedWorkspace !== null && Hyprland.focusedWorkspace.id === modelData
      property bool tooltipHovered: false
      // where along the arc, -1 at the first light to 1 at the last
      readonly property real u: root.ids.length > 1 ? index / (root.ids.length - 1) * 2 - 1 : 0
      readonly property real bow: root.sag * (1 - u * u)

      x: root.vertical ? (root.barSize - width) / 2 + bow : index * root.step
      y: root.vertical ? index * root.step : (root.barSize - height) / 2 + bow - root.sag / 2
      width: root.step
      height: root.step

      // the glow where you are, soft at its edge
      Item {
        anchors.fill: parent
        opacity: light.focused ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: 160 } }
        Rectangle { anchors.centerIn: parent; width: 18; height: 18; radius: 9; color: root.tinted(Color.accent, 0.09) }
        Rectangle { anchors.centerIn: parent; width: 13; height: 13; radius: 6.5; color: root.tinted(Color.accent, 0.16) }
      }

      Rectangle {
        anchors.centerIn: parent
        width: light.focused ? 8 : (light.occupied ? 6 : 5)
        height: width
        radius: width / 2
        color: light.focused ? Color.accent
          : light.occupied ? root.tinted(Color.accent, 0.8)
          : root.tinted(Color.foreground, 0.32)
        Behavior on width { NumberAnimation { duration: 140 } }
        Behavior on color { ColorAnimation { duration: 140 } }
      }

      MouseArea {
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onEntered: { light.tooltipHovered = true; if (root.bar) root.bar.showTooltip(light, "Workspace " + light.modelData) }
        onExited: { light.tooltipHovered = false; if (root.bar) root.bar.hideTooltip(light) }
        onClicked: root.focusWorkspace(light.modelData)
      }
    }
  }
}
