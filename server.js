require("dotenv").config();

const OpenAI = require("openai");

const supabase = require("./database/supabase");

const { buildPrompt } = require("./ai/prompt");
const { extractCRM } = require("./ai/extractCRM");
const { createBooking } = require("./database/bookings");
const { detectHandoff } = require("./ai/detectHandoff");
const { notifyAdminsAboutHandoff } = require("./services/telegramAlerts");

const {
  getOrCreateCustomer,
  getConversationMemory,
  getCustomerMemory,
  saveMessage,
  updateCustomerMemory,
  updateCustomerLastMessage,
  updateCustomerInsights,
} = require("./ai/memory");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =========================
// DIRECT HANDOFF KEYWORDS
// =========================

function isDirectHandoffRequest(text = "") {
  const lower = String(text).toLowerCase();

  const keywords = [
    "менеджер",
    "оператор",
    "человек",
    "живой",
    "живой человек",
    "позвоните",
    "перезвоните",
    "свяжитесь",
    "свяжитесь со мной",
    "хочу поговорить",
    "можно с человеком",
    "адам",
    "қоңырау",
    "қоңырау шалыңыз",
    "хабарласыңыз",
    "менеджермен",
    "оператормен",
  ];

  return keywords.some((word) => lower.includes(word));
}

// =========================
// AI ASK FUNCTION
// =========================

async function askAI(systemPrompt, history, text) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      ...history,
      {
        role: "user",
        content: text,
      },
    ],
  });

  return completion.choices[0].message.content;
}

// =========================
// BACKGROUND CRM PROCESSING
// =========================

async function processCRMInBackground({
  business,
  customer,
  customerMemory,
  conversationText,
  userText,
  aiAnswer,
  userId,
  channel,
}) {
  try {
    const crm = await extractCRM({
      business,
      customerMemory,
      conversationText,
      userText,
      aiAnswer,
      userId,
      channel,
    });

    if (!crm) return;

    await updateCustomerInsights(customer.id, crm);

    console.log("🧠 CRM updated:", {
      userId,
      lead_stage: crm.lead_stage,
      intent: crm.intent,
      lead_quality: crm.lead_quality,
      booking_ready: crm.booking_ready,
    });

    if (crm.booking_ready) {
      await createBooking({
        business,
        customer,

        customerName: crm.customer_name,
        customerPhone: crm.customer_phone,
        service: crm.service || crm.intent || business.niche,
        address: crm.address,
        preferredTime: crm.preferred_time,
        notes: crm.notes,

        userId,
        channel,

        roomType: crm.room_type || null,
        estimatedArea: crm.estimated_area || null,
        urgency: crm.urgency || null,
        leadQuality: crm.lead_quality || "warm",
        intent: crm.intent || crm.service || business.niche || null,
        managerRequired: crm.manager_required || false,
      });

      await supabase
        .from("customers")
        .update({
          status: "booking_created",
          lead_stage: "booking_created",
          updated_at: new Date().toISOString(),
        })
        .eq("id", customer.id);

      console.log("✅ Booking created from CRM:", {
        business: business.name,
        userId,
        channel,
        service: crm.service,
        preferredTime: crm.preferred_time,
      });
    }
  } catch (err) {
    console.error("Background CRM processing error:", err);
  }
}

// =========================
// UNIVERSAL MESSAGE HANDLER
// =========================

async function handleMessage({ business, channel, userId, text }) {
  try {
    // 1. find or create customer
    const customer = await getOrCreateCustomer(
      business.id,
      userId,
      channel
    );

    // 2. save user message immediately
    await saveMessage({
      businessId: business.id,
      customerId: customer.id,
      chatId: userId,
      role: "user",
      content: text,
      channel,
    });

    // 3. update customer activity
    await updateCustomerLastMessage(customer.id);

    // 4. if human already required, notify admin again and stop AI
    if (customer.human_required) {
      await notifyAdminsAboutHandoff({
        business,
        customer,
        channel,
        userId,
        userText: text,
        aiAnswer: "Клиент уже ожидает менеджера.",
        reason:
          customer.human_reason ||
          "Клиент повторно написал после передачи менеджеру",
      });

      return "Ваш запрос уже передан менеджеру. Он скоро свяжется с вами 👌";
    }

    // 5. direct handoff by keywords — fast path, no OpenAI
    if (isDirectHandoffRequest(text)) {
      await supabase
        .from("customers")
        .update({
          human_required: true,
          human_requested_at: new Date().toISOString(),
          human_reason: "Клиент попросил менеджера/звонок",
          status: "human_required",
          lead_stage: "human_required",
          updated_at: new Date().toISOString(),
        })
        .eq("id", customer.id);

      await notifyAdminsAboutHandoff({
        business,
        customer,
        channel,
        userId,
        userText: text,
        aiAnswer: "Клиент напрямую попросил менеджера.",
        reason: "Клиент попросил менеджера/звонок",
      });

      console.log("🚨 Direct human handoff:", {
        business: business.name,
        userId,
        channel,
      });

      return "Сейчас передам менеджеру, он свяжется с вами 👌";
    }

    // 6. get conversation history
    const conversationMemory = await getConversationMemory(
      business.id,
      userId,
      channel
    );

    // 7. get customer memory
    const customerMemory = await getCustomerMemory(
      business.id,
      userId,
      channel
    );

    // 8. build system prompt
    const systemPrompt =
      buildPrompt(business, customer) +
      "\n\n" +
      customerMemory;

    // 9. ask AI
    const answer = await askAI(
      systemPrompt,
      conversationMemory,
      text
    );

    // 10. save AI message
    await saveMessage({
      businessId: business.id,
      customerId: customer.id,
      chatId: userId,
      role: "assistant",
      content: answer,
      channel,
    });

    // 11. update customer memory
    await updateCustomerMemory(
      business.id,
      userId,
      text,
      channel
    );

    // 12. process CRM + booking in background
    const conversationText = conversationMemory
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

    processCRMInBackground({
      business,
      customer,
      customerMemory,
      userText: text,
      aiAnswer: answer,
      userId,
      channel,
    }).catch((err) => {
      console.error("CRM background error:", err);
    });

    // 13. return answer immediately
    return answer;
  } catch (err) {
    console.error("AI ERROR:", err);

    return "Извините, сейчас техническая ошибка. Менеджер скоро ответит.";
  }
}

module.exports = {
  handleMessage,
};