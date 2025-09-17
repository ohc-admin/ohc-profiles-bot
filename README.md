# OHC Profiles Bot

OHC Discord bot for player **profiles** (gamertag, trophies, awards), **role-driven** Team/Division/Region, **season placements/awards** from roles, and a **weekly Gold (1st place) leaderboard**.

## Quick Start

1. Create `.env` from `.env.example` and fill in:
   - BOT_TOKEN, CLIENT_ID
   - LEADERBOARD_CHANNEL_ID (channel where the gold leaderboard lives)
   - (Optional) LEADERBOARD_CRON (default Monday 12:00 PM America/Detroit)

2. Invite the bot (bot + applications.commands).  
   Enable **Server Members Intent** in Dev Portal.

3. Run it:
   - Docker: see `docker-compose.yml` or `docker run` in the main instructions.
   - Node: `npm install && npm start`

4. Players use:
   - `/link-gt` (gamertag + platform)
   - `/link-streams` (Twitch/YouTube/Kick)
   - `/profile` (view card)

5. Staff use:
   - `/record-result` (gold/silver/bronze podium)
   - Assign roles for placements/awards (e.g., `BO7 Season 3 Champ`, `BO7 S3 MVP`)

Profiles show:
- Team / Division / Region from roles
- Gold/Silver/Bronze totals
- Season Placements & Awards (from roles)
- Stream buttons

**Leaderboard** auto-updates weekly in your chosen channel with **Golds only**.
