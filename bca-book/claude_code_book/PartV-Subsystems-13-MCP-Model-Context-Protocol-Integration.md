# Chapter 13: MCP (Model Context Protocol) Integration

> **Part V: Subsystems**

---

## What Is MCP?

The **Model Context Protocol** is an open standard created by Anthropic for connecting LLMs to external tools and data sources. It defines:

- A standardized JSON-RPC 2.0 protocol
- Tool definitions with JSON Schema inputs
- Resource discovery and access
- Authentication flows
- Transport options (stdio, SSE, HTTP)

Claude Code is one of the most complete MCP implementations: it acts as both an MCP **client** (consuming tools from servers) and an MCP **server** (exposing its own tools to other clients).

---

## Transport Types

The MCP client (`src/services/mcp/client.ts`) supports three transport types:

**`StdioClientTransport`**: Launches a local process and communicates via stdin/stdout. Most common for local MCP servers:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  }
}
```

**`SSEClientTransport`**: Server-Sent Events over HTTP. For servers that support long-lived HTTP connections. Used for claude.ai-hosted MCP servers.

**`StreamableHTTPClientTransport`**: Modern HTTP-based transport with streaming support. The newest transport type in the MCP spec.

**`InProcessTransport`** (custom): Claude Code's own in-process transport (`src/services/mcp/InProcessTransport.ts`). Used when Claude Code needs to connect to an MCP server running in the same process.

**`SdkControlTransport`**: Used for the SDK bridge integration (`SdkControlTransport.ts`).

---

## `client.ts` — The MCP Client

`client.ts` is the core MCP client implementation. It:

1. **Connects to MCP servers** — creates a `Client` from `@modelcontextprotocol/sdk` with the appropriate transport
2. **Discovers tools** — calls `listTools()` to get all tools the server exposes
3. **Discovers resources** — calls `listResources()` to get available resources
4. **Builds tool wrappers** — creates `MCPTool` instances for each discovered server tool
5. **Handles auth** — creates `McpAuthTool` instances for servers requiring authentication

When an MCP server is connected, its tools appear in the LLM's system prompt as callable tools, indistinguishable from native Claude Code tools from the LLM's perspective.

### Tool Discovery

```python
# client.ts calls list_tools() to discover server tools
tools_result: ListToolsResult = await client.list_tools()

# Each server tool becomes an MCPTool instance:
mcp_tools = [
    create_mcp_tool_for(server_tool, server_name, client)
    for server_tool in tools_result.tools
]
```

The created `MCPTool` instances are added to the tool registry and included in the system prompt.

---

## `MCPConnectionManager.tsx` — Connection Lifecycle

`MCPConnectionManager` manages the full lifecycle of MCP server connections:

- **Initial connection** at startup for configured servers
- **Reconnection** with backoff on transient failures
- **Status tracking**: connected, connecting, disconnected, error
- **Health monitoring**: periodic checks if the connection is still alive
- **Graceful shutdown**: clean disconnection on session end

The `useManageMCPConnections` hook provides the React interface to this manager, used by the REPL and `/mcp` command to display connection status.

---

## Authentication (`auth.ts`, `xaa.ts`, `xaaIdpLogin.ts`, `oauthPort.ts`)

MCP servers can require authentication. Claude Code supports:

**OAuth 2.0 flow** (via `oauthPort.ts`):
1. Claude Code opens a local HTTP server on a random port to receive the OAuth callback
2. Opens the browser to the MCP server's authorization URL
3. Receives the auth code callback
4. Exchanges the code for an access token
5. Stores the token in the secure credential store

**XAA (Claude.ai's auth system)** (`xaa.ts`, `xaaIdpLogin.ts`):
Special authentication for claude.ai-hosted MCP servers. Uses Anthropic's identity provider.

**Token refresh** (`checkAndRefreshOAuthTokenIfNeeded`):
OAuth tokens have expiry. The client automatically refreshes tokens before they expire.

---

## Configuration (`config.ts`, `envExpansion.ts`, `normalization.ts`)

MCP servers are configured in `~/.claude/settings.json` or `.claude/settings.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "slack": {
      "type": "sse",
      "url": "https://mcp.example.com/slack/sse",
      "headers": {
        "Authorization": "Bearer ${SLACK_API_TOKEN}"
      }
    }
  }
}
```

**`envExpansion.ts`**: Expands `${ENV_VAR}` references in MCP server configurations. This allows secrets to come from environment variables rather than being hardcoded in settings files.

**`normalization.ts`**: Normalizes the server configuration format. Different config versions and formats are unified into a canonical representation before use.

---

## Channel System (`channelPermissions.ts`, `channelAllowlist.ts`, `channelNotification.ts`)

Claude.ai-hosted MCP servers use "channels" — named groupings of capabilities. The channel system manages:

**`channelPermissions.ts`**: What operations each channel is authorized to perform. Prevents MCP servers from exceeding their declared scope.

**`channelAllowlist.ts`**: Which channels are allowed for this user/session. Admin-controlled allowlisting for enterprise deployments.

**`channelNotification.ts`**: Notifications about channel events (connection, disconnection, capability changes).

---

## The Official Registry (`officialRegistry.ts`)

At startup, Claude Code prefetches the list of Anthropic-approved MCP servers:

```python
import httpx

async def prefetch_official_mcp_urls() -> None:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            'https://api.anthropic.com/mcp-registry/v0/servers?version=latest&visibility=commercial',
            timeout=5.0
        )
    # Builds a set[str] of normalized official URLs
```

This registry is used to:
- Display official servers in the `/mcp` add UI
- Mark servers as "official" vs user-configured in the status display
- Apply different trust levels to official vs unknown servers

The prefetch is fire-and-forget — startup doesn't wait for it.

---

## Claude.ai Integration (`claudeai.ts`, `vscodeSdkMcp.ts`)

**`claudeai.ts`**: Handles the connection to claude.ai's hosted MCP infrastructure. When Claude Code is used through claude.ai (browser or desktop app), it may receive MCP server configurations from the cloud service.

**`vscodeSdkMcp.ts`**: The VS Code extension SDK uses this transport to expose VS Code-specific tools (file context, editor operations, diff display) to Claude Code. Implements `notifyVscodeFileUpdated()` which is called by `FileEditTool` after every edit.

---

## Claude Code as an MCP Server (`src/entrypoints/mcp.ts`)

When launched with the MCP server entrypoint, Claude Code exposes its own tools via the MCP protocol:

```bash
# Run Claude Code as an MCP server (stdio transport)
claude --mcp
```

Any MCP-compatible client (another AI agent, a different Claude Code instance, etc.) can then connect and use Claude Code's full tool suite: file operations, shell execution, web fetch, etc.

This enables powerful patterns:
- A parent Claude Code instance spawning child instances via MCP
- Other AI agents using Claude Code as a "coding sub-agent"
- IDE extensions using Claude Code as a tool provider

---

## Practical MCP Usage

### Adding a Server

```
/mcp add-json '{"type":"stdio","command":"npx","args":["@modelcontextprotocol/server-github"]}'
```

Or interactively:
```
/mcp add
```

### Checking Status

```
/mcp              # Dashboard with all servers
/mcp status       # Quick status check
```

### Debugging

If a server fails to connect:
1. Check `/mcp` for error messages
2. Try `/mcp restart <server-name>`
3. Check the server's log output
4. Verify environment variables are set

---

*Next: [Chapter 14 — The Bridge — IDE Integration](PartV-Subsystems-14-The-Bridge-IDE-Integration.md)*
