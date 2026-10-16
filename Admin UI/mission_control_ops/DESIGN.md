---
name: Mission Control Ops
colors:
  surface: '#0c1324'
  surface-dim: '#0c1324'
  surface-bright: '#33394c'
  surface-container-lowest: '#070d1f'
  surface-container-low: '#151b2d'
  surface-container: '#191f31'
  surface-container-high: '#23293c'
  surface-container-highest: '#2e3447'
  on-surface: '#dce1fb'
  on-surface-variant: '#bcc9cd'
  inverse-surface: '#dce1fb'
  inverse-on-surface: '#2a3043'
  outline: '#869397'
  outline-variant: '#3d494c'
  surface-tint: '#4cd7f6'
  primary: '#4cd7f6'
  on-primary: '#003640'
  primary-container: '#06b6d4'
  on-primary-container: '#00424f'
  inverse-primary: '#00687a'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#ffb95f'
  on-tertiary: '#472a00'
  tertiary-container: '#e79400'
  on-tertiary-container: '#563400'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#acedff'
  primary-fixed-dim: '#4cd7f6'
  on-primary-fixed: '#001f26'
  on-primary-fixed-variant: '#004e5c'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#0c1324'
  on-background: '#dce1fb'
  surface-variant: '#2e3447'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 2rem
    fontWeight: '700'
    lineHeight: 2.5rem
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 2rem
    letterSpacing: -0.02em
  headline-sm:
    fontFamily: Inter
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 0.9375rem
    fontWeight: '400'
    lineHeight: 1.375rem
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
    letterSpacing: 0.01em
  label-code-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1.125rem
    letterSpacing: -0.01em
  label-code-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 0.875rem
    letterSpacing: 0.02em
  label-ui:
    fontFamily: Inter
    fontSize: 0.6875rem
    fontWeight: '600'
    lineHeight: 0.875rem
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-lg: 1rem
  margin: 1rem
  margin-lg: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.375rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system embodies the high-tempo discipline of aerospace telemetry combined with mission-critical logistics supervision. Built for operations controllers, security analysts, and logistics dispatch engineers, the interface prioritizes immediate clarity, tactical precision, and dense data scanning.

The visual style merges dark-mode technical minimalism with high-precision instrument design. Surfaces rely on structured midnight and deep slate tiers, punctuated by luminescent status accents. The visual hierarchy enforces spatial economy: low noise, zero superfluous ornamentation, crisp dividing lines, and distinct optical hierarchy designed to eliminate cognitive latency during urgent remediation, fleet-wide escalations, and incident tracking.

## Colors

The palette operates under a high-contrast dark schema optimized for 24/7 command center visibility:

- **Primary (`#06B6D4` - Cyan)**: Represents active operations, system routing, primary key actions, active focus states, and telemetry data pings.
- **Secondary (`#10B981` - Emerald)**: Signifies operational health, authenticated states, verified drivers/haulers, and confirmed throughput.
- **Tertiary (`#F59E0B` - Amber)**: Dictates rate-limiting warnings, pending verification, simulated overrides, and non-blocking security alerts.
- **Accent Danger (`#F43F5E` - Rose)**: Reserved strictly for critical anomalies, account blocks, security telemetry breaches, and unauthorized geospatial discrepancies.
- **Surfaces & Tiers**:
  - Canvas Base: `#020617` (Deep Obsidian Slate)
  - Surface Container Low: `#0F172A` (Slate 900)
  - Surface Container Normal: `#1E293B` (Slate 800)
  - Surface Interactive / Borders: `#334155` (Slate 700)
- **Text & Foreground**:
  - Primary Content: `#F8FAFC` (Slate 50)
  - Secondary Content / Metadata: `#94A3B8` (Slate 400)
  - Muted / Disabled: `#64748B` (Slate 500)

## Typography

The type system balances quick alphanumeric pattern recognition with scanning efficiency across complex tables:

- **Inter** handles all narrative context, interface controls, navigation items, column headers, and structural section headers. It ensures clean rendering even at compact sizes (`11px` - `13px`).
- **JetBrains Mono** is assigned to structured machine artifacts: transaction hashes, session tokens, vehicle identification numbers (VINs), driver UUIDs, API paths, IP telemetry, and GPS coordinates.
- **Micro-Labels**: Metric units and uppercase technical labels leverage expanded tracking (`0.05em`) to preserve legibility in dense clusters.

## Layout & Spacing

A compact 12-column layout maximized for horizontal screen real estate (1440px to 2560px ultra-wide consoles) anchors the grid:

- **Density & Cadence**: Uses a base 4px/8px micro-grid. Component padding scales tightly (`space-xs` through `space-md`) to ensure critical telemetry remains above the fold without requiring excessive scrolling.
- **Fluid Multi-pane Structure**:
  - Global Navigation Sidebar: Fixed 240px (collapsible to 64px icon-only mode).
  - Main Telemetry Grid: Fluid 12-column grid utilizing `0.75rem` (`12px`) gutters on desktop and `1rem` on widescreen displays.
  - Drilldown / Action Drawer: Contextual sliding rail of 420px for entity auditing and inspection.
- **Breakpoints**:
  - Large Console (`>1440px`): Full visual telemetry, side-by-side log streaming, and persistence drawers.
  - Standard Ops (`1024px` - `1439px`): Priority metric widgets stack to 2-column or 3-column modules.
  - Mobile Field Inspection (`<1024px`): Single-column stacked overview; horizontal tables convert into interactive record cards.

## Elevation & Depth

Visual hierarchy does not use blur-heavy drop shadows. Instead, it relies on tonal stacking and structural outlines:

- **Level 0 (Canvas)**: `#020617` background.
- **Level 1 (Panels & Card Modules)**: `#0F172A` with a 1px solid border of `#1E293B`.
- **Level 2 (Hovered / Active / Nested Modules)**: `#1E293B` with border `#334155`.
- **Level 3 (Overlays, Flyouts & Modals)**: `#0F172A` surrounded by a dual outline: a 1px solid `#334155` border reinforced by a subtle directional glow:
  - Critical modals: `0 0 16px -2px rgba(244, 63, 94, 0.25)`
  - Active inspection drawers: `0 0 16px -2px rgba(6, 182, 212, 0.2)`
- **Divider Treatment**: All module borders and column dividers utilize hairline `1px` borders (`#1E293B` or `#334155`) to construct modular instrument enclosures.

## Shapes

The design system enforces a precision, calibrated geometric profile using soft-cornered micro radii (`roundedness: 1`):

- **Data Tables, Cards, Panels**: `0.25rem` (`4px`) corner radius to preserve architectural structure.
- **Action Buttons & Form Inputs**: `0.25rem` (`4px`) corner radius to create an engineered, tactile feel.
- **Telemetry Indicators & Badges**: Fully rounded pills (`9999px`) to create clear visual contrast against the surrounding sharp rectangular data grids.

## Components

### Buttons
- **Primary Action**: Cyan background (`#06B6D4`), dark slate text (`#020617`), weight 600. On hover: `#22D3EE` with a subtle `0 0 10px rgba(6, 182, 212, 0.4)` glow.
- **Secondary Action**: `#1E293B` fill, `#F8FAFC` text, 1px border `#334155`. Hover: `#334155` fill with `#64748B` border.
- **Destructive Action**: `#F43F5E` fill with white text, or ghost outline with `#F43F5E` border and hover flood fill.
- **Button Sizing**: Compact 32px standard height (padding: `0.375rem 0.75rem`) with 12px/13px Inter text.

### Status Pills & Badges
- Pill shape (`rounded-full`), padded `0.125rem 0.5rem`, tracking label font.
- **Active / Verified**: `#064E3B` surface, `#34D399` text, 1px `#059669` border.
- **Blocked / Incident**: `#4C0519` surface, `#FB7185` text, 1px `#E11D48` border.
- **Suspended / Warning**: `#451A03` surface, `#FBBF24` text, 1px `#D97706` border.
- **Simulation / Sandbox**: `#172554` surface, `#60A5FA` text, 1px `#2563EB` border.
- Optional 6px pulsing dot indicator prepended to live connection states.

### Data Tables
- Header row: `#0F172A` background, uppercase 11px Inter font, `#64748B` text, 1px bottom border `#1E293B`.
- Row cells: Height fixed at 38px (compact) or 48px (detailed). Row divider 1px `#0F172A`.
- Monospace formatting applied automatically to UUIDs, coordinates, timestamps, and plates.
- Row hover: `#1E293B / 50%` tint with a 2px left border accent in `#06B6D4`.

### Form Inputs & Telemetry Filters
- Input box: `#0B1120` inset surface, 1px border `#1E293B`, `#F8FAFC` text.
- Focus state: Border color changes to `#06B6D4`, with an inner hairline glow.
- Embedded trailing key shortcuts (e.g., `⌘K`) rendered in JetBrains Mono at 10px.

### Cards & Telemetry Panels
- Enclosed modules with explicit 1px slate borders, an internal header containing action icons, and an integrated status LED in the top corner.
- Metric display panels feature 24px/32px Inter tabular values paired with 11px JetBrains Mono delta indicators (`+4.2% / 15m`).