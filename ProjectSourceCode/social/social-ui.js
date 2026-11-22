// Shared by the Friends panel (friends-panel.js, GitHub issue #33) and the
// Online now panel (online-panel.js, issue #32): one live copy of your
// friends and requests, a player's picture, and the "Add friend" button.

import { auth } from "../firebase/firebase-config.js";
import { friendlyEventError } from "../firebase/events.js";
import { acceptFriendRequest, sendFriendRequest, watchFriends } from "../firebase/friends.js";
import { el, initials } from "../assets/panel-helpers.js";

// ---------------------------------------------------------------------------
// Your friends, live
// ---------------------------------------------------------------------------

let friends = null; // { friends, incoming, outgoing } from watchFriends, or null until loaded
let relations = new Map(); // user ID -> "friend" | "incoming" | "outgoing"
const listeners = new Set();
let started = false;

/**
 * Call onChange(friends, error) now (if loaded) and whenever your friends or
 * requests change. `friends` is { friends, incoming, outgoing } as
 * watchFriends in ../firebase/friends.js gives them.
 */
export function onFriendsChange(onChange) {
  listeners.add(onChange);
  if (friends) onChange(friends, null);
  start();
}

/** "friend", "incoming", "outgoing", or null for anyone else. */
export function relationOf(userId) {
  return relations.get(userId) ?? null;
}

/** The user IDs of your friends (accepted only). */
export function friendIds() {
  return new Set((friends?.friends ?? []).map((friend) => friend.userId));
}

async function start() {
  if (started) return;
  started = true;
  await auth.authStateReady();
  if (!auth.currentUser) return;
  watchFriends(
    (value) => {
      friends = value;
      relations = new Map(
        [...value.friends, ...value.incoming, ...value.outgoing].map((item) => [item.userId, item.relation]),
      );
      listeners.forEach((listener) => listener(friends, null));
    },
    (err) => {
      console.error("Cannot load your friends:", err);
      listeners.forEach((listener) => listener(friends, err));
    },
  );
}

// ---------------------------------------------------------------------------
// Pieces of a player row
// ---------------------------------------------------------------------------

/** A player's picture, or their initials, with a green dot when they're online. */
export function playerAvatar(player, { online = false } = {}) {
  const letters = () => el("div", { class: "list-icon round initial" }, initials(player.displayName));
  let face = letters();
  if (player.photoURL) {
    face = el("img", { class: "list-icon round photo", src: player.photoURL, alt: "" });
    face.addEventListener("error", () => face.replaceWith(letters()), { once: true });
  }
  return el(
    "div",
    { class: "avatar-wrap", "aria-hidden": "true" },
    face,
    online && el("span", { class: "online-dot" }),
  );
}

/** A short word in place of a button: "Friend", "Requested". */
export function tag(text) {
  return el("span", { class: "card-state" }, text);
}

/**
 * What you can do about a player you aren't friends with yet: "Add friend",
 * "Accept" when they asked you, or a word saying where things stand.
 * `showMessage(text, ok)` shows the panel's message line. The lists redraw
 * by themselves when the request goes through.
 */
export function relationButton(player, showMessage) {
  const relation = relationOf(player.userId);
  if (relation === "friend") return tag("Friend");
  if (relation === "outgoing") return tag("Requested");

  const accept = relation === "incoming";
  const name = player.displayName ?? "this player";
  const label = accept ? "Accept" : "Add friend";
  const button = el(
    "button",
    {
      type: "button",
      class: "btn small primary",
      "aria-label": accept ? `Accept ${name}'s friend request` : `Add ${name} as a friend`,
    },
    label,
  );
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = accept ? "Accepting…" : "Sending…";
    showMessage("");
    try {
      const result = accept ? await acceptFriendRequest(player.userId) : await sendFriendRequest(player.userId);
      button.replaceWith(tag(result === "friend" ? "Friend" : "Requested"));
      showMessage(
        result === "friend" ? `You and ${name} are friends now.` : `Friend request sent to ${name}.`,
        true,
      );
    } catch (err) {
      console.error(`Cannot add ${player.userId} as a friend:`, err);
      button.disabled = false;
      button.textContent = label;
      showMessage(friendlyEventError(err));
    }
  });
  return button;
}
