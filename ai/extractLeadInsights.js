require("dotenv").config();

const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function extractJson(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
}

async function extractLeadInsights({
  business,
  customerMemory,
  userText,
  aiAnswer,
}) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
Ты CRM-аналитик для бизнеса.

Твоя задача — анализировать сообщение клиента и ответ AI, чтобы обновить CRM.

Верни строго JSON без markdown:

{
  "lead_stage": "",
  "intent": "",
  "objection": "",
  "budget": "",
  "room_type": "",
  "estimated_area": "",
  "urgency": "",
  "lead_quality": "",
  "summary": ""
}

Допустимые lead_stage:
new
interested
price_question
measurement_offered
measurement_requested
booking_created
human_required
closed
lost

Допустимые lead_quality:
hot
warm
cold

Правила:
- Не придумывай данные.
- Если данных нет, ставь пустую строку.
- Если клиент спрашивает цену, lead_stage = "price_question".
- Если AI предложил замер, lead_stage = "measurement_offered".
- Если клиент согласен на замер, lead_stage = "measurement_requested".
- Если клиент просит менеджера/человека/звонок, lead_stage = "human_required".
- Если клиент готов оставить заявку, lead_quality = "hot".
- Если клиент интересуется, но ещё не готов, lead_quality = "warm".
- Если клиент просто спрашивает или сомневается, lead_quality = "cold".
- intent — коротко что хочет клиент.
- objection — сомнение клиента: дорого, подумаю, сравнивает, нет времени и т.д.
- room_type — комната/объект: зал, кухня, спальня, офис, квартира, дом.
- estimated_area — площадь, если клиент указал.
- urgency — срочность: сегодня, завтра, на неделе, срочно, позже.
          `,
        },
        {
          role: "user",
          content: `
Бизнес:
${business.name || ""}
Ниша: ${business.niche || ""}

Память клиента:
${customerMemory || ""}

Последнее сообщение клиента:
${userText || ""}

Ответ AI:
${aiAnswer || ""}
          `,
        },
      ],
    });

    const raw = completion.choices[0].message.content;

    console.log("LEAD INSIGHTS RAW:", raw);

    const parsed = extractJson(raw);

    if (!parsed) {
      console.error("Lead insights parse error:", raw);
      return null;
    }

    return {
      lead_stage: parsed.lead_stage || "",
      intent: parsed.intent || "",
      objection: parsed.objection || "",
      budget: parsed.budget || "",
      room_type: parsed.room_type || "",
      estimated_area: parsed.estimated_area || "",
      urgency: parsed.urgency || "",
      lead_quality: parsed.lead_quality || "",
      summary: parsed.summary || "",
    };
  } catch (err) {
    console.error("extractLeadInsights error:", err);
    return null;
  }
}

module.exports = {
  extractLeadInsights,
};