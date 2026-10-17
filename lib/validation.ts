// Validation des entrées de l'API sans Zod : le webhook Telegram embarque ainsi ~110 ko au lieu de ~550 ko.
// Même comportement que les anciens schémas Zod : toute charge utile mal formée donne null (le webhook l'ignore).
import type { WorkerJob } from "./types";

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const MAX_TEXT = 4096; // limite réelle d'un message Telegram

// Un message texte d'une mise à jour Telegram, ou null : charge mal formée, mise à jour sans message, ou message sans texte
// (photo, sticker…).
export function readTelegramMessage(body: unknown): WorkerJob | null {
  if (!isObject(body) || !isNumber(body.update_id)) return null;
  const message = body.message;
  if (message === undefined) return null;
  if (!isObject(message) || !isObject(message.chat) || !isNumber(message.chat.id) || !isNumber(message.message_id)) return null;
  if (message.text !== undefined && typeof message.text !== "string") return null;
  if (!message.text) return null;
  return { chatId: message.chat.id, text: message.text, messageId: message.message_id };
}

// Un travail de la file QStash, ou null s'il est mal formé (texte vide ou trop long, champ manquant).
export function readWorkerJob(body: unknown): WorkerJob | null {
  if (!isObject(body) || !isNumber(body.chatId) || !isNumber(body.messageId)) return null;
  if (typeof body.text !== "string" || body.text.length < 1 || body.text.length > MAX_TEXT) return null;
  if (body.protocolTimeout !== undefined && typeof body.protocolTimeout !== "string") return null;
  return { chatId: body.chatId, text: body.text, messageId: body.messageId, ...(body.protocolTimeout ? { protocolTimeout: body.protocolTimeout } : {}) };
}
