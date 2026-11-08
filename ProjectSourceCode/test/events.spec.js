// Lab 10 extra credit: positive and negative integration tests for a feature
// other than registration. "Valid versus invalid creation of a
// project-specific record" here means hosting a pickup game with createEvent()
// from ../firebase/events.js, on the emulators with the real security rules.
import { expect } from "chai";
import { signedInAs, signedOut, closeAll, gameInput } from "../firebase/tests/helpers.js";
import { startTestEnv, findDocs, deleteDocById, deleteAuthUser, rejects } from "./emulator.js";

describe("createEvent (hosting a game) [extra credit]", () => {
  let testEnv;
  const people = [];
  const gameIds = [];

  before(async () => {
    testEnv = await startTestEnv();
  });

  // Targeted cleanup: remove only the games and accounts each test created.
  afterEach(async () => {
    if (!testEnv) return;
    for (const id of gameIds.splice(0)) await deleteDocById(testEnv, "events", id);
    const done = people.splice(0);
    for (const person of done) if (person.uid) await deleteAuthUser(person.uid);
    await closeAll(done);
  });

  after(async () => {
    await testEnv?.cleanup();
  });

  it("saves a valid game once, with the signed-in user as host and first player", async () => {
    const alice = await signedInAs("Alice");
    people.push(alice);

    const id = await alice.createEvent(gameInput({ sportId: "soccer", playerLimit: 12 }));
    gameIds.push(id);

    // The response
    expect(id).to.be.a("string").that.is.not.empty;

    // Exactly one game hosted by Alice, with the right fields
    const games = await findDocs(testEnv, "events", "hostId", alice.uid);
    expect(games).to.have.lengthOf(1);
    const [game] = games;
    expect(game.id).to.equal(id);
    expect(game).to.include({ sportId: "soccer", playerLimit: 12, hostName: "Alice", status: "scheduled" });
    expect(game.participantIds).to.deep.equal([alice.uid]);
  });

  it("rejects a game with a player limit of 1 and saves nothing", async () => {
    const bob = await signedInAs("Bob");
    people.push(bob);

    const err = await rejects(bob.createEvent(gameInput({ playerLimit: 1 })));

    expect(err.code).to.equal("events/invalid-player-limit");
    expect(await findDocs(testEnv, "events", "hostId", bob.uid)).to.have.lengthOf(0);
  });

  it("rejects a game from someone who isn't signed in and saves nothing", async () => {
    const visitor = await signedOut();
    people.push(visitor);
    const title = `signed-out-${Date.now()}`;

    const err = await rejects(visitor.createEvent(gameInput({ title })));

    expect(err.code).to.equal("events/not-signed-in");
    expect(await findDocs(testEnv, "events", "title", title)).to.have.lengthOf(0);
  });
});
