// app.js — the behavior for the prototype.
// Today's job: load the sample bid and prove everything is wired together.

// 1. Grab the spot on the page where we'll show things.
const summaryEl = document.getElementById("bid-summary");

// 2. Load our fake "database" (the JSON file).
//    fetch() goes and gets the file; .then() runs once it arrives.
fetch("data/sample-bid.json")
  .then((response) => response.json())   // turn the text into a JS object
  .then((data) => {
    // 3. Pull the bid out and show its name. Proof the data made it through.
    const bid = data.bid;

    summaryEl.innerHTML = `
      <h2>${bid.name}</h2>
      <p>Target price: $${bid.target_price.toLocaleString()}</p>
      <p>Target margin: ${bid.target_margin * 100}%</p>
      <p>${data.allocations.length} allocations across ${data.pods.length} pods.</p>
    `;

    let totalHours = 0;
    for (const item of data.allocations) {
      totalHours += item.hours;
    }
    console.log("hours: " + totalHours)

    // Also log the whole object so you can poke at it in the browser console.
    console.log("Loaded bid data:", data);
  })
  .catch((err) => {
    summaryEl.innerHTML = `<p style="color:red">Couldn't load data: ${err.message}</p>`;
  });
