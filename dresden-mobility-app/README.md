# Dresden Mobility App

Installable Android/iOS web app (PWA) showing:
- **Live free parking lots** in Dresden (ParkAPI / ParkenDD, api.parkendd.de)
- **Real-time VVO/DVB departures** (webapi.vvo-online.de) with delays & occupancy
- **Planned/current construction sites** (opendata.dresden.de open data)
- Google-maps-like map, **free tiles, no API key** (OpenStreetMap + CARTO Voyager)
- UI in English or German

## Install on your Android phone

The app is a PWA - no Play Store needed:

1. Host the folder on any static host, for example **GitHub Pages** (free):
   - Create a repo, upload these files, Settings > Pages > deploy from branch.
   - Or use Netlify Drop (drag & drop the folder).
2. Open the URL in **Chrome on your phone**.
3. Tap the **Install** button in the app (or Chrome menu > "Add to Home screen" / "Install app").
4. The app now runs full-screen with its own icon, like a native app.

Service worker caches the app shell for offline startup (live data needs internet).

## Files
- `index.html` - app shell
- `css/style.css` - Google-style UI
- `js/app.js` - all logic (parking, departures, construction, i18n)
- `manifest.json`, `sw.js` - PWA install + offline
- `icons/` - app icons

## Optional: real APK
Wrap with Capacitor if you want a store APK:
```
npm i @capacitor/core @capacitor/cli
npx cap init "Dresden Mobility" com.example.ddmobility --web-dir .
npx cap add android
npx cap sync
npx cap open android   # build APK in Android Studio
```

## Data sources (free, no keys)
- Parking: https://api.parkendd.de/dresden.json  (github.com/offenesdresden/ParkAPI)
- Transport: https://webapi.vvo-online.de (dm + pointfinder)
- Construction: https://opendata.dresden.de (CKAN API, dataset search "Baustelle")

Note: if direct API calls are blocked by CORS on some networks the app automatically
falls back to public CORS relays (corsproxy.io / allorigins.win).
