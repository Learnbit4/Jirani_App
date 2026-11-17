# Jirani: Process Documentation

This document records how the project was built, the decisions behind it, how to set it up and run it, how it is tested, the problems met along the way, and what must happen before real users. For what the system is and how it works, see [PROGRAM_DOCUMENTATION.md](PROGRAM_DOCUMENTATION.md).

## Contents

1. [Project summary](#1-project-summary)
2. [How the project was built](#2-how-the-project-was-built)
3. [Decisions: original idea versus what was built](#3-decisions-original-idea-versus-what-was-built)
4. [Setup and run guide](#4-setup-and-run-guide)
5. [Testing process](#5-testing-process)
6. [Issues log](#6-issues-log)
7. [Release readiness checklist](#7-release-readiness-checklist)
8. [Git and GitHub workflow](#8-git-and-github-workflow)
9. [Keeping these documents current](#9-keeping-these-documents-current)

---

## 1. Project summary

| Item | Detail |
|---|---|
| Idea | A swipe-style app that shows people nearby who have a drink to share, for example "Vanessa, under 300 m, has a mzinga of KC Pineapple" |
| Developer | A solo computer science student in Nairobi, working on a Windows laptop and testing on a real Android phone |
| Stack | React Native (Expo), FastAPI (Python), MySQL |
| Current state | Working prototype. Backend, database and app run together on a developer machine. |
| Working title | Jirani (Swahili for "neighbour"). Earlier name: Cheers Nearby. |

## 2. How the project was built

The work went in stages. Each stage ended with something that could be run or checked.

| Stage | What happened | Output |
|---|---|---|
| 1. Idea and risk review | The first spec was reviewed for risk before any code. The main finding: broadcasting the live location of strangers who carry alcohol helps stalkers and robbers as much as drinking buddies. | A list of changes to the spec (section 3) |
| 2. Clickable prototype | A single-page web prototype with six fake profiles validated the screens and flow without a backend. | Prototype used to agree the flow |
| 3. Backend and database | MySQL schema and a FastAPI service: sign-up with a phone code, going live, nearby, swipe, match, block, report. | `schema.sql`, `main.py`, `requirements.txt` |
| 4. Mobile app | React Native app with the same flow, connected to the API. | `App.js`, `api.js` |
| 5. Chat | A `messages` table, two chat endpoints, a chat screen, and a "My matches" button so matches stay reachable after the live status expires. | `chat.sql`, updates to `main.py` and `App.js` |
| 6. Verification | The schema and API were run against a real MySQL 8.0.46 server and exercised end to end. | Bugs found and fixed (section 6) |
| 7. Device testing | Backend on the laptop, app on an Android phone through Expo Go. The developer ran the manual checklist. | App running on a real phone |
| 8. Review fixes | Reading the app code found three gaps: no sign-out, a misleading error for a deleted account, and the Android back button closing the app. | Sign-out button, 401 for missing users, back-button handling |
| 9. Documentation and Git | Program and process documents, README, and a GitHub guide. | This document set |

## 3. Decisions: original idea versus what was built

| Original idea | What was built | Reason |
|---|---|---|
| Show exact distance ("300 metres away") | Distance ranges only ("under 500 m") | Exact numbers plus repeated refreshing let someone work out a person's position. Stalking is hard to undo. |
| Sign up with email and username | Phone number, one-time code, and an 18+ confirmation | Gives a basic real-person check and an age confirmation. Email and a username give neither. |
| Detect location and keep it | Coordinates rounded to about 110 m, kept only while live | A leak of the database should not reveal where someone stood. |
| Every drink the developer knows | About 35 common Kenyan drinks plus an "other" choice in each category | A full catalogue delays launch and few people read it. |
| Free-form quantities | Units people actually say: tot, 250 ml, mzinga, crate | Faster to pick and easier to compare. |
| Show every logged-in user | A 2-hour live status that expires, and you can only see others while you are live too | Limits tracking and stale listings. |
| Distance-sorted list only | "Mixer match" ranking (spirits with soda or juice) | The actual differentiator of the app. |
| No safety features mentioned | Report, block, automatic suspension at 3 reports, meet-in-public message, share-meetup text | Safety is part of the core design. |
| Matches with no way to talk | In-app chat that closes 24 hours after the match, with messages deleted after 7 days | Sharing phone numbers would undo the privacy design. Open-ended chat with strangers is the stalking path. |
| React Native and MySQL | Kept as requested | Developer's choice. MySQL is already familiar from an earlier project. |

## 4. Setup and run guide

A complete runbook for a fresh Windows machine.

### 4.1 Install

- Python 3.10 or newer (tick "Add Python to PATH" in the installer)
- MySQL 8.0.13 or newer (MySQL Installer and MySQL Workbench)
- Node.js 18 or newer, LTS version
- Git for Windows
- On the phone: **Expo Go** from the Play Store

Keep the project outside OneDrive, for example in `C:\dev\Jirani`. OneDrive tries to sync thousands of small dependency files and can lock them.

### 4.2 Create the database

In MySQL Workbench: File, Open SQL Script, choose `backend/schema.sql`, then click the lightning bolt with no cursor on it (run all). Then run `SET GLOBAL event_scheduler = ON;`.

Check: `USE cheers; SHOW TABLES;` lists 9 tables.

If you created the database before chat existed, run `backend/chat.sql` instead of the full schema. Running `schema.sql` twice fails with "table already exists". Use `DROP DATABASE cheers;` first if you want a clean start.

### 4.3 Start the backend

From the `backend` folder in PowerShell:

```
python -m pip install -r requirements.txt
$env:JWT_SECRET="a-long-random-string-of-32-or-more-characters"
$env:DEV_OTP="1"
$env:DB_USER="root"
$env:DB_PASS="your-mysql-password"
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Use `python -m` so that the package is installed into the same Python that runs it. Environment variables last only for that PowerShell window, so set them again in each new window.

Check: `http://localhost:8000/docs` shows the endpoint list. Do not browse to `0.0.0.0`. It is the address the server listens on, not one a browser can open.

### 4.4 Let the phone reach the laptop

1. Phone and laptop on the same Wi-Fi. Turn mobile data off on the phone.
2. Find the laptop's **IPv4 Address** with `ipconfig`, under the Wi-Fi adapter. Not the Default Gateway.
3. On the phone, open `http://<ipv4>:8000/docs`. If it loads, the network is fine.
4. If it does not load, work through: a Windows Firewall rule for port 8000, setting the Wi-Fi profile to Private, checking for a VPN or third-party antivirus firewall, and Wi-Fi that blocks devices from reaching each other (try the phone's hotspot).

Firewall rule, from an Administrator PowerShell:

```
netsh advfirewall firewall add rule name="Jirani 8000" dir=in action=allow protocol=TCP localport=8000
```

A USB alternative that avoids the Wi-Fi: enable USB debugging, install Android platform-tools, run `adb reverse tcp:8000 tcp:8000`, and use `http://localhost:8000` as the API address.

### 4.5 Create and start the app

From `C:\dev`, once:

```
npx create-expo-app@latest app --template blank
cd app
npx expo install expo-location expo-secure-store
```

Replace `App.js` with the project's `App.js` and add `api.js` and `test-api.mjs` beside it. Then, in a second PowerShell window from the `app` folder:

```
$env:EXPO_PUBLIC_API_URL="http://<ipv4>:8000"
npx expo start
```

Scan the QR code from inside Expo Go, not from the phone's camera app. Press `r` in the terminal to reload. If port 8081 is blocked, add a similar firewall rule for 8081 or run `npx expo start --tunnel`.

When the laptop's IP changes (after a restart, or on another network), stop Expo and start it again with the new address.

### 4.6 Get a second user

You need a second live person to see anyone. Open `http://localhost:8000/docs`, then:

1. `POST /auth/request-otp` and `POST /auth/verify-otp` with another phone number, a `first_name` and `confirmed_18: true`. Copy the token.
2. Click **Authorize** and paste the token.
3. `POST /presence` with coordinates within about 300 m of your phone and a drink.
4. In the app, tap Refresh.
5. To test a match: `GET /nearby` as the second user to get your user id, `POST /swipe` with `action: like`, then invite them from the app.
6. To test chat: `POST /chat/{your_id}` as the second user.

## 5. Testing process

| Layer | How | When to run |
|---|---|---|
| Database | Run `schema.sql`; check 9 tables and 2 events | After any schema change |
| Backend | Exercise every endpoint through `/docs` or a test client, including the failure paths (blocked, closed chat, bad phone, no 18+ confirmation, suspended account, deleted user) | After any change to `main.py` |
| API client | `node test-api.mjs` runs the real `api.js` and checks 15 behaviours | After any change to `api.js` or `main.py` |
| App screens | Manual checklist on a real phone | After any change to `App.js` |

**Manual app checklist**

1. Sign up with a name, phone number and the 18+ switch; enter the code
2. Allow location
3. Add a drink and quantity, then go live
4. Create a second live user (section 4.6) and tap Refresh
5. Check the card shows a distance range and no number
6. Invite the second user, get the match, open Messages
7. Send and receive a message (a reply arrives within about 4 seconds)
8. Report or block a user and confirm they disappear
9. Sign out and sign in again
10. Press the Android back button on each screen

**What the checks do not cover:** layout on different phone sizes, the network being down mid-use, a very slow connection, running more than one backend process, and anything about real SMS.

## 6. Issues log

Problems met while building and testing, so that they are not rediscovered.

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | MySQL error 1064 near `UTC_TIMESTAMP()` when running `schema.sql` | MySQL does not accept a bare function as a column default | Wrote `DEFAULT (UTC_TIMESTAMP())` with parentheses in all 8 places. Then ran the full schema on MySQL 8.0.46. |
| 2 | `uvicorn` not recognized in PowerShell | Python's scripts folder is not on the PATH | Run `python -m uvicorn ...` |
| 3 | Browser error `ERR_ADDRESS_INVALID` at `http://0.0.0.0:8000` | `0.0.0.0` is a listening address, not a place a browser can go | Use `http://localhost:8000/docs` or the laptop's IPv4 address |
| 4 | Phone and the laptop's own browser could not reach `http://<ipv4>:8000` while `localhost` worked | A network or firewall setting on the laptop blocked connections to its own Wi-Fi address. The specific cause was not recorded. | Resolved on the laptop. See section 4.4 for the checklist. |
| 5 | `npx expo` not found, then `ERR_PACKAGE_PATH_NOT_EXPORTED` for `metro` | A half-finished earlier install left mismatched package versions in `node_modules` | Renamed the old folder and created a fresh Expo project |
| 6 | `npm audit` reported 21 vulnerabilities after install | Normal for Expo's build tooling | Ignored. `npm audit fix --force` can break the project and was not used. |
| 7 | No way to switch accounts in the app | Missing sign-out button | Added "Sign out" on the Drinks screen |
| 8 | After a database reset, an old login showed "account is suspended" | The backend returned 403 for a user that no longer exists | Returns 401 "Sign in again", which sends the app back to sign-up |
| 9 | Android back button closed the app from chat | No back handler | Added a back handler for chat, Nearby and the code screen |
| 10 | Possible startup error with MySQL 8's default login | PyMySQL needs the `cryptography` package for that login method | Added `cryptography` to `requirements.txt` (preventive; not hit in testing) |

## 7. Release readiness checklist

The prototype is not ready for real users. Each item must be done and checked off first.

**Technical**

- [ ] Real SMS gateway connected; `DEV_OTP` removed
- [ ] HTTPS hosting with a real domain
- [ ] `JWT_SECRET` and database password stored in the host's secret store, not in files
- [ ] Rate limiting moved to Redis
- [ ] Push notifications for matches and messages
- [ ] Database backups and an `event_scheduler` setting that survives restarts
- [ ] Built Android app (EAS Build) tested on several phones and Android versions
- [ ] Error reporting and basic server monitoring

**Safety and moderation**

- [ ] A person reviews suspended accounts and reports, with a written process and response times
- [ ] Support contact visible in the app
- [ ] Tested with a small group of known users in one area before any wider launch
- [ ] Launch in one dense area (a campus, an estate or a street strip) so users see each other

**Legal and store**

- [ ] Kenya Data Protection Act 2019: check with a qualified person whether registration with the Office of the Data Protection Commissioner is required, and what consent wording is needed for location
- [ ] Privacy policy and terms of use
- [ ] Google Play policies on alcohol-related apps reviewed and the app name, description and age rating chosen to match
- [ ] Trademark and domain checks on the final name

## 8. Git and GitHub workflow

**Repository:** one repository holding `backend/`, `app/` and `docs/`. Make it **private** until you have checked that nothing sensitive is in it.

**What never goes in the repository:** passwords, tokens, `.env` files, the `JWT_SECRET`, database dumps with real user data, and `node_modules`. The root `.gitignore` excludes the usual folders and files. Check `git status` before every commit.

**Day-to-day**

```
git status
git add .
git commit -m "Short description of the change"
git push
```

**Branches:** keep `main` working. For anything larger than a small fix, use a branch:

```
git switch -c feature/push-notifications
# work, commit
git push -u origin feature/push-notifications
```

Then open a pull request on GitHub and merge it into `main` once it has been tested.

**Commit messages:** one short line in the present tense that says what changed, for example "Close chat 24 hours after match" or "Fix 401 for deleted users".

**If a secret is committed by mistake:** treat it as exposed. Change the password or secret first, then remove it from the repository history. Deleting it in a later commit does not remove it from history.

## 9. Keeping these documents current

- Change the API, update the API reference in `PROGRAM_DOCUMENTATION.md` in the same commit.
- Change a rule constant (radius, chat window, status length), update the constants table.
- Meet a new problem and solve it, add a row to the issues log.
- Change a decision, update section 3 so the reason is recorded.
- Finish a release checklist item, tick it.
