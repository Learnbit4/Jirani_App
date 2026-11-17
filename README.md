# Jirani

A mobile app that shows people nearby who have a drink to share. A user signs up with a phone number, lists what they have (drink and quantity), goes live for two hours, and swipes through people close by. Two people who both swipe right match and can chat for 24 hours.

> **Status: working prototype.** The backend, database and Android app run end to end on a developer machine.
>
> *Working title.* Earlier versions were called "Cheers Nearby". Some text in the code (the SMS message, the API title, the database name `cheers`) still uses that name.

## Features

- Sign-up with a Kenyan phone number, a one-time code and an 18+ confirmation
- Drink picker with about 35 Kenyan drinks in three categories (alcohol, wine, soda or juice) and quantities such as tot, 250 ml, mzinga (750 ml) and crate
- A 2-hour "live" status that expires on its own
- Nearby list sorted by distance, shown only as ranges ("under 500 m"), with a "Mixer match" badge when one person has a spirit and the other has soda or juice
- Swipe to invite or pass, matches, and an in-app chat that closes 24 hours after the match
- Report and block, with automatic suspension after three reports

## How it fits together

```
 Android phone (Expo Go)            Laptop or server
┌──────────────────────┐  HTTP    ┌────────────────────┐        ┌───────────┐
│ React Native app     │ ───────► │ FastAPI backend    │ ─────► │ MySQL 8   │
│ App.js + api.js      │ ◄─────── │ main.py            │ ◄───── │ schema    │
└──────────────────────┘   JSON   └────────────────────┘        └───────────┘
```

## Repository layout

```
Jirani/
├── README.md
├── .gitignore
├── docs/
│   ├── PROGRAM_DOCUMENTATION.md   what the system is and how it works
│   └── PROCESS_DOCUMENTATION.md   how it was built, tested and run
├── backend/
│   ├── main.py                    API
│   ├── schema.sql                 database (fresh install)
│   ├── chat.sql                   chat table only (for databases created before chat existed)
│   └── requirements.txt
└── app/                           Expo (React Native) project
    ├── App.js
    ├── api.js
    ├── test-api.mjs               automated check of api.js against a running backend
    ├── app.json
    └── package.json
```

## Requirements

| Tool | Version |
|---|---|
| Python | 3.10 or newer |
| MySQL | 8.0.13 or newer |
| Node.js | 18 or newer (LTS recommended) |
| Expo Go | latest, from the Play Store |

## Quick start

**1. Database**

```
mysql -u root -p < backend/schema.sql
```

Then, inside MySQL: `SET GLOBAL event_scheduler = ON;`

**2. Backend** (from the `backend` folder, PowerShell)

```
pip install -r requirements.txt
$env:JWT_SECRET="a-long-random-string-of-32-or-more-characters"
$env:DEV_OTP="1"
$env:DB_USER="root"
$env:DB_PASS="your-mysql-password"
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000/docs` to see the interactive API page.

**3. App** (from the `app` folder, in a second window)

```
npm install
npx expo install expo-location expo-secure-store
$env:EXPO_PUBLIC_API_URL="http://<your-laptop-ipv4>:8000"
npx expo start
```

Scan the QR code with **Expo Go**. Phone and laptop must be on the same Wi-Fi.

**4. Check the API client**

```
$env:EXPO_PUBLIC_API_URL="http://localhost:8000"
node test-api.mjs
```

## Documentation

- [Program documentation](docs/PROGRAM_DOCUMENTATION.md): architecture, database, API reference, app, security design, limitations
- [Process documentation](docs/PROCESS_DOCUMENTATION.md): how it was built, decisions, setup runbook, testing, issues log, release checklist, Git workflow

## Safety by design

Meeting strangers who carry alcohol carries real risk, so these controls are part of the core design and not extras:

- Others see a distance range, never an exact distance, a map pin or a street
- Coordinates are rounded to about 110 m before they are stored
- A user can only see others while they are live themselves
- Status expires after 2 hours; chat closes after 24 hours; messages are deleted after 7 days
- Phone numbers are never shown to other users
- Report and block are on every card and in every chat

## Configuration and secrets

Secrets are read from environment variables and are never stored in the repository. Do not commit passwords, `.env` files or tokens. `DEV_OTP=1` returns sign-up codes in the API response and must never be set on a server that real users can reach.

## Licence

No licence has been chosen yet, so all rights are reserved by default.
