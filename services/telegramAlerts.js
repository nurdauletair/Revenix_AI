require("dotenv").config();

const axios = require("axios");
const supabase = require("../database/supabase");

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const token = process.env.TELEGRAM_TOKEN;

  if (!token) {
    console.error("TELEGRAM_TOKEN is missing");
    return;
  }

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    payload
  );
}

async function notifyAdminsAboutHandoff({
  business,
  customer,
  channel,
  userId,
  userText,
  aiAnswer,
  reason,
}) {
  const { data: admins, error } = await supabase
    .from("admins")
    .select("*")
    .eq("business_id", business.id);

  if (error) {
    console.error("Admins find error:", error);
    return;
  }

  if (!admins || admins.length === 0) {
    console.error("No admins found for business:", business.id);
    return;
  }

  const safeUserText = userText || "не указано";
  const safeAiAnswer = aiAnswer || "не указано";
  const safeReason = reason || "нужен менеджер";

  const message = `
🚨 <b>Клиент просит менеджера</b>

🏢 <b>Бизнес:</b> ${business.name || "не указано"}
📲 <b>Канал:</b> ${channel}
👤 <b>User ID:</b> ${userId}

💬 <b>Сообщение клиента:</b>
${safeUserText}

🤖 <b>Ответ AI:</b>
${safeAiAnswer}

📌 <b>Причина:</b>
${safeReason}

✅ Свяжитесь с клиентом как можно быстрее.

Команды:
✅ Вернуть AI: /ai_on ${userId}
⛔ Оставить менеджеру: /ai_off ${userId}
`;

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: "✅ Вернуть AI",
          callback_data: `ai_on:${userId}`,
        },
      ],
      [
        {
          text: "⛔ Оставить менеджеру",
          callback_data: `ai_off:${userId}`,
        },
      ],
    ],
  };

  for (const admin of admins) {
    if (!admin.telegram_user_id) continue;

    try {
      await sendTelegramMessage(
        admin.telegram_user_id,
        message,
        replyMarkup
      );
    } catch (err) {
      console.error(
        "Telegram alert error:",
        err.response?.data || err.message
      );
    }
  }
}

module.exports = {
  notifyAdminsAboutHandoff,
};