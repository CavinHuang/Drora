---
name: obsidian-knowledge
description: Retrieve knowledge from the user's Obsidian Vault with the VaultSearch tool (natural-language, relevance-ranked, read-only) and cite notes with verbatim excerpts and line-precise quote selectors; point users to the Obsidian Vault panel for browsing, asking, insights, and review.
---

# Obsidian Vault Knowledge Retrieval

Use this skill when the user asks about the **content** of their notes or knowledge base ("what did I write about X", "find my notes on Y", "which note discusses Z") instead of asking to open or edit a specific file. File-level work (read/edit/create notes) stays in the `obsidian` skill.

## The VaultSearch Tool

`VaultSearch` is the plugin's read-only retrieval entry into the vault's knowledge index. It runs on the host side against the whole authorized vault.

- **Input is a natural-language query only.** There are no path, date, or tag filters by design — express the intent in the query text itself.
- **Output is ranked candidates**: note title/relative path, a verbatim excerpt windowed around the match, and line-precise quote selectors (`startLine`/`endLine`/offsets) pointing at the real file locations.
- **`status` is honest — relay it, never paper over it**:
  - `no_source`: no vault is configured. Tell the user to configure one in the Obsidian Vault panel.
  - `partial`: the index is incomplete; results may miss matches. Say so when citing.
  - `empty`: nothing matched. Do not invent notes.
- **Results reflect the last completed index.** Searching may trigger a background refresh in the host, so a follow-up search moments later can surface newer notes. If the vault was just edited, mention that the freshest edits may not be searchable yet.

## The vault_neighbors Tool

`vault_neighbors` is the plugin's read-only related-note discovery entry (same host-side index as `VaultSearch`).

- **Input is one note's vault-relative path** (`notePath`, exact match against the current index — no globs, prefixes, or dates) plus an optional `limit` (1–10, default 5).
- **Output is ranked neighbor candidates**: title/relative path, the most similar chunk's verbatim excerpt and quote selectors. Similarity scores are internal — rank order is what you get.
- **Use it for missing-link suggestions**: when the user asks "which notes should link to this one" or "find related notes I forgot to connect", run `vault_neighbors` on the note, read the actual candidate files, and propose concrete `[[wikilink]]` insertions with the exact sentence each link belongs to.
- **`status` is honest — relay it, never paper over it**: `note_not_found` (path not in the current index — the note was renamed or never indexed), `semantic_unavailable` (local embedding disabled or vectors not backfilled for this model), `empty` (no note passes the similarity floor). Do not invent neighbors.
- **Read-only, zero outbound**: it never writes and never calls any external service. Inserting a suggested link is a normal Edit under the vault's hook-based authorization (see the `obsidian` skill) — always confirm with the user before editing, and insert links one file at a time; multi-file batch cleanups belong in a Review proposal for the user to audit.

## Citation Discipline

- The excerpt is a **verbatim slice of the matched chunk**. Treat excerpts as unverified citations: before quoting a note verbatim or characterizing it in detail, read the actual file and verify.
- Quote selectors point at real file locations — use them to anchor references ("notes/project/x.md:42-58").
- If the vault lives outside the current workspace, the excerpt may be the only content you can see. Do not fabricate file contents beyond the excerpt; reading full files outside the workspace may be restricted.

## Read-Only Boundary

`VaultSearch` never writes. Creating, editing, or organizing notes goes through the native file tools under the vault's hook-based authorization — see the `obsidian` skill. Batch operations (bulk archive, mass rename) always require explicit user confirmation; this tool does not provide any write path.

## The Obsidian Vault Panel

The Obsidian Vault panel (notes / ask / insights / review views) is the user-facing surface of this plugin's vault capabilities. When the user wants to browse the vault, ask questions with sources, review insights, or audit knowledge changes, direct them to the **Obsidian Vault** entry in the sidebar. The agent does not operate the panel; panels and this tool read the same underlying index, so results stay consistent.
