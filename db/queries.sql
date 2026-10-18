SELECT a.id,
       c.name AS capability,
       p.name AS pod,
       a.hours,
       a.hours * p.cost_rate AS cost,
       a.hours * p.bill_rate AS price
FROM allocations a
JOIN pods p ON p.bid_id = a.bid_id AND p.id = a.pod_id
JOIN capabilities c ON c.bid_id = a.bid_id AND c.id = a.capability_id;