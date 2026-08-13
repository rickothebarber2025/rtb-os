# RTB OS Behavioral UX / Figma Interaction Spec

## Design hierarchy

Use these principles in this order:

1. **Reciprocity / value first** — RTB OS should visibly do useful work before asking for input.
2. **Endowment / ownership** — emphasize saved progress, configured workspaces, drafts, and completed setup that already belong to the user.
3. **Goal gradient** — as a real task approaches completion, increase clarity and emphasis on the shortest path to done.
4. **Commitment / consistency** — ask for the smallest meaningful next action, then preserve continuity.
5. **Contrast effect** — make the recommended path easier to compare against alternatives without hiding or degrading those alternatives.
6. **Loss aversion** — use only for real, reversible operational risk or genuinely unfinished work. It is secondary to value-first motivation and must never invent urgency, scarcity, financial loss, or punishment.

## Core interaction: Value First → Small Commitment

### Figma component
`Behavioral / Momentum Bar`

Variants:
- `Value First`
- `Saved Progress`
- `Protect Progress`
- `Recommended Path`
- `Completed`

Properties:
- eyebrow
- title
- supporting copy
- primary action label
- icon
- tone
- optional count

### Prototype interaction
1. Component enters with `Smart Animate`, 180 ms, ease out, Y -4 → 0, opacity 0 → 100.
2. Primary action uses `While pressing` scale 0.98, 70 ms.
3. On action, navigate directly to the target workflow; do not open an intermediate menu when context is already known.
4. If the target is already open, scroll/focus the recommended object instead of reloading the page.
5. Reduced-motion variant uses dissolve only.

## Endowment interaction

### Pattern
Show what RTB OS has already preserved before asking the user to continue.

Examples:
- “Your progress is saved.”
- “4 of 7 tasks are already recorded.”
- “Your payroll draft is waiting where you left off.”
- “Your role, business scope, and checklist are already selected.”

### Figma prototype
Frame A: return to workflow.
Frame B: saved-state summary appears immediately.
Frame C: next unfinished item receives focus ring.

Transition: 160–220 ms Smart Animate.

Never manufacture progress. Any visual head start must be tied to actual setup completed by the system and actual task completion must remain separately visible.

## Goal-gradient interaction

### Figma component
`Progress / Momentum`

States:
- 0–49%: normal
- 50–69%: “finish strong”
- 70–89%: increased emphasis
- 90–99%: “final task / almost there”
- 100%: completion state

Progress animation: 220 ms ease out.
Do not animate from zero on every visit; animate from the previously saved percentage to the current percentage.

## Reciprocity patterns by RTB OS area

### Operations Cleaning
RTB OS gives first:
- preselect Whole RTB
- load both locations
- restore saved route
- open next incomplete category
- identify the next required task

User gives next:
- complete one task

### Staff Hub
RTB OS gives first:
- restore shift context
- summarize unread updates
- preserve checklist progress
- surface one useful next action

User gives next:
- acknowledge/update/complete one item

### Owner Dashboard
RTB OS gives first:
- prioritize business risk
- preserve drafts
- consolidate both businesses
- recommend the next owner action

User gives next:
- review the highest-impact item

### Payroll
RTB OS gives first:
- restore saved draft
- retain verified entries
- surface discrepancies before new-run actions

User gives next:
- review or resolve one discrepancy

### Access / Admin
RTB OS gives first:
- choose a safe role template
- explain exactly what the template exposes
- prefill assigned business scope when known

User gives next:
- confirm the access decision

## Contrast effect

Use a neutral `Recommended` badge rather than visually punishing the alternative.

Recommended option:
- stronger border
- short explanation of why it fits current context
- primary button

Alternative:
- normal border
- fully readable
- no hidden fees, disabled information, or misleading hierarchy

## Loss aversion guardrails

Allowed:
- “3 required cleaning tasks are still unfinished.”
- “This payroll draft contains verified entries; starting over may duplicate work.”
- “A required compliance item is still unresolved.”

Not allowed:
- invented countdown timers
- fabricated scarcity
- exaggerated money-at-risk claims
- guilt/shame language
- hiding dismiss/alternative actions
- threatening access or performance consequences that are not real

## Conversion and retention intent

Conversion means completing useful operational workflows, not maximizing clicks.
Retention means users return because RTB OS preserves context and reduces repeated work.

Primary product metrics to instrument later:
- task completion rate
- time to first useful action
- resume-to-completion rate
- abandoned checklist rate
- repeated navigation/backtracking rate
- payroll draft completion rate
- unresolved action age
- weekly active staff/contractors

## Interaction writing rules

Prefer:
- “Continue where you left off”
- “Do this next”
- “Saved automatically”
- “Recommended for this shift”
- “Review existing draft”

Avoid:
- “Don’t miss out”
- “Last chance”
- “You’ll lose everything”
- generic “Learn more” when a concrete action exists
- multiple equally prominent primary buttons

## Mobile behavior

- One primary action above the fold.
- Secondary categories collapsed by default.
- Bottom nav must remain role-specific.
- Touch target minimum: 40–44 px practical target area.
- Do not show business selectors when the role has a deterministic business scope.
- Preserve scroll position only when returning to the same workflow; otherwise focus the next-best item.
