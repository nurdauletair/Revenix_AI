require("dotenv").config();

const fs = require("fs");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function imageToBase64(filePath) {
  const imageBuffer = fs.readFileSync(filePath);
  return imageBuffer.toString("base64");
}

async function analyzeImage(filePath, prompt = "Опиши, что изображено на фото. Если это связано с заявкой клиента, выдели важные детали для менеджера.") {
  const base64Image = imageToBase64(filePath);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
            },
          },
        ],
      },
    ],
  });

  return response.choices[0].message.content;
}

module.exports = {
  analyzeImage,
};