const supabase = require("../database/supabase");
const { sendWhatsAppMessage } = require("../channels/whatsapp");

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function getFollowUp1Text(customer) {
  const isKazakh =
    (customer.intent || "").toLowerCase().includes("потолок") ||
    (customer.source_note || "").toLowerCase().includes("қазақ");

  if (isKazakh) {
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
  const isKazakh =
    (customer.intent || "").toLowerCase().includes("потолок") ||
    (customer.source_note || "").toLowerCase().includes("қазақ");

  if (isKazakh) {
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

async function sendFollowUp1() {
  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .eq("channel", "whatsapp")
    .eq("followup_blocked", false)
    .is("followup_1_sent_at", null)
    .eq("human_required", false)
    .not("status", "in", '("booking_created","human_required","closed","lost")')
    .lte("last_message_at", hoursAgo(0.01))
    .gte("last_message_at", hoursAgo(23))
    .limit(20);

  if (error) {
    console.error("Follow-up 1 customers error:", error);
    return;
  }

  for (const customer of customers || []) {
    try {
      const business = await getBusinessById(customer.business_id);

      if (!business || !business.whatsapp_enabled) continue;

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
      console.error("Follow-up 1 send error:", err.response?.data || err.message);
    }
  }
}

async function sendFollowUp2() {
  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .eq("channel", "whatsapp")
    .eq("followup_blocked", false)
    .not("followup_1_sent_at", "is", null)
    .is("followup_2_sent_at", null)
    .eq("human_required", false)
    .not("status", "in", '("booking_created","human_required","closed","lost")')
    .lte("last_message_at", hoursAgo(0.02))
    .gte("last_message_at", hoursAgo(23))
    .limit(20);

  if (error) {
    console.error("Follow-up 2 customers error:", error);
    return;
  }

  for (const customer of customers || []) {
    try {
      const business = await getBusinessById(customer.business_id);

      if (!business || !business.whatsapp_enabled) continue;

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
      console.error("Follow-up 2 send error:", err.response?.data || err.message);
    }
  }
}

async function runFollowUps() {
  await sendFollowUp1();
  await sendFollowUp2();
}

function startFollowUpWorker() {
  console.log("✅ Follow-up worker started");

  setInterval(() => {
    runFollowUps().catch((err) => {
      console.error("Follow-up worker error:", err);
    });
  }, 10 * 60 * 1000);
}

module.exports = {
  runFollowUps,
  startFollowUpWorker,
};