#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createGmailClient, parseMessage, requiredMessageId, simplifyMessage } from "./gmail.js";

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

server.tool("gmail_profile", {}, async () => {
  const gmail = await createGmailClient();
  const response = await gmail.users.getProfile({ userId: USER_ID });
  return jsonText(response.data);
});

server.tool(
  "gmail_search",
  {
    query: z.string().default("in:inbox").describe("Gmail search query, for example 'in:inbox newer_than:7d'."),
    maxResults: z.number().int().min(1).max(100).default(10),
    includeSpamTrash: z.boolean().default(false),
  },
  async ({ query, maxResults, includeSpamTrash }) => {
    const gmail = await createGmailClient();
    const response = await gmail.users.messages.list({
      userId: USER_ID,
      q: query,
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
  const trashed = await Promise.all(
    ids.map(async (id) => {
      const response = await gmail.users.messages.trash({ userId: USER_ID, id });
      return simplifyMessage(response.data);
    }),
  );
  return jsonText({ trashed });
});

server.tool("gmail_untrash", messageIdsSchema, async ({ ids }) => {
  const gmail = await createGmailClient();
  const untrashed = await Promise.all(
    ids.map(async (id) => {
      const response = await gmail.users.messages.untrash({ userId: USER_ID, id });
      return simplifyMessage(response.data);
    }),
  );
  return jsonText({ untrashed });
});

const transport = new StdioServerTransport();
await server.connect(transport);
