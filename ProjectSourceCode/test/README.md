# Lab 10 tests

Automated tests for Pickup-Finder, written with Mocha and Chai and run against
the Firebase Auth, Firestore and Storage emulators.

Lab 10 is written for an Express server with PostgreSQL and a `POST /register`
route. Our pages talk to Firebase directly, and our Express server
(`index.js`) only serves the pages, so there's no `/register` route. The TA
approved using Firebase and adapting the tests so they check the same things
(confirmed with the team on 2026-11-08). This file explains how each lab
requirement maps onto our app.

| Lab asks for | What we test instead | File |
|---|---|---|
| Unit test of `validateRegistration`, no HTTP or database | `validateRegistration()` on its own; it has no imports | `validation.spec.js` |
| Positive `POST /register` test | `registerUser()`, the function the sign-up page calls, on the emulators | `registration.spec.js` |
| Negative `POST /register` test (no password) | `registerUser()` with an empty password | `registration.spec.js` |
| Test database whose name ends in `_test` | Emulators under the `demo-pickup-finder` project, which can't reach live Firebase | `emulator.js` |
| Map pins (not in the lab) | `map-pins.js` on its own: which games get pins, where, shared spots, and what the popup says | `map-pins.spec.js` |
| Profile panel (not in the lab) | `validateProfile()` on its own; `saveProfile()`, `countGamesHosted()`, `sendPasswordReset()` and `deleteAccount()` on the emulators | `profile-validation.spec.js`, `profile.spec.js` |
| Friends and Online now panels (not in the lab) | The plain helpers in `firebase/social-helpers.js` and the panel text helpers on their own; `firebase/friends.js` and `firebase/presence.js` themselves are tested on the emulators in `firebase/tests/` | `social-helpers.spec.js` |
| Security rules for profiles | Every check in the `users` rule: owner-only writes and deletes, field types and lengths, unknown fields | `profile-rules.spec.js` |
| Settings (not in the lab) | `validateSettings()` on its own; `saveSettings()`, city privacy, `changePassword()` and `changeEmail()` on the emulators; the `settings` rule and the friend-request check | `settings-validation.spec.js`, `settings.spec.js`, `settings-rules.spec.js` |
| Security rules for profile pictures | Every rule in `firebase/storage.rules`, tried as the owner, another user, and a signed-out visitor | `storage-rules.spec.js` |
| Extra credit: positive and negative test for another feature | `createEvent()` (hosting a game): valid game, invalid player limit, signed-out visitor | `events.spec.js` |
| `GET /welcome` test | `GET /welcome` on `index.js`, the small web server that serves the pages on Render, plus its other routes and the Maps key | `server.spec.js` |

## Registration contract

The lab's `/register` route becomes `registerUser({ auth, db, storage }, input)` in
`login-and-registration/registerUser.js`. The registration page passes in the
real `auth`, `db` and `storage`; the tests pass emulator ones.

**Input**: `{ photo, displayName, email, password, confirm, city, sports }`.
`photo` is optional: a `File` (or anything with `type` and `size`), or `null`.

**Checks** (`login-and-registration/validateRegistration.js`, in this order):

| Problem | Message |
|---|---|
| Blank display name | `Enter a display name.` |
| Blank email | `Enter your email.` |
| Badly formed email | `Please enter a valid email address.` |
| Blank password | `Enter a password.` |
| Password under 8 characters | `Password must be at least 8 characters.` |
| Password and confirmation differ | `Passwords don't match.` |

Email and password are skipped when someone who is already signed in is only
finishing their profile.

**Success**: returns `{ uid, profile }`, where `profile` is
`{ displayName, photoURL, city, sports }` with text trimmed. It creates one
Firebase Auth account (which stores the email and the hashed password) and one
Firestore document at `users/{uid}` with those fields plus `createdAt`. The
password and email are never written to Firestore. A picture is uploaded to
Storage at `profilePictures/{uid}/avatar` and `photoURL` is its download URL;
with no picture, `photoURL` is `null`.

**Failure**:

- Invalid input throws a `RegistrationError` with `code: "registration/invalid"`,
  `message` set to the first problem, and `errors` listing all of them. Nothing
  is created in Auth or Firestore.
- If Firebase refuses (for example the email is already in use), the Firebase
  error is thrown as is (`auth/email-already-in-use`, `permission-denied`, ...).

## Running the tests

### On your computer

Needs Node 20 or newer and Java 21 or newer (the emulators run on Java).

```sh
cd ProjectSourceCode
npm ci           # first time, and after package.json changes
npm test         # starts the emulators, runs every *.spec.js, stops them
npm run test:unit  # only the unit tests and the server test; no emulators or Java needed
```

### In Docker (what the lab asks for)

```sh
cd ProjectSourceCode
cp .env.test.example .env.test   # first time only; .env.test is git-ignored
docker compose -p lab10-tests -f docker-compose.test.yaml up --abort-on-container-exit --exit-code-from tests
docker compose -p lab10-tests -f docker-compose.test.yaml down
```

The container installs packages with `npm ci` and runs `npm test`. The first
run takes a few minutes (Java, packages, and the emulator download); after
that they're cached in Docker volumes. `down --volumes` clears those caches.

The events back end has its own, larger suite (78 tests, Node's built-in test
runner): `cd firebase && npm ci && npm test`, or the `firebase` profile in
`docker-compose.test.yaml`.

## Test data and cleanup

- The emulators start empty on every `npm test` run and throw everything away
  when it ends, so no run depends on an earlier one.
- Each test also uses fresh data (a new email address or game title with a
  timestamp) and deletes exactly what it created in `afterEach`: the
  `users/{uid}` or `events/{id}` documents and the Auth accounts. The suite
  passes when run twice in a row with no manual cleanup.
- `emulator.js` refuses to run unless the emulators are running and the
  project ID starts with `demo-`, so the tests can never touch the live
  Firebase project (`sport-pick-up-app-team-4`).

## Showing a failing test (for the TA demo)

1. In `login-and-registration/registerUser.js`, change the `setDoc(...)` line
   to also save `password: input.password`.
2. Run `npm test`. "signs up a valid user..." fails with
   `expected { …(7) } to not have property 'password'`.
3. Undo the change and run `npm test` again: everything passes.

Another option: delete the `if (!password) errors.push("Enter a password.");`
line in `validateRegistration.js`. The unit test "rejects a missing password"
and the negative sign-up test both fail.
