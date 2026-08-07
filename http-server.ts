/**
 * HTTP Server wrapper for Planka MCP
 *
 * Uses the official MCP SDK `StreamableHTTPServerTransport` (Streamable HTTP
 * transport spec: POST /mcp for requests, GET /mcp for the server->client SSE
 * stream, DELETE /mcp to end a session). Sessions are stateful and keyed by the
 * `Mcp-Session-Id` header.
 *
 * Access control: requests to /mcp require `Authorization: Bearer <PLANKA_MCP_TOKEN>`.
 * If PLANKA_MCP_TOKEN is not set, /mcp is CLOSED (every request is rejected) — the
 * token must be configured before the HTTP transport can be used.
 */

import express, { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { registerTools } from "./common/registerTools.js";
import { VERSION } from "./common/version.js";

const PORT = parseInt(process.env.PLANKA_MCP_PORT || "3008", 10);
const MCP_TOKEN = process.env.PLANKA_MCP_TOKEN;

// Build a fresh McpServer with all tools registered.
function createServer(): McpServer {
  const server = new McpServer(
    { name: "planka-mcp-server", version: VERSION },
    { capabilities: { tools: {} } }
  );
  registerTools(server);
  return server;
}

// Active transports keyed by session ID.
const transports = new Map<string, StreamableHTTPServerTransport>();

const app = express();
app.use(express.json());

// Health check endpoint (no auth — used by container/orchestrator probes).
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    success: true,
    status: "healthy",
    service: "planka-mcp",
    version: VERSION,
    authRequired: true,
    tokenConfigured: Boolean(MCP_TOKEN),
    activeSessions: transports.size,
    timestamp: new Date().toISOString(),
  });
});

// Bearer-token auth for all /mcp requests. Closed by default: if no token is
// configured, every request is rejected.
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!MCP_TOKEN) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "Server misconfigured: PLANKA_MCP_TOKEN is not set, so the MCP HTTP endpoint is disabled.",
      },
      id: null,
    });
    return;
  }

  const header = req.headers.authorization;
  const expected = `Bearer ${MCP_TOKEN}`;
  if (header !== expected) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: missing or invalid bearer token." },
      id: null,
    });
    return;
  }

  next();
}

app.use("/mcp", requireAuth);

// POST /mcp — client->server JSON-RPC (initialize + all subsequent requests).
app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (sessionId) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unknown or expired session ID." },
          id: null,
        });
        return;
      }

      // No session yet: only an initialize request may open one.
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: no valid session ID for a non-initialize request." },
          id: null,
        });
        return;
      }

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
        },
      });

      transport.onclose = () => {
        if (transport!.sessionId) {
          transports.delete(transport!.sessionId);
        }
      };

      const server = createServer();
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error: any) {
    console.error("Error handling MCP POST:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: error?.message || String(error) },
        id: null,
      });
    }
  }
});

// GET /mcp — server->client SSE stream for an established session.
// DELETE /mcp — explicit session teardown.
async function handleSessionRequest(req: Request, res: Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: missing Mcp-Session-Id header." },
      id: null,
    });
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unknown or expired session ID." },
      id: null,
    });
    return;
  }

  await transport.handleRequest(req, res);
}

app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Planka MCP HTTP server running on http://0.0.0.0:${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
  console.log(`  MCP:    http://localhost:${PORT}/mcp (streamable-http)`);
  if (!MCP_TOKEN) {
    console.warn(
      "  WARNING: PLANKA_MCP_TOKEN is not set — /mcp is DISABLED until you configure it."
    );
  } else {
    console.log("  Auth:   Bearer token required (PLANKA_MCP_TOKEN)");
  }
});
