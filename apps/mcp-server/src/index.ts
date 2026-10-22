import { createApp } from './app.js';
import { logger } from './callLog.js';

const port = Number(process.env.PORT ?? process.env.MCP_PORT ?? 5100);

createApp().listen(port, () => {
  logger.info(`Parcel Concierge MCP server on http://localhost:${port}/mcp (Streamable HTTP, stateless)`);
});
