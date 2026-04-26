/** Ported from script.js — deterministic SEO titles for gibberish filenames. */

const _seoTitleCache = {};

export function seoCleanTitle(rawName, folder) {
  const base = rawName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim();
  const words = base.split(/\s+/).filter((w) => w.length > 1);
  const realWords = words.filter((w) => /^[a-zA-Z]{2,}$/.test(w) && w.length > 2);
  const alphaCount = (base.match(/[a-zA-Z]/g) || []).length;
  const digitCount = (base.match(/[0-9]/g) || []).length;
  const isGibberish =
    (words.length < 2 && base.length < 12 && !/\d{3,4}p/.test(base)) ||
    (digitCount + (base.match(/[A-Z]/g) || []).length) > alphaCount * 0.7 && words.length < 3 ||
    base.length < 6 ||
    digitCount > alphaCount ||
    (realWords.length < 2 && base.length < 20) ||
    /^[A-Za-z]{1,4}\d/.test(base) ||
    /^(IMG|VID|DSC|MOV|MVI|DJI|DCIM|Screen|Clip|clip|rnd|unknown)/i.test(base) ||
    /^\d{4,}/.test(base) ||
    (/^[A-Za-z0-9]{6,}$/.test(base.replace(/\s/g, '')) && realWords.length < 2);

  if (!isGibberish) return base;
  if (_seoTitleCache[base]) return _seoTitleCache[base];

  let _h = 0;
  for (let _i = 0; _i < base.length; _i++) {
    _h = ((_h << 5) - _h + base.charCodeAt(_i)) | 0;
  }
  if (_h < 0) _h = -_h;
  const _pick = (arr) => arr[_h % arr.length];
  const _pick2 = (arr) => arr[(_h >>> 4) % arr.length];

  const cat = (folder || '').replace(/[-_]/g, ' ');
  const adjectives = [
    'hot',
    'sexy',
    'cute',
    'thicc',
    'bratty',
    'horny',
    'tipsy',
    'shy',
    'bored',
    'pierced',
    'tatted',
    'busty',
    'pale',
    'tanned',
    'curvy',
    'petite',
    'freaky',
    'filthy',
  ];
  const nouns = [
    'babe',
    'girl',
    'teen',
    'redhead',
    'blonde',
    'brunette',
    'asian',
    'latina',
    'goth',
    'milf',
    'cosplayer',
    'step-sis',
    'cam girl',
    'roommate',
    'college girl',
    'gym girl',
  ];
  const actions = [
    'flashes',
    'teases',
    'strips',
    'goes nude',
    'lifts shirt',
    'drops bra',
    'shows tits',
    'grinds',
    'spreads',
    'rubs out',
    'plays with toy',
    'sucks',
    'rides',
    'grinds on cam',
  ];
  const pov = [
    'POV',
    'sound on 🔊',
    'no sound',
    'reaction',
    'caught',
    'first time',
    'round 2',
    'part 2',
    'uncut',
    'full clip',
    'leaked',
    'snuck a peek',
  ];
  const modifiers = [
    '(0:14)',
    '(no sound)',
    '(sound on)',
    '[full]',
    'HD',
    '1080p',
    '4k',
    'vertical',
    'close up',
    'behind the scenes',
  ];
  const adj = _pick(adjectives);
  const noun = _pick2(nouns);
  const action = _pick(actions);
  const p = pov[(_h >>> 12) % pov.length];
  const mod = modifiers[(_h >>> 16) % modifiers.length];
  const num = ((_h >>> 20) % 7) + 1;

  let templates;
  if (cat && cat.length > 2) {
    templates = [
      noun + ' ' + action + ' on ' + cat + ' (' + p + ')',
      adj + ' ' + noun + ' ' + action + ' — ' + cat,
      cat + ' win #' + num + ' — ' + noun + ' ' + action,
      noun + ' ' + action + ' (' + cat + ', sound on)',
      adj + ' ' + noun + ' caught ' + action,
      noun + ' ' + action + ' ' + mod,
      'best ' + cat + ' ' + noun + ' of the week',
      cat + ': ' + adj + ' ' + noun + ' ' + action,
      noun + ' ' + action + ' — ' + cat + ' compilation pt ' + num,
      adj + ' ' + noun + ' ' + action + ' on ' + cat,
      noun + ' from ' + cat + ' ' + action + ' (POV)',
      'rare ' + cat + ' clip — ' + adj + ' ' + noun + ' ' + action,
      adj + ' ' + noun + ' ' + action + ' on cam',
      cat + ' ' + noun + ' ' + action + ' for the boys',
    ];
  } else {
    templates = [
      adj + ' ' + noun + ' ' + action + ' (' + p + ')',
      noun + ' ' + action + ' on cam ' + mod,
      adj + ' ' + noun + ' ' + action + ' — clip #' + num,
      noun + ' ' + action + ' for the camera',
      adj + ' ' + noun + ' caught ' + action,
      noun + ' ' + action + ' (sound on)',
      adj + ' amateur ' + noun + ' ' + action,
    ];
  }
  const title = templates[(_h >>> 8) % templates.length];
  _seoTitleCache[base] = title;
  return title;
}
