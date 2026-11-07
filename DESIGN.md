## s

name: "guruai Design System"
description: "Framework-agnostic design rules for web and mobile app implementation."

# ─── Colors ───────────────────────────────────────────────

colors:

# Brand

primary: "#10b981"
primaryStrong: "#064e3b"
primarySoft: "#a7f3d0"
accent: "#10b981"

# Surfaces

surface: "#ecfdf5"
surfaceMuted: "#a7f3d0"

# Text & Border

text: "#022c22"
border: "#065f46"

# Feedback

success: "#16A34A"
warning: "#D97706"
danger: "#DC2626"

# ─── Typography ───────────────────────────────────────────

typography:
family: "Libre Baskerville, Georgia, serif"
displayFamily: "Libre Baskerville, Georgia, serif"
monoFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
source: "Optional Google Font: https://fonts.google.com/specimen/Libre+Baskerville"
weights: "400, 700"
defaultWeight: 700
tone: "serif"

# Spacing

spacing:
xs: 4px
sm: 8px
md: 12px
lg: 16px
xl: 24px
xxl: 32px
section: 48px

# Radius

radius:
sm: 4px
md: 8px
lg: 12px

# Motion

motion:
fast: 120ms
normal: 180ms
slow: 260ms

---

# Design System Rules

## Purpose

guruai Design System defines portable, framework-agnostic design rules for web and mobile product interfaces. Use it as the source of truth before changing layouts, components, color, typography, motion, or interaction states.

This file is a portable design skill. Any AI or engineer should be able to read it and improve a web or mobile interface without needing React, Vue, Svelte, Tailwind, native mobile, or any other specific technology.

## Operating Modes

### New Project Mode

- Use these rules to create a coherent first implementation when no existing UI exists.
- Build the information architecture, component system, and responsive behavior from the tokens and rules below.

### Existing Project Refactor Mode

- Treat the existing product as the source of truth for content, routes, behavior, data, and information architecture.
- Improve the visual system by patching styles, tokens, spacing, typography, hierarchy, responsive behavior, and component states.
- Do not regenerate whole pages from scratch when a targeted patch can preserve the current experience.
- Do not replace real content with placeholder, demo, lorem ipsum, or simplified content.
- If a section looks inconsistent with this design system, restyle it first. Do not remove it.
- If removing content, routes, features, media, or data logic seems necessary, stop and ask for approval.

## Preservation Rules For Existing Products

- Preserve all existing headings, paragraphs, labels, buttons, links, images, icons, forms, navigation items, sections, routes, and data-fetching logic unless the user explicitly requests removal.
- Preserve semantic meaning and section order unless the user asks for an information-architecture change.
- Preserve working interactions: forms, menus, language toggles, theme toggles, dialogs, tabs, carousels, and scroll behavior.
- Preserve real brand/product names and domain-specific copy. Design changes must not make the page generic.
- Keep every original section represented after the refactor. A redesigned section is acceptable; a missing section is not.
- Never leave the first viewport empty unless the existing product intentionally has an empty state.

## Safe Refactor Workflow

1. Read the existing UI code before editing. Identify sections, routes, state, data dependencies, and user actions.
2. Inventory current colors, typography, spacing, radius, shadows, and component states.
3. Map old visual values to the tokens in this file one-to-one where possible.
4. Patch section by section. Avoid full-file rewrites when the current structure works.
5. After each section, verify the original content is still present, visible, and reachable.
6. After changing colors, check every affected text/background pair for contrast.
7. Verify desktop and mobile before finishing.

## Visual Direction

- Color direction: Emerald - Fresh success tone.
- Typography direction: Interface Serif - Elegant product copy.
- Style direction: School - Editorial ebook and course pages with thick borders, offset shadows, bold lessons, and structured learning sections
- References: Peakpages ebook landing, Neo-brutalist ebook pages, Bold course sales pages, Thick-border lesson card systems.
- Visual style: Emerald color direction, Interface Serif typography, School style.

## Style System: School

Use School to create confident learning and knowledge-product interfaces: ebook launches, course pages, playbooks, guides, creator products, workshop pages, and educational SaaS marketing. The style relies on a clean paper-like background, thick dark borders, offset shadows, bold editorial typography, square bullet markers, strong CTA blocks, book/course mockups, chapter lists, lesson grids, problem/solution cards, and testimonials. It should feel structured, practical, and high-trust, like a premium workbook page rather than a generic school app.

### Layout Rules

- use a paper-like white, off-white, or warm cream base surface with near-black/navy text and strong contrast.
- use the selected color as the book cover, badge, icon, or secondary accent when appropriate; keep the dark border as the structural anchor.
- use a hero split: editorial copy and bullet promises on one side, book/course/mockup card on the other.
- build the page in clear learning sections: problem, why it happens, what you will learn, table of contents, testimonials, FAQ, and final CTA.
- use 2-column grids for problem/why cards and lesson lists; use 3-column rows for testimonials when there is room.
- sections should feel like printed workbook spreads with boxed content, disciplined spacing, and obvious reading order.
- use thick outer section frames or boxed bands to separate major content blocks.
- avoid gradients, textures, glass, and decorative backgrounds; typography, borders, square bullets, and offset shadows carry the identity.
- mobile layout should stack to single-column with consistent spacing and full-width cards.

### Component Patterns

- cards must use 2px to 3px dark border with a 4px to 8px offset shadow in the same dark color.
- primary CTA buttons should use the main accent or selected color with dark text, thick border, and offset shadow.
- secondary buttons can use dark outline style with paper background and the same offset-shadow language.
- bullet points should use small filled squares (5px to 8px) in the selected accent, red, indigo, or gold depending on palette.
- headings should be bold editorial sans or slab-like serif with tight line height and large scale.
- body text should be dark navy/charcoal on paper surfaces with comfortable line height (1.45 to 1.65).
- navigation should feel like a boxed header: logo block, simple links, primary CTA button, and optional square icon button.
- book or course covers should be bold rectangular blocks with thick border, offset shadow, small metadata label, title, subtitle, author, and bottom rule.
- chapter rows should be wide bordered strips with strong title text and consistent offset shadow.
- testimonial cards should include quote marks, a short horizontal rule, name, and role; keep the copy practical and direct.
- lesson checklist items should be boxed rows with square bullets and strong left alignment.
- accordion and FAQ items should use the same thick-border strip treatment with clear expand indicators.

### Existing Project Refactor Rules

- inventory the existing interface first: navigation, hero, content sections, CTAs, cards, forms, and footer.
- preserve all content and map it into learning/product sections: promise, problem, lessons, chapters, proof, FAQ, and conversion.
- do not remove real content to make room for decorative elements.
- patch borders, shadows, backgrounds, and typography section by section instead of rebuilding the whole page.
- if a section already has clear structure, add boxed frames, thick borders, square bullets, and offset shadows without changing the content order.
- when converting cards, ensure every card has the consistent 1.5–2px border + offset shadow pattern.
- if a section is text-heavy, improve hierarchy with eyebrow labels, bold headings, chapter rows, and square bullet icons before adding more containers.
- if the product is not an ebook or course, adapt the pattern into a practical guide, checklist, docs, workshop, or knowledge-base framing.
- preserve semantic structure: headings, landmarks, lists, and form labels must remain correct.

### Spacing Rules

- use a disciplined spacing scale: 4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px.
- section padding should be 64px to 96px on desktop, 48px to 64px on mobile.
- card padding should be 24px to 32px for standard cards, 16px for compact list items.
- keep gutters consistent at 16px to 24px in 2-column grids.
- keep container max width around 1120px to 1280px for main content.
- use vertical spacing of 48px to 64px between major sections.
- avoid tight stacking of cards — let the offset shadow breathe with at least 8px clearance.

### Visual Hierarchy Rules

- headings should be the largest and boldest element in each section, using serif or heavy sans-serif.
- the hero headline should dominate the first viewport with a strong supporting subtitle below.
- CTA buttons should be the most visually prominent interactive element on the page.
- bullet icons (small colored squares) should create visual rhythm in list sections.
- use accent color on CTAs, badges, bullet squares, quote marks, book covers, and small icon buttons.
- use dark navy/charcoal for borders, shadows, major headings, and card outlines.
- avoid using more than two accent colors in a single section.
- let the thick borders and offset shadows carry the visual weight — avoid adding gradients or extra effects.
- eyebrow labels should be uppercase, letter-spaced, and muted to establish editorial structure.

### Style Anti-patterns

- use gradients, textures, or decorative backgrounds.
- add soft shadows, blur, or glassmorphism effects.
- use too many accent colors or let the selected color replace the dark structural border.
- make borders thin or invisible — the thick border is the core identity.
- use rounded corners excessively — prefer subtle radius (4px to 8px) or sharp corners.
- let the offset shadow clip or overlap adjacent cards.
- turn it into a classroom dashboard with calendars and student tables unless the product actually needs that.
- remove real proof, chapter information, or learning outcomes to make the design cleaner.

### Style Checklist

- background reads as paper-like white, off-white, or cream with dark high-contrast text.
- cards, CTAs, chapter rows, and mockups use thick dark borders with offset shadows.
- the selected accent is used intentionally for CTA fills, badges, bullet squares, quote marks, or book covers.
- the page includes strong learning structure: problem, outcomes, chapters, testimonials, FAQ, or equivalent sections.
- headings are bold editorial serif or sans-serif with tight line height.
- content stays practical and readable, not decorative.
- the result feels like a premium ebook/course page with neo-brutalist discipline.

## Design Tokens

Use semantic tokens first. Raw values from frontmatter are source values, not permission to scatter hex codes or one-off sizes through implementation.

### Color

- Primary action color: #10b981.
- Strong primary: #064e3b. Use for high-emphasis text, selected state, or strong borders.
- Soft primary: #a7f3d0. Use for subtle surfaces, selected backgrounds, or calm highlights.
- Surface: #ecfdf5.
- Muted surface: #a7f3d0.
- Text: #022c22.
- Border: #065f46.
- Success, warning, and danger are semantic states. Pair them with labels, icons, or position; never rely on color alone.
- When moving from a dark theme to a light or warm theme, update inherited light text classes such as white, muted-white, or low-opacity foregrounds.
- Do not apply one warm/cream/brown palette across the entire page without contrast, hierarchy, and content anchors.

### Text Selection

- Use this style-specific `::selection` treatment for School. It should follow the selected color tokens and stay readable.

```css
/* School selection: workbook marker block. */
::selection {
  background-color: #10b981;
  color: #ecfdf5;
  text-shadow: 3px 3px 0 #065f46;
}
```

- If the selected color changes, keep the same style behavior but re-check text/background contrast.

### Contrast And Visibility Gate

- Every visible text node must remain readable after color changes.
- Check hero text, navigation, buttons, card titles, form labels, helper text, icons, borders, and disabled states against their actual backgrounds.
- If legacy classes or CSS keep text white on a light surface, replace them with semantic foreground tokens.
- If content appears missing after a restyle, inspect contrast and visibility before deleting or rebuilding the section.
- Do not finish with invisible text, hidden CTAs, empty hero areas, or decorative backgrounds replacing product content.

### Typography

- Primary family: Libre Baskerville, Georgia, serif.
- Display family: Libre Baskerville, Georgia, serif.
- Monospace family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace.
- Allowed weights: 400, 700.
- Default UI weight: 700.
- Keep heading levels semantic. Visual size must follow layout importance, not HTML heading number.
- Keep letter spacing at 0 by default. Use uppercase labels sparingly and only for short metadata.

### Spacing And Radius

- Spacing scale: 4/8/12/16/24/32/48.
- Prefer spacing and grouping over extra borders.
- Use 4px radius for compact controls, 8px for standard cards/inputs, and 12px only for larger feature surfaces.
- Do not invent new spacing values unless the layout cannot be solved with the scale.

## Layout Rules

- Start mobile-first. The smallest useful viewport defines the base layout.
- Use content-driven breakpoints. Do not scale type directly with viewport width.
- Keep navigation, primary actions, and form completion paths easy to reach on touch devices.
- Prefer a clear grid, predictable alignment, and stable dimensions for controls, cards, tabs, and repeated items.
- Empty, loading, and error states must preserve layout stability and explain the next action.

## Component Rules

- Every interactive component must define default, hover, active, focus-visible, disabled, loading, success, and error behavior when those states apply.
- Buttons must communicate hierarchy through role: primary, secondary, tertiary, destructive, or icon-only.
- Forms must keep labels visible, helper text close to the field, and errors specific enough to fix.
- Cards must represent repeated items or contained tools. Do not nest cards inside other cards.
- Modals and popovers must include focus management, escape behavior, and clear dismissal affordances.

## Interaction And Motion

- Motion must clarify state change, not decorate the screen.
- Transitions should usually stay between 120ms and 260ms.
- Provide reduced-motion behavior for animations, parallax, shimmer, and auto-moving content.
- Pointer hover cannot be the only way to reveal important controls because touch devices do not have hover.

## Accessibility Requirements

WCAG 2.2 AA, keyboard-first interactions, visible focus states, semantic HTML before ARIA, reduced-motion support, accessible target sizes.

- Text and meaningful non-text UI must meet WCAG 2.2 AA contrast.
- Keyboard users must be able to reach, understand, and operate every interactive control.
- Focus indicators must be visible, high-contrast, and not hidden by overflow or animation.
- Semantic HTML or native platform semantics come before ARIA patches.
- Touch targets should be at least 24px by WCAG 2.2 AA and should reach 44px when layout allows.

## Content Tone

Clear, concise, implementation-focused, low-jargon, and helpful without being decorative.

- Use direct labels for actions.
- Avoid vague UI copy like "Submit" when the action can be named.
- Keep empty states useful: state what happened, why it matters, and what the user can do next.

## Rules: Do

- use semantic tokens before raw values in components.
- preserve existing content, copy, media, routes, and behavior when applying this system to an existing project.
- preserve hierarchy with spacing, contrast, typography, and component state.
- define default, hover, active, focus-visible, disabled, loading, success, and error states.
- design mobile-first, then enhance for tablet and desktop density.
- keep implementation guidance portable across React, Vue, Svelte, plain HTML/CSS, and mobile UI stacks.
- use paper backgrounds with dark navy/charcoal text and high contrast.
- apply thick dark borders with offset shadows to cards, chapter rows, book covers, CTAs, and major section frames.
- use the selected accent intentionally for primary CTAs, badges, bullet squares, and book/course cover fills.
- create clear educational structure with chapter lists, lesson checklists, problem/why cards, testimonials, and FAQ blocks.
- keep typography bold, clean, and editorial with strong headings and readable body copy.
- preserve content rhythm with disciplined spacing, boxed sections, and clear reading order.

## Rules: Don't

- use low-contrast text, hidden focus indicators, or color-only state communication.
- delete or replace existing product content unless the user explicitly asks for content removal.
- introduce one-off spacing, typography, or radius values outside the token system.
- mix unrelated visual metaphors in the same screen.
- depend on framework-specific component names in design rules.
- add decorative motion without reduced-motion fallbacks.
- use gradients, textures, or decorative backgrounds.
- add soft shadows, blur, or glassmorphism effects.
- use too many accent colors or let the selected color replace the dark structural border.
- make borders thin or invisible — the thick border is the core identity.
- use rounded corners excessively — prefer subtle radius (4px to 8px) or sharp corners.
- let the offset shadow clip or overlap adjacent cards.
- turn it into a classroom dashboard with calendars and student tables unless the product actually needs that.
- remove real proof, chapter information, or learning outcomes to make the design cleaner.

## AI Implementation Checklist

- Read this file before changing UI, layout, component styling, or interaction behavior.
- Identify the target surface: mobile app, mobile web, desktop web, dashboard, landing page, form flow, or content-heavy view.
- Map the design tokens to the project technology without changing the design intent.
- Reuse existing project components when they can satisfy these rules.
- If the current UI conflicts with this file, explain the conflict and choose the more accessible, consistent option.
- Confirm all original navigation items, hero content, CTAs, media, sections, and forms still exist unless removal was requested.
- Confirm no text became invisible from background, opacity, blend-mode, or inherited color changes.
- Confirm the first viewport contains meaningful product content, not just a background treatment.
- Verify keyboard navigation, focus-visible styling, responsive behavior, text overflow, loading state, and error state before finishing.
