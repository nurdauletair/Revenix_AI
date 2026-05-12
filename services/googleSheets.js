require("dotenv").config();

const { google } = require("googleapis");

function getGoogleAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,

    key: process.env.GOOGLE_PRIVATE_KEY.replace(
      /\\n/g,
      "\n"
    ),

    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });
}

async function appendBookingToSheet({
  spreadsheetId,
  booking,
}) {
  const auth = getGoogleAuth();

  const sheets = google.sheets({
    version: "v4",
    auth,
  });

  const values = [
    [
      new Date().toLocaleString("ru-RU", {
        timeZone: "Asia/Almaty",
      }),

      booking.channel || "",

      booking.customer_name || "",

      booking.customer_phone || "",

      booking.service || "",

      booking.address || "",

      booking.preferred_time || "",

      booking.status || "",

      booking.notes || "",

      booking.user_id || "",
    ],
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,

    range: "Sheet1!A:J",

    valueInputOption: "USER_ENTERED",

    insertDataOption: "INSERT_ROWS",

    requestBody: {
      values,
    },
  });
}

module.exports = {
  appendBookingToSheet,
};