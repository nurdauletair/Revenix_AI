require("dotenv").config();

const fs = require("fs");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function transcribeAudio(filePath) {
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "gpt-4o-mini-transcribe",
    response_format: "json",
  });

  return transcription.text;
}

module.exports = {
  transcribeAudio,
};
//great Nurdaulet