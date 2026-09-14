#!/usr/bin/env node
/**
 * Streamable HTTP entrypoint (stateless).
 *
 * Same tool as the stdio server (see ./server.ts) — only the transport differs.
 * The server listens on POST /mcp and handles each request independently:
 * we build a fresh McpServer + transport per request and tear them down when
 * the response closes. This is the STATELESS pattern (no Mcp-Session-Id, no
 * cross-request state), which scales horizontally and matches the direction of
 * the 2026-07-28 spec. See docs/transports.md.
 *
 * Unlike stdio, this process is NOT launched by the host — it runs on its own,
 * and a host (or our ./client.ts) connects to it by URL.
 */

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  try {
    // Stateless: a new server + transport for every request.
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // undefined => stateless (no Mcp-Session-Id)
      // SSE (default) lets the server stream progress notifications before the
      // final result. Set MCP_JSON=1 to force a single plain-JSON reply instead
      // (simpler for curl, but no streaming).
      enableJsonResponse: process.env.MCP_JSON === "1",
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// In stateless mode there is no server->client stream and no session to delete,
// so GET (open SSE stream) and DELETE (end session) are not supported.
const methodNotAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed (stateless server)." },
    id: null,
  });
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(PORT, () => {
  console.error(`my-first-mcp-server (HTTP) listening on http://localhost:${PORT}/mcp`);
});
