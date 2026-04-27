const axios = require("axios");
const { handleMessage } = require("../server");
const supabase = require("../database/supabase");

async function sendInstagramMessage({ recipientId, text, accessToken }) {
  try {
    await axios.post(
      `https://graph.instagram.com/v21.0/me/messages`,
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
  } catch (error) {
    console.error(
      "Instagram send error:",
      error.response?.data || error.message
    );
  }
}

async function handleInstagramWebhook(body) {
  try {
    if (!body.entry) return;

    for (const entry of body.entry) {
      const instagramAccountId = entry.id;

      const { data: business, error } = await supabase
        .from("businesses")
        .select("*")
        .eq("instagram_account_id", String(instagramAccountId))
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        console.error("Instagram business find error:", error);
        continue;
      }

      if (!business) {
        console.log("No business found for Instagram ID:", instagramAccountId);
        continue;
      }

      const messagingEvents = entry.messaging || [];

      for (const event of messagingEvents) {
        const senderId = event.sender?.id;
        const text = event.message?.text;

        if (!senderId || !text) continue;

        if (senderId === instagramAccountId) continue;

        console.log("📩 Instagram message:", text);

        const answer = await handleMessage({
          business,
          channel: "instagram",
          userId: senderId,
          text
        });

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