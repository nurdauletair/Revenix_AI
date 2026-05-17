const axios = require("axios");
const fs = require("fs");
const path = require("path");

const supabase = require("../database/supabase");

const { handleMessage } = require("../server");
const { decrypt } = require("../utils/encryption");
const { transcribeAudio } = require("../ai/transcribe");
const { analyzeImage } = require("../ai/vision");
const { addMessageToBatch } = require("../services/messageBatcher");

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
// DOWNLOAD MEDIA
// =========================

async function downloadWhatsAppMedia({
  mediaId,
  token,
  extension = "tmp",
}) {
  const mediaResponse = await axios.get(
    `https://graph.facebook.com/v20.0/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const mediaUrl = mediaResponse.data.url;

  const mediaFile = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const fileName = `wa_${Date.now()}.${extension}`;
  const filePath = path.join("/tmp", fileName);

  fs.writeFileSync(filePath, mediaFile.data);

  return filePath;
}

// =========================
// PROCESS AI ANSWER AFTER BATCH
// =========================

async function processBatchedWhatsAppMessage({
  business,
  channel,
  userId,
  text,
}) {
  const answer = await handleMessage({
    business,
    channel,
    userId,
    text,
  });

  await sendWhatsAppMessage({
    business,
    to: userId,
    text: answer,
  });
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

      const business = await findBusinessByPhoneNumberId(phoneNumberId);

      if (!business) {
        console.error("Business not found:", phoneNumberId);
        continue;
      }

      for (const msg of messages) {
        try {
          const userId = msg.from;

          const token = decrypt(business.whatsapp_token_encrypted);

          let text = null;
          let shouldBatch = true;

          // =========================
          // TEXT
          // =========================

          if (msg.type === "text") {
            text = msg.text?.body;
          }

          // =========================
          // AUDIO
          // =========================

          if (msg.type === "audio") {
            await sendWhatsAppMessage({
              business,
              to: userId,
              text: "🎤 Обрабатываю голосовое...",
            });

            const mediaId = msg.audio?.id;

            const filePath = await downloadWhatsAppMedia({
              mediaId,
              token,
              extension: "ogg",
            });

            text = await transcribeAudio(filePath);

            fs.unlinkSync(filePath);

            console.log("VOICE TRANSCRIPTION:", text);
          }

          // =========================
          // IMAGE
          // =========================

          if (msg.type === "image") {
            await sendWhatsAppMessage({
              business,
              to: userId,
              text: "🖼 Анализирую изображение...",
            });

            const mediaId = msg.image?.id;
            const caption = msg.image?.caption || "";

            const filePath = await downloadWhatsAppMedia({
              mediaId,
              token,
              extension: "jpg",
            });

            const imageAnalysis = await analyzeImage(
              filePath,
              `
Клиент отправил изображение.

Подпись клиента:
${caption}

Опиши изображение и помоги понять,
что хочет клиент.
`
            );

            fs.unlinkSync(filePath);

            text = `
Клиент отправил изображение.

Описание изображения:
${imageAnalysis}

Подпись:
${caption}
`;

            // Фото лучше не держать слишком долго, но 4 секунды можно оставить.
            shouldBatch = true;
          }

          // =========================
          // LOCATION
          // =========================

          if (msg.type === "location") {
            const latitude = msg.location?.latitude;
            const longitude = msg.location?.longitude;

            text = `
Клиент отправил геолокацию.

Latitude: ${latitude}
Longitude: ${longitude}
`;

            shouldBatch = true;
          }

          // =========================
          // DOCUMENT
          // =========================

          if (msg.type === "document") {
            text = `
Клиент отправил документ:
${msg.document?.filename || "file"}
`;

            shouldBatch = true;
          }

          // =========================
          // UNSUPPORTED
          // =========================

          if (!text) {
            await sendWhatsAppMessage({
              business,
              to: userId,
              text:
                "Пока я умею работать с текстом, голосовыми, фото, геолокацией и документами.",
            });

            continue;
          }

          // =========================
          // SMART BATCHING
          // =========================

          if (shouldBatch) {
            addMessageToBatch({
              business,
              channel: "whatsapp",
              userId,
              text,
              delayMs: 4000,
              onReady: processBatchedWhatsAppMessage,
            });

            continue;
          }

          // fallback, если batching отключим для какого-то типа
          await processBatchedWhatsAppMessage({
            business,
            channel: "whatsapp",
            userId,
            text,
          });
        } catch (err) {
          console.error(
            "WhatsApp processing error:",
            err.response?.data || err.message
          );

          try {
            await sendWhatsAppMessage({
              business,
              to: msg.from,
              text: "Произошла ошибка. Менеджер скоро свяжется с вами.",
            });
          } catch (_) {}
        }
      }
    }
  }
}

module.exports = {
  handleWhatsAppWebhook,
};