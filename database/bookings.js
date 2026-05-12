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
}) {
  const payload = {
    business_id: business.id,
    customer_id: customer?.id || null,
    customer_name: customerName || customer?.name || null,
    customer_phone: customerPhone || customer?.phone || String(userId),
    service: service || customer?.need || null,
    address: address || customer?.address || null,
    preferred_time: preferredTime || null,
    notes: notes || null,
    user_id: String(userId),
    channel,
    status: "new",
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