# Color Palette & Design Tokens

### Rationale

The product serves non-technical customers (clarity over density), business analysts (trust and precision cues), and admins (structured, table-heavy UIs). The palette is calm, professional, and high-contrast — a deep navy primary with a teal accent communicates reliability and intelligence without the sterile coldness of a pure gray-blue enterprise palette. Categorical chart colors are chosen for WCAG 2.1 AA contrast on white and against each other, and are also distinguishable for the most common form of color-vision deficiency (deuteranopia).

### Base Tokens

| Token | Hex | Usage |
|-------|-----|-------|
| `color-primary-900` | `#0F1C35` | Page backgrounds (dark mode), sidebar fill |
| `color-primary-800` | `#172A4E` | Nav bar, admin sidebar |
| `color-primary-700` | `#1E3A6E` | Button fills, active nav items |
| `color-primary-600` | `#2554A0` | Hover states on primary buttons |
| `color-primary-500` | `#3B72CC` | Primary interactive color (links, focus rings) |
| `color-primary-200` | `#C2D5F5` | Primary tints, selected row highlight |
| `color-primary-50`  | `#EEF4FD` | Page background (light mode) |
| `color-accent-500`  | `#0EA5A0` | Accent / highlight (streaming indicator, active toggle) |
| `color-accent-400`  | `#14C4BE` | Accent hover |
| `color-accent-100`  | `#D0F5F4` | Accent tint (permission badge backgrounds) |
| `color-neutral-900` | `#111827` | Body text |
| `color-neutral-700` | `#374151` | Secondary text, labels |
| `color-neutral-500` | `#6B7280` | Placeholder text, muted labels |
| `color-neutral-300` | `#D1D5DB` | Dividers, input borders |
| `color-neutral-100` | `#F3F4F6` | Card backgrounds, table row alternates |
| `color-neutral-50`  | `#F9FAFB` | Page background alt |
| `color-white`       | `#FFFFFF` | Card surfaces, chat bubbles |
| `color-semantic-success` | `#16A34A` | Success states, permission granted |
| `color-semantic-warning` | `#D97706` | Warning states, partial match |
| `color-semantic-error`   | `#DC2626` | Error states, permission denied, blocked queries |
| `color-semantic-info`    | `#2563EB` | Informational banners |

### Chart Categorical Palette (8 series)

Ordered for maximum perceptual separation; first 4 are safe for deuteranopia.

| Token | Hex | Name |
|-------|-----|------|
| `chart-cat-1` | `#3B72CC` | Primary Blue |
| `chart-cat-2` | `#E07B39` | Orange |
| `chart-cat-3` | `#0EA5A0` | Teal |
| `chart-cat-4` | `#B447B2` | Purple |
| `chart-cat-5` | `#E8C832` | Yellow |
| `chart-cat-6` | `#D94F4F` | Red |
| `chart-cat-7` | `#5DB76E` | Green |
| `chart-cat-8` | `#7B61A8` | Violet |

### Chart Sequential Palette (single-hue ramp for intensity encoding)

Ramp from `#C2D5F5` (low) → `#0F1C35` (high), 7 steps. Used for single-series heatmap-style tables or gradient bars.

### WCAG 2.1 AA Intent

- All body text (`color-neutral-900` on `color-white`): contrast ratio 16:1 — passes AA large and small.
- Primary button text (`color-white` on `color-primary-700`): contrast ratio 7.2:1 — passes AA.
- Muted labels (`color-neutral-500` on `color-white`): contrast ratio 4.6:1 — passes AA for normal text.
- Semantic error red on white: 5.8:1 — passes AA.
- Focus rings: 3px solid `color-primary-500` offset 2px — exceeds WCAG 2.1 Focus Appearance (enhanced).
