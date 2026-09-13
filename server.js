const express = require("express");
const app = express();

app.get("/hello", (req, res) => {
    res.send("Hi!")
});

app.listen(3000, () => {
    console.log("Server is running!")
});