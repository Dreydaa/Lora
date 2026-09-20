const api = () => {
  if (!process.env.TELEGRAM_BOT_TOKEN)
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
};
export async function sendTelegram(chatId: number, text: string) {
  if (String(chatId) !== process.env.TELEGRAM_ALLOWED_CHAT_ID)
    throw new Error("Blocked chat_id");
  const response = await fetch(`${api()}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) throw new Error(`Telegram error: ${await response.text()}`);
}
