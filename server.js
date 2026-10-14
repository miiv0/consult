const express = require("express");
const cors = require("cors");
const app = express();
const MODEL = "qwen3:8b";
app.use(cors());
app.use(express.json());

const bidSchema = {
    type: "object",
    properties: {
        name: { type: "string" },
        pods: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    cost_rate: { type: "number" },
                    bill_rate: { type: "number" }
                },
                required: ["id", "name", "cost_rate", "bill_rate"]
            }
        },
        capabilities: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    size_ksloc: { type: "number" }
                },
                required: ["id", "name", "size_ksloc"]
            }
        },
        allocations: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    capability_id: { type: "string" },
                    pod_id: { type: "string" },
                    hours: { type: "number" }
                },
                required: ["capability_id", "pod_id", "hours"]
            }
        }
    },
    required: ["name", "pods", "capabilities", "allocations"]
};

app.get("/hello", (req, res) => {
    res.send("Hi!")
});

app.listen(3002, () => {
    console.log("Server is running!")
});

app.post("/ask", async (req, res) => {
    async function fetchData() {
        const url = "http://localhost:11434/api/generate";
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: MODEL, prompt: req.body.prompt, stream: false, })
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
                    model: MODEL, prompt: `
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
    const bidData = req.body.bidData
    async function fetchData() {
        const url = "http://localhost:11434/api/generate";
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: MODEL, prompt: `
                    You are helping to summarize the bid for a company.
                    Structure the response like a paragraph detailing a couple of factors, 
                    making it sound professional but consise and to the point.
                    I want you to note wheather the margin is healthy, whether price is over/under target, 
                    and call out anything in the flags list.
                    Here is the bid data: ${JSON.stringify(bidData)}
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

app.post("/draft-bid", async (req, res) => {
    const description = req.body.description
    async function fetchData() {
        const url = "http://localhost:11434/api/generate";
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: MODEL, prompt: `
                    You are an experienced consulting bid manager. Draft a complete
                    pricing bid for the project described at the end.

                    Rules:
                    1. "name": a short bid title in the form "Client: Project Name".
                    2. "pods": 2 to 4 delivery teams. Ids are "pod-1", "pod-2", and so on.
                       Rates are US dollars per hour. cost_rate must always be LOWER
                       than bill_rate. Typical ranges: onshore cost 120-200 / bill 250-450;
                       nearshore cost 60-100 / bill 150-250; offshore cost 25-45 / bill 70-120.
                    3. Do NOT include a governance, PMO, or project-management pod.
                    4. "capabilities": 3 to 6 pieces of work the project needs. Ids are
                       "cap-1", "cap-2", and so on. "size_ksloc" is estimated thousands
                       of lines of code, between 1 and 50.
                    5. "allocations": each assigns hours on one capability to one pod.
                       Every capability must appear in at least one allocation. Every
                       pod_id and capability_id must exactly match an id defined above.
                       "hours" is a whole number between 40 and 3000.

                    Project description:
                    ${description}
                    `
                    , stream: false, think: false, format: bidSchema
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