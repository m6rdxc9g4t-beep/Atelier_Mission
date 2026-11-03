// Adresse saisie en texte libre (« 12 rue des Artisans\n69002 Lyon ») → champs structurés de la facture électronique
// (EN 16931 : BT-35 ligne 1, BT-36 ligne 2, BT-38 code postal, BT-37 ville, BT-40 pays).

export interface PostalAddress {
  lines: string[]
  postcode: string | null
  city: string | null
  countryCode: string
}

const COUNTRY_NAMES: Record<string, string> = {
  france: 'FR',
  belgique: 'BE',
  belgium: 'BE',
  suisse: 'CH',
  switzerland: 'CH',
  luxembourg: 'LU',
  allemagne: 'DE',
  germany: 'DE',
  espagne: 'ES',
  italie: 'IT',
  'pays-bas': 'NL',
  'royaume-uni': 'GB',
  canada: 'CA',
}

/** « 69002 Lyon », « 69002 LYON CEDEX 02 », « B-1000 Bruxelles », « 1000 Bruxelles ». */
const POSTCODE_CITY = /^(?:[A-Z]{1,2}-)?(\d{4,5})\s+(.+)$/i

export function parseAddress(raw: string | null | undefined, defaultCountry = 'FR'): PostalAddress {
  const rows = (raw ?? '')
    .split(/\r?\n|,(?=\s*\d{4,5}\s)/)
    .map((r) => r.trim())
    .filter(Boolean)
  let countryCode = defaultCountry
  const last = rows[rows.length - 1]
  if (last && COUNTRY_NAMES[last.toLowerCase()]) {
    countryCode = COUNTRY_NAMES[last.toLowerCase()]!
    rows.pop()
  }
  let postcode: string | null = null
  let city: string | null = null
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const match = POSTCODE_CITY.exec(rows[i]!)
    if (match) {
      postcode = match[1]!
      city = match[2]!.trim()
      rows.splice(i, 1)
      break
    }
  }
  return { lines: rows.slice(0, 3), postcode, city, countryCode }
}
