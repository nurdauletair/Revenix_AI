require("dotenv").config();

const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function extractJson(text) {
  try {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
}

async function extractCRM({
  business,
  customerMemory,
  userText,
  aiAnswer,
  userId,
  channel,
}) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
Ты CRM-аналитик и sales operations assistant для бизнеса.

Ты анализируешь последнее сообщение клиента и ответ AI.
Твоя задача — обновить CRM и понять, готова ли заявка.

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
  "summary": "",

  "booking_ready": false,
  "customer_name": "",
  "customer_phone": "",
  "service": "",
  "address": "",
  "preferred_time": "",
  "notes": "",
  "manager_required": false
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

Правила CRM:
- Не придумывай данные.
- Если данных нет, ставь пустую строку.
- Если клиент спрашивает цену, lead_stage = "price_question".
- Если AI предложил замер, lead_stage = "measurement_offered".
- Если клиент согласен на замер или пишет время/адрес, lead_stage = "measurement_requested".
- Если клиент просит менеджера/человека/звонок, lead_stage = "human_required".
- hot = клиент готов к замеру/заявке.
- warm = интересуется, но ещё не готов.
- cold = просто спрашивает или сомневается.

Правила booking:
- booking_ready = true, если клиент реально оставил заявку/записался на замер/согласился на замер и есть минимум:
  1) адрес или место
  2) время или дата
  3) услуга/намерение
- Если имени нет, customer_name = "".
- Если клиент написал "этот номер", "осы нөмір", "мой номер", и канал WhatsApp, customer_phone = userId.
- Если телефона нет, но channel = whatsapp и userId похож на номер телефона, можно использовать userId как customer_phone.
- Не создавай booking, если клиент просто спрашивает цену и ещё не согласился на замер.
- Если заявка готова, lead_stage = "booking_created".
- Если клиент просит именно менеджера, manager_required = true.

Правила service:
- service должен соответствовать текущей нише бизнеса.
- Если бизнес занимается натяжными потолками, service = "бесплатный замер натяжного потолка" или "натяжные потолки".
- Не используй старую услугу из памяти, если последнее сообщение клиента про другую услугу.
- Не ставь "жалюзи", если последнее сообщение клиента не про жалюзи.
- Если точная услуга не ясна, используй нишу бизнеса.

Для WhatsApp:
- phone НЕ обязателен для booking_ready.
- Если channel = "whatsapp", всегда используй userId как customer_phone.
- Не ставь booking_ready=false только из-за отсутствия телефона.
- Для WhatsApp заявка готова, если есть адрес, время и услуга/намерение.
          `,
        },
        {
          role: "user",
          content: `
Бизнес:
${business.name || ""}
Ниша бизнеса:
${business.niche || ""}

Канал:
${channel || ""}

User ID:
${userId || ""}

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

    console.log("CRM RAW:", raw);

    const parsed = extractJson(raw);

    if (!parsed) {
      console.error("CRM parse error:", raw);

      return {
        lead_stage: "",
        intent: "",
        objection: "",
        budget: "",
        room_type: "",
        estimated_area: "",
        urgency: "",
        lead_quality: "",
        summary: "",

        booking_ready: false,
        customer_name: "",
        customer_phone: "",
        service: "",
        address: "",
        preferred_time: "",
        notes: "",
        manager_required: false,
      };
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

      booking_ready: !!parsed.booking_ready,
      customer_name: parsed.customer_name || "",
      customer_phone: parsed.customer_phone || (channel === "whatsapp" ? String(userId) : ""),
      service: parsed.service || "",
      address: parsed.address || "",
      preferred_time: parsed.preferred_time || "",
      notes: parsed.notes || "",
      manager_required: !!parsed.manager_required,
    };
  } catch (err) {
    console.error("extractCRM error:", err);

    return {
      lead_stage: "",
      intent: "",
      objection: "",
      budget: "",
      room_type: "",
      estimated_area: "",
      urgency: "",
      lead_quality: "",
      summary: "",

      booking_ready: false,
      customer_name: "",
      customer_phone: "",
      service: "",
      address: "",
      preferred_time: "",
      notes: "",
      manager_required: false,
    };
  }
}

module.exports = {
  extractCRM,
};