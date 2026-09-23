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

function getParametricHours(capability, bid) {
  const effort = getParametricEffort(capability, bid);
  const hoursPerPersonMonth = 152;
  return effort * hoursPerPersonMonth;
}

function runSimulation(iterations) {
  let results = []
  const govPod = data.pods.find((p) => p.id === "pod-gov");
  for (let i = 0; i < iterations; i++) {
    let runTotal = 0;
    for (const item of data.allocations) {
      let pod;
      if (item.pod_id) {
        pod = data.pods.find((p) => p.id === item.pod_id);
      } else {
        pod = data.resources.find((r) => r.id === item.resource_id);
      }
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

const scaleFactorTable = {
  PREC: { VL: 6.20, L: 4.96, N: 3.72, H: 2.48, VH: 1.24, XH: 0.00 },
  FLEX: { VL: 5.07, L: 4.05, N: 3.04, H: 2.03, VH: 1.01, XH: 0.00 },
  RESL: { VL: 7.07, L: 5.65, N: 4.24, H: 2.83, VH: 1.41, XH: 0.00 },
  TEAM: { VL: 5.48, L: 4.38, N: 3.29, H: 2.19, VH: 1.10, XH: 0.00 },
  PMAT: { VL: 7.80, L: 6.24, N: 4.68, H: 3.12, VH: 1.56, XH: 0.00 }
}

const effortMultiplierTable = {
  RELY: { VL: 0.82, L: 0.92, N: 1.00, H: 1.10, VH: 1.26 },
  DATA: { L: 0.90, N: 1.00, H: 1.14, VH: 1.28 },
  CPLX: { VL: 0.73, L: 0.87, N: 1.00, H: 1.17, VH: 1.34, XH: 1.74 },
  RUSE: { L: 0.95, N: 1.00, H: 1.07, VH: 1.15, XH: 1.24 },
  DOCU: { VL: 0.81, L: 0.91, N: 1.00, H: 1.11, VH: 1.23 },
  TIME: { N: 1.00, H: 1.11, VH: 1.29, XH: 1.63 },
  STOR: { N: 1.00, H: 1.05, VH: 1.17, XH: 1.46 },
  PVOL: { L: 0.87, N: 1.00, H: 1.15, VH: 1.30 },
  ACAP: { VL: 1.42, L: 1.19, N: 1.00, H: 0.85, VH: 0.71 },
  PCAP: { VL: 1.34, L: 1.15, N: 1.00, H: 0.88, VH: 0.76 },
  PCON: { VL: 1.29, L: 1.12, N: 1.00, H: 0.90, VH: 0.81 },
  AEXP: { VL: 1.22, L: 1.10, N: 1.00, H: 0.88, VH: 0.81 },
  PEXP: { VL: 1.19, L: 1.09, N: 1.00, H: 0.91, VH: 0.85 },
  LTEX: { VL: 1.20, L: 1.09, N: 1.00, H: 0.91, VH: 0.84 },
  TOOL: { VL: 1.17, L: 1.09, N: 1.00, H: 0.90, VH: 0.78 },
  SITE: { VL: 1.22, L: 1.09, N: 1.00, H: 0.93, VH: 0.86, XH: 0.80 },
  SCED: { VL: 1.43, L: 1.14, N: 1.00, H: 1.00, VH: 1.00 }
}

function getEffortMultiplierProduct(bid) {
  let product = 1;
  for (const factor in bid.effort_multipliers) {
    const rating = bid.effort_multipliers[factor];
    product *= effortMultiplierTable[factor][rating]
  }
  return product;
}

function getParametricEffort(capability, bid) {
  const A = 2.94;
  const B = 0.91;
  const E = B + 0.01 * getScaleFactorSum(bid);
  const effortMultiplierProduct = getEffortMultiplierProduct(bid);
  return A * Math.pow(capability.size_ksloc, E) * effortMultiplierProduct;
}

function getScaleFactorSum(bid) {
  let sum = 0;
  for (const factor in bid.scale_factors) {
    const rating = bid.scale_factors[factor];
    sum += scaleFactorTable[factor][rating]
  }
  return sum;
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
    let pod;
    if (item.pod_id) {
      pod = data.pods.find((p) => p.id === item.pod_id);
    } else {
      pod = data.resources.find((r) => r.id === item.resource_id);
    }
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
    options += "<optgroup label='Pods'>";
    for (const p of data.pods) {
      const isSelected = p.id === item.pod_id ? "selected" : "";
      options += `<option value="${p.id}" ${isSelected}>${p.name}</option>`;
    }
    options += "</optgroup><optgroup label='Resources'>";
    for (const r of data.resources) {
      const isSelected = r.id === item.resource_id ? "selected" : "";
      options += `<option value="${r.id}" ${isSelected}>${r.name}</option>`;
    }
    options += "</optgroup>";

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
    const parametricHours = getParametricHours(cap, bid);
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

  let scaleDisplay = ""
  let scaleColor;
  const scaleFactor = bid.target_price / totalPrice
  if (totalPrice === 0) {
    scaleDisplay = "—"; scaleColor = "grey";
  } else {
    if (scaleFactor > 1) {
      scaleDisplay = (scaleFactor * 100).toFixed(0) + "%";
      scaleColor = "green";
    } else {
      scaleDisplay = (scaleFactor * 100).toFixed(0) + "%";
      scaleColor = "red";
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
  const min = Math.min(...lastSimResults);
  const max = Math.max(...lastSimResults);

  function getRangePosition(value, min, max) {
    const range = (value - min) / (max - min) * 100
    return range
  }

  const p50Position = getRangePosition(p50, min, max);
  const p80Position = getRangePosition(p80, min, max);
  const p90Position = getRangePosition(p90, min, max);

  let snapshotRows = "";
  for (const snap of data.snapshots) {
    snapshotRows += `<li>${snap.label} — ${snap.taken_at}</li>`;
  }

  let summary = ""

  summaryEl.innerHTML = `
      <h2>${bid.name}</h2>
      <div class="stat-grid">
        <div class="stat-tile">
          <div class="stat-label">Target Price</div>
          <div class="stat-value">$${bid.target_price}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Total Price</div>
          <div class="stat-value">$${totalPrice.toLocaleString()}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Total Cost</div>
          <div class="stat-value">$${totalCost.toLocaleString()}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Total Hours</div>
          <div class="stat-value">${totalHours.toLocaleString()}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Margin</div>
          <div class="stat-value"><span style="color:${color}">${marginDisplay}</span></div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Verdict</div>
          <div class="stat-value"><span style="color:${color}">${verdict}</span></div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Price vs. Target</div>
          <div class="stat-value"><span style="color:${priceColor}">${priceMarginDisplay} (${priceVerdict})</span></div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Scale Factor</div>
          <div class="stat-value"><span style="color:${scaleColor}">${scaleDisplay}</span></div>
          <button id="solve-btn">Apply</button>
        </div>
      </div>
      <div class="panel">
      <div class="panel-title">Risk (Monte Carlo)</div>
      <button id="run-sim-button">Run Simulation</button>
      <div class="range-track">
        <div class="range-marker" style="left: ${p50Position}%; background: #60A5FA">
          <span style="top: -1.45rem" class="range-marker-label">P50: $${p50.toLocaleString()}</span>
        </div>
        <div class="range-marker" style="left: ${p80Position}%; background: #faaf60">
          <span style="top: -2.45rem" class="range-marker-label">P80: $${p80.toLocaleString()}</span>
        </div>
        <div class="range-marker" style="left: ${p90Position}%; background: #fa6060">
          <span style="top: -1.45rem" class="range-marker-label">P90: $${p90.toLocaleString()}</span>
        </div>
      </div>
      </div>
      <div class="panel">
      <div class="panel-title">Breakdown Table</div>
      <table>
      <tr><th>Capability</th><th>Pod</th><th>Hours</th><th>Cost</th><th>Price</th><th></th></tr>
      ${rows}
      </table>
      <input id="draft-description" type="text" placeholder="Enter new pod description"><button id="draft-btn">Send</button>
      </div>
      <button id="explain-btn">Summarize bid</button>
      <button id="add-btn">+ Add allocation</button>
      <button id="snap-btn">Save Snapshot</button>
      <button id="reset-btn">Reset</button>
      <div id=explain-panel></div>
      ${flags.length > 0 ? `<div class="panel">
      <div class="panel-title">Flags</div>
      <ul>${flagRows}</ul>
      </div>` : ""}
      ${snapshotRows.length > 0 ? `<div class="panel">
      <div class="panel-title">Snapshots</div>
      <ul>${snapshotRows}</ul>
      </div>` : ""}
      <div class="panel">
      <div class="panel-title">Breakdown By Pod</div>
      <table>
      <tr><th>Pod</th><th>Hours</th><th>Cost</th><th>Price</th><th>Margin</th></tr>
      ${podRows}
      </table>
      </div>
      <div class="panel">
      <div class="panel-title">Effort Estimate Comparison</div>
      <table>
      <tr><th>Capability</th><th>Bottom-Up Hours</th><th>Parametric Hours</th></tr>
      ${capRows}
      </table>
      </div>
  `;

  summaryEl.querySelectorAll("#draft-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const description = document.getElementById("draft-description").value
      const response = await fetch("http://localhost:3001/draft-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, pods: data.pods, capabilities: data.capabilities })
      });
      const text = await response.text();
      const parsed = JSON.parse(text)
      const allocationsFromAI = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of allocationsFromAI) {
        data.allocations.push({
          id: "a" + Date.now(),
          capability_id: item.capability_id,
          pod_id: item.pod_id,
          hours: item.hours
        });
      }
      render()
    });
  });

  summaryEl.querySelectorAll("#explain-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      marginFormat = margin.toFixed(1) + "%", totalPrice.toLocaleString()
      const response = await fetch("http://localhost:3001/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidData: { bid, totalPrice, totalCost, marginFormat, verdict, flags, podTotals } })
      });
      const text = await response.text();
      document.getElementById("explain-panel").innerHTML = `
      <div class="panel">
      <div class="panel-title">Summary</div>
      <div>${text}</div>
      </div>`;
    });
  });

  summaryEl.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = data.allocations.findIndex((a) => a.id === btn.dataset.id);
      data.allocations.splice(index, 1)
      render();
    });
  });

  summaryEl.querySelectorAll("input[data-id], select[data-id]").forEach((el) => {
    el.addEventListener("change", () => {
      const alloc = data.allocations.find((a) => a.id === el.dataset.id);

      if (el.tagName === "SELECT") {
        if (el.dataset.field === "capability_id") {
          alloc.capability_id = el.value;
        } else {
          const isPod = data.pods.find((p) => p.id === el.value);
          if (isPod) {
            alloc.pod_id = el.value;
            delete alloc.resource_id;
          } else {
            alloc.resource_id = el.value;
            delete alloc.pod_id;
          }
        }
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
    lastSimResults = runSimulation(1000);
    render();
  });

  const runScaleBtn = summaryEl.querySelector("#solve-btn");
  runScaleBtn.addEventListener("click", () => {
    for (const item of data.allocations) {
      if (totalPrice === 0) return;
      item.hours = Math.round(item.hours * scaleFactor)
    }
    render();
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

  const snapBtn = summaryEl.querySelector("#snap-btn");
  snapBtn.addEventListener("click", () => {
    data.snapshots.push({
      "label": "Snapshot saved",
      "taken_at": (new Date().toISOString()),
      "bid": JSON.parse(JSON.stringify(data.bid)),
      "allocations": JSON.parse(JSON.stringify(data.allocations))
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