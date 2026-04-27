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
      last_message_at: new Date().toISOString()
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
      content: item.content
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
`;
  }

  return `
Customer profile:

Phone: ${data.phone || "unknown"}
Address: ${data.address || "unknown"}
Need: ${data.need || "unknown"}
Status: ${data.status || "new"}
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
  channel = "telegram"
}) {
  const userId = String(chatId);

  const { error } = await supabase.from("messages").insert({
    business_id: businessId,
    customer_id: customerId,
    channel,
    user_id: userId,
    role,
    content
  });

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
      last_message_at: new Date().toISOString()
    })
    .eq("id", customerId);

  if (error) {
    console.error("Customer last_message update error:", error);
    throw error;
  }
}

// =====================
// UPDATE CUSTOMER MEMORY
// без имени
// =====================

async function updateCustomerMemory(businessId, chatId, text, channel = "telegram") {
  const customer = await getOrCreateCustomer(businessId, chatId, channel);

  await supabase
    .from("customers")
    .update({
      last_message_at: new Date().toISOString()
    })
    .eq("id", customer.id);
}

module.exports = {
  getOrCreateCustomer,
  getConversationMemory,
  getCustomerMemory,
  saveMessage,
  updateCustomerMemory,
  updateCustomerLastMessage
};