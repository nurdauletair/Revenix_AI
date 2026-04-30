const axios = require("axios");
const supabase = require("../database/supabase");
const { handleMessage } = require("../server");
const { decrypt } = require("../utils/encryption");

async function findBusinessByPhoneNumberId(phoneNumberId) {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("whatsapp_phone_number_id", String(phoneNumberId))
    .eq("whatsapp_enabled", true)
    .maybeSingle();

  if (error) {
    console.error("WhatsApp business find error:", error);
    throw error;
  }

  return data;
}

async function sendWhatsAppMessage({ business, to, text }) {
  const token = decrypt(business.whatsapp_token_encrypted);

  const url = `https://graph.facebook.com/v20.0/${business.whatsapp_phone_number_id}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to: String(to),
      type: "text",
      text: {
        body: text,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function handleWhatsAppWebhook(body) {
  const entries = body.entry || [];

  for (const entry of entries) {
    const changes = entry.changes || [];

    for (const change of changes) {
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      const messages = value.messages || [];

      if (!phoneNumberId || !messages.length) continue;

      const business = await findBusinessByPhoneNumberId(phoneNumberId);

      if (!business) {
        console.error("Business not found for WhatsApp phone_number_id:", phoneNumberId);
        continue;
      }

      for (const msg of messages) {
        if (msg.type !== "text") {
          await sendWhatsAppMessage({
            business,
            to: msg.from,
            text: "Спасибо! Сейчас менеджер посмотрит ваше сообщение.",
          });
          continue;
        }

        const userId = msg.from;
        const text = msg.text?.body;

        if (!text) continue;

        const answer = await handleMessage({
          business,
          channel: "whatsapp",
          userId,
          text,
        });

        await sendWhatsAppMessage({
          business,
          to: userId,
          text: answer,
        });
      }
    }
  }
}

module.exports = {
  handleWhatsAppWebhook,
};