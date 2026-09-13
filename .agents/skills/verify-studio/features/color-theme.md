# Color theme

The color theme control applies a black-and-white light, dark, or system theme on public and private pages.

## Sub-features

- `theme-light` applies the light palette.
- `theme-dark` applies the dark palette.
- `theme-system` follows the browser preference.
- `theme-persist` restores an explicit choice before the page paints.
- `theme-sidebar` inverts the public brand panel and authenticated sidebar
  between a light surface with dark text and a dark surface with light text.

## How to get to it (user POV)

- Open `/` and use `Color theme` beside the Studio wordmark.
- Sign in and use `Color theme` in the Studio sidebar.

## Driving it with Codex computer control

Preconditions:

- Studio passes the doctor.
- The browser can inspect the HTML `data-theme` attribute and local storage.

- **Choose dark.** Select `Dark` from `Color theme`. The page uses only
  grayscale colors except the exact yellow review-marker token, the HTML theme
  is `dark`, and local storage contains `dark`. Confirm that the public brand
  panel and authenticated sidebar have a dark computed background with light
  computed text.
- **Reload.** Reload the page. The palette never flashes light, and the control shows `Dark` after hydration.
- **Choose light.** Select `Light`. The HTML theme and stored value change to
  `light`. Confirm that the public brand panel and authenticated sidebar have a
  light computed background with dark computed text.
- **Follow system.** Select `System`. Change the browser color preference and confirm the page follows it without another selection.
- **Use the shell.** Sign in and repeat light and dark selection from the sidebar. The login page retains the last choice after sign out.
- **Use the keyboard.** Focus `Color theme` with the keyboard, open it with Space, change the value with Arrow keys, and press Enter. A visible focus outline remains around the trigger.
- **Proof.** Capture the login and shell in light and dark modes. Record the
  HTML attribute and stored value with each screenshot. Run the production
  build to reject non-grayscale literal colors except the exact review-marker
  token in the authored and emitted CSS.

## Gotchas

- The server does not know a browser preference. The inline head script applies the stored value before CSS loads.
- `System` stores `system`; CSS media queries resolve the visible palette.
