// Country reference data for the visited-places tracker (lib/visited.ts) —
// 197 entries: the 193 UN member states plus the Holy See, Palestine,
// Taiwan, and Kosovo (all four widely tracked by travel apps despite
// contested/partial recognition — deliberately included rather than
// omitted, since "have you been there" doesn't hinge on UN membership).
// Grouped by continent for the stats breakdown and the tracker UI's
// section headings. ISO 3166-1 (or, for Kosovo, the commonly-used
// provisional "XK") alpha-2 codes throughout — the code, not the name
// string, is the stored/keyed value everywhere else in this feature
// (lib/visited.ts, the API routes) so renaming a country never touches
// stored data.

export type Continent = "Africa" | "Asia" | "Europe" | "North America" | "Oceania" | "South America";

export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  continent: Continent;
}

/** Flag emoji derived from the ISO code algorithmically (each letter maps to
 * a Unicode "regional indicator symbol") rather than stored per-country —
 * one formula instead of 195 hand-copied emoji to keep in sync. */
export function countryFlagEmoji(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
}

export const COUNTRIES: Country[] = [
  // Africa
  { code: "DZ", name: "Algeria", continent: "Africa" },
  { code: "AO", name: "Angola", continent: "Africa" },
  { code: "BJ", name: "Benin", continent: "Africa" },
  { code: "BW", name: "Botswana", continent: "Africa" },
  { code: "BF", name: "Burkina Faso", continent: "Africa" },
  { code: "BI", name: "Burundi", continent: "Africa" },
  { code: "CV", name: "Cabo Verde", continent: "Africa" },
  { code: "CM", name: "Cameroon", continent: "Africa" },
  { code: "CF", name: "Central African Republic", continent: "Africa" },
  { code: "TD", name: "Chad", continent: "Africa" },
  { code: "KM", name: "Comoros", continent: "Africa" },
  { code: "CG", name: "Congo", continent: "Africa" },
  { code: "CD", name: "DR Congo", continent: "Africa" },
  { code: "DJ", name: "Djibouti", continent: "Africa" },
  { code: "EG", name: "Egypt", continent: "Africa" },
  { code: "GQ", name: "Equatorial Guinea", continent: "Africa" },
  { code: "ER", name: "Eritrea", continent: "Africa" },
  { code: "SZ", name: "Eswatini", continent: "Africa" },
  { code: "ET", name: "Ethiopia", continent: "Africa" },
  { code: "GA", name: "Gabon", continent: "Africa" },
  { code: "GM", name: "Gambia", continent: "Africa" },
  { code: "GH", name: "Ghana", continent: "Africa" },
  { code: "GN", name: "Guinea", continent: "Africa" },
  { code: "GW", name: "Guinea-Bissau", continent: "Africa" },
  { code: "CI", name: "Ivory Coast", continent: "Africa" },
  { code: "KE", name: "Kenya", continent: "Africa" },
  { code: "LS", name: "Lesotho", continent: "Africa" },
  { code: "LR", name: "Liberia", continent: "Africa" },
  { code: "LY", name: "Libya", continent: "Africa" },
  { code: "MG", name: "Madagascar", continent: "Africa" },
  { code: "MW", name: "Malawi", continent: "Africa" },
  { code: "ML", name: "Mali", continent: "Africa" },
  { code: "MR", name: "Mauritania", continent: "Africa" },
  { code: "MU", name: "Mauritius", continent: "Africa" },
  { code: "MA", name: "Morocco", continent: "Africa" },
  { code: "MZ", name: "Mozambique", continent: "Africa" },
  { code: "NA", name: "Namibia", continent: "Africa" },
  { code: "NE", name: "Niger", continent: "Africa" },
  { code: "NG", name: "Nigeria", continent: "Africa" },
  { code: "RW", name: "Rwanda", continent: "Africa" },
  { code: "ST", name: "Sao Tome and Principe", continent: "Africa" },
  { code: "SN", name: "Senegal", continent: "Africa" },
  { code: "SC", name: "Seychelles", continent: "Africa" },
  { code: "SL", name: "Sierra Leone", continent: "Africa" },
  { code: "SO", name: "Somalia", continent: "Africa" },
  { code: "ZA", name: "South Africa", continent: "Africa" },
  { code: "SS", name: "South Sudan", continent: "Africa" },
  { code: "SD", name: "Sudan", continent: "Africa" },
  { code: "TZ", name: "Tanzania", continent: "Africa" },
  { code: "TG", name: "Togo", continent: "Africa" },
  { code: "TN", name: "Tunisia", continent: "Africa" },
  { code: "UG", name: "Uganda", continent: "Africa" },
  { code: "ZM", name: "Zambia", continent: "Africa" },
  { code: "ZW", name: "Zimbabwe", continent: "Africa" },

  // Asia
  { code: "AF", name: "Afghanistan", continent: "Asia" },
  { code: "AM", name: "Armenia", continent: "Asia" },
  { code: "AZ", name: "Azerbaijan", continent: "Asia" },
  { code: "BH", name: "Bahrain", continent: "Asia" },
  { code: "BD", name: "Bangladesh", continent: "Asia" },
  { code: "BT", name: "Bhutan", continent: "Asia" },
  { code: "BN", name: "Brunei", continent: "Asia" },
  { code: "KH", name: "Cambodia", continent: "Asia" },
  { code: "CN", name: "China", continent: "Asia" },
  { code: "CY", name: "Cyprus", continent: "Asia" },
  { code: "GE", name: "Georgia", continent: "Asia" },
  { code: "IN", name: "India", continent: "Asia" },
  { code: "ID", name: "Indonesia", continent: "Asia" },
  { code: "IR", name: "Iran", continent: "Asia" },
  { code: "IQ", name: "Iraq", continent: "Asia" },
  { code: "IL", name: "Israel", continent: "Asia" },
  { code: "JP", name: "Japan", continent: "Asia" },
  { code: "JO", name: "Jordan", continent: "Asia" },
  { code: "KZ", name: "Kazakhstan", continent: "Asia" },
  { code: "KW", name: "Kuwait", continent: "Asia" },
  { code: "KG", name: "Kyrgyzstan", continent: "Asia" },
  { code: "LA", name: "Laos", continent: "Asia" },
  { code: "LB", name: "Lebanon", continent: "Asia" },
  { code: "MY", name: "Malaysia", continent: "Asia" },
  { code: "MV", name: "Maldives", continent: "Asia" },
  { code: "MN", name: "Mongolia", continent: "Asia" },
  { code: "MM", name: "Myanmar", continent: "Asia" },
  { code: "NP", name: "Nepal", continent: "Asia" },
  { code: "KP", name: "North Korea", continent: "Asia" },
  { code: "OM", name: "Oman", continent: "Asia" },
  { code: "PK", name: "Pakistan", continent: "Asia" },
  { code: "PS", name: "Palestine", continent: "Asia" },
  { code: "PH", name: "Philippines", continent: "Asia" },
  { code: "QA", name: "Qatar", continent: "Asia" },
  { code: "SA", name: "Saudi Arabia", continent: "Asia" },
  { code: "SG", name: "Singapore", continent: "Asia" },
  { code: "KR", name: "South Korea", continent: "Asia" },
  { code: "LK", name: "Sri Lanka", continent: "Asia" },
  { code: "SY", name: "Syria", continent: "Asia" },
  { code: "TW", name: "Taiwan", continent: "Asia" },
  { code: "TJ", name: "Tajikistan", continent: "Asia" },
  { code: "TH", name: "Thailand", continent: "Asia" },
  { code: "TL", name: "Timor-Leste", continent: "Asia" },
  { code: "TR", name: "Turkey", continent: "Asia" },
  { code: "TM", name: "Turkmenistan", continent: "Asia" },
  { code: "AE", name: "United Arab Emirates", continent: "Asia" },
  { code: "UZ", name: "Uzbekistan", continent: "Asia" },
  { code: "VN", name: "Vietnam", continent: "Asia" },
  { code: "YE", name: "Yemen", continent: "Asia" },

  // Europe
  { code: "AL", name: "Albania", continent: "Europe" },
  { code: "AD", name: "Andorra", continent: "Europe" },
  { code: "AT", name: "Austria", continent: "Europe" },
  { code: "BY", name: "Belarus", continent: "Europe" },
  { code: "BE", name: "Belgium", continent: "Europe" },
  { code: "BA", name: "Bosnia and Herzegovina", continent: "Europe" },
  { code: "BG", name: "Bulgaria", continent: "Europe" },
  { code: "HR", name: "Croatia", continent: "Europe" },
  { code: "CZ", name: "Czechia", continent: "Europe" },
  { code: "DK", name: "Denmark", continent: "Europe" },
  { code: "EE", name: "Estonia", continent: "Europe" },
  { code: "FI", name: "Finland", continent: "Europe" },
  { code: "FR", name: "France", continent: "Europe" },
  { code: "DE", name: "Germany", continent: "Europe" },
  { code: "GR", name: "Greece", continent: "Europe" },
  { code: "HU", name: "Hungary", continent: "Europe" },
  { code: "IS", name: "Iceland", continent: "Europe" },
  { code: "IE", name: "Ireland", continent: "Europe" },
  { code: "IT", name: "Italy", continent: "Europe" },
  { code: "XK", name: "Kosovo", continent: "Europe" },
  { code: "LV", name: "Latvia", continent: "Europe" },
  { code: "LI", name: "Liechtenstein", continent: "Europe" },
  { code: "LT", name: "Lithuania", continent: "Europe" },
  { code: "LU", name: "Luxembourg", continent: "Europe" },
  { code: "MT", name: "Malta", continent: "Europe" },
  { code: "MD", name: "Moldova", continent: "Europe" },
  { code: "MC", name: "Monaco", continent: "Europe" },
  { code: "ME", name: "Montenegro", continent: "Europe" },
  { code: "NL", name: "Netherlands", continent: "Europe" },
  { code: "MK", name: "North Macedonia", continent: "Europe" },
  { code: "NO", name: "Norway", continent: "Europe" },
  { code: "PL", name: "Poland", continent: "Europe" },
  { code: "PT", name: "Portugal", continent: "Europe" },
  { code: "RO", name: "Romania", continent: "Europe" },
  { code: "RU", name: "Russia", continent: "Europe" },
  { code: "SM", name: "San Marino", continent: "Europe" },
  { code: "RS", name: "Serbia", continent: "Europe" },
  { code: "SK", name: "Slovakia", continent: "Europe" },
  { code: "SI", name: "Slovenia", continent: "Europe" },
  { code: "ES", name: "Spain", continent: "Europe" },
  { code: "SE", name: "Sweden", continent: "Europe" },
  { code: "CH", name: "Switzerland", continent: "Europe" },
  { code: "UA", name: "Ukraine", continent: "Europe" },
  { code: "GB", name: "United Kingdom", continent: "Europe" },
  { code: "VA", name: "Vatican City", continent: "Europe" },

  // North America
  { code: "AG", name: "Antigua and Barbuda", continent: "North America" },
  { code: "BS", name: "Bahamas", continent: "North America" },
  { code: "BB", name: "Barbados", continent: "North America" },
  { code: "BZ", name: "Belize", continent: "North America" },
  { code: "CA", name: "Canada", continent: "North America" },
  { code: "CR", name: "Costa Rica", continent: "North America" },
  { code: "CU", name: "Cuba", continent: "North America" },
  { code: "DM", name: "Dominica", continent: "North America" },
  { code: "DO", name: "Dominican Republic", continent: "North America" },
  { code: "SV", name: "El Salvador", continent: "North America" },
  { code: "GD", name: "Grenada", continent: "North America" },
  { code: "GT", name: "Guatemala", continent: "North America" },
  { code: "HT", name: "Haiti", continent: "North America" },
  { code: "HN", name: "Honduras", continent: "North America" },
  { code: "JM", name: "Jamaica", continent: "North America" },
  { code: "MX", name: "Mexico", continent: "North America" },
  { code: "NI", name: "Nicaragua", continent: "North America" },
  { code: "PA", name: "Panama", continent: "North America" },
  { code: "KN", name: "Saint Kitts and Nevis", continent: "North America" },
  { code: "LC", name: "Saint Lucia", continent: "North America" },
  { code: "VC", name: "Saint Vincent and the Grenadines", continent: "North America" },
  { code: "TT", name: "Trinidad and Tobago", continent: "North America" },
  { code: "US", name: "United States", continent: "North America" },

  // Oceania
  { code: "AU", name: "Australia", continent: "Oceania" },
  { code: "FJ", name: "Fiji", continent: "Oceania" },
  { code: "KI", name: "Kiribati", continent: "Oceania" },
  { code: "MH", name: "Marshall Islands", continent: "Oceania" },
  { code: "FM", name: "Micronesia", continent: "Oceania" },
  { code: "NR", name: "Nauru", continent: "Oceania" },
  { code: "NZ", name: "New Zealand", continent: "Oceania" },
  { code: "PW", name: "Palau", continent: "Oceania" },
  { code: "PG", name: "Papua New Guinea", continent: "Oceania" },
  { code: "WS", name: "Samoa", continent: "Oceania" },
  { code: "SB", name: "Solomon Islands", continent: "Oceania" },
  { code: "TO", name: "Tonga", continent: "Oceania" },
  { code: "TV", name: "Tuvalu", continent: "Oceania" },
  { code: "VU", name: "Vanuatu", continent: "Oceania" },

  // South America
  { code: "AR", name: "Argentina", continent: "South America" },
  { code: "BO", name: "Bolivia", continent: "South America" },
  { code: "BR", name: "Brazil", continent: "South America" },
  { code: "CL", name: "Chile", continent: "South America" },
  { code: "CO", name: "Colombia", continent: "South America" },
  { code: "EC", name: "Ecuador", continent: "South America" },
  { code: "GY", name: "Guyana", continent: "South America" },
  { code: "PY", name: "Paraguay", continent: "South America" },
  { code: "PE", name: "Peru", continent: "South America" },
  { code: "SR", name: "Suriname", continent: "South America" },
  { code: "UY", name: "Uruguay", continent: "South America" },
  { code: "VE", name: "Venezuela", continent: "South America" },
];

export const TOTAL_COUNTRIES = COUNTRIES.length;

export const CONTINENTS: Continent[] = ["Africa", "Asia", "Europe", "North America", "Oceania", "South America"];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function getCountry(code: string): Country | undefined {
  return BY_CODE.get(code.toUpperCase());
}
