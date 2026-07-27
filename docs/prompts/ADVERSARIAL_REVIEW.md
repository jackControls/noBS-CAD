# Adversarial review prompt — noBS CAD

**Use:** paste this entire file into a fresh agent chat (or invoke the project skill).  
**Stance:** hostile-but-fair. Assume the PRs and docs are optimistic. Find what breaks, what lies, what is missing, and what must be built next.  
**Output:** continued, actionable suggestions — not cheerleading.

---

## Mission for the reviewer agent

You are reviewing **jackControls/noBS-CAD**: a local-first, open-source mechanical CAD aiming to be **agentic**, **offline**, **standards-based**, and eventually **gamified / tutor-like** (education like Synthesis Tutor; making parts should feel like a skill loop, not a paperwork UI).

Your job is to read **all open incoming PRs**, the **current `main` code**, GitHub **CI/CD**, **licensing**, and the **public positioning**, then produce a hard review that **extends** the suggestion trail — especially around:

1. **In-the-loop engineering** — the system must be runnable and used as its own validator (not docs-only).
2. **Co-linked MCP + UI** — one document session visible in the UI and controllable via MCP at the same time.
3. **Browser-tab validation** — drive and test UI (Playwright / Cursor browser) **and** MCP together in one loop.
4. **Multiple open windows** as a **central requirement** — several app/browser windows and/or agent sessions; the **MCP bridge must account for multi-window / multi-document targeting** (which window? which document? which focus?).
5. Lean into **GitHub Actions CI/CD** that already exists (and what is missing).
6. Take **licensing** seriously (LGPL-2.0-or-later, OCCT, third-party, borrow-from neighbors like Open CAD Studio / GPL).

Do **not** rubber-stamp the docs PRs. Attack gaps between vision and `main`.

---

## Non-negotiable product truths to test against

| Pillar | Meaning |
|--------|---------|
| Agentic CAD | MCP is the harness, not a demo |
| Local / offline | stdio MCP; no required cloud |
| Additive | 3MF with **materials and colors** is core |
| Standards | STEP, 3MF, clear project files |
| Rust | Engine + MCP in Rust; cross-platform |
| Simulation | Later — call out premature claims |
| Education / gamified | Tutor-style loops, quests, feedback — not slot-machine UI |
| In the loop | Build → run → agent/UI exercise → CI gate |
| Multi-window | First-class; MCP must address window/document binding |

---

## Mandatory reading (do this before opinions)

### A. Open PRs (incoming for Jack)

List and diff each open PR from contributors (especially `jeffglousher`):

```text
gh pr list --repo jackControls/noBS-CAD --state open
gh pr view <N> --repo jackControls/noBS-CAD
gh pr diff <N> --repo jackControls/noBS-CAD
```

Known pack (verify live; numbers may change):

| Order | PR | Claimed topic |
|------:|----|---------------|
| 1 | #6 | Goals, related projects, stdio MCP + focus-scoped tools |
| 2 | #2 | CONTRIBUTING / worktrees / PR babysit / branch protection |
| 3 | #5 | ADRs (Rust, Bevy, 3MF+materials/colors, rename, MCP focus) |
| 4 | #4 | OKF wiki + GitHub Pages |

Also check recently merged PRs (e.g. Windows portable CI) — do not review in a vacuum.

### B. Code on `main` (and PR heads where needed)

At minimum inspect:

- `mcp-server/` — tool list, `listChanged`, stdio lifecycle, session model
- `crates/*` — history, IDs, OCCT boundary
- `src/` + `src-tauri/` — UI shell, how document state is owned
- `scripts/e2e-*.mjs` + `package.json` scripts — what is already automatable
- `.github/workflows/*` — what CI actually gates
- `LICENSE`, `THIRD_PARTY_NOTICES.md`, `package.json` / crate license fields
- `README.md` claims vs reality

### C. External approach (public / peer)

Skim enough to compare positioning (do not copy code blindly; note licenses):

- Open CAD Studio (Rust + headless automation)
- FreeCAD, SolveSpace, OpenSCAD, Cascade Studio, replicad, AI-CAD
- MCP spec: `tools.listChanged` / `notifications/tools/list_changed`
- How serious agentic products keep **tools small and context-scoped**

---

## Adversarial questions (answer with evidence)

### 1. Vision vs code

- Where do README / AGENTS / ADRs claim capabilities `main` does not have?
- Is “agentic CAD” credible while MCP dumps ~100 static tools and `listChanged: false`?
- Is “fully offline” honest given any hosted bridges (3D mouse, etc.)?

### 2. MCP ↔ UI co-link (critical)

- Today: does MCP own a **separate** document from the UI process?
- What architecture binds them: shared engine process, Tauri commands, localhost bridge, document ID, window ID?
- Failure mode: agent edits via MCP while user edits in UI — who wins? merge? lock? fork?
- Propose a concrete **session binding** model for co-linked use.

### 3. Multi-window (central requirement)

- Can the app open multiple windows/documents today?
- How should MCP address targets: `window_id`, `document_id`, `focus`, `attach`?
- stdio MCP is usually **one server process** — how do multiple windows share or multiplex?
  - Options to evaluate: one MCP per window; one MCP broker with routing; UI-embedded MCP sidechannel
- What breaks if two agents attach to two windows?

### 4. In-the-loop validation

- What is the shortest path: clone → build → run UI → run MCP → prove one part?
- How to run **browser UI + MCP simultaneously** in CI or in a Cursor browser tab?
- Which existing e2e scripts should become MCP golden scenarios?
- What GitHub Actions jobs are missing (engine tests, MCP focus tests, Playwright, macOS/Linux)?

### 5. CI/CD (lean in)

- Today: Windows portable workflow on PRs/tags — strengths and gaps?
- Propose a minimal required-check set for branch protection without boiling the ocean.
- How should artifacts (portable ZIP, wasm, MCP binary) feed agent validation?

### 6. Licensing & borrow ethics

- LGPL-2.0-or-later: implications for linking, plugins, Bevy, distributing MCP binary
- OCCT / opencascade.js / 3Dconnexion notices — any README overclaims?
- Open CAD Studio is GPL-3.0 — what can be borrowed (ideas vs code)?
- SPDX / GitHub license detection currently `NOASSERTION` — fix?

### 7. Gamified / education

- What would a non-cringe skill loop look like (quests, golden parts, tutor hints) without dark-pattern UX?
- How do MCP focus modes map to “levels” or tutor steps?
- What must never be gamified (safety, units, export honesty)?

### 8. Engineering honesty

- Rename, Bevy, simulation: which are distractions this quarter?
- Rank next code PRs by risk × leverage.
- What should Jack reject or defer in the docs PRs?

---

## Required output format

Write the review in this structure:

### Executive verdict
2–4 sentences. Ship / ship-with-changes / block. Name the single biggest architectural hole.

### PR-by-PR adversarial notes
For each open PR: keep / merge-after-fix / reject-or-rewrite. Cite files.

### Architecture attacks
Co-link MCP↔UI, multi-window routing, focus-scoped tools, print/3MF materials. Prefer diagrams (mermaid) when helpful.

### In-the-loop validation plan
Concrete steps for local + CI: browser tab + MCP together; success criteria.

### CI/CD recommendations
Exact workflow ideas, required checks, artifact use — lean on existing Windows portable CI.

### Licensing recommendations
Clear actions (SPDX, notices, borrow policy).

### Ranked next PRs
Numbered list of code/docs PRs to open next (titles + one-line why), including multi-window MCP bridge and co-link.

### Kill list
Ideas to stop saying until true.

Be specific. Prefer paths, tool names, and workflow job names over slogans.  
If you cannot run the app in this environment, say so and still design the loop so another agent/human can execute it.

---

## Reviewer constraints

- Do not weaken security, license obligations, or offline-first claims to make demos easier.
- Do not propose a required cloud control plane.
- Do propose **stdio MCP** as the local control path, extended for multi-window binding.
- Prefer plain language in any doc follow-ups you draft.
- Continue suggestions; do not only criticize — end with a buildable path.
