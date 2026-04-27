const axios = require("axios");
const { handleMessage } = require("../server");
const supabase = require("../database/supabase");

// ======================
// SEND MESSAGE TO INSTAGRAM
// ======================

async function sendInstagramMessage({ recipientId, text, accessToken }) {
  try {
    await axios.post(
      "https://graph.instagram.com/v21.0/me/messages",
      {
        recipient: {
          id: recipientId
        },
        message: {
          text
        }
      },
      {
        params: {
          access_token: accessToken
        }
      }
    );

    console.log("✅ Instagram reply sent");
  } catch (error) {
    console.error(
      "Instagram send error:",
      error.response?.data || error.message
    );
  }
}

// ======================
// FIND BUSINESS BY INSTAGRAM ID
// ======================

async function findBusinessByInstagramId(instagramAccountId) {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("instagram_account_id", String(instagramAccountId))
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("Instagram business find error:", error);
    return null;
  }

  return data;
}

// ======================
// HANDLE INSTAGRAM WEBHOOK
// ======================

async function handleInstagramWebhook(body) {
  try {
    if (!body || body.object !== "instagram") {
      console.log("Ignored non-instagram webhook");
      return;
    }

    if (!body.entry || !Array.isArray(body.entry)) {
      console.log("No Instagram entry found");
      return;
    }

    for (const entry of body.entry) {
      const instagramAccountId = String(entry.id);

      const business = await findBusinessByInstagramId(instagramAccountId);

      if (!business) {
        console.log("No business found for Instagram ID:", instagramAccountId);
        continue;
      }

      const messagingEvents = entry.messaging || [];

      for (const event of messagingEvents) {
        console.log("FULL INSTAGRAM EVENT:", JSON.stringify(event, null, 2));

        // Игнорируем редактирование сообщений
        if (event.message_edit) {
          console.log("Ignored Instagram message_edit event");
          continue;
        }

        // Игнорируем доставку/прочитано/реакции и другие события
        if (!event.message) {
          console.log("Ignored Instagram event without message");
          continue;
        }

        // Игнорируем сообщения без текста
        if (!event.message.text) {
          console.log("Ignored Instagram non-text message");
          continue;
        }

        const senderId = event.sender?.id;
        const text = event.message.text;

        if (!senderId) {
          console.log("Ignored Instagram event without senderId");
          continue;
        }

        // Защита: если вдруг sender = сам бизнес
        if (String(senderId) === instagramAccountId) {
          console.log("Ignored own Instagram message");
          continue;
        }

        console.log("📩 Instagram message:", text);

        const answer = await handleMessage({
          business,
          channel: "instagram",
          userId: senderId,
          text
        });

        if (!answer) {
          console.log("AI returned empty answer");
          continue;
        }

        await sendInstagramMessage({
          recipientId: senderId,
          text: answer,
          accessToken: business.instagram_access_token
        });
      }
    }
  } catch (error) {
    console.error("Instagram webhook handler error:", error);
  }
}

module.exports = {
  handleInstagramWebhook
};