import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config();

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

export type AppConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenPath: string;
};

export function loadConfig(): AppConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost";
  const tokenPath = path.resolve(process.env.GMAIL_TOKEN_PATH ?? ".gmail-token.json");

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET. Copy .env.example to .env and fill OAuth credentials.",
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    tokenPath,
  };
}
