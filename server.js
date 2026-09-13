require("express")

const express = require("express");
const app = express();

app.get("/hello", (req, res) => {
    console.log("hi!")
});

app.listen(3000, () => {
    console.log("Server is running!")
});