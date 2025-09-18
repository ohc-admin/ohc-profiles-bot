// index.js — ohc-profiles-bot (Esports/Prestige theme)
// -------------------------------------------------------------------
const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const Database = require('better-sqlite3');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// =========================
/* CUSTOM ICONS (EDIT IDs) */
// =========================
const ICONS = {
  platform: {
    'battle.net': '<:battlenet:>',
    'battlenet':  '<:battlenet:>',
    'psn':        '<:psn:>',
    'playstation':'<:psn:>',
    'xbox':       '<:xbox:>',
    'xboxlive':   '<:xbox:>',
    'discord':    '<:discord:>'
  },
  trophies: {
    gold:   '<:goldtrophy:>',   // your uploaded PNG emoji IDs
    silver: '<:silvertrophy:>',
    bronze: '<:bronzetrophy:>',
    award:  '🏆'
  },
  streams: {
    twitch:  '<:twitch:>',
    youtube: '<:youtube:>',
    kick:    '<:kick:>'
  }
};
const SEP = '──────────';

// =========================
/* ROLE-DRIVEN PROFILE CONFIG */
// =========================
const ROLE_CONFIG = {
  prefixes: { team: null, tz: null, region: null },
  exacts: {
    teamNames: [
      'Aura Gaming','Boston Brigade','Denegerates','Electrify Steel','Emergence',
      'Grand Rapids Ice','High Treason','Kryptic','Legion of Chum','Los Angeles Rumble',
      'OMiT','Outkastz Esports','REGIMENT','SGP Syndicate','S9 Gaming',
      'Peak Gaming','Phoenix Guard','Free Agent'
    ],
    regionMap: {
      'US-East':    'North America (East)',
      'US-West':    'North America (West)',
      'US-Central': 'North America (Central)',
      'Canada':     'Canada',
      'EU':         'Europe',
      'Oceanic':    'Oceania',
    },
    divisions: ['Division A','Division B','Division C','Division D'],
    freeAgentNames: ['Free Agent','F/A','Looking for Team'],
  },
  freeAgentRoleName: 'Free Agent',
  regionPriority: ['US-East','US-Central','US-West','Canada','EU','Oceanic'],
};

// =========================
/* FALLBACK ICONS */
// =========================
const PLACEMENT_ICON = { champ: ICONS.trophies.gold };
const AWARD_ICON = {
  'mvp': ICONS.trophies.award,
  'ar of the year': ICONS.trophies.award,
  'smg of the year': ICONS.trophies.award,
  'biggest yapper': ICONS.trophies.award,
  'most positive player': ICONS.trophies.award,
};

// =========================
/* DB INIT + SCHEMA (PERSISTENT via DB_PATH) */
// =========================
const DEFAULT_DB_PATH = path.join(__dirname, 'ohc_profiles.db');
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;

// Ensure the directory for the DB exists (handles /app/data mapping)
try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch (_) {}

console.log(`📀 Using database at: ${DB_PATH}`);
const db = new Database(DB_PATH);

db.exec(`
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS players (
  discord_id TEXT PRIMARY KEY,
  display_name TEXT,
  gamertag TEXT,
  platform TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trophies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  type TEXT CHECK(type IN ('gold','silver','bronze')) NOT NULL,
  event_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(player_id) REFERENCES players(discord_id),
  FOREIGN KEY(event_id) REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  label TEXT NOT NULL,
  event_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(player_id) REFERENCES players(discord_id),
  FOREIGN KEY(event_id) REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS streams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  service TEXT CHECK(service IN ('twitch','youtube','kick')) NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(player_id, service),
  FOREIGN KEY(player_id) REFERENCES players(discord_id)
);

-- Settings store (e.g., last leaderboard message ID per channel)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// =========================
/* HELPERS */
// =========================
const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

function upsertPlayerRow({ id, name, gt=null, pf=null }) {
  db.prepare(`
    INSERT INTO players (discord_id, display_name, gamertag, platform)
    VALUES (@id, @name, @gt, @pf)
    ON CONFLICT(discord_id) DO UPDATE SET display_name=@name
  `).run({ id, name, gt, pf });
}
function ensurePlayer(user) {
  upsertPlayerRow({ id: user.id, name: user.globalName || user.username });
}
function platformIconFor(pfRaw) {
  if (!pfRaw) return '';
  const key = String(pfRaw).toLowerCase().trim();
  return ICONS.platform[key] || '';
}
function titleCase(s){ return s.replace(/\w\S*/g, t => t[0].toUpperCase() + t.slice(1).toLowerCase()); }
function keepAcronyms(str){
  return str.replace(/\bAr\b/gi,'AR').replace(/\bSmg\b/gi,'SMG');
}
function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, value);
}
function getSetting(key) {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key);
  return row?.value ?? null;
}

// --- deriveFromRoles: Team / FA / Region / Division ---
function deriveFromRoles(member) {
  const roles = Array.from(member.roles.cache.values()).map(r => r.name);
  const { exacts, freeAgentRoleName, regionPriority } = ROLE_CONFIG;

  let teamName = null, isFA = false, region = null, division = null;
  const matchedRegions = [];

  for (const nameRaw of roles) {
    const name = nameRaw.trim();

    if (exacts.teamNames?.some(t => t.toLowerCase() === name.toLowerCase())) teamName = name;
    if (exacts.regionMap?.[name]) matchedRegions.push(name);
    if (exacts.divisions?.some(d => d.toLowerCase() === name.toLowerCase())) division = name;
    if (exacts.freeAgentNames?.some(n => n.toLowerCase() === name.toLowerCase())) isFA = true;
  }
  if (freeAgentRoleName && roles.some(r => r.toLowerCase() === freeAgentRoleName.toLowerCase())) isFA = true;
  if (teamName && isFA) isFA = false;

  if (matchedRegions.length) {
    const chosen = (regionPriority || []).find(r => matchedRegions.includes(r)) || matchedRegions[0];
    region = exacts.regionMap[chosen] || chosen;
  }

  return { teamName, isFA, region, division };
}

// --- placements from roles: "BO6 Season 1 Champ" ---
function getPlacementsFromRoles(member) {
  const RX = /^(BO\d+)\s+Season\s+(\d+)\s+Champ$/i;
  const out = [];
  for (const role of member.roles.cache.values()) {
    const m = role.name.trim().match(RX);
    if (!m) continue;
    const gameTag = m[1].toUpperCase();
    const seasonNum = m[2];
    const seasonLabel = `${gameTag} Season ${seasonNum}`;
    const emoji = role.unicodeEmoji || PLACEMENT_ICON.champ || ICONS.trophies.award;
    out.push({ season: seasonLabel, placement: 'Champion', emoji });
  }
  // Sort by game (higher BO first), then season (newer first)
  out.sort((a, b) => {
    const sv = s => parseInt(s.season.match(/Season\s+(\d+)/i)?.[1] || '0', 10);
    const gv = s => parseInt(s.season.match(/^BO(\d+)/i)?.[1] || '0', 10);
    return (gv(b) - gv(a)) || (sv(b) - sv(a));
  });
  return out;
}

// --- awards from roles: "BO6 S1 MVP", "BO6 S1 AR of the Year", ... ---
function getAwardsFromRoles(member) {
  const RX = /^(BO\d+)\s+S(\d+)\s+(.+)$/i;
  const out = [];
  for (const role of member.roles.cache.values()) {
    const m = role.name.trim().match(RX);
    if (!m) continue;
    const gameTag = m[1].toUpperCase();
    const seasonNum = m[2];
    const rawAward = m[3].trim();
    const seasonLabel = `${gameTag} Season ${seasonNum}`;
    const key = rawAward.toLowerCase();
    let emoji = role.unicodeEmoji || AWARD_ICON[key] || ICONS.trophies.award;
    let awardTitle = keepAcronyms(titleCase(rawAward));
    out.push({ season: seasonLabel, award: awardTitle, emoji });
  }
  out.sort((a, b) => {
    const sv = s => parseInt(s.season.match(/Season\s+(\d+)/i)?.[1] || '0', 10);
    const gv = s => parseInt(s.season.match(/^BO(\d+)/i)?.[1] || '0', 10);
    return (gv(b) - gv(a)) || (sv(b) - sv(a));
  });
  return out;
}

// =========================
/* LEADERBOARD (Gold-only) helpers */
// =========================
function buildGoldLeaderboard(limit = 10) {
  const query = `
    SELECT p.display_name name, COUNT(*) score
    FROM trophies t
    JOIN players p ON p.discord_id = t.player_id
    WHERE t.type = 'gold'
    GROUP BY t.player_id
    ORDER BY score DESC, name ASC
    LIMIT ?
  `;
  const rows = db.prepare(query).all(limit);

  const lines = rows.length
    ? rows.map((r, idx) => {
        const place = idx + 1;
        const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : `#${place}`;
        return `${medal} **${r.name}** — ${r.score}`;
      }).join('\n')
    : '—';

  return new EmbedBuilder()
    .setColor(0xFFD700) // esports gold
    .setTitle('🥇 Gold Leaderboard')
    .setDescription(lines)
    .setFooter({ text: 'OHC — Gold Trophies Only (1st place finishes)' })
    .setTimestamp(new Date());
}

async function postOrUpdateGoldLeaderboard(channelId) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = buildGoldLeaderboard(10);
  const key = `gold_lb_msg_${channelId}`;
  const lastId = getSetting(key);

  if (lastId) {
    try {
      const msg = await channel.messages.fetch(lastId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {
      // message deleted; post a new one
    }
  }
  const newMsg = await channel.send({ embeds: [embed] });
  setSetting(key, newMsg.id);
}

// =========================
/* SLASH COMMANDS */
// =========================
const commands = [
  new SlashCommandBuilder().setName('link-gt').setDescription('Link your gamertag')
    .addStringOption(o=>o.setName('gamertag').setDescription('Your gamertag').setRequired(true))
    .addStringOption(o=>o.setName('platform').setDescription('Battle.net / PSN / Xbox').setRequired(true)),

  new SlashCommandBuilder().setName('link-streams').setDescription('Link your Twitch/YouTube/Kick URLs')
    .addStringOption(o=>o.setName('twitch').setDescription('https://twitch.tv/...'))
    .addStringOption(o=>o.setName('youtube').setDescription('YouTube Live/Channel URL'))
    .addStringOption(o=>o.setName('kick').setDescription('https://kick.com/...')),

  new SlashCommandBuilder().setName('record-result').setDescription('Record podium for an event (Staff only)')
    .addStringOption(o=>o.setName('event').setDescription('Event name').setRequired(true))
    .addUserOption(o=>o.setName('gold').setDescription('Gold winner').setRequired(true))
    .addUserOption(o=>o.setName('silver').setDescription('Silver winner').setRequired(true))
    .addUserOption(o=>o.setName('bronze').setDescription('Bronze winner').setRequired(true)),

  new SlashCommandBuilder().setName('award').setDescription('Give a custom award (Staff only)')
    .addStringOption(o=>o.setName('event').setDescription('Event name').setRequired(true))
    .addUserOption(o=>o.setName('user').setDescription('Player').setRequired(true))
    .addStringOption(o=>o.setName('label').setDescription('e.g., MVP').setRequired(true)),

  new SlashCommandBuilder().setName('profile').setDescription('Show a profile')
    .addUserOption(o=>o.setName('user').setDescription('Which user?')),

  // Staff: post/update the Gold leaderboard in the current channel
  new SlashCommandBuilder().setName('post-leaderboard')
    .setDescription('Post or update the Gold trophies leaderboard here (Staff only)')
    .addIntegerOption(o=>o.setName('limit').setDescription('Top N (default 10)')),

  // Staff: post the welcome/setup guide embed
  new SlashCommandBuilder().setName('post-welcome')
    .setDescription('Post the OHC profile setup guide (Staff only)'),
].map(c=>c.toJSON());

// Register once on boot
(async () => {
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
  console.log('Slash commands registered.');
})();

// =========================
/* CLIENT + HANDLERS */
// =========================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.on('interactionCreate', async (i) => {
  // ---------- Button handlers ----------
  if (i.isButton()) {
    // Team Roster: customId = "profile-teamroster-<Team Name>"
    if (i.customId.startsWith('profile-teamroster-')) {
      const teamName = i.customId.replace('profile-teamroster-', '').trim();
      if (!teamName || teamName === 'F/A') {
        return i.reply({ content: 'This player is a Free Agent and has no team roster.', ephemeral: true });
      }
      const role = i.guild.roles.cache.find(r => r.name.toLowerCase() === teamName.toLowerCase());
      if (!role) return i.reply({ content: `No team role found for **${teamName}**.`, ephemeral: true });

      const members = Array.from(role.members.values());
      if (!members.length) return i.reply({ content: `No members in **${teamName}**.`, ephemeral: true });

      const stmt = db.prepare(`
        SELECT SUM(type='gold') AS gold,
               SUM(type='silver') AS silver,
               SUM(type='bronze') AS bronze
        FROM trophies WHERE player_id=?
      `);

      const roster = members.map(m => {
        const row = stmt.get(m.id) || {};
        const g = row.gold || 0, s = row.silver || 0, b = row.bronze || 0;
        return { name: m.displayName, g, s, b, total: g+s+b };
      }).sort((a,b)=>b.total-a.total);

      const lines = roster.map(r => `**${r.name}** — 🥇 ${r.g} | 🥈 ${r.s} | 🥉 ${r.b} (Total: ${r.total})`);

      const embed = new EmbedBuilder()
        .setColor(0x00B5FF)
        .setTitle(`👥 Team Roster: ${teamName}`)
        .setDescription(`${SEP}\n${lines.join('\n')}\n\n${SEP}\n📅 *Updated live as results are recorded*`)
        .setTimestamp(new Date());

      return i.reply({ embeds: [embed], ephemeral: true });
    }
    return; // ignore other buttons
  }

  // ---------- Slash commands ----------
  if (!i.isChatInputCommand()) return;

  const isStaff = i.member?.roles?.cache?.some(r => r.name.toLowerCase() === 'staff') || i.memberPermissions?.has('Administrator');

  if (i.commandName === 'link-gt') {
    ensurePlayer(i.user);
    const gamertag = i.options.getString('gamertag', true);
    const platform = i.options.getString('platform', true);
    db.prepare(`UPDATE players SET gamertag=?, platform=?, display_name=? WHERE discord_id=?`)
      .run(gamertag, platform, i.member?.displayName || i.user.username, i.user.id);
    return i.reply({ content: `Linked **${gamertag}** (${platform}).`, ephemeral: true });
  }

  if (i.commandName === 'link-streams') {
    ensurePlayer(i.user);
    const twitch  = i.options.getString('twitch');
    const youtube = i.options.getString('youtube');
    const kick    = i.options.getString('kick');

    const checks = [
      { service:'twitch',  url:twitch,  ok:v=>!v || /^https?:\/\/(www\.)?twitch\.tv\/[\w-]+/i.test(v) },
      { service:'youtube', url:youtube, ok:v=>!v || /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/i.test(v) },
      { service:'kick',    url:kick,    ok:v=>!v || /^https?:\/\/(www\.)?kick\.com\/[\w-]+/i.test(v) },
    ];
    for (const c of checks) {
      if (!c.ok(c.url)) return i.reply({ content:`That ${c.service} URL doesn’t look right.`, ephemeral:true });
    }

    const upsert = db.prepare(`
      INSERT INTO streams (player_id, service, url)
      VALUES (@player_id, @service, @url)
      ON CONFLICT(player_id, service) DO UPDATE SET url=excluded.url
    `);
    let count=0;
    for (const { service, url } of [{service:'twitch',url:twitch},{service:'youtube',url:youtube},{service:'kick',url:kick}]) {
      if (url) { upsert.run({ player_id:i.user.id, service, url }); count++; }
    }
    if (!count) return i.reply({ content:'No URLs provided.', ephemeral:true });
    return i.reply({ content:`Linked ${count} stream${count>1?'s':''}.`, ephemeral:true });
  }

  if (i.commandName === 'record-result') {
    if (!isStaff) return i.reply({ content:'Staff only.', ephemeral:true });
    const eventName = i.options.getString('event', true);
    const gold = i.options.getUser('gold', true);
    const silver = i.options.getUser('silver', true);
    const bronze = i.options.getUser('bronze', true);
    [gold, silver, bronze].forEach(ensurePlayer);
    const evId = db.prepare(`INSERT INTO events (name) VALUES (?)`).run(eventName).lastInsertRowid;
    const insT = db.prepare(`INSERT INTO trophies (player_id, type, event_id) VALUES (?, ?, ?)`);
    insT.run(gold.id, 'gold', evId);
    insT.run(silver.id, 'silver', evId);
    insT.run(bronze.id, 'bronze', evId);
    return i.reply({ content:`Recorded **${eventName}** podium: 🥇${gold} 🥈${silver} 🥉${bronze}` });
  }

  if (i.commandName === 'award') {
    if (!isStaff) return i.reply({ content:'Staff only.', ephemeral:true });
    const eventName = i.options.getString('event', true);
    const user = i.options.getUser('user', true);
    const label = i.options.getString('label', true);
    ensurePlayer(user);
    const evId = db.prepare(`INSERT INTO events (name) VALUES (?)`).run(eventName).lastInsertRowid;
    db.prepare(`INSERT INTO awards (player_id, label, event_id) VALUES (?, ?, ?)`).run(user.id, label, evId);
    return i.reply({ content:`Gave **${label}** to ${user} for **${eventName}**.` });
  }

  if (i.commandName === 'profile') {
    const user = i.options.getUser('user') || i.user;
    ensurePlayer(user);

    const p = db.prepare(`SELECT display_name, gamertag, platform, created_at
                          FROM players WHERE discord_id=?`).get(user.id) || {};
    const totals = db.prepare(`
      SELECT SUM(type='gold')   AS gold,
             SUM(type='silver') AS silver,
             SUM(type='bronze') AS bronze
      FROM trophies WHERE player_id=?`).get(user.id);

    const member = await i.guild.members.fetch(user.id).catch(() => null);
    const memberSince = member?.joinedAt
      ? member.joinedAt.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})
      : null;

    const roleDerived = member ? deriveFromRoles(member) : {};
    const teamDisplay = roleDerived.teamName || (roleDerived.isFA ? 'F/A' : 'F/A');
    const regionDisplay = roleDerived.region || '—';
    const divisionDisplay = roleDerived.division || '—';

    // Role-driven placements & awards
    const placements = member ? getPlacementsFromRoles(member) : [];
    const awardsRole = member ? getAwardsFromRoles(member) : [];

    const placementsLine = placements.length
      ? placements.map(p => `${p.emoji ? `${p.emoji} ` : ''}${p.season} — **${p.placement}**`).join('\n')
      : '—';

    const awardsLine = awardsRole.length
      ? awardsRole.map(a => `${a.emoji ? `${a.emoji} ` : ''}${a.season} — **${a.award}**`).join('\n')
      : '—';

    const profileCreated = p?.created_at
      ? new Date(p.created_at).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})
      : null;

    const streams = db.prepare(`SELECT service, url FROM streams WHERE player_id=?`).all(user.id);
    const byService = Object.fromEntries(streams.map(s => [s.service, s.url]));

    const pfIcon = platformIconFor(p.platform);

    // Esports/Prestige theme embed
    const embed = new EmbedBuilder()
      .setColor(0xFFD700) // gold prestige
      .setTitle(`👑 ${p.display_name || user.username}`)
      .setDescription(`*Gamertag:* \`${p.gamertag || '—'}\` ${pfIcon || ''}`)
      .addFields(
        { name: SEP, value: '\u200B' },
        { name: '📅 Member Since', value: memberSince || '—', inline: true },
        { name: '📅 Profile Created', value: profileCreated || '—', inline: true },
        { name: SEP, value: '\u200B' },
        { name: '🛡️ Team', value: teamDisplay, inline: true },
        { name: '🎯 Division', value: divisionDisplay, inline: true },
        { name: '🌍 Region', value: regionDisplay, inline: true },
        { name: SEP, value: '\u200B' },
        { name: '🏆 Trophy Case', value: `${ICONS.trophies.gold} ${totals?.gold||0}\n${ICONS.trophies.silver} ${totals?.silver||0}\n${ICONS.trophies.bronze} ${totals?.bronze||0}`, inline: false },
        { name: SEP, value: '\u200B' },
        { name: '🥇 Season Placements', value: placementsLine, inline: false },
        { name: SEP, value: '\u200B' },
        { name: '⭐ Awards & Titles', value: awardsLine, inline: false }
      )
      .setThumbnail(user.displayAvatarURL())
      .setTimestamp(new Date());

    // Buttons (streams + team roster)
    const buttons = [];
    if (byService.twitch)  buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(byService.twitch).setLabel('Twitch').setEmoji('🔴'));
    if (byService.youtube) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(byService.youtube).setLabel('YouTube').setEmoji('🔵'));
    if (byService.kick)    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(byService.kick).setLabel('Kick').setEmoji('🟢'));
    // Team roster button (customId encodes the team)
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Secondary)
        .setCustomId(`profile-teamroster-${teamDisplay}`)
        .setLabel('Team Roster')
        .setEmoji('👥')
    );

    const row = new ActionRowBuilder().addComponents(...buttons);
    return i.reply({ embeds:[embed], components:[row] });
  }

  if (i.commandName === 'post-leaderboard') {
    if (!isStaff) return i.reply({ content:'Staff only.', ephemeral:true });
    const limit = i.options.getInteger('limit') || 10;
    // Post/update in current channel
    await (async () => {
      // Temporarily build with custom limit for this one-off post
      const query = `
        SELECT p.display_name name, COUNT(*) score
        FROM trophies t
        JOIN players p ON p.discord_id = t.player_id
        WHERE t.type = 'gold'
        GROUP BY t.player_id
        ORDER BY score DESC, name ASC
        LIMIT ?
      `;
      const rows = db.prepare(query).all(limit);
      const lines = rows.length
        ? rows.map((r, idx) => {
            const place = idx + 1;
            const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : `#${place}`;
            return `${medal} **${r.name}** — ${r.score}`;
          }).join('\n')
        : '—';
      const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('🥇 Gold Leaderboard')
        .setDescription(lines)
        .setFooter({ text: 'OHC — Gold Trophies Only (1st place finishes)' })
        .setTimestamp(new Date());
      await i.reply({ content:'Leaderboard posted/updated!', ephemeral:true });
      await i.channel.send({ embeds:[embed] });
    })();
    return;
  }

  if (i.commandName === 'post-welcome') {
    if (!isStaff) return i.reply({ content: 'Staff only.', ephemeral: true });
    const embed = new EmbedBuilder()
      .setColor(0x00B5FF)
      .setTitle('🎮 How to Set Up Your OHC Player Profile')
      .setDescription('Welcome! Every player gets a profile card that shows your gamertag, trophies, awards, and more. Follow these quick steps:')
      .addFields(
        {
          name: '📝 Step 1: Roles',
          value: 'Staff will assign your **Team** (or **Free Agent**), **Division** (A–D), and **Region** (US-East, EU, etc.). Your profile pulls these from your roles automatically.',
          inline: false
        },
        {
          name: '🎮 Step 2: Link Your Gamertag',
          value: '```\n/link-gt gamertag:<yourGamertagHere> platform:<Battle.net | PSN | Xbox>\n\nExample:\n/link-gt gamertag: KNUCKLES#1939585 platform: Battle.net\n```',
          inline: false
        },
        {
          name: '📺 Step 3: Link Your Streams (optional)',
          value: '```\n/link-streams twitch:https://twitch.tv/yourname\nyoutube:https://youtube.com/@yourchannel\nkick:https://kick.com/yourname\n```',
          inline: false
        },
        {
          name: '🧩 What Shows On Your Card',
          value: '• Discord name & gamertag (with platform logo)\n• Member Since / Profile Created\n• Team · Division · Region',
          inline: true
        },
        {
          name: '🏆 Achievements',
          value: '• Trophy totals: 🥇 🥈 🥉\n• Season Placements (from roles like **BO7 Season 3 Champ**)\n• Awards (e.g., **MVP**, **AR of the Year**)',
          inline: true
        },
        {
          name: '👤 View Your Profile',
          value: '```\n/profile\n```',
          inline: false
        }
      )
      .setFooter({ text: 'Tip: You only need to /link-gt once. Everything else updates as you play and win.' });
    await i.reply({ content: 'Posted the setup guide below 👇', ephemeral: true });
    return i.channel.send({ embeds: [embed] });
  }
});

// Login & schedule weekly leaderboard
client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  const channelId = process.env.LEADERBOARD_CHANNEL_ID;
  const cronExpr  = process.env.LEADERBOARD_CRON || '0 12 * * MON'; // Monday 12:00 PM (America/Detroit)

  if (!channelId) {
    console.warn('LEADERBOARD_CHANNEL_ID not set; weekly leaderboard disabled.');
  } else {
    // Post once on startup
    try {
      await postOrUpdateGoldLeaderboard(channelId);
      console.log('Gold leaderboard posted/updated on startup.');
    } catch (e) {
      console.warn('Could not post leaderboard on startup:', e?.message || e);
    }
    // Weekly updates
    try {
      cron.schedule(cronExpr, async () => {
        try {
          await postOrUpdateGoldLeaderboard(channelId);
          console.log('Gold leaderboard auto-updated.');
        } catch (e) {
          console.warn('Auto-update failed:', e?.message || e);
        }
      }, { timezone: 'America/Detroit' });
      console.log(`Weekly Gold leaderboard scheduled: "${cronExpr}" (America/Detroit)`);
    } catch (e) {
      console.warn('Invalid LEADERBOARD_CRON. Example Monday noon = "0 12 * * MON"');
    }
  }
});

client.login(process.env.BOT_TOKEN);
