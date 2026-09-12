# Shared UI system

## Problem

Web already owned five shadcn primitives while Studio repeated native controls
and a separate token vocabulary. A second real consumer makes app-local copies
the wrong ownership boundary. The migration must unify primitives and palette
without moving product behavior or Cloudflare runtime concerns into a library.

## Caller view

Applications import one explicit component at a time and one shared stylesheet.

```tsx
import { Button } from '@yatb/ui/button'
import { Card } from '@yatb/ui/card'
import { Dialog, DialogContent } from '@yatb/ui/dialog'
```

```css
@import '@yatb/ui/styles.css';

@source './';
```

Routes keep ownership of auth, planning, media, and navigation. They compose
shared controls without exposing those product concepts to `@yatb/ui`.

## Shape

`packages/ui` distributes owned TypeScript source. It exposes explicit
component subpaths, shared CSS, and the shadcn class-merging utility. Vite
compiles the same source into both TanStack Start Workers, so no package build
or publishing step exists.

The package owns new-york shadcn source on unified Radix, Geist fonts, focus
behavior, component variants, and zero-chroma light and dark tokens. App CSS
owns layout and product composition. Studio keeps its pre-paint theme script and
light, dark, and system preference because preference is application state, not
a primitive concern.

The component inventory follows current callers. It includes Accordion, Alert,
AlertDialog, Badge, Button, Card, Dialog, DropdownMenu, Input, Label, Progress,
ScrollArea, Select, Separator, Sheet, Sidebar, Slider, Skeleton, and Tooltip.
Table, Tabs, and other unused components stay out of the public surface.

## Synthesis decision

Both independent designs selected a source-only workspace with explicit
subpath exports, package-owned tokens, unified Radix, and no framework adapter.
The second design is the base because it leaves theme state in Studio and keeps
the public interface smaller. The first design contributed matching shadcn
configuration in every consumer and an explicit emitted-CSS palette check.
Dialog was added to the shared inventory because saved views and rich links had
real browser-prompt callers.

## Tradeoffs accepted

- Source distribution recompiles a small primitive set in each app in exchange
  for eliminating a package release pipeline.
- One palette increases the blast radius of token changes in exchange for one
  monochrome product language.
- Radix Select gives every application the same keyboard and visual behavior in
  exchange for replacing platform-native mobile picker presentation.
- Destructive actions use border weight, copy, iconography, and confirmation in
  exchange for keeping the palette strictly black and white.

## Alternatives rejected

- Separate shadcn copies expose duplicated tokens and upgrade work to every app.
- A root barrel hides component-level dependencies and grows an accidental API.
- Shared page shells couple the package to Studio and Web product behavior.
- A compiled library adds a build and version boundary with no external
  consumer.
- Base UI changes composition semantics during a package extraction without
  improving the product.
- Installing the entire registry creates unused source and dependencies.

## Risks

- Tailwind must scan package source in both Worker builds.
- Radix portals must inherit monochrome tokens and visible focus styles.
- Studio layout CSS must not override primitive disabled, focus, or selected
  behavior.
- Dialog focus movement must preserve rich-editor selections before a link is
  applied.

The ownership and emitted-palette scripts make the first three risks
deterministic build failures. Direct browser proof covers portal focus, theme
persistence, rich-link selection, responsive Sidebar behavior, and media controls.
