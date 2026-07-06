# Android Agentic Developer Tool — Project Instructions

## What this project is

We are building an AI-powered agentic loop that automates the complete Android mobile development workflow — from reading a Jira ticket to raising a Pull Request — using Claude Code, Atlassian Rovo MCP, and Figma MCP.

The developer opens Claude Code and types:
```
Run the agentic loop for ticket APP-101
```

The loop reads the Jira ticket, reads the Figma design, scans the codebase, generates pixel-perfect UI, writes business logic, runs all tests, and raises a PR — automatically in under 3 minutes.

---

## Architecture — Claude Code + MCP

This is NOT a custom CLI tool. Claude Code IS the agent runtime.

**What handles what:**
- Claude Code — LLM reasoning, file read/write, terminal commands, git
- Atlassian Rovo MCP — all Jira operations (read, comment, transition status)
- Figma MCP (official plugin) — read files, frames, tokens, export PNG
- pixeldiff.js — pixel comparison helper script (pixelmatch library)
- string-checker.js — scan files for hardcoded strings
- pr-builder.js — format PR description with screenshots and flags
- GitHub Actions CI — full test suite, APK size, localisation check
- CLAUDE.md — the agentic loop instructions for Claude Code
- .agentrc — project config JSON in project root

**What we are NOT building:**
- Custom Node.js CLI
- Custom Jira REST API client
- Custom Figma REST API client
- Custom LLM orchestration layer
- npm package

---

## The complete flow

```
Developer: "Run the agentic loop for ticket APP-101"
         ↓
      Gate          → 4 checks + screen detect + ticket normaliser
         ↓
    Analyse         → codebase + Figma + API + strings + reuse + plan
         ↓
     Design         → generate UI → render → pixel diff → loop until 95%
         ↓
   Implement        → UiState + ViewModel + Repository + strings + tests
         ↓
    Evaluate        → local (7 checks) → CI (4 checks) → PR
         ↓
  PR created · Jira updated · Slack notified
```

---

## Target app details

- **Platform:** Mobile Android (phone + tablet)
- **Language:** Kotlin
- **UI:** Both Jetpack Compose AND XML layouts (new screens → Compose)
- **Architecture:** MVVM + Clean Architecture
- **DI:** Hilt
- **Async:** Coroutines + StateFlow (not LiveData)
- **Networking:** Retrofit + OkHttp
- **Testing:** JUnit 5 + MockK + Turbine (unit) · Espresso + Compose UI Test (UI)
- **Languages:** Multiple (English + Hindi + Marathi minimum)
- **Folder structure:** Not predefined — Analyse phase resolves from codebase scan
- **Dynamic UI:** Fully supported — server-driven component-type JSON contract

---

## Phase 1 — Gate (Gatekeeper)

**Trigger:** Developer types instruction to run loop for a ticket ID

**What it does:**
1. Fetch full ticket via Rovo MCP
2. Run 4 checks in sequence:
   - Check 1: Figma link — verify via Figma MCP (HARD BLOCK if missing)
   - Check 2: AC completeness — ask developer [Y/n] if missing (SOFT)
   - Check 3: Dependencies — check all blocking ticket statuses via Rovo MCP (HARD BLOCK)
   - Check 4: Scope size — warn if multiple screens detected [Y/n] override (SOFT)
3. Auto-detect target screen name using LLM reasoning over ticket content + Figma frame names
4. Confirm with developer: "Detected: LoginScreen — correct? [Y/n]"
5. Run Ticket Normaliser — convert free-form ticket to structured JSON
6. Show developer summary with flags and confidence score
7. Confirm: "Proceed? [Y/n]"
8. Transition Jira ticket to "In AI Development" via Rovo MCP
9. Seal context payload and begin Analyse phase

**Hard blocks (no override):** Missing Figma link · Unresolved blocking tickets
**Soft warnings (developer can override):** Missing AC · Multiple screens detected

**Ticket Normaliser output schema:**
```json
{
  "ticket_id": "string",
  "screen_name": "string or array",
  "multi_screen": "boolean",
  "ui_type": "compose | xml | both | unknown",
  "feature_summary": "string — max 20 words",
  "user_goal": "string",
  "acceptance_criteria": ["string — testable condition"],
  "edge_cases": ["string — specific scenario"],
  "figma_url": "string or null",
  "figma_frame": "string or null",
  "figma_flag": "string or null",
  "affected_files": ["string"],
  "localisation_notes": ["string_key → English value"],
  "out_of_scope": ["string"],
  "mobile_specific_notes": ["string"],
  "confidence_score": "high | medium | low",
  "flags": [{ "type": "FLAG_TYPE", "message": "string" }]
}
```

**Flag types:** MISSING_FIGMA · INFERRED_AC · INFERRED_EDGE_CASE · MULTI_SCREEN · VAGUE_REQUIREMENT · MISSING_API_DETAIL · HARDCODED_TEXT_RISK · UI_TYPE_UNCLEAR · LOCALISATION_RISK

---

## Phase 2 — Analyse (Observe + Plan combined)

**Parallel group — runs simultaneously:**
1. Codebase scanner — find + read all existing files for target screen
2. Figma reader — use Figma MCP: get_file, get_styles, get_components, get_node, export_node
3. API reader — search codebase for existing endpoint contracts
4. Strings checker — read strings.xml and all language files

**Sequential after parallel group:**
5. Component reuse scanner — cross-reference Figma components vs shared/components/:
   - GREEN: reuse as-is
   - YELLOW: safe extension (optional params with defaults only — NEVER breaking changes)
   - RED: create new component
   - HARD RULE: if Yellow change breaks any existing screen → auto-escalate to Red
6. Planner LLM — reads everything above, produces execution plan

**Planner produces:**
- Ordered task list (specific, not vague)
- Dependency graph between tasks
- Risk register with mitigations
- Test strategy (unit + UI tests planned upfront)

**Developer interaction:**
- confidence: high → auto-proceed
- confidence: medium → show summary, confirm [Y/n]
- confidence: low → show each task, developer reviews [Y / edit / skip]

**Dynamic UI handling:**
- Scan for existing ComponentRegistry
- Map each API component type → Figma frame
- Flag if any type has no matching Figma frame (MISSING_FIGMA_FRAME)
- Add component registry creation/update to task list

---

## Phase 3 — Design

**Step 1:** Read ui_type from payload → choose Compose or XML generation

**Step 2:** Generate initial UI code:
- Read Figma tokens from Analyse bundle (colors, typography, spacing)
- Read reuse map — use Green components as-is, extend Yellow, create Red
- Read existing code patterns — match team style exactly
- Zero hardcoded strings (stringResource only)
- Zero hardcoded colors (MaterialTheme.colorScheme only)
- Include mobile-specific: keyboard types, ImeAction, back navigation, scroll

**Step 3:** Render on emulator:
- Capture screenshots in parallel at 360dp, 390dp, 600dp
- Use @Preview screenshot testing for Compose

**Step 4:** Pixel diff via pixeldiff.js:
- Export Figma frame as PNG via Figma MCP export_node
- Compare region by region (not just overall score)
- Report: match %, which regions failed, expected vs actual, specific fix

**Step 5:** Fix and loop:
- Apply specific fixes from diff report
- Re-render and re-compare
- Loop until ≥95% match OR max 5 attempts
- If stuck after 5: present options to developer [fix asset / accept / abort]

**Step 6:** Verify all UI states:
- Each state gets its own pixel diff pass
- States: default, focused, error, loading, disabled, success, locked, empty

**Dynamic UI design:**
- Design each component type individually with its own pixel match loop
- Assemble full screen with mock API response
- Verify visibility states (all visible, some hidden, empty list)

---

## Phase 4 — Implement

**Hard rule:** NEVER touch files created by the Design phase

**Execution order:**
1. UiState.kt — sealed class (Loading, Success, Error, AccountLocked, ValidationError etc)
2. Parallel: ViewModel.kt + Repository.kt (can run simultaneously)
3. strings.xml — append new keys with ticket comment above (never reorganise existing)
4. Unit test file — JUnit 5 + MockK + Turbine
5. UI test file — Espresso + Compose UI Test

**Code rules:**
- Use StateFlow not LiveData
- Use Result<T> pattern in Repository
- Append to existing files — never delete existing functions
- Handle every error code found in API contract
- All test scenarios from Plan phase test strategy must be covered

**Dynamic UI implement:**
- Generate data models: UIScreenResponse, UIComponent, UIStyleOverride
- Create or update ComponentRegistry with when(type) switch
- Always include else branch → UnknownComponentPlaceholder (never crash)
- ViewModel calls repository for screen components, handles all states

**String rules:**
- Zero hardcoded strings anywhere in generated code
- All keys appended to strings.xml with comment: `<!-- [TICKET_ID] screen name -->`
- Same keys added to all language files with [NEEDS_TRANSLATION] prefix

---

## Phase 5 — Evaluate

**Local checks (run on developer machine):**
1. Gradle build — ./gradlew assembleDebug (must pass before anything else)
2. Unit tests — new tests + regression on existing tests for modified files
3. Lint + ktlint — all touched files
4. String checker — string-checker.js — zero hardcoded strings
5. Pixel recheck — re-run pixel diff to confirm Implement didn't break UI
6. Regression check — render all screens using modified shared components
7. UI fluidity tests — Espresso + Compose UI Test

Checks 2, 3, 4, 5 run in parallel after build passes.
Checks 6, 7 run in parallel after checks 2-5 pass.

**Auto-fix:** Simple compile errors and lint warnings fixed automatically.
**Loop back:** If any check fails → write error context to payload → loop back to Implement.
**Max attempts:** 3 loop-backs before escalating to developer via Jira comment (Rovo MCP).

**CI checks (run on GitHub Actions):**
1. Full test suite (parallel with 2 and 3)
2. APK size delta — max +0.5 MB per PR (parallel)
3. Localisation completeness — all new keys in all language files (parallel)
4. PR creation — after all CI checks pass

**PR auto-created with:**
- Title: [TICKET_ID] Screen name — brief description
- Pixel match scores for all states
- Screenshots at 3 sizes
- All flags from normaliser payload
- Scope override warning if applicable
- [NEEDS_TRANSLATION] notice if language files updated
- Link back to Jira ticket

**Jira updated via Rovo MCP:** Status → "In Review" + PR link comment

---

## Agent communication — shared payload

All phases communicate through one JSON file: `.agent/run_APP-101.json`

Structure:
```json
{
  "meta": {
    "ticket_id": "string",
    "run_id": "string",
    "status": "gate_passed | analyse_done | design_done | implement_done | evaluate_passed | completed | escalated",
    "attempt": "number (loop-back count)",
    "confidence_score": "high | medium | low",
    "scope_override": "boolean",
    "ac_override": "boolean"
  },
  "normalised": { "...ticket normaliser output..." },
  "loop_back": {
    "from_phase": "string",
    "to_phase": "string",
    "reason": "string",
    "failed_check": "string",
    "error_detail": "string"
  },
  "phase_outputs": {
    "gate": {},
    "analyse": {},
    "design": {},
    "implement": {},
    "evaluate": {}
  }
}
```

Each phase reads the full payload at start, appends its output, saves back.
Never overwrites previous phase outputs.
loop_back field carries failure reason into next Implement attempt.

---

## Project config — .agentrc

```json
{
  "project": {
    "name": "string",
    "packageName": "string",
    "sourceRoot": "app/src/main/java",
    "resRoot": "app/src/main/res",
    "testRoot": "app/src/test/java",
    "uiTestRoot": "app/src/androidTest/java"
  },
  "architecture": {
    "pattern": "MVVM",
    "di": "Hilt",
    "async": "Coroutines",
    "stateHolder": "StateFlow",
    "ui": ["Compose", "XML"],
    "networking": "Retrofit"
  },
  "figma": {
    "fileKey": "string"
  },
  "evaluate": {
    "pixelMatchThreshold": 95,
    "maxDesignAttempts": 5,
    "maxLoopBackAttempts": 3,
    "apkSizeBudgetMb": 0.5
  },
  "ci": {
    "provider": "github_actions",
    "workflowFile": ".github/workflows/agent-evaluate.yml"
  },
  "languages": ["en", "hi", "mr"],
  "dynamicUI": {
    "enabled": true,
    "componentRegistryPath": "shared/components/ComponentRegistry.kt",
    "apiContractPath": "docs/api-contract.json"
  }
}
```

---

## What still needs to be built

| Deliverable | Status | Priority |
|---|---|---|
| CLAUDE.md — full loop instructions | Not started | 1 — highest |
| .agentrc schema + validation | Designed, not written | 2 |
| pixeldiff.js helper script | Not started | 3 |
| string-checker.js helper script | Not started | 3 |
| pr-builder.js helper script | Not started | 3 |
| GitHub Actions CI workflow | Not started | 4 |
| Team pilot on real tickets | Pending approval | 5 |

---

## Key decisions already made

- Language: TypeScript/Node.js for helper scripts only
- LLM: Claude Code (not a separate API call)
- Jira: Atlassian Rovo MCP (full read + write)
- Figma: Official Figma MCP (read only)
- Pixel diff: pixelmatch library
- UI testing: Espresso + Compose UI Test (not Appium)
- Distribution: CLAUDE.md in project root (not npm package)
- Build time: 4 weeks (reduced from 12 due to MCP)
- Dynamic UI: Component-type JSON contract with ComponentRegistry pattern
- Multiple languages: Always generate localisation keys, never hardcode strings

---

## Documents produced

1. android_agentic_tool_proposal_v2.docx — manager approval proposal (updated)
2. mobile_ticket_normaliser_prompt.md — full LLM system prompt for ticket normalisation

---

## Conversation context summary

We have designed the complete system architecture across:
- Gatekeeper phase with 4 checks, soft/hard blocks, interactive prompts
- Ticket Normaliser with full system prompt for mobile Android
- Analyse phase with parallel execution and component reuse scanning
- Design phase with pixel match loop and all UI state verification
- Dynamic UI support with server-driven component registry
- Implement phase with strict rules (no Design file touching, append-only)
- Evaluate phase with local + CI split, retry logic, auto PR creation
- Agent communication via shared JSON payload
- Parallelism map across all phases
- MCP integration replacing all custom API code
- Manager proposal document (v1 and v2)

