require("dotenv").config();

const { google } = require("googleapis");

function getGoogleAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL is missing");
  }

  if (!process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error("GOOGLE_PRIVATE_KEY is missing");
  }

  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getAlmatyDateTime() {
  return new Date().toLocaleString("ru-RU", {
    timeZone: "Asia/Almaty",
  });
}

async function appendRowToSheet({ spreadsheetId, values }) {
  const auth = getGoogleAuth();

  const sheets = google.sheets({
    version: "v4",
    auth,
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Sheet1!A:P",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values,
    },
  });
}

async function appendBookingToSheet({ spreadsheetId, booking }) {
  const values = [
    [
      getAlmatyDateTime(),

      booking.channel || "",

      booking.customer_name || "",

      booking.customer_phone || "",

      booking.service || "",

      booking.address || "",

      booking.preferred_time || "",

      booking.status || "new",

      booking.notes || "",

      booking.user_id || "",

      booking.lead_quality || "",

      booking.room_type || "",

      booking.estimated_area || "",

      booking.urgency || "",

      booking.intent || "",

      booking.manager_required ? "Да" : "Нет",
    ],
  ];

  await appendRowToSheet({
    spreadsheetId,
    values,
  });
}

function buildUpdateNote({ oldBooking, newBooking }) {
  const changes = [];

  if (oldBooking?.preferred_time !== newBooking?.preferred_time) {
    changes.push(
      `Время: ${oldBooking?.preferred_time || "не указано"} → ${
        newBooking?.preferred_time || "не указано"
      }`
    );
  }

  if (oldBooking?.address !== newBooking?.address) {
    changes.push(
      `Адрес: ${oldBooking?.address || "не указано"} → ${
        newBooking?.address || "не указано"
      }`
    );
  }

  if (oldBooking?.room_type !== newBooking?.room_type) {
    changes.push(
      `Комната: ${oldBooking?.room_type || "не указано"} → ${
        newBooking?.room_type || "не указано"
      }`
    );
  }

  if (oldBooking?.estimated_area !== newBooking?.estimated_area) {
    changes.push(
      `Площадь: ${oldBooking?.estimated_area || "не указано"} → ${
        newBooking?.estimated_area || "не указано"
      }`
    );
  }

  if (oldBooking?.customer_name !== newBooking?.customer_name) {
    changes.push(
      `Имя: ${oldBooking?.customer_name || "не указано"} → ${
        newBooking?.customer_name || "не указано"
      }`
    );
  }

  if (!changes.length) {
    return "Заявка обновлена";
  }

  return `Заявка обновлена: ${changes.join("; ")}`;
}

async function appendBookingUpdateToSheet({
  spreadsheetId,
  oldBooking,
  newBooking,
}) {
  const values = [
    [
      getAlmatyDateTime(),

      newBooking.channel || "",

      newBooking.customer_name || "",

      newBooking.customer_phone || "",

      newBooking.service || "",

      newBooking.address || "",

      newBooking.preferred_time || "",

      "updated",

      buildUpdateNote({
        oldBooking,
        newBooking,
      }),

      newBooking.user_id || "",

      newBooking.lead_quality || "",

      newBooking.room_type || "",

      newBooking.estimated_area || "",

      newBooking.urgency || "",

      newBooking.intent || "",

      newBooking.manager_required ? "Да" : "Нет",
    ],
  ];

  await appendRowToSheet({
    spreadsheetId,
    values,
  });
}

module.exports = {
  appendBookingToSheet,
  appendBookingUpdateToSheet,
};