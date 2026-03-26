---
name: ftm-map
description: Persistent code knowledge graph powered by tree-sitter and SQLite with FTS5 full-text search. Uses a v2 hybrid architecture combining file-level PageRank with symbol-level blast radius analysis. Builds structural dependency graphs for blast radius, dependency chains, context selection, and keyword search. Use when user asks "what breaks if I change X", "blast radius", "what depends on", "where do we handle", "map codebase", "index project", "what calls", "dependency chain", "what's relevant for", "context for", "ftm-map".
---

# ftm-map

Persistent code knowledge graph powered by tree-sitter and SQLite with FTS5 full-text search. Uses a v2 hybrid architecture: file-level PageRank (via fast-pagerank with scipy sparse matrices) for broad relevance ranking, combined with symbol-level blast radius for precise impact analysis. Parses the local codebase using Aider-style def/ref extraction with tags.scm into a 5-table schema (files, symbols, refs, file_edges, symbol_edges) stored in `.ftm-map/map.db`, then answers structural queries (blast radius, dependency chains, context selection, symbol lookup) and keyword searches without re-reading the source tree on every question.

## Events

### Emits
- `map_updated` — when the graph database has been updated (bootstrap or incremental)
  - Payload: `{ project_path, symbols_count, edges_count, file_edges_count, reference_count, files_parsed, duration_ms, mode }`
- `task_completed` — when any ftm-map operation finishes

### Listens To
- `code_committed` — run incremental index on changed files, then emit `map_updated`
- `task_received` — begin bootstrap or query when ftm-mind routes a mapping/search request

## Config Read

Read `~/.claude/ftm-config.yml`:
- Check `skills.ftm-map.enabled` (default: true)
- Use `execution` model from active profile for indexing agents

## Blackboard Read

On startup, load context from the FTM blackboard:
1. Load `~/.claude/ftm-blackboard/context.json`
2. Filter experiences by `task_type: "map"`
3. Load matching experience files to inform index scope and query routing
4. Check for prior bootstrap records to determine if incremental mode is appropriate

## Mode Detection

Three modes, detected from request context:

```
Bootstrap:    "map this codebase" / "index this project" / no map.db exists yet
              Full scan of all source files. Builds graph from scratch.

Incremental:  Triggered by code_committed event or PostToolUse hook
              Parses only changed files and updates their graph entries.

Query:        Structural, keyword, or context question about existing graph
              Detects query type and runs appropriate script.
              Includes context selection for token-budgeted file retrieval.
```

If `.ftm-map/map.db` does not exist when a query arrives, fall back to offering bootstrap (see Graceful Degradation below).

## Mode 1: Bootstrap (full scan)

Trigger: user says "map this codebase" or "index this project", or `.ftm-map/map.db` does not yet exist.

1. Run `ftm-map/scripts/setup.sh` to ensure virtualenv and tree-sitter dependencies are installed
2. Run `ftm-map/scripts/.venv/bin/python3 ftm-map/scripts/index.py --bootstrap <project_root>`
3. Capture and report stats from stdout:
   - Files parsed
   - Symbols found
   - Edges created
   - Time elapsed
4. Emit `map_updated` with `mode: "bootstrap"`

Example invocation:
```
ftm-map/scripts/.venv/bin/python3 ftm-map/scripts/index.py --bootstrap .
```

## Mode 2: Incremental (post-commit)

Trigger: `code_committed` event fires, or PostToolUse hook detects a write to a source file.

1. Get changed files:
   ```
   git diff --name-only HEAD~1
   ```
2. Filter to source files only (skip docs, configs, lockfiles)
3. Run incremental index on changed files:
   ```
   ftm-map/scripts/.venv/bin/python3 ftm-map/scripts/index.py --incremental --files <file1> <file2> ...
   ```
4. Emit `map_updated` with `mode: "incremental"` and count of updated entries

## Mode 3: Query (answer structural and search questions)

Trigger: user asks a structural or keyword question about the codebase.

### Query Type Detection

| User says | Query type | Script flag |
|-----------|-----------|-------------|
| "what breaks if I change X" | blast radius | `--blast-radius X` |
| "blast radius of X" | blast radius | `--blast-radius X` |
| "what depends on X" | dependency chain | `--deps X` |
| "what calls X" | dependency chain (callers) | `--deps X` |
| "where do we handle X" | FTS5 keyword search | `--search "X"` |
| "find X in the codebase" | FTS5 keyword search | `--search "X"` |
| "tell me about function X" | symbol info | `--info X` |
| "show dependencies for X" | dependency chain | `--deps X` |
| "what's relevant for X" | context selection | `--context --seed-keywords X` |
| "context for X" | context selection | `--context --seed-keywords X` |
| "important files for X" | context selection | `--context --seed-files X` |
| "what should I look at for X" | context selection | `--context --seed-keywords X` |
| "show stats" / "how big is the index" | statistics | `--stats` |

### Execution

Run the appropriate query script with the venv python:
```
ftm-map/scripts/.venv/bin/python3 ftm-map/scripts/query.py --blast-radius <symbol> --project-root .
ftm-map/scripts/.venv/bin/python3 ftm-map/scripts/query.py --deps <symbol> --project-root .
ftm-map/scripts/.venv/bin/python3 ftm-map/scripts/query.py --search "<keywords>" --project-root .
ftm-map/scripts/.venv/bin/python3 ftm-map/scripts/query.py --info <symbol> --project-root .
ftm-map/scripts/.venv/bin/python3 ftm-map/scripts/query.py --context --seed-files src/auth.py --token-budget 4000 --project-root .
ftm-map/scripts/.venv/bin/python3 ftm-map/scripts/query.py --context --seed-keywords authenticate --project-root .
ftm-map/scripts/.venv/bin/python3 ftm-map/scripts/query.py --context --seed-symbols handleAuth --token-budget 8000 --project-root .
ftm-map/scripts/.venv/bin/python3 ftm-map/scripts/query.py --stats --project-root .
```

### Output Formatting

Scripts return JSON. Render as readable markdown:

**Blast radius** — tree of affected symbols with file paths and line numbers:
```
Blast radius of `authenticateUser`:
  direct callers (3):
    • loginHandler       src/handlers/auth.ts:42
    • refreshSession     src/handlers/session.ts:17
    • testAuthFlow       src/tests/auth.test.ts:88
  transitive (5):
    • routeMiddleware    src/middleware/index.ts:12
    ...
```

**Dependency chain** — ordered list of dependencies (callee direction):
```
Dependencies of `authenticateUser`:
  1. validateToken       src/auth/tokens.ts:8
  2. decodeJWT           src/auth/jwt.ts:22
  3. createSession       src/auth/session.ts:45
  4. storeSession        src/auth/session.ts:67
```

**FTS5 search** — BM25-ranked list with file:line references:
```
Results for "rate limit" (6 matches, ranked by relevance):
  1. applyRateLimit      src/middleware/ratelimit.ts:14      score: 0.94
  2. RateLimitConfig     src/config/types.ts:88              score: 0.81
  3. checkRateLimit      src/handlers/base.ts:203            score: 0.77
  ...
```

**Symbol info** — full details card:
```
Symbol: authenticateUser
  Kind:       function
  File:       src/auth/index.ts:34
  Signature:  authenticateUser(token: string, opts?: AuthOptions) → Promise<Session>
  Callers:    3 direct, 5 transitive
  Callees:    validateToken, decodeJWT, createSession
  References: 12 across codebase
  Dependents: 8 symbols total
```

**Context selection** — PageRank-ranked files with token budget:
```
Context for "authenticate" (budget: 4000 tokens):
  1. src/auth/index.ts          score: 0.142   tokens: 850
  2. src/handlers/auth.ts       score: 0.098   tokens: 620
  3. src/middleware/session.ts   score: 0.076   tokens: 540
  Total: 2010 / 4000 tokens
```

**Stats** — database overview:
```
Index statistics:
  Files:        42
  Symbols:      318
  References:   1204
  File edges:   86
  Symbol edges: 542
```

## Graceful Degradation

If `.ftm-map/map.db` does not exist when a query is requested:

1. Explain that the graph has not been indexed yet
2. Offer to bootstrap: "Run `ftm-map bootstrap` to index this codebase?"
3. If user confirms, switch to Bootstrap mode immediately
4. Do not attempt to answer structural queries by reading source files directly — the graph is the source of truth for structural questions

## Python Script Interface

All heavy lifting is done by Python scripts in `ftm-map/scripts/`. The skill orchestrates: detects mode, runs the right script with venv python, formats the output.

| Script | Purpose |
|--------|---------|
| `setup.sh` | Creates virtualenv, installs tree-sitter and dependencies |
| `db.py` | 5-table SQLite schema (files, symbols, refs, file_edges, symbol_edges), CRUD, graph traversal |
| `parser.py` | Aider-style def/ref extraction via tree-sitter tags.scm queries |
| `index.py` | Full bootstrap scan and incremental file indexing with Aider weight heuristics |
| `query.py` | Blast radius, dependency chain, FTS5 search, symbol info, context selection, stats |
| `ranker.py` | PageRank-based file ranking with fast-pagerank and scipy sparse matrices |
| `views.py` | INTENT.md and ARCHITECTURE.mmd generation from the 5-table graph |

Always use the venv python — never the system python — to ensure tree-sitter bindings are available:
```
ftm-map/scripts/.venv/bin/python3 <script> <args>
```

## Integration Points

**ftm-intent** may call ftm-map to retrieve caller/callee relationships when writing the `Relationships` field of INTENT.md entries. ftm-map returns structured JSON that ftm-intent formats into human-readable relationship text.

**ftm-diagram** may call ftm-map to retrieve the dependency graph for a module when generating DIAGRAM.mmd files. ftm-map returns edge data that ftm-diagram renders as mermaid nodes and edges.

Both integrations use `query.py --deps` and `query.py --info` to retrieve graph data without re-parsing source.

## Blackboard Write

After `map_updated` or session end:
1. Update `~/.claude/ftm-blackboard/context.json` with map session summary
2. Write experience file: `~/.claude/ftm-blackboard/experiences/map-[timestamp].json`
   - Fields: project_path, mode, symbols_count, edges_count, files_parsed, duration_ms
3. Update `~/.claude/ftm-blackboard/index.json` with new experience entry
4. Emit `task_completed` event

## Rules

- NEVER stop to ask for input. Make decisions and keep going.
- ALWAYS commit after completing with a clear message.
- ALWAYS review after commit: run `git diff HEAD~1`.
- Never reference AI/Claude in commit messages.
- Stay in your worktree.
- ALWAYS use the venv python (`ftm-map/scripts/.venv/bin/python3`), never the system python.
- For query mode, ALWAYS run `setup.sh` first if `.venv` does not exist.

## Requirements

- tool: `ftm-map/scripts/.venv/bin/python3` | required | Python with tree-sitter and SQLite bindings
- tool: `ftm-map/scripts/setup.sh` | required | virtualenv and dependency installer
- tool: `ftm-map/scripts/index.py` | required | bootstrap and incremental indexer
- tool: `ftm-map/scripts/query.py` | required | blast radius, dependency, and FTS5 search queries
- tool: `ftm-map/scripts/views.py` | required | INTENT.md and .mmd diagram generation from graph
- tool: `ftm-map/scripts/ranker.py` | required | PageRank file ranking with fast-pagerank and scipy
- tool: `git` | optional | changed file detection for incremental mode
- config: `~/.claude/ftm-config.yml` | optional | model profile and skills.ftm-map.enabled flag

## Risk

- level: low_write
- scope: writes and updates .ftm-map/map.db SQLite database; does not modify any project source files; also writes blackboard experience entry
- rollback: delete .ftm-map/map.db to reset to unindexed state; re-run bootstrap to rebuild

## Approval Gates

- trigger: bootstrap requested on very large codebase (1000+ files) | action: report estimated file count before running, proceed unless user objects
- complexity_routing: micro → auto | small → auto | medium → auto | large → auto | xl → auto

## Fallbacks

- condition: .venv does not exist | action: run setup.sh first to create it before proceeding
- condition: tree-sitter binary missing | action: run setup.sh to install dependencies
- condition: .ftm-map/map.db missing when query requested | action: explain graph not indexed, offer to run bootstrap
- condition: git not available for incremental changed-file detection | action: fall back to indexing all modified files detected from disk timestamps

## Capabilities

- cli: `ftm-map/scripts/.venv/bin/python3` | required | tree-sitter parsing and SQLite operations
- cli: `git` | optional | changed file detection for incremental indexing

## Event Payloads

### map_updated
- skill: string — "ftm-map"
- project_path: string — absolute path to indexed project
- symbols_count: number — total symbols in the graph
- edges_count: number — total dependency edges
- files_parsed: number — files processed in this operation
- duration_ms: number — indexing duration
- mode: string — "bootstrap" | "incremental"

### task_completed
- skill: string — "ftm-map"
- operation: string — "bootstrap" | "incremental" | "query"
- query_type: string | null — "blast-radius" | "deps" | "search" | "info" | "context" | "stats" (for query mode)
- duration_ms: number — total operation duration
