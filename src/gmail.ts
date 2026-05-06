import { google, gmail_v1 } from "googleapis";
import { getAuthenticatedClient } from "./auth.js";

export type ParsedMessage = {
  id: string;
  threadId?: string | null;
  labelIds: string[];
  snippet?: string | null;
  headers: Record<string, string>;
  textBody?: string;
  htmlBody?: string;
};

export async function createGmailClient(): Promise<gmail_v1.Gmail> {
  const auth = await getAuthenticatedClient();
  return google.gmail({ version: "v1", auth });
}

export function parseMessage(message: gmail_v1.Schema$Message): ParsedMessage {
  const headers = collectHeaders(message.payload);
  const bodyParts = collectBodyParts(message.payload);

  return {
    id: requiredMessageId(message.id),
    threadId: message.threadId,
    labelIds: message.labelIds ?? [],
    snippet: message.snippet,
    headers,
    textBody: bodyParts.text.join("\n\n") || undefined,
    htmlBody: bodyParts.html.join("\n\n") || undefined,
  };
}

export function simplifyMessage(message: gmail_v1.Schema$Message) {
  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds ?? [],
    snippet: message.snippet,
  };
}

export function requiredMessageId(id: string | null | undefined): string {
  if (!id) {
    throw new Error("Gmail API returned a message without an id.");
  }
  return id;
}

function collectHeaders(payload: gmail_v1.Schema$MessagePart | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of payload?.headers ?? []) {
    if (header.name && header.value) {
      headers[header.name.toLowerCase()] = header.value;
    }
  }
  return headers;
}

function collectBodyParts(payload: gmail_v1.Schema$MessagePart | undefined): {
  text: string[];
  html: string[];
} {
  const result = { text: [] as string[], html: [] as string[] };
  walkParts(payload, (part) => {
    const mimeType = part.mimeType;
    const data = part.body?.data;
    if (!data || !mimeType) {
      return;
    }

    const decoded = decodeBase64Url(data);
    if (mimeType === "text/plain") {
      result.text.push(decoded);
    }
    if (mimeType === "text/html") {
      result.html.push(decoded);
    }
  });
  return result;
}

function walkParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  visit: (part: gmail_v1.Schema$MessagePart) => void,
): void {
  if (!part) {
    return;
  }
  visit(part);
  for (const child of part.parts ?? []) {
    walkParts(child, visit);
  }
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
}
