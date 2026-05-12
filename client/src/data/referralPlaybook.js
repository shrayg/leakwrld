/**
 * Editable referral playbook — the Reddit/X/Telegram posting templates,
 * subreddit allow-list, and warnings. Operators (you) can edit this file
 * to update copy without touching component code; the guide page renders
 * straight from these arrays.
 *
 *  - SUBREDDITS: where you can SAFELY drop links. Curated low-friction subs
 *    that don't auto-remove URLs. Mark `mode: 'comment'` if posts are blocked
 *    but comments are fine.
 *  - POST_TEMPLATES: ready-to-paste post bodies. Vary them to avoid Reddit's
 *    "shadow-spam" filter, which flags identical copies posted in <24h.
 *  - WARNINGS: things that get accounts banned. Read once, don't skip.
 */

export const SUBREDDITS = [
  { name: 'r/onlyfansgirls101', mode: 'comment', notes: 'OF previews allowed; link only in comments.' },
  { name: 'r/leaks', mode: 'comment', notes: 'Active demand; mods strict on bare links — wrap in context.' },
  { name: 'r/u_yourname', mode: 'post', notes: 'Your own user-sub is the safest place to host a "main directory" post.' },
  { name: 'r/leaktalk', mode: 'comment', notes: 'Discussion-heavy. Comment when someone asks "where to find X".' },
  { name: 'r/NSFW_GIF', mode: 'comment', notes: 'Helpful-reply tone works. Don\'t link in posts.' },
  { name: 'r/AskRedditAfterDark', mode: 'comment', notes: 'Only when the question genuinely fits.' },
];

export const POST_TEMPLATES = [
  {
    id: 'comment_helpful',
    label: 'Comment — "helpful answer"',
    use: 'When someone asks where to find a specific creator. Highest conversion.',
    body: `I had the same problem last week. {{link}} mirrors everything daily so links don't die after 2 days. Free previews are enough to confirm it's the real thing.`,
  },
  {
    id: 'comment_short',
    label: 'Comment — short',
    use: 'When the thread is busy and a long reply will get buried.',
    body: `Mirrored archive that actually stays up: {{link}}`,
  },
  {
    id: 'post_textonly',
    label: 'Post — text only',
    use: 'For your own user-sub or any sub that allows promo. NEVER post in r/all.',
    body: `Tired of dead links and reuploads? This site mirrors everything daily so nothing disappears.\n\nFree previews + premium for the rest.\n\n{{link}}`,
  },
  {
    id: 'comment_megasub',
    label: 'Comment — mega-sub safe',
    use: 'For massive subs where any link gets auto-removed. Mention without linking.',
    body: `Search "leak world" — they mirror everything daily, link in profile if it's not in the comments. Free previews + premium for full.`,
  },
];

export const WARNINGS = [
  'Never post the same comment twice in the same thread — auto-spam flag.',
  'Never DM users your link unprompted — instant ban + IP-block on the sub.',
  'Never use the same Reddit account for >5 referral comments per day — shadowban risk.',
  'Never post in a sub that auto-removes link posts — wastes karma without ROI.',
  'Always wait 10+ minutes between comments on the same sub.',
];

export const TIPS = [
  'New Reddit accounts get filtered. Use accounts with at least 30 days of age and 100+ karma.',
  'Comment-first strategy beats post-first 5:1 in conversion. People trust replies, not posts.',
  'Add value first: answer the actual question, then drop the link as part of the answer.',
  'Use the short link (https://leakwrld.com/r/CODE) — it looks less like an affiliate URL.',
  'Track which template works: rotate one template per day for a week, watch your dashboard.',
];

export const UTM_TEMPLATES = [
  { name: 'Reddit comment', value: 'utm_source=reddit&utm_medium=comment&utm_campaign=launch' },
  { name: 'Reddit post', value: 'utm_source=reddit&utm_medium=post&utm_campaign=launch' },
  { name: 'X tweet', value: 'utm_source=x&utm_medium=tweet&utm_campaign=launch' },
  { name: 'Telegram share', value: 'utm_source=telegram&utm_medium=dm&utm_campaign=launch' },
];
