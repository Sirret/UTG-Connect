# UTG Connect — MVP

A working build of the concept sheet: an events/information hub for UTG's school councils,
plus a verified student marketplace. Built to answer one question — **does the concept hold
together when you actually use it?** — not to settle on a visual design.

Front end and back end are separate applications. They share nothing but the HTTP API, so
either can be replaced without touching the other.

```
connect app/
├── backend/     Express + SQLite REST API  (port 4000)
└── frontend/    Astro + Tailwind static site (port 4321)
```

## Running it

Two terminals.

```bash
# 1. API
cd backend
npm install
cp .env.example .env
npm run reset      # builds the database and seeds a demo campus
npm run dev        # http://localhost:4000

# 2. Web
cd frontend
npm install
cp .env.example .env
npm run dev        # http://localhost:4321
```

Open http://localhost:4321 and sign in from the demo list on the login page.
Every seeded account uses the password `utgconnect1`.

| Account | What it shows |
| --- | --- |
| `fatou.jallow@utg.edu.gm` | Student and seller — listings, incoming offers, followers |
| `binta.camara@utg.edu.gm` | Buyer with an open rental, a held deposit and a live dispute |
| `itca.council@utg.edu.gm` | Council account — can post to ITCA and nowhere else |
| `admin@utg.edu.gm` | Approval queue, dispute rulings, school pages, ban list |

## What is actually built

Every bullet on the concept sheet that could be tested by using the thing is implemented.

**Access & sign-up**
- Sign-up is rejected unless the address ends in the university domain (`UNIVERSITY_EMAIL_DOMAIN`).
- Email verification is a real token flow. There is no mail server in this build, so the token
  comes back in the response and the sign-up page turns it into a one-click button.
- Council accounts are role-based and tied to the school, not to a person — leadership changes
  without re-verifying anything.
- Every student picks a home school at sign-up; the hub opens on that school by default.

**Events & information hub**
- Only a school's own council account (or an admin) can post to that page — enforced server-side,
  not hidden in the UI.
- Six pages ship from one template: SAS, ITCA, BPA, AGRI, EDU and a campus-wide UTGSU page. Each
  supplies a colour and a logo; nothing else per school.
- "All Schools" sorts by time-sensitivity: anything still ahead of us first, soonest first,
  then everything undated by recency.
- Countdown badges ("3 days left") on every dated card, colour-shifting as the date closes in.
- One-tap add-to-calendar serves a real `.ics` file the phone opens directly.
- "This Week at UTG" digest, which stretches itself to a month when the week is quiet.
- Council & admin directory on each school page's Info tab — role, what they handle, and the
  contact method that role prefers.
- Admin approval queue before a council post goes live; approving it notifies that school's students.
- Admin adds or removes a school page directly, with no approval workflow, as specified.

**Marketplace**
- Image-first grid feed; a listing without a photo is refused.
- Three sections — Goods, Services, Rent & Borrow — with strict per-section categories enforced
  at listing time, so a charger cannot land in the food feed.
- Search toggles between finding an item and finding a seller.
- Sorting by New, Trending (saves and views decayed by age — not just recency), or price.
- Filters for school, category and price range.
- Make an Offer, with accept/decline from the seller's side.
- Seller storefronts: bio, school, rating, badges, follower count and every active listing.
- Follow a seller and get notified when they post or schedule a drop.
- 24-hour seller stories ("Restocked — 6 left").
- Verified and Top Seller badges, both derived from real data, plus a response-time indicator.
- Save/wishlist with a genuine price-drop alert to everyone watching an item.
- Scheduled "drops" — a listing hidden behind a public countdown until its release time.
- Pickup point on every listing, chosen from common campus meeting places.
- Message Seller opens WhatsApp pre-filled with the item name; there is no in-app chat by design.
- Zero commission — nothing is deducted anywhere in the code.

**Trust & safety for Rent & Borrow**
- Accepting an offer on a rent listing opens a rental agreement between two named, verified accounts.
- Deposits above a threshold are held by the platform, with a mobile-money-style reference, and are
  released to the borrower or paid to the lender by the lender's decision. (Simulated — a real
  Africell Money integration is a build task, not a concept question.)
- Condition photos at handoff and at return, from both sides.
- A report cannot be filed without photo evidence attached.
- An admin sees the evidence plus both sides' condition photos before ruling.
- Upholding a report bans the accused; ruling it fabricated bans the person who filed it. Both land
  on a public in-app ban list, and a banned account cannot log back in.

**Low-data behaviour** — the claim the concept rests on
- Static Astro output: HTML plus a small amount of JavaScript, no framework runtime.
- Every API GET is stored in `localStorage` with its ETag. The next request sends `If-None-Match`
  and a `304` costs headers instead of the whole payload.
- `?since=` on posts and listings returns only what changed, for incremental sync.
- On a failed request the app serves the copy already on the device rather than an empty screen.
- The footer prints what the cache is doing — how many responses are stored, how many were served
  from cache this visit — so the claim can be checked rather than believed.
- Installable to the home screen (manifest + service worker), no app store involved.

## What is deliberately faked

These are build decisions, not concept questions, so the MVP stubs them and says so on screen:

- **Email delivery.** The verification token is returned in the response instead of being mailed.
- **Image uploads.** Listings take a photo URL. Real file storage changes nothing about whether
  the concept works.
- **Mobile money.** The deposit escrow is a state machine with a reference number.
- **Push notifications.** Notifications are stored server-side and read in-app; wiring them to Web
  Push is mechanical.
- **Response time.** Derived from how quickly a seller answers offers, since there is no in-app
  messaging to measure.

## Configuration

`backend/.env` — the switches worth knowing about:

| Variable | Default | Effect |
| --- | --- | --- |
| `UNIVERSITY_EMAIL_DOMAIN` | `utg.edu.gm` | The only domain allowed to sign up |
| `ALLOW_ANY_EMAIL` | `false` | Set `true` to test with a Gmail address |
| `REQUIRE_POST_APPROVAL` | `true` | Set `false` to let council posts publish immediately |
| `DEPOSIT_THRESHOLD` | `1000` | Rentals at or above this need a held deposit |
| `DEV_RETURN_VERIFY_TOKEN` | `true` | Set `false` once real email is wired up |

## API

`GET /api/health` and then, all under `/api`:

```
auth      POST /auth/signup · /auth/verify · /auth/login    GET/PATCH /auth/me
schools   GET  /schools · /schools/activity · /schools/:code
          PUT  /schools/:code/council        POST/PATCH/DELETE /schools[/:code]   (admin/council)
posts     GET  /posts?school=&kind=&status=&since=   /posts/digest   /posts/:id
          GET  /posts/:id/calendar.ics
          POST /posts   PATCH /posts/:id/approve   DELETE /posts/:id
listings  GET  /listings?section=&category=&school=&q=&searchBy=&min=&max=&sort=&since=
          GET  /listings/meta · /listings/:id
          POST /listings · /listings/:id/save · /listings/:id/offers
          PATCH/DELETE /listings/:id
offers    PATCH /offers/:id                              (seller accepts or declines)
sellers   GET  /sellers/:username    POST /sellers/:username/follow · /ratings
stories   GET  /stories              POST /stories
rentals   GET  /rentals · /rentals/:id
          POST /rentals/:id/deposit · /rentals/:id/photos   PATCH /rentals/:id
reports   POST /reports    GET /reports/mine · /reports/banlist
me        GET  /me/saves · /me/listings · /me/offers · /me/following
          GET  /me/notifications · /me/sync   POST /me/notifications/read
admin     GET  /admin/overview · /admin/reports · /admin/users
          PATCH /admin/reports/:id   POST /admin/council-accounts · /admin/users/:username/unban
```

## Stack notes

- **SQLite via `node:sqlite`** — Node's built-in driver, so the API has no native dependencies and
  no database server to install. The whole campus lives in `backend/data/utg.db`.
- **No ORM, no client framework.** Four runtime dependencies on the backend, three on the frontend.
  At this size they would cost more than they return.
- Auth is a JWT bearer token in `localStorage`. For production this should move to an httpOnly
  cookie with CSRF protection.

## Before this goes anywhere near real students

- Real email verification, and rate limiting on sign-up and login.
- Image uploads with size limits, plus moderation on listing photos.
- Move the token out of `localStorage`.
- A real payment integration before any deposit money is actually held.
- Pagination on the feeds — they currently cap at 200 rows.
- The concept sheet's own next step: confirm the posting workflow with ICM and SG representatives,
  then pilot with two or three councils so the hub is not empty on day one.
