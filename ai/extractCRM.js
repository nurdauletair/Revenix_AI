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

function looksLikePhone(value = "") {
  return /^\d{10,15}$/.test(String(value));
}

function normalizePhone({ parsedPhone, userId, channel }) {
  if (parsedPhone) return String(parsedPhone);

  if (channel === "whatsapp" && looksLikePhone(userId)) {
    return String(userId);
  }

  return "";
}

function isBookingActuallyReady({ parsed, userId, channel }) {
  const hasAddress = !!String(parsed.address || "").trim();
  const hasTime = !!String(parsed.preferred_time || "").trim();
  const hasServiceOrIntent =
    !!String(parsed.service || "").trim() ||
    !!String(parsed.intent || "").trim();

  const hasPhone =
    !!String(parsed.customer_phone || "").trim() ||
    (channel === "whatsapp" && looksLikePhone(userId));

  // Для WhatsApp телефон не обязателен как отдельное поле, потому что он есть в userId.
  // Но адрес + время + услуга обязательны.
  if (channel === "whatsapp") {
    return hasAddress && hasTime && hasServiceOrIntent;
  }

  // Для Telegram/Instagram телефон лучше требовать.
  return hasAddress && hasTime && hasServiceOrIntent && hasPhone;
}

async function extractCRM({
  business,
  customerMemory,
  conversationText,
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

ЖЁСТКИЕ правила booking:
- booking_ready = true только если клиент реально оставил заявку/записался на замер/согласился на замер.
- Для заявки ОБЯЗАТЕЛЬНЫ:
  1) address
  2) preferred_time
  3) service или intent
- Если address пустой, booking_ready ОБЯЗАТЕЛЬНО false.
- Если preferred_time пустой, booking_ready ОБЯЗАТЕЛЬНО false.
- Если нет service/intent, booking_ready ОБЯЗАТЕЛЬНО false.
- Не создавай booking, если клиент просто спрашивает цену и ещё не согласился на замер.
- Если заявка готова, lead_stage = "booking_created".
- Если клиент просит именно менеджера, manager_required = true.

Правила телефона:
- Для WhatsApp phone НЕ обязателен для booking_ready.
- Если channel = "whatsapp", customer_phone = userId.
- Если клиент написал "этот номер", "осы нөмір", "мой номер", customer_phone = userId.
- Не ставь booking_ready=false только из-за отсутствия телефона в WhatsApp.
- Для Telegram/Instagram, если телефон не указан, customer_phone = "".

Правила address:
- Адрес — это улица, район, ЖК, дом, офис, место, например: "Төле би 45", "Абая 10", "БЦ Avenue офис 209".
- "холл", "кухня", "зал", "спальня", "25 квадрат" НЕ являются адресом.
- Не записывай комнату как address.
- Комнату записывай в room_type.

Правила room_type:
- Если клиент пишет "холл", "зал", "кухня", "спальня", "офис", запиши это в room_type.
- Не путай room_type с address.

Правила service:
- service должен соответствовать текущей нише бизнеса.
- Если бизнес занимается натяжными потолками, service = "бесплатный замер натяжного потолка" или "натяжные потолки".
- Не используй старую услугу из памяти, если последнее сообщение клиента про другую услугу.
- Не ставь "жалюзи", если последнее сообщение клиента не про жалюзи.
- Если точная услуга не ясна, используй нишу бизнеса.

Правила имени:
- Если клиент назвал имя, заполни customer_name.
- Если имени нет, customer_name = "".
- Отсутствие имени НЕ блокирует booking_ready, если есть address + preferred_time + service/intent.
- Если клиент написал имя отдельно, например "Нұрдәулет", "Айбек", "Геннадий", это customer_name.
- Если в последнем диалоге клиент сначала написал имя, а потом адрес отдельным сообщением, сохрани имя в customer_name.
- Не теряй имя, если оно было указано в предыдущем сообщении.

Правила использования истории:
- Анализируй не только последнее сообщение, но и весь последний диалог.
- Если площадь/комната были указаны раньше в диалоге, используй их.
- Если клиент сначала написал "залға 28 квадрат", а потом написал имя и адрес, заявка должна содержать:
  room_type = "зал"
  estimated_area = "28 м²"
- Не теряй данные, которые клиент уже сообщил раньше.
- Если клиент отправил данные несколькими сообщениями, собери их вместе:
  имя из одного сообщения,
  адрес из другого,
  время из предыдущего,
  площадь/комнату из предыдущего.

  Анализируй весь последний диалог, а не только последнее сообщение.
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

Последний диалог:
${conversationText || ""}


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

    const customerPhone = normalizePhone({
      parsedPhone: parsed.customer_phone,
      userId,
      channel,
    });

    const bookingReady = isBookingActuallyReady({
      parsed,
      userId,
      channel,
    });

    const leadStage = bookingReady
      ? "booking_created"
      : parsed.lead_stage || "";

    return {
      lead_stage: leadStage,
      intent: parsed.intent || "",
      objection: parsed.objection || "",
      budget: parsed.budget || "",
      room_type: parsed.room_type || "",
      estimated_area: parsed.estimated_area || "",
      urgency: parsed.urgency || "",
      lead_quality: parsed.lead_quality || "",
      summary: parsed.summary || "",

      booking_ready: bookingReady,
      customer_name: parsed.customer_name || "",
      customer_phone: customerPhone,
      service: parsed.service || parsed.intent || business.niche || "",
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