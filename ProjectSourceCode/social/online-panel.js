// "Online now" panel on the home page (GitHub issue #32).
//
// Lists the players who have PickupFinder open right now, friends first,
// with an Add friend button for everyone else. The sidebar badge counts
// them. This script also keeps your own status current while the page is
// open (startPresence), and the checkbox hides you from the list.
// The back end is ../firebase/presence.js.

import { auth } from "../firebase/firebase-config.js";
import { friendlyEventError } from "../firebase/events.js";
import { getShowOnline, setShowOnline, startPresence, watchOnlinePlayers } from "../firebase/presence.js";
import { sortOnlinePlayers } from "../firebase/social-helpers.js";
import { el, onPanelOpen, playerDetails, plural } from "../assets/panel-helpers.js";
import { friendIds, onFriendsChange, playerAvatar, relationButton } from "./social-ui.js";

const heading = document.getElementById("online-heading");
const message = document.getElementById("online-message");
const list = document.getElementById("online-list");
const showMe = document.getElementById("online-show-me");
const badge = document.getElementById("online-badge");

let players = null; // other players online now, or null until loaded
let stopWatching = null;

auth.authStateReady().then(async () => {
  if (!auth.currentUser) return;
  startPresence();
  watch();
  try {
    showMe.checked = await getShowOnline();
  } catch (err) {
    console.error("Cannot read your online status:", err);
  }
});

// Watching costs a read each time someone checks in, so stop while the page
// is in the background and catch up when it's back.
document.addEventListener("visibilitychange", () => {
  if (!auth.currentUser) return;
  if (document.visibilityState === "visible") watch();
  else unwatch();
});

onPanelOpen("online", () => {
  showMessage("");
  draw();
});

onFriendsChange(() => draw());

showMe.addEventListener("change", async () => {
  const show = showMe.checked;
  showMe.disabled = true;
  showMessage("");
  try {
    await setShowOnline(show);
    showMessage(show ? "Other players can see you're online." : "You're hidden. You can still see who's online.", true);
  } catch (err) {
    console.error("Cannot change your online status:", err);
    showMe.checked = !show;
    showMessage(friendlyEventError(err));
  } finally {
    showMe.disabled = false;
  }
});

function watch() {
  if (stopWatching) return;
  stopWatching = watchOnlinePlayers(
    (value) => {
      players = value;
      draw();
    },
    (err) => {
      console.error("Cannot load who's online:", err);
      showMessage(friendlyEventError(err));
    },
  );
}

function unwatch() {
  stopWatching?.();
  stopWatching = null;
}

function showMessage(text, ok = false) {
  message.textContent = text;
  message.classList.toggle("ok", ok);
}

function draw() {
  if (!players) {
    list.replaceChildren(el("p", { class: "inbox-empty muted" }, "Checking who's online…"));
    return;
  }
  const count = players.length;
  badge.textContent = String(count);
  badge.hidden = count === 0;
  badge.setAttribute("aria-label", `${plural(count, "player")} online`);
  heading.textContent = count ? `${plural(count, "player")} online` : "Nobody else is online";

  if (count === 0) {
    list.replaceChildren(
      el(
        "p",
        { class: "inbox-empty muted" },
        "Nobody else has PickupFinder open right now. Check back later, or host a game so players nearby can find it.",
      ),
    );
    return;
  }
  const friends = friendIds();
  list.replaceChildren(...sortOnlinePlayers(players, friends).map((player) => row(player, friends)));
}

function row(player, friends) {
  const isFriend = friends.has(player.userId);
  return el(
    "div",
    { class: "list-item player-row" },
    playerAvatar(player, { online: true }),
    el(
      "div",
      { class: "list-text" },
      el("strong", {}, player.displayName),
      el("span", { class: "activity online" }, isFriend ? "Friend · Online now" : "Online now"),
      el("span", { class: "muted" }, playerDetails(player)),
    ),
    isFriend ? null : el("div", { class: "row-actions" }, relationButton(player, showMessage)),
  );
}
