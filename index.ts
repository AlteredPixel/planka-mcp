import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerTools } from "./common/registerTools.js";
import { VERSION } from "./common/version.js";

const server = new McpServer(
  {
    name: "planka-mcp-server",
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register all consolidated kanban tools (shared with the HTTP server).
registerTools(server);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch((err) => {
  console.error("Error running server:", err);
  process.exit(1);
});
