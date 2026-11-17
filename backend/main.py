"""Cheers Nearby API. Run: uvicorn main:app --reload
Env: JWT_SECRET (required), DB_HOST, DB_USER, DB_PASS, DB_NAME, DEV_OTP=1 (returns OTP in response, dev only)."""
import hashlib, hmac, math, os, re, secrets, time
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Literal

import jwt, pymysql
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

SECRET = os.environ["JWT_SECRET"]
RADIUS_M, STATUS_HOURS, MAX_REPORTS = 2000, 2, 3
DB = dict(host=os.getenv("DB_HOST", "localhost"), user=os.getenv("DB_USER", "root"),
          password=os.getenv("DB_PASS", ""), database=os.getenv("DB_NAME", "cheers"),
          cursorclass=pymysql.cursors.DictCursor, charset="utf8mb4")
app = FastAPI(title="Cheers Nearby API")


@contextmanager
def db():
    conn = pymysql.connect(**DB)
    try:
        with conn.cursor() as cur:
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def now():
    return datetime.utcnow()


def norm_phone(raw: str) -> str:
    p = re.sub(r"[\s-]", "", raw)
    if p.startswith("0"):
        p = "+254" + p[1:]
    elif p.startswith("254"):
        p = "+" + p
    if not re.fullmatch(r"\+254[17]\d{8}", p):
        raise HTTPException(400, "Enter a valid Kenyan phone number.")
    return p


def h(code: str) -> str:
    return hashlib.sha256((code + SECRET).encode()).hexdigest()


def send_sms(phone: str, text: str):
    # TODO: plug in Africa's Talking (or another SMS gateway) here.
    print(f"[SMS to {phone}] {text}")


# ---------- auth ----------
class OtpReq(BaseModel):
    phone: str


class VerifyReq(BaseModel):
    phone: str
    code: str = Field(min_length=6, max_length=6)
    first_name: str | None = Field(None, pattern=r"^[A-Za-z][A-Za-z ’'-]{1,20}$")
    confirmed_18: bool = False


@app.post("/auth/request-otp")
def request_otp(r: OtpReq):
    phone = norm_phone(r.phone)
    with db() as c:
        c.execute("SELECT COUNT(*) n FROM otp_codes WHERE phone=%s AND created_at>%s",
                  (phone, now() - timedelta(hours=1)))
        if c.fetchone()["n"] >= 3:
            raise HTTPException(429, "Too many codes requested. Try again in an hour.")
        code = f"{secrets.randbelow(10**6):06d}"
        c.execute("INSERT INTO otp_codes(phone,code_hash,expires_at) VALUES(%s,%s,%s)",
                  (phone, h(code), now() + timedelta(minutes=5)))
    send_sms(phone, f"Your Cheers Nearby code is {code}. It expires in 5 minutes.")
    return {"sent": True, **({"dev_code": code} if os.getenv("DEV_OTP") == "1" else {})}


@app.post("/auth/verify-otp")
def verify_otp(r: VerifyReq):
    phone = norm_phone(r.phone)
    with db() as c:
        c.execute("SELECT * FROM otp_codes WHERE phone=%s AND used=0 AND expires_at>%s "
                  "ORDER BY id DESC LIMIT 1", (phone, now()))
        otp = c.fetchone()
        if not otp or otp["attempts"] >= 5:
            raise HTTPException(400, "Code expired. Request a new one.")
        c.execute("UPDATE otp_codes SET attempts=attempts+1 WHERE id=%s", (otp["id"],))
        if not hmac.compare_digest(otp["code_hash"], h(r.code)):
            raise HTTPException(400, "Wrong code.")
        c.execute("UPDATE otp_codes SET used=1 WHERE id=%s", (otp["id"],))
        c.execute("SELECT id,status FROM users WHERE phone=%s", (phone,))
        u = c.fetchone()
        if not u:
            if not r.first_name or not r.confirmed_18:
                raise HTTPException(400, "First name and 18+ confirmation are required to sign up.")
            c.execute("INSERT INTO users(phone,first_name,confirmed_18_at) VALUES(%s,%s,%s)",
                      (phone, r.first_name, now()))
            u = {"id": c.lastrowid, "status": "active"}
        if u["status"] != "active":
            raise HTTPException(403, "This account is suspended.")
    token = jwt.encode({"sub": str(u["id"]), "exp": int(time.time()) + 30 * 86400}, SECRET, "HS256")
    return {"token": token}


def me(authorization: str = Header(...)) -> int:
    try:
        uid = int(jwt.decode(authorization.removeprefix("Bearer "), SECRET, ["HS256"])["sub"])
    except Exception:
        raise HTTPException(401, "Sign in again.")
    with db() as c:
        c.execute("SELECT status FROM users WHERE id=%s", (uid,))
        u = c.fetchone()
    if not u:
        raise HTTPException(401, "Sign in again.")
    if u["status"] != "active":
        raise HTTPException(403, "This account is suspended.")
    return uid


# ---------- going live ----------
class Drink(BaseModel):
    category: Literal["alcohol", "wine", "soda"]
    item: str = Field(min_length=1, max_length=40)
    quantity: str = Field(min_length=1, max_length=30)


class GoLive(BaseModel):
    lat: float = Field(ge=-5, le=5.5)       # Kenya bounding box, rough
    lng: float = Field(ge=33.5, le=42)
    note: str | None = Field(None, max_length=60)
    drinks: list[Drink] = Field(min_length=1, max_length=5)


@app.post("/presence")
def go_live(g: GoLive, uid: int = Depends(me)):
    lat, lng = round(g.lat, 3), round(g.lng, 3)   # snap to ~110 m: exact position is never stored
    with db() as c:
        c.execute("REPLACE INTO presence(user_id,lat,lng,note,expires_at) VALUES(%s,%s,%s,%s,%s)",
                  (uid, lat, lng, g.note, now() + timedelta(hours=STATUS_HOURS)))
        c.execute("DELETE FROM presence_drinks WHERE user_id=%s", (uid,))
        c.executemany("INSERT INTO presence_drinks(user_id,category,item,quantity) VALUES(%s,%s,%s,%s)",
                      [(uid, d.category, d.item, d.quantity) for d in g.drinks])
    return {"live_until_hours": STATUS_HOURS}


@app.delete("/presence")
def go_offline(uid: int = Depends(me)):
    with db() as c:
        c.execute("DELETE FROM presence WHERE user_id=%s", (uid,))
    return {"ok": True}


# ---------- discovery ----------
def bucket(m: float) -> str:
    return ("under 300 m" if m < 300 else "under 500 m" if m < 500 else
            "under 1 km" if m < 1000 else "under 2 km")


_hits: dict[int, list[float]] = {}   # per-process; use Redis if you run several workers


def rate_limit(uid: int, limit=40, window=3600):
    t = time.time()
    _hits[uid] = [x for x in _hits.get(uid, []) if t - x < window] + [t]
    if len(_hits[uid]) > limit:
        raise HTTPException(429, "Too many refreshes. Try again later.")  # slows triangulation


@app.get("/nearby")
def nearby(uid: int = Depends(me)):
    rate_limit(uid)
    with db() as c:
        c.execute("SELECT lat,lng FROM presence WHERE user_id=%s AND expires_at>%s", (uid, now()))
        mine = c.fetchone()
        if not mine:
            raise HTTPException(403, "Go live first. You can only see people while you are visible too.")
        lat, lng = float(mine["lat"]), float(mine["lng"])
        dlat = RADIUS_M / 111000
        dlng = RADIUS_M / (111000 * max(math.cos(math.radians(lat)), 0.1))
        c.execute("""
          SELECT u.id, u.first_name, p.note,
                 ST_Distance_Sphere(POINT(p.lng,p.lat), POINT(%s,%s)) AS d
          FROM presence p JOIN users u ON u.id=p.user_id
          WHERE p.expires_at>%s AND p.user_id<>%s AND u.status='active'
            AND p.lat BETWEEN %s AND %s AND p.lng BETWEEN %s AND %s
            AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker=%s AND b.blocked=p.user_id)
                                                      OR (b.blocker=p.user_id AND b.blocked=%s))
            AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.from_user=%s AND s.to_user=p.user_id)
          HAVING d<=%s ORDER BY d LIMIT 30""",
                  (lng, lat, now(), uid, lat - dlat, lat + dlat, lng - dlng, lng + dlng,
                   uid, uid, uid, RADIUS_M))
        people = c.fetchall()
        ids = [p["id"] for p in people] + [uid]
        c.execute("SELECT user_id,category,item,quantity FROM presence_drinks WHERE user_id IN (%s)"
                  % ",".join(["%s"] * len(ids)), ids)
        drinks: dict[int, list] = {}
        for r in c.fetchall():
            drinks.setdefault(r["user_id"], []).append(r)
    my_cats = {d["category"] for d in drinks.get(uid, [])}
    out = []
    for p in people:
        theirs = drinks.get(p["id"], [])
        cats = {d["category"] for d in theirs}
        mixer = ("alcohol" in my_cats and "soda" in cats) or ("soda" in my_cats and "alcohol" in cats)
        out.append({"user_id": p["id"], "first_name": p["first_name"], "note": p["note"],
                    "distance": bucket(p["d"]), "mixer_match": mixer,   # exact distance never leaves the server
                    "drinks": [{k: d[k] for k in ("category", "item", "quantity")} for d in theirs]})
    out.sort(key=lambda x: not x["mixer_match"])   # stable: keeps distance order inside each group
    return out


class SwipeReq(BaseModel):
    to_user: int
    action: Literal["like", "pass"]


@app.post("/swipe")
def swipe(s: SwipeReq, uid: int = Depends(me)):
    with db() as c:
        c.execute("SELECT 1 FROM presence WHERE user_id=%s AND expires_at>%s", (s.to_user, now()))
        if not c.fetchone():
            raise HTTPException(404, "That person is no longer live.")
        c.execute("INSERT IGNORE INTO swipes(from_user,to_user,action) VALUES(%s,%s,%s)",
                  (uid, s.to_user, s.action))
        if s.action != "like":
            return {"matched": False}
        c.execute("SELECT 1 FROM swipes WHERE from_user=%s AND to_user=%s AND action='like'",
                  (s.to_user, uid))
        if not c.fetchone():
            return {"matched": False}
        a, b = sorted((uid, s.to_user))
        c.execute("INSERT IGNORE INTO matches(user_a,user_b) VALUES(%s,%s)", (a, b))
    return {"matched": True}


@app.get("/matches")
def matches(uid: int = Depends(me)):
    with db() as c:
        c.execute("""SELECT u.id user_id, u.first_name, m.created_at FROM matches m
                     JOIN users u ON u.id = IF(m.user_a=%s, m.user_b, m.user_a)
                     WHERE (m.user_a=%s OR m.user_b=%s) AND u.status='active'
                       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker=%s AND b.blocked=u.id)
                     ORDER BY m.created_at DESC""", (uid, uid, uid, uid))
        return c.fetchall()   # phone numbers are never shared; add in-app chat next


# ---------- safety ----------
class BlockReq(BaseModel):
    user_id: int


class ReportReq(BaseModel):
    user_id: int
    reason: str = Field(min_length=3, max_length=200)


@app.post("/block")
def block(b: BlockReq, uid: int = Depends(me)):
    with db() as c:
        c.execute("INSERT IGNORE INTO blocks(blocker,blocked) VALUES(%s,%s)", (uid, b.user_id))
    return {"ok": True}


@app.post("/report")
def report(r: ReportReq, uid: int = Depends(me)):
    with db() as c:
        c.execute("INSERT IGNORE INTO reports(reporter,reported,reason) VALUES(%s,%s,%s)",
                  (uid, r.user_id, r.reason))
        c.execute("INSERT IGNORE INTO blocks(blocker,blocked) VALUES(%s,%s)", (uid, r.user_id))
        c.execute("SELECT COUNT(*) n FROM reports WHERE reported=%s", (r.user_id,))
        if c.fetchone()["n"] >= MAX_REPORTS:   # auto-suspend pending human review
            c.execute("UPDATE users SET status='suspended' WHERE id=%s", (r.user_id,))
            c.execute("DELETE FROM presence WHERE user_id=%s", (r.user_id,))
    return {"ok": True}


# ---------- chat ----------
CHAT_HOURS = 24            # chat closes this long after the match
_msg_hits: dict[int, list[float]] = {}


def msg_limit(uid: int, limit=30, window=60):
    t = time.time()
    _msg_hits[uid] = [x for x in _msg_hits.get(uid, []) if t - x < window] + [t]
    if len(_msg_hits[uid]) > limit:
        raise HTTPException(429, "You’re sending messages too fast.")


def chat_guard(c, uid: int, other: int):
    a, b = sorted((uid, other))
    c.execute("SELECT created_at FROM matches WHERE user_a=%s AND user_b=%s", (a, b))
    m = c.fetchone()
    if not m:
        raise HTTPException(404, "You have no match with this person.")
    c.execute("SELECT 1 FROM blocks WHERE (blocker=%s AND blocked=%s) OR (blocker=%s AND blocked=%s)",
              (uid, other, other, uid))
    if c.fetchone():
        raise HTTPException(403, "Chat is unavailable.")
    c.execute("SELECT status FROM users WHERE id=%s", (other,))
    u = c.fetchone()
    if not u or u["status"] != "active":
        raise HTTPException(403, "Chat is unavailable.")
    return a, b, now() < m["created_at"] + timedelta(hours=CHAT_HOURS)


@app.get("/chat/{other}")
def get_chat(other: int, uid: int = Depends(me)):
    with db() as c:
        a, b, is_open = chat_guard(c, uid, other)
        c.execute("""SELECT id, sender, body, created_at FROM (
                       SELECT * FROM messages WHERE user_a=%s AND user_b=%s ORDER BY id DESC LIMIT 200
                     ) t ORDER BY id""", (a, b))
        msgs = [{"id": r["id"], "mine": r["sender"] == uid, "body": r["body"],
                 "created_at": r["created_at"]} for r in c.fetchall()]
    return {"open": is_open, "messages": msgs}


class MsgReq(BaseModel):
    body: str = Field(min_length=1, max_length=500)


@app.post("/chat/{other}")
def send_chat(other: int, m: MsgReq, uid: int = Depends(me)):
    msg_limit(uid)
    with db() as c:
        a, b, is_open = chat_guard(c, uid, other)
        if not is_open:
            raise HTTPException(403, f"This chat has closed. Chats last {CHAT_HOURS} hours after a match.")
        c.execute("INSERT INTO messages(user_a,user_b,sender,body) VALUES(%s,%s,%s,%s)",
                  (a, b, uid, m.body.strip()))
    return {"ok": True}
