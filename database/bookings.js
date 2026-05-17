const supabase = require("./supabase");

const {
  appendBookingToSheet,
  appendBookingUpdateToSheet,
} = require("../services/googleSheets");

function hasImportantBookingChanges(oldBooking, newBooking) {
  return (
    oldBooking?.preferred_time !== newBooking?.preferred_time ||
    oldBooking?.address !== newBooking?.address ||
    oldBooking?.room_type !== newBooking?.room_type ||
    oldBooking?.estimated_area !== newBooking?.estimated_area ||
    oldBooking?.customer_name !== newBooking?.customer_name
  );
}

async function findActiveBooking({ businessId, userId, channel }) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("business_id", businessId)
    .eq("user_id", String(userId))
    .eq("channel", channel)
    .in("status", ["new", "pending", "confirmed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Find active booking error:", error);
    return null;
  }

  return data;
}

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

  roomType = null,
  estimatedArea = null,
  urgency = null,
  leadQuality = "hot",
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

    service: service || intent || business.niche || null,
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
    appendBookingToSheet({
      spreadsheetId: business.google_sheet_id,
      booking: data,
    }).catch((err) => {
      console.error("Google Sheets append error:", err.message);
    });
  }

  return data;
}

async function getBusinessGoogleSheetId(businessId) {
  const { data, error } = await supabase
    .from("businesses")
    .select("google_sheet_id")
    .eq("id", businessId)
    .maybeSingle();

  if (error) {
    console.error("Business google_sheet_id find error:", error);
    return null;
  }

  return data?.google_sheet_id || null;
}

async function updateBooking({
  bookingId,

  customerName,
  customerPhone,
  service,
  address,
  preferredTime,
  notes,

  roomType,
  estimatedArea,
  urgency,
  leadQuality,
  intent,
  managerRequired,
}) {
  const { data: oldBooking, error: oldError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();

  if (oldError) {
    console.error("Old booking find error:", oldError);
    throw oldError;
  }

  const payload = {
    updated_at: new Date().toISOString(),
  };

  if (customerName) payload.customer_name = customerName;
  if (customerPhone) payload.customer_phone = customerPhone;
  if (service) payload.service = service;
  if (address) payload.address = address;
  if (preferredTime) payload.preferred_time = preferredTime;
  if (notes) payload.notes = notes;

  if (roomType) payload.room_type = roomType;
  if (estimatedArea) payload.estimated_area = estimatedArea;
  if (urgency) payload.urgency = urgency;
  if (leadQuality) payload.lead_quality = leadQuality;
  if (intent) payload.intent = intent;

  if (typeof managerRequired === "boolean") {
    payload.manager_required = managerRequired;
  }

  const { data: newBooking, error } = await supabase
    .from("bookings")
    .update(payload)
    .eq("id", bookingId)
    .select()
    .single();

  if (error) {
    console.error("Booking update error:", error);
    throw error;
  }

  const importantChanged = hasImportantBookingChanges(oldBooking, newBooking);

  if (importantChanged) {
    const googleSheetId = await getBusinessGoogleSheetId(newBooking.business_id);

    if (googleSheetId) {
      appendBookingUpdateToSheet({
        spreadsheetId: googleSheetId,
        oldBooking,
        newBooking,
      }).catch((err) => {
        console.error(
          "Google Sheets booking update append error:",
          err.message
        );
      });
    }
  }

  return newBooking;
}

module.exports = {
  createBooking,
  findActiveBooking,
  updateBooking,
};