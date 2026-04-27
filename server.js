require("dotenv").config();

const OpenAI = require("openai");

const { buildPrompt } = require("./ai/prompt");

const {
  getOrCreateCustomer,
  getConversationMemory,
  getCustomerMemory,
  saveMessage,
  updateCustomerMemory,
  updateCustomerLastMessage
} = require("./ai/memory");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
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
        content: systemPrompt
      },
      ...history,
      {
        role: "user",
        content: text
      }
    ]
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

    // 2. save user message
    await saveMessage({
      businessId: business.id,
      customerId: customer.id,
      chatId: userId,
      role: "user",
      content: text,
      channel
    });

    // 3. update customer activity
    await updateCustomerLastMessage(customer.id);

    // 4. get conversation history
    const conversationMemory = await getConversationMemory(
      business.id,
      userId,
      channel
    );

    // 5. get customer memory
    const customerMemory = await getCustomerMemory(
      business.id,
      userId,
      channel
    );

    // 6. build system prompt
    const systemPrompt =
      buildPrompt(business, customer) +
      "\n\n" +
      customerMemory;

    // 7. ask AI
    const answer = await askAI(
      systemPrompt,
      conversationMemory,
      text
    );

    // 8. save AI message
    await saveMessage({
      businessId: business.id,
      customerId: customer.id,
      chatId: userId,
      role: "assistant",
      content: answer,
      channel
    });

    // 9. update customer memory
    await updateCustomerMemory(
      business.id,
      userId,
      text,
      channel
    );

    return answer;
  } catch (err) {
    console.error("AI ERROR:", err);
    return "Извините, сейчас техническая ошибка. Менеджер скоро ответит.";
  }
}

module.exports = {
  handleMessage
};