// "Rate players" panel on the home page (GitHub issue #13).
//
// After a game, each player can rate each of the others once, positive or
// negative, with an optional comment. The ratings make up everyone's public
// sportsmanship score, which Recommended uses to match players.
//
// The panel lists your games from the last FEEDBACK_WINDOW_DAYS days that
// still have players to rate; pick one to rate its players. The notifier's
// "How was the game?" messages and inbox items open a game directly
// (home.html?panel=rate&game=<id>). The back end is ../firebase/sportsmanship.js.

import { auth } from "../firebase/firebase-config.js";
import { friendlyEventError, getEvent, listMyEvents } from "../firebase/events.js";
import {
  FEEDBACK_WINDOW_DAYS,
  MAX_COMMENT,
  leaveFeedback,
  playersToRate,
} from "../firebase/sportsmanship.js";
import {
  dateBox,
  el,
  formatDay,
  formatDayTime,
  gameName,
  initials,
  onPanelOpen,
  plural,
  rateableGames,
} from "../assets/panel-helpers.js";

const MAX_GAMES = 10; // most recent games to list
const PAST_GAMES_READ = 30; // past games to look through for those

const heading = document.getElementById("rate-heading");
const intro = document.getElementById("rate-intro");
const message = document.getElementById("rate-message");
const gamesBox = document.getElementById("rate-games");
const gameBox = document.getElementById("rate-game");
const gameSummary = document.getElementById("rate-game-summary");
const playersList = document.getElementById("rate-players");
const badge = document.getElementById("rate-badge");

// Players left to rate in each game you can still rate, for the sidebar badge.
const leftToRate = new Map();
// Only the latest load may draw, so a slow answer can't replace a newer one.
let loadId = 0;

onPanelOpen("rate", ({ gameId }) => (gameId ? showGame(gameId) : showGames()));
document.getElementById("rate-back").addEventListener("click", () => showGames());

// Fill in the badge as soon as we know who's here.
auth.authStateReady().then(() => {
  if (auth.currentUser) showGames();
});

function showMessage(text) {
  message.textContent = text;
}

function updateBadge() {
  const games = [...leftToRate.values()].filter((count) => count > 0).length;
  badge.textContent = String(games);
  badge.hidden = games === 0;
  badge.setAttribute("aria-label", `${plural(games, "game")} to rate`);
}

// ---------------------------------------------------------------------------
// Your recent games
// ---------------------------------------------------------------------------

async function showGames() {
  await auth.authStateReady();
  if (!auth.currentUser) return;
  const id = ++loadId;

  heading.textContent = "Your recent games";
  intro.hidden = false;
  gamesBox.hidden = false;
  gameBox.hidden = true;
  showMessage("");
  gamesBox.replaceChildren(el("p", { class: "muted" }, "Loading your games…"));

  try {
    const past = await listMyEvents({ when: "past", max: PAST_GAMES_READ });
    const games = rateableGames(past, {
      uid: auth.currentUser.uid,
      windowDays: FEEDBACK_WINDOW_DAYS,
    }).slice(0, MAX_GAMES);
    const details = await Promise.all(
      games.map((game) =>
        playersToRate(game.id).catch((err) => {
          console.error(`Cannot load players for game ${game.id}:`, err);
          return null;
        }),
      ),
    );

    // The badge counts every game, even if a newer load is drawing the panel.
    const rows = games.map((game, i) => ({ game, info: details[i] })).filter((row) => row.info);
    leftToRate.clear();
    for (const { game, info } of rows) {
      leftToRate.set(game.id, info.canRate ? info.players.filter((p) => !p.rated).length : 0);
    }
    updateBadge();
    if (id !== loadId) return;

    gamesBox.replaceChildren(
      ...(rows.length
        ? rows.map(gameRow)
        : [
            el(
              "p",
              { class: "muted" },
              `No games to rate right now. After you play a game with other people, you can rate them here for ${FEEDBACK_WINDOW_DAYS} days.`,
            ),
          ]),
    );
  } catch (err) {
    if (id !== loadId) return;
    console.error("Cannot load games to rate:", err);
    gamesBox.replaceChildren();
    showMessage(friendlyEventError(err));
  }
}

function gameRow({ game, info }) {
  const left = info.canRate ? info.players.filter((p) => !p.rated).length : 0;
  const status = left
    ? `${plural(left, "player")} to rate, until ${formatDay(info.deadline)}`
    : "You've rated everyone";
  return el(
    "div",
    { class: left ? "game-card" : "game-card dashed" },
    dateBox(game.startTime),
    el(
      "div",
      { class: "list-text" },
      el("strong", {}, gameName(game)),
      el("span", { class: "muted" }, game.location?.name ?? ""),
      el("span", { class: "muted" }, status),
    ),
    el(
      "button",
      {
        type: "button",
        class: left ? "btn primary" : "btn",
        "aria-label": `${left ? "Rate players from" : "View ratings for"} ${gameName(game)}`,
        onclick: () => showGame(game.id, game),
      },
      left ? "Rate" : "View",
    ),
  );
}

// ---------------------------------------------------------------------------
// One game's players
// ---------------------------------------------------------------------------

async function showGame(gameId, knownGame = null) {
  await auth.authStateReady();
  if (!auth.currentUser) return;
  const id = ++loadId;

  heading.textContent = "Rate players";
  intro.hidden = true;
  gamesBox.hidden = true;
  gameBox.hidden = false;
  showMessage("");
  gameSummary.replaceChildren();
  playersList.replaceChildren(el("p", { class: "muted" }, "Loading players…"));

  try {
    const [game, info] = await Promise.all([knownGame ?? getEvent(gameId), playersToRate(gameId)]);
    if (id !== loadId) return;

    if (game) {
      heading.textContent = gameName(game);
      gameSummary.replaceChildren(
        el(
          "div",
          { class: "game-card" },
          dateBox(game.startTime),
          el(
            "div",
            { class: "list-text" },
            el("strong", {}, game.location?.name ?? gameName(game)),
            el("span", { class: "muted" }, formatDayTime(game.startTime)),
            el(
              "span",
              { class: "muted" },
              info.canRate
                ? `Ratings close ${formatDay(info.deadline)} and can't be changed once sent.`
                : "",
            ),
          ),
        ),
      );
    }
    if (!info.canRate) showMessage(info.whyNot);
    leftToRate.set(gameId, info.canRate ? info.players.filter((p) => !p.rated).length : 0);
    updateBadge();

    playersList.replaceChildren(
      ...(info.players.length
        ? info.players.map((player) => playerRow(gameId, player, info.canRate))
        : [el("p", { class: "muted" }, "You were the only player in this game, so there's no one to rate.")]),
    );
  } catch (err) {
    if (id !== loadId) return;
    console.error(`Cannot load game ${gameId} to rate:`, err);
    playersList.replaceChildren();
    showMessage(friendlyEventError(err));
  }
}

function ratedNote(rating) {
  return el("span", { class: "rated" }, `You rated: ${rating === "positive" ? "Positive" : "Negative"}`);
}

function playerRow(gameId, player, canRate) {
  const name = player.displayName ?? "Player without a profile";
  const text = el("div", { class: "list-text" }, el("strong", {}, name));
  if (player.rated) text.append(ratedNote(player.rating));
  else if (!canRate) text.append(el("span", { class: "muted" }, "Not rated"));
  else text.append(ratingForm(gameId, player, name));

  return el(
    "div",
    { class: "list-item" },
    el("div", { class: "list-icon round initial", "aria-hidden": "true" }, initials(player.displayName)),
    text,
  );
}

function ratingForm(gameId, player, name) {
  const send = el("button", { type: "submit", class: "btn small primary" }, "Send rating");
  const note = el("p", { class: "message", role: "alert", "aria-live": "polite" });
  const comment = el("input", {
    type: "text",
    name: "comment",
    maxlength: MAX_COMMENT,
    placeholder: "Comment (optional)",
    "aria-label": `Comment about ${name} (optional)`,
  });
  const choice = (value, label) =>
    el("label", { class: "chip" }, el("input", { type: "radio", name: "rating", value }), label);

  const form = el(
    "form",
    { class: "rate-form", novalidate: true },
    el(
      "fieldset",
      {},
      el("legend", { class: "sr-only" }, `Rate ${name}`),
      el("div", { class: "chips" }, choice("positive", "Positive"), choice("negative", "Negative")),
    ),
    comment,
    send,
    note,
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    note.textContent = "";
    const rating = form.querySelector('input[name="rating"]:checked')?.value;
    if (!rating) {
      note.textContent = "Choose positive or negative.";
      return;
    }
    send.disabled = true;
    send.textContent = "Sending…";
    try {
      await leaveFeedback(gameId, player.userId, { rating, comment: comment.value });
      form.replaceWith(ratedNote(rating));
      if (leftToRate.has(gameId)) leftToRate.set(gameId, Math.max(0, leftToRate.get(gameId) - 1));
      updateBadge();
    } catch (err) {
      console.error(`Cannot rate ${player.userId}:`, err);
      note.textContent = friendlyEventError(err);
      send.disabled = false;
      send.textContent = "Send rating";
    }
  });
  return form;
}
