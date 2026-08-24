/** Small shared rendering helpers. No framework — the pages are mostly strings. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

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
