// Pickup-Finder web server (Lab 12).
//
// Serves the pages in this folder so the site can run on Render. The pages
// still talk to Firebase straight from the browser; this server only hands out
// the files, plus the Google Maps key, which it reads from MAPS_API_KEY so the
// key never has to be committed.
//
// Run it locally from ProjectSourceCode/:
//   npm install
//   MAPS_API_KEY=<your key> npm start      # then open http://localhost:3000
//
// On Render: root directory ProjectSourceCode, build command `npm install`,
// start command `node index.js`, and MAPS_API_KEY under Environment. Render
// sets PORT itself. /welcome works as the health check path.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Folders the browser loads files from. Everything else in ProjectSourceCode
// (the notifier and its keys, tests, node_modules, package files) is never served.
const PUBLIC_DIRS = [
  "assets",
  "create-game",
  "edit-game",
  "firebase",
  "login-and-registration",
  "notifications",
  "rate-players",
  "recommended",
];

// home.js imports the Maps key from this file. Developers can still keep a
// real maps-config.local.js here (see login-and-registration/MAPS_SETUP.md).
const MAPS_CONFIG_PATH = "/login-and-registration/maps-config.local.js";
const LOCAL_MAPS_CONFIG = path.join(ROOT, MAPS_CONFIG_PATH);

/**
 * Build the app without starting it, so the tests can call it directly.
 *
 * @param {object} [options]
 * @param {string} [options.mapsApiKey]  defaults to the MAPS_API_KEY environment variable
 */
export function createApp({ mapsApiKey = process.env.MAPS_API_KEY } = {}) {
  const app = express();
  app.disable("x-powered-by");

  // The home page sends visitors who aren't logged in to the login page.
  app.get("/", (req, res) => res.redirect("/login-and-registration/home.html"));

  // Lab 10's test route, and a cheap health check for Render.
  app.get("/welcome", (req, res) => res.json({ status: "success", message: "Welcome!" }));

  app.get(MAPS_CONFIG_PATH, (req, res) => {
    res.type("text/javascript").set("Cache-Control", "no-store");
    const key = mapsApiKey?.trim();
    if (key) {
      res.send(`export const MAPS_API_KEY = ${JSON.stringify(key)};\n`);
    } else if (existsSync(LOCAL_MAPS_CONFIG)) {
      res.sendFile(LOCAL_MAPS_CONFIG);
    } else {
      // Without a key the map can't load, but the rest of the home page still works.
      res.send(
        'console.warn("No Google Maps key: set MAPS_API_KEY where the server runs.");\n' +
          'export const MAPS_API_KEY = "";\n',
      );
    }
  });

  // Never serve installed packages or tests, even inside a public folder.
  app.use((req, res, next) => {
    if (/\/(node_modules|tests?)(\/|$)/.test(req.path)) return res.status(404).send("Not found");
    next();
  });

  for (const dir of PUBLIC_DIRS) {
    app.use(`/${dir}`, express.static(path.join(ROOT, dir)));
  }

  app.use((req, res) => res.status(404).send("Not found"));
  return app;
}

// Start listening only when run as `node index.js`, not when a test imports it.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`Pickup-Finder is running at http://localhost:${port}`);
    if (!process.env.MAPS_API_KEY?.trim() && !existsSync(LOCAL_MAPS_CONFIG)) {
      console.warn("MAPS_API_KEY isn't set, so the home page map won't load.");
    }
  });
}
