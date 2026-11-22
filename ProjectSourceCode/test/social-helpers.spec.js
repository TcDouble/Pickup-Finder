// Unit tests for the helpers behind the friends list (GitHub issue #33) and
// the Online now list (issue #32): ../firebase/social-helpers.js and the
// text helpers for those panels in ../assets/panel-helpers.js. No browser,
// emulator, or database is involved. The Firestore side (friends.js,
// presence.js, and their rules) is tested on the emulators in
// ../firebase/tests/.
import { expect } from "chai";
import {
  ONLINE_WINDOW_MS,
  chunk,
  friendshipView,
  isOnline,
  pairId,
  searchPrefixes,
  sortOnlinePlayers,
  splitFriendships,
} from "../firebase/social-helpers.js";
import { activityText, friendsGoingText, playerDetails } from "../assets/panel-helpers.js";

const MINUTE = 60 * 1000;
const now = new Date("2026-11-20T18:00:00Z");
const ago = (ms) => new Date(now.getTime() - ms);
// Firestore Timestamps have toDate(); the helpers accept them or Dates.
const stamp = (date) => ({ toDate: () => date });

describe("friends and online helpers (unit)", () => {
  describe("pairId", () => {
    it("gives two players the same ID whoever asks", () => {
      expect(pairId("bob", "alice")).to.equal("alice_bob");
      expect(pairId("alice", "bob")).to.equal("alice_bob");
      expect(pairId("Zed", "amy")).to.equal("Zed_amy"); // capitals sort first, like the rules
    });
  });

  describe("friendshipView and splitFriendships", () => {
    const request = (from, to, fields = {}) => ({
      userIds: [from, to].sort(),
      requesterId: from,
      addresseeId: to,
      status: "pending",
      createdAt: stamp(ago(10 * MINUTE)),
      ...fields,
    });

    it("tells friends, requests to you, and requests you sent apart", () => {
      expect(friendshipView(request("me", "riley"), "me")).to.deep.include({ userId: "riley", relation: "outgoing" });
      expect(friendshipView(request("riley", "me"), "me")).to.deep.include({ userId: "riley", relation: "incoming" });
      const accepted = request("riley", "me", { status: "accepted", acceptedAt: stamp(ago(MINUTE)) });
      expect(friendshipView(accepted, "me")).to.deep.equal({
        userId: "riley",
        relation: "friend",
        createdAt: ago(10 * MINUTE),
        acceptedAt: ago(MINUTE),
      });
    });

    it("ignores documents that aren't yours", () => {
      expect(friendshipView(request("riley", "sam"), "me")).to.equal(null);
      expect(friendshipView(null, "me")).to.equal(null);
      expect(friendshipView({ userIds: ["me"] }, "me")).to.equal(null);
    });

    it("sorts friends by name and requests newest first", () => {
      const names = { sam: "sam", alex: "Alex", riley: "Riley", jo: "Jo", kim: "Kim" };
      const split = splitFriendships(
        [
          request("me", "sam", { status: "accepted" }),
          request("riley", "me", { status: "accepted" }),
          request("alex", "me", { status: "accepted" }),
          request("jo", "me", { createdAt: stamp(ago(60 * MINUTE)) }),
          request("kim", "me", { createdAt: stamp(ago(5 * MINUTE)) }),
          request("riley", "sam"), // someone else's
        ],
        "me",
        (id) => names[id],
      );
      expect(split.friends.map((f) => f.userId)).to.deep.equal(["alex", "riley", "sam"]);
      expect(split.incoming.map((f) => f.userId)).to.deep.equal(["kim", "jo"]);
      expect(split.outgoing).to.deep.equal([]);
    });

    it("puts a request whose time isn't saved yet first", () => {
      const split = splitFriendships(
        [request("me", "jo"), request("me", "kim", { createdAt: null })],
        "me",
      );
      expect(split.outgoing.map((f) => f.userId)).to.deep.equal(["kim", "jo"]);
    });
  });

  describe("isOnline", () => {
    it("counts players who checked in within the window", () => {
      expect(isOnline({ state: "online", lastSeen: ago(MINUTE) }, now)).to.equal(true);
      expect(isOnline({ state: "online", lastSeen: ago(ONLINE_WINDOW_MS + 1) }, now)).to.equal(false);
    });

    it("doesn't count players who checked out, hid, or never checked in", () => {
      expect(isOnline({ state: "offline", lastSeen: ago(MINUTE) }, now)).to.equal(false);
      expect(isOnline({ state: "hidden", lastSeen: null }, now)).to.equal(false);
      expect(isOnline(null, now)).to.equal(false);
      expect(isOnline({ state: "online", lastSeen: null }, now)).to.equal(false);
    });
  });

  describe("searchPrefixes", () => {
    it("tries the name as typed, capitalized, and lowercase", () => {
      expect(searchPrefixes("riley")).to.deep.equal(["riley", "Riley"]);
      expect(searchPrefixes(" RILEY  park ")).to.deep.equal(["RILEY park", "riley park"]);
      expect(searchPrefixes("Riley")).to.deep.equal(["Riley", "riley"]);
    });

    it("finds nothing for blank text", () => {
      expect(searchPrefixes("   ")).to.deep.equal([]);
      expect(searchPrefixes(null)).to.deep.equal([]);
    });
  });

  describe("sortOnlinePlayers", () => {
    it("puts friends first, then everyone by name", () => {
      const players = [
        { userId: "z", displayName: "Zoe" },
        { userId: "s", displayName: "sam" },
        { userId: "a", displayName: "Alex" },
        { userId: "r", displayName: "Riley" },
      ];
      const sorted = sortOnlinePlayers(players, new Set(["z", "r"]));
      expect(sorted.map((p) => p.displayName)).to.deep.equal(["Riley", "Zoe", "Alex", "sam"]);
      expect(players[0].displayName).to.equal("Zoe"); // doesn't change the list it's given
    });
  });

  describe("chunk", () => {
    it("splits a list into Firestore-sized batches", () => {
      const ids = Array.from({ length: 65 }, (_, i) => `u${i}`);
      expect(chunk(ids).map((batch) => batch.length)).to.deep.equal([30, 30, 5]);
      expect(chunk([])).to.deep.equal([]);
    });
  });

  describe("activityText", () => {
    it("says when a friend was last on", () => {
      expect(activityText({ state: "online", lastSeen: ago(MINUTE) }, now)).to.equal("Online now");
      expect(activityText({ state: "offline", lastSeen: ago(20 * 1000) }, now)).to.equal("Active just now");
      expect(activityText({ state: "offline", lastSeen: ago(5 * MINUTE) }, now)).to.equal("Active 5m ago");
      expect(activityText({ state: "online", lastSeen: ago(3 * 60 * MINUTE) }, now)).to.equal("Active 3h ago");
      expect(activityText({ state: "offline", lastSeen: new Date("2026-11-03T18:00:00Z") }, now)).to.equal(
        "Active Nov 3",
      );
    });

    it("says nothing for hidden players or players who never opened the app", () => {
      expect(activityText({ state: "hidden", lastSeen: null }, now)).to.equal("");
      expect(activityText(undefined, now)).to.equal("");
    });
  });

  describe("playerDetails and friendsGoingText", () => {
    it("shows a player's city and sports", () => {
      expect(playerDetails({ city: "Boulder", sports: ["soccer", "tennis"] })).to.equal("Boulder · Soccer, Tennis");
      expect(playerDetails({ city: "", sports: ["pickleball"] })).to.equal("Pickleball");
      expect(playerDetails({})).to.equal("");
    });

    it("says which friends are going to a game", () => {
      expect(friendsGoingText(["Riley"])).to.equal("Riley is going");
      expect(friendsGoingText(["Riley", "Sam"])).to.equal("Riley and Sam are going");
      expect(friendsGoingText(["Riley", "Sam", "Jo", "Kim"])).to.equal("Riley, Sam, and 2 more are going");
      expect(friendsGoingText([null])).to.equal("");
    });
  });
});
