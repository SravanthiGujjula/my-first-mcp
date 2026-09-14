# MCP Transports — Learning Notes

How the same MCP protocol travels over different "pipes," and how the remote
(HTTP) transport recently went **stateless**.

> **Heads-up on versions:** the newest spec revision (`2026-07-28`) removed
> sessions and the handshake (see [§7](#7-the-stateless-update-2026-07-28)). But
> the SDK pinned in this repo (`@modelcontextprotocol/sdk@^1.30`) still
> implements the **older, stateful** Streamable HTTP model (`Mcp-Session-Id`,
> `initialize`/`initialized`). So the code sketches below reflect what the SDK
> supports *today*; the stateless note flags what changes next.

---

## 1. Mental model: transport vs protocol

The **protocol** (JSON-RPC messages: `initialize`, `tools/list`, `tools/call`,
notifications) is always the same. The **transport** is just the pipe those
messages travel through. Swapping transports does not change your tool code —
`server.registerTool(...)` is identical; only `server.connect(transport)`
changes.

Two families:

| | **stdio** | **HTTP** |
|---|---|---|
| Where the server runs | local child process | anywhere reachable by URL |
| Who launches it | the host (Claude) | already running; host connects |
| Transport | stdin/stdout pipes | HTTP requests to an endpoint |
| Auth | none (same machine) | needed (OAuth / tokens / headers) |
| Best for | personal/local tools | shared, hosted, multi-user servers |

This repo's server uses **stdio**. HTTP is the other half.

---

## 2. stdio (what this repo uses)

The host spawns the server as a child process and talks over stdin/stdout with
newline-delimited JSON-RPC.

```
Claude (host)  <--- JSON-RPC over stdio --->  node dist/index.js
```

- Host writes requests → server **stdin**
- Host reads responses ← server **stdout**
- Host reads logs ← server **stderr**  (never `console.log` — it corrupts stdout)

Simplest possible transport: no network, no port, no auth.

---

## 3. "Streamable" — what it actually means

Streaming is a **protocol feature, not an HTTP-only thing**. During one
`tools/call`, a server may send *multiple* messages before the final result —
progress (`notifications/progress`), logs (`notifications/message`), etc.

- Over **stdio**, streaming is free: the pipe is persistent and bidirectional,
  so the server just writes more lines.
- Over **HTTP**, a plain request/response cannot do that. So MCP defines
  **Streamable HTTP**: the server can reply to a POST with either a single JSON
  response *or* a **Server-Sent Events (SSE)** stream (`text/event-stream`) that
  pushes many messages over one open connection. That SSE capability is why it
  is called "Streamable HTTP."

Both transports support streaming; "Streamable HTTP" is just the HTTP transport
that added a mechanism (SSE) to stream.

---

## 4. Streamable HTTP on the wire (stateful model — SDK 1.x)

One endpoint, conventionally `POST /mcp`:

1. **Client → server:** each JSON-RPC message is an HTTP `POST /mcp` with the
   message in the body.
2. **Server → client — two response modes:**
   - **Plain JSON** — for a quick call, respond `application/json` with the one
     result. (SDK option: `enableJsonResponse: true`.)
   - **SSE stream** — respond `text/event-stream` and push progress /
     notifications, then the final result, over the held-open connection.
3. **Sessions:** on `initialize` the server issues an `Mcp-Session-Id` header;
   the client echoes it on every later request. This is what makes it *stateful*
   across requests.
4. **Optional standalone stream:** the client can also `GET /mcp` to open an SSE
   channel purely for **server→client** messages outside any specific call.

### Deprecated predecessor: HTTP+SSE

The older transport (SDK's `client/sse.js` / `server/sse.js`) used **two**
endpoints — a `GET /sse` to open a stream that returned a POST URL, then POSTs
for messages. Streamable HTTP (2025-03-26) replaced it with one endpoint. You
will still see SSE servers in the wild; recognize them, but build new servers
with Streamable HTTP.

---

## 5. Server side (sketch — real SDK class names)

Tool registration is byte-for-byte identical to the stdio server; only the
transport changes.

```ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";

// Stateful: sessions tracked via Mcp-Session-Id
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});
await server.connect(transport);
// wire transport.handleRequest(req, res) into an Express/Node route at /mcp
```

Two modes:

- **Stateful** — `sessionIdGenerator: () => randomUUID()`. Keeps per-session
  state; needed if the server holds context between calls.
- **Stateless** — `sessionIdGenerator: undefined`. Every request independent —
  ideal for serverless (Cloudflare Workers, Lambda) and horizontal scaling.
  (For those runtimes the SDK also ships
  `WebStandardStreamableHTTPServerTransport`, using web-standard
  `Request`/`Response`.)

---

## 6. Client side (sketch)

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "my-client", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:3000/mcp")));
const tools = await client.listTools();
```

vs the stdio client, which *spawns* the server instead of dialing a URL:

```ts
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
```

Core difference: **stdio client launches a process; HTTP client dials a URL.**
The SDK also ships a `websocket` client transport (full-duplex), but it is not a
standard host transport — skip unless you have a specific need.

---

## 7. The stateless update (2026-07-28)

Protocol revision **`2026-07-28`** removed protocol-level session state from
Streamable HTTP so servers can scale horizontally (no session pinning to a
specific pod/container).

**What was removed:**

- **The `Mcp-Session-Id` header (SEP-2567)** — gone entirely.
- **The `initialize` / `initialized` handshake (SEP-2575)** — gone. Every
  request is now **self-describing and independent**.

**What replaces it:**

- **Version negotiation inline** via the `MCP-Protocol-Version` HTTP header
  (e.g. `2026-07-28`), with client capabilities/info echoed in the request
  body's `_meta` field.
- **Standard HTTP routing headers (SEP-2243):** `Mcp-Protocol-Version`,
  `Mcp-Method` (e.g. `tools/call`), `Mcp-Name` (the tool/resource name) — so
  gateways route without "deep packet inspection" of the body.
- **Server-initiated notifications** → replaced by **Multi Round-Trip Requests
  (MRTR, SEP-2322)**: a call can return an `InputRequiredResult` with serialized
  `requestState` that *any* server instance can resume.
- **Long-running work** → the **Tasks Extension (SEP-2663)**: the server returns
  a `taskId` immediately; the client polls with `tasks/get` / `tasks/update`.
- **Sampling** → deprecated in favor of the client calling LLM provider APIs
  directly.

**Why:** the session model required persistent in-memory state, a handshake, and
pinning each client to one instance — which breaks cloud-native horizontal
scaling. Stateless requests can hit any instance behind a load balancer.

> **This repo's SDK (`1.30`) predates `2026-07-28`.** It still exposes
> `sessionIdGenerator` and the handshake. When you build the HTTP server here,
> expect the *stateful* API; treat this section as what to migrate toward once
> the SDK ships the stateless revision. Practically, prefer **stateless mode**
> (`sessionIdGenerator: undefined`) now, since it is closest to where the spec
> is going.

---

## 8. How this maps to the hosts

- **Claude Code** speaks all three: `stdio`, `sse`, and `http` (Streamable
  HTTP). In this environment `figma` and `context7` are `(HTTP)` servers while
  `playwright` is stdio. Add an HTTP server with
  `claude mcp add --transport http <name> <url>`.
- **Claude desktop app** is primarily stdio locally; remote servers reach it
  through connectors rather than a raw URL in `claude_desktop_config.json`.

---

## 9. Which transport to choose

| Situation | Transport |
|---|---|
| Local, personal, single-user | **stdio** (this repo) |
| Shared / hosted / multi-user / remote | **Streamable HTTP** |
| Serverless (Workers, Lambda) | Streamable HTTP, **stateless** mode |
| Interop with a pre-2025 server | legacy `sse` (deprecated) |

Rule of thumb: **stdio for local, Streamable HTTP for remote — and lean
stateless** so you are ready for the `2026-07-28` direction.

---

## 10. Streaming in practice (this repo)

The `stream_load` tool in `src/server.ts` emits a `notifications/progress`
message per step, then returns a final result. This is "streaming text loading."

**How it works:**

1. The **client opts in** by sending a `progressToken` in the request's `_meta`.
   The SDK client does this automatically when you pass an `onprogress` callback
   to `callTool` (see `src/client.ts`).
2. The **server** reads `extra._meta.progressToken` in the tool handler and, for
   each step, calls `extra.sendNotification({ method: "notifications/progress",
   params: { progressToken, progress, total, message } })`.
3. Notifications arrive **before** the final result:
   - Over **HTTP** (SSE mode) as `event: message` / `data: {...}` lines on the
     open POST connection.
   - Over **stdio** as interleaved JSON-RPC notification lines.

**Transport toggle:** `src/http.ts` uses SSE by default so streaming is visible.
Set `MCP_JSON=1` to force a single plain-JSON reply instead (simpler for curl,
but then intermediate notifications cannot be streamed — you only get the final
result).

**See it on the wire:**

```bash
npm run start:http          # SSE mode (default)
curl -sN -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"stream_load","arguments":{"steps":3},"_meta":{"progressToken":"p1"}}}'
```

Emits three `notifications/progress` events, then the final `result` event.
`npm run client` shows the same thing via the SDK's `onprogress` callback.

> Note: `notifications/progress` streams *status/metadata* (progress + a message
> string), not the assistant's generated text. Streaming partial *result*
> content (e.g. token-by-token tool output) is a separate concern; progress
> notifications are the standard mechanism for "still working…" updates.

## Sources

- [Scaling AI Agent Infrastructure with the MCP Stateless updates — Google Developers Blog](https://developers.googleblog.com/scaling-ai-agent-infrastructure-with-the-mcp-stateless-updates/)
- [MCP Goes Stateless: What Changed and Why It Matters — JustSteveKing](https://www.juststeveking.com/articles/mcp-goes-stateless/)
- [Stateless MCP: the spec is dropping session state — Wire Blog](https://usewire.io/blog/stateless-mcp-dropping-session-state/)
- [MCP Streamable HTTP Transport: From SSE Migration to Production — Apigene Blog](https://apigene.ai/blog/mcp-streamable-http)
- [Model Context Protocol — TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
