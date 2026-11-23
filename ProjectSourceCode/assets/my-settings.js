// The signed-in player's Settings (Profile -> Settings), read once and shared
// by the home page's panels. Saving in Settings updates the copy here and
// sends a "pickup:settings-changed" event with the new settings.
import { auth, db } from "../firebase/firebase-config.js";
import { getSettings } from "../login-and-registration/settings.js";
import { DEFAULT_SETTINGS } from "../login-and-registration/validateSettings.js";

let cached = null;
let cachedUid = null;

/** The player's settings, or the defaults if they're signed out or it fails. */
export function loadMySettings() {
  const uid = auth.currentUser?.uid;
  if (!uid) return Promise.resolve({ ...DEFAULT_SETTINGS });
  if (!cached || cachedUid !== uid) {
    cachedUid = uid;
    cached = getSettings({ db }, uid).catch((err) => {
      console.error("Cannot load settings:", err);
      cached = null;
      return { ...DEFAULT_SETTINGS };
    });
  }
  return cached;
}

/** Call after saving, so every panel sees the new settings. */
export function settingsChanged(settings) {
  cached = Promise.resolve(settings);
  cachedUid = auth.currentUser?.uid ?? null;
  document.dispatchEvent(new CustomEvent("pickup:settings-changed", { detail: settings }));
}
