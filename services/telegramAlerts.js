require("dotenv").config();

const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");
const supabase = require("../database/supabase");

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function limitText(value = "", max = 3000) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
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

async function sendTelegramPhoto(chatId, photoPath, caption, replyMarkup = null) {
  const token = process.env.TELEGRAM_TOKEN;

  if (!token) {
    console.error("TELEGRAM_TOKEN is missing");
    return;
  }

  const form = new FormData();

  form.append("chat_id", chatId);
  form.append("photo", fs.createReadStream(photoPath));
  form.append("caption", limitText(caption, 900));
  form.append("parse_mode", "HTML");

  if (replyMarkup) {
    form.append("reply_markup", JSON.stringify(replyMarkup));
  }

  await axios.post(
    `https://api.telegram.org/bot${token}/sendPhoto`,
    form,
    {
      headers: form.getHeaders(),
    }
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

function getAiButtons(userId) {
  return {
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
}

function getClientCardButton(channel, userId) {
  return {
    inline_keyboard: [
      [
        {
          text: "👤 Открыть карточку клиента",
          callback_data: `client:${channel}:${userId}`,
        },
      ],
    ],
  };
}

// ======================
// PHOTO LEAD ALERT
// Фото отправляем с короткой подписью.
// AI-анализ отправляем отдельным сообщением.
// ======================

async function notifyAdminsAboutPhotoLead({
  business,
  channel,
  userId,
  photoPath,
  caption,
  imageAnalysis,
}) {
  const admins = await getBusinessAdmins(business.id);

  if (!admins.length) {
    console.error("No admins found for business:", business.id);
    return;
  }

  const shortCaption = `
📸 <b>Клиент отправил фото</b>

🏢 <b>Бизнес:</b> ${escapeHtml(business.name || "не указано")}
📲 <b>Канал:</b> ${escapeHtml(channel || "не указано")}
👤 <b>User ID:</b> ${escapeHtml(userId)}

📝 <b>Подпись:</b> ${escapeHtml(caption || "нет")}
`;

  const analysisMessage = `
🤖 <b>AI-анализ фото</b>

${escapeHtml(limitText(imageAnalysis || "не удалось проанализировать", 3000))}

👤 <b>Клиент:</b> <code>${escapeHtml(userId)}</code>
`;

  for (const admin of admins) {
    if (!admin.telegram_user_id) continue;

    try {
      await sendTelegramPhoto(
        admin.telegram_user_id,
        photoPath,
        shortCaption,
        getClientCardButton(channel, userId)
      );

      await sendTelegramMessage(
        admin.telegram_user_id,
        analysisMessage,
        getClientCardButton(channel, userId)
      );
    } catch (err) {
      console.error(
        "Telegram photo lead alert error:",
        err.response?.data || err.message
      );
    }
  }
}

// ======================
// NEW BOOKING ALERT
// ======================

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
🔥 <b>Лид:</b> ${escapeHtml(booking.lead_quality || "hot")}

📝 <b>Заметки:</b>
${escapeHtml(booking.notes || "нет")}
`;

  for (const admin of admins) {
    if (!admin.telegram_user_id) continue;

    try {
      await sendTelegramMessage(
        admin.telegram_user_id,
        message,
        getClientCardButton(channel, userId)
      );
    } catch (err) {
      console.error(
        "Telegram booking alert error:",
        err.response?.data || err.message
      );
    }
  }
}

// ======================
// BOOKING UPDATE ALERT
// ======================

async function notifyAdminsAboutBookingUpdate({
  business,
  customer,
  oldBooking,
  newBooking,
  channel,
  userId,
}) {
  const admins = await getBusinessAdmins(business.id);

  if (!admins.length) {
    console.error("No admins found for business:", business.id);
    return;
  }

  const changes = [];

  if (oldBooking.preferred_time !== newBooking.preferred_time) {
    changes.push(
      `🕒 <b>Время:</b> ${escapeHtml(oldBooking.preferred_time || "не указано")} → ${escapeHtml(newBooking.preferred_time || "не указано")}`
    );
  }

  if (oldBooking.address !== newBooking.address) {
    changes.push(
      `📍 <b>Адрес:</b> ${escapeHtml(oldBooking.address || "не указано")} → ${escapeHtml(newBooking.address || "не указано")}`
    );
  }

  if (oldBooking.room_type !== newBooking.room_type) {
    changes.push(
      `🏠 <b>Комната:</b> ${escapeHtml(oldBooking.room_type || "не указано")} → ${escapeHtml(newBooking.room_type || "не указано")}`
    );
  }

  if (oldBooking.estimated_area !== newBooking.estimated_area) {
    changes.push(
      `📐 <b>Площадь:</b> ${escapeHtml(oldBooking.estimated_area || "не указано")} → ${escapeHtml(newBooking.estimated_area || "не указано")}`
    );
  }

  if (oldBooking.customer_name !== newBooking.customer_name) {
    changes.push(
      `👤 <b>Имя:</b> ${escapeHtml(oldBooking.customer_name || "не указано")} → ${escapeHtml(newBooking.customer_name || "не указано")}`
    );
  }

  const changeText = changes.length
    ? changes.join("\n")
    : "Данные заявки обновлены.";

  const message = `
🔄 <b>Заявка на замер обновлена</b>

🏢 <b>Бизнес:</b> ${escapeHtml(business.name || "не указано")}
📲 <b>Канал:</b> ${escapeHtml(channel || "не указано")}
👤 <b>Клиент:</b> ${escapeHtml(newBooking.customer_name || customer?.name || "не указано")}
📱 <b>Телефон:</b> ${escapeHtml(newBooking.customer_phone || userId || "не указано")}

${changeText}

📌 <b>Текущая заявка:</b>
💬 <b>Услуга:</b> ${escapeHtml(newBooking.service || "не указано")}
📍 <b>Адрес:</b> ${escapeHtml(newBooking.address || "не указано")}
🕒 <b>Время:</b> ${escapeHtml(newBooking.preferred_time || "не указано")}
🏠 <b>Комната:</b> ${escapeHtml(newBooking.room_type || "не указано")}
📐 <b>Площадь:</b> ${escapeHtml(newBooking.estimated_area || "не указано")}
`;

  for (const admin of admins) {
    if (!admin.telegram_user_id) continue;

    try {
      await sendTelegramMessage(
        admin.telegram_user_id,
        message,
        getClientCardButton(channel, userId)
      );
    } catch (err) {
      console.error(
        "Telegram booking update alert error:",
        err.response?.data || err.message
      );
    }
  }
}

// ======================
// HUMAN HANDOFF ALERT
// ======================

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

  for (const admin of admins) {
    if (!admin.telegram_user_id) continue;

    try {
      await sendTelegramMessage(
        admin.telegram_user_id,
        message,
        getAiButtons(userId)
      );
    } catch (err) {
      console.error(
        "Telegram handoff alert error:",
        err.response?.data || err.message
      );
    }
  }
}

module.exports = {
  sendTelegramMessage,
  sendTelegramPhoto,
  notifyAdminsAboutHandoff,
  notifyAdminsAboutBooking,
  notifyAdminsAboutBookingUpdate,
  notifyAdminsAboutPhotoLead,
};