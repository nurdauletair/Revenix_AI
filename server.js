require("dotenv").config();

const OpenAI = require("openai");

const supabase = require("./database/supabase");

const { buildPrompt } = require("./ai/prompt");
const { extractCRM } = require("./ai/extractCRM");

const {
  createBooking,
  findActiveBooking,
  updateBooking,
} = require("./database/bookings");

const {
  notifyAdminsAboutHandoff,
  notifyAdminsAboutBooking,
  notifyAdminsAboutBookingUpdate,
} = require("./services/telegramAlerts");

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
    // RU
    "менеджер",
    "оператор",
    "живой человек",
    "можно с человеком",
    "можно с менеджером",
    "можно с оператором",
    "хочу поговорить с человеком",
    "хочу поговорить с менеджером",
    "позвоните",
    "перезвоните",
    "свяжитесь со мной",
    "нужен менеджер",
    "дайте менеджера",

    // KZ
    "менеджермен",
    "оператормен",
    "адаммен сөйлесейін",
    "менеджермен сөйлесейін",
    "оператормен сөйлесейін",
    "қоңырау шалыңыз",
    "маған қоңырау шалыңыз",
    "хабарласыңыз",
    "менеджер керек",
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
// BOOKING CHANGE CHECK
// =========================

function hasImportantBookingChanges(oldBooking, newBooking) {
  return (
    oldBooking.preferred_time !== newBooking.preferred_time ||
    oldBooking.address !== newBooking.address ||
    oldBooking.room_type !== newBooking.room_type ||
    oldBooking.estimated_area !== newBooking.estimated_area ||
    oldBooking.customer_name !== newBooking.customer_name
  );
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

    if (!crm.booking_ready) return;

    const activeBooking = await findActiveBooking({
      businessId: business.id,
      userId,
      channel,
    });

    if (!activeBooking) {
      const booking = await createBooking({
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
        leadQuality: crm.lead_quality || "hot",
        intent: crm.intent || crm.service || business.niche || null,
        managerRequired: crm.manager_required || false,
      });

      await supabase
        .from("customers")
        .update({
          status: "booking_created",
          lead_stage: "booking_created",
          lead_quality: "hot",
          updated_at: new Date().toISOString(),
        })
        .eq("id", customer.id);

      await notifyAdminsAboutBooking({
        business,
        customer,
        booking,
        channel,
        userId,
      });

      console.log("✅ Booking created from CRM:", {
        business: business.name,
        userId,
        channel,
        service: booking.service,
        preferredTime: booking.preferred_time,
      });

      return;
    }

    const newBooking = await updateBooking({
      bookingId: activeBooking.id,

      customerName: crm.customer_name,
      customerPhone: crm.customer_phone,
      service: crm.service || crm.intent || business.niche,
      address: crm.address,
      preferredTime: crm.preferred_time,
      notes: crm.notes,

      roomType: crm.room_type || null,
      estimatedArea: crm.estimated_area || null,
      urgency: crm.urgency || null,
      leadQuality: crm.lead_quality || "hot",
      intent: crm.intent || crm.service || business.niche || null,
      managerRequired: crm.manager_required || false,
    });

    if (hasImportantBookingChanges(activeBooking, newBooking)) {
      await notifyAdminsAboutBookingUpdate({
        business,
        customer,
        oldBooking: activeBooking,
        newBooking,
        channel,
        userId,
      });

      console.log("🔄 Booking updated from CRM:", {
        business: business.name,
        userId,
        channel,
        oldTime: activeBooking.preferred_time,
        newTime: newBooking.preferred_time,
      });

      return;
    }

    console.log("⏭️ Booking exists, no important changes:", {
      userId,
      channel,
    });
  } catch (err) {
    console.error("Background CRM processing error:", err);
  }
}

// =========================
// UNIVERSAL MESSAGE HANDLER
// =========================

async function handleMessage({ business, channel, userId, text }) {
  try {
    const customer = await getOrCreateCustomer(
      business.id,
      userId,
      channel
    );

    await saveMessage({
      businessId: business.id,
      customerId: customer.id,
      chatId: userId,
      role: "user",
      content: text,
      channel,
    });

    await updateCustomerLastMessage(customer.id);

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

    const conversationMemory = await getConversationMemory(
      business.id,
      userId,
      channel
    );

    const customerMemory = await getCustomerMemory(
      business.id,
      userId,
      channel
    );

    const systemPrompt =
      buildPrompt(business, customer) +
      "\n\n" +
      customerMemory;

    const answer = await askAI(
      systemPrompt,
      conversationMemory,
      text
    );

    await saveMessage({
      businessId: business.id,
      customerId: customer.id,
      chatId: userId,
      role: "assistant",
      content: answer,
      channel,
    });

    await updateCustomerMemory(
      business.id,
      userId,
      text,
      channel
    );

    const conversationText = conversationMemory
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    processCRMInBackground({
      business,
      customer,
      customerMemory,
      conversationText,
      userText: text,
      aiAnswer: answer,
      userId,
      channel,
    }).catch((err) => {
      console.error("CRM background error:", err);
    });

    return answer;
  } catch (err) {
    console.error("AI ERROR:", err);

    return "Извините, сейчас техническая ошибка. Менеджер скоро ответит.";
  }
}

module.exports = {
  handleMessage,
};