const supabase = require("../database/supabase");

// =====================
// GET OR CREATE CUSTOMER
// =====================

async function getOrCreateCustomer(businessId, chatId, channel = "telegram") {
  const userId = String(chatId);

  const { data: existingCustomer, error: findError } = await supabase
    .from("customers")
    .select("*")
    .eq("business_id", businessId)
    .eq("channel", channel)
    .eq("user_id", userId)
    .maybeSingle();

  if (findError) {
    console.error("Customer find error:", findError);
    throw findError;
  }

  if (existingCustomer) {
    return existingCustomer;
  }

  const { data: newCustomer, error: insertError } = await supabase
    .from("customers")
    .insert({
      business_id: businessId,
      channel,
      user_id: userId,
      status: "new",
      lead_stage: "new",
      lead_quality: "warm",
      first_message_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    console.error("Customer insert error:", insertError);
    throw insertError;
  }

  return newCustomer;
}

// =====================
// CONVERSATION MEMORY
// =====================

async function getConversationMemory(businessId, chatId, channel = "telegram") {
  const userId = String(chatId);

  const { data, error } = await supabase
    .from("messages")
    .select("role, content")
    .eq("business_id", businessId)
    .eq("channel", channel)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(16);

  if (error) {
    console.error("Conversation memory error:", error);
    return [];
  }

  return (data || [])
    .reverse()
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.content,
    }));
}

// =====================
// CUSTOMER MEMORY
// =====================

async function getCustomerMemory(businessId, chatId, channel = "telegram") {
  const userId = String(chatId);

  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("business_id", businessId)
    .eq("channel", channel)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Customer memory error:", error);
  }

  if (!data) {
    return `
Customer profile:
Phone unknown.
Address unknown.
Need unknown.
Status: new.
Lead stage: new.
Intent unknown.
Objection unknown.
Room type unknown.
Estimated area unknown.
Urgency unknown.
Lead quality: warm.
`;
  }

  return `
Customer profile:

Name: ${data.name || "unknown"}
Phone: ${data.phone || "unknown"}
Address: ${data.address || "unknown"}
Need: ${data.need || "unknown"}
Status: ${data.status || "new"}

CRM:
Lead stage: ${data.lead_stage || "new"}
Intent: ${data.intent || "unknown"}
Last intent: ${data.last_intent || "unknown"}
Objection: ${data.objection || "unknown"}
Budget: ${data.budget || "unknown"}
Room type: ${data.room_type || "unknown"}
Estimated area: ${data.estimated_area || "unknown"}
Urgency: ${data.urgency || "unknown"}
Lead quality: ${data.lead_quality || "warm"}
Human required: ${data.human_required ? "yes" : "no"}
`;
}

// =====================
// SAVE MESSAGE
// =====================

async function saveMessage({
  businessId,
  customerId,
  chatId,
  role,
  content,
  channel = "telegram",
  messageType = "text",
  mediaId = null,
  mediaUrl = null,
}) {
  const userId = String(chatId);

  const payload = {
    business_id: businessId,
    customer_id: customerId,
    channel,
    user_id: userId,
    role,
    content,
  };

  // These columns must exist if you added media support.
  // If not, remove these 3 fields or add columns in Supabase.
  payload.message_type = messageType;
  payload.media_id = mediaId;
  payload.media_url = mediaUrl;

  const { error } = await supabase.from("messages").insert(payload);

  if (error) {
    console.error("Message save error:", error);
    throw error;
  }
}

// =====================
// UPDATE LAST MESSAGE TIME
// =====================

async function updateCustomerLastMessage(customerId) {
  const { error } = await supabase
    .from("customers")
    .update({
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", customerId);

  if (error) {
    console.error("Customer last_message update error:", error);
    throw error;
  }
}

// =====================
// UPDATE CUSTOMER MEMORY
// =====================

async function updateCustomerMemory(businessId, chatId, text, channel = "telegram") {
  const customer = await getOrCreateCustomer(businessId, chatId, channel);

  const { error } = await supabase
    .from("customers")
    .update({
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", customer.id);

  if (error) {
    console.error("Customer memory update error:", error);
  }
}

// =====================
// UPDATE CUSTOMER SMART CRM INSIGHTS
// =====================

async function updateCustomerInsights(customerId, insights) {
  if (!insights) return;

  const payload = {
    updated_at: new Date().toISOString(),
  };

  if (insights.lead_stage) {
    payload.lead_stage = insights.lead_stage;
    payload.status = insights.lead_stage;
  }

  if (insights.intent) {
    payload.intent = insights.intent;
    payload.last_intent = insights.intent;
    payload.need = insights.intent;
  }

  if (insights.objection) payload.objection = insights.objection;
  if (insights.budget) payload.budget = insights.budget;
  if (insights.room_type) payload.room_type = insights.room_type;
  if (insights.estimated_area) payload.estimated_area = insights.estimated_area;
  if (insights.urgency) payload.urgency = insights.urgency;
  if (insights.lead_quality) payload.lead_quality = insights.lead_quality;

  if (insights.summary) {
    payload.source_note = insights.summary;
  }

  const { error } = await supabase
    .from("customers")
    .update(payload)
    .eq("id", customerId);

  if (error) {
    console.error("Customer insights update error:", error);
  }
}

module.exports = {
  getOrCreateCustomer,
  getConversationMemory,
  getCustomerMemory,
  saveMessage,
  updateCustomerMemory,
  updateCustomerLastMessage,
  updateCustomerInsights,
};