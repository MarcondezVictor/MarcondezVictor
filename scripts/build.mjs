// Builds dark_mode.svg and light_mode.svg: a neofetch-style profile card.
// ASCII portrait on the left, info + live GitHub stats on the right.
//
// Usage: GH_TOKEN=<token> node scripts/build.mjs
// Runs daily in .github/workflows/build.yml. Node 20+, no dependencies.

import { readFileSync, writeFileSync } from 'node:fs';

const USER = 'MarcondezVictor';
const BIRTH = new Date(Date.UTC(2004, 9, 30)); // 30 Oct 2004
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const WIDTH = 60; // characters per info line

// ---------------------------------------------------------------- stats

async function gh(path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'profile-card-builder',
    },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, json: res.status === 204 ? null : await res.json() };
}

async function graphql(query, variables = {}) {
  const { json } = await gh('/graphql', { query, variables });
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function getStats() {
  const { user } = await graphql(
    `query($login: String!) {
      user(login: $login) {
        createdAt
        followers { totalCount }
        repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 100) {
          totalCount
          nodes { name stargazerCount }
        }
        repositoriesContributedTo(includeUserRepositories: false, contributionTypes: [COMMIT, PULL_REQUEST]) { totalCount }
      }
    }`,
    { login: USER }
  );

  // Commits: sum yearly contribution totals since the account was created
  let commits = 0;
  const firstYear = new Date(user.createdAt).getUTCFullYear();
  for (let year = firstYear; year <= new Date().getUTCFullYear(); year++) {
    const data = await graphql(
      `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) { contributionsCollection(from: $from, to: $to) { totalCommitContributions } }
      }`,
      { login: USER, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` }
    );
    commits += data.user.contributionsCollection.totalCommitContributions;
  }

  // Lines of code: additions/deletions authored by USER in their own repos
  let additions = 0;
  let deletions = 0;
  for (const repo of user.repositories.nodes) {
    let result;
    for (let attempt = 0; attempt < 6; attempt++) {
      result = await gh(`/repos/${USER}/${repo.name}/stats/contributors`);
      if (result.status !== 202) break; // 202 = GitHub is still computing the stats
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!Array.isArray(result.json)) continue;
    const me = result.json.find((c) => c.author?.login?.toLowerCase() === USER.toLowerCase());
    for (const week of me?.weeks ?? []) {
      additions += week.a;
      deletions += week.d;
    }
  }

  return {
    repos: user.repositories.totalCount,
    contributed: user.repositoriesContributedTo.totalCount,
    stars: user.repositories.nodes.reduce((sum, r) => sum + r.stargazerCount, 0),
    followers: user.followers.totalCount,
    commits,
    additions,
    deletions,
  };
}

// ---------------------------------------------------------------- uptime

function uptime(now = new Date()) {
  let years = now.getUTCFullYear() - BIRTH.getUTCFullYear();
  let months = now.getUTCMonth() - BIRTH.getUTCMonth();
  let days = now.getUTCDate() - BIRTH.getUTCDate();
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const birthday = months === 0 && days === 0 ? ' 🎂' : '';
  return `${plural(years, 'year')}, ${plural(months, 'month')}, ${plural(days, 'day')}${birthday}`;
}

// ---------------------------------------------------------------- layout

const fmt = (n) => n.toLocaleString('en-US');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One info line is a list of segments: [text, cssClass]. `kv` pads with dots.
const kv = (key, value, width = WIDTH) => {
  const dots = Math.max(2, width - key.length - value.length - 4);
  return [['. ', 'cc'], [key, 'key'], [':', ''], [` ${'.'.repeat(dots)} `, 'cc'], [value, 'value']];
};
const textLength = (segments) => segments.reduce((n, [text]) => n + text.length, 0);
// kv() followed by extra segments, with the dots shortened so the whole line fits WIDTH
const kvPlus = (key, value, extra) => [...kv(key, value, WIDTH - textLength(extra)), ...extra];
const header = (title) => [['— ' + title + ' ', ''], ['—'.repeat(Math.max(2, WIDTH - title.length - 3)), 'cc']];
const blank = () => [['', '']];

function infoLines(s) {
  return [
    [['victor', 'key'], ['@', ''], ['lopes', 'key'], [' ' + '—'.repeat(WIDTH - 13), 'cc']],
    kv('OS', 'Windows 11, iOS'),
    kv('Uptime', uptime()),
    kv('Host', 'Instituto Politécnico de Tomar'),
    kv('Kernel', 'CTeSP TPSI · Software Development'),
    kv('Erasmus', 'Politechnika Białostocka, Poland'),
    kv('IDE', 'VS Code, IntelliJ IDEA, Unity'),
    blank(),
    kv('Languages.Programming', 'TypeScript, Java, C#, Kotlin'),
    kv('Languages.Computer', 'HTML, CSS, SQL, Markdown'),
    kv('Languages.Real', 'Portuguese, English'),
    blank(),
    kv('Hobbies.Software', 'Web apps, Game dev'),
    kv('Hobbies.Other', 'Movies, Music, Geography'),
    kv('Before.Code', 'Restaurant management'),
    blank(),
    header('GitHub Stats'),
    kvPlus('Repos', `${fmt(s.repos)} {Contributed: ${fmt(s.contributed)}}`, [[' | ', 'cc'], ['Stars', 'key'], [': ', ''], [fmt(s.stars), 'value']]),
    kvPlus('Commits', fmt(s.commits), [[' | ', 'cc'], ['Followers', 'key'], [': ', ''], [fmt(s.followers), 'value']]),
    kvPlus('Lines of Code', fmt(s.additions - s.deletions), [
      [' ( ', ''], [fmt(s.additions) + '++', 'add'], [', ', ''], [fmt(s.deletions) + '--', 'del'], [' )', ''],
    ]),
  ];
}

const THEMES = {
  dark: { bg: '#161b22', text: '#c9d1d9', key: '#ffa657', value: '#a5d6ff', cc: '#616e7f', add: '#3fb950', del: '#f85149', art: '#c9d1d9' },
  light: { bg: '#f6f8fa', text: '#24292f', key: '#953800', value: '#0a3069', cc: '#c2cfde', add: '#1a7f37', del: '#cf222e', art: '#24292f' },
};

function svg(theme, art, lines) {
  const t = THEMES[theme];
  const LINE_H = 20;
  const CHAR_W = 8.8; // approx. width of one 16px monospace character
  const artX = 15;
  const artCols = Math.max(...art.map((row) => row.length));
  const infoX = Math.round(artX + artCols * CHAR_W + 25);
  const cardW = Math.round(infoX + WIDTH * CHAR_W + 25);
  const rows = Math.max(art.length, lines.length + 4);
  const height = rows * LINE_H + 30;
  const top = 30;
  // vertically centre the info block next to the portrait
  const infoTop = top + Math.max(0, Math.floor((art.length - lines.length) / 2)) * LINE_H;

  const artSvg = art
    .map((row, i) => `<tspan x="${artX}" y="${top + i * LINE_H}">${esc(row)}</tspan>`)
    .join('\n');
  const infoSvg = lines
    .map((segments, i) => {
      const spans = segments.map(([text, cls]) => (cls ? `<tspan class="${cls}">${esc(text)}</tspan>` : esc(text))).join('');
      return `<tspan x="${infoX}" y="${infoTop + i * LINE_H}">${spans}</tspan>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" font-family="ConsolasFallback,Consolas,'Courier New',monospace" width="${cardW}px" height="${height}px" font-size="16px">
<style>
.key { fill: ${t.key}; } .value { fill: ${t.value}; } .cc { fill: ${t.cc}; }
.add { fill: ${t.add}; } .del { fill: ${t.del}; }
text, tspan { white-space: pre; }
</style>
<rect width="${cardW}px" height="${height}px" fill="${t.bg}" rx="15"/>
<text x="${artX}" y="${top}" fill="${t.art}" class="ascii">
${artSvg}
</text>
<text x="${infoX}" y="${infoTop}" fill="${t.text}">
${infoSvg}
</text>
</svg>
`;
}

// ---------------------------------------------------------------- main

if (!TOKEN) throw new Error('Set GH_TOKEN (or GITHUB_TOKEN) to read GitHub stats.');
// ascii.txt: bright areas are dense (for dark backgrounds).
// ascii_light.txt: the same portrait inverted, so it reads correctly on light backgrounds.
const readArt = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\r/g, '').trimEnd().split('\n');
const art = { dark: readArt('ascii.txt'), light: readArt('ascii_light.txt') };
const stats = await getStats();
const lines = infoLines(stats);
for (const theme of ['dark', 'light']) {
  writeFileSync(new URL(`../${theme}_mode.svg`, import.meta.url), svg(theme, art[theme], lines));
}
console.log('Built cards:', JSON.stringify(stats), '| uptime:', uptime());
