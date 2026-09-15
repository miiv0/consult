const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());

app.get("/hello", (req, res) => {
    res.send("Hi!")
});

app.listen(3001, () => {
    console.log("Server is running!")
});

app.post("/ask", async (req, res) => {
    async function fetchData() {
        const url = "http://localhost:11434/api/generate";
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: "llama3.2:latest", prompt: req.body.prompt, stream: false, })
            });
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const data = await response.json();
            res.send(data.response)
            console.log(data);
            return data;
        } catch (error) {
            console.error('Fetch failed:', error.message);
        }
    }
    fetchData();
})

app.post("/draft-allocations", async (req, res) => {
    const description = req.body.description
    const capabilities = req.body.capabilities
    const pods = req.body.pods

    async function fetchData() {
        const url = "http://localhost:11434/api/generate";
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "llama3.2:latest", prompt: `
                    You are helping plan work for a consulting bid. You must only use the
                    capabilities and pods listed below, do not invent new ones.

                    Capabilities:
                    ${capabilities.map(c => `- ${c.id}: ${c.name}`).join("\n")}

                    Pods:
                    ${pods.map(p => `- ${p.id}: ${p.name}`).join("\n")}

                    Project description:
                    ${description}

                    Based on the description, propose a list of allocations, how many hours
                    of work from which pod should go toward which capability.Respond with
                    ONLY a JSON array, no other text, in exactly this shape:

                    [{ "capability_id": "...", "pod_id": "...", "hours": ... }]
                    `
                    , stream: false, format: "json"
                })
            });
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const data = await response.json();
            res.send(data.response)
            console.log(data);
            return data;
        } catch (error) {
            console.error('Fetch failed:', error.message);
        }
    }
    fetchData();
})

app.post("/explain", async (req, res) => {
    const data = req.body.bidData
    async function fetchData() {
        const url = "http://localhost:11434/api/generate";
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "llama3.2:latest", prompt: `
                    You are helping to summarize the bid in plain English.
                    I want you to note wheather the margin is healthy, whether price is over/under target, 
                    and call out anything in the flags list.
                    `
                    , stream: false
                })
            });
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const data = await response.json();
            res.send(data.response)
            console.log(data);
            return data;
        } catch (error) {
            console.error('Fetch failed:', error.message);
        }
    }
    fetchData();
})