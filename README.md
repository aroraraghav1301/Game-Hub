# Raghav's Game Hub — redesigned

A full visual redesign of the existing Game Hub. The Supabase backend, database, SQL, auth flow and every
feature (profiles, wallet, daily reward, streaks, friends, leaderboards, badges, owner tools, analytics,
custom tags, suggestion box) are preserved and use the same tables, views and RPCs as before.

## Files
| File | Purpose |
|---|---|
| `index.html` | Sign up / log in page |
| `games.html` | Game Hub (served at `/games`) |
| `css/hub.css` | Shared stylesheet |
| `js/hub.js`, `js/account.js` | Page logic (conservative ES5, no build step) |
| `icon.png`, `icon-192.png` | Your icon, optimised (906 KB → 68 KB / 10 KB) |
| `vercel.json` | Clean URL `/games` routing |
| `gamehub_player_system.sql` | **Unchanged** original database setup (byte-identical) |

## Deploy (Vercel)
1. Upload/commit this whole folder as the project root (no build command, no framework; output directory = root).
2. Run `gamehub_player_system.sql` in Supabase → SQL Editor **only if** you have not already run this version.
3. Supabase → Authentication → URL Configuration: set **Site URL** to your deployed root (e.g. `https://yoursite.vercel.app/`)
   and add `https://yoursite.vercel.app/**` to **Redirect URLs**.
4. Visit `/games`. `/games.html` redirects permanently (308) to `/games`; query strings are preserved.

Local testing: use a local web server (e.g. VS Code Live Server). On `localhost` / `file:` the pages
automatically link to `games.html`/`index.html`; on the deployed site they use `/games` and `/`.

## What changed
- New bright gaming design (orange, yellow, lime, cyan, coral, magenta, sky, navy, white) with a spacious layout,
  sticky header, responsive menu, hero search, stat tiles, featured band, colour-accented game cards.
- Cards still render dynamically from the `games` table. New: tag filter chips built from your tags, live result
  count, loading placeholders, "Featured" badge, "New" badge (shown only if the table has a `created_at` column and the
  game is under 14 days old), and image icons (if a game's `icon` is an image URL it is shown as an image; emoji still work).
- Accessibility: skip link, visible focus, labelled controls, dialog focus handling + Escape + Tab trapping, live status messages.
- Fixes: a logged-out visitor on `/games` is now sent to the login page (the previous code stopped on an
  "Auth session missing" error); games still load if only the player-record check fails (an on-page notice explains why).
- Performance: no external fonts/images, no continuous animations, reduced-motion respected.

## Windows 7 compatibility note (please read)
- My code uses no CSS variables, `clamp()`/`min()`, `dvh`, `inset`, optional chaining, `??`, modules, `async/await`,
  template literals or modern DOM APIs without fallbacks. Layout is Flexbox first, upgraded to Grid only where supported.
- The last browsers available for Windows 7 are Chrome/Edge 109 and Firefox 115 ESR; the design is written to work
  there and in older builds.
- **Unavoidable limit:** the page depends on the Supabase JavaScript SDK (`@supabase/supabase-js@2`, loaded from a CDN —
  with a second CDN as fallback). The SDK's minimum browser version is set by Supabase, and the `@2` tag moves to newer
  releases over time. I could not download or test the SDK in my environment, and I could not test on a real Windows 7
  machine, so I cannot guarantee login works on very old browsers. If the SDK fails to load, the pages show a clear
  message instead of a blank screen. If you see that on Windows 7, pin the script tag in `index.html` and `games.html`
  to a specific older 2.x version that you have tested there.
- IE11 and the original (pre-Chromium) Edge are not supported.

## Security
Only the browser publishable key is in the code (same as before). Never add a `service_role` key.
