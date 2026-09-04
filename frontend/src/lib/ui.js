/** Small shared rendering helpers. No framework — the pages are mostly strings. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * Prefixes an app-internal path with the deploy's base path. Astro's `base`
 * config auto-prefixes its own JS/CSS bundle URLs, but every hand-written
 * `href="/market"` in these pages needs this explicitly — otherwise the site
 * works at the root ("/") but 404s once it's served from a subpath, as
 * GitHub Pages does for a project site ("/repo-name/").
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const withBase = (path) => BASE + (path.startsWith('/') ? path : `/${path}`);

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const money = (amount, currency = 'GMD', unit = 'item') =>
  `${currency} ${Number(amount).toLocaleString()}${unit && unit !== 'item' ? ` / ${unit}` : ''}`;

export const dateLabel = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';

export const relative = (iso) => {
  if (!iso) return '';
  const secs = (Date.now() - new Date(iso).getTime()) / 1000;
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

/** Countdown badge: red when it is close, amber next, grey once it has passed. */
export function countdown(days, label) {
  if (label === null || label === undefined) return '';
  const tone =
    days === null ? 'bg-slate-100 text-slate-600'
      : days < 0 ? 'bg-slate-100 text-slate-500'
        : days <= 1 ? 'bg-red-100 text-red-700'
          : days <= 3 ? 'bg-amber-100 text-amber-800'
            : 'bg-emerald-100 text-emerald-800';
  return `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tone}">${esc(label)}</span>`;
}

const KIND_TONE = {
  payment: 'bg-rose-50 text-rose-700 ring-rose-200',
  deadline: 'bg-amber-50 text-amber-800 ring-amber-200',
  event: 'bg-sky-50 text-sky-700 ring-sky-200',
  announcement: 'bg-slate-50 text-slate-600 ring-slate-200',
};

export const kindChip = (kind) =>
  `<span class="rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ring-1 ring-inset ${KIND_TONE[kind] || KIND_TONE.announcement}">${esc(kind)}</span>`;

export const spinner = (text = 'Loading…') =>
  `<p class="py-8 text-center text-sm text-slate-400">${esc(text)}</p>`;

export const empty = (text) => `<p class="py-8 text-center text-sm text-slate-400">${esc(text)}</p>`;

export function toast(message, tone = 'ok') {
  let host = $('#toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4';
    document.body.append(host);
  }
  const node = document.createElement('div');
  node.className = `max-w-md rounded-lg px-4 py-2 text-sm shadow-lg ${
    tone === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'
  }`;
  node.textContent = message;
  host.append(node);
  setTimeout(() => node.remove(), 3800);
}

export const qs = (key) => new URLSearchParams(location.search).get(key);

/** Darkens (negative) or lightens (positive) a "#rrggbb" colour by `percent`.
 * Used to turn a single school brand colour into a two-stop gradient. */
export function shade(hex, percent) {
  const n = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt);
  const g = clamp(((n >> 8) & 0xff) + amt);
  const b = clamp((n & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/* Small hand-drawn line icons (no icon-font/CDN dependency, same approach as
 * the header crest and roofline SVGs) for the social actions and post kinds. */
const HEART_OUTLINE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-full w-full"><path stroke-linecap="round" stroke-linejoin="round" d="M12 20.2s-7.2-4.4-9.6-8.9C.8 8 2.2 4.6 5.5 4.6c1.9 0 3.5 1.1 4.2 2.4.1.3.6.3.7 0 .7-1.3 2.3-2.4 4.2-2.4 3.3 0 4.7 3.4 2.9 6.7-2.4 4.5-9.6 8.9-9.6 8.9z"/></svg>';
const HEART_FILLED =
  '<svg viewBox="0 0 24 24" fill="currentColor" class="h-full w-full"><path d="M12 20.2s-7.2-4.4-9.6-8.9C.8 8 2.2 4.6 5.5 4.6c1.9 0 3.5 1.1 4.2 2.4.1.3.6.3.7 0 .7-1.3 2.3-2.4 4.2-2.4 3.3 0 4.7 3.4 2.9 6.7-2.4 4.5-9.6 8.9-9.6 8.9z"/></svg>';
export const heartIcon = (filled) => (filled ? HEART_FILLED : HEART_OUTLINE);

export const SHARE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full"><path d="M21 3 10.4 13.6M21 3l-6.4 17-3.6-8L3 8.4 21 3Z"/></svg>';

export const COMMENT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full"><path d="M21 12c0 4.4-4 8-9 8-1 0-2-.1-2.9-.4L4 21l1.5-4.2C4.5 15.4 3 13.8 3 12c0-4.4 4-8 9-8s9 3.6 9 8Z"/></svg>';

const DOCUMENT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full"><path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z"/><path d="M14 3.5V8h4"/></svg>';

/** A council attachment (briefing, schedule, form) rendered as a small file
 * card with its own download — the same idiom as an email attachment. */
export function documentChip(p) {
  if (!p.documentUrl) return '';
  return `
    <a href="${esc(p.documentUrl)}" target="_blank" rel="noopener" class="mt-2 flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white text-slate-500"><span class="block h-5 w-5">${DOCUMENT_ICON}</span></span>
      <span class="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">${esc(p.documentName || 'Attached document')}</span>
      <span class="shrink-0 text-xs font-semibold text-navy">Download</span>
    </a>`;
}

const KIND_ICON = {
  event:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>',
  deadline:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full"><path d="M6 3h12M6 21h12M7 3c0 4 3.5 6 5 8 1.5-2 5-4 5-8M7 21c0-4 3.5-6 5-8 1.5 2 5 4 5 8"/></svg>',
  payment:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full"><rect x="3" y="6.5" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/><circle cx="16.5" cy="14.5" r="1" fill="currentColor" stroke="none"/></svg>',
  announcement:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full"><path d="M3 10v4a1.5 1.5 0 0 0 1.5 1.5H6l4.5 4V4.5L6 8.5H4.5A1.5 1.5 0 0 0 3 10Z"/><path d="M14 8.5a4 4 0 0 1 0 7M17 6a7.5 7.5 0 0 1 0 12"/></svg>',
};

/** The visual "cover" of a post: its own photo if a council attached one,
 * otherwise a generated cover in the school's own colour — a kind icon on a
 * gradient, so a dateless announcement looks designed rather than like a
 * recycled stock photo. */
export function postCover(p) {
  if (p.imageUrl) {
    return `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" decoding="async" class="h-full w-full object-cover" />`;
  }
  const c2 = shade(p.school.color, -20);
  return `
    <div class="flex h-full w-full items-center justify-center" style="background:linear-gradient(135deg, ${esc(p.school.color)}, ${esc(c2)})">
      <span class="h-16 w-16 text-white/90 sm:h-20 sm:w-20">${KIND_ICON[p.kind] || KIND_ICON.announcement}</span>
    </div>`;
}

/** "Who posted this" — the school/council acts as the account, the same way
 * every other page already keys colour and identity off the school, not the
 * individual signed-in author. */
export function postHeader(p) {
  const initials = esc(p.school.code.slice(0, 2).toUpperCase());
  return `
    <a href="${withBase(`/schools?code=${esc(p.school.code)}`)}" class="flex min-w-0 items-center gap-2.5">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style="background:${esc(p.school.color)}">${initials}</span>
      <span class="min-w-0">
        <span class="block truncate text-sm font-bold text-slate-900">${esc(p.school.name)}</span>
        <span class="block truncate text-xs text-slate-400">${esc(relative(p.createdAt))}</span>
      </span>
    </a>`;
}

/** "Add to calendar" is a choice, not an instant download — a tap opens two
 * options: the in-app personal calendar, or a plain .ics for the phone's own
 * calendar app. Plus a share icon. */
export function postActions(p, icsHref) {
  const calendarBtn = icsHref
    ? `<div class="calendar-picker relative">
         <button class="calendar-open flex items-center gap-1.5 text-sm font-semibold ${p.interested ? 'text-brand-red' : 'text-slate-600 hover:text-slate-900'}"
                 data-post="${p.id}" aria-haspopup="true" aria-label="Add to calendar">
           <span class="h-5 w-5">${heartIcon(p.interested)}</span>
           <span class="hidden sm:inline">${p.interested ? 'On your calendar' : 'Add to calendar'}</span>
         </button>
         <div class="calendar-menu absolute left-0 top-7 z-20 hidden w-60 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
           <button class="calendar-app block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50" data-post="${p.id}">
             ${p.interested ? '✓ On your UTG Connect calendar' : 'Add to your UTG Connect calendar'}
           </button>
           <a class="block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50" href="${icsHref}">
             Add to your phone's calendar
           </a>
         </div>
       </div>`
    : '';
  return `
    <div class="flex items-center gap-4">
      ${calendarBtn}
      <button class="share-btn ml-auto flex h-6 w-6 items-center justify-center text-slate-600 hover:text-slate-900"
              data-post="${p.id}" data-title="${esc(p.title)}" aria-label="Share">${SHARE_ICON}</button>
    </div>`;
}

/** One feed post, styled like a social post rather than a notice-board
 * entry: account header, big cover, icon actions, then the caption. Used by
 * every page that lists posts, so the Hub, a school page and a share link
 * all feel like the same app. */
export function socialCard(p, { icsHref } = {}) {
  return `
    <article class="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div class="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
        ${postHeader(p)}
        <span class="ml-auto shrink-0">${kindChip(p.kind)}</span>
      </div>
      <a href="${withBase(`/post?id=${p.id}`)}" class="block aspect-[4/3] bg-slate-100">${postCover(p)}</a>
      <div class="p-3.5">
        ${postActions(p, icsHref)}
        <h3 class="mt-2.5 text-[15px] font-bold leading-snug text-slate-900">
          <a href="${withBase(`/post?id=${p.id}`)}" class="hover:underline">${esc(p.title)}</a>
        </h3>
        ${p.body ? `<p class="mt-1 line-clamp-2 text-sm text-slate-600">${esc(p.body)}</p>` : ''}
        ${documentChip(p)}
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          ${p.startsAt ? `<span>${esc(dateLabel(p.startsAt))}</span>` : ''}
          ${p.location ? `<span>· ${esc(p.location)}</span>` : ''}
          ${countdown(p.daysLeft, p.countdown)}
        </div>
      </div>
    </article>`;
}

// One icon per marketplace category — covers the categories that actually
// appear in the seed data; anything else falls back to a plain tag icon.
// The point is a cover that is honestly generic rather than a random stock
// photo pretending to depict the actual item.
const CATEGORY_ICON = {
  electronics: '<path d="M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0V9Z"/><path d="M12 18v3"/>',
  phones: '<rect x="7.5" y="2.5" width="9" height="19" rx="2"/><path d="M11 18.3h2"/>',
  food: '<path d="M6 3v6a2 2 0 0 0 4 0V3M8 9v12M17 3c-1.7 0-3 2-3 5s1.3 5 3 5v7"/>',
  books: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20"/>',
  textbooks: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20"/>',
  hair: '<circle cx="6" cy="6.5" r="2.3"/><circle cx="6" cy="17.5" r="2.3"/><path d="M8 8.3 19 19M8 15.7 19 5"/>',
  photography: '<path d="M4 8h3l1.6-2.2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.4"/>',
  dj: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.5" y="14" width="4" height="6" rx="1.4"/><rect x="17.5" y="14" width="4" height="6" rx="1.4"/>',
  tutoring: '<path d="M12 4 2 9l10 5 10-5-10-5Z"/><path d="M6 11.5V17c0 1.5 3 3 6 3s6-1.5 6-3v-5.5"/>',
  laptops: '<rect x="4" y="4.5" width="16" height="10.5" rx="1.5"/><path d="M2 19h20l-2-3H4l-2 3Z"/>',
  calculators: '<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M8.5 7.5h7M8.5 11h1.4m2.7 0h1.4m2.7 0h0M8.5 14.5h1.4m2.7 0h1.4m2.7 0h0M8.5 18h6"/>',
  'formal-wear': '<path d="M12 3 9.2 7.5 12 11l2.8-3.5L12 3Z"/><path d="M9.2 11l-1.7 9h9l-1.7-9"/>',
};
const CATEGORY_ICON_FALLBACK =
  '<path d="M3 12 12 3h6a2 2 0 0 1 2 2v6l-9 9a2 2 0 0 1-3 0l-5-5a2 2 0 0 1 0-3Z"/><circle cx="15.5" cy="7.5" r="1.1" fill="currentColor" stroke="none"/>';

const SECTION_COLOR = { goods: '#0891b2', services: '#7c3aed', rent: '#b45309' };

/** A listing's own photo if it has one; otherwise a generated cover in its
 * category's icon — same idea as `postCover`, for the same reason. */
export function listingCover(l) {
  if (l.imageUrl) {
    return `<img src="${esc(l.imageUrl)}" alt="" loading="lazy" decoding="async" class="h-full w-full object-cover" />`;
  }
  const c1 = SECTION_COLOR[l.section] || '#4b5178';
  const c2 = shade(c1, -20);
  const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-full w-full">${CATEGORY_ICON[l.category] || CATEGORY_ICON_FALLBACK}</svg>`;
  return `
    <div class="flex h-full w-full items-center justify-center" style="background:linear-gradient(135deg, ${c1}, ${c2})">
      <span class="h-12 w-12 text-white/90">${icon}</span>
    </div>`;
}

/** Wires the calendar-choice menu + share icon inside `container` (delegated,
 * so it only needs to be bound once even though the cards inside get
 * re-rendered). `post` is api.js's POST helper, passed in rather than
 * imported here since this module stays free of the data layer. */
export function bindPostActions(container, post, { signedIn = false, onToggle } = {}) {
  const closeMenus = () => container.querySelectorAll('.calendar-menu').forEach((m) => m.classList.add('hidden'));

  container.addEventListener('click', (e) => {
    const opener = e.target.closest('.calendar-open');
    if (opener) {
      const menu = opener.parentElement.querySelector('.calendar-menu');
      const willOpen = menu.classList.contains('hidden');
      closeMenus();
      menu.classList.toggle('hidden', !willOpen);
      return;
    }

    const choice = e.target.closest('.calendar-app');
    if (choice) {
      if (!signedIn) {
        toast('Sign in to build your personal calendar');
        setTimeout(() => (location.href = withBase('/login')), 700);
        return;
      }
      post(`/posts/${choice.dataset.post}/interest`).then(({ interested }) => {
        container.querySelectorAll(`.calendar-open[data-post="${choice.dataset.post}"]`).forEach((btn) => {
          btn.className = `calendar-open flex items-center gap-1.5 text-sm font-semibold ${interested ? 'text-brand-red' : 'text-slate-600 hover:text-slate-900'}`;
          btn.querySelector('span').innerHTML = heartIcon(interested);
          const label = btn.querySelectorAll('span')[1];
          if (label) label.textContent = interested ? 'On your calendar' : 'Add to calendar';
        });
        choice.textContent = interested ? '✓ On your UTG Connect calendar' : 'Add to your UTG Connect calendar';
        closeMenus();
        onToggle?.(Number(choice.dataset.post), interested);
      });
      return;
    }

    const share = e.target.closest('.share-btn');
    if (share) {
      const url = `${location.origin}${withBase('/post')}?id=${share.dataset.post}`;
      if (navigator.share) {
        navigator.share({ title: share.dataset.title, url }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => toast('Link copied'));
      }
      return;
    }

    if (!e.target.closest('.calendar-picker')) closeMenus();
  });
}
