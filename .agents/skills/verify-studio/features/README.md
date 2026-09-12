# YATB Studio verification map

This directory defines the user-facing authentication checks for Studio.

## Baseline preconditions

- Launch one Studio instance at `http://localhost:3001`.
- Apply the local D1 migrations before launch.
- Set `EMAIL_MODE=capture`.
- Run the doctor before the first browser action and after a failed drive.
- Use only the two seeded allowlisted addresses.

## Driving conventions

- Start with a fresh browser profile or clear Studio cookies.
- Use accessible names from the verification skill.
- Read D1 only after the browser action finishes.
- Retain every evidence file after cleanup.

## Proof and skip reporting

- Capture both the action and the resulting page.
- Pair each auth mutation with a D1 or HTTP observation.
- Report an unreachable path with its missing prerequisite.
- Never claim Cloudflare email delivery from local capture evidence.

## Feature entry contract

Each feature file describes its browser entry, exact drive, proof, and traps.

## Features

- [Signup access](./signup-access.md)
- [Email verification](./email-verification.md)
- [Sign in](./sign-in.md)
- [Sign out](./sign-out.md)
- [Password reset](./password-reset.md)
- [Private routes](./private-routes.md)
- [Color theme](./color-theme.md)
