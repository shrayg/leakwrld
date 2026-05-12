/**
 * Editable referral playbook — the two short content blocks rendered on the
 * /refer page under "How to get referrals fast". Operators (you) can edit
 * this file to update copy without touching component code; the playbook
 * section reads straight from these arrays.
 *
 *  - WARNINGS: things that get accounts banned. Read once, don't skip.
 *  - TIPS:     general advice users see in the "Pro tips" block.
 *
 * History: this file used to also export SUBREDDITS, POST_TEMPLATES, and
 * UTM_TEMPLATES, all of which drove now-removed UI sections. Their data was
 * stripped on the trim-down so the file stays an honest mirror of what's
 * actually rendered.
 */

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
  'Rotate accounts and tone so Reddit\'s spam filter doesn\'t pattern-match on you.',
];
