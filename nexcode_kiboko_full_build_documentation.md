# NEXCODE-KIBOKO — Full Technical Build Documentation

## Overview
NEXCODE-KIBOKO is a fully local-first, agentic AI coding system with:
- Multi-provider model support (Ollama + external APIs)
- Multi-agent orchestration (planner, coder, reviewer, etc.)
- Self-improving prompt system
- VS Code sidebar extension (Copilot-like UI, NOT Copilot dependent)
- Full toolchain (file edits, terminal, git, testing, search)

This document is COMPLETE and designed for autonomous execution by another AI agent.

---

# 1. CORE ARCHITECTURE

## 1.1 High-Level System

```
VSCode Extension (UI Layer)
    ↓
Agent Orchestrator (Core Brain)
    ↓
Sub-Agents (Planner, Coder, Reviewer, QA, Security)
    ↓
Tool Layer (FS, Terminal, Git, Tests)
    ↓
Model Router (Ollama / OpenAI / Others)
    ↓
Memory System (Short + Long Term)
```

---

# 2. REQUIRED STACK (ALL FREE)

## 2.1 Core Runtime
- Node.js (>=18)
- TypeScript
- Python (for optional agent backend)

## 2.2 VS Code Extension
- vscode API
- @types/vscode

## 2.3 AI + Agent Frameworks (Use hybrid approach)

### REQUIRED
- LangGraph → orchestration (state machines)
- LangChain → tool abstraction
- LlamaIndex → RAG + memory

### OPTIONAL (advanced)
- AutoGen → multi-agent conversations
- CrewAI → role-based agents

## 2.4 Local Model Layer
- Ollama (MANDATORY)
- Models:
  - qwen2.5-coder:7b
  - deepseek-coder

## 2.5 Vector DB (Local)
- ChromaDB (recommended)
- FAISS (fallback)

## 2.6 Code Tools
- tree-sitter (code parsing)
- ripgrep (search)
- diff-match-patch

## 2.7 Dev Tools
- esbuild (fast bundling)
- vitest (testing)

## 2.8 Security
- semgrep
- trivy

---

# 3. MODEL PROVIDER LAYER

## 3.1 Interface

Create unified provider interface:

```
interface ModelProvider {
  generate(prompt): Promise<Response>
  stream(prompt): AsyncIterable<Token>
}
```

## 3.2 Providers

### Ollama
- REST API: http://localhost:11434

### OpenAI-compatible
- baseURL configurable

## 3.3 Model Router

Rules:
- Small tasks → local model
- Complex tasks → cloud

---

# 4. AGENT SYSTEM DESIGN

## 4.1 Core Agents

### Planner Agent
- Break tasks into steps

### Coder Agent
- Writes code

### Reviewer Agent
- Reviews diffs

### QA Agent
- Generates tests

### Security Agent
- Scans vulnerabilities

---

## 4.2 Agent Loop

```
User Input
→ Planner
→ Coder
→ Reviewer
→ QA
→ Execute Tools
→ Feedback Loop
```

---

# 5. TOOLING SYSTEM (CLAUDE CODE PARITY)

## REQUIRED TOOLS

### File System Tool
- Read/write files
- Apply patches

### Terminal Tool
- Execute shell commands
- Capture output

### Git Tool
- diff
- commit
- branch

### Test Runner
- run tests
- parse results

### Search Tool
- codebase search (ripgrep)

---

# 6. MEMORY SYSTEM

## 6.1 Types

### Short-Term
- conversation state

### Long-Term
- vector DB (Chroma)

### Skill Memory
- saved solutions

---

## 6.2 Self Learning

- Store successful prompts
- Store failed attempts
- Improve system prompt dynamically

---

# 7. SELF-IMPROVEMENT SYSTEM

## 7.1 Reflection Loop

After each task:

```
Evaluate → Score → Store → Update Prompt
```

## 7.2 Prompt Evolution

Maintain:
- base prompt
- optimized prompt

---

# 8. VS CODE EXTENSION

## 8.1 UI Requirements

- Sidebar panel (NOT Copilot)
- Chat interface
- Streaming responses
- Code diff viewer

## 8.2 APIs

- Webview API
- WorkspaceEdit
- TreeView
- Commands

---

## 8.3 UI Structure

```
Sidebar
  Chat
  History
  Agent Modes
```

---

# 9. MULTI-AGENT ORCHESTRATION

Use LangGraph:

```
Planner → Coder → Reviewer → QA
```

---

# 10. PROJECT STRUCTURE

```
nexcode-kiboko/
  extension/
  agent-core/
  providers/
  tools/
  memory/
  prompts/
  ui/
```

---

# 11. CODE EXECUTION SAFETY

- sandbox execution
- restrict commands

---

# 12. EVALUATION SYSTEM

Use:
- promptfoo
- custom scoring

---

# 13. INSTALLATION FLOW

1. Install Ollama
2. Pull models
3. Build extension
4. Load VSIX

---

# 14. REQUIRED FEATURES CHECKLIST

- Model switching
- Agent roles
- Tool execution
- Memory
- Self-learning
- VSCode UI

---

# FINAL NOTE

This system MUST:
- Work offline-first
- Support plugins
- Be extensible

---

END OF DOCUMENTATION

