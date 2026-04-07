
⏺ Here's a comprehensive breakdown of all prompts found in the codebase:

  ---
  Core System Prompts

  src/constants/prompts.ts — Main prompt orchestration file
  - getSystemPrompt() (line ~444) — assembles the full system prompt from all sections
  - getHooksSection(), getSystemRemindersSection(), getLanguageSection()
  - getSimpleIntroSection(), getSimpleSystemSection(), getSimpleDoingTasksSection()
  - getActionsSection(), getUsingYourToolsSection(), getSimpleToneAndStyleSection()
  - DEFAULT_AGENT_PROMPT (line ~758) — subagent base prompt
  - enhanceSystemPromptWithEnvDetails() (line ~760)

  src/constants/system.ts (lines 9–16)
  - DEFAULT_PREFIX — "You are Claude Code, Anthropic's official CLI for Claude."
  - AGENT_SDK_CLAUDE_CODE_PRESET_PREFIX
  - AGENT_SDK_PREFIX

  src/constants/systemPromptSections.ts — Section memoization framework

  ---
  Tool Prompts (36 files)

  Each in src/tools/<ToolName>/prompt.ts:

  ┌───────────────────┬──────────────────────────────────────────────────────────────────────┐
  │       Tool        │                           Notable content                            │
  ├───────────────────┼──────────────────────────────────────────────────────────────────────┤
  │ AgentTool         │ 286 lines — agent spawning guidance, fork semantics, writing prompts │
  ├───────────────────┼──────────────────────────────────────────────────────────────────────┤
  │ BashTool          │ 370 lines — git safety protocols, PR creation workflow               │
  ├───────────────────┼──────────────────────────────────────────────────────────────────────┤
  │ EnterPlanModeTool │ 171 lines — when/how to enter plan mode                              │
  ├───────────────────┼──────────────────────────────────────────────────────────────────────┤
  │ TodoWriteTool     │ 181 lines — todo list management                                     │
  ├───────────────────┼──────────────────────────────────────────────────────────────────────┤
  │ TaskCreateTool    │ 56 lines — task creation guidelines                                  │
  ├───────────────────┼──────────────────────────────────────────────────────────────────────┤
  │ FileEditTool      │ 29 lines — pre-read requirement                                      │
  ├───────────────────┼──────────────────────────────────────────────────────────────────────┤
  │ FileReadTool      │ 49 lines — PDF/image support                                         │
  ├───────────────────┼──────────────────────────────────────────────────────────────────────┤
  │ WebFetchTool      │ 46 lines — content processing                                        │
  ├───────────────────┼──────────────────────────────────────────────────────────────────────┤
  │ + 28 others       │ GlobTool, GrepTool, FileWriteTool, NotebookEditTool, etc.            │
  └───────────────────┴──────────────────────────────────────────────────────────────────────┘

  ---
  Service-Level Prompts

  src/services/compact/prompt.ts (375 lines)
  - BASE_COMPACT_PROMPT — 9-section conversation summarization
  - PARTIAL_COMPACT_PROMPT — incremental summarization
  - PARTIAL_COMPACT_UP_TO_PROMPT
  - NO_TOOLS_PREAMBLE

  src/services/SessionMemory/prompts.ts (325 lines)
  - DEFAULT_SESSION_MEMORY_TEMPLATE
  - getDefaultUpdatePrompt() — memory update instructions
  - buildSessionMemoryUpdatePrompt()

  src/services/MagicDocs/prompts.ts (128 lines)
  - getUpdatePromptTemplate() — doc update with preservation rules
  - buildMagicDocsUpdatePrompt()

  src/services/extractMemories/prompts.ts (156 lines)
  - buildExtractAutoOnlyPrompt() — single-user memory extraction
  - buildExtractCombinedPrompt() — auto + team memory extraction

  ---
  Agent & Coordinator Prompts

  src/tools/AgentTool/built-in/generalPurposeAgent.ts
  - SHARED_PREFIX, SHARED_GUIDELINES, getGeneralPurposeSystemPrompt()

  src/coordinator/coordinatorMode.ts (line ~115)
  - getCoordinatorSystemPrompt() — coordinator role, tool descriptions, task workflow phases

  ---
  Other

  src/buddy/prompt.ts — Companion feature intro
  src/utils/claudeInChrome/prompt.ts — Claude in Chrome prompts
  prompts/10-context-and-prompts.md — Documentation on system prompt construction

  ---
  Custom Prompt Config Paths (user-overridable)

  - ~/.claude/session-memory/config/prompt.md
  - ~/.claude/session-memory/config/template.md
  - ~/.claude/magic-docs/prompt.md






⏺ SyntheticOutputTool (StructuredOutput) is a mechanism for forcing the model to return a specific JSON structure at the end of a non-interactive (SDK/scripted) session.

  What it does

  When a caller passes a JSON schema to the agent (e.g. agent({ schema: MY_SCHEMA })), this tool is injected into the available tool set. The model is instructed:

  ▎ "You MUST call this tool exactly once at the end of your response."

  The tool then validates the model's output against that schema (using Ajv) and throws if it doesn't match. If it does match, it returns the structured data.

  Why it exists

  Normally Claude returns free-form text. This tool is the mechanism for structured output — a way to guarantee the model's final response conforms to a caller-defined JSON schema. It's
  essentially tool-use as a structured output hack: since you can define the input schema of a tool precisely, you get schema-validated JSON by forcing the model to "call" this tool with
   its answer.

  Key details

  - Only enabled in non-interactive sessions (isSyntheticOutputToolEnabled checks isNonInteractiveSession)
  - The schema is dynamic — callers pass their own JSON schema at runtime
  - A WeakMap cache avoids re-compiling the same schema on repeated calls (important for workflows that call the agent 30–80 times with the same schema)
  - Read-only, always-allowed, no permissions required — it's purely a data return mechanism

❯ give the python code of this file                                                                                                                                                       

⏺ import json
  from typing import Any
  from jsonschema import validate, ValidationError, SchemaError
  from functools import lru_cache

  SYNTHETIC_OUTPUT_TOOL_NAME = "StructuredOutput"


  def is_synthetic_output_tool_enabled(is_non_interactive_session: bool) -> bool:
      return is_non_interactive_session


  class SyntheticOutputTool:
      name = SYNTHETIC_OUTPUT_TOOL_NAME
      search_hint = "return the final response as structured JSON"
      max_result_size_chars = 100_000

      def is_mcp(self) -> bool:
          return False

      def is_enabled(self) -> bool:
          return True

      def is_concurrency_safe(self) -> bool:
          return True

      def is_read_only(self) -> bool:
          return True

      def is_open_world(self) -> bool:
          return False

      def description(self) -> str:
          return "Return structured output in the requested format"

      def prompt(self) -> str:
          return (
              "Use this tool to return your final response in the requested structured format. "
              "You MUST call this tool exactly once at the end of your response to provide the structured output."
          )

      def call(self, input: dict[str, Any]) -> dict[str, Any]:
          return {
              "data": "Structured output provided successfully",
              "structured_output": input,
          }

      def check_permissions(self, input: dict[str, Any]) -> dict[str, Any]:
          return {"behavior": "allow", "updated_input": input}

      def render_tool_use_message(self, input: dict[str, Any]) -> str | None:
          keys = list(input.keys())
          if not keys:
              return None
          if len(keys) <= 3:
              return ", ".join(f"{k}: {json.dumps(input[k])}" for k in keys)
          return f"{len(keys)} fields: {', '.join(keys[:3])}…"

      def render_tool_use_rejected_message(self) -> str:
          return "Structured output rejected"

      def render_tool_use_error_message(self) -> str:
          return "Structured output error"

      def render_tool_use_progress_message(self) -> None:
          return None

      def render_tool_result_message(self, output: str) -> str:
          return output

      def map_tool_result_to_block_param(self, content: str, tool_use_id: str) -> dict:
          return {
              "tool_use_id": tool_use_id,
              "type": "tool_result",
              "content": content,
          }


  # Identity-keyed cache: same dict object reference reuses compiled validator
  _tool_cache: dict[int, "CreateResult"] = {}

  CreateResult = dict  # {"tool": SyntheticOutputToolWithSchema} | {"error": str}


  def create_synthetic_output_tool(json_schema: dict[str, Any]) -> CreateResult:
      cache_key = id(json_schema)
      if cache_key in _tool_cache:
          return _tool_cache[cache_key]

      result = _build_synthetic_output_tool(json_schema)
      _tool_cache[cache_key] = result
      return result


  def _build_synthetic_output_tool(json_schema: dict[str, Any]) -> CreateResult:
      try:
          # Validate the schema itself is a valid JSON Schema
          from jsonschema import Draft7Validator
          try:
              Draft7Validator.check_schema(json_schema)
          except SchemaError as e:
              return {"error": str(e.message)}

          validator = Draft7Validator(json_schema)

          class SyntheticOutputToolWithSchema(SyntheticOutputTool):
              input_json_schema = json_schema

              def call(self, input: dict[str, Any]) -> dict[str, Any]:
                  errors = list(validator.iter_errors(input))
                  if errors:
                      error_messages = ", ".join(
                          f"{e.json_path or 'root'}: {e.message}" for e in errors
                      )
                      raise ValueError(
                          f"Output does not match required schema: {error_messages}"
                      )
                  return {
                      "data": "Structured output provided successfully",
                      "structured_output": input,
                  }

          return {"tool": SyntheticOutputToolWithSchema()}

      except Exception as e:
          return {"error": str(e)}

  Key translation notes:
  - TypeScript's WeakMap<object, ...> → Python dict keyed by id(obj) (same identity-based caching)
  - Ajv (JS JSON Schema validator) → jsonschema.Draft7Validator
  - lazySchema / Zod → not needed in Python; plain type hints suffice
  - TelemetrySafeError → plain ValueError (telemetry wrapper is internal infra)
  - buildTool / satisfies ToolDef → replaced with a class hierarchy









 No, I was asking you the difference between using pydantic (BaseClass) and ⏺ SyntheticOutputTool (StructuredOutput) is a mechanism for forcing the model to return a specific JSON       
structure at the end of a non-interactive (SDK/scripted) session.                                                                                                                          
  ⎿  ⧉ Selected 1 lines from bca-book/lecture_notes/prompts.md in Visual Studio Code                                                                                                       
                                                                                                                                                                                           
⏺ Both achieve structured JSON output from an LLM, but at different layers:                                                                                                              
                                                                                                                                                                                           
  ---                                                                                                                                                                                      
  SyntheticOutputTool (StructuredOutput)                                                                                                                                                   
                                                                                                                                                                                           
  Forces structure via tool-use mechanism — the model is told "call this tool with your answer", and the tool's input schema IS the JSON schema. The model must conform or the call fails. 
                                                                                                                                                                                           
  LLM → must call StructuredOutput({...}) → validated against JSON Schema → returned                                                                                                       
                                                                                                                                                                                           
  - Works at the API/agent level — the model is constrained by the tool definition                                                                                                         
  - Schema is dynamic — passed at runtime per call                                                                                                                                         
  - Validation happens inside the agent loop — bad output throws and can be retried                                                                                                        
  - The model "understands" it's returning structured data (it's a deliberate tool call)                                                                                                   
                                                                                                                                                                                           
  ---                                                                                                                                                                                      
  Pydantic BaseModel                                                                                                                                                                       
                    
  Forces structure by parsing the LLM's text output after the fact.
                                                                                                                                                                                           
  LLM → returns raw text/JSON string → Pydantic parses + validates → typed Python object
                                                                                                                                                                                           
  - Works at the application level — you parse what the model returned
  - Schema is static — defined at class definition time                                                                                                                                    
  - Validation happens after the LLM responds — bad output raises ValidationError in your code                                                                                             
  - The model doesn't "know" about the schema — it just returns text that you hope matches                                                                                                 
                                                                                                                                                                                           
  ---                                                                                                                                                                                      
  Key difference                                                                                                                                                                           
                  
  ┌────────────────────────┬────────────────────────────────────────────┬─────────────────────────────────────┐
  │                        │            SyntheticOutputTool             │         Pydantic BaseModel          │
  ├────────────────────────┼────────────────────────────────────────────┼─────────────────────────────────────┤
  │ Where constraint lives │ Inside the model's context (tool schema)   │ Outside, in your parsing code       │
  ├────────────────────────┼────────────────────────────────────────────┼─────────────────────────────────────┤
  │ Model awareness        │ Yes — model is instructed to call the tool │ No — model just returns text        │                                                                            
  ├────────────────────────┼────────────────────────────────────────────┼─────────────────────────────────────┤                                                                            
  │ Enforcement            │ Pre-validated before returning to caller   │ Post-validated after LLM responds   │                                                                            
  ├────────────────────────┼────────────────────────────────────────────┼─────────────────────────────────────┤                                                                            
  │ Schema source          │ JSON Schema (dynamic, runtime)             │ Python class (static, compile-time) │
  ├────────────────────────┼────────────────────────────────────────────┼─────────────────────────────────────┤                                                                            
  │ Retry on failure       │ Agent loop can retry                       │ You handle retries manually         │
  └────────────────────────┴────────────────────────────────────────────┴─────────────────────────────────────┘                                                                            
                  
  ---                                                                                                                                                                                      
  In practice     
             
  They're often used together — Pydantic defines your data model, which gets converted to JSON Schema, which gets passed to createSyntheticOutputTool() as the constraint. Pydantic is the
  schema authoring tool; SyntheticOutputTool is the enforcement mechanism. 









  ⏺ I already read this file above. Here's the full explanation:

  ---
  What paths.ts does

  It is the memory filesystem router for Claude Code's auto-memory system. It answers two questions:
  1. Is memory enabled right now?
  2. Where on disk should memory files live?

  ---
  Core concepts

  Auto-memory

  Claude Code persists memories about projects/users to ~/.claude/projects/<project>/memory/MEMORY.md. This file controls all the logic around that.

  ---
  Functions

  isAutoMemoryEnabled() — should memory run at all?

  Priority chain (first match wins):
  1. CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 → off
  2. CLAUDE_CODE_DISABLE_AUTO_MEMORY=0 → on (explicit opt-in)
  3. CLAUDE_CODE_SIMPLE (bare/minimal mode) → off
  4. Remote mode (CLAUDE_CODE_REMOTE) with no CLAUDE_CODE_REMOTE_MEMORY_DIR → off
  5. settings.json → respects autoMemoryEnabled field
  6. Default → on

  ---
  validateMemoryPath() — security gate on path inputs

  Before any path is used, it's sanitized. Rejected paths:
  - Relative paths (../foo)
  - Root or near-root (/, /a)
  - Windows drive roots (C:)
  - UNC network paths (\\server\share)
  - Null bytes (can truncate in syscalls)
  - ~/ expanding to $HOME itself or an ancestor

  Returns a normalized absolute path with exactly one trailing separator, or undefined if rejected.

  ---
  getAutoMemPath() — resolves the actual memory directory

  Resolution order:
  1. CLAUDE_COWORK_MEMORY_PATH_OVERRIDE env var (used by Cowork/multi-user environments)
  2. autoMemoryDirectory in settings.json (policy → local → user, not project settings — security reason below)
  3. Default: ~/.claude/projects/<sanitized-git-root>/memory/

  Why project settings are excluded: A malicious repo could set autoMemoryDirectory: "~/.ssh" in .claude/settings.json and silently gain write access to sensitive directories.

  Memoized on projectRoot — because this is called on every tool-use message render, and computing it requires reading settings files from disk each time.

  ---
  getAutoMemBase() — stable project key

  Uses the canonical git root (not CWD) so all worktrees of the same repo share one memory directory. Without this, repo/ and repo-worktree/ would get separate memory dirs.

  ---
  isAutoMemPath(path) — permission check

  Used by the filesystem permission layer to decide if a write to a given path should be allowed without prompting. Returns true if the path is inside the memory directory.

  ---
  Other helpers

  ┌──────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │           Function           │                                                             Purpose                                                              │
  ├──────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ getMemoryBaseDir()           │ Returns CLAUDE_CODE_REMOTE_MEMORY_DIR or ~/.claude                                                                               │
  ├──────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ getAutoMemEntrypoint()       │ Returns path to MEMORY.md                                                                                                        │
  ├──────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ getAutoMemDailyLogPath(date) │ Returns memory/logs/YYYY/MM/YYYY-MM-DD.md (used in KAIROS/assistant mode for append-only daily logs instead of a live MEMORY.md) │
  ├──────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ hasAutoMemPathOverride()     │ Whether the Cowork env override is active                                                                                        │
  ├──────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ isExtractModeActive()        │ Whether the background memory-extraction agent should run (feature-flagged)                                                      │
  └──────────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  ---
  Security design summary

  The file has careful layered security:
  - Path traversal prevented by validateMemoryPath()
  - Privilege escalation prevented by excluding project-level settings from path overrides
  - Cowork isolation via env var override so shared VMs don't clobber each other's memory
  - Git worktree unification so the same repo always maps to the same memory dir








  ⏺ I have enough context now to give a comprehensive explanation.

  ---
  What main.tsx does

  It is the top-level entry point for the entire Claude Code CLI. Every invocation of the claude command starts here. It is ~4700 lines and covers startup, CLI parsing, session setup, and
  routing to different modes.

  ---
  Structure overview

  1. Pre-import side effects (lines 1–20)

  Three things fire before any other module loads, in parallel with the ~135ms of imports:
  - profileCheckpoint('main_tsx_entry') — startup timing
  - startMdmRawRead() — fires MDM (Mobile Device Management) subprocess to read enterprise policy
  - startKeychainPrefetch() — fires macOS keychain reads for OAuth/API keys in parallel

  This is a deliberate performance optimization — these reads are needed before the first API call but take time, so they're started as early as possible.

  ---
  2. Imports (~200 lines)

  Imports every major subsystem: tools, settings, permissions, MCP, agents, telemetry, auth, migrations, React/Ink, etc.

  Feature-gated modules are loaded with feature('FLAG') ? require(...) : null so the bundler can dead-code-eliminate them in external builds.

  ---
  3. main() — top-level entry (line 585)

  Runs on every invocation. Does:

  ┌────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────┐
  │          Step          │                                         What                                         │
  ├────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Security               │ Sets NoDefaultCurrentDirectoryInExePath=1 (prevents Windows PATH hijacking)          │
  ├────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Signal handling        │ Registers SIGINT / exit handlers                                                     │                                                                         
  ├────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Deep link handling     │ Handles cc:// / cc+unix:// URL schemes (DIRECT_CONNECT feature)                      │                                                                         
  ├────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤                                                                         
  │ Subcommand pre-parsing │ Detects claude ssh, claude assistant, strips/stashes args before Commander sees them │
  ├────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤                                                                         
  │ Interactive detection  │ Checks for -p/--print, --init-only, TTY status → sets isNonInteractive               │
  ├────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤                                                                         
  │ Client type            │ Determines if this is cli, sdk-cli, github-action, remote, claude-vscode, etc.       │
  ├────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤                                                                         
  │ Settings flags         │ Parses --settings / --setting-sources early before init()                            │
  ├────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤                                                                         
  │ run()                  │ Hands off to the main Commander CLI setup                                            │
  └────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────┘                                                                         
                  
  ---                                                                                                                                                                                       
  4. run() — CLI parsing (line 884)
                                                                                                                                                                                            
  Builds the Commander command tree with all flags:
                                                                                                                                                                                            
  Key flags:      
  - -p / --print — non-interactive/headless mode                                                                                                                                            
  - --bare — minimal mode (no hooks, no memory, no LSP, no plugins)                                                                                                                         
  - --output-format — text / json / stream-json                    
  - --json-schema — structured output via SyntheticOutputTool                                                                                                                               
  - --model — model override                                 
  - --permission-mode — permission level                                                                                                                                                    
  - --resume / --continue — session resumption
  - --mcp-config — MCP server config                                                                                                                                                        
  - --system-prompt — custom system prompt
  - --dangerously-skip-permissions — bypass all permission checks                                                                                                                           
  - --allowed-tools / --disallowed-tools — tool allow/deny lists                                                                                                                            
   
  preAction hook (runs before every command):                                                                                                                                               
  1. Awaits MDM settings + keychain prefetch
  2. Calls init() — loads config, auth, env vars                                                                                                                                            
  3. Attaches telemetry sinks                   
  4. Runs migrations (runMigrations()) — 11 versioned migrations for model renames, settings format changes, etc.                                                                           
  5. Loads remote managed settings (enterprise policy) + policy limits                                           
                                                                                                                                                                                            
  ---                                                                                                                                                                                       
  5. Migrations (runMigrations(), line 326)                                                                                                                                                 
                                                                                                                                                                                            
  Runs once per version bump. Currently at version 11. Handles:
  - Model name changes (Sonnet 1m → 4.5 → 4.6, Opus → Opus 1m, Fennec → Opus)                                                                                                               
  - Settings format migrations                                                                                                                                                              
  - Permission/bypass settings migrations                                                                                                                                                   
                                                                                                                                                                                            
  ---             
  6. startDeferredPrefetches() (line 388)
                                                                                                                                                                                            
  Called after first render to avoid blocking the UI. Fires in background:
  - initUser(), getUserContext(), getSystemContext()                                                                                                                                        
  - AWS/GCP credential prefetch (Bedrock/Vertex)                                                                                                                                            
  - File count (for context display)                                                                                                                                                        
  - Analytics gates, MCP URL prefetch, model capabilities refresh                                                                                                                           
  - Settings/skill change detectors                                                                                                                                                         
                                                                                                                                                                                            
  Skipped entirely in --bare mode.                                                                                                                                                          
                                                                                                                                                                                            
  ---             
  7. Session modes (routed from the main command action)                                                                                                                                    
                                                                                                                                                                                            
  The main action branches into several execution paths:
  - Interactive REPL — renders the Ink TUI (launchRepl)                                                                                                                                     
  - Headless -p — runs a single query and exits                                                                                                                                             
  - SSH remote — connects to a remote host via SSH                                                                                                                                          
  - Direct connect (cc://) — connects to a local/remote server                                                                                                                              
  - KAIROS/assistant mode — assistant-style session chooser                                                                                                                                 
  - Coordinator mode — multi-agent swarm coordinator                                                                                                                                        
  - MCP serve — starts Claude Code as an MCP server                                                                                                                                         
                                                                                                                                                                                            
  ---                                                                                                                                                                                       
  Summary         
                                                                                                                                                                                            
  main.tsx is the orchestration layer — it doesn't implement any Claude logic itself, but it:
  1. Wires together startup performance optimizations                                                                                                                                       
  2. Parses CLI flags                                
  3. Runs migrations                                                                                                                                                                        
  4. Selects the right session mode                                                                                                                                                         
  5. Hands off to the appropriate subsystem (REPL, headless runner, SSH, coordinator, etc.)