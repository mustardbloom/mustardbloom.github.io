# Chapter 14: The Bridge — IDE Integration

> **Part V: Subsystems**

---

## What the Bridge Is

The bridge is a **bidirectional communication layer** connecting Claude Code's CLI to IDE extensions (VS Code, JetBrains). It allows:
- The IDE to send context (open files, selections, editor state) to Claude Code
- Claude Code to display diffs in the IDE's native diff viewer
- Permission prompts to appear in the IDE's UI rather than the terminal
- Sessions started in the IDE to share state with the terminal

The bridge is gated behind the `BRIDGE_MODE` feature flag and is stripped from non-IDE builds.

---

## Architecture

```
┌──────────────────────┐         ┌─────────────────────────┐
│   VS Code Extension  │◄───────►│   Bridge Layer           │
│   (or JetBrains)     │  JWT    │   src/bridge/            │
│                      │  Auth   │                         │
│  - UI rendering      │         │  - Session management   │
│  - File watching     │         │  - Message routing      │
│  - Diff display      │         │  - Permission proxy     │
└──────────────────────┘         └──────────┬──────────────┘
                                            │
                                            ▼
                                  ┌──────────────────────┐
                                  │  Claude Code Core    │
                                  │  (QueryEngine, Tools) │
                                  └──────────────────────┘
```

---

## `src/bridge/` — File Overview

The bridge directory has 30+ files:

| File | Purpose |
|------|---------|
| `bridgeMain.ts` | Main bridge loop — starts the bidirectional channel |
| `bridgeMessaging.ts` | Message protocol serialization/deserialization |
| `bridgeApi.ts` | API surface exposed to the IDE extension |
| `bridgeConfig.ts` | Bridge configuration (port, timeouts, etc.) |
| `replBridge.ts` | Connects the REPL session to the bridge channel |
| `initReplBridge.ts` | Initialization of the REPL bridge |
| `jwtUtils.ts` | JWT authentication between CLI and IDE |
| `trustedDevice.ts` | Device trust verification |
| `workSecret.ts` | Workspace-scoped secret for authentication |
| `sessionRunner.ts` | Manages session execution via bridge |
| `createSession.ts` | Creates new bridge sessions |
| `inboundMessages.ts` | Handles messages from the IDE |
| `inboundAttachments.ts` | File/content attachments from IDE |
| `bridgePermissionCallbacks.ts` | Routes permission prompts to IDE |
| `bridgePointer.ts` | Connection pointer/discovery |
| `codeSessionApi.ts` | Code session API for IDE |
| `replBridgeHandle.ts` | Handle for controlling the REPL bridge |
| `replBridgeTransport.ts` | Transport layer for bridge messages |
| `capacityWake.ts` | Wakes up dormant bridge connections |

---

## Authentication (`jwtUtils.ts`, `trustedDevice.ts`, `workSecret.ts`)

Even for local connections (IDE extension → local CLI), authentication is required. This prevents malicious local processes from impersonating the IDE extension.

**JWT authentication** (`jwtUtils.ts`):
- The CLI generates a JWT signed with a workspace-scoped secret
- The IDE extension presents this JWT to authenticate
- Short-lived tokens prevent replay attacks

**Workspace secret** (`workSecret.ts`):
- A secret key scoped to the current workspace (project directory)
- Generated on first use, stored securely
- Shared between the CLI and the IDE extension through secure IPC

**Device trust** (`trustedDevice.ts`):
- Persistent trust for known devices
- New devices must complete an authentication handshake

---

## Message Protocol (`bridgeMessaging.ts`)

The bridge uses a JSON-based message protocol over the transport. Message types include:

**From IDE to CLI:**
- `user_input` — text entered in the IDE's Claude panel
- `file_attachment` — file content attached to the conversation
- `cursor_position` — current cursor position in the editor
- `selected_text` — text selected in the editor
- `abort` — cancel the current operation

**From CLI to IDE:**
- `assistant_response` — text chunk from Claude
- `tool_use` — a tool being called (for display)
- `tool_result` — the result of a tool call
- `permission_request` — request permission from the user
- `diff_preview` — show a file diff in the IDE's diff viewer
- `status_update` — session status changes

Each message has a `type`, `session_id`, and `payload`. The serialization handles the various TypeScript union types via discriminated union dispatch.

---

## Session Management (`sessionRunner.ts`, `createSession.ts`)

### Session Creation

When the IDE extension initiates a conversation:

1. `createSession()` allocates a new session ID and registers it
2. `sessionRunner.ts` creates a `QueryEngine` instance for this session
3. The session is registered in the session store
4. A confirmation is sent back to the IDE

### Session Persistence

Sessions created via the bridge are stored the same way as REPL sessions — they can be resumed with `/resume` in either the terminal or the IDE.

### Session Cleanup

When the IDE closes or the connection drops:
1. The session is marked as "backgrounded"
2. Any in-progress tool calls are allowed to complete
3. The session state is persisted for potential resume
4. The bridge connection is closed

---

## Inbound Message Handling (`inboundMessages.ts`, `inboundAttachments.ts`)

**`inboundMessages.ts`**: Dispatches incoming IDE messages to the appropriate handler. Converts IDE-specific message formats to Claude Code's internal message types.

**`inboundAttachments.ts`**: Handles file content attachments. When the IDE attaches an open file's content, it:
- Validates the file path is within the project
- Converts the content to the appropriate message format
- Attaches metadata (file type, encoding)

---

## Permission Proxying (`bridgePermissionCallbacks.ts`)

One of the bridge's critical functions is routing permission prompts. In terminal mode, permissions are shown in the terminal. In bridge (IDE) mode, they must appear in the IDE's UI.

`bridgePermissionCallbacks.ts` implements the `BridgePermissionCallbacks` interface:
- Sends permission requests to the IDE as `permission_request` messages
- Waits for the IDE's response
- Returns the decision to the permission system

This is referenced in `AppStateStore.ts`:
```python
from typing import Optional
bridge_permission_callbacks: Optional[BridgePermissionCallbacks] = None
```

When set (bridge mode is active), permission prompts are routed to the IDE instead of the terminal.

---

## IDE Integration Features

### Diff Display

When `FileEditTool` makes a change, the bridge sends a `diff_preview` message to the IDE. The extension displays the diff in VS Code's native diff viewer, making the change visible inline before the user accepts or rejects it.

The `notifyVscodeFileUpdated()` function (called by `FileEditTool` and `FileWriteTool`) triggers this flow.

### Context Injection

The IDE extension continuously monitors:
- The active editor file
- The cursor position and selection
- Recently opened files

This context is sent as `file_attachment` messages and injected into the conversation as context. This is how Claude Code "knows" what you're looking at in the IDE without you having to explicitly say "look at this file."

### Inline Chat

In VS Code, the Claude panel supports inline chat (selecting code, asking Claude about it). The selected text is sent as `selected_text` with position metadata, and the response can be applied directly to the selection.

---

## The `BRIDGE_MODE` Feature Flag

The entire bridge subsystem is gated:

```python
import importlib

bridge = (
    importlib.import_module('.commands.bridge').default
    if feature('BRIDGE_MODE') else None
)
```

In the standard CLI build (no IDE), all bridge code is stripped. This keeps the terminal-only binary lean.

When `BRIDGE_MODE` is active:
- `bridgeMain.ts` starts the bridge listener
- Bridge-specific commands (`/bridge`, `/bridge-kick`) are registered
- Permission callbacks are wired to the bridge
- VS Code file update notifications are active

---

*Next: [Chapter 15 — Memory, Skills, Plugins & Tasks](PartV-Subsystems-15-Memory-Skills-Plugins-Tasks.md)*
