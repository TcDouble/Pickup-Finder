// "Recommended" panel on the home page (matchmaking, GitHub issue #13).
//
// Upcoming games that still have room for you, best match first: a good match
// is a game whose players' average sportsmanship score is close to yours, so
// good sports end up playing with good sports. Each game has a Join button.
// Match alerts from the notifier open this panel with their game on top
// (home.html?panel=recommended&game=<id>). The back end is
// ../firebase/matchmaking.js.

import { auth, db } from "../firebase/firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { SPORTS, friendlyEventError, getEvent } from "../firebase/events.js";
import { recommendGames } from "../firebase/matchmaking.js";
import { getSportsmanship } from "../firebase/sportsmanship.js";
import {
  dateBox,
  el,
  formatDayTime,
  gameName,
  kmToMiles,
  matchNote,
  milesToKm,
  onPanelOpen,
  plural,
  scoreSummary,
} from "../assets/panel-helpers.js";
import { joinButton } from "../assets/join-button.js";

const MAX_GAMES = 50; // games to look through, as in listEvents

const sportSelect = document.getElementById("rec-sport");
const distanceSelect = document.getElementById("rec-distance");
const scoreSelect = document.getElementById("rec-score");
const myScore = document.getElementById("rec-my-score");
const message = document.getElementById("rec-message");
const focusBox = document.getElementById("rec-focus");
const list = document.getElementById("rec-list");

let mySports = []; // from the player's profile, for "Sports I play"
let myLocation = null; // { lat, lng }, asked for only when a distance is picked
let focusGameId = null; // the game from a match alert, shown first
let loadId = 0;

// Default to the sports on the player's profile, when they picked any.
const ready = auth.authStateReady().then(async () => {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const profile = await getDoc(doc(db, "users", user.uid));
    mySports = (profile.data()?.sports ?? []).filter((id) => SPORTS.includes(id));
  } catch (err) {
    console.error("Cannot read profile sports:", err);
  }
  if (mySports.length) {
    sportSelect.add(new Option("Sports I play", "mine"), 1);
    sportSelect.value = "mine";
  }
});

onPanelOpen("recommended", ({ gameId }) => {
  focusGameId = gameId;
  refresh();
});
sportSelect.addEventListener("change", () => refresh());
scoreSelect.addEventListener("change", () => refresh());
distanceSelect.addEventListener("change", async () => {
  if (distanceSelect.value && !myLocation && !(await locate())) {
    distanceSelect.value = "";
    refresh("Couldn't get your location, so these are games anywhere.");
    return;
  }
  refresh();
});

function showMessage(text, ok = false) {
  message.textContent = text;
  message.classList.toggle("ok", ok);
}

function locate() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        myLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        resolve(true);
      },
      () => resolve(false),
      { timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

function currentFilters() {
  const filters = { minScore: Number(scoreSelect.value), max: MAX_GAMES };
  if (sportSelect.value === "mine") filters.sportId = mySports;
  else if (sportSelect.value) filters.sportId = sportSelect.value;
  if (distanceSelect.value && myLocation) {
    filters.near = { ...myLocation, radiusKm: milesToKm(Number(distanceSelect.value)) };
  }
  return filters;
}

async function refresh(note = "") {
  await ready;
  const user = auth.currentUser;
  if (!user) return;
  const id = ++loadId;
  showMessage(note);
  list.replaceChildren(el("p", { class: "muted" }, "Finding games for you…"));

  try {
    const [games, me, focus] = await Promise.all([
      recommendGames(currentFilters()),
      getSportsmanship(user.uid),
      focusGameId ? getEvent(focusGameId).catch(() => null) : null,
    ]);
    if (id !== loadId) return;

    myScore.textContent = `Your sportsmanship score: ${scoreSummary(me)}`;
    if (focusGameId && !focus) showMessage("The game from your alert isn't available anymore.");
    focusBox.hidden = !focus;
    focusBox.replaceChildren(
      ...(focus ? [el("span", { class: "section-label" }, "From your alert"), gameCard(focus, me.score)] : []),
    );

    const others = games.filter((game) => game.id !== focus?.id);
    list.replaceChildren(
      ...(others.length
        ? [
            ...(focus ? [el("span", { class: "section-label" }, "More games for you")] : []),
            ...others.map((game) => gameCard(game, me.score)),
          ]
        : [
            el(
              "p",
              { class: "muted" },
              "No open games match right now. Try another sport or a wider distance, or host one yourself.",
            ),
          ]),
    );
  } catch (err) {
    if (id !== loadId) return;
    console.error("Cannot load recommended games:", err);
    list.replaceChildren();
    showMessage(friendlyEventError(err));
  }
}

// "3 spots left · 2.1 mi away · Casual"
function detailsLine(game) {
  return [
    `${plural(game.spotsLeft, "spot")} left`,
    game.distanceKm != null ? `${kmToMiles(game.distanceKm)} mi away` : null,
    game.skillLevel === "competitive" ? "Competitive" : "Casual",
  ]
    .filter(Boolean)
    .join(" · ");
}

function gameCard(game, score) {
  const details = el("span", { class: "muted" }, detailsLine(game));
  return el(
    "div",
    { class: "game-card" },
    dateBox(game.startTime),
    el(
      "div",
      { class: "list-text" },
      el("strong", {}, gameName(game)),
      el("span", { class: "muted" }, `${formatDayTime(game.startTime)} · ${game.location?.name ?? ""}`),
      details,
      game.averageScore != null ? el("span", { class: "match-note" }, matchNote(game.averageScore, score)) : null,
    ),
    joinButton(game, {
      onJoined: (joined) => {
        details.textContent = detailsLine({ ...joined, distanceKm: game.distanceKm });
      },
      showMessage,
    }),
  );
}
