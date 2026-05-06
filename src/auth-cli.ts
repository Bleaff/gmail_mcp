import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { buildAuthUrl, exchangeCodeForToken, saveCredentials } from "./auth.js";

const rl = readline.createInterface({ input, output });

try {
  console.log("Open this URL in your browser and authorize Gmail access:");
  console.log(buildAuthUrl());
  const code = await rl.question("Paste the authorization code here: ");
  const tokens = await exchangeCodeForToken(code.trim());
  const tokenPath = await saveCredentials(tokens);
  console.log(`Saved Gmail OAuth token to ${tokenPath}`);
} finally {
  rl.close();
}
