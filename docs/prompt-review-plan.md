# Prompt-review extension: manual rewrite workflow

Status: design awaiting final confirmation. Planning does not authorise implementation, model requests or installation.

This replaces the previous teaching-workflow implementation plan. Build from the clean repository; do not recover or resume the abandoned prototype. Facts were checked against installed omp 18.20.0. No host or installed-package modifications are planned.

## 1. Product contract

Review ordinary interactive text prompts before they reach the target agent. The user, not the extension, revises the wording.

- Assess grammar, spelling, house style, British vocabulary/idioms, conciseness and naturalness. Describe tone; do not prescribe it or block on tone alone.
- Do not assess clarity: the reviewer receives no conversation context.
- No reference lookup, citations, tools, reviewer Q&A, learning ledger or post-send feedback widget.
- Reviewer explanations are unsourced model judgements, not verified language rules. Do not claim the rewrite interaction proves learning effectiveness.
- Preserve British English, -ise/-isation, no Oxford comma and primary double quotation marks. House style is a user preference, not a universal grammar rule. Meaning takes precedence: flag an ambiguous convention change as optional advice rather than demand a meaning-changing edit.
- Catch American vocabulary and idioms in ordinary prose and suggest British alternatives that preserve the intended meaning and register. Treat valid American usage as an optional British-usage preference, not a grammatical error or mandatory rewrite. Do not mislabel expressions shared by both varieties as uniquely American; explain uncertainty where appropriate. Existing spelling and house-style correction rules remain unchanged.
- Review only the submitted text and the fixed writing conventions. Do not send conversation history, target instructions, attachments or previous prompts to the reviewer. Treat prompt text as untrusted material to review, never an instruction to execute.
- Keep original attachments unchanged for approved delivery to the target agent. Image-only inputs bypass review.

### Findings

**Corrections** identify clear grammar/spelling errors or house-style departures. Show the exact original wording in red strikethrough with the replacement in green beside it, plus a concise explanation. Label house-style findings as preferences.

**Suggestions** offer optional conciseness/naturalness advice with one or two concrete local example rewrites that preserve the intended meaning and register. British-usage suggestions name the American word or idiom, provide suitable British alternatives and briefly explain any difference in meaning or register. Examples replace only the highlighted source span, not the whole prompt, and are never applied automatically. Uncertain language judgements appear as explicitly labelled “Possible issue” suggestions with an uncertainty explanation, not mandatory corrections; omit examples when they would require inventing meaning or rewriting protected material. Do not assess task clarity or ask for missing requirements. Tone is descriptive text, never a prescription.

Protect code blocks, inline code, HTML, link destinations, URLs, paths, flags, identifiers, technical names and existing quotation contents. Outer quotation delimiters may be flagged for house style; quoted contents may not. A correction touching protected or ambiguously mapped text becomes optional advice explaining why it was withheld. Unmarked technical names and semantic preservation still require model judgement; do not claim perfect detection.

The extension never constructs a sendable corrected prompt or applies a correction. The green wording is feedback, not a Send corrected action.

## 2. Review flow

1. Consume an eligible input synchronously, snapshot its text and attachments and defer reviewer work outside the input hook.
2. Run one independent text-only review using the selected reviewer and effort.
3. If the exact current draft has neither corrections nor suggestions, send it automatically. Descriptive tone alone does not pause it.
4. Otherwise show feedback beside an editable copy of the user's draft.
5. With corrections outstanding, normal sending is unavailable. Require an actual change from the draft that received the corrections before allowing re-review. Resubmitting the identical draft must not evade rewriting through inconsistent model responses.
6. Review the changed draft afresh. If clean, send it. If only suggestions remain, offer “Send as written” or let the user revise again. Acknowledgement applies to this result only; no declined-suggestion history is maintained.
7. When normal sending is unavailable, show “Send without passing review…” instead. This escape requires explicit confirmation and sends the current user-authored draft unchanged despite unresolved corrections, stale feedback or failure. Never bypass automatically or show two equivalent send options for an already approved draft.

Pasting a revision is allowed. Do not police keystrokes or infer learning from a changed draft. An empty or whitespace-only draft cannot review or send.

### Running requests and failures

One reviewer request runs at a time. The draft is temporarily read-only during review; previous feedback remains visible and is marked as belonging to its reviewed draft. “Cancel review” aborts the request and unlocks editing without losing the draft. It is distinct from cancelling the held prompt.

Use a 60-second whole-review deadline, including credential resolution. Provider errors, unavailable authentication, timeout, overflow, unexpected tool output, malformed JSON or invalid findings leave the prompt held. Show the full scrollable reason with Retry review, edit, confirmed bypass and prompt cancellation available. Keep previous feedback but never use a stale result to authorise a different draft.

No extension-level automatic retry, output-repair request, fallback model, conversation compaction or silent truncation. Provider transport may have its own SDK behaviour; do not promise one HTTP request. Request cancellation and the deadline must bound the overall operation.

## 3. Review screen

One custom overlay contains two persistent areas: complete scrollable feedback and the user's draft editor. Use columns on wide terminals and stack feedback above the draft on narrow terminals. Keep both visible while editing; no separate edit screen and no question pane.

- Feedback includes reviewer identity/effort, reviewed-draft status, corrections, optional advice, descriptive tone and any request error. Display only the latest completed review, not a revision archive.
- Use semantic removed/added styling with strikethrough and textual labels, so meaning does not depend on colour or terminal strikethrough support. Verify the requested red/green appearance in the actual terminal/theme.
- Retain editor cursor/undo and feedback scroll position across resize and focus changes. Never show an invisible actionable Send control in a terminal too small to display the screen; show a resize message and cancellation only.
- Tab/Shift+Tab cycle forwards/backwards through Review, Your draft and Options; F6 remains a forward-focus shortcut. Review focus uses scroll keys; Options focus uses arrows and Enter. Keep every option visible. The configured editor submit key requests re-review; configured newline/paste/undo keys retain their editor meanings. Escape from the editor obeys editor/Vim handling before returning to Review. Escape from Options returns to Review; Escape from Review invokes prompt cancellation, not bypass.
- Intercept editor submit before its default trimming/clearing. Use `getExpandedText()` for the actual current editor draft. Preserve text as represented by the editor; do not promise original raw paste bytes, tabs or CRLF: omp and its stock Editor normalise input before these interfaces expose it.
- Actions include Review revision, Cancel review while busy, Send as written when eligible, confirmed Send without passing review when not eligible and Cancel prompt. The command entry points remain available through normal command handling; do not add post-send viewers.

### Cancelling the held prompt

For text-only prompts, Cancel restores the current draft to the main input without sending it. Never overwrite a newer main-editor draft silently; offer to keep editing or explicitly replace it.

For prompts with attachments, keep this extension-only: offer “Keep editing” or an explicitly confirmed “Discard prompt and attachments”. Keep the draft and images in the review screen until a choice is made. Do not pretend text-only restoration restores attachment chips. The current public editor interface has `setEditorText`, but no attachment-restoration method was found; intercepted attachments are removed by the host.

Approved delivery and confirmed bypass retain the original attachments. Adding/replacing attachments inside the review screen is out of scope.

## 4. Commands and model selection

Supported commands:

- `/prompt-review` and `/prompt-review status`: show enabled state and reviewer provider/model/effort.
- `/prompt-review on` and `/prompt-review off`: change this session's enabled state.
- `/prompt-review change-model`: searchable model chooser, followed by an effort chooser.

Default: enabled, `openai-codex/gpt-6.1-terra`, Medium effort. Reviewer selection is independent of the target model. Changing it affects subsequent reviews, not a running request or the target agent. Escape from either chooser leaves all settings unchanged; save model and effort together only after both choices are confirmed.

Populate the model list from `ctx.models.list()` and display provider/model identity. This is a configured-credential availability check, not proof that a request will succeed. Recheck availability before saving and dispatching. Show supported efforts only, including Off when the model supports it; reject unsupported selections rather than clamping. If the default is unavailable, hold with a concrete reason and allow changing the reviewer. Never silently select another provider.

Turning reviews off bypasses future eligible submissions but does not release or abandon an already admitted prompt. Held prompts remain subject to their review or explicit bypass. Invalid command syntax reports usage without mutation.

## 5. Delivery, session changes and persistence

### Eligibility and delivery semantics

Review ordinary nonblank interactive text. Bypass programmatic messages, slash commands, shell commands, image-only input and native queue/control prefixes rather than consume their host semantics. Focused-subagent input paths outside the host's main input hook are not covered; do not claim global interception.

After approval, treat the submission as normal Enter at approval time: start a turn if idle or steer if streaming. This does not preserve the original follow-up shortcut, queue position or submission time; the public input hook omits the submit mode. Use `pi.sendUserMessage` without an explicit delivery override for these chosen semantics.

Keep admissions ordered in an in-memory FIFO with one active review screen. Each request/result is tied to the current owner session, context generation, prompt identity, draft revision and selected reviewer. Invalidated or late results must never send, update another draft or reopen a screen in a different session. Submission begins only for the exact current draft; no second click may dispatch it twice.

The delivery promise is not a universal immediate admission receipt: the idle path can await the target prompt flow. Do not block handling later inputs or commands on that assumption. Track each dispatch separately and handle its eventual resolution. A confirmed `PromptDroppedError` keeps that prompt recoverable in the same session; ambiguous delivery errors say “Delivery uncertain—nothing resent”. Never automatically resend an uncertain message or claim durable exactly-once delivery.

### Settings only

Persist only enabled/provider/model/effort for the actual session owner. Resuming that session restores those settings. A new session or copied fork starts with defaults. Tree navigation within the same session does not change its saved settings.

Keep drafts, attachment snapshots, feedback and queued reviews in memory only. Restarting loses unfinished work. Save no review conversation, revision archive or learning records to the main transcript or sidecars. Only approved user payloads reach the target transcript.

Use an owner-ID-scoped settings file under the public session-artifact directory, schema version 1. Missing settings use defaults; malformed records, owner/schema mismatches and I/O failures are explicit errors, not silent resets. Save settings atomically with private permissions and serialised writes; report changes successful only after saving. Failed changes retain the previous saved selection. Unsupported/nonpersistent storage cannot claim resumability.

Before session/branch/tree changes or a cancellable normal close, confirm abandonment if unfinished work exists. Declining keeps the user in the old context with its draft. Confirming aborts requests, discards pending drafts/images and prevents late delivery into the new context. A failed transition must leave the unchanged old context usable. Forced termination cannot preserve drafts or offer confirmation. Do not reset the target agent or change its model.

## 6. Implementation structure

Keep the implementation small, with no reviewer agent session or tools:

- `src/index.ts`: sole controller for input admission, transient prompt state, commands, dispatch and lifecycle. Own review eligibility and outcome transitions here, not inside UI callbacks.
- `src/reviewer.ts`: `reviewDraft(draft, selection, context, signal)` performs a single independent completion and returns a validated review. Own the static reviewer policy and strict result parsing here. No inherited conversation or agent fork.
- `src/protected-text.ts`: locate protected source spans conservatively for finding validation, keeping source-mapping complexity out of callers.
- `src/review-ui.ts`: persistent feedback/editor overlay and searchable model/effort selection. Consume immutable view state and controller actions; do not duplicate delivery or persistence decisions.
- `src/settings.ts`: validate and load/save session-owned enabled/model/effort settings. Keep its storage details behind a small interface.

Use installed public SDK interfaces verified against 18.20.0: `streamSimple` from `@oh-my-pi/pi-ai` for one completion, selected-model credentials through `ctx.modelRegistry.getApiKey`, `ctx.models.list()` for available models, supported-effort helpers from `@oh-my-pi/pi-catalog/model-thinking`, and `Editor`, `ScrollView`, `SelectList` and their theme helpers from `@oh-my-pi/pi-tui`. `streamSimple(...).result()` avoids the extra thinking-loop re-request wrapper in `completeSimple`; do not expose tools or a model fallback list. Honour transport/credential errors without inventing an alternate model.

The result contains corrections (category, exact source span, original, replacement and explanation), suggestions (category, relevant source span where applicable, explanation and an alternatives array, with uncertainty for possible issues) and descriptive tone. Correction categories are grammar, spelling and house style; suggestion categories are conciseness, naturalness, British usage and possible issue. Conciseness, naturalness and British-usage suggestions require one or two changed, nonempty local example rewrites in alternatives; possible issues may omit examples when no safe wording can be inferred. Validate exact keys/types, unique IDs, UTF-16 offsets against the exact reviewed draft, changed replacement text and nonoverlapping correction spans. Support insertions/deletions without inventing source offsets. Reject malformed output rather than displaying or trusting approximate corrections. Uncertainty and protected-region conflicts cannot create mandatory corrections. Never apply these display patches or suggested alternatives to the draft.

Use the public Markdown lexer and conservative lexical checks for protected source ranges. Verify source mapping across normalisation; protect ambiguous containing regions instead of guessing offsets. Keep ordinary unprotected prose in lists/tables reviewable. No fabricated finite dictionary of expressions or technical names.

Add a private Bun/TypeScript package with directly used matching 18.20.0 SDK development dependencies, a narrow `bun test tests` command and an explicit shared build/install file list in Makefile. Include all five runtime files; retain an `EXTENSION_DIR` override and empty-target protection. Installed extension imports resolve through the host. No edits to host source, installed packages or node_modules. No global installation or live-session restart without a separate request.

## 7. Implementation and proof sequence

After explicit implementation authorisation:

1. Add the result/settings contracts and implement validated independent review and protected text.
2. Add session settings and the model/effort chooser using the same validators as dispatch.
3. Implement the controller and feedback/editor screen together, including manual rewrite, suggestions, cancellation and lifecycle semantics.
4. Package all runtime files and run the focused deterministic checks once after integration.
5. The user has authorised installing the working prototype into the active global extension directory for a real-work trial. Verify it in a new isolated session in an assistant-owned pane of the existing Ghostty/Herdr instance, using synthetic prompts only. Follow terminal-use instructions and the Herdr skill; do not restart user processes. Verify automatic discovery and actual terminal output, not just a successful module import.
6. Run explicit synthetic provider acceptance with the default Codex Terra/Medium reviewer and existing authentication. Record observed latency, not a promised speed. A quota/auth failure is a reported acceptance gap, not permission to change providers.

Deterministic checks must cover:

- Grammar/spelling/house-style display spans, insertions, deletions and Unicode; malformed spans rejected; code/path/quotation contents not made mandatory; ambiguous applicability stays optional.
- Corrected feedback never mutates the draft; unchanged mandatory-correction drafts cannot re-review normally; changed revisions require review; clean and suggestions-only delivery paths remain distinct from confirmed bypass.
- Request cancellation, timeout and stale-result/session-change guards; text and attachments preserved on approved delivery; confirmed admission rejection held and uncertain delivery never resent.
- Model/effort validation, cancellation of either picker without changes, settings restored only for the same owner, disabled-state resume and new-session defaults; failed saves do not claim success.
- Actual screen resizing, independent scroll, focus/cursor behaviour, expanded editor text, read-only running state, cancellation restoration without overwriting newer text and confirmed attachment discard.

Actual provider/UI scenarios:

- `Please add a orange label.`: visible grammar correction, no automatic rewrite, user rewrites and submits for another review, clean draft reaches the target.
- A spelling error and `Please organize the labels.`: exact corrections shown, house style labelled preference, manual rewrite required.
- `Please put the trash in the trash can.`: optional British-usage advice offers “rubbish” and “bin” with suitable register/meaning explanations, without rewriting the prompt or requiring a change. Contrast with American spellings covered by existing correction rules, shared expressions that need no warning and Americanisms inside protected quotations/code that must not be targeted.
- A valid verbose prompt: optional advice without replacement text; explicit sending without suggestions works.
- A possible issue, descriptive tone, protected code/path/quoted examples and prompt-injection text: optional/description/protected semantics hold and the target task is not executed by the reviewer.
- Deliberate reviewer failure: draft stays held with edit/retry/cancel/bypass and no automatic alternate provider.
- Model and effort selection, off/on/status, resuming the same synthetic session and starting a new one; target model unchanged and no draft restoration promised.
- Text-only cancellation restores the current draft; attached-prompt cancellation keeps editing or confirms discard. Separate confirmed bypass and transition-discard cases. Normal-Enter-at-approval delivery is exercised with an idle and a streaming target.
- Inspect the synthetic target transcript for approved payloads only, never reviewer explanations or corrected alternatives. Report any incomplete provider, appearance or delivery proof honestly.

Document the implemented usage and limitations after smoke proof and remove owned temporary QA artifacts. Do not recreate the discarded prototype or treat old acceptance evidence as proof of this implementation.
