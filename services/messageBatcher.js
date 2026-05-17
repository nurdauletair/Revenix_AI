const pendingMessages = new Map();

function getBatchKey({ businessId, channel, userId }) {
  return `${businessId}:${channel}:${userId}`;
}

function addMessageToBatch({
  business,
  channel,
  userId,
  text,
  delayMs = 6000,
  onReady,
}) {
  const key = getBatchKey({
    businessId: business.id,
    channel,
    userId,
  });

  const existing = pendingMessages.get(key);

  if (existing?.timer) {
    clearTimeout(existing.timer);
  }

  const messages = existing?.messages || [];

  messages.push(text);

  const timer = setTimeout(async () => {
    const batch = pendingMessages.get(key);

    if (!batch) return;

    pendingMessages.delete(key);

    const combinedText = batch.messages
      .filter(Boolean)
      .map((item) => String(item).trim())
      .filter(Boolean)
      .join("\n");

    if (!combinedText) return;

    try {
      await onReady({
        business,
        channel,
        userId,
        text: combinedText,
      });
    } catch (err) {
      console.error("Message batch processing error:", err);
    }
  }, delayMs);

  pendingMessages.set(key, {
    messages,
    timer,
  });
}

module.exports = {
  addMessageToBatch,
};