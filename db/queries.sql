SELECT a.id,
       c.name AS capability,
       p.name AS pod,
       a.hours,
       a.hours * p.cost_rate AS cost,
       a.hours * p.bill_rate AS price
FROM allocations a
JOIN pods p ON p.bid_id = a.bid_id AND p.id = a.pod_id
JOIN capabilities c ON c.bid_id = a.bid_id AND c.id = a.capability_id;

SELECT a.bid_id,
       SUM(a.hours) AS total_hours,
       SUM(a.hours * p.cost_rate) AS total_cost,
       SUM(a.hours * p.bill_rate) AS total_price,
       ROUND(1 - SUM(a.hours * p.cost_rate) / SUM(a.hours * p.bill_rate), 3) AS margin
FROM allocations a
JOIN pods p ON p.bid_id = a.bid_id AND p.id = a.pod_id
GROUP BY a.bid_id;
