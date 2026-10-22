import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { createApp } from './app.js';
import { providerInfo } from './agent/index.js';
import { setGatewayUrl } from './agent/gateway.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = path.resolve(serverRoot, process.env.DATA_FILE || './data/db.json');
// API_PORT, not PORT: hosting tools often set PORT for the frontend dev server.
const port = Number(process.env.API_PORT) || 8787;

const store = new Store(dataFile);
const app = createApp({ store, clientDist: path.resolve(serverRoot, '../client/dist') });

app.listen(port, () => {
  // The Alexa+ simulator reaches the Jarvis tools over Streamable HTTP, like any MCP client.
  setGatewayUrl(`http://127.0.0.1:${port}/mcp`);
  console.log(`Jarvis LifeOS API on http://localhost:${port} | MCP: http://localhost:${port}/mcp`);
  console.log(`AI: ${providerInfo().label} | data: ${dataFile}`);
});
