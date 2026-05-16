const supabase = require("./supabase");
const { appendBookingToSheet } = require("../services/googleSheets");

async function createBooking({
  business,
  customer,

  customerName,
  customerPhone,
  service,
  address,
  preferredTime,
  notes,

  userId,
  channel,

  // Smart CRM fields
  roomType = null,
  estimatedArea = null,
  urgency = null,
  leadQuality = "warm",
  intent = null,
  managerRequired = false,
}) {
  const payload = {
    business_id: business.id,
    customer_id: customer?.id || null,

    channel,
    user_id: String(userId),

    customer_name: customerName || customer?.name || null,
    customer_phone: customerPhone || customer?.phone || String(userId),

    service: service || customer?.need || intent || null,
    address: address || customer?.address || null,
    preferred_time: preferredTime || null,

    status: "new",
    notes: notes || null,

    room_type: roomType,
    estimated_area: estimatedArea,
    urgency,
    lead_quality: leadQuality,
    intent,
    manager_required: managerRequired,
  };

  const { data, error } = await supabase
    .from("bookings")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error("Booking insert error:", error);
    throw error;
  }

  if (business.google_sheet_id) {
    try {
      await appendBookingToSheet({
        spreadsheetId: business.google_sheet_id,
        booking: data,
      });
    } catch (err) {
      console.error("Google Sheets append error:", err.message);
    }
  }

  return data;
}

module.exports = {
  createBooking,
};