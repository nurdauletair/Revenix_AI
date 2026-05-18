require("dotenv").config();

const { google } = require("googleapis");

const SHEET_NAME = "Sheet1";

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

function getSheetsClient() {
  const auth = getGoogleAuth();

  return google.sheets({
    version: "v4",
    auth,
  });
}

function getAlmatyDateTime() {
  return new Date().toLocaleString("ru-RU", {
    timeZone: "Asia/Almaty",
  });
}

async function appendRowToSheet({ spreadsheetId, values }) {
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:P`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values,
    },
  });
}

// ======================
// APPEND NEW BOOKING
// ======================

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

// ======================
// APPEND BOOKING UPDATE
// ======================

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

// ======================
// UPDATE STATUS + COLOR ROW
// Ищем клиента по user_id в колонке J
// Статус меняем в колонке H
// Строку красим:
// closed = зелёный
// lost = красный
// ======================

async function getSheetIdByTitle({ sheets, spreadsheetId, title }) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  const sheet = response.data.sheets.find(
    (item) => item.properties.title === title
  );

  if (!sheet) {
    throw new Error(`Sheet not found: ${title}`);
  }

  return sheet.properties.sheetId;
}

function getStatusColor(status) {
  if (status === "closed") {
    return {
      red: 0.78,
      green: 0.94,
      blue: 0.8,
    };
  }

  if (status === "lost") {
    return {
      red: 1,
      green: 0.8,
      blue: 0.8,
    };
  }

  return {
    red: 1,
    green: 1,
    blue: 1,
  };
}

async function updateBookingStatusInSheet({
  spreadsheetId,
  userId,
  status,
}) {
  if (!spreadsheetId) {
    console.log("Google Sheet status update skipped: spreadsheetId missing");
    return;
  }

  if (!userId) {
    console.log("Google Sheet status update skipped: userId missing");
    return;
  }

  const sheets = getSheetsClient();

  const rowsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:P`,
  });

  const rows = rowsResponse.data.values || [];

  if (!rows.length) {
    console.log("Google Sheet status update skipped: sheet is empty");
    return;
  }

  const matchingIndexes = [];

  rows.forEach((row, index) => {
    // user_id находится в колонке J, индекс 9
    const rowUserId = String(row[9] || "").trim();

    if (rowUserId === String(userId).trim()) {
      matchingIndexes.push(index);
    }
  });

  if (!matchingIndexes.length) {
    console.log("Google Sheet row not found for user:", userId);
    return;
  }

  // Берём последнюю строку этого клиента
  const rowIndex = matchingIndexes[matchingIndexes.length - 1];
  const sheetRowNumber = rowIndex + 1;

  // Обновляем статус в колонке H
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!H${sheetRowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[status]],
    },
  });

  const sheetId = await getSheetIdByTitle({
    sheets,
    spreadsheetId,
    title: SHEET_NAME,
  });

  const backgroundColor = getStatusColor(status);

  // Красим строку A:P
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 0,
              endColumnIndex: 16,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor,
              },
            },
            fields: "userEnteredFormat.backgroundColor",
          },
        },
      ],
    },
  });

  console.log("✅ Google Sheet status updated:", {
    userId,
    status,
    row: sheetRowNumber,
  });
}

module.exports = {
  appendBookingToSheet,
  appendBookingUpdateToSheet,
  updateBookingStatusInSheet,
};