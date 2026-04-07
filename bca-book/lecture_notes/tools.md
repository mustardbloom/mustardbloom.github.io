⏺ There are 40 tools in total (43 directory entries minus shared/, testing/, and utils.ts):                                  
                                                                                                                             
  ┌───────────────┬───────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │   Category    │                                                 Tools                                                 │  
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┤  
  │ File ops      │ FileReadTool, FileEditTool, FileWriteTool, GlobTool, GrepTool                                         │  
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┤  
  │ Execution     │ BashTool, PowerShellTool, REPLTool, SleepTool                                                         │  
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┤  
  │ Agent/Task    │ AgentTool, SendMessageTool, TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool, TaskStopTool,  │  
  │               │ TaskOutputTool                                                                                        │  
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Planning      │ EnterPlanModeTool, ExitPlanModeTool, BriefTool                                                        │  
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┤  
  │ Worktree      │ EnterWorktreeTool, ExitWorktreeTool                                                                   │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┤  
  │ MCP           │ MCPTool, McpAuthTool, ListMcpResourcesTool, ReadMcpResourceTool                                       │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┤  
  │ Web           │ WebFetchTool, WebSearchTool                                                                           │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┤  
  │ Skills/Config │ SkillTool, ConfigTool, ToolSearchTool                                                                 │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┤  
  │ Todo          │ TodoWriteTool                                                                                         │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┤  
  │ Scheduling    │ ScheduleCronTool, RemoteTriggerTool                                                                   │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Teams         │ TeamCreateTool, TeamDeleteTool                                                                        │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┤  
  │ LSP           │ LSPTool                                                                                               │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────┤  
  │ Misc          │ AskUserQuestionTool, NotebookEditTool, SyntheticOutputTool                                            │
  └───────────────┴───────────────────────────────────────────────────────────────────────────────────────────────────────┘  








  ⏺ Loop Transitions     
                                                                    
  Claude Code runs a query loop — a cycle that repeatedly asks the LLM what to do next, executes tools, then asks again. The 
  loop doesn't run forever; it needs to decide after each cycle: keep going or stop?                                         
                                                                                                                             
  A transition is that decision. It's a typed value the loop produces at the end of each iteration to describe what happens  
  next.                                                                                                                      
                                                                                                                             
  There are two kinds:                                                                                                       
   
  ┌──────────┬──────────────────────────────────────────────────────┐                                                        
  │   Type   │                       Meaning                        │
  ├──────────┼──────────────────────────────────────────────────────┤
  │ Terminal │ Stop the loop. We're done (or something went wrong). │
  ├──────────┼──────────────────────────────────────────────────────┤
  │ Continue │ Run the loop again. There's more work to do.         │                                                        
  └──────────┴──────────────────────────────────────────────────────┘                                                        
                                                                                                                             
  ---                                                                                                                        
  What does "transition fired" mean?
                                    
  "Fired" just means one specific transition was chosen/triggered for that cycle. Think of it like a switch statement — only
  one branch can win. When you say Continue('tool_use') fired, it means the LLM returned a tool call, so the loop decided to 
  continue in order to execute that tool.
                                                                                                                             
  Example walkthrough:                                                                                                       
   
  Cycle 1: LLM says "call BashTool to run ls"                                                                                
    → Continue('tool_use') fires   ← loop runs again                                                                         
   
  Cycle 2: BashTool runs, LLM sees result, says "I'm done"                                                                   
    → Terminal('completed') fires  ← loop stops
                                                                                                                             
  ---             
  Why the transitions are typed                                                                                              
                               
  Because there are many reasons to stop or continue, and they require different handling:
                                                                                                                             
  - Terminal('max_turns') → hit a limit, tell the user                                                                       
  - Terminal('aborted_streaming') → user hit Ctrl+C mid-stream, clean up                                                     
  - Continue('reactive_compact_retry') → context got too long, auto-compacted, retry                                         
  - Continue('token_budget_continuation') → nudge the model to keep going within budget                                      
                                                                                                                             
  By making each reason an explicit named value (not just true/false), the code is auditable — when something behaves        
  unexpectedly, you can log which transition fired and immediately know why the loop stopped or continued.      











  ❯ LOOP:                                                                                                                      
1. Send messages to Anthropic API (streaming)                                                                                
2. Buffer streaming chunks:                                                                                                  
- text                                                                                                                       
delta → accumulate into response text                                                                                        
_                                                                                                                            
- tool                                                                                                                       
use → collect tool name + input JSON                                                                                         
_                                                                                                                            
3. When stream ends:                                                                                                         
a. If response has text only → DONE (exit loop)                                                                              
b. If response has tool                                                                                                      
use blocks → execute them                                                                                                    
_                                                                                                                            
4. For each tool                                                                                                             
use block:                                                                                                                   
_                                                                                                                            
a. Validate tool input against Zod schema                                                                                    
b. Call wrappedCanUseTool() → check permissions                                                                              
c. If denied → record denial, add tool                                                                                       
result with error                                                                                                            
_                                                                                                                            
d. If allowed → execute tool.call()                                                                                          
e. Add tool                                                                                                                  
result message to conversation                                                                                               
_                                                                                                                            
5. Add all tool results to conversation history                                                                              
6. GOTO 1 (continue loop with updated conversation) explain the loop and where the source codes of  each part                

  Searched for 2 patterns, read 2 files, listed 2 directories (ctrl+o to expand)

⏺ Now I have enough to give a clear, grounded explanation with exact source locations.

  ---
  The Query Loop — Explained with Source Locations

  The entire loop lives in src/query.ts inside the queryLoop() async generator function (line 241).

  ---
  Step 1 — Send messages to the Anthropic API (streaming)

  src/query.ts:659
  for await (const message of deps.callModel({ messages, systemPrompt, tools, ... }))

  deps.callModel is the streaming API call. It's an async generator — each chunk arrives one at a time. The actual HTTP call is in
  src/services/api/claude.ts.

  ---
  Step 2 — Buffer streaming chunks

  Still inside the for await loop at line 659. Two things accumulate:

  ┌────────────────┬─────────────────────────────────────────────────────────────────────────────────┐
  │   Chunk type   │                                  What happens                                   │
  ├────────────────┼─────────────────────────────────────────────────────────────────────────────────┤
  │ text_delta     │ Accumulated into an AssistantMessage object                                     │
  ├────────────────┼─────────────────────────────────────────────────────────────────────────────────┤
  │ tool_use block │ Pushed into toolUseBlocks[] array (line 557) and assistantMessages[] (line 551) │
  └────────────────┴─────────────────────────────────────────────────────────────────────────────────┘

  The flag needsFollowUp (line 558) is set to true when any tool_use block arrives — this is the sole signal that the loop should
  continue.

  ---
  Step 3 — When stream ends: text-only → DONE, tool_use → execute

  After the for await exits, the code checks:

  src/query.ts — after the streaming loop
  if (!needsFollowUp) → return { reason: 'completed' }  // Terminal transition
  if (needsFollowUp)  → fall through to tool execution   // Continue('tool_use')

  ---
  Step 4 — Execute each tool_use block

  src/services/tools/toolOrchestration.ts  ← runTools()
  src/services/tools/StreamingToolExecutor.ts  ← parallel streaming execution

  For each block:

  ┌─────────────────────────────────┬───────────────────────────────────────────────────────────────────┐
  │            Sub-step             │                              Source                               │
  ├─────────────────────────────────┼───────────────────────────────────────────────────────────────────┤
  │ 4a. Validate input (Zod)        │ Each tool's own inputSchema in src/tools/<ToolName>/<ToolName>.ts │
  ├─────────────────────────────────┼───────────────────────────────────────────────────────────────────┤
  │ 4b. Permission check            │ canUseTool() → src/hooks/useCanUseTool.ts                         │
  ├─────────────────────────────────┼───────────────────────────────────────────────────────────────────┤
  │ 4c. Denied → error tool_result  │ yieldMissingToolResultBlocks() at src/query.ts:123                │
  ├─────────────────────────────────┼───────────────────────────────────────────────────────────────────┤
  │ 4d. Allowed → tool.call()       │ The call() method inside each src/tools/<ToolName>/<ToolName>.ts  │
  ├─────────────────────────────────┼───────────────────────────────────────────────────────────────────┤
  │ 4e. Add tool_result to messages │ toolResults[] array, pushed into messagesForQuery                 │
  └─────────────────────────────────┴───────────────────────────────────────────────────────────────────┘

  ---
  Step 5 — Add tool results to conversation history

  src/query.ts — continue site around line 1192
  state = { ...state, messages: [...messages, ...assistantMessages, ...toolResults] }

  The updated message array (now including tool results) becomes messages for the next iteration.

  ---
  Step 6 — GOTO 1

  src/query.ts:307
  while (true) { ... }   // The outer loop

  It's literally a while(true) loop. The only exits are return { reason: '...' } statements that produce a Terminal transition —
  'completed', 'max_turns', 'aborted_tools', etc. defined in src/query/transitions.ts.

  ---
  Big picture

  src/query.ts
    └─ queryLoop() — the while(true)
         ├─ src/services/api/claude.ts         → Step 1: HTTP streaming
         ├─ (inline buffering)                 → Step 2: accumulate chunks
         ├─ src/services/tools/
         │    ├─ toolOrchestration.ts          → Step 4: runTools()
         │    └─ StreamingToolExecutor.ts      → Step 4: parallel execution
         ├─ src/hooks/useCanUseTool.ts         → Step 4b: permission check
         ├─ src/tools/<ToolName>/<ToolName>.ts → Step 4a+4d: schema + call()
         └─ src/query/transitions.ts           → Step 3+6: Terminal / Continue








❯ Step 2 — Buffer streaming chunks                                                                                                 
                                                                                                                                   
  Still inside the for await loop at line 659. Two things accumulate:                                                              
                                                                                                                                   
  ┌────────────────┬─────────────────────────────────────────────────────────────────────────────────┐                             
  │   Chunk type   │                                  What happens                                   │                             
  ├────────────────┼─────────────────────────────────────────────────────────────────────────────────┤                             
  │ text_delta     │ Accumulated into an AssistantMessage object                                     │                             
  ├────────────────┼─────────────────────────────────────────────────────────────────────────────────┤                             
  │ tool_use block │ Pushed into toolUseBlocks[] array (line 557) and assistantMessages[] (line 551) │                             
  └────────────────┴─────────────────────────────────────────────────────────────────────────────────┘                             
                                                                                                                                   
  The flag needsFollowUp (line 558) is set to true when any tool_use block arrives — this is the sole signal that the loop should  
  continue. What is text_delda. And Accumulated into an AssistantMessage object     ?                                              
  ⎿  ⧉ Selected 1 lines from AgenticOS/claude-code-main/src/query.ts in Visual Studio Code

  Searched for 2 patterns, read 4 files (ctrl+o to expand)

⏺ Now I have a clear picture. Here's the full explanation:

  ---
  What is text_delta?

  The Anthropic API does not send the full response at once. It streams it — like a typewriter — sending tiny pieces called events.
   A text_delta is one of those events:

  Event 1: text_delta  → "Hello"
  Event 2: text_delta  → ", here"
  Event 3: text_delta  → " is the"
  Event 4: text_delta  → " answer..."
  Event 5: tool_use    → { name: "BashTool", input: { command: "ls" } }

  Each text_delta carries a small .text string — just a few words or characters at a time. This is what makes Claude appear to
  "type" in real-time in the terminal.

  ---
  What does "Accumulated into an AssistantMessage" mean?

  As each text_delta arrives, the code doesn't create a new message for every chunk. Instead it appends to a single growing text
  block:

  src/services/api/claude.ts:2125
  contentBlock.text += delta.text   // ← append each chunk onto the same string

  So over time:
  contentBlock.text = ""
  contentBlock.text = "Hello"
  contentBlock.text = "Hello, here"
  contentBlock.text = "Hello, here is the"
  contentBlock.text = "Hello, here is the answer..."

  Once the entire stream finishes, that completed contentBlock lives inside one AssistantMessage object — the full reply, assembled
   from dozens of tiny pieces.

  AssistantMessage {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: "Hello, here is the answer..." },  ← assembled from deltas
        { type: 'tool_use', name: 'BashTool', input: {...} }     ← assembled from input_json_deltas
      ]
    }
  }

  ---
  There are actually two kinds of deltas

  ┌──────────────────┬──────────────────────────────────────────────┬────────────────┐
  │    Delta type    │                What it builds                │     Source     │
  ├──────────────────┼──────────────────────────────────────────────┼────────────────┤
  │ text_delta       │ The Claude reply text (contentBlock.text +=) │ claude.ts:2125 │
  ├──────────────────┼──────────────────────────────────────────────┼────────────────┤
  │ input_json_delta │ A tool's JSON input (contentBlock.input +=)  │ claude.ts:2111 │
  └──────────────────┴──────────────────────────────────────────────┴────────────────┘

  So tool calls are also streamed — the JSON arguments arrive piece by piece via input_json_delta and get assembled the same way,
  character by character, until the full { "command": "ls -la" } is complete.











❯ what's  Zod schema                                                                                                               
  ⎿  ⧉ Selected 1 lines from bca-book/lecture_notes/tools.md in Visual Studio Code
                                                                                                                                   
⏺ What is a Zod Schema?                                                                                                           
                                                                                                                                  
  Zod is a TypeScript library for validating data. A "schema" is just a description of what shape/type your data must have.        
                                                                                                                                   
  The problem it solves                                                                                                            
                                                                                                                                   
  When Claude calls a tool, it sends JSON like:                                                                                    
  { "command": "ls -la", "timeout": 5000 }
                                          
  But this arrives as raw untyped data. How do you know:                                                                           
  - Is command actually a string? (not a number, not missing)                                                                      
  - Is timeout a valid number?                                                                                                     
  - Are there unexpected extra fields?                                                                                             
                                                                                                                                   
  You need to validate it before running the tool. That's what Zod does.
                                                                                                                                   
  ---             
  How it looks in Claude Code                                                                                                      
                             
  From src/tools/BashTool/BashTool.ts (typical pattern):
                                                                                                                                   
  import { z } from 'zod'
                                                                                                                                   
  const inputSchema = z.object({
    command: z.string(),           // must be a string                                                                             
    timeout: z.number().optional() // optional number
  })                                                                                                                               
  
  Then when tool input arrives:                                                                                                    
  const result = inputSchema.parse(rawInput)
  // ✅ If valid  → result is typed correctly, safe to use
  // ❌ If invalid → throws an error immediately, tool never runs                                                                  
                                                                                                                                   
  ---                                                                                                                              
  Zod vs plain TypeScript types                                                                                                    
                               
  ┌──────────────────────┬───────────────────┬───────────────────────────────────┐                                                 
  │                      │  TypeScript type  │            Zod schema             │                                                 
  ├──────────────────────┼───────────────────┼───────────────────────────────────┤
  │ Checked at           │ Compile time only │ Runtime (when code actually runs) │                                                 
  ├──────────────────────┼───────────────────┼───────────────────────────────────┤
  │ Catches bad API data │ No                │ Yes                               │                                                 
  ├──────────────────────┼───────────────────┼───────────────────────────────────┤
  │ Auto-generates types │ No                │ Yes (z.infer<typeof schema>)      │                                                 
  └──────────────────────┴───────────────────┴───────────────────────────────────┘                                                 
  
  TypeScript types disappear after compilation. Zod runs while the program is executing, so it can catch bad data coming from the  
  LLM at the moment it arrives.
                                                                                                                                   
  ---             
  One-liner summary
                   
  ▎ Zod schema = a description of what valid data looks like, checked at runtime, that also gives you TypeScript types for free.
                                







❯ Call wrappedCanUseTool() → check permissions check whose permission? What kind of permission?                                     

  Searched for 2 patterns, read 3 files (ctrl+o to expand)

⏺ Now I have a complete picture. Here's the answer:

  ---
  Whose permission? What kind?

  Whose permission — the human user sitting at the terminal.

  Before Claude executes any tool, it asks: "Is the human okay with this action?"

  ---
  What kind of permission — there are 3 possible answers

  src/types/permissions.ts:44
  type PermissionBehavior = 'allow' | 'deny' | 'ask'

  ┌────────┬──────────────────────────────────────────────────────────────┐
  │ Result │                           Meaning                            │
  ├────────┼──────────────────────────────────────────────────────────────┤
  │ allow  │ Pre-approved — run the tool immediately, no prompt           │
  ├────────┼──────────────────────────────────────────────────────────────┤
  │ deny   │ Pre-blocked — refuse it, never ask the user                  │
  ├────────┼──────────────────────────────────────────────────────────────┤
  │ ask    │ Unknown — pause and show the user a dialog to approve/reject │
  └────────┴──────────────────────────────────────────────────────────────┘                                                         
   
  ---                                                                                                                               
  How the decision is made — 5 layers checked in order
                                                                                                                                    
  src/utils/permissions/permissions.ts  ←  hasPermissionsToUseTool()
                                                                                                                                    
  1. Permission Mode — the global operating mode of the session:                                                                    
                                                                                                                                    
  ┌───────────────────┬───────────────────────────────────────────────┐                                                             
  │       Mode        │                   Behavior                    │
  ├───────────────────┼───────────────────────────────────────────────┤                                                             
  │ default           │ Ask the user for risky tools                  │
  ├───────────────────┼───────────────────────────────────────────────┤                                                             
  │ acceptEdits       │ Auto-allow file edits, ask for shell commands │
  ├───────────────────┼───────────────────────────────────────────────┤                                                             
  │ bypassPermissions │ Auto-allow everything (no prompts at all)     │
  ├───────────────────┼───────────────────────────────────────────────┤                                                             
  │ dontAsk           │ Never prompt, deny anything not pre-approved  │
  ├───────────────────┼───────────────────────────────────────────────┤                                                             
  │ plan              │ Read-only mode, no writes allowed             │
  └───────────────────┴───────────────────────────────────────────────┘                                                             
                  
  2. Always-allow rules — rules saved in settings like:                                                                             
  { "alwaysAllow": ["Bash(git status)", "Bash(git diff)"] }
  These come from userSettings, projectSettings, or cliArg.                                                                         
                                                                                                                                    
  3. Always-deny rules — same idea but blocks specific commands.                                                                    
                                                                                                                                    
  4. Working directory rules — is the tool trying to access a file outside the allowed directories? If yes → deny.                  
                                                                                                                                    
  5. Safety checks — hardcoded dangerous patterns, e.g. rm -rf /, writing to .git/, shell injection patterns → deny regardless of   
  settings.       
                                                                                                                                    
  ---             
  If the answer is ask — a dialog appears

  src/hooks/toolPermission/handlers/interactiveHandler.ts
                                                                                                                                    
  The terminal shows something like:                                                                                                
                                                                                                                                    
  Claude wants to run:                                                                                                              
    rm -rf ./build

  [y] Yes  [n] No  [A] Always allow  [D] Always deny                                                                                
   
  The user's answer is then saved back as a new rule (if they chose "Always").                                                      
                  
  ---                                                                                                                               
  One-liner summary
                   
  ▎ wrappedCanUseTool() checks the human user's permission — whether a given tool call is pre-approved, pre-blocked, or needs to 
  pause and ask the user right now, based on their settings, mode, and safety rules. 







❯ where is it implemented?                                                                                                          
                                                                                                                                  
  Searched for 1 pattern, read 1 file (ctrl+o to expand)                                                                            
                                                                                                                                    
⏺ wrappedCanUseTool is defined at src/QueryEngine.ts:244.                                                                           
                                                                                                                                    
  It's a thin wrapper — here's what it does:                                                                                        
                                                                                                                                    
  QueryEngine.ts:244                                                                                                                
  wrappedCanUseTool()                                                                                                               
    │                                                                                                                               
    ├─ calls canUseTool()           ← the real permission check (passed in from outside)                                          
    │     │                                                                                                                         
    │     └─ src/hooks/useCanUseTool.tsx                                                                                            
    │           └─ hasPermissionsToUseTool()                                                                                        
    │                 └─ src/utils/permissions/permissions.ts                                                                       
    │                                                                                                                               
    └─ if result !== 'allow'                                                                                                        
          → records the denial in this.permissionDenials[]   (line 263)                                                             
             so the SDK can report back to callers what was blocked                                                                 
                                                                                                                                    
  The wrapper's only job is tracking denials for SDK reporting — it doesn't change the decision. The actual permission logic lives  
  in:                                                                                                                               
                                                                                                                                    
  ┌──────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┐       
  │                 File                 │                                       Role                                       │
  ├──────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────┤       
  │ src/hooks/useCanUseTool.tsx          │ React hook that wires the permission check to the UI dialog                      │
  ├──────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────┤
  │ src/utils/permissions/permissions.ts │ hasPermissionsToUseTool() — the real decision logic (mode, rules, safety checks) │       
  └──────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────────┘   
















 give me the architecture of the whole software(claude code) , like you are an experienced architecture                           
  ⎿  ⧉ Selected 1 lines from AgenticOS/claude-code-main/src/query.ts in Visual Studio Code

  Read 2 files, listed 2 directories (ctrl+o to expand)

⏺ Now I have enough to give a thorough architectural breakdown.

  ---
  Claude Code — Architecture

  ---
  The Big Picture

  Claude Code is a terminal-native agentic AI system. At its core it is a loop: receive user input → ask the LLM → execute tools →
  feed results back → repeat. Everything else — the UI, permissions, memory, multi-agent, IDE bridge — is infrastructure wrapped
  around that loop.

  ┌─────────────────────────────────────────────────────────────────┐
  │                        USER / IDE / SDK                         │
  └────────────────────┬───────────────────────────┬────────────────┘
                       │ terminal input             │ IDE / SDK call
                       ▼                            ▼
  ┌────────────────────────────────────────────────────────────────┐
  │                     ENTRYPOINT LAYER                           │
  │  src/main.tsx  │  src/entrypoints/cli.tsx  │  sdk/  │  mcp.ts  │
  └───────────────────────────┬────────────────────────────────────┘
                              │
                              ▼
  ┌────────────────────────────────────────────────────────────────┐
  │                     QUERY ENGINE                               │
  │                  src/QueryEngine.ts                            │
  │                     src/query.ts                               │
  │                                                                │
  │   ┌──────────┐    ┌──────────────┐    ┌──────────────────┐    │
  │   │  Context │───►│  Anthropic   │───►│  Tool Execution  │    │
  │   │  Builder │    │  API Stream  │    │  Loop            │    │
  │   └──────────┘    └──────────────┘    └────────┬─────────┘    │
  │                                                │              │
  └────────────────────────────────────────────────┼─────────────-┘
                                                   │
                      ┌────────────────────────────┘
                      ▼
  ┌───────────────────────────────────────────────────────────────┐
  │                       TOOL SYSTEM                             │
  │                  src/tools/  (40 tools)                       │
  │  File │ Bash │ Web │ Agent │ Task │ MCP │ Skills │ Plan │ ... │
  └──────────────────────────┬────────────────────────────────────┘
                             │
            ┌────────────────┼─────────────────┐
            ▼                ▼                 ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐
  │  PERMISSION  │  │   SERVICES   │  │    UI LAYER          │
  │  SYSTEM      │  │  API/MCP/LSP │  │  React + Ink (REPL)  │
  └──────────────┘  └──────────────┘  └──────────────────────┘

  ---
  Layer 1 — Entrypoints (How users get in)

  There are 4 ways to enter Claude Code, all feeding into the same QueryEngine:

  ┌─────────────────┬────────────────────────────────────────┬──────────────────────────────────────────────────┐
  │   Entrypoint    │                  File                  │                     Use case                     │
  ├─────────────────┼────────────────────────────────────────┼──────────────────────────────────────────────────┤
  │ CLI / Terminal  │ src/main.tsx → src/entrypoints/cli.tsx │ Human at terminal                                │
  ├─────────────────┼────────────────────────────────────────┼──────────────────────────────────────────────────┤
  │ Agent SDK       │ src/entrypoints/sdk/                   │ Programmatic embedding in apps                   │
  ├─────────────────┼────────────────────────────────────────┼──────────────────────────────────────────────────┤
  │ MCP Server mode │ src/entrypoints/mcp.ts                 │ Other AI agents use Claude Code as a tool server │
  ├─────────────────┼────────────────────────────────────────┼──────────────────────────────────────────────────┤
  │ IDE Bridge      │ src/bridge/                            │ VS Code / JetBrains extensions                   │
  └─────────────────┴────────────────────────────────────────┴──────────────────────────────────────────────────┘

  src/main.tsx uses Commander.js to parse CLI flags, fires parallel prefetches (MDM policy, Keychain, API preconnect) before
  importing any heavy modules, then hands off to the REPL launcher.

  ---
  Layer 2 — Query Engine (The Brain)

  Two files form the core:

  src/QueryEngine.ts   ← outer orchestrator (session lifecycle, SDK reporting)
  src/query.ts         ← inner loop (streaming, tool execution, transitions)

  What QueryEngine.ts does

  - Owns the session (start → end)
  - Wraps canUseTool() to track permission denials for SDK callers
  - Builds the system prompt, user context, tool list
  - Initializes thinking config, model selection, token budgets
  - Calls query() in a loop per user turn

  What query.ts does — the agentic loop

  while (true):
    1. Prepare messagesForQuery (pipeline of compression/cleanup)
    2. Call Anthropic API → stream chunks
    3. Buffer: text_delta → AssistantMessage
                input_json_delta → tool input JSON
    4. If no tool_use → Terminal('completed') — stop
    5. For each tool_use block:
         a. Zod validate input
         b. wrappedCanUseTool() → permission check
         c. tool.call() → execute
         d. append tool_result to messages
    6. state.messages = [...old, assistantMessages, toolResults]
    7. Continue → go to 1

  The loop's decision at each step is a typed transition (src/query/transitions.ts): either Terminal (stop, with a reason) or
  Continue (keep going, with a reason). This makes every loop exit auditable.

  Context Pipeline (before each API call)

  Every iteration, messagesForQuery is processed through a compression pipeline to fit the context window:

  raw history
    → getMessagesAfterCompactBoundary()   strip pre-compact old messages
    → applyToolResultBudget()             trim oversized tool outputs
    → snipCompact()                       remove old redundant turns
    → microcompact()                      compress repeated tool results
    → contextCollapse()                   collapse old context sections
    → autoCompact()                       summarize entire history if near limit
    → prependUserContext()                inject <system-reminder> (date, cwd, env)
    → API call

  ---
  Layer 3 — Tool System (What Claude can do)

  Every capability is a tool. 40 tools total, each self-contained in src/tools/<ToolName>/.

  src/Tool.ts          ← base interface, buildTool() factory
  src/tools.ts         ← registry (all tools listed here)
  src/tools/<Name>/    ← each tool's implementation

  Every tool defines:
  - inputSchema — Zod schema, validated before execution
  - call() — the actual implementation
  - checkPermissions() — what needs user approval
  - isConcurrencySafe() — can it run in parallel?
  - renderToolUseMessage() / renderToolResultMessage() — terminal UI

  Tool Categories

  File I/O        FileReadTool, FileEditTool, FileWriteTool, GlobTool, GrepTool
  Execution       BashTool, PowerShellTool, REPLTool, SleepTool
  Agents/Tasks    AgentTool, TaskCreate/Get/List/Update/Stop/Output, SendMessageTool
  Planning        EnterPlanModeTool, ExitPlanModeTool, BriefTool
  Web             WebFetchTool, WebSearchTool
  MCP             MCPTool, McpAuthTool, ListMcpResourcesTool, ReadMcpResourceTool
  Memory/Config   TodoWriteTool, ConfigTool, SkillTool, ToolSearchTool
  Scheduling      ScheduleCronTool, RemoteTriggerTool
  Teams           TeamCreateTool, TeamDeleteTool
  Notebook        NotebookEditTool
  LSP             LSPTool
  Worktree        EnterWorktreeTool, ExitWorktreeTool

  ---
  Layer 4 — Permission System

  Every tool call passes through this before execution.

  tool.call() requested
          │
          ▼
  wrappedCanUseTool()           src/QueryEngine.ts:244
          │
          ▼
  hasPermissionsToUseTool()     src/utils/permissions/permissions.ts
          │
          ├── Check permission MODE
          │     default | acceptEdits | bypassPermissions | dontAsk | plan
          │
          ├── Check alwaysAllow rules   (from settings / CLI / project)
          ├── Check alwaysDeny rules
          ├── Check working directory   (is path inside allowed dirs?)
          ├── Check safety patterns     (rm -rf /, .git/ writes, etc.)
          │
          └── Result: allow → run | deny → block | ask → show dialog
                                                           │
                                                src/hooks/toolPermission/
                                                handlers/interactiveHandler.ts

  Permission rules use wildcard patterns: Bash(git *), FileEdit(/src/*).

  ---
  Layer 5 — UI Layer (React in the Terminal)

  Built with React + Ink — React components rendered to terminal output instead of a browser DOM.

  src/screens/REPL.tsx          ← main interactive screen
  src/components/               ← ~140 React components
  src/hooks/                    ← ~80 React hooks
  src/ink.ts                    ← Ink primitives (Box, Text, useInput)
  src/state/AppStateStore.ts    ← global state (like Redux store)
  src/context/                  ← React context providers

  The REPL screen manages: input buffer, streaming output display, permission dialogs, tool progress indicators, cost display,
  history navigation.

  ---
  Layer 6 — Services (External Integrations)

  src/services/
    api/              Anthropic SDK client, retry logic, streaming
    mcp/              MCP client — connects to external MCP servers
    compact/          Conversation compression (auto, micro, snip, reactive)
    lsp/              Language Server Protocol — code intelligence
    analytics/        GrowthBook feature flags, OpenTelemetry tracing
    oauth/            OAuth 2.0 auth flow
    plugins/          Plugin loader
    tools/            Tool orchestration, streaming tool executor

  ---
  Layer 7 — Subsystems (Major Features)

  Memory System (src/memdir/)

  Hierarchical markdown-based memory: ~/.claude/CLAUDE.md (user) → ./CLAUDE.md (project) → auto-extracted memories. Injected into
  system prompt at startup.

  Multi-Agent / Coordinator (src/coordinator/)

  AgentTool spawns sub-agents. TeamCreateTool creates parallel agent teams. SendMessageTool routes messages between agents. Gated
  behind COORDINATOR_MODE feature flag.

  IDE Bridge (src/bridge/)

  JWT-authenticated bidirectional channel between the CLI and VS Code/JetBrains extensions. Proxies permission dialogs to the IDE
  UI, routes file diffs to the IDE diff viewer.

  MCP Dual Role (src/services/mcp/, src/entrypoints/mcp.ts)

  Claude Code is simultaneously an MCP client (uses tools from external MCP servers) and an MCP server (exposes its own tools so
  other AI agents can call it).

  Skill System (src/skills/)

  Reusable named workflows with bundled prompts and tool configurations. Invoked via SkillTool or /skill-name. 16 bundled skills +
  user-defined + MCP-sourced.

  Task System (src/tasks/)

  Background and parallel work: shell tasks, local agent tasks, remote agent tasks, teammate agents. Tracked via
  TaskCreate/Get/List/Update/Stop/Output tools.

  Voice System (src/voice/)

  Speech-to-text streaming for hands-free use. Gated behind VOICE_MODE feature flag.

  ---
  Build System

  ┌───────────────┬───────────────────────────────────────────────────────────────────────────────────────────────┐
  │    Aspect     │                                            Detail                                             │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Runtime       │ Bun (not Node.js) — native TSX, faster startup                                                │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ UI            │ React + Ink — React rendered to terminal                                                      │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Validation    │ Zod — runtime schema validation throughout                                                    │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Feature flags │ bun:bundle feature() — dead-code elimination at build time                                    │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Lazy loading  │ Heavy modules (OpenTelemetry ~400KB, gRPC ~700KB) deferred until first use                    │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Concurrency   │ Single-threaded event loop + async/await; CPU-heavy work offloaded to workers/child processes │
  └───────────────┴───────────────────────────────────────────────────────────────────────────────────────────────┘

  ---
  Architectural Principles

  1. Everything is a tool — capabilities are composable, discoverable, permission-gated units
  2. Loop is the architecture — the agentic while(true) in query.ts is the entire product
  3. Typed state machine — transitions make loop behavior explicit and debuggable
  4. Context is precious — multiple compression layers protect the context window
  5. Permission first — no tool executes without passing through the permission system
  6. React everywhere — even the CLI is a reactive component tree; state flows down, events bubble up
  7. Feature flags as architecture — entire subsystems (Voice, Bridge, Coordinator) are build-time eliminated when not needed

