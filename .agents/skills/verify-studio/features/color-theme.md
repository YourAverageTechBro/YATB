# Color theme

The color theme control applies a black-and-white light, dark, or system theme on public and private pages.

## Sub-features

- `theme-light` applies the light palette.
- `theme-dark` applies the dark palette.
- `theme-system` follows the browser preference.
- `theme-persist` restores an explicit choice before the page paints.

## How to get to it (user POV)

- Open `/` and use `Color theme` beside the Studio wordmark.
- Sign in and use `Color theme` in the Studio sidebar.

## Driving it with Codex computer control

Preconditions:

- Studio passes the doctor.
- The browser can inspect the HTML `data-theme` attribute and local storage.

- **Choose dark.** Select `Dark` from `Color theme`. The page uses only grayscale colors, the HTML theme is `dark`, and local storage contains `dark`.
- **Reload.** Reload the page. The palette never flashes light, and the control shows `Dark` after hydration.
- **Choose light.** Select `Light`. The HTML theme and stored value change to `light`, and text retains visible contrast.
- **Follow system.** Select `System`. Change the browser color preference and confirm the page follows it without another selection.
- **Use the shell.** Sign in and repeat light and dark selection from the sidebar. The login page retains the last choice after sign out.
- **Use the keyboard.** Focus `Color theme` with the keyboard and change the value. A visible focus outline remains around the select.
- **Proof.** Capture the login and shell in light and dark modes. Record the HTML attribute and stored value with each screenshot. Run the production build to reject non-grayscale literal colors in the authored and emitted CSS.

## Gotchas

- The server does not know a browser preference. The inline head script applies the stored value before CSS loads.
- `System` stores `system`; CSS media queries resolve the visible palette.
