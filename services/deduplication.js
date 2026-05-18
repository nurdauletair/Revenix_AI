const supabase = require("../database/supabase");

// =========================
// MESSAGE DEDUPLICATION
// =========================
//
// Возвращает true  = сообщение новое, можно обрабатывать
// Возвращает false = сообщение уже было, пропускаем
//

async function markMessageAsProcessing({
  businessId,
  channel,
  providerMessageId,
  userId = null,
}) {
  if (!businessId || !channel || !providerMessageId) {
    console.error("Deduplication missing required fields:", {
      businessId,
      channel,
      providerMessageId,
      userId,
    });

    // Если нет ID сообщения, лучше обработать, чем потерять клиента
    return true;
  }

  const { error } = await supabase
    .from("processed_messages")
    .insert({
      business_id: businessId,
      channel,
      provider_message_id: String(providerMessageId),
      user_id: userId ? String(userId) : null,
    });

  if (!error) {
    return true;
  }

  // Supabase/Postgres unique violation
  if (error.code === "23505") {
    console.log("⏭️ Duplicate message skipped:", {
      channel,
      providerMessageId,
      userId,
    });

    return false;
  }

  console.error("Deduplication insert error:", error);

  // Если Supabase временно ошибся, лучше обработать сообщение,
  // чем потерять реального клиента
  return true;
}

module.exports = {
  markMessageAsProcessing,
};