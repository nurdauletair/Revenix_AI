require("dotenv").config();

const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function detectHandoffByKeywords(text = "") {
  const lower = text.toLowerCase();

  const keywords = [
    "менеджер",
    "оператор",
    "человек",
    "живой человек",
    "позвоните",
    "перезвоните",
    "свяжитесь со мной",
    "хочу поговорить",
    "можно с человеком",
    "адам",
    "оператормен",
    "менеджермен",
    "қоңырау",
  ];

  return keywords.some((word) => lower.includes(word));
}

function extractJson(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
}

async function detectHandoff({ userText, aiAnswer }) {
  // 1. Быстрый и надежный вариант: клиент сам просит человека
  if (detectHandoffByKeywords(userText)) {
    return {
      handoff_required: true,
      reason: "Клиент попросил менеджера/звонок",
    };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
Ты CRM-аналитик.

Твоя задача — определить, просит ли КЛИЕНТ живого менеджера.

Верни строго JSON:

{
  "handoff_required": true/false,
  "reason": ""
}

ВАЖНО:
- Анализируй в первую очередь сообщение клиента.
- НЕ ставь handoff_required=true только потому что AI написал "передам заявку менеджеру".
- Фразы AI типа "передам заявку", "менеджер свяжется", "заявка передана" НЕ означают, что клиент просит менеджера.
- handoff_required=true только если клиент сам просит человека/менеджера/оператора/звонок, злится, жалуется или требует ручного участия.
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