const summaryEl = document.getElementById("bid-summary");

fetch("data/sample-bid.json")
  .then((response) => response.json())
  .then((data) => {
    const bid = data.bid;
    let totalHours = 0;
    let totalCost = 0;
    let totalPrice = 0;

    for (const item of data.allocations) {
      const pod = data.pods.find((p) => p.id === item.pod_id);
      totalHours += item.hours;
      totalCost += item.hours * pod.cost_rate;
      totalPrice += item.hours * pod.bill_rate;
    }

    const profit = totalPrice - totalCost;
    const margin = profit / totalPrice;

    console.log("hours: " + totalHours)
    console.log("cost: " + totalCost)
    console.log("cost: " + totalPrice)

    let verdict;
    const targetPercentage = margin - bid.target_margin
    if (margin >= bid.target_margin) {
      verdict = ("Beats target by " + Math.abs((targetPercentage * 100).toFixed(1)));
    } else {
      verdict = ("Below target by " + Math.abs((targetPercentage * 100).toFixed(1)));
    }

    summaryEl.innerHTML = `
      <h2>${bid.name}</h2>
      <p>Target price: $${bid.target_price.toLocaleString()}</p>
      <p>Target margin: ${bid.target_margin * 100}%</p>
      <p>${data.allocations.length} allocations across ${data.pods.length} pods.</p>
      <p>Total price: $${totalPrice.toLocaleString()}</p>
      <p>Total cost: $${totalCost.toLocaleString()}</p>
      <p>Margin: ${(margin * 100).toFixed(1)}%</p>
      <p>Verdict: ${verdict}%</p>
    `;

    console.log("Loaded bid data:", data);
  })

  .catch((err) => {
    summaryEl.innerHTML = `<p style="color:red">Couldn't load data: ${err.message}</p>`;
  });
