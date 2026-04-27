# Design Language: Watch Free Hentai Video Streams Online in 720p, 1080p HD - hanime.tv

> Extracted from `https://hanime.tv/home` on April 26, 2026
> 2016 elements analyzed

This document describes the complete design language of the website. It is structured for AI/LLM consumption — use it to faithfully recreate the visual design in any framework.

## Color Palette

### Primary Colors

| Role | Hex | RGB | HSL | Usage Count |
|------|-----|-----|-----|-------------|
| Primary | `#f3c669` | rgb(243, 198, 105) | hsl(40, 85%, 68%) | 46 |

### Neutral Colors

| Hex | HSL | Usage Count |
|-----|-----|-------------|
| `#ffffff` | hsl(0, 0%, 100%) | 3832 |
| `#424242` | hsl(0, 0%, 26%) | 109 |
| `#000000` | hsl(0, 0%, 0%) | 103 |
| `#eeeeee` | hsl(0, 0%, 93%) | 28 |
| `#17181a` | hsl(220, 6%, 10%) | 13 |
| `#757575` | hsl(0, 0%, 46%) | 9 |
| `#303030` | hsl(0, 0%, 19%) | 7 |
| `#939496` | hsl(220, 1%, 58%) | 4 |
| `#bdbdbd` | hsl(0, 0%, 74%) | 2 |
| `#212121` | hsl(0, 0%, 13%) | 2 |

### Background Colors

Used on large-area elements: `#303030`, `#424242`, `#17181a`, `#212121`

### Text Colors

Text color palette: `#000000`, `#ffffff`, `#757575`, `#f3c669`, `#bdbdbd`, `#eeeeee`

### Gradients

```css
background-image: linear-gradient(rgb(48, 48, 48) 0%, rgb(48, 48, 48) 60%, rgba(48, 48, 48, 0) 100%);
```

```css
background-image: linear-gradient(rgba(48, 48, 48, 0) 0%, rgb(48, 48, 48) 100%);
```

```css
background-image: linear-gradient(45deg, rgb(169, 36, 85) 1%, rgb(221, 67, 124) 54%, rgb(244, 100, 154) 97%);
```

```css
background-image: radial-gradient(farthest-side at 50% 0px, rgba(48, 48, 48, 0) 0%, rgba(48, 48, 48, 0) 80%, rgb(48, 48, 48) 94%);
```

```css
background-image: linear-gradient(rgba(0, 0, 0, 0) 0%, rgb(33, 33, 33) 100%);
```

### Full Color Inventory

| Hex | Contexts | Count |
|-----|----------|-------|
| `#ffffff` | text, border, background | 3832 |
| `#424242` | background, border | 109 |
| `#000000` | text, border | 103 |
| `#f3c669` | background, border, text | 46 |
| `#eeeeee` | text, border | 28 |
| `#17181a` | background, border | 13 |
| `#757575` | text, border | 9 |
| `#303030` | background | 7 |
| `#939496` | border | 4 |
| `#bdbdbd` | text, border | 2 |
| `#212121` | background | 2 |

## Typography

### Font Families

- **Whitney** — used for all (1978 elements)
- **Times New Roman** — used for body (38 elements)

### Type Scale

| Size (px) | Size (rem) | Weight | Line Height | Letter Spacing | Used On |
|-----------|------------|--------|-------------|----------------|---------|
| 51.2px | 3.2rem | 300 | 57.6px | normal | h1 |
| 32px | 2rem | 300 | 48px | normal | div, span, i |
| 27px | 1.6875rem | 500 | 40px | normal | h2, span |
| 26.88px | 1.68rem | 400 | 40.32px | normal | div |
| 24px | 1.5rem | 400 | 24px | normal | i |
| 23.04px | 1.44rem | 500 | 34.56px | normal | div |
| 19.2px | 1.2rem | 300 | 25.6px | normal | span, div |
| 18px | 1.125rem | 500 | 30px | normal | div, p, span, a |
| 17.5px | 1.0938rem | 500 | 26.25px | normal | a, div, span, button |
| 17px | 1.0625rem | 400 | 25.5px | normal | div, i |
| 16.8px | 1.05rem | 300 | 25.2px | normal | span |
| 16.64px | 1.04rem | 400 | 24.96px | normal | div |
| 16px | 1rem | 400 | 24px | normal | a, div, label, input |
| 15px | 0.9375rem | 500 | 22.5px | normal | button, div |
| 14px | 0.875rem | 400 | normal | normal | html, head, meta, style |

### Heading Scale

```css
h1 { font-size: 51.2px; font-weight: 300; line-height: 57.6px; }
h2 { font-size: 27px; font-weight: 500; line-height: 40px; }
h4 { font-size: 14px; font-weight: 400; line-height: normal; }
```

### Body Text

```css
body { font-size: 14px; font-weight: 400; line-height: normal; }
```

### Font Weights in Use

`400` (1870x), `500` (108x), `300` (33x), `700` (5x)

## Spacing

**Base unit:** 2px

| Token | Value | Rem |
|-------|-------|-----|
| spacing-1 | 1px | 0.0625rem |
| spacing-24 | 24px | 1.5rem |
| spacing-48 | 48px | 3rem |
| spacing-80 | 80px | 5rem |
| spacing-96 | 96px | 6rem |
| spacing-120 | 120px | 7.5rem |
| spacing-165 | 165px | 10.3125rem |
| spacing-220 | 220px | 13.75rem |
| spacing-384 | 384px | 24rem |

## Border Radii

| Label | Value | Count |
|-------|-------|-------|
| xs | 2px | 251 |
| full | 50px | 4 |

## Box Shadows

**sm** — blur: 0px
```css
box-shadow: rgba(0, 0, 0, 0.2) 0px 0px 0px 0px, rgba(0, 0, 0, 0.14) 0px 0px 0px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px;
```

**sm** — blur: 1px
```css
box-shadow: rgba(0, 0, 0, 0.2) 0px 3px 1px -2px, rgba(0, 0, 0, 0.14) 0px 2px 2px 0px, rgba(0, 0, 0, 0.12) 0px 1px 5px 0px;
```

**sm** — blur: 3px
```css
box-shadow: rgba(0, 0, 0, 0.2) 0px 3px 3px -2px, rgba(0, 0, 0, 0.14) 0px 3px 4px 0px, rgba(0, 0, 0, 0.12) 0px 1px 8px 0px;
```

**md** — blur: 5px
```css
box-shadow: rgba(0, 0, 0, 0.2) 0px 5px 5px -3px, rgba(0, 0, 0, 0.14) 0px 8px 10px 1px, rgba(0, 0, 0, 0.12) 0px 3px 14px 2px;
```

**lg** — blur: 15px
```css
box-shadow: rgba(0, 0, 0, 0.2) 0px 11px 15px -7px, rgba(0, 0, 0, 0.14) 0px 24px 38px 3px, rgba(0, 0, 0, 0.12) 0px 9px 46px 8px;
```

## CSS Custom Properties

### Colors

```css
--primary: #f3c669;
```

### Semantic

```css
success: [object Object];
warning: [object Object];
error: [object Object];
info: [object Object];
```

## Breakpoints

| Name | Value | Type |
|------|-------|------|
| xs | 360px | min-width |
| 400px | 400px | min-width |
| sm | 450px | min-width |
| sm | 466px | min-width |
| sm | 493px | min-width |
| sm | 500px | min-width |
| sm | 599px | max-width |
| sm | 600px | min-width |
| sm | 651px | min-width |
| md | 736px | min-width |
| md | 768px | min-width |
| md | 800px | min-width |
| md | 820px | min-width |
| 951px | 951px | min-width |
| 959px | 959px | max-width |
| lg | 960px | min-width |
| lg | 1057px | min-width |
| lg | 1069px | min-width |
| 1100px | 1100px | min-width |
| 1104px | 1104px | max-width |
| 1105px | 1105px | min-width |
| 1200px | 1200px | min-width |
| 1201px | 1201px | min-width |
| xl | 1263px | max-width |
| xl | 1264px | min-width |
| xl | 1327px | min-width |
| 1400px | 1400px | min-width |
| 1440px | 1440px | min-width |
| 2xl | 1500px | min-width |
| 1754px | 1754px | min-width |
| 1903px | 1903px | max-width |
| 1904px | 1904px | min-width |

## Transitions & Animations

**Easing functions:** `[object Object]`, `[object Object]`, `[object Object]`, `[object Object]`, `[object Object]`

**Durations:** `0.3s`, `0.001s`, `0.2s`, `0.4s`

### Common Transitions

```css
transition: all;
transition: 0.3s ease-in-out;
transition: height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
transition: 0.3s cubic-bezier(0.25, 0.8, 0.5, 1);
transition: 0.3s cubic-bezier(0.25, 0.8, 0.5, 1), color 0.001s;
transition: background 0.2s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), border 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-bottom 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-bottom-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-bottom-width 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-left 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-left-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-left-width 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-right 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-right-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-right-width 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-top 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-top-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-top-width 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-width 0.2s cubic-bezier(0.4, 0, 0.2, 1), bottom 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1), color 0.2s cubic-bezier(0.4, 0, 0.2, 1), height 0.2s cubic-bezier(0.4, 0, 0.2, 1), left 0.2s cubic-bezier(0.4, 0, 0.2, 1), margin 0.2s cubic-bezier(0.4, 0, 0.2, 1), margin-bottom 0.2s cubic-bezier(0.4, 0, 0.2, 1), margin-left 0.2s cubic-bezier(0.4, 0, 0.2, 1), margin-right 0.2s cubic-bezier(0.4, 0, 0.2, 1), margin-top 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.2s cubic-bezier(0.4, 0, 0.2, 1), min-height 0.2s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), padding 0.2s cubic-bezier(0.4, 0, 0.2, 1), padding-bottom 0.2s cubic-bezier(0.4, 0, 0.2, 1), padding-left 0.2s cubic-bezier(0.4, 0, 0.2, 1), padding-right 0.2s cubic-bezier(0.4, 0, 0.2, 1), padding-top 0.2s cubic-bezier(0.4, 0, 0.2, 1), right 0.2s cubic-bezier(0.4, 0, 0.2, 1), top 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform-origin 0.2s cubic-bezier(0.4, 0, 0.2, 1), width 0.2s cubic-bezier(0.4, 0, 0.2, 1), -webkit-transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), -webkit-transform-origin 0.2s cubic-bezier(0.4, 0, 0.2, 1);
transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
transition: 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
transition: box-shadow 0.3s cubic-bezier(0.25, 0.8, 0.5, 1);
transition: 0.3s;
```

### Keyframe Animations

**spinning**
```css
@keyframes spinning {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
```

**pulsing**
```css
@keyframes pulsing {
  50% { opacity: 0; }
}
```

**onAutoFillStart**
```css
@keyframes onAutoFillStart {
  0% {  }
  100% {  }
}
```

**onAutoFillCancel**
```css
@keyframes onAutoFillCancel {
  0% {  }
  100% {  }
}
```

## Component Patterns

Detected UI component patterns and their most common styles:

### Buttons (23 instances)

```css
.button {
  background-color: rgba(255, 255, 255, 0.12);
  color: rgb(255, 255, 255);
  font-size: 15px;
  font-weight: 500;
  padding-top: 0px;
  padding-right: 0px;
  border-radius: 2px;
}
```

### Cards (196 instances)

```css
.card {
  background-color: rgb(66, 66, 66);
  border-radius: 2px;
  box-shadow: rgba(0, 0, 0, 0.2) 0px 3px 3px -2px, rgba(0, 0, 0, 0.14) 0px 3px 4px 0px, rgba(0, 0, 0, 0.12) 0px 1px 8px 0px;
  padding-top: 0px;
  padding-right: 0px;
}
```

### Inputs (1 instances)

```css
.input {
  color: rgba(255, 255, 255, 0.6);
  border-color: rgb(118, 118, 118);
  border-radius: 0px;
  font-size: 16px;
  padding-top: 0px;
  padding-right: 0px;
}
```

### Links (147 instances)

```css
.link {
  color: rgb(255, 255, 255);
  font-size: 14px;
  font-weight: 400;
}
```

### Navigation (43 instances)

```css
.navigatio {
  background-color: rgba(255, 255, 255, 0.12);
  color: rgb(255, 255, 255);
  padding-top: 0px;
  padding-bottom: 0px;
  padding-left: 0px;
  padding-right: 0px;
  position: static;
  box-shadow: rgba(0, 0, 0, 0.2) 0px 0px 0px 0px, rgba(0, 0, 0, 0.14) 0px 0px 0px 0px, rgba(0, 0, 0, 0.12) 0px 0px 0px 0px;
}
```

### Footer (56 instances)

```css
.foote {
  background-color: rgb(23, 24, 26);
  color: rgb(255, 255, 255);
  padding-top: 0px;
  padding-bottom: 0px;
  font-size: 14px;
}
```

### Modals (6 instances)

```css
.modal {
  background-color: rgb(48, 48, 48);
  border-radius: 0px;
  box-shadow: rgba(0, 0, 0, 0.2) 0px 11px 15px -7px, rgba(0, 0, 0, 0.14) 0px 24px 38px 3px, rgba(0, 0, 0, 0.12) 0px 9px 46px 8px;
  padding-top: 0px;
  padding-right: 0px;
  max-width: 600px;
}
```

### Dropdowns (3 instances)

```css
.dropdown {
  background-color: rgb(48, 48, 48);
  border-radius: 2px;
  box-shadow: rgba(0, 0, 0, 0.2) 0px 5px 5px -3px, rgba(0, 0, 0, 0.14) 0px 8px 10px 1px, rgba(0, 0, 0, 0.12) 0px 3px 14px 2px;
  border-color: rgb(255, 255, 255);
  padding-top: 0px;
}
```

### Switches (1 instances)

```css
.switche {
  border-radius: 50%;
  border-color: rgb(0, 0, 0);
}
```

## Component Clusters

Reusable component instances grouped by DOM structure and style similarity:

### Button — 19 instances, 2 variants

**Variant 1** (15 instances)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(255, 255, 255);
  padding: 0px 0px 0px 0px;
  border-radius: 50%;
  border: 0px none rgb(0, 0, 0);
  font-size: 15px;
  font-weight: 500;
```

**Variant 2** (4 instances)

```css
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.3);
  padding: 0px 0px 0px 0px;
  border-radius: 2px;
  border: 2px 1px 2px 2px solid rgba(58, 60, 63, 0.7);
  font-size: 15px;
  font-weight: 500;
```

### Button — 1 instance, 1 variant

**Variant 1** (1 instance)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(255, 255, 255);
  padding: 0px 0px 0px 0px;
  border-radius: 2px;
  border: 0px none rgb(255, 255, 255);
  font-size: 17.5px;
  font-weight: 500;
```

### Card — 1 instance, 1 variant

**Variant 1** (1 instance)

```css
  background: rgba(255, 255, 255, 0.1);
  color: rgba(0, 0, 0, 0.87);
  padding: 0px 0px 0px 0px;
  border-radius: 2px;
  border: 0px none rgba(0, 0, 0, 0.87);
  font-size: 14px;
  font-weight: 400;
```

### Input — 1 instance, 1 variant

**Variant 1** (1 instance)

```css
  background: rgba(0, 0, 0, 0);
  color: rgba(255, 255, 255, 0.6);
  padding: 0px 0px 1px 0px;
  border-radius: 0px;
  border: 0px none rgb(118, 118, 118);
  font-size: 16px;
  font-weight: 400;
```

### Card — 96 instances, 1 variant

**Variant 1** (96 instances)

```css
  background: rgb(66, 66, 66);
  color: rgb(255, 255, 255);
  padding: 0px 0px 0px 0px;
  border-radius: 2px;
  border: 0px none rgb(255, 255, 255);
  font-size: 14px;
  font-weight: 400;
```

### Card — 96 instances, 1 variant

**Variant 1** (96 instances)

```css
  background: rgba(0, 0, 0, 0);
  color: rgb(255, 255, 255);
  padding: 12px 12px 12px 12px;
  border-radius: 0px;
  border: 0px none rgb(255, 255, 255);
  font-size: 16px;
  font-weight: 400;
```

## Layout System

**0 grid containers** and **464 flex containers** detected.

### Container Widths

| Max Width | Padding |
|-----------|---------|
| 100% | 0px |
| 1720px | 0px |
| 740px | 16px |
| 1040px | 0px |

### Flex Patterns

| Direction/Wrap | Count |
|----------------|-------|
| row/nowrap | 235x |
| column/nowrap | 127x |
| row/wrap | 102x |

## Accessibility (WCAG 2.1)

**Overall Score: 100%** — 0 passing, 0 failing color pairs

## Design System Score

**Overall: 86/100 (Grade: B)**

| Category | Score |
|----------|-------|
| Color Discipline | 100/100 |
| Typography Consistency | 82/100 |
| Spacing System | 85/100 |
| Shadow Consistency | 100/100 |
| Border Radius Consistency | 100/100 |
| Accessibility | 100/100 |
| CSS Tokenization | 50/100 |

**Strengths:** Tight, disciplined color palette, Well-defined spacing scale, Clean elevation system, Consistent border radii, Strong accessibility compliance

**Issues:**
- 1540 !important rules — prefer specificity over overrides
- 93% of CSS is unused — consider purging
- 6547 duplicate CSS declarations

## Gradients

**5 unique gradients** detected.

| Type | Direction | Stops | Classification |
|------|-----------|-------|----------------|
| linear | — | 3 | bold |
| linear | — | 2 | brand |
| linear | 45deg | 3 | bold |
| radial | — | 4 | bold |
| linear | — | 2 | brand |

```css
background: linear-gradient(rgb(48, 48, 48) 0%, rgb(48, 48, 48) 60%, rgba(48, 48, 48, 0) 100%);
background: linear-gradient(rgba(48, 48, 48, 0) 0%, rgb(48, 48, 48) 100%);
background: linear-gradient(45deg, rgb(169, 36, 85) 1%, rgb(221, 67, 124) 54%, rgb(244, 100, 154) 97%);
background: radial-gradient(farthest-side at 50% 0px, rgba(48, 48, 48, 0) 0%, rgba(48, 48, 48, 0) 80%, rgb(48, 48, 48) 94%);
background: linear-gradient(rgba(0, 0, 0, 0) 0%, rgb(33, 33, 33) 100%);
```

## Z-Index Map

**8 unique z-index values** across 3 layers.

| Layer | Range | Elements |
|-------|-------|----------|
| dropdown | 100,100 | nav.t.o.o.l.b.a.r. .t.o.o.l.b.a.r.-.-.f.i.x.e.d. .t.r.a.n.s.p.a.r.e.n.t. .e.l.e.v.a.t.i.o.n.-.0 |
| sticky | 90,90 | aside.n.a.v.i.g.a.t.i.o.n.-.d.r.a.w.e.r. .n.a.v.i.g.a.t.i.o.n.-.d.r.a.w.e.r.-.-.c.l.o.s.e. .n.a.v.i.g.a.t.i.o.n.-.d.r.a.w.e.r.-.-.f.i.x.e.d. .n.a.v.i.g.a.t.i.o.n.-.d.r.a.w.e.r.-.-.f.l.o.a.t.i.n.g. .n.a.v.i.g.a.t.i.o.n.-.d.r.a.w.e.r.-.-.t.e.m.p.o.r.a.r.y |
| base | -1,4 | div.s.i.m.p.l.e.b.a.r.-.h.e.i.g.h.t.-.a.u.t.o.-.o.b.s.e.r.v.e.r.-.w.r.a.p.p.e.r, div.s.i.m.p.l.e.b.a.r.-.h.e.i.g.h.t.-.a.u.t.o.-.o.b.s.e.r.v.e.r, div.s.i.m.p.l.e.b.a.r.-.h.e.i.g.h.t.-.a.u.t.o.-.o.b.s.e.r.v.e.r.-.w.r.a.p.p.e.r |

## Font Files

| Family | Source | Weights | Styles |
|--------|--------|---------|--------|
| Whitney | self-hosted | 300, 400, 500, 600, 700 | normal |
| Material Design Icons | self-hosted | normal | normal |

## Image Style Patterns

| Pattern | Count | Key Styles |
|---------|-------|------------|
| general | 7 | objectFit: fill, borderRadius: 2px 2px 0px 0px, shape: rounded |
| gallery | 1 | objectFit: fill, borderRadius: 0px, shape: square |
| thumbnail | 1 | objectFit: fill, borderRadius: 0px, shape: square |

**Aspect ratios:** 2:3 (7x), 2.04:1 (1x), 1:1 (1x)

## Motion Language

**Feel:** responsive · **Scroll-linked:** yes

### Duration Tokens

| name | value | ms |
|---|---|---|
| `instant` | `1ms` | 1 |
| `sm` | `200ms` | 200 |
| `md` | `300ms` | 300 |

### Easing Families

- **ease-in-out** (4 uses) — `ease`
- **custom** (28 uses) — `cubic-bezier(0.4, 0, 0.2, 1)`, `cubic-bezier(0.5, 0, 0.1, 1)`
- **ease-out** (225 uses) — `cubic-bezier(0.25, 0.8, 0.5, 1)`, `cubic-bezier(0.25, 0.8, 0.25, 1)`

## Component Anatomy

### card — 193 instances

**Slots:** description

### button — 20 instances

**Slots:** label
**Variants:** outline
**Sizes:** large · sm

| variant | count | sample label |
|---|---|---|
| outline | 16 | ALL |
| default | 4 | hanime
.
tv |

## Brand Voice

**Tone:** friendly · **Pronoun:** you-only · **Headings:** Title Case (balanced)

### Top CTA Verbs

- **close** (4)
- **all** (3)
- **hanime** (1)
- **sign** (1)
- **create** (1)

### Button Copy Patterns

- "close ad" (4×)
- "all" (3×)
- "hanime
.
tv" (1×)
- "sign in" (1×)
- "create account" (1×)

### Sample Headings

> Watch Free HD Hentai & Anime Videos

## Page Intent

**Type:** `legal` (confidence 0.26)
**Description:** Watch hentai online free download HD on mobile phone tablet laptop desktop.  Stream online, regularly released uncensored, subbed, in 720p and 1080p!

Alternates: blog-post (0.35)

## Section Roles

Reading order (top→bottom): nav → nav → hero → footer

| # | Role | Heading | Confidence |
|---|------|---------|------------|
| 0 | nav | — | 0.9 |
| 1 | nav | — | 0.9 |
| 2 | hero | Watch Free HD Hentai & Anime Videos | 0.85 |
| 3 | footer | — | 0.95 |

## Material Language

**Label:** `flat` (confidence 0)

| Metric | Value |
|--------|-------|
| Avg saturation | 0.064 |
| Shadow profile | soft |
| Avg shadow blur | 0px |
| Max radius | 50px |
| backdrop-filter in use | no |
| Gradients | 5 |

## Imagery Style

**Label:** `photography` (confidence 0.556)
**Counts:** total 9, svg 0, icon 1, screenshot-like 0, photo-like 8
**Dominant aspect:** portrait
**Radius profile on images:** square

## Component Screenshots

14 retina crops written to `screenshots/`. Index: `*-screenshots.json`.

| Cluster | Variant | Size (px) | File |
|---------|---------|-----------|------|
| button--default--large | 0 | 44 × 44 | `screenshots/button-default-large-0.png` |
| button--default--large | 1 | 136 × 44 | `screenshots/button-default-large-1.png` |
| button--default--large | 2 | 123 × 44 | `screenshots/button-default-large-2.png` |
| card--default | 0 | 384 × 40 | `screenshots/card-default-0.png` |
| card--default | 1 | 264 × 496 | `screenshots/card-default-1.png` |
| card--default | 2 | 264 × 108 | `screenshots/card-default-2.png` |
| input--default | 0 | 384 × 40 | `screenshots/input-default-0.png` |
| button--default--sm | 0 | 209 × 44 | `screenshots/button-default-sm-0.png` |
| button--outline--large | 0 | 92 × 44 | `screenshots/button-outline-large-0.png` |
| button--outline--large | 1 | 88 × 44 | `screenshots/button-outline-large-1.png` |
| button--outline--large | 2 | 88 × 44 | `screenshots/button-outline-large-2.png` |
| button--outline | 0 | 128 × 36 | `screenshots/button-outline-0.png` |
| button--outline | 1 | 128 × 36 | `screenshots/button-outline-1.png` |
| button--outline | 2 | 128 × 36 | `screenshots/button-outline-2.png` |

Full-page: `screenshots/full-page.png`

## Quick Start

To recreate this design in a new project:

1. **Install fonts:** Add `Whitney` from Google Fonts or your font provider
2. **Import CSS variables:** Copy `variables.css` into your project
3. **Tailwind users:** Use the generated `tailwind.config.js` to extend your theme
4. **Design tokens:** Import `design-tokens.json` for tooling integration
