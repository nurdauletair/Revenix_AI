require("dotenv").config();

const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function detectHandoff({ userText, aiAnswer }) {
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
  "handoff_required": true/false,
  "reason": ""
}

handoff_required = true если:
- клиент просит менеджера/человека/оператора
- клиент просит позвонить
- клиент злится
- клиент пишет жалобу
- вопрос сложный и AI не должен отвечать сам
- клиент хочет индивидуальный расчет/договор/нестандартные условия
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

  try {
    return JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    console.error("Handoff JSON parse error:", completion.choices[0].message.content);

    return {
      handoff_required: false,
      reason: "",
    };
  }
}

module.exports = {
  detectHandoff,
};