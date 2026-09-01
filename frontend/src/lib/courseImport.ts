import { slugFromCourseName } from './courseSlug';
import type { CourseRecord } from './courseRecord';

/** One mapped stub ready for POST /admin/courses/import */
export type CourseImportRow = {
  slug: string;
  record: CourseRecord;
};

/** Shared columns from Tee Time Master spreadsheet (Idaho / Utah). */
export type MasterCsvFields = {
  courseName: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  websiteUrl: string;
  region: string;
  placeId: string;
  holes: string;
  yardage: string;
  par: string;
};

/** @deprecated Use MasterCsvFields */
export type IdahoCsvFields = MasterCsvFields;

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function headerKey(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

const STATE_NAME_TO_CODE: Record<string, string> = {
  arizona: 'AZ',
  idaho: 'ID',
  utah: 'UT',
  wyoming: 'WY',
  colorado: 'CO',
  nevada: 'NV',
  'new mexico': 'NM',
};

/** CSV “State” may be AZ or Arizona. */
export function normalizeStateCode(state: string): string {
  const raw = state.trim();
  if (!raw) return '';
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return STATE_NAME_TO_CODE[raw.toLowerCase()] || raw.toUpperCase();
}

const COL = {
  courseName: 'course name',
  streetAddress: 'street address',
  city: 'city',
  state: 'state',
  zip: 'zip',
  phone: 'phone',
  websiteUrl: 'website url',
  region: 'region',
  placeId: 'place id',
  holes: 'holes',
  yardage: 'yardage',
  par: 'par',
} as const;

/** Parse Tee Time Master spreadsheet CSV text into raw field objects (skips blank names). */
export function parseMasterCoursesCsv(text: string): MasterCsvFields[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]!).map(headerKey);
  const idx = (key: string) => headers.indexOf(key);

  const iName = idx(COL.courseName);
  const iStreet = idx(COL.streetAddress);
  const iCity = idx(COL.city);
  const iState = idx(COL.state);
  const iZip = idx(COL.zip);
  const iPhone = idx(COL.phone);
  const iWeb = idx(COL.websiteUrl);
  const iRegion = idx(COL.region);
  const iPlace = idx(COL.placeId);
  const iHoles = idx(COL.holes);
  const iYardage = idx(COL.yardage);
  const iPar = idx(COL.par);

  if (iName < 0) {
    throw new Error('CSV must include a "Course Name" column');
  }

  const cell = (cols: string[], i: number) => (i >= 0 ? (cols[i] || '').trim() : '');

  const out: MasterCsvFields[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r]!);
    const courseName = cell(cols, iName);
    if (!courseName) continue;
    out.push({
      courseName,
      streetAddress: cell(cols, iStreet),
      city: cell(cols, iCity),
      state: cell(cols, iState),
      zip: cell(cols, iZip),
      phone: cell(cols, iPhone),
      websiteUrl: cell(cols, iWeb),
      region: cell(cols, iRegion),
      placeId: cell(cols, iPlace),
      holes: cell(cols, iHoles),
      yardage: cell(cols, iYardage),
      par: cell(cols, iPar),
    });
  }
  return out;
}

/** @deprecated Use parseMasterCoursesCsv */
export const parseIdahoCoursesCsv = parseMasterCoursesCsv;

export function formatUsAddress(street: string, city: string, state: string, zip: string): string {
  const line1 = street.trim();
  const st = state.trim().toUpperCase();
  const z = zip.trim();
  const cityStateZip = [city.trim(), [st, z].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [line1, cityStateZip, 'USA'].filter(Boolean).join(', ');
}

export function timezoneForState(state: string): string {
  const st = normalizeStateCode(state);
  if (st === 'ID') return 'America/Boise';
  if (st === 'AZ') return 'America/Phoenix';
  if (st === 'NV' || st === 'CA') return 'America/Los_Angeles';
  return 'America/Denver';
}

const STATE_AREA_PREFIX: Record<string, string> = {
  ID: 'Idaho',
  UT: 'Utah',
  AZ: 'Arizona',
  WY: 'Wyoming',
  NV: 'Nevada',
  CO: 'Colorado',
  NM: 'New Mexico',
};

export function areaLabelForState(state: string, region: string): string {
  const st = normalizeStateCode(state);
  const reg = region.trim();
  const prefix = STATE_AREA_PREFIX[st];
  if (prefix) return reg ? `${prefix} · ${reg}` : prefix;
  return reg || st || 'Unknown';
}

function parseHolesField(raw: string): 9 | 18 | undefined {
  const n = parseInt(raw.replace(/[^0-9]/g, ''), 10);
  return n === 9 || n === 18 ? n : undefined;
}

function parsePositiveIntField(raw: string): number | undefined {
  const n = parseInt(raw.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Map Master CSV fields → registry stub (empty platform / booking_url). */
export function masterFieldsToImportRow(fields: MasterCsvFields): CourseImportRow {
  const city = fields.city.trim();
  const name = city ? `${fields.courseName.trim()} (${city})` : fields.courseName.trim();
  const state = normalizeStateCode(fields.state);
  const address = formatUsAddress(fields.streetAddress, fields.city, state || fields.state.trim(), fields.zip);
  const record: CourseRecord = {
    name,
    area: areaLabelForState(state, fields.region),
    platform: '',
    booking_url: '',
    timezone: timezoneForState(state),
    booking_status: 'pending',
  };
  if (address) record.address = address;
  if (fields.phone.trim()) record.phone_number = fields.phone.trim();
  if (fields.websiteUrl.trim()) record.website = fields.websiteUrl.trim();
  if (fields.placeId.trim()) record.google_place_id = fields.placeId.trim();
  const holes = parseHolesField(fields.holes || '');
  if (holes) record.holes = holes;
  const yardage = parsePositiveIntField(fields.yardage || '');
  if (yardage) record.yardage = yardage;
  const par = parsePositiveIntField(fields.par || '');
  if (par) record.par = par;
  return {
    slug: slugFromCourseName(name),
    record,
  };
}

/** @deprecated Use masterFieldsToImportRow */
export const idahoFieldsToImportRow = masterFieldsToImportRow;

export function parseMasterCsvToImportRows(text: string): CourseImportRow[] {
  return parseMasterCoursesCsv(text).map(masterFieldsToImportRow);
}

/** @deprecated Use parseMasterCsvToImportRows */
export const parseIdahoCsvToImportRows = parseMasterCsvToImportRows;
