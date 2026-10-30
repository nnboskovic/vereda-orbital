import QtQuick
import "Scene.js" as Scene

// One rectangle of an Orbital frame. Covers the whole frame by default;
// the live background narrows it to a slice with frameOrigin/pixelSize.
ShaderEffect {
  id: fx

  property var params: Scene.defaults
  property real sceneTime: 0
  property real hour: -1                           // local hour for the sun; -1 uses params.hour
  property size frameSize: Qt.size(width, height)   // whole frame, pixels
  property point frameOrigin: Qt.point(0, 0)       // this item's corner in the frame, pixels
  property size pixelSize: frameSize               // this item's size, pixels
  property string shaderFile: "orbital.frag.qsb"   // flash.frag.qsb draws lightning instead

  readonly property var view: Scene.frame(params, sceneTime, hour)
  function v3(a) { return Qt.vector3d(a[0], a[1], a[2]) }

  property real uTime: sceneTime
  property real uF: view.F
  property real uExp: view.exposure
  property real uClo: params.clouds
  property real uLand: params.land
  property real uBr: params.rayleigh
  property real uStreak: params.streak
  property real uLights: params.lights
  property real uShine: params.ringshine
  property real uW: params.width
  property real uEdge: params.cloudEdge
  property vector2d uRes: Qt.vector2d(frameSize.width, frameSize.height)
  property vector2d uOrigin: Qt.vector2d(frameOrigin.x, frameOrigin.y)
  property vector2d uSize: Qt.vector2d(pixelSize.width, pixelSize.height)
  property vector3d uCam: v3(view.cam)
  property vector3d uRight: v3(view.right)
  property vector3d uUp: v3(view.up)
  property vector3d uFwd: v3(view.fwd)
  property vector3d uSun: v3(view.sun)
  property vector3d uSea: v3(params.sea)
  property vector3d uDeep: v3(params.deep)
  property vector3d uSunC: v3(params.sunColor)
  property vector3d uCloudC: v3(params.cloudColor)
  property vector3d uBolt: Qt.vector3d(0, 0, 0)    // lightning only
  property real uBoltR: 100
  property real uFlash: 0

  blending: false
  fragmentShader: Qt.resolvedUrl(shaderFile)
}
