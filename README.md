# Database Plan

**Owner:** Jun
**Status:** Draft, open for team feedback

This is the order for building the Pickup Finder database. The schema, setup steps, and example queries are in [README.md](README.md). This file covers what gets built when, and how we'll know each step is done.

## Decisions so far

- PostgreSQL 16 runs as the `db` service in Docker Compose. The Node/Express server connects with `pg-promise`.
- Logins and login sessions are both stored in PostgreSQL. Sessions use `express-session` with the `connect-pg-simple` store.
- The server hashes passwords with `bcrypt` before saving them. The database only ever sees the hash.
- Sports are a fixed list in a `sports` table, not free text.
- Past games aren't deleted right away. A timer query marks them `completed`, and an optional second query deletes them 30 days after they end.

## Step 1: Agree on the schema

- Review the proposed tables in the README's [Schema](README.md#schema-proposed) section with the server teammate: `users`, `sports`, `locations`, `events`, `event_participants`, `notifications`, and `session`.
- Confirm the names the server code will use, especially `host_id`, `sport_id`, `location_id`, and the `status` values (`scheduled`, `cancelled`, `completed`).

**Done when:** the team has signed off on the schema, for example by approving the pull request that adds this plan and the README.

## Step 2: Build it in Docker

- Write `database/init/create.sql` with the tables, constraints, and indexes from the README. Copy the `session` table exactly from `connect-pg-simple`'s `table.sql`.
- Write `database/init/insert.sql` with seed data, following the README's [Seed data](README.md#seed-data) section.
- Commit `.env.example`, and add `.env` to `.gitignore`.
- Add the `db` service to `docker-compose.yml`, following the README's [Setup](README.md#setup) section.

**Done when:** a fresh `docker compose down -v` followed by `docker compose up -d db` gives a database where `\dt` lists all seven tables and the seed data is loaded.

## Step 3: Write and test the queries the server needs

The README's [Query patterns](README.md#query-patterns) section already covers the map listing, joining a game, host-only edits, and the cleanup job. This step adds the rest and tests all of them.

| Feature | Query |
| --- | --- |
| Register | insert a user and return `user_id`; a unique violation means the username or email is taken |
| Login | select `user_id`, `username`, and `password_hash` by username; the server checks the password with `bcrypt.compare` |
| Log out | handled by `connect-pg-simple`, which deletes the session row |
| Create game | insert into `events` with `host_id` from the session, then add the host to `event_participants` |
| Game details | one event with its sport, location, and players |
| Leave game | delete the user's row from `event_participants` |
| Cancel game | set `status = 'cancelled'` where the user is the host, and notify the players |
| Edit profile | update `users` `WHERE user_id = $1`, using the id from the session rather than the form |
| Notifications | insert one, list a user's unread ones, and mark them as read |

Test each query against the seed data, including these cases:

- A duplicate username or email is rejected.
- Joining a full game adds no row, even when two users try for the last spot at once.
- An edit by someone who isn't the host or owner changes 0 rows.
- The cleanup query marks past games `completed` and leaves upcoming ones alone.

**Done when:** the queries are written down in `database/queries.sql` or the README, they pass the tests above, and the server teammate has what they need to build the routes.

## Optional features (after Steps 1 to 3)

These are stretch goals. Start them only once the core database works, and add each one as a numbered file in `database/migrations/` (see the README's [Changing the schema](README.md#changing-the-schema) section) so nobody has to wipe their data. They're listed in build order, because matchmaking needs ratings. The tables and queries below were tested on PostgreSQL 16 on top of the README's schema.

### A. Friends list

A new **`friendships`** table holds one row per friend request.

| Column | Type | Rules |
| --- | --- | --- |
| `requester_id` | `INT` | who sent the request; references `users`, deleted along with the user |
| `addressee_id` | `INT` | who received it; references `users`, deleted along with the user |
| `status` | `VARCHAR(20)` | `pending` (default) or `accepted` |
| `created_at` | `TIMESTAMPTZ` | defaults to `NOW()` |
| `accepted_at` | `TIMESTAMPTZ` | set when the request is accepted |

- The primary key is (`requester_id`, `addressee_id`), and a `CHECK` stops users from friending themselves.
- A unique index on `(LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))` stops a second row for the same two people in the other direction.
- An index on `(addressee_id, status)` speeds up the "pending requests" list.
- Declining a request, cancelling it, and unfriending all delete the row.
- Add the notification types `friend_request` and `friend_accepted` to the `CHECK` on `notifications.type`.

Queries: send a request, accept one (`WHERE requester_id = $2 AND addressee_id = $1 AND status = 'pending'`, with `$1` from the session), list friends, list pending requests, and list upcoming games that friends have joined. If A sends B a request while B's request to A is still pending, the insert fails on the unique index, so the server should accept B's request instead.

**Done when:** two test users can send, accept, and remove a friend request, and duplicate or self requests are rejected.

### B. Skill ratings (ELO)

Each user gets one rating per sport, since being good at basketball says nothing about tennis. Everyone starts at 1000.

- New table `user_ratings`: `user_id` and `sport_id` (together the primary key), `rating` (`INT`, default 1000), `games_rated` (`INT`, default 0), and `updated_at`. A user with no row yet counts as 1000.
- New table `rating_changes`: `event_id` and `user_id` (together the primary key), `rating_before`, `rating_after`, and `created_at`. The primary key means a game can only be rated once per player, and the rows give each profile a rating history.
- New column `event_participants.team` (`SMALLINT`, 1 or 2), set when teams are picked.
- New column `events.result` (`VARCHAR(10)`): `team1`, `team2`, or `tie`, recorded by the host after the game.
- New notification type `rating_updated`.

When a result is recorded, the server updates ratings in one transaction:

1. Average each team's ratings to get `R1` and `R2`.
2. Team 1's expected score is `E1 = 1 / (1 + 10^((R2 - R1) / 400))`.
3. Team 1's actual score `S1` is 1 for a win, 0.5 for a tie, and 0 for a loss.
4. Every team 1 player gains `32 × (S1 − E1)`, rounded, and every team 2 player gains the negative of that.
5. Insert a `rating_changes` row for each player, and upsert their `user_ratings` row with `INSERT ... ON CONFLICT (user_id, sport_id) DO UPDATE`.

For example, a team averaging 1100 that beats a team averaging 1050 has `E1 = 0.57`, so each winner gains 14 points and each loser drops 14.

The README's optional 30-day delete of old games would also delete their `rating_changes` rows. Skip that delete if rating history should stay on profiles.

**Done when:** recording a result moves every player's rating by the right amount, and recording the same game a second time is rejected.

### C. Matchmaking

Matchmaking needs no new tables. It's two queries built on the ratings:

- **Recommended games:** upcoming, scheduled games in the map's visible area that the user hasn't joined and that still have room. They're ordered by how close the players' average rating is to the user's own rating for that sport, then by start time.
- **Balanced teams:** when the host picks teams, sort the players by rating and assign them in a snake draft (1, 2, 2, 1, 1, 2, and so on), then save each player's `team`. This is a single `UPDATE` using `ROW_NUMBER()`.

**Done when:** a test user sees closer-rated games first, and the snake draft gives teams with close averages. For example, players rated 1300, 1100, 1000, and 900 split into teams averaging 1100 and 1050.

## Open questions

- When is the next project checkpoint, and which steps have to be finished by then?
- Where should uploaded images be stored: a Docker volume served by the server, or a hosted service? The database stores a path or URL either way.
- Which PostgreSQL version does the course's lab setup use? The README assumes 16.
- If we build ratings, who records a game's result? Letting only the host do it is simplest, but a host could report fake wins.
- Should ratings show on profiles, or only be used behind the scenes for matchmaking?
