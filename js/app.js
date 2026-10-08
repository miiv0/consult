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

function formatMoney(x) {
  return "$" + x.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPercent(x) {
  return (x * 100).toFixed(1) + "%"
}

function getBestMarginPod() {
  let best = null;
  let bestMargin = null;
  for (const pod of data.pods) {
    if (pod.id === "pod-gov") continue;
    const margin = (pod.bill_rate - pod.cost_rate) / pod.bill_rate
    if (best === null || margin > bestMargin) {
      best = pod;
      bestMargin = margin;
    }
  }
  return best
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

const themeBtn = document.getElementById("theme-btn");

function updateThemeLabel(theme) {
  themeBtn.textContent = theme === "dark" ? "☀ Light" : "☾ Dark";
}

const savedTheme = localStorage.getItem("theme");
if (savedTheme !== null) {
  document.documentElement.dataset.theme = savedTheme;
}
updateThemeLabel(savedTheme);

themeBtn.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme;
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
  updateThemeLabel(next);
});

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
      summaryEl.innerHTML = `<p style="color:var(--bad)">Couldn't load data: ${err.message}</p>`;
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
      <td>${formatMoney(directHours * pod.cost_rate + carveHours * govPod.cost_rate)}</td>
      <td>${formatMoney(directHours * pod.bill_rate + carveHours * govPod.bill_rate)}</td>
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
    const podMarginDisplay = podMargin === null ? "—" : formatPercent(podMargin);
    if (podMargin === null) {
      podColor = "var(--muted)";
    } else if (podMargin >= bid.target_margin) {
      podColor = "var(--good)";
    } else {
      podColor = "var(--bad)";
    }
    podRows += `<tr>
    <td>${p.name}</td>
    <td>${p.hours}</td>
    <td>${formatMoney(p.cost)}</td>
    <td>${formatMoney(p.price)}</td>
    <td><span style="color:${podColor}">${podMarginDisplay}</span></td>
  </tr>`;
  }

  let podEditRows = "";
  for (const pod of data.pods) {
    const inUse = data.allocations.some((a) => a.pod_id === pod.id);
    podEditRows += `<tr>
    <td><input data-pod-id="${pod.id}" data-field="name" value="${pod.name}"></td>
    <td><input data-pod-id="${pod.id}" data-field="cost_rate" type="number" value="${pod.cost_rate}"></td>
    <td><input data-pod-id="${pod.id}" data-field="bill_rate" type="number" value="${pod.bill_rate}"></td>
    <td>${pod.id === "pod-gov" ? "" : `<button data-del-pod="${pod.id}" ${inUse ? "disabled" : ""}>✕</button>`}</td>
  </tr>`;
  }

  let capEditRows = "";
  for (const cap of data.capabilities) {
    const inUse = data.allocations.some((a) => a.capability_id === cap.id);
    capEditRows += `<tr>
    <td><input data-cap-id="${cap.id}" data-field="name" value="${cap.name}"></td>
    <td><input data-cap-id="${cap.id}" data-field="size_ksloc" type="number" value="${cap.size_ksloc}"></td>
    <td><button data-del-cap="${cap.id}" ${inUse ? "disabled" : ""}>✕</button></td>
  </tr>`;
  }

  let priceMarginDisplay;
  let priceVerdict;
  let priceColor;

  if (totalPrice === 0) {
    priceMarginDisplay = "—";
    priceVerdict = "No allocations to price yet";
    priceColor = "var(--muted)";
  } else {
    const priceDiff = totalPrice - bid.target_price;
    const pricePercent = priceDiff / bid.target_price;
    priceMarginDisplay = formatMoney(Math.abs(priceDiff));
    if (priceDiff >= 0) {
      priceVerdict = "+" + formatPercent(Math.abs(pricePercent));
      priceColor = "var(--bad)";
    } else {
      priceVerdict = "-" + formatPercent(Math.abs(pricePercent));
      priceColor = "var(--good)";
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
    color = "var(--muted)";
  } else {
    const targetPercentage = margin - bid.target_margin;
    marginDisplay = formatPercent(margin);
    if (margin >= bid.target_margin) {
      verdict = "Beats target by " + formatPercent(Math.abs(targetPercentage));
      color = "var(--good)";
    } else {
      verdict = "Below target by " + formatPercent(Math.abs(targetPercentage));
      color = "var(--bad)";
    }
  }

  let scaleDisplay = ""
  let scaleColor;
  const scaleFactor = bid.target_price / totalPrice

  if (totalPrice === 0) {
    scaleDisplay = "—"; scaleColor = "var(--muted)";
  } else {
    if (scaleFactor > 1) {
      scaleDisplay = (scaleFactor * 100).toFixed(0) + "%";
      scaleColor = "var(--good)";
    } else {
      scaleDisplay = (scaleFactor * 100).toFixed(0) + "%";
      scaleColor = "var(--bad)";
    }
  }

  let floorDisplay = "";
  let floorColor;
  if (bid.target_margin === 1 || totalCost === 0) {
    floorDisplay = "—"; floorColor = "var(--muted)";
  } else {
    const floorPrice = totalCost / (1 - bid.target_margin);
    floorDisplay = "$" + floorPrice.toLocaleString(undefined, { notation: "compact" })
    if (totalPrice >= floorPrice) {
      floorColor = "var(--good)";
    } else {
      floorColor = "var(--bad)";
    }
  }

  const bestPod = getBestMarginPod();
  const bestPodMargin = (bestPod.bill_rate - bestPod.cost_rate) / bestPod.bill_rate
  const shiftDisplay = formatPercent(bestPodMargin);

  let canShift = false;
  for (const item of data.allocations) {
    if (!item.pod_id) continue;
    if (item.pod_id !== bestPod.id) {
      canShift = true;
    }
  }
  const shiftColor = canShift ? "var(--good)" : "var(--muted)";

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
      <div class="title-bar">
        <input id="bid-name" value="${bid.name}" placeholder="Untitled Project">
        <div class="title-actions">
          <button id="explain-btn">Summarize bid</button>
          <button id="snap-btn">Save Snapshot</button>
          <button id="reset-btn">Reset</button>
        </div>
      </div>
      <div id=explain-panel></div>
      ${flags.length > 0 ? `<div class="panel">
      <div class="panel-title">Flags</div>
      <ul>${flagRows}</ul>
      </div>` : ""}
      <div class="stat-grid">
        <div class="stat-tile">
          <div class="stat-label">Target Price</div>
          <input id="target-price" type="text" inputmode="numeric" value="${bid.target_price.toLocaleString()}">
        </div>
        <div class="stat-tile">
          <div class="stat-label">Target Margin</div>
          <input id="target-margin" type="number" value="${bid.target_margin * 100}">
        </div>
        <div class="stat-tile">
          <div class="stat-label">Total Price</div>
          <div class="stat-value">${formatMoney(totalPrice)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Total Cost</div>
          <div class="stat-value">${formatMoney(totalCost)}</div>
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
          <div class="stat-label">Floor Price</div>
          <div class="stat-value"><span style="color:${floorColor}">${floorDisplay}</span></div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Scale Factor</div>
          <div class="stat-value"><span style="color:${scaleColor}">${scaleDisplay}</span></div>
          <button id="solve-btn">Scale</button>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Shift to ${bestPod.name}</div>
          <div class="stat-value"><span style="color:${shiftColor}">${shiftDisplay}</span></div>
          <button id="shift-btn">Shift</button>
        </div>
      </div>
      <div class="panel">
      <div class="panel-title">Allocations</div>
      <table>
      <tr><th>Capability</th><th>Pod</th><th>Hours</th><th>Cost</th><th>Price</th><th></th></tr>
      ${rows}
      <tr class="total-row"><td>Total</td><td></td><td>${totalHours.toLocaleString()}</td><td>${formatMoney(totalCost)}</td><td>${formatMoney(totalPrice)}</td><td></td></tr>
      </table>
      <button id="add-alloc-btn">+ Add allocation</button>
      <div class="draft-row"><input id="draft-description" type="text" placeholder="Describe work to draft allocations with AI…"><button id="draft-btn">Send</button></div>
      </div>
      <div class="panel">
      <div class="panel-title">Pods</div>
      <table>
      <tr><th>Name</th><th>Cost Rate</th><th>Bill Rate</th><th></th></tr>
      ${podEditRows}
      </table>
      <button id="add-pod-btn">+ Add pod</button>
      </div>
      <div class="panel">
      <div class="panel-title">Capabilities</div>
      <table>
      <tr><th>Name</th><th>Size (KSLOC)</th><th></th></tr>
      ${capEditRows}
      </table>
      <p class="hint">Size = estimated thousands of lines of code (4 = 4,000 lines).</p>
      <button id="add-cap-btn">+ Add capability</button>
      </div>
      <div class="panel">
      <div class="panel-title">Breakdown By Pod</div>
      <table>
      <tr><th>Pod</th><th>Hours</th><th>Cost</th><th>Price</th><th>Margin</th></tr>
      ${podRows}
      </table>
      </div>
      <div class="panel">
      <div class="panel-title">Risk (Monte Carlo)</div>
      <button id="run-sim-button">Run Simulation</button>
      <div class="range-track">
        <div class="range-marker" style="left: ${p50Position}%; background: #60A5FA">
          <span style="top: -1.45rem" class="range-marker-label">P50: ${formatMoney(p50)}</span>
        </div>
        <div class="range-marker" style="left: ${p80Position}%; background: #faaf60">
          <span style="top: -2.45rem" class="range-marker-label">P80: ${formatMoney(p80)}</span>
        </div>
        <div class="range-marker" style="left: ${p90Position}%; background: #fa6060">
          <span style="top: -1.45rem" class="range-marker-label">P90: ${formatMoney(p90)}</span>
        </div>
      </div>
      </div>
      <div class="panel">
      <div class="panel-title">Effort Estimate Comparison</div>
      <table>
      <tr><th>Capability</th><th>Bottom-Up Hours</th><th>Parametric Hours</th></tr>
      ${capRows}
      </table>
      </div>
      ${snapshotRows.length > 0 ? `<div class="panel">
      <div class="panel-title">Snapshots</div>
      <ul>${snapshotRows}</ul>
      </div>` : ""}
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
      const response = await fetch("http://localhost:3001/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidData: { bid, totalPrice: formatMoney(totalPrice), totalCost: formatMoney(totalCost), margin: formatPercent(margin), verdict, flags, podTotals } })
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

  const changeTitleBtn = summaryEl.querySelector("#bid-name");
  changeTitleBtn.addEventListener("change", () => {
    data.bid.name = changeTitleBtn.value;
    render();
  });

  summaryEl.querySelectorAll("input[data-pod-id]").forEach((el) => {
    el.addEventListener("change", () => {
      const pod = data.pods.find((p) => p.id === el.dataset.podId)
      if (el.dataset.field === "name") {
        pod.name = el.value.trim() || pod.name;
      } else {
        const value = Number(el.value);
        if (Number.isNaN(value) || value < 0) {
          el.value = pod[el.dataset.field];
          return;
        }
        pod[el.dataset.field] = value;
      }
      render();
    });
  });

  summaryEl.querySelectorAll("input[data-cap-id]").forEach((el) => {
    el.addEventListener("change", () => {
      const cap = data.capabilities.find((c) => c.id === el.dataset.capId);
      if (el.dataset.field === "name") {
        cap.name = el.value.trim() || cap.name;
      } else {
        const value = Number(el.value);
        if (Number.isNaN(value) || value < 0) {
          el.value = cap[el.dataset.field];
          return;
        }
        cap[el.dataset.field] = value;
      }
      render();
    });
  });

  const changeTargetPriceBtn = summaryEl.querySelector("#target-price");
  changeTargetPriceBtn.addEventListener("input", () => {
    const text = changeTargetPriceBtn.value;
    const digitsBeforeCursor = text.slice(0, changeTargetPriceBtn.selectionStart).replace(/\D/g, "").length;
    const digits = text.replace(/\D/g, "");
    const formatted = digits === "" ? "" : Number(digits).toLocaleString();
    changeTargetPriceBtn.value = formatted;

    let cursor = 0;
    let seen = 0;
    while (seen < digitsBeforeCursor && cursor < formatted.length) {
      if (/\d/.test(formatted[cursor])) seen++;
      cursor++;
    }
    changeTargetPriceBtn.setSelectionRange(cursor, cursor);
  });

  changeTargetPriceBtn.addEventListener("change", () => {
    const targetPrice = Number(changeTargetPriceBtn.value.replace(/\D/g, ""));
    if (targetPrice <= 0) {
      changeTargetPriceBtn.value = data.bid.target_price.toLocaleString();
    } else {
      data.bid.target_price = targetPrice;
    }
    render();
  });

  const changeTargetMarginBtn = summaryEl.querySelector("#target-margin");
  changeTargetMarginBtn.addEventListener("change", () => {
    const targetMargin = Number(changeTargetMarginBtn.value) / 100;
    if (targetMargin <= 0 || (Number(changeTargetMarginBtn.value) >= 100)) {
      changeTargetMarginBtn.value = data.bid.target_margin
    } else {
      data.bid.target_margin = targetMargin
    }
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

  const runShiftBtn = summaryEl.querySelector("#shift-btn");
  runShiftBtn.addEventListener("click", () => {
    const bestPod = getBestMarginPod()
    for (const item of data.allocations) {
      if (!item.pod_id) continue;
      item.pod_id = bestPod.id
    }
    render()
  });

  const addAllocBtn = summaryEl.querySelector("#add-alloc-btn");
  addAllocBtn.addEventListener("click", () => {
    data.allocations.push({
      id: "a" + Date.now(),
      capability_id: data.capabilities[0].id,
      pod_id: data.pods[0].id,
      hours: 0,
    });
    render();
  });

  const addPodBtn = summaryEl.querySelector("#add-pod-btn");
  addPodBtn.addEventListener("click", () => {
    data.pods.push({
      id: "pod-" + Date.now(),
      name: "New Pod",
      cost_rate: 0,
      bill_rate: 0
    });
    render();
  });

  const addCapBtn = summaryEl.querySelector("#add-cap-btn");
  addCapBtn.addEventListener("click", () => {
    data.capabilities.push({
      id: "cap-" + Date.now(),
      name: "New Capability",
      size_ksloc: 0
    });
    render();
  });

  summaryEl.querySelectorAll("button[data-del-cap]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = data.capabilities.findIndex((c) => c.id === btn.dataset.delCap);
      data.capabilities.splice(index, 1);
      render();
    });
  });

  summaryEl.querySelectorAll("button[data-del-pod]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = data.pods.findIndex((p) => p.id === btn.dataset.delPod);
      data.pods.splice(index, 1);
      render();
    });
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
    <p><span style="color:var(--bad)"> Are you sure? You will lose all your progress.</p>
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