// Pure helpers for the friends list (GitHub issue #33) and the list of
// players online now (issue #32). friends.js and presence.js use them, and so
// do the home page panels. Nothing here talks to Firebase, so they're unit
// tested on their own (../test/social-helpers.spec.js).

// A player counts as online when their page checked in within this long.
// presence.js checks in every HEARTBEAT_MS while the page is showing, so a
// player whose page closed without saying so drops off the list within
// ONLINE_WINDOW_MS.
export const HEARTBEAT_MS = 60 * 1000;
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;

// Keep these in sync with the presence rule in firestore.rules.
export const PRESENCE_STATES = ["online", "offline", "hidden"];

/**
 * The ID of the friendships document for two players: their user IDs, sorted
 * and joined with "_". Whoever sends the request, the pair gets the same ID,
 * so two people can never have more than one friendship document. Firebase
 * user IDs never contain "_".
 */
export function pairId(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/**
 * One friendships document as the signed-in player sees it:
 * { userId, relation, createdAt, acceptedAt }, where userId is the other
 * player and relation is "friend", "incoming" (they asked you), or
 * "outgoing" (you asked them). Null if the document isn't about `myId`.
 */
export function friendshipView(data, myId) {
  if (!data || !Array.isArray(data.userIds) || !data.userIds.includes(myId)) return null;
  const userId = data.userIds.find((id) => id !== myId);
  if (!userId) return null;
  const relation =
    data.status === "accepted" ? "friend" : data.addresseeId === myId ? "incoming" : "outgoing";
  return {
    userId,
    relation,
    createdAt: toDate(data.createdAt),
    acceptedAt: toDate(data.acceptedAt),
  };
}

/**
 * Sort friendships documents into { friends, incoming, outgoing } for the
 * signed-in player. Friends are in order of name (pass `nameOf`), requests
 * newest first.
 */
export function splitFriendships(docs, myId, nameOf = () => "") {
  const views = docs.map((data) => friendshipView(data, myId)).filter(Boolean);
  const byName = (a, b) =>
    String(nameOf(a.userId) ?? "").localeCompare(String(nameOf(b.userId) ?? ""), "en", { sensitivity: "base" });
  // A request whose time the server hasn't filled in yet was just sent.
  const sent = (view) => view.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const newest = (a, b) => sent(b) - sent(a);
  return {
    friends: views.filter((v) => v.relation === "friend").sort(byName),
    incoming: views.filter((v) => v.relation === "incoming").sort(newest),
    outgoing: views.filter((v) => v.relation === "outgoing").sort(newest),
  };
}

/**
 * Whether a presence document ({ state, lastSeen }) means the player is
 * online now. lastSeen is a Date.
 */
export function isOnline(presence, now = new Date()) {
  if (presence?.state !== "online" || !(presence.lastSeen instanceof Date)) return false;
  return now - presence.lastSeen < ONLINE_WINDOW_MS;
}

/**
 * The ways to spell a name search so Firestore's case-sensitive prefix
 * search still finds "Riley" when someone types "riley": as typed, with a
 * capital first letter, and all lowercase. Empty for blank input.
 */
export function searchPrefixes(text) {
  const typed = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!typed) return [];
  const capitalized = typed[0].toUpperCase() + typed.slice(1);
  return [...new Set([typed, capitalized, typed.toLowerCase()])];
}

/**
 * Put players in the order the Online now list shows them: friends first,
 * then everyone else, each by name.
 */
export function sortOnlinePlayers(players, friendIds = new Set()) {
  return [...players].sort((a, b) => {
    const friendA = friendIds.has(a.userId) ? 0 : 1;
    const friendB = friendIds.has(b.userId) ? 0 : 1;
    if (friendA !== friendB) return friendA - friendB;
    return String(a.displayName ?? "").localeCompare(String(b.displayName ?? ""), "en", { sensitivity: "base" });
  });
}

/** Split a list into chunks of `size` (Firestore's "in" filters take at most 30). */
export function chunk(list, size = 30) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}

// Firestore Timestamp, Date, or nothing -> Date or null.
function toDate(value) {
  if (value instanceof Date) return value;
  if (value && typeof value.toDate === "function") return value.toDate();
  return null;
}
