require("dotenv").config();

const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function extractBooking({ business, customerMemory, userText, aiAnswer }) {
  const prompt = `
Ты анализируешь переписку клиента с бизнесом.

Бизнес:
${business.name}
Ниша: ${business.niche || "не указано"}

Память о клиенте:
${customerMemory}

Последнее сообщение клиента:
${userText}

Ответ AI:
${aiAnswer}

Твоя задача — понять, готова ли заявка/запись.

Верни СТРОГО JSON без markdown:

{
  "booking_ready": true/false,
  "customer_name": "",
  "customer_phone": "",
  "service": "",
  "address": "",
  "preferred_time": "",
  "notes": ""
}

Правила:
- booking_ready = true только если клиент реально хочет записаться/оставить заявку/заказать/замер/консультацию.
- Если данных не хватает, booking_ready = false.
- Не придумывай данные.
- Если имени нет, оставь пустым.
- Если телефона нет, но user_id WhatsApp является номером, оставь customer_phone пустым.
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: "Ты CRM-аналитик. Отвечай только валидным JSON.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  try {
    return JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    console.error("Booking JSON parse error:", completion.choices[0].message.content);
    return {
      booking_ready: false,
      customer_name: "",
      customer_phone: "",
      service: "",
      address: "",
      preferred_time: "",
      notes: "",
    };
  }
}

module.exports = {
  extractBooking,
};