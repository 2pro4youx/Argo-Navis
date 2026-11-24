#!/usr/bin/env python3
"""
argo_sim.py - the "outside world" for the Argo Navis emergency-layer demo.
Python standard library only. Nothing to install.

  python argo_sim.py server            # alert gateway + rescue control room (open http://localhost:8000)
  python argo_sim.py device            # reference device: same logic the Android app must implement
  python argo_sim.py shelters --lat 23.1 --lon 77.4   # test/warm the real-shelter + walking-route lookup

SERVER  = stands in for the government / telecom alert source AND the rescue control room.
DEVICE  = a terminal "phone" that verifies signatures, checks the region, runs the check-in
          timer and escalates. Use it to test the server without Android, and as the fallback
          demo if the emulator misbehaves. The Android app talks to the same HTTP endpoints.
"""
import argparse
import hashlib
import hmac
import json
import math
import threading
from pathlib import Path
import time
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = b"argo-demo-shared-secret"  # DEMO ONLY. A real system uses asymmetric signatures, key in secure hardware.
OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
SHELTER_CACHE = Path("data/shelters_cache.json")
ROUTE_CACHE = Path("data/routes_cache.json")
# Free walking routes from the FOSSGIS OSRM demo server (OpenStreetMap data). Fair use: ~1 request/second.
ROUTING_URL = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/{lo1},{la1};{lo2},{la2}?overview=full&geometries=geojson"
WALK_KMH = 5.0
# OpenStreetMap amenity -> label. These are REAL buildings near the user, used as candidate shelters.
# They are not officially designated relief camps; production would use the state SDMA shelter list.
SHELTER_TAGS = {"community_centre": "Community Hall", "townhall": "Town Hall", "school": "School",
                "college": "College", "university": "University", "place_of_worship": "Place of Worship",
                "hospital": "Hospital"}
RESERVE_PCT = 5                      # battery share reserved for the emergency layer (simulated)

CITIES = {"Bhopal": (23.2599, 77.4126), "Chennai": (13.0827, 80.2707),
          "Visakhapatnam": (17.6868, 83.2185), "Guwahati": (26.1445, 91.7362)}
SHELTER_OFFSETS = [(0.012, 0.009, "Govt. Higher Secondary School Relief Camp (demo)", 400),
                   (-0.015, 0.006, "Community Hall Shelter (demo)", 250),
                   (0.004, -0.018, "District Stadium Shelter (demo)", 1200)]
PROTOCOL_NOTE = "SAMPLE TEXT for the demo. Replace with the official NDMA / state SDMA guidelines."
PROTOCOLS = {
    "CYCLONE": ["Move to the nearest cyclone shelter now; do not wait for landfall.",
                "Carry ID, medicines, drinking water, a torch and a charged power bank.",
                "Switch off gas and electricity before you leave.",
                "Stay inside the shelter until the official all-clear."],
    "FLOOD": ["Move to higher ground or the nearest relief camp immediately.",
              "Do not walk or drive through flowing water.",
              "Switch off electricity at the mains if it is safe to do so.",
              "Stay at the shelter until the all-clear."],
    "TSUNAMI": ["Move immediately to high ground or as far inland as you can.",
                "Do not go to the shore to look; waves can arrive in several surges.",
                "Go on foot if roads are jammed.",
                "Stay away from the coast until officials say it is safe."],
    "EARTHQUAKE": ["Drop, cover and hold on until the shaking stops.",
                   "Then move to open ground, away from buildings and power lines.",
                   "Expect aftershocks; do not re-enter damaged buildings.",
                   "Go to the nearest shelter if your home is unsafe."],
    "WILDFIRE": ["Leave now along the designated route, away from the fire.",
                 "Close windows and doors behind you; wear a mask or wet cloth.",
                 "Do not return until authorities allow it.",
                 "Go to the nearest shelter and register your arrival."],
}

LOCK = threading.Lock()
STATE = {"alert": None, "devices": {}, "events": []}


# ------------------------------------------------------------ signing ----
def sign(payload: str) -> str:
    return hmac.new(SECRET, payload.encode("utf-8"), hashlib.sha256).hexdigest()


def verify(alert: dict) -> bool:
    return hmac.compare_digest(sign(alert["payload"]), alert.get("sig", ""))


def verify_clear(alert: dict) -> bool:
    aid = json.loads(alert["payload"])["alert_id"]
    return hmac.compare_digest(sign(f"{aid}|CLEARED"), alert.get("clear_sig", ""))


def _demo_shelters(lat, lon):
    return [{"name": n, "lat": round(lat + dy, 5), "lon": round(lon + dx, 5), "kind": "Demo shelter",
             "distance_km": round(haversine_km(lat, lon, lat + dy, lon + dx), 2)}
            for dy, dx, n, c in SHELTER_OFFSETS]


def fetch_overpass(lat, lon, radius_m):
    """Real buildings around a point from OpenStreetMap (no signup, no key)."""
    amen = "|".join(SHELTER_TAGS)
    q = (f'[out:json][timeout:25];(nwr["amenity"~"^({amen})$"]["name"](around:{radius_m},{lat},{lon}););'
         "out center 80;")
    last = None
    for url in OVERPASS_URLS:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(),
                                         headers={"User-Agent": "ArgoNavis-Hackathon/1.0"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read())["elements"]
        except Exception as e:
            last = e
    raise RuntimeError(f"Overpass unreachable: {last}")


def pick_shelters(elements, lat, lon, n=5, max_per_kind=2):
    cands = []
    for el in elements:
        tags = el.get("tags") or {}
        kind = SHELTER_TAGS.get(tags.get("amenity"))
        c = el.get("center") or el
        la, lo = c.get("lat"), c.get("lon")
        if kind and tags.get("name") and la is not None and lo is not None:
            cands.append((haversine_km(lat, lon, la, lo), tags["name"].strip(), kind, la, lo))
    cands.sort()
    out, counts, seen = [], {}, set()
    for d, name, kind, la, lo in cands:
        if name.lower() in seen or counts.get(kind, 0) >= max_per_kind:
            continue
        seen.add(name.lower())
        counts[kind] = counts.get(kind, 0) + 1
        out.append({"name": f"{name[:34]} ({kind})", "lat": round(la, 5), "lon": round(lo, 5),
                    "kind": kind, "distance_km": round(d, 2)})
        if len(out) == n:
            break
    return out


def find_shelters(lat, lon, n=5):
    """Nearest real buildings. Cached on disk; falls back to demo shelters if offline."""
    key = f"{lat:.3f},{lon:.3f}"
    try:
        cache = json.loads(SHELTER_CACHE.read_text())
    except Exception:
        cache = {}
    if key in cache:
        return cache[key], "OpenStreetMap (cached)"
    try:
        found = []
        for radius in (2500, 6000, 15000):
            found = pick_shelters(fetch_overpass(lat, lon, radius), lat, lon, n)
            if len(found) >= 3:
                break
        if not found:
            raise RuntimeError("no named buildings found nearby")
        cache[key] = found
        SHELTER_CACHE.parent.mkdir(parents=True, exist_ok=True)
        SHELTER_CACHE.write_text(json.dumps(cache, indent=1))
        return found, "OpenStreetMap"
    except Exception as e:
        print(f"[shelters] lookup failed ({e}); using demo shelters", flush=True)
        return _demo_shelters(lat, lon), "DEMO shelters (offline fallback)"


def _thin(pts, n):
    if len(pts) <= n:
        return pts
    step = (len(pts) - 1) / (n - 1)
    return [pts[round(i * step)] for i in range(n)]


def fetch_route(la1, lo1, la2, lo2):
    req = urllib.request.Request(ROUTING_URL.format(la1=la1, lo1=lo1, la2=la2, lo2=lo2),
                                 headers={"User-Agent": "ArgoNavis-Hackathon/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        rt = json.loads(r.read())["routes"][0]
    pts = [[round(la, 5), round(lo, 5)] for lo, la in rt["geometry"]["coordinates"]]
    km = rt["distance"] / 1000
    return {"route": _thin(pts, 70), "route_km": round(km, 2), "route_min": round(km / WALK_KMH * 60)}


def attach_routes(center, shelters, max_n=3):
    """Add a walking route to the nearest shelters. Cached; silently skipped if offline."""
    try:
        cache = json.loads(ROUTE_CACHE.read_text())
    except Exception:
        cache = {}
    out, dirty, last_call, online = [], False, 0.0, True
    for i, sh in enumerate(shelters):
        sh = dict(sh)
        if i < max_n:
            key = f"{center[0]:.4f},{center[1]:.4f}>{sh['lat']:.5f},{sh['lon']:.5f}"
            info = cache.get(key)
            if info is None and online:
                wait = 1.1 - (time.time() - last_call)
                if wait > 0:
                    time.sleep(wait)
                try:
                    info = fetch_route(center[0], center[1], sh["lat"], sh["lon"])
                    cache[key], dirty = info, True
                except Exception as e:
                    print(f"[routes] unavailable ({e}); the app will draw straight lines", flush=True)
                    online, info = False, None
                last_call = time.time()
            sh.update(info or {})
        out.append(sh)
    if dirty:
        ROUTE_CACHE.parent.mkdir(parents=True, exist_ok=True)
        ROUTE_CACHE.write_text(json.dumps(cache))
    return out


def make_alert(place, atype, severity, radius_km, interval_s, forged=False,
               center=None, shelters=None, shelter_source="demo"):
    lat, lon = center or CITIES.get(place, CITIES["Bhopal"])
    now = int(time.time())
    body = {
        "alert_id": uuid.uuid4().hex[:8], "type": atype, "severity": severity,
        "headline": f"{severity} {atype} ALERT: {place}",
        "issued_at": now, "valid_until": now + 3 * 3600,
        "region": {"shape": "circle", "center": [round(lat, 6), round(lon, 6)], "radius_km": radius_km},
        "shelters": shelters if shelters is not None else _demo_shelters(lat, lon),
        "shelter_source": shelter_source,
        "protocol": {"steps": PROTOCOLS.get(atype, PROTOCOLS["FLOOD"]), "note": PROTOCOL_NOTE},
        "checkin_interval_s": interval_s,
    }
    payload = json.dumps(body, sort_keys=True, separators=(",", ":"))
    alert = {"payload": payload, "sig": sign(payload), "alg": "HMAC-SHA256", "status": "ACTIVE"}
    if forged:  # tamper AFTER signing so the signature no longer matches
        alert["payload"] = payload[:-1] + ',"tampered":true}'
    return alert


# ------------------------------------------------------------- state -----
def log_event(device, kind, detail="", lat=None, lon=None):
    STATE["events"].append({"ts": time.time(), "device": device, "kind": kind,
                            "detail": detail, "lat": lat, "lon": lon})
    del STATE["events"][:-300]


STATUS_FOR = {"SIREN_ON": "ALERTED", "SLIDER_CONFIRMED": "EVACUATING",
              "CHECKIN": "CHECKED_IN", "ESCALATED": "ESCALATED", "ALL_CLEAR": "IDLE"}


def touch_device(dev, lat=None, lon=None, battery=None, src=None):
    d = STATE["devices"].setdefault(dev, {"id": dev, "status": "IDLE", "lat": None, "lon": None,
                                          "battery": None, "last_seen": 0, "deadline": None, "src": "-"})
    if src is not None:
        d["src"] = src
    if d["last_seen"] == 0:
        log_event(dev, "DEVICE_ONLINE")
    d["last_seen"] = time.time()
    if lat is not None and lon is not None:
        d["lat"], d["lon"] = lat, lon
    if battery is not None:
        d["battery"] = battery
    return d


def apply_event(data):
    dev = data.get("device", "dev1")
    kind = data.get("event", "UNKNOWN")
    lat, lon = data.get("lat"), data.get("lon")
    d = touch_device(dev, lat, lon)
    log_event(dev, kind, data.get("detail", ""), lat, lon)
    if kind in STATUS_FOR:
        d["status"] = STATUS_FOR[kind]
    iv = data.get("interval_s")
    if kind in ("SLIDER_CONFIRMED", "CHECKIN") and iv:
        d["deadline"] = time.time() + iv
    if kind in ("ESCALATED", "ALL_CLEAR"):
        d["deadline"] = None


def public_state():
    alert = STATE["alert"]
    out = dict(alert) if alert else None
    if out:
        out["body"] = json.loads(alert["payload"].replace(',"tampered":true', "")) if alert else None
        out["forged"] = not verify(alert)
    return {"now": time.time(), "alert": out, "devices": list(STATE["devices"].values()),
            "events": STATE["events"][-60:]}


# -------------------------------------------------------------- HTTP -----
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj, code=200, ctype="application/json"):
        body = obj.encode() if isinstance(obj, str) else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        if u.path == "/":
            return self._send(HTML, ctype="text/html; charset=utf-8")
        with LOCK:
            if u.path == "/api/state":
                return self._send(public_state())
            if u.path == "/api/device/poll":
                f = lambda k: float(q[k][0]) if k in q else None
                b = int(q["battery"][0]) if "battery" in q else None
                touch_device(q.get("device", ["dev1"])[0], f("lat"), f("lon"), b, q.get("src", ["unknown"])[0])
                return self._send({"alert": STATE["alert"], "server_time": time.time()})
        self._send({"error": "not found"}, 404)

    def _create_alert(self, data):
        try:
            if data.get("lat") not in (None, "") and data.get("lon") not in (None, ""):
                center, place = (float(data["lat"]), float(data["lon"])), "your typed location"
            elif data.get("city", "LIVE") == "LIVE":
                with LOCK:
                    live = [d for d in STATE["devices"].values() if d["lat"] is not None and d.get("src") != "none"]
                if not live:
                    return self._send({"error": "No device has a GPS fix yet. Open the app with location on and "
                                                "'Allow all the time', or type a lat/lon."}, 400)
                d = max(live, key=lambda x: x["last_seen"])
                center, place = (d["lat"], d["lon"]), "your area"
            else:
                city = data["city"]
                center, place = CITIES.get(city, CITIES["Bhopal"]), f"{city} region"
        except (TypeError, ValueError) as e:
            return self._send({"error": f"bad location: {e}"}, 400)
        shelters, source = find_shelters(*center)  # network calls, deliberately outside LOCK
        shelters = attach_routes(center, shelters)
        with LOCK:
            STATE["alert"] = make_alert(place, data.get("type", "FLOOD"), data.get("severity", "WARNING"),
                                        float(data.get("radius_km", 15)), int(data.get("checkin_interval_s", 600)),
                                        bool(data.get("forged")), center, shelters, source)
            log_event("GATEWAY", "ALERT_SENT" + (" (FORGED)" if data.get("forged") else ""),
                      f"centre {center[0]:.5f},{center[1]:.5f}; shelters: {source}")
        self._send({"ok": True, "center": center, "shelters": len(shelters), "shelter_source": source})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        data = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/api/alert":
            return self._create_alert(data)
        with LOCK:
            if self.path == "/api/clear":
                if STATE["alert"]:
                    aid = json.loads(STATE["alert"]["payload"].replace(',"tampered":true', ""))["alert_id"]
                    STATE["alert"]["status"] = "CLEARED"
                    STATE["alert"]["clear_sig"] = sign(f"{aid}|CLEARED")
                    log_event("GATEWAY", "ALL_CLEAR_SENT", aid)
            elif self.path == "/api/device/event":
                apply_event(data)
            elif self.path == "/api/reset":
                STATE.update({"alert": None, "devices": {}, "events": []})
            else:
                return self._send({"error": "not found"}, 404)
        self._send({"ok": True})


def run_server(port):
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Argo gateway + control room on http://localhost:{port}")
    print(f"Android emulator reaches it at http://10.0.2.2:{port}   (physical phone: use this PC's LAN IP)")
    srv.serve_forever()


# ------------------------------------------------------ reference device -
def haversine_km(a_lat, a_lon, b_lat, b_lon):
    p = math.pi / 180
    h = (math.sin((b_lat - a_lat) * p / 2) ** 2
         + math.cos(a_lat * p) * math.cos(b_lat * p) * math.sin((b_lon - a_lon) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(h))


def _http(url, body=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def run_device(a):
    base, dev = a.server.rstrip("/"), a.device
    say = lambda m: print(f"[{time.strftime('%H:%M:%S')}] {dev}: {m}", flush=True)

    def post(event, detail="", **extra):
        _http(f"{base}/api/device/event", {"device": dev, "event": event, "detail": detail,
                                           "lat": a.lat, "lon": a.lon, **extra})

    say(f"online at ({a.lat}, {a.lon}), battery {a.battery}%")
    handled, state, t0, deadline, next_press, done = set(), "IDLE", 0, 0, 0, 0
    body, shelter, esc_polls = None, None, 0
    while True:
        qs = urllib.parse.urlencode({"device": dev, "lat": a.lat, "lon": a.lon, "battery": a.battery, "src": "sim"})
        alert = _http(f"{base}/api/device/poll?{qs}")["alert"]
        now = time.time()

        if alert and body and alert.get("status") == "CLEARED" and state != "IDLE":
            if verify_clear(alert):
                say("verified ALL-CLEAR: siren off, screen released")
                post("ALL_CLEAR")
                state = "IDLE"
            else:
                say("all-clear signature INVALID, ignored")
        elif alert and alert["status"] == "ACTIVE":
            aid = hashlib.sha1(alert["payload"].encode()).hexdigest()
            if aid not in handled:
                handled.add(aid)
                post("ALERT_RECEIVED", "raw alert received from gateway")
                if not verify(alert):
                    say("SIGNATURE INVALID -> alert rejected (possible spoof)")
                    post("SIGNATURE_FAIL", "HMAC mismatch, alert discarded")
                    continue
                post("SIGNATURE_OK", "HMAC-SHA256 verified")
                body = json.loads(alert["payload"])
                r = body["region"]
                dist = haversine_km(a.lat, a.lon, *r["center"])
                if dist > r["radius_km"]:
                    say(f"outside region ({dist:.1f} km > {r['radius_km']} km) -> ignored")
                    post("OUT_OF_REGION", f"{dist:.1f} km from centre")
                    body = None
                    continue
                post("IN_REGION", f"{dist:.1f} km from centre, radius {r['radius_km']} km")
                if a.battery <= RESERVE_PCT:
                    post("RESERVE_POWER_ACTIVE", f"battery {a.battery}%, running on reserved {RESERVE_PCT}%")
                    say(f"battery {a.battery}%: running on the reserved {RESERVE_PCT}%")
                say(f"RED SCREEN: {body['headline']}  | SIREN ON | slider waiting")
                post("SIREN_ON", body["headline"])
                state, t0 = "ALERTING", now
                done = 0
        if state == "ALERTING" and now - t0 >= a.slide_after:
            shelter = min(body["shelters"], key=lambda s: haversine_km(a.lat, a.lon, s["lat"], s["lon"]))
            km = haversine_km(a.lat, a.lon, shelter["lat"], shelter["lon"])
            iv = body["checkin_interval_s"]
            say(f"slider confirmed -> map to '{shelter['name']}' ({km:.1f} km); check-in every {iv}s")
            post("SLIDER_CONFIRMED", "evacuation screen opened", interval_s=iv)
            post("NEAREST_SHELTER", f"{shelter['name']} {km:.1f} km")
            state, deadline, next_press = "EVAC", now + iv, now + iv * 0.6
        elif state == "EVAC":
            iv = body["checkin_interval_s"]
            if done < a.checkins and now >= next_press:
                done += 1
                say(f"user pressed CHECK-IN ({done}/{a.checkins})")
                post("CHECKIN", f"press {done}", interval_s=iv)
                deadline, next_press = now + iv, now + iv * 0.6
            elif now >= deadline:
                say(f"MISSED CHECK-IN -> live location ({a.lat}, {a.lon}) sent to rescue control room")
                post("ESCALATED", "no check-in in time; live location sent")
                state = "ESCALATED"
        elif state == "ESCALATED":
            esc_polls += 1
            if a.exit_on_escalation and esc_polls >= 3:
                return
        time.sleep(1)


# --------------------------------------------------------- dashboard -----
HTML = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Argo Navis - Control Room</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0c1116;--panel:#151c24;--line:#2a3540;--txt:#f2ede4;--mut:#9aa7b2;--amb:#ffb000;--red:#ff3b3b;--grn:#3ddc97;--cy:#38bdf8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.4 system-ui,Segoe UI,Arial,sans-serif}
header{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}
h1{font:700 18px Georgia,serif;margin:0;letter-spacing:.5px}h1 span{color:var(--amb)}
.grid{display:grid;grid-template-columns:330px 1fr;gap:14px;padding:14px;align-items:start}
@media(max-width:900px){.grid{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px;margin-bottom:14px}
.card h2{font-size:11px;letter-spacing:2px;color:var(--amb);margin:0 0 10px;text-transform:uppercase}
label{display:block;color:var(--mut);font-size:12px;margin:8px 0 3px}
select,input{width:100%;padding:7px;background:#0c1116;color:var(--txt);border:1px solid var(--line);border-radius:4px}
button{width:100%;margin-top:8px;padding:9px;border:0;border-radius:4px;font-weight:700;cursor:pointer;color:#0c1116;background:var(--amb)}
button.red{background:var(--red);color:#fff}button.gry{background:#2a3540;color:var(--txt)}
svg{width:100%;background:#0a0f14;border:1px solid var(--line);border-radius:4px}
table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:4px 6px;border-bottom:1px solid var(--line);text-align:left}
th{color:var(--mut);font-weight:500}.pill{padding:1px 7px;border-radius:9px;font-size:11px;font-weight:700;color:#0c1116}
#log{max-height:280px;overflow:auto;font:12px ui-monospace,Consolas,monospace}
#log div{padding:2px 0;border-bottom:1px solid #1d2630}.t{color:var(--mut)}
pre{white-space:pre-wrap;word-break:break-all;font:11px ui-monospace,Consolas,monospace;color:var(--mut);margin:6px 0 0;max-height:170px;overflow:auto}
.big{font-size:15px;font-weight:700}.ok{color:var(--grn)}.bad{color:var(--red)}
@keyframes p{50%{opacity:.35}}.pulse{animation:p 1s infinite}
</style></head><body>
<header><h1>ARGO <span>NAVIS</span> &nbsp;/&nbsp; Alert Gateway + Rescue Control Room</h1><div id="clock" class="t"></div></header>
<div class="grid">
<div>
 <div class="card"><h2>Alert gateway (govt / telecom side)</h2>
  <label>Alert centre</label><select id="city"><option value="LIVE">My device (live GPS)</option><option>Bhopal</option><option>Chennai</option><option>Visakhapatnam</option><option>Guwahati</option></select>
  <label>Or type exact lat, lon (overrides the choice above)</label><div style="display:flex;gap:6px"><input id="lat" placeholder="lat"><input id="lon" placeholder="lon"></div>
  <label>Disaster type</label><select id="type"><option>FLOOD</option><option>CYCLONE</option><option>TSUNAMI</option><option>EARTHQUAKE</option><option>WILDFIRE</option></select>
  <label>Severity</label><select id="sev"><option>WARNING</option><option>EXTREME</option><option>ADVISORY</option></select>
  <label>Alert radius (km)</label><input id="rad" type="number" value="15">
  <label>Check-in interval (seconds; 600 = 10 min, use 30 for the demo)</label><input id="int" type="number" value="30">
  <button onclick="send(false)">Send signed alert</button>
  <button class="red" onclick="send(true)">Send FORGED alert (bad signature)</button>
  <button class="gry" onclick="api('/api/clear',{})">Send all-clear</button>
  <button class="gry" onclick="api('/api/reset',{})">Reset demo</button>
 </div>
 <div class="card"><h2>Active alert (what the phone receives)</h2><div id="alertinfo" class="t">No active alert</div><pre id="payload"></pre></div>
</div>
<div>
 <div class="card"><h2 id="maptitle">Live map</h2><div id="lmap" style="height:440px;border-radius:4px;display:none"></div><svg id="map" viewBox="0 0 560 420"></svg></div>
 <div class="card"><h2>Devices</h2><table><thead><tr><th>Device</th><th>Status</th><th>Battery</th><th>GPS source</th><th>Location</th><th>Next check-in</th></tr></thead><tbody id="devs"></tbody></table></div>
 <div class="card"><h2>What the firmware layer did (event log)</h2><div id="log"></div></div>
</div></div>
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const $=id=>document.getElementById(id);
const COL={IDLE:'#6b7785',ALERTED:'#ffb000',EVACUATING:'#38bdf8',CHECKED_IN:'#3ddc97',ESCALATED:'#ff3b3b'};
const KC=k=>k.includes('FAIL')||k.includes('ESCALATED')||k.includes('FORGED')?'#ff3b3b':k.includes('OK')||k.includes('CHECKIN')||k.includes('CLEAR')?'#3ddc97':k.includes('SIREN')||k.includes('IN_REGION')||k.includes('SLIDER')?'#ffb000':'#9aa7b2';
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function api(p,b){const r=await fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});let j={};try{j=await r.json()}catch(e){}if(!r.ok&&j.error)alert(j.error);tick();return j}
function send(forged){const body={city:$('city').value,type:$('type').value,severity:$('sev').value,radius_km:+$('rad').value,checkin_interval_s:+$('int').value,forged};if($('lat').value&&$('lon').value){body.lat=+$('lat').value;body.lon=+$('lon').value}api('/api/alert',body)}
let LM=null,LG=null,lastFit='';
function initLeaflet(){
 if(LM)return true;if(typeof L==='undefined')return false;
 try{$('lmap').style.display='block';LM=L.map('lmap').setView([23.26,77.41],14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(LM);
  LG=L.layerGroup().addTo(LM);LM.invalidateSize();return true}catch(e){LM=null;return false}}
function renderLeaflet(s,B){
 LG.clearLayers();const pts=[];
 if(B){L.circle(B.region.center,{radius:B.region.radius_km*1000,color:'#ff3b3b',weight:2,dashArray:'6 4',fillOpacity:.07}).addTo(LG);
  B.shelters.forEach((h,i)=>{
   if(h.route&&h.route.length>1)L.polyline(h.route,{color:i==0?'#1e90ff':'#6b7785',weight:i==0?5:3,opacity:.9}).addTo(LG);
   const info=h.route_km?` - ${h.route_km} km, ~${h.route_min} min walk`:` - ${h.distance_km??'?'} km`;
   L.circleMarker([h.lat,h.lon],{radius:8,color:'#fff',weight:2,fillColor:'#3ddc97',fillOpacity:1}).bindTooltip(esc(h.name)+info,{permanent:i==0,direction:'right'}).addTo(LG);
   pts.push([h.lat,h.lon])})}
 s.devices.forEach(d=>{if(d.lat==null)return;
  L.circleMarker([d.lat,d.lon],{radius:10,color:'#fff',weight:2,fillColor:COL[d.status]||'#6b7785',fillOpacity:1}).bindTooltip(esc(d.id)+' '+d.status+(d.status=='ESCALATED'?' - RESCUE NEEDED':''),{permanent:true,direction:'top'}).addTo(LG);
  pts.push([d.lat,d.lon])});
 const key=(B?B.alert_id:'-')+':'+(pts.length?1:0);
 if(pts.length&&key!==lastFit){LM.fitBounds(pts,{padding:[40,40],maxZoom:17});lastFit=key}}
function render(s){
 $('clock').textContent=new Date(s.now*1000).toLocaleTimeString();
 const A=s.alert,B=A&&A.body;
 if(A){const bad=A.forged;
  $('alertinfo').innerHTML=`<div class="big">${esc(B.headline)}</div><div>Status: <b>${A.status}</b> &nbsp; Signature: <b class="${bad?'bad':'ok'}">${bad?'INVALID (forged)':'valid'}</b></div><div class="t">Check-in every ${B.checkin_interval_s}s &middot; radius ${B.region.radius_km} km</div><div class="t" style="margin-top:6px">Shelters (${esc(B.shelter_source||'')}):<br>${B.shelters.map(h=>esc(h.name)+' - '+(h.distance_km??'?')+' km').join('<br>')}</div>`;
  $('payload').textContent='sig: '+A.sig+'\n'+JSON.stringify(B,null,1)}
 else{$('alertinfo').textContent='No active alert';$('payload').textContent=''}
 const dv=s.devices.find(d=>d.lat!=null),c=B?B.region.center:(dv?[dv.lat,dv.lon]:[23.2599,77.4126]);
 const km=(la,lo)=>Math.hypot((lo-c[1])*111.32*Math.cos(c[0]*Math.PI/180),(la-c[0])*110.57);
 let maxD=B?0:5;if(B)B.shelters.forEach(h=>{maxD=Math.max(maxD,km(h.lat,h.lon))});s.devices.forEach(d=>{if(d.lat!=null)maxD=Math.max(maxD,km(d.lat,d.lon))});
 const R=Math.max(1,maxD*1.3),sc=170/R,cx=280,cy=210;
 const P=(la,lo)=>[cx+(lo-c[1])*111.32*Math.cos(c[0]*Math.PI/180)*sc,cy-(la-c[0])*110.57*sc];
 let m='';for(let i=1;i<10;i++){m+=`<line x1="${i*56}" y1="0" x2="${i*56}" y2="420" stroke="#141c24"/><line x1="0" y1="${i*42}" x2="560" y2="${i*42}" stroke="#141c24"/>`}
 if(B)m+=`<circle cx="${cx}" cy="${cy}" r="${B.region.radius_km*sc}" fill="rgba(255,59,59,.12)" stroke="#ff3b3b" stroke-dasharray="6 4"/>`;
 if(B)B.shelters.forEach(h=>{const[x,y]=P(h.lat,h.lon);m+=`<rect x="${x-6}" y="${y-6}" width="12" height="12" fill="#3ddc97"/><text x="${x+10}" y="${y+4}" fill="#9aa7b2" font-size="10">${esc(h.name.replace(' (demo)',''))}</text>`});
 s.devices.forEach(d=>{if(d.lat==null)return;const[x,y]=P(d.lat,d.lon),col=COL[d.status]||'#6b7785';
  m+=`<circle cx="${x}" cy="${y}" r="9" fill="${col}" class="${d.status=='ESCALATED'?'pulse':''}"/><text x="${x+13}" y="${y-8}" fill="#f2ede4" font-size="11" font-weight="700">${esc(d.id)} ${d.status=='ESCALATED'?'(RESCUE NEEDED)':''}</text>`});
 $('map').innerHTML=m;
 if(initLeaflet()){$('lmap').style.display='block';$('map').style.display='none';$('maptitle').textContent='Live map (OpenStreetMap)';renderLeaflet(s,B)}
 else{$('maptitle').textContent='Live map (schematic, offline)'}
 $('devs').innerHTML=s.devices.map(d=>{const left=d.deadline?Math.max(0,Math.round(d.deadline-s.now))+'s':'-';
  return `<tr><td>${esc(d.id)}</td><td><span class="pill" style="background:${COL[d.status]}">${d.status}</span></td><td>${d.battery??'-'}%</td><td>${esc(d.src||'-')}</td><td>${d.lat!=null?d.lat.toFixed(4)+', '+d.lon.toFixed(4):'-'}</td><td>${left}</td></tr>`}).join('')||'<tr><td colspan="6" class="t">No devices online</td></tr>';
 $('log').innerHTML=s.events.slice().reverse().map(e=>`<div><span class="t">${new Date(e.ts*1000).toLocaleTimeString()}</span> <b style="color:${KC(e.kind)}">${esc(e.kind)}</b> <span class="t">${esc(e.device)} ${esc(e.detail)}</span></div>`).join('')}
async function tick(){try{render(await (await fetch('/api/state')).json())}catch(e){}}
setInterval(tick,1000);tick();
</script></body></html>"""


def main():
    ap = argparse.ArgumentParser(description="Argo Navis demo gateway, control room and reference device")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("server")
    s.add_argument("--port", type=int, default=8000)
    d = sub.add_parser("device")
    d.add_argument("--server", default="http://127.0.0.1:8000")
    d.add_argument("--device", default="dev1")
    d.add_argument("--lat", type=float, default=23.2599)
    d.add_argument("--lon", type=float, default=77.4126)
    d.add_argument("--battery", type=int, default=40)
    d.add_argument("--slide-after", type=float, default=3, help="seconds before the user slides")
    d.add_argument("--checkins", type=int, default=2, help="check-ins pressed before the user stops responding")
    d.add_argument("--exit-on-escalation", action="store_true")
    h = sub.add_parser("shelters", help="look up real nearby buildings for a lat/lon and cache them")
    h.add_argument("--lat", type=float, required=True)
    h.add_argument("--lon", type=float, required=True)
    a = ap.parse_args()
    if a.cmd == "server":
        run_server(a.port)
    elif a.cmd == "device":
        run_device(a)
    else:
        found, src = find_shelters(a.lat, a.lon)
        found = attach_routes((a.lat, a.lon), found)
        print(f"Source: {src}")
        for x in found:
            r = f"  walk {x['route_km']} km (~{x['route_min']} min), {len(x['route'])} route points" if "route" in x else "  (no route)"
            print(f"  {x['distance_km']:>5} km  {x['name']}  ({x['lat']}, {x['lon']}){r}")


if __name__ == "__main__":
    main()
