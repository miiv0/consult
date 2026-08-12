let data;
const summaryEl = document.getElementById("bid-summary");

fetch("data/sample-bid.json")
  .then((response) => response.json())
  .then((loaded) => {
    data = loaded;
    render();
  })
  .catch((err) => {
    summaryEl.innerHTML = `<p style="color:red">Couldn't load data: ${err.message}</p>`;
  });

function render() {
  const bid = data.bid;
  let totalHours = 0;
  let totalCost = 0;
  let totalPrice = 0;
  let rows = "";

  for (const item of data.allocations) {
    const pod = data.pods.find((p) => p.id === item.pod_id);
    const cap = data.capabilities.find((c) => c.id === item.capability_id);
    let options = "";
    for (const p of data.pods) {
      const isSelected = p.id === item.pod_id ? "selected" : "";
      options += `<option value="${p.id}" ${isSelected}>${p.name}</option>`;
    }
    totalHours += item.hours;
    totalCost += item.hours * pod.cost_rate;
    totalPrice += item.hours * pod.bill_rate;
    rows += `<tr>
      <td>${cap.name}</td>
      <td><select data-id="${item.id}">${options}</select></td>
      <td><input type="number" value="${item.hours}" data-id="${item.id}"></td>
      <td>${(item.hours * pod.cost_rate)}</td>
      <td>${(item.hours * pod.bill_rate)}</td>
      <td><button data-id="${item.id}">✕</button></td>
      </tr>`;
  }

  const profit = totalPrice - totalCost;
  const margin = profit / totalPrice;

  console.log("hours: " + totalHours)
  console.log("cost: " + totalCost)
  console.log("price: " + totalPrice)

  let verdict;
  let color;
  const targetPercentage = margin - bid.target_margin
  if (margin >= bid.target_margin) {
    verdict = ("Beats target by " + Math.abs(targetPercentage * 100).toFixed(1));
    color = "green"
  } else {
    verdict = ("Below target by " + Math.abs(targetPercentage * 100).toFixed(1));
    color = "red"
  }

  summaryEl.innerHTML = `
      <h2>${bid.name}</h2>
      <p>Target price: $${bid.target_price.toLocaleString()}</p>
      <p>Target margin: ${bid.target_margin * 100}%</p>
      <p>${data.allocations.length} allocations across ${data.pods.length} pods.</p>
      <p>Total price: $${totalPrice.toLocaleString()}</p>
      <p>Total cost: $${totalCost.toLocaleString()}</p>
      <p>Margin: ${(margin * 100).toFixed(1)}%</p>
      <p>Verdict: <span style="color:${color}">${verdict}%</span></p>
      <table>
      <tr><th>Capability</th><th>Pod</th><th>Hours</th><th>Cost</th><th>Price</th><th></th></tr>
      ${rows}
      </table>
      <button id="add-btn">+ Add allocation</button>
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
        alloc.pod_id = el.value;
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


  console.log("Loaded bid data:", data);
}