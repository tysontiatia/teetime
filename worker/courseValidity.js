/**
 * Jev checks a discovered course against the evidence the crawler already gathered.
 * Code decides whether that course is added, held, or skipped.
 */

import { shouldImport, toImportRecord } from './bookingDiscovery.js';

const NO = 0.2;
const KIND_CONFIDENCE = 0.55;

function text(value, max = 400) {
  return String(value || '').trim().slice(0, max);
}

function questionsFor(course) {
  const questions = {
    kind: {
      type: 'choice',
      instructions: {
        question: 'What kind of place is this?',
        focus: 'Use `map_name`, `google_name`, `address`, and `page_text`.',
      },
      criteria: {
        public_course: {
          what: 'An outdoor golf course where the public can play',
          not_for: 'Members-only clubs, simulators, mini golf, or a closed business',
          examples: ['Municipal 18-hole course', 'Public daily-fee course'],
        },
        private_club: {
          what: 'A golf club that is members-only',
          not_for: 'A public course that also offers a membership',
          examples: ['Private country club', 'Members and guests only'],
        },
        not_a_course: {
          what: 'Not a playable outdoor golf course',
          not_for: 'A real golf course that also has a range or a restaurant',
          examples: ['Topgolf', 'Indoor simulator', 'Mini golf', 'Driving range only', 'Hotel'],
        },
        closed: {
          what: 'A golf course that is permanently closed',
          not_for: 'A course that is open for the season',
          examples: ['Permanently closed', 'No longer operating'],
        },
      },
    },
  };

  if (course.google_place_id) {
    questions.same_place = {
      type: 'noul',
      instructions: 'Are `map_name` and `google_name` the same golf course at `address`?',
      criteria: {
        true: 'The names are the same place, including a rename or a small spelling difference',
        false: 'They are different places, or the Google place is missing',
      },
    };
  }
  if (course.website) {
    questions.own_website = {
      type: 'noul',
      instructions: 'Is `website` this course’s own website?',
      criteria: {
        true: 'The page is the course, the club, or the city department that operates it',
        false: 'A directory, a booking marketplace, or a different business',
      },
    };
  }
  if (course.phone_number && course.page_text) {
    questions.phone_supported = {
      type: 'noul',
      instructions: 'Does `page_text` support `phone` as this course’s phone number?',
      criteria: {
        true: 'The page shows that phone number',
        false: 'The page shows a different number or no number',
      },
    };
  }
  if ((course.holes || course.par || course.yardage) && course.page_text) {
    questions.layout_supported = {
      type: 'noul',
      instructions: 'Does `page_text` support the holes, par, and yardage that are present? A blank value is not a contradiction.',
      criteria: {
        true: 'Every present layout number appears on the page',
        false: 'A present layout number conflicts with the page',
      },
    };
  }
  if (course.editorial_note && course.page_text) {
    questions.about_supported = {
      type: 'noul',
      instructions: 'Does `page_text` support `about` as a description of this course?',
      criteria: {
        true: 'The description comes from this page and describes this course',
        false: 'The description is about something else or is not on the page',
      },
    };
  }
  return questions;
}

function stateFor(course) {
  return {
    map_name: text(course.osm_name || course.name, 160),
    google_name: text(course.name, 160),
    address: text(course.address, 240),
    city: text(course.city, 80),
    state: text(course.state, 40),
    website: text(course.website, 240),
    phone: text(course.phone_number, 40),
    holes: course.holes || null,
    par: course.par || null,
    yardage: course.yardage || null,
    about: text(course.editorial_note, 600),
    booking_url: text(course.booking_url, 300),
    booking_vendor: text(course.platform, 40),
    page_text: text(course.page_text, 1800),
  };
}

async function askJev(course, apiKey) {
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'jev-latest',
      state: stateFor(course),
      questions: questionsFor(course),
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`validity_${res.status}`);
  const body = await res.json();
  return body.answers || {};
}

function publishAs(course, keepBooking) {
  const platform = String(course.platform || '').trim();
  if (keepBooking && course.booking_url && platform && course.support === 'live_ready') {
    return { booking_status: 'ready', note: 'Added. Tee times publish on Find.' };
  }
  if (keepBooking && course.booking_url) {
    return { booking_status: 'unsupported', note: 'Added with a booking link.' };
  }
  if (course.phone_number || course.website) {
    return { booking_status: 'phone', note: 'Added. Players call the pro shop.' };
  }
  return null;
}

export function decideCourseValidity(answers, course) {
  const kind = answers?.kind;
  if (kind?.confidence >= KIND_CONFIDENCE) {
    if (kind.choice === 'not_a_course') return { action: 'skip', note: 'Not a public golf course.' };
    if (kind.choice === 'closed') return { action: 'skip', note: 'Looks closed.' };
    if (kind.choice === 'private_club') return { action: 'skip', note: 'Looks members-only.' };
  }
  if (course.google_place_id && typeof answers?.same_place?.noul === 'number' && answers.same_place.noul <= NO) {
    return { action: 'skip', note: 'The map pin and the Google place do not match.' };
  }

  const drops = [];
  for (const field of ['phone_supported', 'layout_supported', 'about_supported']) {
    if (answers?.[field] && answers[field].noul <= NO) drops.push(field);
  }
  const keepBooking = Boolean(course.booking_url);
  const dropWebsite = Boolean(course.website && answers?.own_website && answers.own_website.noul <= NO);
  const published = publishAs({ ...course, website: dropWebsite ? '' : course.website }, keepBooking);
  if (!published) {
    return {
      action: 'review',
      note: 'Needs a booking link, website, or phone number.',
      booking_status: 'phone',
      keepBooking: false,
      drops,
    };
  }
  return { action: 'import', drops, keepBooking, dropWebsite, ...published };
}

function applyDecision(course, decision) {
  const next = { ...course };
  delete next.page_text;
  next.validity = { action: decision.action, note: decision.note };
  if (decision.action === 'skip') {
    next.import_row = null;
    return next;
  }

  if (decision.drops?.includes('phone_supported')) next.phone_number = '';
  if (decision.drops?.includes('layout_supported')) {
    delete next.holes;
    delete next.par;
    delete next.yardage;
  }
  if (decision.drops?.includes('about_supported')) next.editorial_note = '';
  if (decision.dropWebsite) next.website = '';
  if (next.booking_url && decision.keepBooking === false) {
    next.booking_url = '';
    next.platform = null;
    next.hints = {};
    next.support = 'none';
    next.note = 'Booking link was not this course’s tee sheet.';
  }
  if (decision.booking_status) next.booking_status = decision.booking_status;
  if (!shouldImport(next)) next.support = next.booking_url ? 'link_only' : 'none';
  next.import_row = next.name ? toImportRecord(next) : null;
  if (!next.import_row) {
    next.validity = { action: 'review', note: 'This course is missing a name to save.' };
  }
  return next;
}

export async function applyCourseValidity(course, env) {
  if (course?.catalog_match || course?.support === 'catalog_match') {
    const next = { ...course };
    delete next.page_text;
    next.validity = { action: 'skip', note: course.note || 'Already on tee-time.io.' };
    next.import_row = null;
    return next;
  }
  if (course?.support === 'closed' || course?.booking_status === 'closed') {
    const next = { ...course };
    delete next.page_text;
    next.validity = { action: 'skip', note: course.note || 'Looks closed.' };
    next.import_row = null;
    return next;
  }
  if (!env?.TYPESAFE_API_KEY) {
    const next = { ...course };
    delete next.page_text;
    next.validity = { action: 'review', note: 'Validity check is not configured, so this course is held.' };
    return next;
  }
  try {
    const answers = await askJev(course, env.TYPESAFE_API_KEY);
    return applyDecision(course, decideCourseValidity(answers, course));
  } catch {
    const next = { ...course };
    delete next.page_text;
    next.validity = { action: 'review', note: 'Validity check failed, so this course is held.' };
    return next;
  }
}
