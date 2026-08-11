# Pursuit Modeling Platform — Prototype

A prototype of a tool that helps consulting firms **price their bids**: assign
work to teams at different rates, and see the total price, cost, and margin
update live. Replaces the error-prone spreadsheet that senior partners use today.

This prototype implements one **vertical slice** — the allocation rollup — from a
larger designed system (see `DESIGN.md`). Later phases (Monte Carlo risk
simulation, parametric estimation, cross-firm benchmarking) are designed but not
yet built.

## Run it locally

You need [Node.js](https://nodejs.org/) installed. From this folder:

```bash
npx serve
```

Then open the URL it prints (usually http://localhost:3000).

## Project layout

| Path | What it is |
|---|---|
| `index.html` | The page structure |
| `css/style.css` | Styling |
| `js/app.js` | Behavior — loads data, computes the rollup |
| `data/sample-bid.json` | Sample bid data (stands in for the database) |
| `DESIGN.md`, `schema.sql` | The full system design (the roadmap) |
