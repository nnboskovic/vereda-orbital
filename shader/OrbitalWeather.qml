import Quickshell
import Quickshell.Io
import QtQuick

// The weather where you are, for the Orbital: the same place as the bar's weather (a
// location set in its panel, else wttr.in's guess from your connection), with current
// conditions from Open-Meteo every 15 minutes. conditions is what Scene.weatherLook reads.
Item {
  id: wx

  property bool enabled: true
  property var conditions: null
  property real lat: NaN
  property real lon: NaN
  property int refreshMinutes: 15

  function useLocation(raw) {
    var o = {}
    try { o = JSON.parse(raw || "{}") } catch (e) {}
    var la = parseFloat(o.latitude), lo = parseFloat(o.longitude)
    if (!isNaN(la) && !isNaN(lo)) { lat = la; lon = lo; fetch() }
    else { lat = NaN; lon = NaN; if (enabled && !guess.running) guess.running = true }
  }

  function fetch() {
    if (!enabled || isNaN(lat) || isNaN(lon) || current.running) return
    current.command = ["curl", "-fsS", "--max-time", "10",
      "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon
      + "&current=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,weather_code,precipitation,wind_speed_10m,visibility"
      + "&timezone=auto"]
    current.running = true
  }

  onEnabledChanged: if (enabled) { if (isNaN(lat)) location.reload(); else fetch() }

  FileView {
    id: location
    path: Quickshell.env("HOME") + "/.local/state/omarchy/settings/weather.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: wx.useLocation(text())
    onLoadFailed: wx.useLocation("")
  }

  Process {
    id: guess
    command: ["curl", "-fsS", "--max-time", "20", "https://wttr.in/?format=j1"]
    stdout: StdioCollector {
      onStreamFinished: {
        try {
          var a = JSON.parse(text).nearest_area[0]
          wx.lat = parseFloat(a.latitude); wx.lon = parseFloat(a.longitude)
          wx.fetch()
        } catch (e) {}
      }
    }
  }

  Process {
    id: current
    stdout: StdioCollector {
      onStreamFinished: {
        try {
          var c = JSON.parse(text).current
          wx.conditions = {cover: c.cloud_cover, low: c.cloud_cover_low, mid: c.cloud_cover_mid, high: c.cloud_cover_high,
                           code: c.weather_code, precip: c.precipitation, wind: c.wind_speed_10m, visibility: c.visibility, at: c.time}
          wx.share(wx.conditions)
        } catch (e) {}
      }
    }
  }

  // The weather simulation (weather/sim.py) pulls workspace 1's place toward the real sky, so
  // each reading is also left where it looks, stamped with when it was fetched.
  readonly property string sharedPath: Quickshell.env("HOME") + "/.cache/vereda-orbital/weather/observed.json"
  function share(c) {
    if (shareProc.running) return
    var o = {}
    for (var k in c) o[k] = c[k]
    o.fetched = new Date().toISOString()
    shareProc.command = ["sh", "-c", 'mkdir -p "$(dirname "$2")" && printf %s "$1" > "$2.next" && mv -f "$2.next" "$2"',
                         "sh", JSON.stringify(o), sharedPath]
    shareProc.running = true
  }
  Process { id: shareProc }

  Timer {
    interval: wx.refreshMinutes * 60000
    repeat: true
    running: wx.enabled
    // re-read the location each time: the watch misses a location file created after start
    onTriggered: location.reload()
  }
}
