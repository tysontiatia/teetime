/** Zip code to state code mapping based on known ranges. */
const ZIP_STATE_RANGES: Array<{ minZip: number; maxZip: number; state: string }> = [
  // Alabama
  { minZip: 35004, maxZip: 36925, state: 'AL' },
  // Alaska
  { minZip: 99501, maxZip: 99950, state: 'AK' },
  // Arizona
  { minZip: 85001, maxZip: 86556, state: 'AZ' },
  // Arkansas
  { minZip: 71601, maxZip: 72959, state: 'AR' },
  // California
  { minZip: 90001, maxZip: 96199, state: 'CA' },
  // Colorado
  { minZip: 80001, maxZip: 81658, state: 'CO' },
  // Connecticut
  { minZip: 6001, maxZip: 6928, state: 'CT' },
  // Delaware
  { minZip: 19701, maxZip: 19980, state: 'DE' },
  // Florida
  { minZip: 32004, maxZip: 34711, state: 'FL' },
  // Georgia
  { minZip: 30001, maxZip: 31999, state: 'GA' },
  // Hawaii
  { minZip: 96701, maxZip: 96899, state: 'HI' },
  // Idaho
  { minZip: 83201, maxZip: 83899, state: 'ID' },
  // Illinois
  { minZip: 60001, maxZip: 62999, state: 'IL' },
  // Indiana
  { minZip: 46001, maxZip: 47997, state: 'IN' },
  // Iowa
  { minZip: 50001, maxZip: 52809, state: 'IA' },
  // Kansas
  { minZip: 66002, maxZip: 67954, state: 'KS' },
  // Kentucky
  { minZip: 40001, maxZip: 42788, state: 'KY' },
  // Louisiana
  { minZip: 70001, maxZip: 71457, state: 'LA' },
  // Maine
  { minZip: 3901, maxZip: 4992, state: 'ME' },
  // Maryland
  { minZip: 20588, maxZip: 21930, state: 'MD' },
  // Massachusetts
  { minZip: 1001, maxZip: 2791, state: 'MA' },
  // Michigan
  { minZip: 48001, maxZip: 49945, state: 'MI' },
  // Minnesota
  { minZip: 55001, maxZip: 56763, state: 'MN' },
  // Mississippi
  { minZip: 38601, maxZip: 39901, state: 'MS' },
  // Missouri
  { minZip: 63001, maxZip: 65899, state: 'MO' },
  // Montana
  { minZip: 59001, maxZip: 59937, state: 'MT' },
  // Nebraska
  { minZip: 68001, maxZip: 69367, state: 'NE' },
  // Nevada
  { minZip: 88901, maxZip: 89883, state: 'NV' },
  // New Hampshire
  { minZip: 3031, maxZip: 3897, state: 'NH' },
  // New Jersey
  { minZip: 7001, maxZip: 8989, state: 'NJ' },
  // New Mexico
  { minZip: 87001, maxZip: 88441, state: 'NM' },
  // New York
  { minZip: 10001, maxZip: 14925, state: 'NY' },
  // North Carolina
  { minZip: 27006, maxZip: 28909, state: 'NC' },
  // North Dakota
  { minZip: 58001, maxZip: 58856, state: 'ND' },
  // Ohio
  { minZip: 43001, maxZip: 45999, state: 'OH' },
  // Oklahoma
  { minZip: 73001, maxZip: 74966, state: 'OK' },
  // Oregon
  { minZip: 97001, maxZip: 97920, state: 'OR' },
  // Pennsylvania
  { minZip: 15001, maxZip: 19640, state: 'PA' },
  // Rhode Island
  { minZip: 2801, maxZip: 2940, state: 'RI' },
  // South Carolina
  { minZip: 29001, maxZip: 29948, state: 'SC' },
  // South Dakota
  { minZip: 57001, maxZip: 57799, state: 'SD' },
  // Tennessee
  { minZip: 37001, maxZip: 38501, state: 'TN' },
  // Texas
  { minZip: 73301, maxZip: 88988, state: 'TX' },
  // Utah
  { minZip: 84001, maxZip: 84791, state: 'UT' },
  // Vermont
  { minZip: 5001, maxZip: 5907, state: 'VT' },
  // Virginia
  { minZip: 20101, maxZip: 24658, state: 'VA' },
  // Washington
  { minZip: 98001, maxZip: 99403, state: 'WA' },
  // West Virginia
  { minZip: 24701, maxZip: 26886, state: 'WV' },
  // Wisconsin
  { minZip: 53001, maxZip: 54990, state: 'WI' },
  // Wyoming
  { minZip: 82001, maxZip: 83128, state: 'WY' },
];

/** Extract a 5-digit ZIP from a free-text location query, if present. */
export function extractZip(query: string): string | null {
  const m = query.trim().match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

/** Look up state code from 5-digit zip code. */
export function zipToState(zip: string): string | null {
  const zipNum = parseInt(zip, 10);
  if (!Number.isFinite(zipNum) || zipNum < 1000 || zipNum > 99999) return null;

  for (const range of ZIP_STATE_RANGES) {
    if (zipNum >= range.minZip && zipNum <= range.maxZip) {
      return range.state;
    }
  }
  return null;
}
