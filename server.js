require("dotenv").config();

const OpenAI = require("openai");

const supabase = require("./database/supabase");

const { buildPrompt } = require("./ai/prompt");
const { extractBooking } = require("./ai/extractBooking");
const { extractLeadInsights } = require("./ai/extractLeadInsights");
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
  const lower = text.toLowerCase();

  const keywords = [
    "менеджер",
    "оператор",
    "человек",
    "живой",
    "позвоните",
    "перезвоните",
    "свяжитесь",
    "хочу поговорить",
    "адам",
    "қоңырау",
    "менеджермен",
  ];

  return keywords.some((word) => lower.includes(word));
}

// =========================
// AI ASK FUNCTION
// =========================

async function askAI(systemPrompt, history, text) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
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

    // 5. direct handoff by keywords — fast path, no need to wait AI
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

    // 12. extract lead insights and update smart CRM
    let insights = null;

    try {
      insights = await extractLeadInsights({
        business,
        customerMemory,
        userText: text,
        aiAnswer: answer,
      });

      if (insights) {
        await updateCustomerInsights(customer.id, insights);

        console.log("🧠 Lead insights updated:", {
          userId,
          lead_stage: insights.lead_stage,
          intent: insights.intent,
          lead_quality: insights.lead_quality,
          room_type: insights.room_type,
          estimated_area: insights.estimated_area,
        });
      }
    } catch (insightsError) {
      console.error("Lead insights error:", insightsError);
    }

    let bookingCreated = false;

    // 13. extract booking and save to Supabase + Google Sheets
    try {
      const bookingData = await extractBooking({
        business,
        customerMemory,
        userText: text,
        aiAnswer: answer,
      });

      if (bookingData?.booking_ready) {
        await createBooking({
          business,
          customer,
          customerName: bookingData.customer_name,
          customerPhone: bookingData.customer_phone,
          service: bookingData.service,
          address: bookingData.address,
          preferredTime: bookingData.preferred_time,
          notes: bookingData.notes,
          userId,
          channel,

          // Smart CRM fields
          roomType: insights?.room_type || null,
          estimatedArea: insights?.estimated_area || null,
          urgency: insights?.urgency || null,
          leadQuality: insights?.lead_quality || "warm",
          intent: insights?.intent || bookingData.service || null,
          managerRequired: false,
        });

        bookingCreated = true;

        await supabase
          .from("customers")
          .update({
            status: "booking_created",
            lead_stage: "booking_created",
            updated_at: new Date().toISOString(),
          })
          .eq("id", customer.id);

        console.log("✅ Booking created:", {
          business: business.name,
          userId,
          channel,
          service: bookingData.service,
          preferredTime: bookingData.preferred_time,
        });
      }
    } catch (bookingError) {
      console.error("Booking extraction/save error:", bookingError);
    }

    if (bookingCreated) {
      return answer;
    }

    // 14. detect human handoff with AI fallback
    try {
      const handoff = await detectHandoff({
        userText: text,
        aiAnswer: answer,
      });

      console.log("HANDOFF RESULT:", handoff);

      if (handoff?.handoff_required) {
        await supabase
          .from("customers")
          .update({
            human_required: true,
            human_requested_at: new Date().toISOString(),
            human_reason: handoff.reason || "Нужен менеджер",
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
          aiAnswer: answer,
          reason: handoff.reason,
        });

        console.log("🚨 Human handoff requested:", {
          business: business.name,
          userId,
          channel,
          reason: handoff.reason,
        });
      }
    } catch (handoffError) {
      console.error("Handoff detection error:", handoffError);
    }

    return answer;
  } catch (err) {
    console.error("AI ERROR:", err);

    return "Извините, сейчас техническая ошибка. Менеджер скоро ответит.";
  }
}

module.exports = {
  handleMessage,
};