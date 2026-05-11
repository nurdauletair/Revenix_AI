const axios = require("axios");
const fs = require("fs");
const path = require("path");

const supabase = require("../database/supabase");
const { handleMessage } = require("../server");
const { decrypt } = require("../utils/encryption");
const { transcribeAudio } = require("../ai/transcribe");

// =========================
// FIND BUSINESS
// =========================

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

// =========================
// SEND MESSAGE
// =========================

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

// =========================
// DOWNLOAD WHATSAPP AUDIO
// =========================

async function downloadWhatsAppAudio({ mediaId, token }) {
  // 1. get media info
  const mediaResponse = await axios.get(
    `https://graph.facebook.com/v20.0/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const mediaUrl = mediaResponse.data.url;

  // 2. download file
  const audioResponse = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  // 3. save temp file
  const fileName = `voice_${Date.now()}.ogg`;

  const filePath = path.join("/tmp", fileName);

  fs.writeFileSync(filePath, audioResponse.data);

  return filePath;
}

// =========================
// HANDLE WEBHOOK
// =========================

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

      const business = await findBusinessByPhoneNumberId(
        phoneNumberId
      );

      if (!business) {
        console.error(
          "Business not found for WhatsApp phone_number_id:",
          phoneNumberId
        );

        continue;
      }

      for (const msg of messages) {
        try {
          const userId = msg.from;

          let text = null;

          // =========================
          // TEXT MESSAGE
          // =========================

          if (msg.type === "text") {
            text = msg.text?.body;
          }

          // =========================
          // AUDIO MESSAGE
          // =========================

          if (msg.type === "audio") {
            const token = decrypt(
              business.whatsapp_token_encrypted
            );

            const mediaId = msg.audio?.id;

            if (!mediaId) {
              await sendWhatsAppMessage({
                business,
                to: userId,
                text: "Не получилось обработать голосовое сообщение.",
              });

              continue;
            }

            // send processing message
            await sendWhatsAppMessage({
              business,
              to: userId,
              text: "🎤 Обрабатываю голосовое сообщение...",
            });

            // download audio
            const filePath =
              await downloadWhatsAppAudio({
                mediaId,
                token,
              });

            // transcribe
            text = await transcribeAudio(filePath);

            // delete temp file
            fs.unlinkSync(filePath);

            console.log("VOICE TEXT:", text);
          }

          // =========================
          // UNSUPPORTED MESSAGE
          // =========================

          if (!text) {
            await sendWhatsAppMessage({
              business,
              to: userId,
              text: "Пока я умею работать только с текстом и голосовыми сообщениями.",
            });

            continue;
          }

          // =========================
          // AI RESPONSE
          // =========================

          const answer = await handleMessage({
            business,
            channel: "whatsapp",
            userId,
            text,
          });

          // send answer
          await sendWhatsAppMessage({
            business,
            to: userId,
            text: answer,
          });
        } catch (err) {
          console.error(
            "WhatsApp message processing error:",
            err.response?.data || err.message
          );
        }
      }
    }
  }
}

module.exports = {
  handleWhatsAppWebhook,
};


if (msg.type === "image") {
  const token = decrypt(business.whatsapp_token_encrypted);
  const mediaId = msg.image?.id;
  const caption = msg.image?.caption || "";

  const filePath = await downloadWhatsAppMedia({
    mediaId,
    token,
    extension: "jpg",
  });

  const imageText = await analyzeImage(
    filePath,
    `Клиент отправил фото в WhatsApp. Подпись клиента: "${caption}". 
    Опиши фото и помоги понять, что клиент хочет. 
    Если это фото окна/товара/чека/проблемы, выдели важные детали.`
  );

  fs.unlinkSync(filePath);

  text = caption
    ? `Клиент отправил фото с подписью: "${caption}". Анализ фото: ${imageText}`
    : `Клиент отправил фото. Анализ фото: ${imageText}`;
}