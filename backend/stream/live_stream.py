"""Live synthetic event stream for Everest Textile Mills.

Drives the running mill forward through the real API, one event per tick: yarn trucks,
new orders, yarn issues, jobs starting and reporting output, rolls coming off the dyeing
line, QC decisions, dispatches, buyer payments, the odd breakdown and repair, and shift
handovers. Every write goes through the same endpoints the app uses, so the backend's own
rules (stock never negative, one job per machine, statuses derived) keep the data honest.

    python stream/live_stream.py                      # one event every 3 s, until Ctrl+C
    python stream/live_stream.py --interval 1 --steps 200 --seed 7
    python stream/live_stream.py --dry-run --steps 20 # show what would happen, write nothing

Stdlib only. Synthetic: every line it prints is also appended to stream/events.log, and
rows it creates carry "live stream" in their notes or a SIM vehicle number where the
schema has a free-text field. It talks to http://localhost:4000/api by default and refuses
any other host unless --allow-remote is passed, so it cannot pollute a shared database by
accident.
"""

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30))
PASSWORD = "Password123"
ROLES = ["owner", "store", "production", "qc", "dispatch"]
PER_SHIFT = {"SPINNING": 190, "WEAVING": 300, "DYEING": 900}  # same rates as the dataset
ROLL_LENGTH = 1100
# fabric -> (yarn kg per metre, yarn type, colours); matches the dataset's catalogue
FABRICS = {
    "Poplin": (0.11, "Cotton 40s", ["White", "Navy", "Sky Blue", "Black"]),
    "Cambric": (0.09, "Cotton 60s Combed", ["White", "Ivory", "Peach"]),
    "Twill": (0.2, "Cotton 30s", ["Khaki", "Black", "Navy", "Olive"]),
    "Denim": (0.45, "Cotton 20s Rope-dyed", ["Indigo", "Dark Indigo"]),
    "Canvas": (0.5, "Cotton 10s OE", ["Natural", "Khaki", "Black"]),
    "Oxford": (0.17, "Poly-Cotton 2/40", ["White", "Light Blue", "Pink"]),
    "Satin": (0.13, "Polyester 150D Semi-dull", ["Ivory", "Champagne", "Maroon"]),
    "Georgette": (0.08, "Polyester 75D Bright", ["Black", "Peach", "Teal"]),
    "Rayon Print": (0.12, "Viscose 30s", ["Red Floral", "Blue Paisley"]),
    "Linen Suiting": (0.22, "Linen 25s", ["Beige", "Natural", "Sand"]),
}
LOG = Path(__file__).with_name("events.log")


def shift_now(now):
    h = now.astimezone(IST).hour
    return "MORNING" if 6 <= h < 14 else "EVENING" if 14 <= h < 22 else "NIGHT"


class Api:
    def __init__(self, base, dry_run):
        self.base = base.rstrip("/")
        self.dry_run = dry_run
        self.tokens = {}

    def _call(self, method, path, body=None, role="owner"):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if role in self.tokens:
            req.add_header("Authorization", "Bearer " + self.tokens[role])
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                payload = json.loads(res.read())
        except urllib.error.HTTPError as e:
            payload = json.loads(e.read() or b"{}")
        if not payload.get("ok"):
            raise RuntimeError(f"{method} {path}: {payload.get('error')} {payload.get('message')}")
        return payload["data"]

    def login(self):
        for role in ROLES:
            data = self._call("POST", "/auth/signin", {"email": f"{role}@everest.dev", "password": PASSWORD})
            self.tokens[role] = data["token"]

    def get(self, path, role="owner"):
        return self._call("GET", path, role=role)

    def write(self, method, path, body, role):
        if self.dry_run:
            return {"id": "dry-run"}
        return self._call(method, path, body, role)


class Mill:
    """Reads the current floor from the API and picks the next believable event."""

    def __init__(self, api, rng):
        self.api = api
        self.rng = rng
        self.workers = api.get("/workers")
        self.buyers = api.get("/buyers")
        self.suppliers = api.get("/suppliers")
        self.marked = set()  # (date, shift) already put on the register

    # ---------- helpers ----------

    def crew(self, shift):
        return [w for w in self.workers if w["shift"] == shift and w["isActive"]]

    def stage_done(self, order_id, stage):
        jobs = self.api.get(f"/production/jobs?orderId={order_id}&stage={stage}&limit=500")
        return sum(j["qtyProduced"] for j in jobs), any(j["status"] == "RUNNING" for j in jobs)

    def stage_target(self, order, stage):
        if stage == "SPINNING":
            return order["yarnRequired"]
        if stage == "WEAVING":
            return round(order["qty"] * 1.06, -1)
        woven, _ = self.stage_done(order["id"], "WEAVING")
        return woven

    # ---------- events ----------

    def handover(self, now):
        """At a shift change, close jobs from the old shift and hand the machines to the new crew."""
        shift = shift_now(now)
        date = now.astimezone(IST).strftime("%Y-%m-%d")
        if (date, shift) not in self.marked:
            entries = [{"workerId": w["id"], "status": "PRESENT" if self.rng.random() < 0.93 else "ABSENT"} for w in self.crew(shift)]
            if entries:
                self.api.write("POST", "/attendance", {"date": date, "entries": entries}, "production")
            self.marked.add((date, shift))
        board = self.api.get("/production/board")
        moved = []
        for m in board["machines"]:
            job = m["currentJob"]
            if not job or job["shift"] == shift:
                continue
            self.api.write("POST", f"/production/jobs/{job['id']}/complete", {}, "production")
            left = round(job["qtyPlanned"] - job["qtyProduced"], 2)
            if left > 1:
                crew = self.crew(shift)
                body = {"orderId": job["order"]["id"], "machineId": m["id"], "shift": shift, "qtyPlanned": left}
                if crew:
                    body["workerId"] = self.rng.choice(crew)["id"]
                self.api.write("POST", "/production/jobs", body, "production")
            moved.append(m["code"])
        return f"{shift.lower()} shift took over {', '.join(moved)}" if moved else None

    def yarn_delivery(self):
        mats = self.api.get("/materials")
        m = min(mats, key=lambda x: x["qtyInStock"] / max(x["reorderLevel"], 1))
        if m["qtyInStock"] > m["reorderLevel"] * 2:
            return None
        qty = int(round(m["reorderLevel"] * 1.5 / 50) * 50) or 500
        rate = round(m["avgCost"] * self.rng.uniform(0.98, 1.04), 2)
        supplier = self.rng.choice(self.suppliers)
        self.api.write("POST", "/materials/inwards", {"materialId": m["id"], "supplierId": supplier["id"], "qty": qty, "rate": rate}, "store")
        return f"{qty} kg {m['yarnType']} from {supplier['name']} at Rs {rate}/kg"

    def new_order(self, now):
        fabric = self.rng.choice(list(FABRICS))
        kg_per_m, yarn, colours = FABRICS[fabric]
        mats = self.api.get("/materials")
        mat = next((x for x in mats if x["yarnType"] == yarn), None)
        if not mat:
            return None
        qty = int(round(self.rng.lognormvariate(7.7, 0.33) / 100) * 100)
        qty = max(500, min(qty, 8000))
        price = round(kg_per_m * 1.04 * mat["avgCost"] * 1.75 * self.rng.uniform(0.95, 1.05), 2)
        deadline = (now + timedelta(days=self.rng.randint(20, 45))).date().isoformat()
        body = {
            "buyerId": self.rng.choice(self.buyers)["id"], "materialId": mat["id"], "fabricType": fabric,
            "colour": self.rng.choice(colours), "qty": qty, "yarnRequired": round(qty * kg_per_m * 1.04),
            "pricePerUnit": price, "deadline": deadline,
        }
        order = self.api.write("POST", "/orders", body, "dispatch")
        return f"{order.get('orderNo', 'new order')}: {qty} m {fabric} for {next(b['name'] for b in self.buyers if b['id'] == body['buyerId'])}, due {deadline}"

    def issue_yarn(self):
        for o in self.api.get("/orders?status=PENDING&limit=40"):
            detail = self.api.get(f"/orders/{o['id']}")
            a = detail["availability"]
            left = round(a["required"] - a["issued"], 2)
            if left > 0 and a["inStock"] >= left and detail.get("materialId"):
                self.api.write("POST", "/materials/issues", {"materialId": detail["materialId"], "orderId": o["id"], "qty": left}, "store")
                return f"{left} kg issued to {o['orderNo']}"
        return None

    def start_job(self, now):
        board = self.api.get("/production/board")
        shift = shift_now(now)
        feeds = {"SPINNING": "PENDING", "WEAVING": "SPINNING", "DYEING": "WEAVING"}
        for m in [x for x in board["machines"] if x["status"] == "IDLE"]:
            stage = m["type"]
            for o in self.api.get(f"/orders?status={feeds[stage]}&limit=40"):
                if stage == "SPINNING":
                    a = self.api.get(f"/orders/{o['id']}")["availability"]
                    if a["issued"] < a["required"]:
                        continue
                else:
                    prev = {"WEAVING": "SPINNING", "DYEING": "WEAVING"}[stage]
                    done, running = self.stage_done(o["id"], prev)
                    if running or done < self.stage_target(o, prev) - 1:
                        continue
                done, running = self.stage_done(o["id"], stage)
                left = round(self.stage_target(o, stage) - done, 2)
                if running or left <= 1:
                    continue
                crew = self.crew(shift)
                body = {"orderId": o["id"], "machineId": m["id"], "shift": shift, "qtyPlanned": left}
                if crew:
                    body["workerId"] = self.rng.choice(crew)["id"]
                self.api.write("POST", "/production/jobs", body, "production")
                return f"{m['code']} started {stage.lower()} {o['orderNo']} ({left} {'kg' if stage == 'SPINNING' else 'm'})"
        return None

    def progress(self):
        board = self.api.get("/production/board")
        running = [m for m in board["machines"] if m["currentJob"]]
        if not running:
            return None
        m = self.rng.choice(running)
        job = m["currentJob"]
        hour = PER_SHIFT[m["type"]] / 8 * self.rng.uniform(0.85, 1.1)
        qty = round(min(hour * 2, job["qtyPlanned"] - job["qtyProduced"]), 2)
        if qty <= 0:
            return None
        self.api.write("POST", f"/production/jobs/{job['id']}/progress", {"qty": qty}, "production")
        made = job["qtyProduced"] + qty
        note = f"{m['code']} +{qty} on {job['order']['orderNo']}"
        if m["type"] == "DYEING":
            rolled = sum(r["qty"] for r in self.api.get(f"/qc/rolls?orderId={job['order']['id']}&limit=500") if r.get("jobId") == job["id"])
            finished = made >= job["qtyPlanned"] - 0.5
            while made - rolled >= ROLL_LENGTH or (finished and made - rolled > 1):
                length = round(min(ROLL_LENGTH, made - rolled), 2)
                self.api.write("POST", "/production/rolls", {"jobId": job["id"], "qty": length}, "production")
                rolled += length
                note += f", roll of {length} m to QC"
        if made >= job["qtyPlanned"] - 0.5:
            self.api.write("POST", f"/production/jobs/{job['id']}/complete", {}, "production")
            note += ", stage done"
        return note

    def qc(self):
        rolls = self.api.get("/qc/rolls?status=REWORK&limit=5", "qc") + self.api.get("/qc/rolls?status=PENDING_QC&limit=5", "qc")
        if not rolls:
            return None
        roll = rolls[0]
        x = self.rng.random()
        if roll["status"] == "REWORK":
            result = "PASS" if x < 0.85 else "REJECT"
        else:
            result = "PASS" if x < 0.9 else "REWORK" if x < 0.96 else "REJECT"
        body = {"result": result, "notes": "live stream"}
        if result != "PASS":
            body["defectType"] = self.rng.choice(["Holes", "Colour mismatch", "Uneven weaving", "Stains", "Shade variation"])
        self.api.write("POST", f"/qc/rolls/{roll['id']}/inspect", body, "qc")
        return f"{roll['rollNo']} ({roll['order']['orderNo']}) {result}" + (f": {body['defectType']}" if result != "PASS" else "")

    def dispatch(self):
        for group in self.api.get("/dispatch/stock")["orders"]:
            order = self.api.get(f"/orders/{group['order']['id']}")
            if order["status"] != "READY":
                continue
            vehicle = f"GJ-05-SIM-{self.rng.randint(1000, 9999)}"
            body = {"orderId": order["id"], "rollIds": [r["id"] for r in group["rolls"]], "vehicleNo": vehicle}
            d = self.api.write("POST", "/dispatch", body, "dispatch")
            return f"{d.get('dispatchNo', 'dispatch')}: {len(group['rolls'])} rolls of {order['orderNo']} on {vehicle}, invoice raised"
        return None

    def payment(self):
        unpaid = self.api.get("/invoices?status=UNPAID&limit=50", "dispatch")
        if not unpaid:
            return None
        inv = min(unpaid, key=lambda i: i["issuedAt"])
        amount = inv["balance"] if self.rng.random() < 0.8 else round(inv["balance"] * 0.5, 2)
        self.api.write("POST", f"/invoices/{inv['id']}/payments", {"amount": amount, "method": self.rng.choice(["NEFT", "RTGS", "UPI"])}, "dispatch")
        return f"{inv['invoiceNo']}: Rs {amount} received"

    def breakdown_or_repair(self):
        board = self.api.get("/production/board")
        down = [m for m in board["machines"] if m["status"] == "BREAKDOWN"]
        if down:  # at most one machine down at a time: repair it before breaking another
            m = down[0]
            self.api.write("PATCH", f"/machines/{m['id']}/status", {"status": "IDLE"}, "production")
            return f"{m['code']} repaired, back to idle"
        running = [m for m in board["machines"] if m["status"] == "RUNNING"]
        if not running:
            return None
        m = self.rng.choice(running)
        self.api.write("PATCH", f"/machines/{m['id']}/status", {"status": "BREAKDOWN"}, "production")
        return f"{m['code']} broke down, {m['currentJob']['order']['orderNo']} stopped"


EVENTS = [  # (name, weight)
    ("progress", 8), ("qc", 4), ("start_job", 3), ("issue_yarn", 2), ("dispatch", 2),
    ("new_order", 2), ("yarn_delivery", 1), ("payment", 2), ("breakdown_or_repair", 0.4),
]


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--api", default="http://localhost:4000/api")
    p.add_argument("--interval", type=float, default=3.0, help="seconds between events")
    p.add_argument("--steps", type=int, default=0, help="stop after N events (0 = run until Ctrl+C)")
    p.add_argument("--seed", type=int, default=None, help="fix the event sequence")
    p.add_argument("--dry-run", action="store_true", help="read the floor and print events, write nothing")
    p.add_argument("--allow-remote", action="store_true", help="permit a non-localhost API")
    args = p.parse_args()

    if not args.allow_remote and not any(h in args.api for h in ("localhost", "127.0.0.1")):
        sys.exit("Refusing a non-local API without --allow-remote.")

    rng = random.Random(args.seed)
    api = Api(args.api, args.dry_run)
    api.login()
    mill = Mill(api, rng)
    names, weights = zip(*EVENTS)
    print(f"live stream on {args.api}{' (dry run)' if args.dry_run else ''}; Ctrl+C to stop", flush=True)

    step = 0
    try:
        while not args.steps or step < args.steps:
            now = datetime.now(timezone.utc)
            done = []
            try:
                handed = mill.handover(now)
                if handed:
                    done.append(("SHIFT_HANDOVER", handed))
                # Try the drawn event first, then the rest, so every tick does something useful.
                first = rng.choices(names, weights)[0]
                for name in [first] + [n for n in names if n != first]:
                    fn = getattr(mill, name)
                    detail = fn(now) if name in ("new_order", "start_job") else fn()
                    if detail:
                        done.append((name.upper(), detail))
                        break
            except Exception as e:  # one bad call must not end the stream
                done.append(("SKIPPED", str(e)[:160]))
            for kind, detail in done:
                line = json.dumps({"at": now.isoformat(timespec="seconds"), "event": kind, "detail": detail, "synthetic": True})
                print(line, flush=True)
                if not args.dry_run:
                    with LOG.open("a", encoding="utf-8") as f:
                        f.write(line + "\n")
            step += 1
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("stopped", flush=True)


if __name__ == "__main__":
    main()
