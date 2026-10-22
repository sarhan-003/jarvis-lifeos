import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { createAgentApp } from './app.js';
import { chooseProvider } from './providers.js';
import { McpToolGateway } from './mcpClient.js';

const env = loadEnv();
// Default to the monorepo's built web app when WEB_DIST is not set.
env.WEB_DIST ??= path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

const gateway = new McpToolGateway(env.MCP_SERVER_URL, env.MCP_DEV_TOKEN);
const choice = chooseProvider(env, gateway);
// --port=N (used by `npm run dev`) wins over PORT, which hosts like App Runner set.
const cliPort = process.argv.find((a) => a.startsWith('--port='))?.split('=')[1];
const port = cliPort ? Number(cliPort) : (env.PORT ?? env.AGENT_PORT);

createAgentApp({ env, gateway, choice }).listen(port, () => {
  console.log(`Agent API on http://localhost:${port} | MCP: ${env.MCP_SERVER_URL} | engine: ${choice.provider.label}`);
  if (choice.warning) console.warn(choice.warning);
});
