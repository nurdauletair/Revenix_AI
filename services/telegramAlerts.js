require("dotenv").config();

const axios = require("axios");
const supabase = require("../database/supabase");

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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

async function getBusinessAdmins(businessId) {
  const { data: admins, error } = await supabase
    .from("admins")
    .select("*")
    .eq("business_id", businessId);

  if (error) {
    console.error("Admins find error:", error);
    return [];
  }

  return admins || [];
}

async function notifyAdminsAboutBooking({
  business,
  customer,
  booking,
  channel,
  userId,
}) {
  const admins = await getBusinessAdmins(business.id);

  if (!admins.length) {
    console.error("No admins found for business:", business.id);
    return;
  }

  const message = `
🔥 <b>Новая заявка на замер</b>

🏢 <b>Бизнес:</b> ${escapeHtml(business.name || "не указано")}
📲 <b>Канал:</b> ${escapeHtml(channel || "не указано")}
👤 <b>Клиент:</b> ${escapeHtml(booking.customer_name || customer?.name || "не указано")}
📱 <b>Телефон:</b> ${escapeHtml(booking.customer_phone || userId || "не указано")}

💬 <b>Услуга:</b> ${escapeHtml(booking.service || "не указано")}
📍 <b>Адрес:</b> ${escapeHtml(booking.address || "не указано")}
🕒 <b>Время:</b> ${escapeHtml(booking.preferred_time || "не указано")}

🏠 <b>Комната:</b> ${escapeHtml(booking.room_type || "не указано")}
📐 <b>Площадь:</b> ${escapeHtml(booking.estimated_area || "не указано")}
🔥 <b>Лид:</b> ${escapeHtml(booking.lead_quality || "warm")}

📝 <b>Заметки:</b>
${escapeHtml(booking.notes || "нет")}

Команды:
✅ Вернуть AI: /ai_on ${escapeHtml(userId)}
⛔ Оставить менеджеру: /ai_off ${escapeHtml(userId)}
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
      await sendTelegramMessage(admin.telegram_user_id, message, replyMarkup);
    } catch (err) {
      console.error("Telegram booking alert error:", err.response?.data || err.message);
    }
  }
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
  const admins = await getBusinessAdmins(business.id);

  if (!admins.length) {
    console.error("No admins found for business:", business.id);
    return;
  }

  const message = `
🚨 <b>Клиент просит менеджера</b>

🏢 <b>Бизнес:</b> ${escapeHtml(business.name || "не указано")}
📲 <b>Канал:</b> ${escapeHtml(channel || "не указано")}
👤 <b>User ID:</b> ${escapeHtml(userId)}

💬 <b>Сообщение клиента:</b>
${escapeHtml(userText || "не указано")}

🤖 <b>Ответ AI:</b>
${escapeHtml(aiAnswer || "не указано")}

📌 <b>Причина:</b>
${escapeHtml(reason || "нужен менеджер")}

✅ Свяжитесь с клиентом как можно быстрее.

Команды:
✅ Вернуть AI: /ai_on ${escapeHtml(userId)}
⛔ Оставить менеджеру: /ai_off ${escapeHtml(userId)}
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
      await sendTelegramMessage(admin.telegram_user_id, message, replyMarkup);
    } catch (err) {
      console.error("Telegram handoff alert error:", err.response?.data || err.message);
    }
  }
}

module.exports = {
  sendTelegramMessage,
  notifyAdminsAboutHandoff,
  notifyAdminsAboutBooking,
};