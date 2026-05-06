#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createGmailClient, parseMessage, requiredMessageId, simplifyMessage } from "./gmail.js";
import { loadConfig } from "./config.js";
import { buildAuthUrl, exchangeCodeForToken, loadStoredCredentials, saveCredentials } from "./auth.js";

const USER_ID = "me";

const server = new McpServer({
  name: "gmail-mcp-server",
  version: "0.1.0",
});

function jsonText(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

const messageIdsSchema = {
  ids: z.array(z.string().min(1)).min(1).max(1000).describe("Gmail message IDs."),
};

function normalizeSearchQuery(query: string): string {
  const normalized = query.trim();
  if (!normalized) {
    return "in:anywhere";
  }

  if (/\b(maxResults|includeSpamTrash)\s*:/i.test(normalized)) {
    throw new Error(
      "Invalid Gmail query. Put maxResults and includeSpamTrash in their own tool arguments, not inside query. Example: query='in:anywhere', maxResults=5, includeSpamTrash=true.",
    );
  }

  return normalized;
}

function googleApiErrorInfo(error: unknown): { status?: number; message: string } {
  if (error instanceof Error) {
    const maybeGoogleError = error as Error & {
      code?: number;
      response?: {
        status?: number;
        data?: {
          error?: {
            message?: string;
          };
        };
      };
    };

    return {
      status: maybeGoogleError.response?.status ?? maybeGoogleError.code,
      message: maybeGoogleError.response?.data?.error?.message ?? error.message,
    };
  }

  return { message: String(error) };
}

function isNotFoundError(error: unknown): boolean {
  const info = googleApiErrorInfo(error);
  return info.status === 404 || /not found|requested entity was not found/i.test(info.message);
}

server.tool("gmail_auth_status", {}, async () => {
  const status: Record<string, unknown> = {
    ok: false,
    config: {
      hasGoogleClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
      hasGoogleClientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
      gmailTokenPath: process.env.GMAIL_TOKEN_PATH ?? ".gmail-token.json",
    },
  };

  try {
    const config = loadConfig();
    const credentials = await loadStoredCredentials();
    status.ok = true;
    status.config = {
      hasGoogleClientId: Boolean(config.clientId),
      hasGoogleClientSecret: Boolean(config.clientSecret),
      gmailTokenPath: config.tokenPath,
    };
    status.credentials = {
      hasAccessToken: Boolean(credentials.access_token),
      hasRefreshToken: Boolean(credentials.refresh_token),
      expiryDate: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
    };
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
  }

  return jsonText(status);
});

server.tool("gmail_auth_url", {}, async () => {
  const config = loadConfig();

  return jsonText({
    authUrl: buildAuthUrl(),
    redirectUri: config.redirectUri,
    nextStep: "Open authUrl, approve Gmail access, then call gmail_auth_exchange with the returned code.",
  });
});

server.tool(
  "gmail_auth_exchange",
  {
    code: z.string().min(1).describe("OAuth authorization code returned by Google after approval."),
  },
  async ({ code }) => {
    const tokens = await exchangeCodeForToken(code.trim());
    const tokenPath = await saveCredentials(tokens);

    return jsonText({
      saved: true,
      tokenPath,
      hasAccessToken: Boolean(tokens.access_token),
      hasRefreshToken: Boolean(tokens.refresh_token),
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    });
  },
);

server.tool("gmail_profile", {}, async () => {
  const gmail = await createGmailClient();
  const response = await gmail.users.getProfile({ userId: USER_ID });
  return jsonText(response.data);
});

server.tool(
  "gmail_search",
  {
    query: z
      .string()
      .default("in:inbox")
      .describe("Gmail search query only, for example 'in:inbox newer_than:7d' or 'in:anywhere'. Do not put maxResults here."),
    maxResults: z.number().int().min(1).max(100).default(10),
    includeSpamTrash: z.boolean().default(false),
  },
  async ({ query, maxResults, includeSpamTrash }) => {
    const gmailQuery = normalizeSearchQuery(query);
    const gmail = await createGmailClient();
    const response = await gmail.users.messages.list({
      userId: USER_ID,
      q: gmailQuery,
      maxResults,
      includeSpamTrash,
    });

    const messages = response.data.messages ?? [];
    const detailed = await Promise.all(
      messages.map(async (message) => {
        const id = requiredMessageId(message.id);
        const detail = await gmail.users.messages.get({
          userId: USER_ID,
          id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"],
        });
        return {
          ...simplifyMessage(detail.data),
          headers: detail.data.payload?.headers ?? [],
        };
      }),
    );

    return jsonText({
      query: gmailQuery,
      resultSizeEstimate: response.data.resultSizeEstimate,
      nextPageToken: response.data.nextPageToken,
      messages: detailed,
    });
  },
);

server.tool(
  "gmail_read_message",
  {
    id: z.string().min(1),
    format: z.enum(["metadata", "full", "raw"]).default("full"),
  },
  async ({ id, format }) => {
    const gmail = await createGmailClient();
    const response = await gmail.users.messages.get({
      userId: USER_ID,
      id,
      format,
      metadataHeaders: format === "metadata" ? ["From", "To", "Cc", "Subject", "Date"] : undefined,
    });

    if (format === "full") {
      return jsonText(parseMessage(response.data));
    }

    return jsonText(response.data);
  },
);

server.tool("gmail_list_labels", {}, async () => {
  const gmail = await createGmailClient();
  const response = await gmail.users.labels.list({ userId: USER_ID });
  return jsonText(response.data.labels ?? []);
});

server.tool(
  "gmail_create_label",
  {
    name: z.string().min(1),
    labelListVisibility: z.enum(["labelShow", "labelShowIfUnread", "labelHide"]).default("labelShow"),
    messageListVisibility: z.enum(["show", "hide"]).default("show"),
  },
  async ({ name, labelListVisibility, messageListVisibility }) => {
    const gmail = await createGmailClient();
    const response = await gmail.users.labels.create({
      userId: USER_ID,
      requestBody: {
        name,
        labelListVisibility,
        messageListVisibility,
      },
    });
    return jsonText(response.data);
  },
);

server.tool(
  "gmail_modify_labels",
  {
    id: z.string().min(1),
    addLabelIds: z.array(z.string().min(1)).max(100).default([]),
    removeLabelIds: z.array(z.string().min(1)).max(100).default([]),
  },
  async ({ id, addLabelIds, removeLabelIds }) => {
    const gmail = await createGmailClient();
    const response = await gmail.users.messages.modify({
      userId: USER_ID,
      id,
      requestBody: { addLabelIds, removeLabelIds },
    });
    return jsonText(simplifyMessage(response.data));
  },
);

server.tool(
  "gmail_batch_modify_labels",
  {
    ...messageIdsSchema,
    addLabelIds: z.array(z.string().min(1)).default([]),
    removeLabelIds: z.array(z.string().min(1)).default([]),
  },
  async ({ ids, addLabelIds, removeLabelIds }) => {
    const gmail = await createGmailClient();
    await gmail.users.messages.batchModify({
      userId: USER_ID,
      requestBody: { ids, addLabelIds, removeLabelIds },
    });
    return jsonText({ modified: ids.length, addLabelIds, removeLabelIds });
  },
);

server.tool("gmail_archive", messageIdsSchema, async ({ ids }) => {
  const gmail = await createGmailClient();
  await gmail.users.messages.batchModify({
    userId: USER_ID,
    requestBody: { ids, removeLabelIds: ["INBOX"] },
  });
  return jsonText({ archived: ids.length });
});

server.tool("gmail_mark_read", messageIdsSchema, async ({ ids }) => {
  const gmail = await createGmailClient();
  await gmail.users.messages.batchModify({
    userId: USER_ID,
    requestBody: { ids, removeLabelIds: ["UNREAD"] },
  });
  return jsonText({ markedRead: ids.length });
});

server.tool("gmail_mark_unread", messageIdsSchema, async ({ ids }) => {
  const gmail = await createGmailClient();
  await gmail.users.messages.batchModify({
    userId: USER_ID,
    requestBody: { ids, addLabelIds: ["UNREAD"] },
  });
  return jsonText({ markedUnread: ids.length });
});

server.tool("gmail_mark_spam", messageIdsSchema, async ({ ids }) => {
  const gmail = await createGmailClient();
  await gmail.users.messages.batchModify({
    userId: USER_ID,
    requestBody: { ids, addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
  });
  return jsonText({ markedSpam: ids.length });
});

server.tool("gmail_unmark_spam", messageIdsSchema, async ({ ids }) => {
  const gmail = await createGmailClient();
  await gmail.users.messages.batchModify({
    userId: USER_ID,
    requestBody: { ids, removeLabelIds: ["SPAM"], addLabelIds: ["INBOX"] },
  });
  return jsonText({ unmarkedSpam: ids.length });
});

server.tool("gmail_trash", messageIdsSchema, async ({ ids }) => {
  const gmail = await createGmailClient();
  const results = await Promise.all(
    ids.map(async (id): Promise<{ id: string; status: string; message?: string; messageData?: unknown }> => {
      try {
        const response = await gmail.users.messages.trash({ userId: USER_ID, id });
        return { id, status: "trashed", messageData: simplifyMessage(response.data) };
      } catch (error) {
        const info = googleApiErrorInfo(error);
        return {
          id,
          status: isNotFoundError(error) ? "not_found" : "failed",
          message: info.message,
        };
      }
    }),
  );

  return jsonText({
    requested: ids.length,
    trashed: results.filter((result) => result.status === "trashed").map((result) => result.messageData),
    notFound: results.filter((result) => result.status === "not_found").map((result) => result.id),
    failed: results
      .filter((result) => result.status === "failed")
      .map((result) => ({ id: result.id, message: result.message })),
  });
});

server.tool("gmail_untrash", messageIdsSchema, async ({ ids }) => {
  const gmail = await createGmailClient();
  const results = await Promise.all(
    ids.map(async (id): Promise<{ id: string; status: string; message?: string; messageData?: unknown }> => {
      try {
        const response = await gmail.users.messages.untrash({ userId: USER_ID, id });
        return { id, status: "untrashed", messageData: simplifyMessage(response.data) };
      } catch (error) {
        const info = googleApiErrorInfo(error);
        return {
          id,
          status: isNotFoundError(error) ? "not_found" : "failed",
          message: info.message,
        };
      }
    }),
  );

  return jsonText({
    requested: ids.length,
    untrashed: results.filter((result) => result.status === "untrashed").map((result) => result.messageData),
    notFound: results.filter((result) => result.status === "not_found").map((result) => result.id),
    failed: results
      .filter((result) => result.status === "failed")
      .map((result) => ({ id: result.id, message: result.message })),
  });
});

const transport = new StdioServerTransport();
await server.connect(transport);
