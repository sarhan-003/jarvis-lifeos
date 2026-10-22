import { createApp } from './app.js';
import { logger } from './callLog.js';

// --port=N (used by `npm run dev`) wins over PORT, which hosts like App Runner set.
const cliPort = process.argv.find((a) => a.startsWith('--port='))?.split('=')[1];
const port = Number(cliPort ?? process.env.PORT ?? process.env.MCP_PORT ?? 5100);

createApp().listen(port, () => {
  logger.info(`Parcel Concierge MCP server on http://localhost:${port}/mcp (Streamable HTTP, stateless)`);
});
