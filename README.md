# Database Plan

**Owner:** Jun
**Status:** Draft, open for team feedback

This is the plan for the Pickup Finder database. It covers the PostgreSQL schema, running it in Docker, and the queries the server will call. The UI and server routes belong to other teammates, so treat this as the agreement between the server and the database. The setup and usage docs live in [README.md](README.md).

## Assumptions

- PostgreSQL runs as its own service in Docker Compose and builds its tables from SQL files on first start.
- The Node/Express server connects with `pg-promise`.
- Logins and login sessions are both stored in PostgreSQL. Sessions use `express-session` with the `connect-pg-simple` store.
- The server hashes passwords with `bcrypt` before saving them. The database only ever sees the hash.
- Uploaded images are saved as files (for example, in a Docker volume), and the database stores their paths.

If the team ends up using a different stack, update this section first.

## How the requirements map to the database

| Requirement | Database piece |
| --- | --- |
| User info, registration, login | `users` table |
| Passwords hashed before storage | `password_hash` column, and no plain-text password column |
| Sessions (stay logged in, log out) | `session` table used by `connect-pg-simple` |
| Event info | `events` table |
| Map integration | `latitude` and `longitude` on `events` |
| Media storage for profile and event images | `profile_image_path` on `users`, `image_path` on `events` |
| Notifications | `notifications` table |
| Removing past events | index on `starts_at` and a cleanup query the server runs on a timer |
| Users can only edit their own info | owner columns (`creator_id`, `user_id`) checked in every update query |
| Built and run in Docker | `db` service in `docker-compose.yml` with init scripts |
| Real-time updates | handled by the server; the database only needs `created_at` timestamps |

## Step 1: Design the schema

The goal is for the team to agree on table and column names before anyone writes queries. Here is the first draft.

**`users`**

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `SERIAL` | primary key |
| `username` | `VARCHAR(50)` | unique, not null |
| `email` | `VARCHAR(255)` | unique, not null |
| `password_hash` | `CHAR(60)` | not null; a bcrypt hash is always 60 characters |
| `display_name` | `VARCHAR(100)` | |
| `bio` | `TEXT` | |
| `profile_image_path` | `TEXT` | |
| `created_at` | `TIMESTAMPTZ` | defaults to `now()` |

**`events`**

| Column | Type | Notes |
| --- | --- | --- |
| `event_id` | `SERIAL` | primary key |
| `creator_id` | `INT` | references `users`, deleted along with the user |
| `title` | `VARCHAR(100)` | not null |
| `sport` | `VARCHAR(50)` | not null |
| `description` | `TEXT` | |
| `location_name` | `VARCHAR(200)` | for example, "North Boulder Park" |
| `latitude` | `NUMERIC(9,6)` | not null, between -90 and 90 |
| `longitude` | `NUMERIC(9,6)` | not null, between -180 and 180 |
| `starts_at` | `TIMESTAMPTZ` | not null |
| `ends_at` | `TIMESTAMPTZ` | must be after `starts_at` |
| `max_players` | `INT` | must be greater than 0 |
| `image_path` | `TEXT` | |
| `created_at` | `TIMESTAMPTZ` | defaults to `now()` |

**`event_participants`** (who has joined each event)

| Column | Type | Notes |
| --- | --- | --- |
| `event_id` | `INT` | references `events`, deleted along with the event |
| `user_id` | `INT` | references `users`, deleted along with the user |
| `joined_at` | `TIMESTAMPTZ` | defaults to `now()` |

The primary key is (`event_id`, `user_id`), so nobody can join the same event twice.

**`notifications`**

| Column | Type | Notes |
| --- | --- | --- |
| `notification_id` | `SERIAL` | primary key |
| `user_id` | `INT` | who receives it; references `users` |
| `event_id` | `INT` | optional; references `events` |
| `message` | `TEXT` | not null |
| `is_read` | `BOOLEAN` | defaults to `false` |
| `created_at` | `TIMESTAMPTZ` | defaults to `now()` |

**`session`** (used by `connect-pg-simple`; keep its standard layout)

| Column | Type | Notes |
| --- | --- | --- |
| `sid` | `VARCHAR` | primary key, the session id |
| `sess` | `JSON` | session data, including the logged-in `user_id` |
| `expire` | `TIMESTAMP(6)` | indexed so expired sessions can be cleared quickly |

**Done when:** the server teammate has reviewed these tables and the team agrees on the names.

## Step 2: Build it in Docker

- Write `create.sql` with the tables above, plus the indexes from Step 3.
- Write `insert.sql` with seed data: a few users (with real bcrypt hashes of test passwords), past and upcoming events around Boulder, and some sign-ups and notifications.
- Add a `db` service to `docker-compose.yml` that:
  - uses the official `postgres` image,
  - reads `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` from a `.env` file that is not committed,
  - mounts the SQL files into `/docker-entrypoint-initdb.d` so they run on first start,
  - keeps its data in a named volume.

PostgreSQL only runs the init scripts when the data volume is empty. After changing the schema, rebuild with `docker compose down -v` and then `docker compose up`.

**Done when:** `docker compose up` gives a database that already has every table and the seed data.

## Step 3: Write and test the queries the server needs

| Feature | Query |
| --- | --- |
| Register | insert a user and return `user_id`; a unique violation means the username or email is taken |
| Login | select the user by username; the server checks the password with `bcrypt.compare` |
| Log out | handled by `connect-pg-simple`, which deletes the session row |
| Create event | insert into `events` with `creator_id` set from the session |
| List upcoming events | events where `starts_at > now()`, ordered by time, with participant counts; optional filters by sport or by the map's visible area |
| Event details | one event plus its participants |
| Join event | insert into `event_participants` only while the event is not full |
| Leave event | delete the user's row from `event_participants` |
| Edit or delete event | `WHERE event_id = $1 AND creator_id = $2`, so only the creator's request changes anything |
| Edit profile | `WHERE user_id = $1`, using the id from the session rather than from the form |
| Notifications | insert one, list unread for a user, mark as read |
| Remove past events | delete events that ended before `now()`; the server runs this on a timer |

Indexes to add: `events(starts_at)`, `events(sport)`, and `notifications(user_id, is_read)`.

Test each query against the seed data, including these cases:

- A duplicate username or email is rejected.
- Joining a full event adds no row.
- An edit by someone who isn't the owner changes 0 rows.
- The cleanup query removes past events and leaves upcoming ones.

**Done when:** the queries are written down (in a `queries.sql` file or in the README) and the server teammate has what they need to build the routes.

## Open questions

- When is the next project checkpoint, and which steps have to be finished by then?
- Should sports be free text, or a fixed list kept in a `sports` table?
- Should past events be deleted, or kept so they can still show on profiles?
- Where should uploaded images be stored: a Docker volume or a hosted service?
- Which PostgreSQL version does the course's lab setup use?
