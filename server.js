const express = require("express");
const app = express();

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
                body: JSON.stringify({ model: "llama3.2:latest", prompt: "hello", stream: false })
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

