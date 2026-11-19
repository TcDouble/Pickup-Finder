# Home page map setup

The quickest way is the web server in `ProjectSourceCode/index.js`, which
serves the key from the `MAPS_API_KEY` environment variable (this is also how
Render gets it):

```sh
cd ProjectSourceCode
npm install
PORT=5500 MAPS_API_KEY=<your key> npm start
```

Then open `http://localhost:5500/` and sign in. To use a static server
instead, follow these steps:

1. Copy `maps-config.example.js` to `maps-config.local.js` in this folder.
2. Replace `YOUR_GOOGLE_MAPS_API_KEY` in the local file with your own key.
   Enable Maps JavaScript API and billing in the associated Google Cloud project.
   Restrict the key to Maps JavaScript API and the website origins you use,
   including `http://localhost:5500/*` for the local server below.
3. From the repository root, run:

   ```sh
   python -m http.server 5500 --directory ProjectSourceCode
   ```

4. Open `http://localhost:5500/login-and-registration/login.html` and sign in.

The root `.gitignore` excludes `maps-config.local.js`. Each developer and each
deployment must supply this file separately; never force-add it. Browser Maps
keys remain visible in network requests, so website and API restrictions are
still required. Do not put the real key in the example or in `home.js`.

The map uses `DEMO_MAP_ID` for testing advanced markers. Use your own map ID for
production. Location tracking starts only when the user clicks the button and
grants browser permission. It updates the local map without uploading the
user's coordinates to Firestore. Use localhost or HTTPS for geolocation.

Game pins use `watchEvents` from `firebase/events.js`. The live Firebase project
must have the appropriate rules and indexes deployed; consult `../firebase/README.md`.
The current query uses the module's default upcoming-game filters and limit,
not the sidebar filters or the user's distance. An event-listener failure shows
"Unable to load games"; inspect the browser console for its cause.

`map-pins.js` decides what the pins show, and `home.js` draws them:

- Each game with a valid saved location (`location.lat` and `location.lng` are
  numbers on the globe) gets a pin at that spot, showing its sport's icon.
- Games at the same spot (within about a meter, like two games on one court)
  share a pin with a count badge, so none hides under another.
- Clicking a pin opens a popup with each game's name, place, address, date,
  time, players, and skill level.
- Pins update live. An open popup stays open and shows the new numbers, and it
  closes if its games are gone.
- Games without a valid location are left off the map, listed in a console
  warning, and never stop the other pins from showing.

`npm run test:unit` covers `map-pins.js` (`../test/map-pins.spec.js`).

To check manually: load the map after signing in, use both zoom buttons, start
and stop location tracking, and click a game pin to inspect its details. Host
two games at the same place to see a shared pin.
