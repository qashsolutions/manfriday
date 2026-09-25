"""SQLite storage: fund state, every fill, events, prices, news, params and the journal."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from .book import Fill, Fund
from .config import DATA_DIR, Settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated REAL);
CREATE TABLE IF NOT EXISTS fills (
  id INTEGER PRIMARY KEY, ts REAL, lane_id INT, asset TEXT, side TEXT, qty REAL, price REAL,
  cash REAL, fee REAL, reason TEXT, strategy TEXT, mode TEXT);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, ts REAL, level TEXT, kind TEXT, lane_id INT, message TEXT, data TEXT);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS ticks (asset TEXT, ts REAL, bid REAL, ask REAL, last REAL, gap REAL, PRIMARY KEY (asset, ts));
CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY, published REAL, seen REAL, source TEXT, title TEXT, url TEXT, summary TEXT,
  assets TEXT, sentiment REAL, severity INT, tags TEXT, av_score REAL);
CREATE INDEX IF NOT EXISTS news_published ON news(published);
CREATE TABLE IF NOT EXISTS params (key TEXT PRIMARY KEY, value REAL, updated REAL, by TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS param_history (id INTEGER PRIMARY KEY, ts REAL, key TEXT, old REAL, new REAL, by TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS equity (ts REAL, lane_id INT, asset TEXT, equity REAL, PRIMARY KEY (ts, lane_id));
CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY, ts REAL, agent TEXT, content TEXT);
CREATE TABLE IF NOT EXISTS backtests (
  id INTEGER PRIMARY KEY, ts REAL, asset TEXT, strategy TEXT, params TEXT, train TEXT, test TEXT, survived INT);
CREATE TABLE IF NOT EXISTS league_equity (
  ts REAL, portfolio TEXT, lane_id INT, asset TEXT, equity REAL, price REAL, PRIMARY KEY (ts, portfolio, lane_id));
"""


def _migrate(conn: sqlite3.Connection) -> None:
    """Add the league's portfolio column to older tables, and copy old equity rows over."""
    for table in ("fills", "events"):
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        if "portfolio" not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN portfolio TEXT DEFAULT 'quant'")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(league_equity)")}
    if "price" not in cols:
        conn.execute("ALTER TABLE league_equity ADD COLUMN price REAL")
    if not conn.execute("SELECT 1 FROM league_equity LIMIT 1").fetchone():
        conn.execute("INSERT OR IGNORE INTO league_equity SELECT ts, 'quant', lane_id, asset, equity, NULL FROM equity")


class DB:
    def __init__(self, path: Path | None = None):
        path = path or DATA_DIR / "highway.db"
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False, timeout=30, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        _migrate(self.conn)

    # ---- basics --------------------------------------------------------------------------

    def execute(self, sql: str, args: tuple | list = ()) -> sqlite3.Cursor:
        with self.lock:
            return self.conn.execute(sql, args)

    def executemany(self, sql: str, rows: list) -> None:
        with self.lock:
            self.conn.executemany(sql, rows)

    def query(self, sql: str, args: tuple | list = ()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, args).fetchall()]

    def transaction(self):
        return _Tx(self)

    # ---- state ---------------------------------------------------------------------------

    def get_state(self, key: str, default: Any = None) -> Any:
        rows = self.query("SELECT value FROM state WHERE key=?", (key,))
        return json.loads(rows[0]["value"]) if rows else default

    def set_state(self, key: str, value: Any) -> None:
        self.execute(
            "INSERT INTO state(key, value, updated) VALUES(?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated",
            (key, json.dumps(value), time.time()),
        )

    # ---- fund ----------------------------------------------------------------------------

    def load_fund(self, s: Settings, key: str = "fund") -> Fund | None:
        d = self.get_state(key)
        return Fund.from_dict(d, s.capital, s.fees, s.settlement) if d else None

    def save_fund(self, fund: Fund, mode: str, portfolio: str = "quant", key: str = "fund") -> None:
        """Persist the fund plus any new fills and events in one transaction."""
        with self.transaction():
            self.set_state(key, fund.to_dict())
            self.log_fills(fund.fills, mode, portfolio)
            for e in fund.events:
                data = {k: v for k, v in e.items() if k not in ("ts", "kind", "lane_id", "message")}
                self.event("info", e["kind"], e["message"], e["lane_id"], ts=e["ts"], portfolio=portfolio, **data)
        fund.fills.clear()
        fund.events.clear()

    def log_fills(self, fills: list[Fill], mode: str, portfolio: str = "quant") -> None:
        self.executemany(
            "INSERT INTO fills(ts,lane_id,asset,side,qty,price,cash,fee,reason,strategy,mode,portfolio) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            [(f.ts, f.lane_id, f.asset, f.side, f.qty, f.price, f.cash, f.fee, f.reason, f.strategy, mode, portfolio) for f in fills],
        )

    def event(self, level: str, kind: str, message: str, lane_id: int | None = None, ts: float | None = None,
              portfolio: str | None = None, **data) -> None:
        self.execute(
            "INSERT INTO events(ts,level,kind,lane_id,message,data,portfolio) VALUES(?,?,?,?,?,?,?)",
            (ts or time.time(), level, kind, lane_id, message, json.dumps(data) if data else None, portfolio),
        )

    # ---- prices --------------------------------------------------------------------------

    def add_tick(self, asset: str, ts: float, bid: float, ask: float, last: float, gap: float | None) -> None:
        self.execute("INSERT OR REPLACE INTO ticks VALUES(?,?,?,?,?,?)", (asset, ts, bid, ask, last, gap))

    def tick_near(self, asset: str, ts: float, tolerance: float = 300) -> float | None:
        rows = self.query(
            "SELECT bid, ts FROM ticks WHERE asset=? AND ts BETWEEN ? AND ? ORDER BY ABS(ts-?) LIMIT 1",
            (asset, ts - tolerance, ts + tolerance, ts),
        )
        return rows[0]["bid"] if rows else None

    # ---- params --------------------------------------------------------------------------

    def load_params(self) -> dict[str, float]:
        return {r["key"]: r["value"] for r in self.query("SELECT key, value FROM params")}

    def save_param(self, key: str, old: float, new: float, by: str, reason: str) -> None:
        now = time.time()
        with self.transaction():
            self.execute(
                "INSERT INTO params VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET "
                "value=excluded.value, updated=excluded.updated, by=excluded.by, reason=excluded.reason",
                (key, new, now, by, reason),
            )
            self.execute("INSERT INTO param_history(ts,key,old,new,by,reason) VALUES(?,?,?,?,?,?)", (now, key, old, new, by, reason))

    def journal(self, agent: str, content: str) -> None:
        self.execute("INSERT INTO journal(ts,agent,content) VALUES(?,?,?)", (time.time(), agent, content))


class _Tx:
    def __init__(self, db: DB):
        self.db = db

    def __enter__(self):
        self.db.lock.acquire()
        self.db.conn.execute("BEGIN")
        return self.db

    def __exit__(self, exc_type, *_):
        try:
            self.db.conn.execute("ROLLBACK" if exc_type else "COMMIT")
        finally:
            self.db.lock.release()
        return False
