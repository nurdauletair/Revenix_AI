require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { handleMessage } = require("../server");
const supabase = require("../database/supabase");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

if (!TELEGRAM_TOKEN) {
  throw new Error("TELEGRAM_TOKEN не найден в .env");
}

const bot = new TelegramBot(TELEGRAM_TOKEN, {
  polling: {
    interval: 1000,
    autoStart: true,
    params: {
      timeout: 10,
    },
  },
});

bot.on("polling_error", (err) => {
  console.error("Telegram polling error:", {
    code: err.code,
    message: err.message,
    response: err.response?.body,
  });
});

let currentBusiness = null;

// ======================
// HELPERS
// ======================

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function leadEmoji(quality) {
  if (quality === "hot") return "🔥";
  if (quality === "warm") return "🟡";
  if (quality === "cold") return "❄️";
  return "⚪";
}

function formatDate(value) {
  if (!value) return "не указано";

  try {
    return new Date(value).toLocaleString("ru-RU", {
      timeZone: "Asia/Almaty",
    });
  } catch {
    return "не указано";
  }
}

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  return bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: replyMarkup || undefined,
  });
}

// ======================
// SET TELEGRAM COMMANDS MENU
// ======================

async function setTelegramCommands() {
  try {
    await bot.setMyCommands([
      {
        command: "chats",
        description: "Последние клиенты",
      },
      {
        command: "clients",
        description: "Карточка клиента по номеру",
      },
      {
        command: "requests",
        description: "Заявки",
      },
      {
        command: "stats",
        description: "Статистика",
      },
      {
        command: "leads",
        description: "Статусы лидов",
      },
      {
        command: "myid",
        description: "Узнать Telegram ID",
      },
    ]);

    console.log("✅ Telegram commands menu updated");
  } catch (err) {
    console.error("Set Telegram commands error:", err.message);
  }
}

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

loadBusiness()
  .then(() => setTelegramCommands())
  .catch((err) => {
    console.error("Telegram init error:", err);
  });

// ======================
// ADMIN CHECK
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
// CUSTOMER HELPERS
// ======================

async function findCustomerByUserId(userId, channel = null) {
  let query = supabase
    .from("customers")
    .select("*")
    .eq("business_id", currentBusiness.id)
    .eq("user_id", String(userId));

  if (channel) {
    query = query.eq("channel", channel);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("Customer find error:", error);
    throw error;
  }

  return data;
}

async function updateCustomerHumanMode({
  userId,
  humanRequired,
  reason = null,
}) {
  const payload = humanRequired
    ? {
        human_required: true,
        human_requested_at: new Date().toISOString(),
        human_reason: reason || "Отключено менеджером вручную",
        status: "human_required",
        lead_stage: "human_required",
        updated_at: new Date().toISOString(),
      }
    : {
        human_required: false,
        human_requested_at: null,
        human_reason: null,
        status: "new",
        updated_at: new Date().toISOString(),
      };

  const { data, error } = await supabase
    .from("customers")
    .update(payload)
    .eq("business_id", currentBusiness.id)
    .eq("user_id", String(userId))
    .select()
    .maybeSingle();

  if (error) {
    console.error("Human mode update error:", error);
    throw error;
  }

  return data;
}

// ======================
// CRM: RECENT CHATS
// ======================

async function getRecentChats() {
  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .eq("business_id", currentBusiness.id)
    .order("last_message_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Recent chats error:", error);
    throw error;
  }

  if (!customers || !customers.length) {
    return {
      text: "Пока клиентов нет.",
      buttons: null,
    };
  }

  const lines = customers.map((c, index) => {
    const emoji = leadEmoji(c.lead_quality);
    const name = c.name || c.user_id || "Без имени";
    const status = c.status || "new";
    const intent = c.intent || c.need || "интерес не указан";
    const time = formatDate(c.last_message_at);

    return `${index + 1}. ${emoji} <b>${escapeHtml(name)}</b>
📱 <code>${escapeHtml(c.user_id)}</code>
📲 ${escapeHtml(c.channel || "unknown")}
📌 ${escapeHtml(status)}
💬 ${escapeHtml(intent)}
🕒 ${escapeHtml(time)}
Команда: <code>/clients ${escapeHtml(c.user_id)}</code>`;
  });

  const text = `
📋 <b>Последние клиенты</b>

🏢 <b>Бизнес:</b> ${escapeHtml(currentBusiness.name || "не указано")}

${lines.join("\n\n")}
`;

  const buttons = {
    inline_keyboard: customers.map((c) => [
      {
        text: `${leadEmoji(c.lead_quality)} ${c.name || c.user_id}`,
        callback_data: `client:${c.channel}:${c.user_id}`,
      },
    ]),
  };

  return {
    text,
    buttons,
  };
}

// ======================
// CRM: CLIENT CARD
// ======================

async function getClientCard({ userId, channel = null }) {
  const customer = await findCustomerByUserId(userId, channel);

  if (!customer) {
    return {
      text: `Клиент <code>${escapeHtml(userId)}</code> не найден.`,
      buttons: null,
    };
  }

  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("business_id", currentBusiness.id)
    .eq("user_id", String(userId))
    .eq("channel", customer.channel)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: messages } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("business_id", currentBusiness.id)
    .eq("user_id", String(userId))
    .eq("channel", customer.channel)
    .order("created_at", { ascending: false })
    .limit(8);

  const recentMessages = (messages || [])
    .reverse()
    .map((m) => {
      const role = m.role === "assistant" ? "🤖 AI" : "👤 Клиент";
      return `<b>${role}:</b> ${escapeHtml(m.content || "")}`;
    })
    .join("\n\n");

  const text = `
👤 <b>Карточка клиента</b>

📱 <b>User ID:</b> <code>${escapeHtml(customer.user_id)}</code>
📲 <b>Канал:</b> ${escapeHtml(customer.channel || "не указано")}
🔥 <b>Лид:</b> ${escapeHtml(customer.lead_quality || "warm")}
📌 <b>Статус:</b> ${escapeHtml(customer.status || "new")}
🤖 <b>AI:</b> ${customer.human_required ? "ОТКЛЮЧЕН" : "включен"}

👤 <b>Имя:</b> ${escapeHtml(customer.name || booking?.customer_name || "не указано")}
📞 <b>Телефон:</b> ${escapeHtml(customer.phone || booking?.customer_phone || customer.user_id || "не указано")}

💬 <b>Интерес:</b> ${escapeHtml(customer.intent || customer.need || "не указано")}
❓ <b>Возражение:</b> ${escapeHtml(customer.objection || "не указано")}
🏠 <b>Комната:</b> ${escapeHtml(customer.room_type || booking?.room_type || "не указано")}
📐 <b>Площадь:</b> ${escapeHtml(customer.estimated_area || booking?.estimated_area || "не указано")}
🕒 <b>Срочность:</b> ${escapeHtml(customer.urgency || booking?.urgency || "не указано")}

📍 <b>Адрес:</b> ${escapeHtml(booking?.address || customer.address || "не указано")}
🕒 <b>Время замера:</b> ${escapeHtml(booking?.preferred_time || "не указано")}
🧾 <b>Услуга:</b> ${escapeHtml(booking?.service || "не указано")}

🕒 <b>Последняя активность:</b> ${escapeHtml(formatDate(customer.last_message_at))}

<b>Последние сообщения:</b>
${recentMessages || "Сообщений нет."}
`;

  const buttons = {
    inline_keyboard: [
      [
        {
          text: "✅ Вернуть AI",
          callback_data: `ai_on:${customer.user_id}`,
        },
      ],
      [
        {
          text: "⛔ Оставить менеджеру",
          callback_data: `ai_off:${customer.user_id}`,
        },
      ],
    ],
  };

  return {
    text,
    buttons,
  };
}

// ======================
// CALLBACK BUTTONS
// ======================

bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat?.id;
  const data = query.data;

  if (!chatId || !data) return;

  const isUserAdmin = await isAdmin(chatId);

  if (!isUserAdmin) {
    return bot.answerCallbackQuery(query.id, {
      text: "Нет доступа",
      show_alert: true,
    });
  }

  try {
    if (data.startsWith("client:")) {
      const [, channel, targetUserId] = data.split(":");

      const result = await getClientCard({
        userId: targetUserId,
        channel,
      });

      await bot.answerCallbackQuery(query.id, {
        text: "Карточка клиента",
      });

      return sendTelegramMessage(chatId, result.text, result.buttons);
    }

    const [action, userId] = data.split(":");

    if (!action || !userId) {
      return bot.answerCallbackQuery(query.id, {
        text: "Некорректная кнопка",
        show_alert: true,
      });
    }

    if (action === "ai_on") {
      const customer = await updateCustomerHumanMode({
        userId,
        humanRequired: false,
      });

      if (!customer) {
        return bot.answerCallbackQuery(query.id, {
          text: "Клиент не найден",
          show_alert: true,
        });
      }

      await bot.answerCallbackQuery(query.id, {
        text: "AI включен",
      });

      return sendTelegramMessage(
        chatId,
        `✅ AI снова включен для клиента: <code>${escapeHtml(userId)}</code>`
      );
    }

    if (action === "ai_off") {
      const customer = await updateCustomerHumanMode({
        userId,
        humanRequired: true,
        reason: "Оставлено менеджеру через кнопку",
      });

      if (!customer) {
        return bot.answerCallbackQuery(query.id, {
          text: "Клиент не найден",
          show_alert: true,
        });
      }

      await bot.answerCallbackQuery(query.id, {
        text: "AI оставлен отключенным",
      });

      return sendTelegramMessage(
        chatId,
        `⛔ AI оставлен отключенным для клиента: <code>${escapeHtml(userId)}</code>`
      );
    }

    return bot.answerCallbackQuery(query.id, {
      text: "Неизвестное действие",
      show_alert: true,
    });
  } catch (error) {
    console.error("Callback query error:", error);

    return bot.answerCallbackQuery(query.id, {
      text: "Ошибка обработки кнопки",
      show_alert: true,
    });
  }
});

// ======================
// /start
// ======================

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  const text = `
Здравствуйте 👋

Команды администратора:

/myid — узнать свой Telegram ID
/chats — последние клиенты
/clients USER_ID — карточка клиента
/requests — заявки
/stats — статистика
/leads — статусы лидов

/ai_off USER_ID — отключить AI для клиента
/ai_on USER_ID — включить AI обратно
/status USER_ID — проверить статус клиента
`;

  sendTelegramMessage(chatId, text);
});

// ======================
// /myid
// ======================

bot.onText(/\/myid/, async (msg) => {
  sendTelegramMessage(msg.chat.id, `Ваш Telegram ID: <code>${msg.chat.id}</code>`);
});

// ======================
// /chats
// ======================

bot.onText(/\/chats/, async (msg) => {
  const chatId = msg.chat.id;

  const isUserAdmin = await isAdmin(chatId);
  if (!isUserAdmin) return;

  if (!currentBusiness) {
    return sendTelegramMessage(chatId, "Бизнес ещё не загружен");
  }

  try {
    const result = await getRecentChats();

    return sendTelegramMessage(chatId, result.text, result.buttons);
  } catch (error) {
    console.error("Chats error:", error);
    return sendTelegramMessage(chatId, "Ошибка при получении последних клиентов");
  }
});

// ======================
// /clients USER_ID
// ======================

bot.onText(/\/clients(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;

  const isUserAdmin = await isAdmin(chatId);
  if (!isUserAdmin) return;

  if (!currentBusiness) {
    return sendTelegramMessage(chatId, "Бизнес ещё не загружен");
  }

  const userId = match?.[1]?.trim();

  if (!userId) {
    return sendTelegramMessage(
      chatId,
      `Напишите номер клиента. Например:\n<code>/clients 77051112233</code>\n\nИли используйте /chats, чтобы выбрать клиента кнопкой.`
    );
  }

  try {
    const result = await getClientCard({
      userId,
    });

    return sendTelegramMessage(chatId, result.text, result.buttons);
  } catch (error) {
    console.error("Client card error:", error);
    return sendTelegramMessage(chatId, "Ошибка при получении карточки клиента");
  }
});

// ======================
// /ai_on USER_ID
// ======================

bot.onText(/\/ai_on (.+)/, async (msg, match) => {
  const isUserAdmin = await isAdmin(msg.chat.id);
  if (!isUserAdmin) return;

  if (!currentBusiness) {
    return sendTelegramMessage(msg.chat.id, "Бизнес ещё не загружен");
  }

  const userId = match[1].trim();

  try {
    const customer = await updateCustomerHumanMode({
      userId,
      humanRequired: false,
    });

    if (!customer) {
      return sendTelegramMessage(msg.chat.id, `Клиент не найден: <code>${escapeHtml(userId)}</code>`);
    }

    sendTelegramMessage(msg.chat.id, `✅ AI снова включен для клиента: <code>${escapeHtml(userId)}</code>`);
  } catch (error) {
    console.error("AI on error:", error);
    sendTelegramMessage(msg.chat.id, "Ошибка при включении AI");
  }
});

// ======================
// /ai_off USER_ID
// ======================

bot.onText(/\/ai_off (.+)/, async (msg, match) => {
  const isUserAdmin = await isAdmin(msg.chat.id);
  if (!isUserAdmin) return;

  if (!currentBusiness) {
    return sendTelegramMessage(msg.chat.id, "Бизнес ещё не загружен");
  }

  const userId = match[1].trim();

  try {
    const customer = await updateCustomerHumanMode({
      userId,
      humanRequired: true,
      reason: "Отключено менеджером вручную",
    });

    if (!customer) {
      return sendTelegramMessage(msg.chat.id, `Клиент не найден: <code>${escapeHtml(userId)}</code>`);
    }

    sendTelegramMessage(msg.chat.id, `⛔ AI отключен для клиента: <code>${escapeHtml(userId)}</code>`);
  } catch (error) {
    console.error("AI off error:", error);
    sendTelegramMessage(msg.chat.id, "Ошибка при отключении AI");
  }
});

// ======================
// /status USER_ID
// ======================

bot.onText(/\/status (.+)/, async (msg, match) => {
  const isUserAdmin = await isAdmin(msg.chat.id);
  if (!isUserAdmin) return;

  if (!currentBusiness) {
    return sendTelegramMessage(msg.chat.id, "Бизнес ещё не загружен");
  }

  const userId = match[1].trim();

  try {
    const customer = await findCustomerByUserId(userId);

    if (!customer) {
      return sendTelegramMessage(msg.chat.id, `Клиент не найден: <code>${escapeHtml(userId)}</code>`);
    }

    const text = `
👤 <b>Клиент:</b> ${escapeHtml(customer.name || "Без имени")}
🆔 <b>User ID:</b> <code>${escapeHtml(customer.user_id)}</code>
🔗 <b>Канал:</b> ${escapeHtml(customer.channel || "неизвестно")}
📞 <b>Телефон:</b> ${escapeHtml(customer.phone || "не указан")}
📍 <b>Адрес:</b> ${escapeHtml(customer.address || "не указан")}
📌 <b>Статус:</b> ${escapeHtml(customer.status || "new")}

🤖 <b>AI отключен:</b> ${customer.human_required ? "ДА" : "НЕТ"}
📌 <b>Причина:</b> ${escapeHtml(customer.human_reason || "нет")}
`;

    sendTelegramMessage(msg.chat.id, text);
  } catch (error) {
    console.error("Status error:", error);
    sendTelegramMessage(msg.chat.id, "Ошибка при получении статуса");
  }
});

// ======================
// /leads
// ======================

bot.onText(/\/leads/, async (msg) => {
  const isUserAdmin = await isAdmin(msg.chat.id);
  if (!isUserAdmin) return;

  if (!currentBusiness) {
    return sendTelegramMessage(msg.chat.id, "Бизнес ещё не загружен");
  }

  const { data, error } = await supabase
    .from("customers")
    .select("status, lead_quality")
    .eq("business_id", currentBusiness.id);

  if (error) {
    console.error("Leads error:", error);
    return sendTelegramMessage(msg.chat.id, "Ошибка при получении лидов");
  }

  const statusStats = {};
  const qualityStats = {};

  (data || []).forEach((c) => {
    const status = c.status || "new";
    const quality = c.lead_quality || "unknown";

    statusStats[status] = (statusStats[status] || 0) + 1;
    qualityStats[quality] = (qualityStats[quality] || 0) + 1;
  });

  let text = `📊 <b>Лиды:</b> ${escapeHtml(currentBusiness.name)}\n\n`;

  text += `<b>По качеству:</b>\n`;
  Object.keys(qualityStats).forEach((key) => {
    text += `${leadEmoji(key)} ${escapeHtml(key)}: ${qualityStats[key]}\n`;
  });

  text += `\n<b>По статусам:</b>\n`;
  Object.keys(statusStats).forEach((key) => {
    text += `${escapeHtml(key)}: ${statusStats[key]}\n`;
  });

  sendTelegramMessage(msg.chat.id, text);
});

// ======================
// /stats
// ======================

bot.onText(/\/stats/, async (msg) => {
  const isUserAdmin = await isAdmin(msg.chat.id);
  if (!isUserAdmin) return;

  if (!currentBusiness) {
    return sendTelegramMessage(msg.chat.id, "Бизнес ещё не загружен");
  }

  const { count: messagesCount } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("business_id", currentBusiness.id);

  const { count: customersCount } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("business_id", currentBusiness.id);

  const { count: bookingsCount } = await supabase
    .from("bookings")
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

  const text = `
📈 <b>Статистика:</b> ${escapeHtml(currentBusiness.name)}

💬 Сообщений: ${messagesCount || 0}
👥 Клиентов: ${customersCount || 0}
🔥 Заявок: ${bookingsCount || 0}

<b>Каналы:</b>
Telegram: ${telegramCount || 0}
Instagram: ${instagramCount || 0}
WhatsApp: ${whatsappCount || 0}
`;

  sendTelegramMessage(msg.chat.id, text);
});

// ======================
// /requests
// ======================

bot.onText(/\/requests/, async (msg) => {
  const isUserAdmin = await isAdmin(msg.chat.id);
  if (!isUserAdmin) return;

  if (!currentBusiness) {
    return sendTelegramMessage(msg.chat.id, "Бизнес ещё не загружен");
  }

  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("business_id", currentBusiness.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("Requests error:", error);
    return sendTelegramMessage(msg.chat.id, "Ошибка при получении заявок");
  }

  if (!data || !data.length) {
    return sendTelegramMessage(msg.chat.id, "Нет заявок");
  }

  let text = `🔥 <b>Заявки:</b> ${escapeHtml(currentBusiness.name)}\n\n`;

  data.forEach((b, index) => {
    text += `${index + 1}. ${leadEmoji(b.lead_quality)} <b>${escapeHtml(b.customer_name || "Без имени")}</b>\n`;
    text += `📱 <code>${escapeHtml(b.user_id)}</code>\n`;
    text += `📲 ${escapeHtml(b.channel || "неизвестно")}\n`;
    text += `📍 ${escapeHtml(b.address || "адрес не указан")}\n`;
    text += `🕒 ${escapeHtml(b.preferred_time || "время не указано")}\n`;
    text += `🏠 ${escapeHtml(b.room_type || "комната не указана")}\n`;
    text += `📐 ${escapeHtml(b.estimated_area || "площадь не указана")}\n`;
    text += `📌 ${escapeHtml(b.status || "new")}\n`;
    text += `Команда: <code>/clients ${escapeHtml(b.user_id)}</code>\n\n`;
  });

  const buttons = {
    inline_keyboard: data.map((b) => [
      {
        text: `${leadEmoji(b.lead_quality)} ${b.customer_name || b.user_id}`,
        callback_data: `client:${b.channel}:${b.user_id}`,
      },
    ]),
  };

  sendTelegramMessage(msg.chat.id, text, buttons);
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
      return sendTelegramMessage(chatId, "Бот ещё загружается. Попробуйте снова.");
    }

    bot.sendChatAction(chatId, "typing");

    const answer = await handleMessage({
      business: currentBusiness,
      channel: "telegram",
      userId: chatId,
      text,
    });

    sendTelegramMessage(chatId, answer);
  } catch (error) {
    console.error("Telegram message error:", error);

    sendTelegramMessage(
      msg.chat.id,
      "Извините, сейчас техническая ошибка. Менеджер скоро ответит."
    );
  }
});