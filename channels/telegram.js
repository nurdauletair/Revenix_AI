require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { handleMessage } = require("../server");
const supabase = require("../database/supabase");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

if (!TELEGRAM_TOKEN) {
  throw new Error("TELEGRAM_TOKEN не найден в .env");
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

let currentBusiness = null;

// ======================
// LOAD BUSINESS
// ======================

async function loadBusiness() {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("telegram_bot_token", TELEGRAM_TOKEN)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("Business load error:", error);
    throw error;
  }

  if (!data) {
    throw new Error("Бизнес с этим TELEGRAM_TOKEN не найден в businesses");
  }

  currentBusiness = data;
  console.log(`✅ Telegram bot запущен для бизнеса: ${data.name}`);
}

loadBusiness();

// ======================
// ADMIN CHECK FROM DATABASE
// ======================

async function isAdmin(userId) {
  if (!currentBusiness) return false;

  const { data, error } = await supabase
    .from("admins")
    .select("id")
    .eq("business_id", currentBusiness.id)
    .eq("telegram_user_id", String(userId))
    .maybeSingle();

  if (error) {
    console.error("Admin check error:", error);
    return false;
  }

  return !!data;
}

// ======================
// /clients
// ======================

bot.onText(/\/clients/, async (msg) => {
  const isUserAdmin = await isAdmin(msg.chat.id);
  if (!isUserAdmin) return;

  if (!currentBusiness) {
    return bot.sendMessage(msg.chat.id, "Бизнес ещё не загружен");
  }

  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("business_id", currentBusiness.id)
    .order("last_message_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("Clients error:", error);
    return bot.sendMessage(msg.chat.id, "Ошибка при получении клиентов");
  }

  if (!data || !data.length) {
    return bot.sendMessage(msg.chat.id, "Нет клиентов");
  }

  let text = `📋 Клиенты: ${currentBusiness.name}\n\n`;

  data.forEach((c, index) => {
    text += `${index + 1}. 👤 ${c.name || "Без имени"}\n`;
    text += `🔗 Канал: ${c.channel || "неизвестно"}\n`;
    text += `📞 Телефон: ${c.phone || "не указан"}\n`;
    text += `📍 Адрес: ${c.address || "не указан"}\n`;
    text += `🧾 Потребность: ${c.need || "не указана"}\n`;
    text += `📌 Статус: ${c.status || "new"}\n`;
    text += `🆔 User ID: ${c.user_id}\n\n`;
  });

  bot.sendMessage(msg.chat.id, text);
});

// ======================
// /leads
// ======================

bot.onText(/\/leads/, async (msg) => {
  const isUserAdmin = await isAdmin(msg.chat.id);
  if (!isUserAdmin) return;

  const { data, error } = await supabase
    .from("customers")
    .select("status")
    .eq("business_id", currentBusiness.id);

  if (error) {
    console.error("Leads error:", error);
    return bot.sendMessage(msg.chat.id, "Ошибка при получении лидов");
  }

  const stats = {};

  (data || []).forEach((c) => {
    const status = c.status || "new";
    stats[status] = (stats[status] || 0) + 1;
  });

  let text = `📊 Лиды: ${currentBusiness.name}\n\n`;

  for (let key in stats) {
    text += `${key}: ${stats[key]}\n`;
  }

  bot.sendMessage(msg.chat.id, text);
});

// ======================
// /stats
// ======================

bot.onText(/\/stats/, async (msg) => {
  const isUserAdmin = await isAdmin(msg.chat.id);
  if (!isUserAdmin) return;

  const { count: messagesCount } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("business_id", currentBusiness.id);

  const { count: customersCount } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("business_id", currentBusiness.id);

  const { count: telegramCount } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("business_id", currentBusiness.id)
    .eq("channel", "telegram");

  const { count: instagramCount } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("business_id", currentBusiness.id)
    .eq("channel", "instagram");

  const { count: whatsappCount } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("business_id", currentBusiness.id)
    .eq("channel", "whatsapp");

  const { count: requestCount } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("business_id", currentBusiness.id)
    .in("status", [
      "measurement_requested",
      "appointment_requested",
      "lead_ready"
    ]);

  const text = `
📈 Статистика: ${currentBusiness.name}

💬 Сообщений: ${messagesCount || 0}
👥 Клиентов: ${customersCount || 0}
🔥 Заявок: ${requestCount || 0}

Каналы:
Telegram: ${telegramCount || 0}
Instagram: ${instagramCount || 0}
WhatsApp: ${whatsappCount || 0}
`;

  bot.sendMessage(msg.chat.id, text);
});

// ======================
// /requests
// ======================

bot.onText(/\/requests/, async (msg) => {
  const isUserAdmin = await isAdmin(msg.chat.id);
  if (!isUserAdmin) return;

  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("business_id", currentBusiness.id)
    .in("status", [
      "measurement_requested",
      "appointment_requested",
      "lead_ready"
    ])
    .order("updated_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("Requests error:", error);
    return bot.sendMessage(msg.chat.id, "Ошибка при получении заявок");
  }

  if (!data || !data.length) {
    return bot.sendMessage(msg.chat.id, "Нет заявок");
  }

  let text = `🔥 Заявки: ${currentBusiness.name}\n\n`;

  data.forEach((c, index) => {
    text += `${index + 1}. 👤 ${c.name || "Без имени"}\n`;
    text += `🔗 Канал: ${c.channel || "неизвестно"}\n`;
    text += `📞 Телефон: ${c.phone || "не указан"}\n`;
    text += `📍 Адрес: ${c.address || "не указан"}\n`;
    text += `🧾 Потребность: ${c.need || "не указана"}\n`;
    text += `📌 Статус: ${c.status || "new"}\n`;

    if (c.extra_data && Object.keys(c.extra_data).length > 0) {
      text += `➕ Доп. данные: ${JSON.stringify(c.extra_data)}\n`;
    }

    text += "\n";
  });

  bot.sendMessage(msg.chat.id, text);
});

// ======================
// MESSAGE HANDLER
// ======================

bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text;


    if (!text) return;
    if (text.startsWith("/")) return;

    if (!currentBusiness) {
      return bot.sendMessage(chatId, "Бот ещё загружается. Попробуйте снова.");
    }

    bot.sendChatAction(chatId, "typing");

    const answer = await handleMessage({
      business: currentBusiness,
      channel: "telegram",
      userId: chatId,
      text
    });

    bot.sendMessage(chatId, answer);
  } catch (error) {
    console.error("Telegram message error:", error);

    bot.sendMessage(
      msg.chat.id,
      "Извините, сейчас техническая ошибка. Менеджер скоро ответит."
    );
  }
});