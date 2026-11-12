# Notifier: match alerts, game reminders, and feedback requests

**Owner:** Jun · GitHub issue #17 (Matchmaking Notifications)

The notifier is a small Node.js server that runs in Docker. Every minute it looks at Firestore and sends players the notifications they asked for, by email, text message, or desktop notification, so they hear about games even when the site isn't open.

| Kind | When it's sent | Who gets it |
| --- | --- | --- |
| **Match alert** | Right after someone posts a game that fits your matchmaking settings | Players whose match alerts include that sport, the game is within their distance and skill level, and every player in it has at least the sportsmanship score they asked for. At most 3 a day per player. |
| **Game reminder** | About an hour before a game starts | Everyone in the game. If the host moves the game, you get a new reminder for the new time. |
| **Feedback request** | Right after a game ends | Everyone in the game, if there's someone else to rate. It links to the rating page and says when rating closes (14 days later). |

Players choose all of this on the site, through `saveNotificationSettings()` in [`../firebase/notifications.js`](../firebase/notifications.js). Nobody gets email, texts, or desktop notifications until they turn that channel on, and each kind can be turned off. Every notification also goes into the player's in-app inbox (`listMyNotifications()`), whatever channels they chose.

## How it works

```text
 browser (notifications.js)            Firestore                    notifier (this folder)
 ─────────────────────────            ─────────                    ──────────────────────
 saveNotificationSettings()  ──►  notificationSettings/{uid}  ◄──  reads settings
 createEvent() (events.js)   ──►  events/{id}                 ◄──  checks every POLL_SECONDS
 listMyNotifications()       ◄──  notifications/{id}          ◄──  saves each notification, then sends it:
                                                                      email   SMTP (e.g. Gmail)
                                                                      text    Twilio
                                                                      desktop Firebase Cloud Messaging
```

- **Each notification goes out once.** Before sending, the notifier saves it in `notifications` under an ID built from what it's about, such as `reminder_<game>_<player>_<start time>`. Firestore refuses to create a document whose ID already exists, so a restart, or two notifiers running at once, can't send it twice.
- **New games** are found by `createdAt`. The notifier remembers the last game it looked at in `notifier/state`, so it only alerts about games posted since. The first time it runs, it looks back 10 minutes.
- **It uses the Firebase Admin SDK**, which skips the security rules. That's why it can read everyone's settings and write `notifications`, which browsers can't. It only writes `notifications`, `notifier/state`, and push tokens that stopped working.
- **Email addresses come from Firebase Authentication**, not from a form, so nobody can point our emails at someone else's address. Phone numbers come from the player's own private settings.
- **A channel that isn't set up is printed instead of sent**, and recorded as `logged`. With no accounts at all you can still demo it: the log shows every message it would send.

**Cost:** a pass with nothing to send reads about 4 documents, so checking every 60 seconds uses about 6,000 of the free plan's 50,000 reads a day. Set `POLL_SECONDS=120` to halve that. Writes only happen when something is sent.

Each notification records what happened on each channel in `delivery`: `sent`, `logged` (not set up), `failed`, `off` (the player didn't choose it), `no-address` (no email on the account), or `no-device` (no browser that can still receive it). Failed messages aren't retried.

## Running it

### In Docker (the normal way)

You need Docker, a service account key for the Firebase project, and accounts for whichever channels you want.

1. **Service account key:** Firebase console > Project settings > Service accounts > Generate new private key. Save the file as `service-account.json` in this folder. It's in `.gitignore`. **Never commit it**: it gives full access to the database. If it ever ends up on GitHub, delete the key in the Google Cloud console right away.
2. **Settings:** `cp .env.example .env`, then fill in the email and text settings you have. `.env.example` explains each one.
3. **Start it:**

```sh
docker compose up --build -d     # start in the background
docker compose logs -f           # watch what it sends
docker compose down              # stop it
```

The rules and indexes in [`../firebase/`](../firebase/) have to be deployed first (`npm run deploy:firestore` there), because the notifier's searches need the new indexes on the live project.

### Without Docker

You need Node 20.12 or newer. From this folder:

```sh
npm install
cp .env.example .env    # and fill it in, including GOOGLE_APPLICATION_CREDENTIALS
npm start               # keep running
npm run once            # one pass, then exit
```

### Against the emulators (no accounts, no live data)

With the emulators running from [`../firebase/`](../firebase/) (`npm run emulators`, which needs Java 21), point the notifier at them:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run once
```

It uses the `demo-pickup-finder` project and prints every message instead of sending it. Desktop notifications are off on the emulators, because Firebase Cloud Messaging has no emulator.

## Setting up each channel

| Channel | What you need | Settings in `.env` |
| --- | --- | --- |
| Email | Any SMTP account. With Gmail, turn on 2-Step Verification and make an app password. | `SMTP_URL`, `MAIL_FROM` |
| Text messages | A Twilio account and phone number. A free trial can only text numbers you've verified in Twilio, which is enough for a demo. | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` |
| Desktop | Nothing extra for the notifier: it uses the service account. The site needs the Web Push key in `VAPID_KEY` in [`../firebase/notifications.js`](../firebase/notifications.js), and a page that calls `enableDesktopNotifications()`. | `DESKTOP_PUSH` (on by default) |

The links in messages point at `APP_URL` plus the paths in `LINKS` in [`src/messages.js`](src/messages.js). The game and rating pages don't exist yet, so update those paths when they're built. Desktop notifications only open a link that starts with `https://`.

## Files

| File | What it is |
| --- | --- |
| `src/index.js` | Starts the server: reads settings, connects to Firebase, runs a pass every `POLL_SECONDS`. |
| `src/notifier.js` | One pass: finds games, works out who to notify, saves and sends each notification. |
| `src/matching.js` | Whether a new game fits a player's match alerts. |
| `src/messages.js` | The words of every notification, and the links. |
| `src/channels.js` | Email (nodemailer), text (Twilio's REST API), and desktop (Firebase Cloud Messaging). |
| `src/config.js` | Reads the settings from the environment. |
| `Dockerfile`, `docker-compose.yaml` | The container. |
| `.env.example` | Every setting, explained. Copy it to `.env`. |
| `test/` | Tests (below). |

## Tests

```sh
npm install
npm test          # everything, on the emulators (needs Java 21)
npm run test:unit # only the tests that don't need the emulators
```

`npm test` starts the Firestore and Auth emulators with the same `firebase.json` as [`../firebase/`](../firebase/), and runs one notifier pass at a time against them with fake email, text, and desktop services that record what they were asked to send. Without Java, run the same tests in Docker from `ProjectSourceCode/` (copy `.env.test.example` to `.env.test` first, as for the Lab 10 tests):

```sh
docker compose -f docker-compose.test.yaml --profile firebase up --build --abort-on-container-exit --exit-code-from notifier-tests notifier-tests
```
