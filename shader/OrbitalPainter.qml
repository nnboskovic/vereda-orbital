import QtQuick
import Quickshell
import Quickshell.Io
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
  property real uMode: params.mapMode || 0         // 1 draws the land map for the weather simulation

  // The weather simulation's maps (weather/sim.py), as textures that wrap round the ring. Each
  // new pair loads into the spare slot while the other stays in use; the live Orbital takes it
  // up only at the start of a frame (latchSky), so one frame's slices never mix two maps, and
  // anything else takes it up as soon as it has loaded.
  property bool latchMaps: false
  readonly property string skyDir: Quickshell.env("HOME") + "/.cache/vereda-orbital/weather/"
  property int slot: 0
  property int mapsVersion: 0
  property bool waitingSwap: false
  property real askedAt: 0
  readonly property var skyImages: [sky0, sky1]
  readonly property var airImages: [air0, air1]
  function pairReady(k) { return skyImages[k].status === Image.Ready && airImages[k].status === Image.Ready }
  readonly property bool hasSky: pairReady(slot)
  property real uHasSky: hasSky ? 1 : 0
  property var uSky: slot === 0 ? skyTex0 : skyTex1
  property var uAir: slot === 0 ? airTex0 : airTex1

  // Swaps to the newest maps if they have loaded. Returns false while a first pair is still
  // on its way, so a frame doesn't start without weather it could have had.
  function latchSky() {
    if (waitingSwap && pairReady(1 - slot)) { slot = 1 - slot; waitingSwap = false }
    return hasSky || !waitingSwap || Date.now() - askedAt > 3000
  }
  function loadMaps() {
    mapsVersion++
    var k = 1 - slot, v = "?v=" + mapsVersion
    skyImages[k].source = "file://" + skyDir + "weather.png" + v
    airImages[k].source = "file://" + skyDir + "wind.png" + v
    waitingSwap = true
    askedAt = Date.now()
  }
  function mapLoaded() { if (!latchMaps) latchSky() }

  // the simulation writes status.json last, once both maps are in place
  FileView {
    path: fx.skyDir + "status.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: fx.loadMaps()
  }

  Image { id: sky0; cache: false; asynchronous: true; smooth: true; onStatusChanged: fx.mapLoaded() }
  Image { id: sky1; cache: false; asynchronous: true; smooth: true; onStatusChanged: fx.mapLoaded() }
  Image { id: air0; cache: false; asynchronous: true; smooth: true; onStatusChanged: fx.mapLoaded() }
  Image { id: air1; cache: false; asynchronous: true; smooth: true; onStatusChanged: fx.mapLoaded() }
  ShaderEffectSource { id: skyTex0; sourceItem: sky0; hideSource: true; visible: false; textureSize: Qt.size(3016, 104); wrapMode: ShaderEffectSource.Repeat; mipmap: true }
  ShaderEffectSource { id: skyTex1; sourceItem: sky1; hideSource: true; visible: false; textureSize: Qt.size(3016, 104); wrapMode: ShaderEffectSource.Repeat; mipmap: true }
  ShaderEffectSource { id: airTex0; sourceItem: air0; hideSource: true; visible: false; textureSize: Qt.size(3016, 104); wrapMode: ShaderEffectSource.Repeat; mipmap: true }
  ShaderEffectSource { id: airTex1; sourceItem: air1; hideSource: true; visible: false; textureSize: Qt.size(3016, 104); wrapMode: ShaderEffectSource.Repeat; mipmap: true }

  blending: false
  fragmentShader: Qt.resolvedUrl(shaderFile)
}
