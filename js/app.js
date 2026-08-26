const STORAGE_KEY = "consult-bid";
let data;
let lastSimResults = null;
const summaryEl = document.getElementById("bid-summary");

function getHoursRange(item) {
  return {
    low: item.hours * 0.85,
    high: item.hours * 1.15,
  };
}

function sampleHours(item) {
  const range = getHoursRange(item);
  let numberRange = range.low + Math.random() * (range.high - range.low)
  return numberRange
}

function getParametricEffort(capability) {
  const A = 2.94;
  const E = 0.91;
  return A * Math.pow(capability.size_ksloc, E);
}

function getParametricHours(capability) {
  const effort = getParametricEffort(capability);
  const hoursPerPersonMonth = 152;
  return effort * hoursPerPersonMonth;
}

function runSimulation(iterations) {
  let results = []
  const govPod = data.pods.find((p) => p.id === "pod-gov");
  for (let i = 0; i < iterations; i++) {
    let runTotal = 0;
    for (const item of data.allocations) {
      const pod = data.pods.find((p) => p.id === item.pod_id);
      const sampled = sampleHours(item)
      const carveHours = sampled * data.bid.governance_carveout_pct;
      const directHours = sampled - carveHours;
      runTotal += directHours * pod.bill_rate + carveHours * govPod.bill_rate
    }
    results.push(runTotal)
  }
  return results
}

function getPercentile(results, percentile) {
  const sorted = results.slice().sort((a, b) => a - b);
  const index = Math.floor(percentile * sorted.length);
  return sorted[Math.min(index, sorted.length - 1)];
}

const saved = localStorage.getItem(STORAGE_KEY);
if (saved !== null) {
  data = JSON.parse(saved);
  lastSimResults = runSimulation(1000);
  render();
} else {
  fetch("data/sample-bid.json")
    .then((response) => response.json())
    .then((loaded) => {
      data = loaded;
      lastSimResults = runSimulation(1000);
      render();
    })
    .catch((err) => {
      summaryEl.innerHTML = `<p style="color:red">Couldn't load data: ${err.message}</p>`;
    });
}

function render() {
  const bid = data.bid;
  let totalHours = 0;
  let totalCost = 0;
  let totalPrice = 0;
  let rows = "";
  let podTotals = {};

  for (const item of data.allocations) {
    const pod = data.pods.find((p) => p.id === item.pod_id);
    const cap = data.capabilities.find((c) => c.id === item.capability_id);
    const govPod = data.pods.find((p) => p.id === "pod-gov");
    const carveHours = item.hours * bid.governance_carveout_pct;
    const directHours = item.hours - carveHours;

    if (!podTotals[pod.id]) {
      podTotals[pod.id] = { name: pod.name, hours: 0, cost: 0, price: 0 };
    }
    podTotals[pod.id].hours += directHours;
    podTotals[pod.id].cost += directHours * pod.cost_rate;
    podTotals[pod.id].price += directHours * pod.bill_rate;

    if (!podTotals[govPod.id]) {
      podTotals[govPod.id] = { name: govPod.name, hours: 0, cost: 0, price: 0 };
    }
    podTotals[govPod.id].hours += carveHours;
    podTotals[govPod.id].cost += carveHours * govPod.cost_rate;
    podTotals[govPod.id].price += carveHours * govPod.bill_rate;

    let options = "";
    for (const p of data.pods) {
      const isSelected = p.id === item.pod_id ? "selected" : "";
      options += `<option value="${p.id}" ${isSelected}>${p.name}</option>`;
    }

    let optionsCap = "";
    for (const f of data.capabilities) {
      const isSelected = f.id === item.capability_id ? "selected" : "";
      optionsCap += `<option value="${f.id}" ${isSelected}>${f.name}</option>`;
    }

    totalHours += item.hours;
    totalCost += directHours * pod.cost_rate + carveHours * govPod.cost_rate;
    totalPrice += directHours * pod.bill_rate + carveHours * govPod.bill_rate;
    rows += `<tr>
      <td><select data-id="${item.id}" data-field="capability_id">${optionsCap}</select></td>
      <td><select data-id="${item.id}" data-field="pod_id">${options}</select></td>
      <td><input type="number" value="${item.hours}" data-id="${item.id}"></td>
      <td>$${(directHours * pod.cost_rate + carveHours * govPod.cost_rate).toLocaleString()}</td>
      <td>$${(directHours * pod.bill_rate + carveHours * govPod.bill_rate).toLocaleString()}</td>
      <td><button data-id="${item.id}">✕</button></td>
      </tr>`;
  }

  let capTotals = {};

  for (const item of data.allocations) {
    const cap = data.capabilities.find((c) => c.id === item.capability_id);
    if (!capTotals[cap.id]) {
      capTotals[cap.id] = { name: cap.name, hours: 0 };
    }
    capTotals[cap.id].hours += item.hours
  }

  let capRows = "";
  for (const cap of data.capabilities) {
    const bottomUpHours = capTotals[cap.id] ? capTotals[cap.id].hours : 0;
    const parametricHours = getParametricHours(cap);

    capRows += `<tr>
    <td>${cap.name}</td>
    <td>${bottomUpHours.toFixed(0)}</td>
    <td>${parametricHours.toFixed(0)}</td>
  </tr>`;
  }

  let podRows = "";
  for (const id in podTotals) {
    let podColor;
    const p = podTotals[id];
    const podMargin = p.price === 0 ? null : (p.price - p.cost) / p.price;
    const podMarginDisplay = podMargin === null ? "—" : (podMargin * 100).toFixed(1) + "%";
    if (podMargin === null) {
      podColor = "grey";
    } else if (podMargin >= bid.target_margin) {
      podColor = "green";
    } else {
      podColor = "red";
    }
    podRows += `<tr>
    <td>${p.name}</td>
    <td>${p.hours}</td>
    <td>$${p.cost.toLocaleString()}</td>
    <td>$${p.price.toLocaleString()}</td>
    <td><span style="color:${podColor}">${podMarginDisplay}</span></td>
  </tr>`;
  }

  let priceMarginDisplay;
  let priceVerdict;
  let priceColor;

  if (totalPrice === 0) {
    priceMarginDisplay = "—";
    priceVerdict = "No allocations to price yet";
    priceColor = "grey";
  } else {
    const pricePercent = totalPrice / bid.target_price;
    const priceDiff = totalPrice - bid.target_price;
    priceMarginDisplay = "$" + Math.abs(priceDiff).toLocaleString();
    if (priceDiff >= 0) {
      priceVerdict = "+" + Math.abs(pricePercent * 100).toFixed(1) + "%";
      priceColor = "red";
    } else {
      priceVerdict = "-" + Math.abs(pricePercent * 100).toFixed(1) + "%";
      priceColor = "green";
    }
  }

  const profit = totalPrice - totalCost;
  let marginDisplay;
  let verdict;
  let color;
  const margin = profit / totalPrice;

  if (totalPrice === 0) {
    marginDisplay = "—";
    verdict = "No allocations to price yet";
    color = "grey";
  } else {
    const targetPercentage = margin - bid.target_margin;
    marginDisplay = (margin * 100).toFixed(1) + "%";
    if (margin >= bid.target_margin) {
      verdict = "Beats target by " + Math.abs(targetPercentage * 100).toFixed(1) + "%";
      color = "green";
    } else {
      verdict = "Below target by " + Math.abs(targetPercentage * 100).toFixed(1) + "%";
      color = "red";
    }
  }

  const flags = [];

  if (totalPrice > 0 && profit / totalPrice < bid.target_margin) {
    flags.push({ code: "MARGIN_BELOW_TARGET", message: "Margin is below target." });
  }
  if (totalPrice > bid.target_price) {
    flags.push({ code: "PRICE_ABOVE_TARGET", message: "Price is above target." });
  }

  let flagRows = "";
  for (const flag of flags) {
    flagRows += `<li>${flag.message}</li>`;
  }

  const p50 = getPercentile(lastSimResults, 0.5);
  const p80 = getPercentile(lastSimResults, 0.8);
  const p90 = getPercentile(lastSimResults, 0.9);

  summaryEl.innerHTML = `
      <h2>${bid.name}</h2>
      <p>Target price: $${bid.target_price.toLocaleString()}</p>
      <p>Target margin: ${bid.target_margin * 100}%</p>
      <p>${data.allocations.length} allocations across ${data.pods.length} pods.</p>
      <p>Total price: $${totalPrice.toLocaleString()}</p>
      <p>Total cost: $${totalCost.toLocaleString()}</p>
      <p>Margin: ${marginDisplay}</p>
      <p>Verdict: <span style="color:${color}">${verdict}</span></p>
      <p>Price: <span style="color:${priceColor}">${priceMarginDisplay} (${priceVerdict})</span></p>
      ${flags.length > 0 ? `<h3>Flags</h3><ul>${flagRows}</ul>` : ""}
      <h3>Risk (Monte Carlo)</h3>
      <p id="p50-display">P50: $${p50.toLocaleString()}</p>
      <p id="p80-display">P80: $${p80.toLocaleString()}</p>
      <p id="p90-display">P90: $${p90.toLocaleString()}</p>
      <button id="run-sim-button">Run Simulation</button>
      <table>
      <tr><th>Capability</th><th>Pod</th><th>Hours</th><th>Cost</th><th>Price</th><th></th></tr>
      ${rows}
      </table>
      <h3>By Pod</h3>
      <table>
      <tr><th>Pod</th><th>Hours</th><th>Cost</th><th>Price</th><th>Margin</th></tr>
      ${podRows}
      </table>
      <button id="add-btn">+ Add allocation</button>
      <button id="reset-btn">Reset</button>
    `;

  summaryEl.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = data.allocations.findIndex((a) => a.id === btn.dataset.id);
      data.allocations.splice(index, 1)
      render();
    });
  });

  summaryEl.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("change", () => {
      const alloc = data.allocations.find((a) => a.id === el.dataset.id);

      if (el.tagName === "SELECT") {
        alloc[el.dataset.field] = el.value;
      } else {
        const value = Number(el.value);
        if (Number.isNaN(value) || value < 0) {
          el.value = alloc.hours;
          return;
        }
        alloc.hours = value;
      }
      render();
    });
  });

  const runSimBtn = summaryEl.querySelector("#run-sim-button");
  runSimBtn.addEventListener("click", () => {
    const simResults = runSimulation(1000);
    const p50 = getPercentile(simResults, 0.5);
    const p80 = getPercentile(simResults, 0.8);
    const p90 = getPercentile(simResults, 0.9);
    document.getElementById("p50-display").textContent = "P50: $" + p50.toLocaleString();
    document.getElementById("p80-display").textContent = "P80: $" + p80.toLocaleString();
    document.getElementById("p90-display").textContent = "P90: $" + p90.toLocaleString();
  });

  const addBtn = summaryEl.querySelector("#add-btn");
  addBtn.addEventListener("click", () => {
    data.allocations.push({
      id: "a" + Date.now(),
      capability_id: data.capabilities[0].id,
      pod_id: data.pods[0].id,
      hours: 0,
    });
    render();
  });

  const resetBtn = summaryEl.querySelector("#reset-btn");
  resetBtn.addEventListener("click", () => {
    summaryEl.innerHTML = `
    <p><span style="color:red"> Are you sure? You will lose all your progress.</p>
      <button id="reset-btn">Reset</button>
      <button id="no-btn">No</button>
    `;
    const resetBtn = summaryEl.querySelector("#reset-btn");
    const noBtn = summaryEl.querySelector("#no-btn");
    resetBtn.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });
    noBtn.addEventListener("click", () => {
      render();
    });
  });

  console.log("Loaded bid data:", data);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}