# Impeccable — Project Design Config

## Register

product

## Design Context

### Users
Internal marketing and commercial team members at a multi-brand company (SEO, Social
Media, Meta Ads, Google Ads, Newsletter, Partnerships, Commercial). Allowlist-only
(Google sign-in), scoped per team by an admin. They use Second Brain to run AI tasks,
brand-grounded chat and image generation across several brands. Context of use: focused
work sessions, drafting copy, running task templates, generating images. They want
output, not ceremony.

### Brand Personality
Fast · Confident · Trustworthy. An internal power tool, not a consumer product. The
interface should feel efficient and get out of the way. No marketing flourish, no
mascots, no playfulness for its own sake. Quiet competence.

### Aesthetic Direction
- **Theme:** Light only. Warm zinc canvas, crisp near-white surfaces, zinc-900/800
  text, and zinc-900 primary actions. Geist Sans / Geist Mono.
- **Color:** Neutral only. No brand accent in the chrome. Semantic color reserved for
  meaning — red for errors/destructive, green only for success confirmation.
- **Anti-references:** Avoid generic "AI slop" — default browser easing, single flat
  drop shadows, plain fades, one-off radii/durations, gradient-everything dashboards.
- **Depth stays restrained:** tonal surface shifts, hairline borders, and low-opacity shadows.

### Design Principles
1. **Tokens over one-offs.** Every curve, radius, duration, and shadow comes from the
   system in `src/app/globals.css`. No ad-hoc values. (`--ease-smooth`, `shadow-card`,
   `shadow-elevated`, `animate-enter`, `.u-press`, `.u-shimmer`.)
2. **Motion is felt, never default.** Use the tuned cubic-beziers; never the browser
   `ease`. Entrances fade + rise + blur-clear. Working states shimmer, not spin.
3. **Tactile and responsive.** Every clickable surface presses (`scale 0.98`) and
   reacts on hover with the smooth curve. Disabled = `cursor-not-allowed` + dimmed.
4. **Speed reads as quality.** Keep it lean — favor transform/opacity over heavy
   effects on lists and large surfaces. The tool should feel instant.
5. **Clarity first.** Readable contrast, working keyboard focus, honor
   `prefers-reduced-motion`. Internal tool — usability over formal WCAG conformance,
   but never sloppy.

## Design System Reference

The token foundation lives in `src/app/globals.css` (Tailwind v4 `@theme`):
- Curves: `ease-smooth` (default), `ease-out`, `ease-spring`, `ease-in-out`
- Durations: `--duration-fast` 150ms · `--duration-normal` 200ms · `--duration-slow` 280ms
- Radii: `rounded-sm/md/lg/xl` (6/12/16/24px)
- Depth: `shadow-card`, `shadow-elevated` (layered, hairline ring, 2–10% opacity)
- Motion: `animate-enter` (fade + 6px rise + 2px blur-clear), `animate-shimmer`
- Helpers: `.u-press`, `.u-transition`, `.u-shimmer` + `prefers-reduced-motion` guard
