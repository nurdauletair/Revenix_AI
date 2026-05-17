const supabase = require("../database/supabase");
const { sendWhatsAppMessage } = require("../channels/whatsapp");

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isKazakhCustomer(customer) {
  const text = `
${customer.intent || ""}
${customer.source_note || ""}
${customer.last_intent || ""}
${customer.need || ""}
`.toLowerCase();

  return (
    text.includes("қ") ||
    text.includes("ә") ||
    text.includes("ң") ||
    text.includes("ғ") ||
    text.includes("ү") ||
    text.includes("ұ") ||
    text.includes("ө") ||
    text.includes("і")
  );
}

function getFollowUp1Text(customer) {
  if (isKazakhCustomer(customer)) {
    return `Сәлеметсіз бе 😊

Сіз натяжной потолок бойынша сұраған едіңіз.

Дәл бағасын шығару үшін тегін замерге жазып қояйық 👌
Маман келіп өлшеп, нақты бағасын айтып береді.

Сізге бүгін ыңғайлы ма, әлде ертең бе?`;
  }

  return `Здравствуйте 😊

Вы интересовались натяжным потолком.

Чтобы точно рассчитать стоимость, можем записать вас на бесплатный замер 👌
Мастер приедет, измерит и сразу скажет точную цену.

Вам удобнее сегодня или завтра?`;
}

function getFollowUp2Text(customer) {
  if (isKazakhCustomer(customer)) {
    return `Қайырлы күн 😊

Натяжной потолок бойынша нақты бағаны тегін замерден кейін шығарып бере аламыз.

Егер ыңғайлы болса, сізді бүгін немесе ертеңге жазып қояйық 👌
Қай уақыт ыңғайлы?`;
  }

  return `Добрый день 😊

По натяжному потолку точную цену лучше посчитать после бесплатного замера.

Можем записать вас на сегодня или завтра 👌
Какое время вам удобно?`;
}

async function getBusinessById(businessId) {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", businessId)
    .maybeSingle();

  if (error) {
    console.error("Follow-up business find error:", error);
    return null;
  }

  return data;
}

function isBlockedStatus(status) {
  return ["booking_created", "human_required", "closed", "lost"].includes(
    status || ""
  );
}

async function sendFollowUp1() {
  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .eq("channel", "whatsapp")
    .is("followup_1_sent_at", null)
    .eq("human_required", false)
    .lte("last_message_at", hoursAgo(0.01))
    .gte("last_message_at", hoursAgo(23))
    .limit(50);

  if (error) {
    console.error("Follow-up 1 customers error:", error);
    return;
  }

  const candidates = (customers || []).filter((customer) => {
    if (customer.followup_blocked === true) return false;
    if (isBlockedStatus(customer.status)) return false;
    return true;
  });

  console.log("🔎 Follow-up 1 candidates:", candidates.length);

  for (const customer of candidates) {
    try {
      const business = await getBusinessById(customer.business_id);

      if (!business) {
        console.log("⏭️ Follow-up skipped: business not found", customer.business_id);
        continue;
      }

      if (!business.whatsapp_enabled) {
        console.log("⏭️ Follow-up skipped: whatsapp disabled", business.name);
        continue;
      }

      await sendWhatsAppMessage({
        business,
        to: customer.user_id,
        text: getFollowUp1Text(customer),
      });

      await supabase
        .from("customers")
        .update({
          followup_1_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", customer.id);

      console.log("✅ Follow-up 1 sent:", {
        userId: customer.user_id,
        business: business.name,
      });
    } catch (err) {
      console.error(
        "Follow-up 1 send error:",
        err.response?.data || err.message
      );
    }
  }
}

async function sendFollowUp2() {
  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .not("followup_1_sent_at", "is", null)
    .is("followup_2_sent_at", null)
    .eq("channel", "whatsapp")
    .eq("human_required", false)
    .lte("last_message_at", hoursAgo(0.02))
    .gte("last_message_at", hoursAgo(23))
    .limit(50);

  if (error) {
    console.error("Follow-up 2 customers error:", error);
    return;
  }

  const candidates = (customers || []).filter((customer) => {
    if (customer.followup_blocked === true) return false;
    if (isBlockedStatus(customer.status)) return false;
    return true;
  });

  console.log("🔎 Follow-up 2 candidates:", candidates.length);

  for (const customer of candidates) {
    try {
      const business = await getBusinessById(customer.business_id);

      if (!business) {
        console.log("⏭️ Follow-up 2 skipped: business not found", customer.business_id);
        continue;
      }

      if (!business.whatsapp_enabled) {
        console.log("⏭️ Follow-up 2 skipped: whatsapp disabled", business.name);
        continue;
      }

      await sendWhatsAppMessage({
        business,
        to: customer.user_id,
        text: getFollowUp2Text(customer),
      });

      await supabase
        .from("customers")
        .update({
          followup_2_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", customer.id);

      console.log("✅ Follow-up 2 sent:", {
        userId: customer.user_id,
        business: business.name,
      });
    } catch (err) {
      console.error(
        "Follow-up 2 send error:",
        err.response?.data || err.message
      );
    }
  }
}

async function runFollowUps() {
  console.log("🔁 Running follow-up check...");
  await sendFollowUp1();
  await sendFollowUp2();
}

function startFollowUpWorker() {
  console.log("✅ Follow-up worker started");

  // Запускаем сразу, не ждём 1 минуту
  runFollowUps().catch((err) => {
    console.error("Follow-up initial run error:", err);
  });

  // Тестовый режим: проверка каждую минуту
  setInterval(() => {
    runFollowUps().catch((err) => {
      console.error("Follow-up worker error:", err);
    });
  }, 60 * 1000);
}

module.exports = {
  runFollowUps,
  startFollowUpWorker,
};