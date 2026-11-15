# Native prompt-review prototype — THROWAWAY

**Question:** does reviewing a real prompt, showing feedback beside it and requiring the user to rewrite it feel right in omp?

This is an experimental native extension, not a browser mock-up or production release. The reviewer really calls the selected provider. It is deliberately kept on `prototype/manual-rewrite`, out of `main`. User verdict: pending.

## Run

Requires the existing omp 18.20.0 installation and Bun 1.4.4 or newer. No npm installation is needed: the launcher links this checkout to the installed matching SDK without changing those packages.

```sh
bun run prototype
```

This starts a separate omp process, disables normal extension discovery and loads only this prototype. Your installed extensions and existing sessions are not replaced. Its own sessions live in the ignored `.prototype-sessions/` directory. Reviewer requests use your existing authentication and count towards the selected provider's normal usage.

Default reviewer: **openai-codex/gpt-6.1-terra, Low**. A model appearing in the chooser does not prove that its credentials or quota work.

## Try it

1. Submit `Please add a orange label.`. Read the red struck-through original and green local correction. The draft remains unchanged.
2. Press **F6** to focus the draft. Rewrite it yourself, then use your configured submit key to review the revision. A clean revision goes to the target agent.
3. Submit `Please put the trash in the trash can.`. British-usage suggestions may offer British alternatives; they are optional, not grammatical errors. Use the actions to send without suggestions or rewrite again.
4. Try a spelling error, `organize`, code, paths and quoted American wording. Protected content must not become a compulsory rewrite.
5. Use `/prompt-review change-model`: type to filter, choose a model, then choose its effort. Escape from either step cancels without saving.
6. Try `/prompt-review off`, `/prompt-review on` and `/prompt-review status`.

### Controls

- **F6:** switch feedback/draft focus. Feedback scrolls independently.
- **Tab / Shift+Tab / Left / Right in feedback:** choose an action; **Enter:** activate it.
- **Submit in draft:** review your revision; it never applies the green wording for you.
- During a request, the draft is read-only. **Cancel review** aborts the request and unlocks editing.
- **Escape in draft:** return to feedback after editor/Vim handling. **Escape in feedback:** cancel the held prompt.
- Text-only cancellation restores the current draft to the main input. Attached-prompt cancellation offers to keep editing or explicitly discard the prompt and attachments; the host has no public attachment-chip restore interface.
- **Bypass review and send** requires confirmation. It is not the normal path for correcting mistakes.

The header exposes review/draft status, revision and attachment count. The reviewer/effort and future-review toggle remain visible. Wide terminals use columns; narrow terminals stack feedback and draft. Too-small viewports show a resize message rather than invisible sending controls.

## Intentional limits

- No sources, citations, inherited conversation, clarity assessment, reviewer Q&A or automatic rewrites. Explanations are unsourced model judgements.
- Grammar/spelling/house-style corrections require an actual draft change and another review. Conciseness/naturalness advice is optional and gives no replacement wording. British-usage advice is the exception: it names alternatives without applying them. Uncertain findings are optional; tone is descriptive.
- Only reviewer/model effort and enabled state persist per session. Drafts, attachments held for review and feedback are memory-only. Resume a session with `bun run prototype --resume <session-id-or-file>`; a new session starts with defaults.
- The review deadline is 60 seconds. Errors hold the draft; retries and bypass are explicit. There is no silent model substitution.
- Approved delivery has normal Enter semantics at approval time: idle starts a turn, streaming steers. The input hook cannot preserve the original follow-up shortcut or queue position. Native command/control inputs bypass this extension.
- Preserve text as represented by omp's editor, not raw pre-normalisation paste bytes. Detection of unmarked technical names and meaning still depends on model judgement.
- This prototype has no automated test suite. Judge it by trying the actual surface and record a verdict before any production implementation.

`docs/prompt-review-plan.md` records the design being explored. No findings from the abandoned teaching-workflow prototype establish correctness here.

## Observed native proof

Exercised with installed omp 18.20.0 and real Codex Terra/Low requests:

- Grammar feedback held `Please add a orange label.`; manually rewriting it to `Please add an orange label.` and re-reviewing delivered only the user-authored revision.
- British-usage feedback offered “rubbish”; sending without suggestions delivered the unchanged American wording.
- `Please organize the lables.` produced distinct house-style and spelling corrections. Re-reviewing the unchanged mandatory-correction draft was refused locally.
- Cancel review unlocked the unchanged draft. Bypass displayed a visible confirmation, defaulted to No and sent only after explicit Yes.
- Text-only prompt cancellation restored the draft to the main input.
- The searchable model/effort chooser worked. Cancelling the effort step preserved the old selection. Selecting OpenAI Terra/Low changed the reviewer while the target remained Codex Terra.
- Off plus reviewer selection survived an actual exit/resume. A new session returned to enabled Codex Terra/Low.
- Both stacked and side-by-side layouts were observed. The terminal ANSI capture contained strikethrough and red/green palette styling.
- Synthetic target journals contained only the three approved payloads, not reviewer explanations.

Evidence is terminal-state/text and ANSI capture, not screenshots. Attachment controls, branch-change confirmation, tiny-terminal behaviour and provider-specific failure varieties have not all been manually exercised.

### Findings that changed the prototype

1. Model-counted character offsets failed in a live British-usage review. The wire response now selects numbered token anchors; the extension computes UTF-16 spans and verifies the exact original substring. There is no fuzzy matching or automatic repair. Missing-word advice anchors to an existing neighbouring token; it does not require the model to count insertion offsets.
2. Core confirmation dialogs appeared underneath the custom review overlay. Confirmations now use their own top-level custom overlay, with No selected initially.

These are prototype findings, not user approval of a production design. No production implementation has been merged.
