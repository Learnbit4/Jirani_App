# Jirani: Program Documentation

This document describes what the system is and how it works. For how it was built, tested and run, see [PROCESS_DOCUMENTATION.md](PROCESS_DOCUMENTATION.md).

## Contents

1. [Purpose and scope](#1-purpose-and-scope)
2. [Architecture](#2-architecture)
3. [Technology stack](#3-technology-stack)
4. [Repository structure](#4-repository-structure)
5. [Configuration](#5-configuration)
6. [Database](#6-database)
7. [API reference](#7-api-reference)
8. [Mobile app](#8-mobile-app)
9. [Security and privacy design](#9-security-and-privacy-design)
10. [Testing](#10-testing)
11. [Known limitations and next steps](#11-known-limitations-and-next-steps)
12. [Glossary](#12-glossary)

---

## 1. Purpose and scope

Jirani helps people who are out with a drink find others nearby who have something to share. A user lists what they have, goes live for two hours, sees others nearby as distance ranges, and swipes. Two people who both like each other get a match and a 24-hour chat.

**In scope:** phone sign-up, drink listing, live status, nearby discovery, swipe and match, chat, report and block.

**Out of scope for this version:** real SMS delivery, push notifications, photos, an iOS build, payments, venue suggestions, an admin panel.

## 2. Architecture

```
Android phone (Expo Go)        Backend host                  Database
┌──────────────────────┐       ┌────────────────────┐        ┌──────────┐
│ App.js  (screens)    │ HTTP  │ main.py (FastAPI)  │  SQL   │ MySQL 8  │
│ api.js  (HTTP client)│◄─────►│ JSON endpoints     │◄──────►│ 9 tables │
│ SecureStore (token)  │ JSON  │ JWT auth           │        │ 2 events │
└──────────────────────┘       └────────────────────┘        └──────────┘
```

- The app never talks to the database. Every action goes through the API.
- The API is stateless apart from two in-memory rate limiters (see section 11).
- All times are stored in UTC.

**Typical flow:** sign up and verify the code, receive a token, allow location, add drinks, go live, load nearby, swipe, match, chat.

## 3. Technology stack

| Layer | Choice | Notes |
|---|---|---|
| Mobile app | React Native with Expo | Run in Expo Go during development |
| App libraries | `expo-location`, `expo-secure-store` | Location permission and token storage |
| Backend | Python 3.10+ with FastAPI and Uvicorn | `pydantic` v2 validates requests |
| Auth | JSON Web Tokens (`PyJWT`), HS256 | 30-day expiry |
| Database | MySQL 8.0.13 or newer | Needs expression defaults and `ST_Distance_Sphere` |
| DB driver | `PyMySQL` plus `cryptography` | `cryptography` is needed for MySQL 8 password login |

## 4. Repository structure

```
Jirani/
├── README.md
├── docs/            PROGRAM_DOCUMENTATION.md, PROCESS_DOCUMENTATION.md
├── backend/         main.py, schema.sql, chat.sql, requirements.txt
└── app/             App.js, api.js, test-api.mjs, app.json, package.json
```

## 5. Configuration

### Backend environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `JWT_SECRET` | Yes | none | Signs login tokens and hashes one-time codes. Use 32 or more random characters. The server will not start without it. |
| `DB_HOST` | No | `localhost` | MySQL host |
| `DB_USER` | No | `root` | MySQL user |
| `DB_PASS` | No | empty | MySQL password |
| `DB_NAME` | No | `cheers` | Database name |
| `DEV_OTP` | No | unset | When `1`, the one-time code is also returned in the API response. **Development only.** |

### App environment variable

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Base URL of the backend, for example `http://192.168.0.104:8000`. Read when Expo starts, so set it before `npx expo start`. |

### Business rule constants

| Constant | Value | Location |
|---|---|---|
| Nearby radius | 2000 m | `main.py` `RADIUS_M` |
| Live status length | 2 hours | `main.py` `STATUS_HOURS` |
| Reports that trigger suspension | 3 | `main.py` `MAX_REPORTS` |
| Chat window after a match | 24 hours | `main.py` `CHAT_HOURS` |
| Drinks per user | 1 to 5 | `GoLive` model |
| One-time code | 6 digits, valid 5 minutes, 5 attempts, 3 requests per phone per hour | `request_otp`, `verify_otp` |
| Nearby refreshes | 40 per hour per user | `rate_limit` |
| Chat messages | 30 per minute per user, 500 characters each | `msg_limit`, `MsgReq` |
| Location precision | 3 decimal places (about 110 m) | `go_live` |
| Accepted coordinates | latitude -5 to 5.5, longitude 33.5 to 42 | `GoLive` model |
| Message retention | 7 days | MySQL event `purge_messages` |

## 6. Database

Database name: `cheers` (kept from the earlier working title). Create it with `backend/schema.sql`. All timestamps are UTC.

### Tables

| Table | Purpose | Key columns |
|---|---|---|
| `users` | One row per account | `phone` (unique, E.164, never returned by the API), `first_name`, `confirmed_18_at`, `status` (`active` or `suspended`) |
| `otp_codes` | One-time sign-in codes | `phone`, `code_hash` (SHA-256 with the secret), `expires_at`, `attempts`, `used` |
| `presence` | Who is live right now | `user_id` (primary key), `lat`, `lng` (rounded), `note`, `expires_at` |
| `presence_drinks` | Drinks for a live user | `user_id`, `category` (`alcohol`, `wine`, `soda`), `item`, `quantity` |
| `swipes` | Every like or pass | `from_user`, `to_user`, `action`. Primary key on the pair. |
| `matches` | Mutual likes | `user_a` (smaller id), `user_b`, `created_at` |
| `blocks` | Who blocked whom | `blocker`, `blocked` |
| `reports` | Reports against users | `reporter`, `reported`, `reason`. One report per pair. |
| `messages` | Chat messages | `user_a`, `user_b`, `sender`, `body`, `created_at` |

Deleting a user deletes their rows in every table. Deleting a `presence` row deletes its `presence_drinks`.

### Scheduled events

| Event | Runs | Does |
|---|---|---|
| `purge_presence` | every 10 minutes | Deletes expired `presence` rows |
| `purge_messages` | every hour | Deletes messages older than 7 days |

Events run only when the scheduler is on: `SET GLOBAL event_scheduler = ON;`. The setting resets when MySQL restarts unless it is also set in the server configuration. The API checks `expires_at` on every request, so expired users are hidden even if the scheduler is off.

### Distance

`/nearby` uses `ST_Distance_Sphere(POINT(lng, lat), POINT(lng, lat))`, which returns metres. A bounding box on latitude and longitude filters rows before the exact distance is computed. The distance is converted to a range on the server and the number is never sent.

## 7. API reference

Base URL: `http://<host>:8000`. Interactive documentation is at `/docs` when the server runs.

**Authentication:** all endpoints except `/auth/*` need the header `Authorization: Bearer <token>`. A missing or invalid token returns 401. A suspended account returns 403.

**Errors:** a failed request returns a status code and `{"detail": "message"}`. A malformed body returns 422.

### Auth

| Method and path | Body | Success response | Errors |
|---|---|---|---|
| `POST /auth/request-otp` | `{ "phone": "0712345678" }` | `{ "sent": true }` plus `dev_code` when `DEV_OTP=1` | 400 invalid Kenyan number; 429 more than 3 requests in an hour |
| `POST /auth/verify-otp` | `{ "phone", "code" (6 digits), "first_name", "confirmed_18" }` | `{ "token": "..." }` | 400 wrong or expired code, or name and 18+ confirmation missing for a new account; 403 suspended |

Phone numbers are normalised to `+254...`. `first_name` and `confirmed_18` are required only the first time a number signs up. `first_name` is 2 to 21 letters, spaces, hyphens or apostrophes.

### Presence

| Method and path | Body | Success response | Errors |
|---|---|---|---|
| `POST /presence` | `{ "lat", "lng", "note" (optional, 60 characters), "drinks": [ { "category", "item", "quantity" } ] }` | `{ "live_until_hours": 2 }` | 422 invalid coordinates or drinks |
| `DELETE /presence` | none | `{ "ok": true }` | none |

Going live again replaces the previous status and drinks.

### Discovery

| Method and path | Success response | Errors |
|---|---|---|
| `GET /nearby` | List of up to 30 people within 2 km: `user_id`, `first_name`, `note`, `distance` (one of "under 300 m", "under 500 m", "under 1 km", "under 2 km"), `mixer_match` (true or false), `drinks` | 403 if the caller is not live; 429 after 40 calls in an hour |
| `POST /swipe` | `{ "matched": true or false }` for body `{ "to_user", "action": "like" or "pass" }` | 404 if the other person is no longer live |
| `GET /matches` | List of `user_id`, `first_name`, `created_at` | none |

`/nearby` leaves out the caller, expired users, suspended users, anyone blocked in either direction and anyone the caller already swiped on. People with a mixer match come first, then by distance.

### Chat

| Method and path | Body | Success response | Errors |
|---|---|---|---|
| `GET /chat/{user_id}` | none | `{ "open": true or false, "messages": [ { "id", "mine", "body", "created_at" } ] }`, the last 200 messages | 404 no match; 403 blocked or unavailable |
| `POST /chat/{user_id}` | `{ "body": "1 to 500 characters" }` | `{ "ok": true }` | 403 chat closed (24 hours after the match) or unavailable; 404 no match; 429 more than 30 messages a minute |

### Safety

| Method and path | Body | Effect |
|---|---|---|
| `POST /block` | `{ "user_id" }` | Hides both users from each other and closes chat |
| `POST /report` | `{ "user_id", "reason" (3 to 200 characters) }` | Records the report and blocks the user. On the third report from different users, the account is suspended and removed from view. |

## 8. Mobile app

### Files

| File | Role |
|---|---|
| `App.js` | All screens, state and the drink catalogue |
| `api.js` | One function, `api(path, { method, body, token })`. It adds the JSON headers and bearer token, parses the response, and throws an `Error` with `.message` (readable text) and `.status` (HTTP code). A network failure throws "Cannot reach the server." |
| `test-api.mjs` | Command-line check of `api.js` against a running backend |

### Screens

| Screen | What it does |
|---|---|
| Boot | Reads the saved token. Goes to Drinks if one exists, otherwise to Sign-up. |
| Sign-up | First name, phone number, 18+ switch. Requests a code. |
| Code | Enter the 6-digit code. In development with `DEV_OTP=1`, the code appears in an alert. |
| Location | Explains what is shared and asks for the location permission. |
| Drinks | Pick a category, drink and quantity (up to 5 drinks), add an optional note, then go live. Also "My matches" and "Sign out". |
| Nearby | One card at a time with a distance range and drinks. Invite, pass, or report or block. Tabs for Nearby and Matches. |
| Matches | Each match has a place box and a "Share meetup with a friend" button, plus "Message". |
| Chat | Message bubbles, a text box, Report or block, Back. Polls every 4 seconds. |

### Behaviour worth knowing

- The token is kept in `expo-secure-store`. A 401 response clears it and returns to sign-up.
- A 403 from `/nearby` means the live status ended, so the app returns to the Drinks screen.
- Going live asks for the location permission again if needed, reads the position once, and sends it. The app never sends location in the background.
- Distances are shown exactly as the server returns them.
- The Android back button goes back inside the app: chat to Nearby, Nearby to Drinks, Code to Sign-up. From Drinks or Sign-up it exits.
- "Share meetup with a friend" opens the phone's share sheet with a text message naming the person and the place.
- The app follows the phone's light or dark setting.

### Drink catalogue

Defined at the top of `App.js` in `CATS`. Quantities for alcohol: 1 tot, 250 ml, 350 ml, 500 ml, mzinga (750 ml), 1 litre, crate. For wine: 1 glass, 750 ml bottle, 1 litre box, 2 bottles. For soda or juice: 300 ml, 500 ml, 1 litre, 2 litres, crate. The backend accepts any text up to 40 characters for the drink and 30 for the quantity, so the catalogue can change without a backend change.

## 9. Security and privacy design

| Risk | Control |
|---|---|
| Stalking through exact distance | Only ranges are returned. Coordinates never leave the server. |
| A leaked database revealing where someone stood | Coordinates are rounded to about 110 m before they are stored, and live rows expire. |
| Triangulating a position by refreshing | 40 refreshes per hour per user; ranges instead of numbers. |
| Watching people without being visible | `/nearby` returns 403 unless the caller is live too. |
| Fake or underage accounts | Phone verification and an 18+ confirmation that is stored with a timestamp. This is a confirmation, not proof of age. |
| Guessing sign-in codes | Codes are hashed, expire in 5 minutes, allow 5 attempts, and are limited to 3 requests per phone per hour. |
| Phone numbers exposed to other users | No endpoint returns a phone number. |
| Harassment | Block and report everywhere, and automatic suspension at 3 reports from different users. |
| Open-ended contact with strangers | Chat closes 24 hours after the match and messages are deleted after 7 days. |
| Secrets in the repository | Secrets come from environment variables only. `.gitignore` excludes `.env` files. |
| Meeting somewhere unsafe | The app tells matched users to meet in a public place and offers a share-with-a-friend message. |

## 10. Testing

| Level | What exists | Result when last run |
|---|---|---|
| Database | `schema.sql` run on MySQL 8.0.46 | All 9 tables and both events created |
| Backend | End-to-end run through a test client: sign-up, live, nearby, swipe, match, chat, block, report and auto-suspend, 24-hour chat closing, deleted-user token returns 401 | All passed |
| API client | `app/test-api.mjs` runs the real `api.js` against a live backend and checks 15 behaviours | All 15 passed |
| App screens | Manual checklist on a real Android phone through Expo Go | Run by the developer; no automated screen tests exist |

Run the API client check with the backend running (and `DEV_OTP=1`):

```
$env:EXPO_PUBLIC_API_URL="http://localhost:8000"
node test-api.mjs
```

## 11. Known limitations and next steps

**Limitations**

- **No real SMS.** `send_sms` prints the code to the server log. A gateway such as Africa's Talking must be connected before real users can sign up.
- **Rate limits are in memory.** They reset when the server restarts and do not work across several server processes. Move them to Redis.
- **No HTTPS.** The development setup uses plain HTTP. A real release needs HTTPS and a built app instead of Expo Go.
- **Chat uses polling,** which delays messages by up to 4 seconds and uses battery. Push notifications (for example Firebase) would replace it.
- **Age is confirmed, not verified.**
- **Moderation is automatic only.** Suspended accounts need a human review process that does not exist yet.
- **The report reason from the app is a fixed text.** The API accepts a free-text reason.
- **No automated tests for the app screens.**
- **Naming.** Some strings still say "Cheers Nearby" and the database is named `cheers`.
- **DEV_OTP** must stay off anywhere real users can reach.

**Next steps, in rough priority order**

1. Real SMS gateway and HTTPS hosting
2. Redis-backed rate limiting
3. Push notifications for new matches and messages
4. A moderation process and an admin view of reports
5. Legal and store review: Kenya's Data Protection Act 2019 (whether registration with the Office of the Data Protection Commissioner is required), Google Play's alcohol-related policies, a privacy policy and terms of use
6. Venue suggestions after a match
7. A built Android app (EAS Build) for testers outside Expo Go

## 12. Glossary

| Term | Meaning |
|---|---|
| Mzinga | A 750 ml bottle, as used in the app's quantities |
| Tot | A single measure of spirits |
| Live | A user whose status has not expired and who can see and be seen |
| Mixer match | One person has alcohol and the other has soda or juice |
| OTP | One-time password, the 6-digit sign-in code |
| Bucket or range | The distance text such as "under 500 m" |
| Expo Go | The Play Store app that runs the app during development |
