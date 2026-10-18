DROP TABLE IF EXISTS allocations, capabilities, pods, bids CASCADE;

CREATE TABLE bids (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL DEFAULT '',
  target_price            NUMERIC NOT NULL,
  target_margin           NUMERIC NOT NULL CHECK (target_margin >= 0 AND target_margin < 1),
  governance_carveout_pct NUMERIC NOT NULL DEFAULT 0.08,
  scale_factors           JSONB NOT NULL DEFAULT '{}',
  effort_multipliers      JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pods (
  bid_id    TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  id        TEXT NOT NULL,
  name      TEXT NOT NULL,
  cost_rate NUMERIC NOT NULL CHECK (cost_rate >= 0),
  bill_rate NUMERIC NOT NULL CHECK (bill_rate >= 0),
  PRIMARY KEY (bid_id, id)
);

CREATE TABLE capabilities (
  bid_id     TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  size_ksloc NUMERIC NOT NULL CHECK (size_ksloc >= 0),
  PRIMARY KEY (bid_id, id)
);

CREATE TABLE allocations (
  bid_id        TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  id            TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  pod_id        TEXT NOT NULL,
  hours         NUMERIC NOT NULL CHECK (hours >= 0),
  PRIMARY KEY (bid_id, id),
  FOREIGN KEY (bid_id, capability_id) REFERENCES capabilities(bid_id, id) ON DELETE CASCADE,
  FOREIGN KEY (bid_id, pod_id)        REFERENCES pods(bid_id, id)         ON DELETE CASCADE
);
