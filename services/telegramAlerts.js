require("dotenv").config();

const axios = require("axios");
const supabase = require("../database/supabase");

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_TOKEN;

  if (!token) {
    console.error("TELEGRAM_TOKEN is missing");
    return;
  }

  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  });
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

  const message = `
🚨 <b>Клиент просит менеджера</b>

🏢 Бизнес: ${business.name || "не указано"}
📲 Канал: ${channel}
👤 User ID: ${userId}

💬 <b>Сообщение клиента:</b>
${userText}

🤖 <b>Ответ AI:</b>
${aiAnswer}

📌 <b>Причина:</b>
${reason || "нужен менеджер"}

✅ Свяжитесь с клиентом как можно быстрее.
`;

  for (const admin of admins) {
    if (!admin.telegram_user_id) continue;

    try {
      await sendTelegramMessage(admin.telegram_user_id, message);
    } catch (err) {
      console.error("Telegram alert error:", err.response?.data || err.message);
    }
  }
}

module.exports = {
  notifyAdminsAboutHandoff,
};