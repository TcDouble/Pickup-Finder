// "Friends" panel on the home page (GitHub issue #33).
//
// Four tabs:
//   Friends   your friends, online ones first, with when each was last on
//   Requests  requests waiting for you (Accept, Decline) and ones you sent (Cancel)
//   Games     upcoming games your friends are going to, with Join
//   Add       find players by name and send them a request
// The sidebar badge counts requests waiting for you. Players in Online now
// (online-panel.js) have an Add friend button too. The back end is
// ../firebase/friends.js and ../firebase/presence.js.

import { auth } from "../firebase/firebase-config.js";
import { friendlyEventError } from "../firebase/events.js";
import { acceptFriendRequest, findPlayers, listFriendsGames, removeFriend } from "../firebase/friends.js";
import { getPresence } from "../firebase/presence.js";
import {
  activityText,
  dateBox,
  el,
  formatDayTime,
  friendsGoingText,
  gameName,
  onPanelOpen,
  playerDetails,
  plural,
  timeAgo,
} from "../assets/panel-helpers.js";
import { joinButton } from "../assets/join-button.js";
import { onFriendsChange, playerAvatar, relationButton } from "./social-ui.js";

const PRESENCE_REFRESH_MS = 60 * 1000;

const panel = document.getElementById("panel-friends");
const heading = document.getElementById("friends-heading");
const message = document.getElementById("friends-message");
const tabs = panel.querySelectorAll(".tabs [data-view]");
const views = {
  friends: document.getElementById("friends-view-friends"),
  requests: document.getElementById("friends-view-requests"),
  games: document.getElementById("friends-view-games"),
  find: document.getElementById("friends-view-find"),
};
const HEADINGS = {
  friends: "Your friends",
  requests: "Friend requests",
  games: "Friends' games",
  find: "Add friends",
};
const friendsList = document.getElementById("friends-list");
const incomingList = document.getElementById("friends-incoming");
const outgoingList = document.getElementById("friends-outgoing");
const gamesList = document.getElementById("friends-games");
const searchForm = views.find;
const searchInput = document.getElementById("friends-search");
const resultsList = document.getElementById("friends-results");
const requestsCount = document.getElementById("friends-requests-count");
const badge = document.getElementById("friends-badge");

let current = null; // { friends, incoming, outgoing }
let presence = new Map(); // friend's user ID -> { state, lastSeen, online }
let view = "friends";
let lastResults = null; // players from the last search, redrawn when requests change
let gamesLoad = 0;

// ---------------------------------------------------------------------------
// Opening the panel and switching tabs
// ---------------------------------------------------------------------------

onPanelOpen("friends", () => {
  showView(view);
  refreshPresence();
});

tabs.forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));

function showView(name) {
  view = name;
  tabs.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.view === name)));
  for (const [key, box] of Object.entries(views)) box.hidden = key !== name;
  heading.textContent = HEADINGS[name];
  showMessage("");
  if (name === "games") loadGames();
  if (name === "find") searchInput.focus();
}

function showMessage(text, ok = false) {
  message.textContent = text;
  message.classList.toggle("ok", ok);
}

// Live friends and requests: redraw whatever they touch.
onFriendsChange((value, err) => {
  if (err && !value) {
    friendsList.replaceChildren();
    showMessage(friendlyEventError(err));
    return;
  }
  current = value;
  updateBadge();
  drawFriends();
  drawRequests();
  if (lastResults) drawResults(lastResults);
  // A new friend needs their online status.
  if (current.friends.some((friend) => !presence.has(friend.userId))) refreshPresence();
});

// Keep "Online now" and "Active 5m ago" current while the panel is open.
setInterval(() => {
  if (!panel.hidden && document.visibilityState === "visible") refreshPresence();
}, PRESENCE_REFRESH_MS);

async function refreshPresence() {
  if (!current || current.friends.length === 0) return;
  try {
    presence = await getPresence(current.friends.map((friend) => friend.userId));
    drawFriends();
  } catch (err) {
    console.error("Cannot load who's online:", err);
  }
}

function updateBadge() {
  const waiting = current?.incoming.length ?? 0;
  badge.textContent = String(waiting);
  badge.hidden = waiting === 0;
  badge.setAttribute("aria-label", `${plural(waiting, "friend request")}`);
  requestsCount.textContent = waiting ? ` (${waiting})` : "";
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

function drawFriends() {
  if (!current) {
    friendsList.replaceChildren(el("p", { class: "inbox-empty muted" }, "Loading your friends…"));
    return;
  }
  if (current.friends.length === 0) {
    friendsList.replaceChildren(
      el(
        "p",
        { class: "inbox-empty muted" },
        "No friends yet. Find players in Add, or add someone from Online now.",
      ),
    );
    return;
  }
  // Online friends first, then the order friends.js gives (by name).
  const online = (friend) => (presence.get(friend.userId)?.online ? 0 : 1);
  const sorted = [...current.friends].sort((a, b) => online(a) - online(b));
  friendsList.replaceChildren(...sorted.map(friendRow));
}

function friendRow(friend) {
  const seen = presence.get(friend.userId);
  const activity = activityText(seen);
  const name = friend.displayName ?? "Player without a profile";
  return el(
    "div",
    { class: "list-item player-row" },
    playerAvatar(friend, { online: Boolean(seen?.online) }),
    el(
      "div",
      { class: "list-text" },
      el("strong", {}, name),
      activity && el("span", { class: seen?.online ? "activity online" : "activity muted" }, activity),
      el("span", { class: "muted" }, playerDetails(friend)),
    ),
    removeButton(friend, name),
  );
}

// "Remove" asks once more before unfriending.
function removeButton(friend, name) {
  const box = el("div", { class: "row-actions" });
  const ask = el(
    "button",
    { type: "button", class: "link-btn danger", "aria-label": `Remove ${name} from your friends` },
    "Remove",
  );
  ask.addEventListener("click", () => {
    const yes = el("button", { type: "button", class: "btn small danger" }, "Remove");
    const no = el("button", { type: "button", class: "btn small" }, "Keep");
    no.addEventListener("click", () => box.replaceChildren(ask));
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      no.disabled = true;
      try {
        await removeFriend(friend.userId);
        showMessage(`Removed ${name} from your friends.`, true);
      } catch (err) {
        console.error(`Cannot remove ${friend.userId}:`, err);
        showMessage(friendlyEventError(err));
        box.replaceChildren(ask);
      }
    });
    box.replaceChildren(el("span", { class: "hint" }, `Remove ${name}?`), yes, no);
    yes.focus();
  });
  box.append(ask);
  return box;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function drawRequests() {
  incomingList.replaceChildren(
    ...(current.incoming.length
      ? current.incoming.map(incomingRow)
      : [el("p", { class: "inbox-empty muted" }, "No requests waiting for you.")]),
  );
  outgoingList.replaceChildren(
    ...(current.outgoing.length
      ? current.outgoing.map(outgoingRow)
      : [el("p", { class: "inbox-empty muted" }, "You haven't asked anyone yet.")]),
  );
}

function requestRow(player, when, actions) {
  const name = player.displayName ?? "Player without a profile";
  return el(
    "div",
    { class: "list-item player-row" },
    playerAvatar(player),
    el(
      "div",
      { class: "list-text" },
      el("strong", {}, name),
      el("span", { class: "muted" }, [when, playerDetails(player)].filter(Boolean).join(" · ")),
    ),
    el("div", { class: "row-actions" }, ...actions),
  );
}

function sentAgo(date) {
  const ago = timeAgo(date ?? new Date());
  if (ago === "now") return "Just now";
  return /^\d/.test(ago) ? `${ago} ago` : ago;
}

function incomingRow(player) {
  const name = player.displayName ?? "this player";
  const accept = el(
    "button",
    { type: "button", class: "btn small primary", "aria-label": `Accept ${name}'s friend request` },
    "Accept",
  );
  const decline = el(
    "button",
    { type: "button", class: "btn small", "aria-label": `Decline ${name}'s friend request` },
    "Decline",
  );
  accept.addEventListener("click", () =>
    act([accept, decline], () => acceptFriendRequest(player.userId), `You and ${name} are friends now.`),
  );
  decline.addEventListener("click", () =>
    act([accept, decline], () => removeFriend(player.userId), `Declined ${name}'s request.`),
  );
  return requestRow(player, sentAgo(player.createdAt), [accept, decline]);
}

function outgoingRow(player) {
  const name = player.displayName ?? "this player";
  const cancel = el(
    "button",
    { type: "button", class: "btn small", "aria-label": `Cancel your friend request to ${name}` },
    "Cancel",
  );
  cancel.addEventListener("click", () =>
    act([cancel], () => removeFriend(player.userId), `Cancelled your request to ${name}.`),
  );
  return requestRow(player, `Sent ${sentAgo(player.createdAt).toLowerCase()}`, [cancel]);
}

// Run one request action. The lists redraw by themselves when it's done.
async function act(buttons, action, doneText) {
  buttons.forEach((button) => (button.disabled = true));
  showMessage("");
  try {
    await action();
    showMessage(doneText, true);
  } catch (err) {
    console.error("Friend request action failed:", err);
    showMessage(friendlyEventError(err));
    buttons.forEach((button) => (button.disabled = false));
  }
}

// ---------------------------------------------------------------------------
// Friends' games
// ---------------------------------------------------------------------------

async function loadGames() {
  const id = ++gamesLoad;
  if (!current) {
    gamesList.replaceChildren(el("p", { class: "muted" }, "Loading your friends…"));
    return;
  }
  if (current.friends.length === 0) {
    gamesList.replaceChildren(
      el("p", { class: "muted" }, "Add some friends to see the games they're going to."),
    );
    return;
  }
  gamesList.replaceChildren(el("p", { class: "muted" }, "Finding your friends' games…"));
  const names = new Map(current.friends.map((friend) => [friend.userId, friend.displayName]));
  try {
    const games = await listFriendsGames([...names.keys()]);
    if (id !== gamesLoad) return;
    gamesList.replaceChildren(
      ...(games.length
        ? games.map((game) => gameCard(game, names))
        : [el("p", { class: "muted" }, "None of your friends have joined an upcoming game yet.")]),
    );
  } catch (err) {
    if (id !== gamesLoad) return;
    console.error("Cannot load friends' games:", err);
    gamesList.replaceChildren();
    showMessage(friendlyEventError(err));
  }
}

function spotsLine(game) {
  return [
    game.isFull ? "Full" : `${plural(game.spotsLeft, "spot")} left`,
    game.skillLevel === "competitive" ? "Competitive" : "Casual",
  ].join(" · ");
}

function gameCard(game, names) {
  const spots = el("span", { class: "muted" }, spotsLine(game));
  return el(
    "div",
    { class: "game-card" },
    dateBox(game.startTime),
    el(
      "div",
      { class: "list-text" },
      el("strong", {}, gameName(game)),
      el("span", { class: "muted" }, `${formatDayTime(game.startTime)} · ${game.location?.name ?? ""}`),
      el("span", { class: "match-note" }, friendsGoingText(game.friendIds.map((id) => names.get(id)))),
      spots,
    ),
    joinButton(game, {
      onJoined: (joined) => {
        spots.textContent = spotsLine(joined);
      },
      showMessage,
    }),
  );
}

// ---------------------------------------------------------------------------
// Add friends
// ---------------------------------------------------------------------------

let searchId = 0;

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = searchInput.value.trim();
  showMessage("");
  if (!text) {
    lastResults = null;
    resultsList.replaceChildren();
    showMessage("Type the start of a player's name.");
    return;
  }
  const id = ++searchId;
  resultsList.replaceChildren(el("p", { class: "inbox-empty muted" }, "Searching…"));
  try {
    const players = await findPlayers(text);
    if (id !== searchId) return;
    lastResults = players;
    drawResults(players, text);
  } catch (err) {
    if (id !== searchId) return;
    console.error("Cannot search for players:", err);
    resultsList.replaceChildren();
    showMessage(friendlyEventError(err));
  }
});

function drawResults(players, text = searchInput.value.trim()) {
  if (players.length === 0) {
    resultsList.replaceChildren(
      el("p", { class: "inbox-empty muted" }, `No players whose name starts with "${text}".`),
    );
    return;
  }
  resultsList.replaceChildren(
    ...players.map((player) =>
      el(
        "div",
        { class: "list-item player-row" },
        playerAvatar(player),
        el(
          "div",
          { class: "list-text" },
          el("strong", {}, player.displayName ?? "Player"),
          el("span", { class: "muted" }, playerDetails(player)),
        ),
        el("div", { class: "row-actions" }, relationButton(player, showMessage)),
      ),
    ),
  );
}

// Before anything loads.
auth.authStateReady().then(() => {
  if (auth.currentUser && !current) drawFriends();
});
