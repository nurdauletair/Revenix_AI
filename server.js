require("dotenv").config();

const OpenAI = require("openai");

const supabase = require("./database/supabase");

const { buildPrompt } = require("./ai/prompt");
const { extractBooking } = require("./ai/extractBooking");
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
} = require("./ai/memory");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

    // 2. if human already required, stop AI from continuing
    if (customer.human_required) {
      return "Ваш запрос уже передан менеджеру. Он скоро свяжется с вами 👌";
    }

    // 3. save user message
    await saveMessage({
      businessId: business.id,
      customerId: customer.id,
      chatId: userId,
      role: "user",
      content: text,
      channel,
    });

    // 4. update customer activity
    await updateCustomerLastMessage(customer.id);

    // 5. get conversation history
    const conversationMemory = await getConversationMemory(
      business.id,
      userId,
      channel
    );

    // 6. get customer memory
    const customerMemory = await getCustomerMemory(
      business.id,
      userId,
      channel
    );

    // 7. build system prompt
    const systemPrompt =
      buildPrompt(business, customer) +
      "\n\n" +
      customerMemory;

    // 8. ask AI
    const answer = await askAI(
      systemPrompt,
      conversationMemory,
      text
    );

    // 9. save AI message
    await saveMessage({
      businessId: business.id,
      customerId: customer.id,
      chatId: userId,
      role: "assistant",
      content: answer,
      channel,
    });

    // 10. update customer memory
    await updateCustomerMemory(
      business.id,
      userId,
      text,
      channel
    );

    // 11. extract booking and save to Supabase + Google Sheets
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
        });

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

    // 12. detect human handoff and notify admins
    try {
      const handoff = await detectHandoff({
        userText: text,
        aiAnswer: answer,
      });

      if (handoff?.handoff_required) {
        await supabase
          .from("customers")
          .update({
            human_required: true,
            human_requested_at: new Date().toISOString(),
            human_reason: handoff.reason || "Нужен менеджер",
            status: "human_required",
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