require("dotenv").config();

const express = require("express");

const app = express();

app.use(express.json());

// тестовый роут
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

// запуск Telegram
require("./channels/telegram");

// запуск сервера
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});