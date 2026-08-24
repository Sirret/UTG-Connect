/**
 * Seeds a demo campus so the concept can actually be judged: real-looking
 * councils, deadlines, listings, an accepted rental and an open dispute.
 *
 *   npm run seed     — top up an existing database
 *   npm run reset    — wipe and rebuild from scratch
 */
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

if (process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = config.dbPath + suffix;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  console.log('Wiped existing database.');
}

const { db, all, get, run } = await import('./db.js');

const hash = (pw) => bcrypt.hashSync(pw, 10);
const PW = 'utgconnect1';

// SQLite timestamp helpers — everything stored as "YYYY-MM-DD HH:MM:SS" UTC.
const at = (days, hour = 10) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

if (get('SELECT COUNT(*) AS n FROM schools').n > 0) {
  console.log('Database already has data. Use `npm run reset` for a clean rebuild.');
  process.exit(0);
}

// --- Schools ----------------------------------------------------------------

const schools = [
  { code: 'UTGSU', name: 'Campus-Wide (UTGSU)', color: '#1d4ed8', campusWide: 1 },
  { code: 'SAS', name: 'School of Arts and Sciences', color: '#7c3aed', campusWide: 0 },
  { code: 'ITCA', name: 'School of Information Technology and Communication', color: '#0891b2', campusWide: 0 },
  { code: 'BPA', name: 'School of Business and Public Administration', color: '#b45309', campusWide: 0 },
  { code: 'AGRI', name: 'School of Agriculture and Environmental Sciences', color: '#15803d', campusWide: 0 },
  { code: 'EDU', name: 'School of Education', color: '#be123c', campusWide: 0 },
];

for (const s of schools) {
  run('INSERT INTO schools (code, name, color, is_campus_wide) VALUES (?, ?, ?, ?)', [
    s.code,
    s.name,
    s.color,
    s.campusWide,
  ]);
}
const schoolId = Object.fromEntries(all('SELECT id, code FROM schools').map((s) => [s.code, s.id]));

// --- Accounts ---------------------------------------------------------------

const addUser = (u) =>
  Number(
    run(
      `INSERT INTO users (email, password_hash, name, username, role, school_id, bio, avatar_url, whatsapp, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        u.email,
        hash(PW),
        u.name,
        u.username,
        u.role || 'student',
        u.school ? schoolId[u.school] : null,
        u.bio || '',
        u.avatar || null,
        u.whatsapp || null,
      ],
    ).lastInsertRowid,
  );

addUser({
  email: `admin@${config.emailDomain}`,
  name: 'Platform Admin',
  username: 'admin',
  role: 'admin',
  school: 'UTGSU',
  bio: 'Runs the approval queue and dispute reviews.',
});

// Council accounts belong to the office, not the current officer — no re-verification
// each year when student leadership changes hands.
const councilId = {};
for (const s of schools) {
  councilId[s.code] = addUser({
    email: `${s.code.toLowerCase()}.council@${config.emailDomain}`,
    name: `${s.name} Council`,
    username: `${s.code.toLowerCase()}-council`,
    role: 'council',
    school: s.code,
    bio: 'Official council account. Stays with the council, not the person.',
  });
}

const students = [
  { email: `fatou.jallow@${config.emailDomain}`, name: 'Fatou Jallow', username: 'fatoujay', school: 'ITCA', whatsapp: '+2203001001', bio: 'Second-year IT. I flip laptops and sell chargers that actually work.', avatar: 'https://picsum.photos/seed/fatou/200/200' },
  { email: `lamin.ceesay@${config.emailDomain}`, name: 'Lamin Ceesay', username: 'laminc', school: 'BPA', whatsapp: '+2203001002', bio: 'Business student. Weekend snack hustle — benachin and pastries.', avatar: 'https://picsum.photos/seed/lamin/200/200' },
  { email: `awa.touray@${config.emailDomain}`, name: 'Awa Touray', username: 'awahair', school: 'SAS', whatsapp: '+2203001003', bio: 'Braiding and twists between lectures. Hostel A.', avatar: 'https://picsum.photos/seed/awa/200/200' },
  { email: `modou.sanneh@${config.emailDomain}`, name: 'Modou Sanneh', username: 'modoutech', school: 'ITCA', whatsapp: '+2203001004', bio: 'Rent a laptop or a calculator for the exam week.', avatar: 'https://picsum.photos/seed/modou/200/200' },
  { email: `isatou.bah@${config.emailDomain}`, name: 'Isatou Bah', username: 'isatoubooks', school: 'EDU', whatsapp: '+2203001005', bio: 'Textbook reseller. Education and Arts titles mostly.', avatar: 'https://picsum.photos/seed/isatou/200/200' },
  { email: `ousman.jarju@${config.emailDomain}`, name: 'Ousman Jarju', username: 'ousmanshoots', school: 'AGRI', whatsapp: '+2203001006', bio: 'Event photography and graduation shoots.', avatar: 'https://picsum.photos/seed/ousman/200/200' },
  { email: `binta.camara@${config.emailDomain}`, name: 'Binta Camara', username: 'bintac', school: 'BPA', whatsapp: '+2203001007', bio: 'Just here to buy.', avatar: 'https://picsum.photos/seed/binta/200/200' },
];
const uid = {};
for (const s of students) uid[s.username] = addUser(s);

// --- Council & admin directory (the Info tab) -------------------------------

const directory = {
  ITCA: [
    ['Sainey Njie', 'President', 'Anything the council handles overall; escalations', 'itca.president@utg.edu.gm'],
    ['Mariama Sowe', 'Academic Affairs Officer', 'Course registration, exam clashes, missing results', 'itca.academics@utg.edu.gm'],
    ['Alhagie Bah', 'Financial Secretary', 'Departmental dues, receipts, payment deadlines', 'itca.finance@utg.edu.gm'],
    ['Ndey Faal', 'Welfare Officer', 'Hostel, food, health and personal issues', '+220 300 2001', 'phone'],
  ],
  SAS: [
    ['Ebrima Manneh', 'President', 'Overall council matters', 'sas.president@utg.edu.gm'],
    ['Aji Sarr', 'Academic Affairs Officer', 'Lecture schedules, exam issues, transcripts', 'sas.academics@utg.edu.gm'],
    ['Yankuba Drammeh', 'Welfare Officer', 'Housing, food and student wellbeing', 'sas.welfare@utg.edu.gm'],
  ],
  BPA: [
    ['Haddy Njie', 'President', 'Overall council matters', 'bpa.president@utg.edu.gm'],
    ['Sulayman Bojang', 'Financial Secretary', 'Dues, internship fees, payment dates', 'bpa.finance@utg.edu.gm'],
  ],
  AGRI: [
    ['Musa Darboe', 'President', 'Overall council matters', 'agri.president@utg.edu.gm'],
    ['Fatima Sanyang', 'Field Practicum Officer', 'Farm placement, practicum sign-up, transport', 'agri.practicum@utg.edu.gm'],
  ],
  EDU: [
    ['Kaddy Touray', 'President', 'Overall council matters', 'edu.president@utg.edu.gm'],
    ['Omar Jammeh', 'Teaching Practice Officer', 'School placement, supervision visits, logbooks', 'edu.tp@utg.edu.gm'],
  ],
  UTGSU: [
    ['Muhammed Colley', 'UTGSU President', 'University-wide student representation', 'utgsu.president@utg.edu.gm'],
    ['Adama Jallow', 'Secretary General', 'Minutes, elections, official notices', 'utgsu.sg@utg.edu.gm'],
  ],
};

for (const [code, members] of Object.entries(directory)) {
  members.forEach(([name, position, handles, contact, kind = 'email'], i) => {
    run(
      `INSERT INTO council_members (school_id, name, position, handles, contact, contact_kind, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [schoolId[code], name, position, handles, contact, kind, i],
    );
  });
}

// --- Events, deadlines and payment dates ------------------------------------

const posts = [
  ['UTGSU', 'payment', 'Semester tuition — second instalment due', 'Pay at the bursary or by mobile money. Late payment blocks exam entry.', at(3, 16), 'Bursary, Kanifing', 'published'],
  ['UTGSU', 'event', 'UTG Inter-School Sports Day', 'All schools compete. Buses leave the main gate at 7:30am.', at(9, 8), 'Faraba Campus Field', 'published'],
  ['UTGSU', 'announcement', 'Library opening hours extended for exams', 'The library now closes at 10pm on weekdays until the end of exams.', null, 'Library', 'published'],
  ['ITCA', 'deadline', 'Final year project proposal submission', 'Hard copy to the department office plus the online form. No extensions this round.', at(1, 17), 'ITCA Department Office', 'published'],
  ['ITCA', 'event', 'ITCA Tech Week — opening ceremony', 'Demos, a hackathon and a career panel. Open to every school.', at(12, 9), 'ITCA Auditorium', 'published'],
  ['ITCA', 'payment', 'Departmental dues — D250', 'Covers the Tech Week t-shirt and refreshments. Pay the Financial Secretary.', at(6, 12), 'ITCA Common Room', 'published'],
  ['SAS', 'deadline', 'Course add / drop closes', 'After this date your registration is locked for the semester.', at(2, 15), 'Online portal', 'published'],
  ['SAS', 'event', 'Arts Night: poetry and performance', 'Sign-up sheet with the Welfare Officer. Entry is free.', at(5, 18), 'SAS Hall', 'published'],
  ['BPA', 'payment', 'Internship placement fee', 'Required before placement letters are issued.', at(4, 14), 'BPA Office', 'published'],
  ['BPA', 'event', 'Guest lecture: starting a business in The Gambia', 'Speaker from GCCI. Attendance counts toward the entrepreneurship module.', at(7, 11), 'BPA Lecture Room 2', 'published'],
  ['AGRI', 'deadline', 'Field practicum sign-up closes', 'Choose your farm placement before the list is finalised.', at(2, 12), 'AGRI Department', 'published'],
  ['AGRI', 'event', 'Tree planting exercise', 'Meet at the main gate. Bring gloves if you have them.', at(14, 7), 'Faraba Campus', 'published'],
  ['EDU', 'deadline', 'Teaching practice logbook submission', 'Signed by your supervising teacher, no exceptions.', at(8, 16), 'EDU Department Office', 'published'],
  ['EDU', 'announcement', 'New supervisors assigned for Term 2', 'Check the noticeboard or the Info tab for your supervisor.', null, null, 'published'],
  // Sitting in the approval queue, to demo the light verification step.
  ['SAS', 'event', 'Weekend study group — Statistics', 'Informal, Saturday mornings in the library.', at(4, 9), 'Library, Room 3', 'pending'],
  ['BPA', 'announcement', 'Lost ID card found near the cafeteria', 'Collect it from the BPA office with proof of identity.', null, 'BPA Office', 'pending'],
];

for (const [code, kind, title, body, startsAt, location, status] of posts) {
  run(
    `INSERT INTO posts (school_id, author_id, title, body, kind, starts_at, location, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [schoolId[code], councilId[code], title, body, kind, startsAt, location, status],
  );
}

// --- Marketplace ------------------------------------------------------------

const listings = [
  // seller, section, category, title, description, price, unit, image seed, pickup, deposit
  ['fatoujay', 'goods', 'electronics', 'Anker 20W fast charger (new)', 'Genuine, boxed. Charges an iPhone to 50% in about half an hour.', 850, 'item', 'charger', 'Main Gate', 0],
  ['fatoujay', 'goods', 'phones', 'Infinix Hot 30 — used, clean', 'Six months old, battery still strong. Screen has no cracks.', 6500, 'item', 'infinix', 'Library', 0],
  ['fatoujay', 'goods', 'electronics', 'USB-C to HDMI adapter', 'For presentations. Tested with the ITCA projectors.', 600, 'item', 'adapter', 'Library', 0],
  ['laminc', 'goods', 'food', 'Weekend benachin — plate', 'Cooked Saturday morning, collect by 1pm. Order the day before.', 120, 'item', 'benachin', 'Hostel A', 0],
  ['laminc', 'goods', 'food', 'Meat pies (pack of 5)', 'Fresh, made Friday night. Sells out fast.', 150, 'item', 'pies', 'Cafeteria', 0],
  ['isatoubooks', 'goods', 'books', 'Educational Psychology — 6th ed.', 'Used, some highlighting in chapters 3 and 4. Otherwise clean.', 900, 'item', 'psychbook', 'Library', 0],
  ['isatoubooks', 'goods', 'books', 'Intro to Statistics (with solutions)', 'The edition SAS actually uses this semester.', 1100, 'item', 'statsbook', 'Library', 0],
  ['awahair', 'services', 'hair', 'Knotless braids — small', 'Takes about four hours. Bring your own extensions or pay extra.', 700, 'item', 'braids', 'Hostel A', 0],
  ['awahair', 'services', 'hair', 'Twists and retouch', 'Evenings and weekends only.', 400, 'item', 'twists', 'Hostel A', 0],
  ['ousmanshoots', 'services', 'photography', 'Graduation photo session', 'One hour, 30 edited photos delivered on WhatsApp.', 2500, 'item', 'gradphoto', 'Faraba Campus', 0],
  ['ousmanshoots', 'services', 'dj', 'DJ for a small event', 'Speakers and lights included. Campus events only.', 4000, 'item', 'dj', 'Main Gate', 0],
  ['modoutech', 'services', 'tutoring', 'Programming tutoring (Python, Java)', 'One-on-one or small group. First session free.', 200, 'hour', 'tutoring', 'Library', 0],
  ['modoutech', 'rent', 'laptops', 'HP ProBook — rent by the day', 'For project week. Charger included. ID required at handoff.', 500, 'day', 'laptop', 'ITCA Common Room', 3000],
  ['modoutech', 'rent', 'calculators', 'Casio fx-991EX scientific calculator', 'Exam-approved. Rent for the exam period.', 100, 'day', 'calculator', 'Library', 0],
  ['bintac', 'rent', 'formal-wear', 'Men’s suit — size M', 'For presentations and defence day. Dry-cleaned between rentals.', 1200, 'day', 'suit', 'Hostel B', 2000],
  ['isatoubooks', 'rent', 'textbooks', 'Research Methods textbook — weekly rent', 'Cheaper than buying if you only need it for one module.', 250, 'week', 'methods', 'Library', 0],
];

const listingId = {};
for (const [seller, section, category, title, description, price, unit, seed, pickup, deposit] of listings) {
  const info = run(
    `INSERT INTO listings (seller_id, school_id, section, category, title, description, price, price_unit,
                           currency, deposit, image_url, pickup_point, accepts_offers, status)
     VALUES (?, (SELECT school_id FROM users WHERE id = ?), ?, ?, ?, ?, ?, ?, 'GMD', ?, ?, ?, 1, 'active')`,
    [
      uid[seller],
      uid[seller],
      section,
      category,
      title,
      description,
      price,
      unit,
      deposit,
      `https://picsum.photos/seed/${seed}/600/600`,
      pickup,
    ],
  );
  listingId[title] = Number(info.lastInsertRowid);
}

// A scheduled "drop" — goes live on its own once the countdown runs out.
run(
  `INSERT INTO listings (seller_id, school_id, section, category, title, description, price, price_unit,
                         currency, image_url, pickup_point, status, drops_at)
   VALUES (?, (SELECT school_id FROM users WHERE id = ?), 'goods', 'clothing',
           'Limited hoodie drop — ITCA Tech Week', 'Only 20 made. Goes live Friday evening.', 1500, 'item',
           'GMD', 'https://picsum.photos/seed/hoodie/600/600', 'ITCA Common Room', 'scheduled', ?)`,
  [uid.fatoujay, uid.fatoujay, at(2, 18)],
);

// Views and saves, so "Trending" has something real to rank.
const bump = (title, views, savers) => {
  run('UPDATE listings SET views = ? WHERE id = ?', [views, listingId[title]]);
  for (const u of savers) run('INSERT OR IGNORE INTO saves (user_id, listing_id) VALUES (?, ?)', [uid[u], listingId[title]]);
};
bump('Infinix Hot 30 — used, clean', 210, ['bintac', 'laminc', 'awahair', 'isatoubooks']);
bump('Knotless braids — small', 175, ['bintac', 'isatoubooks', 'fatoujay']);
bump('HP ProBook — rent by the day', 140, ['bintac', 'laminc']);
bump('Weekend benachin — plate', 95, ['modoutech']);
bump('Anker 20W fast charger (new)', 60, ['modoutech']);

// Stories (expire after a day)
for (const [seller, text, title] of [
  ['laminc', 'Benachin ready Saturday 12pm 🍲', 'Weekend benachin — plate'],
  ['fatoujay', 'Restocked chargers — 6 left', 'Anker 20W fast charger (new)'],
  ['awahair', 'Two slots open today only', 'Knotless braids — small'],
]) {
  run(
    "INSERT INTO stories (seller_id, text, listing_id, expires_at) VALUES (?, ?, ?, datetime('now', '+1 day'))",
    [uid[seller], text, listingId[title]],
  );
}

// --- Offers, a rating, a rental and a dispute -------------------------------

const offer = (buyer, title, amount, message, status) =>
  Number(
    run('INSERT INTO offers (listing_id, buyer_id, amount, message, status) VALUES (?, ?, ?, ?, ?)', [
      listingId[title],
      uid[buyer],
      amount,
      message,
      status,
    ]).lastInsertRowid,
  );

offer('bintac', 'Infinix Hot 30 — used, clean', 6000, 'Can you do 6000 cash today?', 'pending');
offer('laminc', 'Anker 20W fast charger (new)', 750, 'I will take two if you do 750 each.', 'pending');
offer('isatoubooks', 'Knotless braids — small', 650, 'Saturday morning if possible.', 'accepted');
offer('bintac', 'HP ProBook — rent by the day', 450, 'Three days for project week.', 'accepted');

run(
  `INSERT INTO ratings (seller_id, rater_id, stars, comment) VALUES
     (?, ?, 5, 'Fast, neat work and she kept to the time.'),
     (?, ?, 5, 'Charger was genuine, no problems.'),
     (?, ?, 4, 'Laptop worked fine, handed back on time.')`,
  [uid.awahair, uid.isatoubooks, uid.fatoujay, uid.laminc, uid.modoutech, uid.bintac],
);

// A live rental with the deposit already held and a handoff photo on file.
const rentalId = Number(
  run(
    `INSERT INTO rentals (listing_id, lender_id, borrower_id, amount, deposit, deposit_state, deposit_ref, due_at, status)
     VALUES (?, ?, ?, 450, 3000, 'held', 'MM-DEMO12345', ?, 'handed_off')`,
    [listingId['HP ProBook — rent by the day'], uid.modoutech, uid.bintac, at(3, 17)],
  ).lastInsertRowid,
);
run(
  `INSERT INTO condition_photos (rental_id, user_id, phase, photo_url, note) VALUES
     (?, ?, 'handoff', 'https://picsum.photos/seed/handoff1/600/400', 'Screen clean, small scratch on the lid'),
     (?, ?, 'handoff', 'https://picsum.photos/seed/handoff2/600/400', 'Agreed — scratch was already there')`,
  [rentalId, uid.modoutech, rentalId, uid.bintac],
);

// An open report waiting on admin review — evidence attached, as required.
run(
  `INSERT INTO reports (reporter_id, accused_id, rental_id, reason, evidence_url)
   VALUES (?, ?, ?, 'Laptop returned two days late and the charger was missing', 'https://picsum.photos/seed/evidence/600/400')`,
  [uid.modoutech, uid.bintac, rentalId],
);

run(
  `INSERT INTO notifications (user_id, kind, text, link) VALUES
     (?, 'offer', 'Binta Camara offered 6000 GMD for "Infinix Hot 30 — used, clean"', '/me?tab=offers'),
     (?, 'post', 'UTGSU: Semester tuition — second instalment due — 3 days left', '/'),
     (?, 'rental', 'Deposit of 3000 GMD is held for "HP ProBook — rent by the day"', '/me?tab=rentals')`,
  [uid.fatoujay, uid.bintac, uid.modoutech],
);

console.log(`
Seeded UTG Connect.

  Schools:   ${schools.map((s) => s.code).join(', ')}
  Posts:     ${get('SELECT COUNT(*) AS n FROM posts').n} (${get("SELECT COUNT(*) AS n FROM posts WHERE status='pending'").n} awaiting approval)
  Listings:  ${get('SELECT COUNT(*) AS n FROM listings').n}
  Users:     ${get('SELECT COUNT(*) AS n FROM users').n}

Every account uses the password: ${PW}

  admin@${config.emailDomain}              platform admin (approval queue, disputes)
  itca.council@${config.emailDomain}       ITCA council — can post to ITCA only
  fatou.jallow@${config.emailDomain}       student + seller
  bintac / binta.camara@${config.emailDomain}  student with an open rental and a dispute
`);

db.close();
