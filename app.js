require("dotenv").config();

const express = require("express");
const { handleInstagramWebhook } = require("./channels/instagram");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("Bot is alive 🚀");
});

app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  console.log("📩 Instagram event:", JSON.stringify(req.body, null, 2));

  res.sendStatus(200);

  await handleInstagramWebhook(req.body);
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

require("./channels/telegram");