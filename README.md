# Database Plan

**Owner:** Jun
**Status:** Draft, open for team feedback

This is the order for building the Pickup Finder database on Firebase. It covers the data model, what gets built when, and how we'll know each step is done.

## Decisions so far

- Firebase is the backend. The frontend talks to it directly, so there's no server of our own.
- Firebase Authentication handles sign-up and login with email/password and Google sign-in.
- Cloud Firestore stores profiles and games. Each profile is keyed by the user's Auth ID.
- Each game stores its latitude and longitude so it can be pinned on the map and found by distance.
- The map and game pages update live as players join or games change.
- Security Rules make sure users only edit their own profiles, only hosts change their games, and games can't go over their player limit.
- Sports are a fixed list, not free text.
- Past games are marked `completed` automatically, and can optionally be deleted 30 days after they end.
- Images go in Cloud Storage, and game reminders and alerts use Cloud Messaging.

## Data model

### `users`

| Field | Type | Notes |
| --- | --- | --- |
| `displayName` | string | |
| `photoURL` | string | empty until a photo is uploaded |
| `preferredSports` | array | sport IDs |
| `skillLevel` | string | values to be agreed in Step 1 |
| `createdAt` | timestamp | |

Each user also has a `notifications` list with a type, the related game, a message, and whether it's been read.

Games a user joined or hosted aren't stored on the profile. They're looked up from `events`, so there's only one copy to keep in sync.

### `sports`

A fixed list of sport names.

### `events`

| Field | Type | Notes |
| --- | --- | --- |
| `sportId` | string | |
| `hostId` | string | the host's user ID |
| `description` | string | |
| `startTime`, `endTime` | timestamp | |
| `playerLimit` | number | |
| `participantIds` | array | user IDs, including the host |
| `status` | string | `scheduled`, `cancelled`, or `completed` |
| `location` | map | address, latitude, longitude |
| `imageURL` | string | optional |
| `createdAt` | timestamp | |

The number of players is the length of `participantIds`, so there's no separate count to keep in sync.

## Step 1: Agree on the data model

- Review the collections above with Paul and Julian (profiles) and with Greyson and Zuechen (the map uses `location`).
- Confirm the field names the frontend will use, especially `hostId`, `sportId`, `participantIds`, `startTime`, and the `status` values.

**Done when:** the team has signed off on the data model, for example by approving the pull request that adds this plan.

## Step 2: Set it up in Firebase

- Turn on email/password and Google sign-in.
- Create the Firestore database and add the sports list.
- Set up the Firebase emulators so everyone can test locally with the same sample data.

**Done when:** the emulators run with sample users, games, and the security rules loaded, and the live project has the same rules and sports list.

## Step 3: Write and test the operations the frontend needs

| Feature | What it does |
| --- | --- |
| Register | create the account and the user's profile; a taken email is rejected |
| Login / log out | sign in with email/password or Google, and sign out |
| Create game | save a game with the signed-in user as host and first player |
| Map listing | load scheduled games near the user, filtered by sport, time, and open spots |
| Game details | one game with its sport, location, and players |
| Join / leave game | add or remove the signed-in user from the game |
| Cancel game | the host marks the game `cancelled`, and the players are notified |
| Edit profile | update the signed-in user's own profile |
| Notifications | list a user's unread notifications and mark them as read |
| Cleanup | mark games that have ended as `completed` |

Test each one, including these cases:

- A duplicate email is rejected.
- Joining a full game fails, even when two users try for the last spot at once.
- Someone who isn't the host can't edit or cancel a game, and users can't edit each other's profiles.
- The cleanup marks past games `completed` and leaves upcoming ones alone.

**Done when:** the operations are written in one shared file, they pass the tests above, and the profile and map teammates have what they need.

## Optional features (after Steps 1 to 3)

These are stretch goals. Start them only once the core database works. They're listed in build order, because matchmaking needs ratings.

### A. Friends list

A new **`friendships`** collection holds one record per pair of users.

| Field | Type | Notes |
| --- | --- | --- |
| `requesterId` | string | who sent the request |
| `addresseeId` | string | who received it |
| `status` | string | `pending` or `accepted` |
| `createdAt` | timestamp | |
| `acceptedAt` | timestamp | set when the request is accepted |

- Only one record can exist for the same two people, in either direction, and users can't friend themselves.
- Only the person who received a request can accept it. Declining, cancelling, and unfriending all delete the record.
- If A sends B a request while B's request to A is still pending, the app should accept B's request instead.
- Add `friend_request` and `friend_accepted` notifications.

Features: send a request, accept one, list friends, list pending requests, and list upcoming games that friends have joined.

**Done when:** two test users can send, accept, and remove a friend request, and duplicate or self requests are rejected.

### B. Skill ratings (ELO)

Each user gets one rating per sport, since being good at basketball says nothing about tennis. Everyone starts at 1000.

- Each user stores a rating and a games-rated count per sport. A user with no rating yet counts as 1000.
- Each user also keeps a rating history: for each rated game, the sport, the date, and their rating before and after.
- Games get a `teams` field (which team each player is on) and a `result` field (`team1`, `team2`, or `tie`), recorded by the host after the game.
- New notification type `rating_updated`.

When a result is recorded, ratings are updated all at once:

1. Average each team's ratings to get `R1` and `R2`.
2. Team 1's expected score is `E1 = 1 / (1 + 10^((R2 - R1) / 400))`.
3. Team 1's actual score `S1` is 1 for a win, 0.5 for a tie, and 0 for a loss.
4. Every team 1 player gains `32 × (S1 - E1)`, rounded, and every team 2 player gains the negative of that.
5. Save each player's new rating and add an entry to their history.

For example, a team averaging 1100 that beats a team averaging 1050 has `E1 = 0.57`, so each winner gains 14 points and each loser drops 14.

Rating history is stored with each user, not with the game, so deleting old games doesn't erase it.

**Done when:** recording a result moves every player's rating by the right amount, and recording the same game a second time is rejected.

### C. Matchmaking

Matchmaking needs no new collections:

- **Recommended games:** upcoming games near the user that they haven't joined and that still have room, ordered by how close the players' average rating is to the user's own rating for that sport, then by start time.
- **Balanced teams:** when the host picks teams, sort the players by rating and assign them in a snake draft (1, 2, 2, 1, 1, 2, and so on), then save the teams.

**Done when:** a test user sees closer-rated games first, and the snake draft gives teams with close averages. For example, players rated 1300, 1100, 1000, and 900 split into teams averaging 1100 and 1050.

## Open questions

- When is the next project checkpoint, and which steps have to be finished by then?
- Should display names be unique? Firebase only guarantees unique emails.
- If we build ratings, who records a game's result? Letting only the host do it is simplest, but a host could report fake wins.
- Should ratings show on profiles, or only be used behind the scenes for matchmaking?