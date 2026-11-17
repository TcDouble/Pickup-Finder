import { auth, db, storage } from "../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { watchEvents } from "../firebase/events.js";
import { getPlayerStats } from "../firebase/sportsmanship.js";
import { MAPS_API_KEY } from "./maps-config.local.js";
import { DEFAULT_PHOTO, SPORT_NAMES, friendlyError, hasProfile } from "./auth-helpers.js";
import { photoError } from "./validateRegistration.js";
import { MAX_BIO } from "./validateProfile.js";
import { countGamesHosted, deleteAccount, getProfile, saveProfile, sendPasswordReset } from "./profile.js";

const $ = (id) => document.getElementById(id);

// You have to be logged in to use the app. The page stays hidden (see .auth-pending
// in home.html) until we know who's here:
//   - not logged in        -> login page
//   - profile not finished -> registration page, which switches to "Finish setup"
//   - otherwise            -> show the app
// replace() keeps this page out of history, so Back doesn't bounce you here again.
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }

  try {
    if (!(await hasProfile(user.uid))) {
      window.location.replace("registration.html");
      return;
    }
  } catch (err) {
    // Couldn't check the profile (e.g. offline). They are logged in, so let them in.
    console.error(err);
  }
  document.documentElement.classList.remove("auth-pending");
  openPanelFromLink();
  try {
    await initializePickupMap();
  } catch (err) {
    console.error("Cannot initialize map:", err);
  }
});

$("logout-btn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.replace("login.html");
});

// Sidebar buttons open their panel over the map; clicking the open one again closes it.
// "+ Host a game" opens the create-game form, which ../create-game/create-game.js runs.
// Notifications, Recommended, and Rate players are run by the scripts in
// ../notifications/, ../recommended/, and ../rate-players/.
// My games and Profile are still wireframe placeholders.
const navButtons = document.querySelectorAll(".sidebar [data-panel]");
const panels = document.querySelectorAll(".panel");

function showPanel(name) {
  panels.forEach((panel) => { panel.hidden = panel.id !== `panel-${name}`; });
  navButtons.forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.panel === name)));
  if (name === "profile") loadProfile();
}

// Other scripts open a panel with showPanel() in ../assets/panel-helpers.js,
// which sends this event. Its detail is { name, gameId }.
document.addEventListener("pickup:show-panel", (event) => showPanel(event.detail?.name ?? null));

// Links in notifications open a panel: home.html?panel=rate&game=<id>.
function openPanelFromLink() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("panel")) return;
  document.dispatchEvent(new CustomEvent("pickup:show-panel", {
    detail: { name: params.get("panel"), gameId: params.get("game") },
  }));
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    showPanel(btn.getAttribute("aria-pressed") === "true" ? null : btn.dataset.panel);
  });
});

document.querySelectorAll(".close-btn").forEach((btn) => {
  btn.addEventListener("click", () => showPanel(null));
});

// ---------------------------------------------------------------------------
// Profile panel
// ---------------------------------------------------------------------------

const profileForm = $("profile-form");
const deleteForm = $("delete-form");
let profile = null;

function showMessage(id, text, ok = false) {
  $(id).textContent = text;
  $(id).classList.toggle("ok", ok);
}

function showProfileView(which) {
  $("profile-view").hidden = which !== "view";
  profileForm.hidden = which !== "edit";
  deleteForm.hidden = which !== "delete";
}

async function loadProfile() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  showProfileView("view");
  showMessage("profile-message", "");
  try {
    // Stats are extras: if one fails, still show the profile.
    const [loaded, stats, hosted] = await Promise.all([
      getProfile({ db }, uid),
      getPlayerStats(uid).catch((err) => console.error(err)),
      countGamesHosted({ db }, uid).catch((err) => console.error(err)),
    ]);
    profile = loaded;
    renderProfile(stats, hosted);
  } catch (err) {
    console.error(err);
    showMessage("profile-message", "We couldn't load your profile. Please try again.");
  }
}

function renderProfile(stats, hosted) {
  $("profile-photo").src = profile?.photoURL || DEFAULT_PHOTO;
  $("profile-name").textContent = profile?.displayName || "Your profile";
  const since = profile?.createdAt
    ? `Member since ${profile.createdAt.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`
    : "";
  $("profile-meta").textContent = [profile?.city, since].filter(Boolean).join(" · ");

  $("stat-played").textContent = stats?.gamesPlayed ?? "–";
  $("stat-hosted").textContent = hosted ?? "–";
  $("stat-score").textContent = stats?.score ?? "–";

  const sports = profile?.sports ?? [];
  const tags = sports.map((sport) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    const level = profile.sportLevels[sport];
    const name = SPORT_NAMES[sport] ?? sport;
    tag.textContent = level ? `${name} · ${level[0].toUpperCase()}${level.slice(1)}` : name;
    return tag;
  });
  if (tags.length === 0) {
    const none = document.createElement("span");
    none.className = "muted";
    none.textContent = "No sports yet.";
    tags.push(none);
  }
  $("profile-sports").replaceChildren(...tags);

  $("profile-bio").textContent = profile?.bio || "No bio yet.";
  $("profile-bio").classList.toggle("muted", !profile?.bio);
}

// --- Edit profile ---

const photoInput = $("edit-photo");
const photoPreview = $("edit-photo-preview");
const photoRemove = $("edit-photo-remove");
const sportBoxes = profileForm.querySelectorAll('input[name="sports"]');
const levelFor = (sport) => profileForm.querySelector(`select[name="level-${sport}"]`);
let newPhoto = null;
let removePhoto = false;
let previewURL = null;

function showEditPhoto() {
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = newPhoto ? URL.createObjectURL(newPhoto) : null;
  photoPreview.src = previewURL ?? (removePhoto ? null : profile?.photoURL) ?? DEFAULT_PHOTO;
  photoRemove.hidden = !newPhoto && (removePhoto || !profile?.photoURL);
}

function updateBioCount() {
  $("edit-bio-count").textContent = `${$("edit-bio").value.length} / ${MAX_BIO}`;
}

$("edit-profile-btn").addEventListener("click", () => {
  newPhoto = null;
  removePhoto = false;
  photoInput.value = "";
  showEditPhoto();
  $("edit-name").value = profile?.displayName ?? "";
  $("edit-city").value = profile?.city ?? "";
  $("edit-bio").value = profile?.bio ?? "";
  updateBioCount();
  sportBoxes.forEach((box) => {
    box.checked = profile?.sports.includes(box.value) ?? false;
    levelFor(box.value).value = profile?.sportLevels[box.value] ?? "casual";
    levelFor(box.value).disabled = !box.checked;
  });
  showMessage("edit-message", "");
  showProfileView("edit");
});

$("cancel-edit-btn").addEventListener("click", () => showProfileView("view"));

sportBoxes.forEach((box) => {
  box.addEventListener("change", () => { levelFor(box.value).disabled = !box.checked; });
});

$("edit-bio").addEventListener("input", updateBioCount);

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0] ?? null;
  const problem = photoError(file);
  showMessage("edit-message", problem ?? "");
  if (problem) photoInput.value = "";
  newPhoto = problem ? null : file;
  if (newPhoto) removePhoto = false;
  showEditPhoto();
});

photoRemove.addEventListener("click", () => {
  photoInput.value = "";
  newPhoto = null;
  removePhoto = Boolean(profile?.photoURL);
  showEditPhoto();
});

profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const sports = [...sportBoxes].filter((box) => box.checked).map((box) => box.value);
  const input = {
    photo: newPhoto,
    removePhoto,
    displayName: $("edit-name").value,
    city: $("edit-city").value,
    sports,
    sportLevels: Object.fromEntries(sports.map((sport) => [sport, levelFor(sport).value])),
    bio: $("edit-bio").value,
  };

  const saveBtn = $("save-profile-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  try {
    await saveProfile({ auth, db, storage }, input);
    await loadProfile();
    showMessage("profile-message", "Profile saved.", true);
  } catch (err) {
    console.error(err);
    const text =
      err.code === "profile/invalid" ? err.message
      : err.code === "permission-denied" ? "We couldn't save your profile. Please try again."
      : friendlyError(err.code);
    showMessage("edit-message", text);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
});

// --- Reset password ---

$("reset-password-btn").addEventListener("click", async () => {
  const btn = $("reset-password-btn");
  btn.disabled = true;
  try {
    const email = await sendPasswordReset({ auth });
    showMessage("profile-message", `We sent a reset link to ${email}.`, true);
  } catch (err) {
    console.error(err);
    showMessage("profile-message", friendlyError(err.code));
  } finally {
    btn.disabled = false;
  }
});

// --- Delete account ---

$("delete-account-btn").addEventListener("click", () => {
  $("delete-password").value = "";
  showMessage("delete-message", "");
  showProfileView("delete");
});

$("cancel-delete-btn").addEventListener("click", () => showProfileView("view"));

deleteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("confirm-delete-btn");
  btn.disabled = true;
  btn.textContent = "Deleting…";
  try {
    await deleteAccount({ auth, db, storage }, $("delete-password").value);
    window.location.href = "login.html";
  } catch (err) {
    console.error(err);
    const text =
      err.code === "profile/invalid" ? err.message
      : err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" ? "Incorrect password."
      : friendlyError(err.code);
    showMessage("delete-message", text);
    btn.disabled = false;
    btn.textContent = "Delete account";
  }
});

// --- Wireframe behavior only: these change what's shown, nothing else. ---

// Activity chips toggle on and off (they don't filter anything yet).
document.querySelectorAll(".filters .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
  });
});
const BOULDER = { lat: 40.0076, lng: -105.2659 };

let map;
let infoWindow;
let gameMarkers = [];
let userMarker = null;
let trackingId = null;
let mapInitPromise;
let unsubscribeEvents;

const trackButton = document.getElementById("track-location");

// Load Google Maps.
function loadGoogleMaps() {
  if (window.google?.maps?.importLibrary) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    window.pickupMapsLoaded = () => {
      delete window.pickupMapsLoaded;
      resolve();
    };

    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(MAPS_API_KEY)}` +
      "&loading=async&callback=pickupMapsLoaded";
    script.async = true;
    script.onerror = () => {
      delete window.pickupMapsLoaded;
      reject(new Error("Google Maps failed to load."));
    };
    document.head.appendChild(script);
  });
}

// Called by your existing login check.
function initializePickupMap() {
  if (!mapInitPromise) {
    mapInitPromise = setupPickupMap();
  }
  return mapInitPromise;
}

async function setupPickupMap() {
  await loadGoogleMaps();

  const { Map, InfoWindow } = await google.maps.importLibrary("maps");
  await google.maps.importLibrary("marker");

  map = new Map(document.getElementById("google-map"), {
    center: BOULDER,
    zoom: 13,
    mapId: "DEMO_MAP_ID",
    zoomControl: false,
  });

  infoWindow = new InfoWindow();

  unsubscribeEvents = watchEvents({}, displayEvents, (error) => {
    console.error("Cannot load events:", error);
    document.querySelector(".game-count").textContent =
      "Unable to load games";
  });

  const zoomButtons = document.querySelectorAll(".zoom button");
  zoomButtons[0].addEventListener("click", () => {
    map.setZoom(map.getZoom() + 1);
  });
  zoomButtons[1].addEventListener("click", () => {
    map.setZoom(map.getZoom() - 1);
  });

  trackButton.disabled = false;
}

// Convert Firestore events into map pins.
function displayEvents(events) {
  infoWindow.close();
  gameMarkers.forEach((marker) => {
    marker.map = null;
  });
  gameMarkers = [];

  for (const event of events) {
    const location = event.location;
    if (
      !location ||
      !Number.isFinite(location.lat) ||
      !Number.isFinite(location.lng)
    ) {
      continue;
    }

    const marker = new google.maps.marker.AdvancedMarkerElement({
      map,
      position: { lat: location.lat, lng: location.lng },
      title: event.title || event.sportId || "Game",
    });

    marker.addListener("click", () => {
      const content = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = event.title || event.sportId || "Game";
      content.append(title);

      const details = [
        `${event.sportId} | ${location.name}`,
        event.startTime
          ? event.startTime.toLocaleString()
          : "Time unavailable",
        `${event.playerCount}/${event.playerLimit} players`,
      ];

      for (const text of details) {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        content.append(paragraph);
      }

      infoWindow.setContent(content);
      infoWindow.open({ map, anchor: marker });
    });

    gameMarkers.push(marker);
  }

  document.querySelector(".game-count").textContent =
    `${gameMarkers.length} games available`;
}

function stopTracking() {
  if (trackingId !== null) {
    navigator.geolocation.clearWatch(trackingId);
    trackingId = null;
  }

  if (userMarker) {
    userMarker.map = null;
    userMarker = null;
  }

  trackButton.textContent = "Start location tracking";
}

// Start or stop tracking this browser's location.
trackButton.addEventListener("click", () => {
  if (!map) return;

  if (trackingId !== null) {
    stopTracking();
    return;
  }

  if (!navigator.geolocation) {
    alert("Geolocation is not supported.");
    return;
  }

  let firstUpdate = true;
  trackButton.textContent = "Stop location tracking";

  trackingId = navigator.geolocation.watchPosition(
    (position) => {
      const current = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      if (!userMarker) {
        userMarker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: current,
          title: "Your location",
          zIndex: 1000,
        });
      } else {
        userMarker.position = current;
      }

      if (firstUpdate) {
        map.panTo(current);
        map.setZoom(15);
        firstUpdate = false;
      }
    },
    (error) => {
      console.error("Location error:", error);
      stopTracking();
      alert("Unable to get your location. Check location permissions.");
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    }
  );
});
// My games tabs: only one is selected at a time.
const tabs = document.querySelectorAll("#panel-games .tabs button");
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.setAttribute("aria-pressed", String(t === tab)));
  });
});
