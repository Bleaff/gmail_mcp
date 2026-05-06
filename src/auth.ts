import { promises as fs } from "node:fs";
import { OAuth2Client, type Credentials } from "google-auth-library";
import { GMAIL_SCOPES, loadConfig } from "./config.js";

export function createOAuthClient(): OAuth2Client {
  const config = loadConfig();
  return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
}

export async function loadStoredCredentials(): Promise<Credentials> {
  const config = loadConfig();
  const raw = await fs.readFile(config.tokenPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new Error(`Token file not found at ${config.tokenPath}. Run npm run auth first.`);
    }
    throw error;
  });

  return JSON.parse(raw) as Credentials;
}

export async function getAuthenticatedClient(): Promise<OAuth2Client> {
  const client = createOAuthClient();
  client.setCredentials(await loadStoredCredentials());
  return client;
}

export function buildAuthUrl(): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
  });
}

export async function exchangeCodeForToken(code: string): Promise<Credentials> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function saveCredentials(credentials: Credentials): Promise<string> {
  const config = loadConfig();
  await fs.writeFile(config.tokenPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  return config.tokenPath;
}
