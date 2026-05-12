require("dotenv").config();

const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function extractJson(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
}

async function detectHandoff({ userText, aiAnswer }) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
Ты анализируешь диалог клиента с бизнесом.

Определи, нужно ли срочно передать клиента менеджеру.

Верни строго JSON:

{
  "handoff_required": true,
  "reason": "..."
}

или

{
  "handoff_required": false,
  "reason": ""
}

handoff_required = true если:
- клиент просит менеджера
- клиент просит человека
- клиент просит оператора
- клиент просит звонок
- клиент злится
- клиент жалуется
- вопрос сложный
- клиент хочет индивидуальные условия
          `,
        },
        {
          role: "user",
          content: `
Сообщение клиента:
${userText}

Ответ AI:
${aiAnswer}
          `,
        },
      ],
    });

    const raw = completion.choices[0].message.content;

    console.log("HANDOFF RAW RESPONSE:", raw);

    const parsed = extractJson(raw);

    if (!parsed) {
      console.error("Failed to parse handoff JSON");

      return {
        handoff_required: false,
        reason: "",
      };
    }

    return {
      handoff_required: !!parsed.handoff_required,
      reason: parsed.reason || "",
    };
  } catch (err) {
    console.error("detectHandoff error:", err);

    return {
      handoff_required: false,
      reason: "",
    };
  }
}

module.exports = {
  detectHandoff,
};