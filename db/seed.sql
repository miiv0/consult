INSERT INTO bids (id, name, target_price, target_margin)
VALUES ('bid-001', 'Acme Bank: Mobile App Rebuild', 1000000, 0.35);

INSERT INTO pods (bid_id, id, name, cost_rate, bill_rate)
VALUES
  ('bid-001', 'pod-ny',  'New York Delivery', 180, 400),
  ('bid-001', 'pod-dal', 'Dallas Delivery', 90, 220),
  ('bid-001', 'pod-off', 'Offshore Delivery', 30, 90),
  ('bid-001', 'pod-gov', 'Program Governance', 250, 500);

INSERT INTO capabilities (bid_id, id, name, size_ksloc)
VALUES
  ('bid-001', 'cap-login',  'Login & Authentication', 4),
  ('bid-001', 'cap-payments', 'Payments', 15),
  ('bid-001', 'cap-migrate', 'Data Migration', 5);

INSERT INTO allocations (bid_id, id, capability_id, pod_id, hours)
VALUES
  ('bid-001', 'a1', 'cap-login',  'pod-ny', 400),
  ('bid-001', 'a2', 'cap-payments', 'pod-dal', 900),
  ('bid-001', 'a3', 'cap-payments', 'pod-off', 600),
  ('bid-001', 'a4', 'cap-migrate', 'pod-off', 500);
