# Gmail MCP Server

TypeScript MCP server for Gmail. It exposes tools an agent can use to search and read mail, manage labels, archive messages, move messages to trash, and mark messages as spam/read/unread.

## Tools

- `gmail_profile` - show the authenticated Gmail profile.
- `gmail_search` - search messages with Gmail query syntax.
- `gmail_read_message` - read one message as metadata, full parsed text, or raw Gmail API payload.
- `gmail_list_labels` - list system and user labels.
- `gmail_create_label` - create a Gmail label.
- `gmail_modify_labels` - add/remove labels on one message.
- `gmail_batch_modify_labels` - add/remove labels on up to 1000 messages.
- `gmail_archive` - remove messages from Inbox.
- `gmail_trash` / `gmail_untrash` - move messages to/from Trash.
- `gmail_mark_read` / `gmail_mark_unread` - toggle unread state.
- `gmail_mark_spam` / `gmail_unmark_spam` - move messages to/from Spam.

## Setup

1. Create a Google Cloud OAuth client for a Desktop app.
2. Enable the Gmail API in the same Google Cloud project.
3. Copy `.env.example` to `.env` and fill in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Install dependencies:

```bash
npm install
```

5. Generate and store a refresh token:

```bash
npm run auth
```

6. Build:

```bash
npm run build
```

## MCP client config

Use the built server over stdio:

```json
{
  "mcpServers": {
    "gmail": {
      "command": "node",
      "args": ["/absolute/path/to/gmail_mcp/dist/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-oauth-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-oauth-client-secret",
        "GMAIL_TOKEN_PATH": "/absolute/path/to/gmail_mcp/.gmail-token.json"
      }
    }
  }
}
```

The server requests `https://www.googleapis.com/auth/gmail.modify`, which covers reading messages and modifying labels. Keep `.env` and `.gmail-token.json` private.
