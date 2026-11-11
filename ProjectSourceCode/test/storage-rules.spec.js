// Tests firebase/storage.rules directly on the Storage emulator: every rule
// is tried as the owner, as another signed-in user, and as a signed-out visitor.
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { BUCKET, startTestEnv } from "./emulator.js";

const MB2 = 2 * 1024 * 1024;
const IMAGE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

describe("storage.rules (profile pictures)", () => {
  let testEnv;

  before(async () => {
    testEnv = await startTestEnv();
  });

  afterEach(async () => {
    await testEnv?.clearStorage();
  });

  after(async () => {
    await testEnv?.cleanup();
  });

  const as = (uid) => testEnv.authenticatedContext(uid).storage(`gs://${BUCKET}`);
  const signedOut = () => testEnv.unauthenticatedContext().storage(`gs://${BUCKET}`);
  const upload = (storage, path, data = IMAGE, contentType = "image/png") =>
    storage.ref(path).put(data, { contentType }).then((snap) => snap);
  const seed = (path) =>
    testEnv.withSecurityRulesDisabled((ctx) => upload(ctx.storage(`gs://${BUCKET}`), path));

  it("lets you upload a picture to your own avatar path", async () => {
    await assertSucceeds(upload(as("alice"), "profilePictures/alice/avatar"));
  });

  it("lets you replace your own picture", async () => {
    await seed("profilePictures/alice/avatar");
    await assertSucceeds(upload(as("alice"), "profilePictures/alice/avatar", IMAGE, "image/jpeg"));
  });

  it("lets you delete your own picture", async () => {
    await seed("profilePictures/alice/avatar");
    await assertSucceeds(as("alice").ref("profilePictures/alice/avatar").delete());
  });

  it("lets a signed-in user see someone else's picture", async () => {
    await seed("profilePictures/alice/avatar");
    await assertSucceeds(as("bob").ref("profilePictures/alice/avatar").getMetadata());
  });

  it("accepts a picture of exactly 2 MB", async () => {
    await assertSucceeds(upload(as("alice"), "profilePictures/alice/avatar", new Uint8Array(MB2)));
  });

  it("won't let you upload into someone else's folder", async () => {
    await assertFails(upload(as("bob"), "profilePictures/alice/avatar"));
  });

  it("won't let you delete someone else's picture", async () => {
    await seed("profilePictures/alice/avatar");
    await assertFails(as("bob").ref("profilePictures/alice/avatar").delete());
  });

  it("won't let a signed-out visitor see a picture", async () => {
    await seed("profilePictures/alice/avatar");
    await assertFails(signedOut().ref("profilePictures/alice/avatar").getMetadata());
  });

  it("won't let a signed-out visitor upload", async () => {
    await assertFails(upload(signedOut(), "profilePictures/alice/avatar"));
  });

  it("rejects a file that isn't an image", async () => {
    await assertFails(upload(as("alice"), "profilePictures/alice/avatar", IMAGE, "text/plain"));
  });

  it("rejects a picture over 2 MB", async () => {
    await assertFails(upload(as("alice"), "profilePictures/alice/avatar", new Uint8Array(MB2 + 1)));
  });

  it("rejects any file name other than avatar", async () => {
    await assertFails(upload(as("alice"), "profilePictures/alice/other.png"));
  });

  it("rejects uploads anywhere outside profilePictures/", async () => {
    await assertFails(upload(as("alice"), "events/game1.png"));
  });
});
