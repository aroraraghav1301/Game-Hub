# Raghav's Game Hub — checked player-system files

## Included files
- index.html — email/password account creation and login.
- games.html — Game Hub with player profile, wallet, daily streak, friends, leaderboards, owner tools, and analytics.
- gamehub_player_system.sql — re-runnable database setup/repair SQL, including the game_hub_events.name column and backfill for existing Auth users.

## Important fixes in this package
- Corrected all account redirects to use paths relative to the current folder. This works both from a local folder and from the deployed site root.
- Sign-out now clears the current browser's Supabase session locally and returns to index.html even if the network request fails. A local-scope sign-out does not revoke sessions on other devices.
- Player loading now displays the actual Supabase/database error or identifies which player record is missing instead of always showing a generic SQL setup message.
- SQL now backfills profiles, wallets, and streak rows for accounts that existed before the Auth trigger was installed.
- SQL adds game_hub_events.name for analytics and records player display names for new events.
- The 7-day custom Player ID cooldown now uses its own custom_id_changed_at field, so changing a display name does not restart the cooldown.

## Install / update
1. Back up your existing index.html and games.html.
2. In Supabase Dashboard → SQL Editor, run the complete gamehub_player_system.sql included here. It is designed to be re-run against the previous version and creates missing account records without duplicating existing ones.
3. Replace your local index.html and games.html with the two files in this package. Keep both in the same Game Hub folder.
4. For local testing, open the folder through a local web server (for example, VS Code Live Server) rather than relying on file://. The site uses Supabase over HTTPS; a local web server gives the browser a normal localhost origin and avoids file-origin restrictions.
5. Test login, sign-out, profile loading, daily reward, friends, and owner analytics. Then deploy the same two HTML files.

## Supabase settings
- Project URL: https://wpdqxooopwivbzazonca.supabase.co
- Browser publishable key: sb_publishable_9wI9m5g9qLnjMtJzPGM5pA_KeJ36NWD
- In Supabase Authentication → URL Configuration, configure the deployed site URL and its redirect URL(s).
- Never place a service_role key in browser HTML.

## Notes
- Existing historical analytics rows will have NULL in name; newly recorded events will include the player's display name (or Guest).
- Daily rewards and coin changes are handled by database functions, not by trusting browser-only values.
- The hub cannot securely verify whether an embedded third-party game was actually completed, so no coins are granted merely for clicking Play.
- First custom Player ID requires a 5-day streak; subsequent changes cost 500 coins and have a 7-day cooldown.
- These files have been statically checked for JavaScript syntax. They have not been live-tested against your Supabase project or deployed from here.
