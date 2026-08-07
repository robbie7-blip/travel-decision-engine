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
//
// nameBg carries the Bulgarian country name alongside the English one.
// Added after a real bug: the map/checklist/flags/timeline views used to
// show English country names unconditionally even when the rest of the UI
// (tab labels, headings) was switched to Bulgarian — a jarring mixed-
// language experience. getCountryName()/getContinentName() below pick the
// right one from a single Language value, the same pattern lib/i18n.ts
// already uses for every other user-facing string.

import type { Language } from "./types";

export type Continent = "Africa" | "Asia" | "Europe" | "North America" | "Oceania" | "South America";

export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  nameBg: string;
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
  { code: "DZ", name: "Algeria", nameBg: "Алжир", continent: "Africa" },
  { code: "AO", name: "Angola", nameBg: "Ангола", continent: "Africa" },
  { code: "BJ", name: "Benin", nameBg: "Бенин", continent: "Africa" },
  { code: "BW", name: "Botswana", nameBg: "Ботсвана", continent: "Africa" },
  { code: "BF", name: "Burkina Faso", nameBg: "Буркина Фасо", continent: "Africa" },
  { code: "BI", name: "Burundi", nameBg: "Бурунди", continent: "Africa" },
  { code: "CV", name: "Cabo Verde", nameBg: "Кабо Верде", continent: "Africa" },
  { code: "CM", name: "Cameroon", nameBg: "Камерун", continent: "Africa" },
  { code: "CF", name: "Central African Republic", nameBg: "Централноафриканска република", continent: "Africa" },
  { code: "TD", name: "Chad", nameBg: "Чад", continent: "Africa" },
  { code: "KM", name: "Comoros", nameBg: "Коморски острови", continent: "Africa" },
  { code: "CG", name: "Congo", nameBg: "Конго", continent: "Africa" },
  { code: "CD", name: "DR Congo", nameBg: "ДР Конго", continent: "Africa" },
  { code: "DJ", name: "Djibouti", nameBg: "Джибути", continent: "Africa" },
  { code: "EG", name: "Egypt", nameBg: "Египет", continent: "Africa" },
  { code: "GQ", name: "Equatorial Guinea", nameBg: "Екваториална Гвинея", continent: "Africa" },
  { code: "ER", name: "Eritrea", nameBg: "Еритрея", continent: "Africa" },
  { code: "SZ", name: "Eswatini", nameBg: "Есватини", continent: "Africa" },
  { code: "ET", name: "Ethiopia", nameBg: "Етиопия", continent: "Africa" },
  { code: "GA", name: "Gabon", nameBg: "Габон", continent: "Africa" },
  { code: "GM", name: "Gambia", nameBg: "Гамбия", continent: "Africa" },
  { code: "GH", name: "Ghana", nameBg: "Гана", continent: "Africa" },
  { code: "GN", name: "Guinea", nameBg: "Гвинея", continent: "Africa" },
  { code: "GW", name: "Guinea-Bissau", nameBg: "Гвинея-Бисау", continent: "Africa" },
  { code: "CI", name: "Ivory Coast", nameBg: "Бряг на слоновата кост", continent: "Africa" },
  { code: "KE", name: "Kenya", nameBg: "Кения", continent: "Africa" },
  { code: "LS", name: "Lesotho", nameBg: "Лесото", continent: "Africa" },
  { code: "LR", name: "Liberia", nameBg: "Либерия", continent: "Africa" },
  { code: "LY", name: "Libya", nameBg: "Либия", continent: "Africa" },
  { code: "MG", name: "Madagascar", nameBg: "Мадагаскар", continent: "Africa" },
  { code: "MW", name: "Malawi", nameBg: "Малави", continent: "Africa" },
  { code: "ML", name: "Mali", nameBg: "Мали", continent: "Africa" },
  { code: "MR", name: "Mauritania", nameBg: "Мавритания", continent: "Africa" },
  { code: "MU", name: "Mauritius", nameBg: "Мавриций", continent: "Africa" },
  { code: "MA", name: "Morocco", nameBg: "Мароко", continent: "Africa" },
  { code: "MZ", name: "Mozambique", nameBg: "Мозамбик", continent: "Africa" },
  { code: "NA", name: "Namibia", nameBg: "Намибия", continent: "Africa" },
  { code: "NE", name: "Niger", nameBg: "Нигер", continent: "Africa" },
  { code: "NG", name: "Nigeria", nameBg: "Нигерия", continent: "Africa" },
  { code: "RW", name: "Rwanda", nameBg: "Руанда", continent: "Africa" },
  { code: "ST", name: "Sao Tome and Principe", nameBg: "Сао Томе и Принсипи", continent: "Africa" },
  { code: "SN", name: "Senegal", nameBg: "Сенегал", continent: "Africa" },
  { code: "SC", name: "Seychelles", nameBg: "Сейшели", continent: "Africa" },
  { code: "SL", name: "Sierra Leone", nameBg: "Сиера Леоне", continent: "Africa" },
  { code: "SO", name: "Somalia", nameBg: "Сомалия", continent: "Africa" },
  { code: "ZA", name: "South Africa", nameBg: "Южна Африка", continent: "Africa" },
  { code: "SS", name: "South Sudan", nameBg: "Южен Судан", continent: "Africa" },
  { code: "SD", name: "Sudan", nameBg: "Судан", continent: "Africa" },
  { code: "TZ", name: "Tanzania", nameBg: "Танзания", continent: "Africa" },
  { code: "TG", name: "Togo", nameBg: "Того", continent: "Africa" },
  { code: "TN", name: "Tunisia", nameBg: "Тунис", continent: "Africa" },
  { code: "UG", name: "Uganda", nameBg: "Уганда", continent: "Africa" },
  { code: "ZM", name: "Zambia", nameBg: "Замбия", continent: "Africa" },
  { code: "ZW", name: "Zimbabwe", nameBg: "Зимбабве", continent: "Africa" },

  // Asia
  { code: "AF", name: "Afghanistan", nameBg: "Афганистан", continent: "Asia" },
  { code: "AM", name: "Armenia", nameBg: "Армения", continent: "Asia" },
  { code: "AZ", name: "Azerbaijan", nameBg: "Азербайджан", continent: "Asia" },
  { code: "BH", name: "Bahrain", nameBg: "Бахрейн", continent: "Asia" },
  { code: "BD", name: "Bangladesh", nameBg: "Бангладеш", continent: "Asia" },
  { code: "BT", name: "Bhutan", nameBg: "Бутан", continent: "Asia" },
  { code: "BN", name: "Brunei", nameBg: "Бруней", continent: "Asia" },
  { code: "KH", name: "Cambodia", nameBg: "Камбоджа", continent: "Asia" },
  { code: "CN", name: "China", nameBg: "Китай", continent: "Asia" },
  { code: "CY", name: "Cyprus", nameBg: "Кипър", continent: "Asia" },
  { code: "GE", name: "Georgia", nameBg: "Грузия", continent: "Asia" },
  { code: "IN", name: "India", nameBg: "Индия", continent: "Asia" },
  { code: "ID", name: "Indonesia", nameBg: "Индонезия", continent: "Asia" },
  { code: "IR", name: "Iran", nameBg: "Иран", continent: "Asia" },
  { code: "IQ", name: "Iraq", nameBg: "Ирак", continent: "Asia" },
  { code: "IL", name: "Israel", nameBg: "Израел", continent: "Asia" },
  { code: "JP", name: "Japan", nameBg: "Япония", continent: "Asia" },
  { code: "JO", name: "Jordan", nameBg: "Йордания", continent: "Asia" },
  { code: "KZ", name: "Kazakhstan", nameBg: "Казахстан", continent: "Asia" },
  { code: "KW", name: "Kuwait", nameBg: "Кувейт", continent: "Asia" },
  { code: "KG", name: "Kyrgyzstan", nameBg: "Киргизстан", continent: "Asia" },
  { code: "LA", name: "Laos", nameBg: "Лаос", continent: "Asia" },
  { code: "LB", name: "Lebanon", nameBg: "Ливан", continent: "Asia" },
  { code: "MY", name: "Malaysia", nameBg: "Малайзия", continent: "Asia" },
  { code: "MV", name: "Maldives", nameBg: "Малдиви", continent: "Asia" },
  { code: "MN", name: "Mongolia", nameBg: "Монголия", continent: "Asia" },
  { code: "MM", name: "Myanmar", nameBg: "Мианмар", continent: "Asia" },
  { code: "NP", name: "Nepal", nameBg: "Непал", continent: "Asia" },
  { code: "KP", name: "North Korea", nameBg: "Северна Корея", continent: "Asia" },
  { code: "OM", name: "Oman", nameBg: "Оман", continent: "Asia" },
  { code: "PK", name: "Pakistan", nameBg: "Пакистан", continent: "Asia" },
  { code: "PS", name: "Palestine", nameBg: "Палестина", continent: "Asia" },
  { code: "PH", name: "Philippines", nameBg: "Филипини", continent: "Asia" },
  { code: "QA", name: "Qatar", nameBg: "Катар", continent: "Asia" },
  { code: "SA", name: "Saudi Arabia", nameBg: "Саудитска Арабия", continent: "Asia" },
  { code: "SG", name: "Singapore", nameBg: "Сингапур", continent: "Asia" },
  { code: "KR", name: "South Korea", nameBg: "Южна Корея", continent: "Asia" },
  { code: "LK", name: "Sri Lanka", nameBg: "Шри Ланка", continent: "Asia" },
  { code: "SY", name: "Syria", nameBg: "Сирия", continent: "Asia" },
  { code: "TW", name: "Taiwan", nameBg: "Тайван", continent: "Asia" },
  { code: "TJ", name: "Tajikistan", nameBg: "Таджикистан", continent: "Asia" },
  { code: "TH", name: "Thailand", nameBg: "Тайланд", continent: "Asia" },
  { code: "TL", name: "Timor-Leste", nameBg: "Източен Тимор", continent: "Asia" },
  { code: "TR", name: "Turkey", nameBg: "Турция", continent: "Asia" },
  { code: "TM", name: "Turkmenistan", nameBg: "Туркменистан", continent: "Asia" },
  { code: "AE", name: "United Arab Emirates", nameBg: "Обединени арабски емирства", continent: "Asia" },
  { code: "UZ", name: "Uzbekistan", nameBg: "Узбекистан", continent: "Asia" },
  { code: "VN", name: "Vietnam", nameBg: "Виетнам", continent: "Asia" },
  { code: "YE", name: "Yemen", nameBg: "Йемен", continent: "Asia" },

  // Europe
  { code: "AL", name: "Albania", nameBg: "Албания", continent: "Europe" },
  { code: "AD", name: "Andorra", nameBg: "Андора", continent: "Europe" },
  { code: "AT", name: "Austria", nameBg: "Австрия", continent: "Europe" },
  { code: "BY", name: "Belarus", nameBg: "Беларус", continent: "Europe" },
  { code: "BE", name: "Belgium", nameBg: "Белгия", continent: "Europe" },
  { code: "BA", name: "Bosnia and Herzegovina", nameBg: "Босна и Херцеговина", continent: "Europe" },
  { code: "BG", name: "Bulgaria", nameBg: "България", continent: "Europe" },
  { code: "HR", name: "Croatia", nameBg: "Хърватия", continent: "Europe" },
  { code: "CZ", name: "Czechia", nameBg: "Чехия", continent: "Europe" },
  { code: "DK", name: "Denmark", nameBg: "Дания", continent: "Europe" },
  { code: "EE", name: "Estonia", nameBg: "Естония", continent: "Europe" },
  { code: "FI", name: "Finland", nameBg: "Финландия", continent: "Europe" },
  { code: "FR", name: "France", nameBg: "Франция", continent: "Europe" },
  { code: "DE", name: "Germany", nameBg: "Германия", continent: "Europe" },
  { code: "GR", name: "Greece", nameBg: "Гърция", continent: "Europe" },
  { code: "HU", name: "Hungary", nameBg: "Унгария", continent: "Europe" },
  { code: "IS", name: "Iceland", nameBg: "Исландия", continent: "Europe" },
  { code: "IE", name: "Ireland", nameBg: "Ирландия", continent: "Europe" },
  { code: "IT", name: "Italy", nameBg: "Италия", continent: "Europe" },
  { code: "XK", name: "Kosovo", nameBg: "Косово", continent: "Europe" },
  { code: "LV", name: "Latvia", nameBg: "Латвия", continent: "Europe" },
  { code: "LI", name: "Liechtenstein", nameBg: "Лихтенщайн", continent: "Europe" },
  { code: "LT", name: "Lithuania", nameBg: "Литва", continent: "Europe" },
  { code: "LU", name: "Luxembourg", nameBg: "Люксембург", continent: "Europe" },
  { code: "MT", name: "Malta", nameBg: "Малта", continent: "Europe" },
  { code: "MD", name: "Moldova", nameBg: "Молдова", continent: "Europe" },
  { code: "MC", name: "Monaco", nameBg: "Монако", continent: "Europe" },
  { code: "ME", name: "Montenegro", nameBg: "Черна гора", continent: "Europe" },
  { code: "NL", name: "Netherlands", nameBg: "Нидерландия", continent: "Europe" },
  { code: "MK", name: "North Macedonia", nameBg: "Северна Македония", continent: "Europe" },
  { code: "NO", name: "Norway", nameBg: "Норвегия", continent: "Europe" },
  { code: "PL", name: "Poland", nameBg: "Полша", continent: "Europe" },
  { code: "PT", name: "Portugal", nameBg: "Португалия", continent: "Europe" },
  { code: "RO", name: "Romania", nameBg: "Румъния", continent: "Europe" },
  { code: "RU", name: "Russia", nameBg: "Русия", continent: "Europe" },
  { code: "SM", name: "San Marino", nameBg: "Сан Марино", continent: "Europe" },
  { code: "RS", name: "Serbia", nameBg: "Сърбия", continent: "Europe" },
  { code: "SK", name: "Slovakia", nameBg: "Словакия", continent: "Europe" },
  { code: "SI", name: "Slovenia", nameBg: "Словения", continent: "Europe" },
  { code: "ES", name: "Spain", nameBg: "Испания", continent: "Europe" },
  { code: "SE", name: "Sweden", nameBg: "Швеция", continent: "Europe" },
  { code: "CH", name: "Switzerland", nameBg: "Швейцария", continent: "Europe" },
  { code: "UA", name: "Ukraine", nameBg: "Украйна", continent: "Europe" },
  { code: "GB", name: "United Kingdom", nameBg: "Обединено кралство", continent: "Europe" },
  { code: "VA", name: "Vatican City", nameBg: "Ватикана", continent: "Europe" },

  // North America
  { code: "AG", name: "Antigua and Barbuda", nameBg: "Антигуа и Барбуда", continent: "North America" },
  { code: "BS", name: "Bahamas", nameBg: "Бахами", continent: "North America" },
  { code: "BB", name: "Barbados", nameBg: "Барбадос", continent: "North America" },
  { code: "BZ", name: "Belize", nameBg: "Белиз", continent: "North America" },
  { code: "CA", name: "Canada", nameBg: "Канада", continent: "North America" },
  { code: "CR", name: "Costa Rica", nameBg: "Коста Рика", continent: "North America" },
  { code: "CU", name: "Cuba", nameBg: "Куба", continent: "North America" },
  { code: "DM", name: "Dominica", nameBg: "Доминика", continent: "North America" },
  { code: "DO", name: "Dominican Republic", nameBg: "Доминиканска република", continent: "North America" },
  { code: "SV", name: "El Salvador", nameBg: "Ел Салвадор", continent: "North America" },
  { code: "GD", name: "Grenada", nameBg: "Гренада", continent: "North America" },
  { code: "GT", name: "Guatemala", nameBg: "Гватемала", continent: "North America" },
  { code: "HT", name: "Haiti", nameBg: "Хаити", continent: "North America" },
  { code: "HN", name: "Honduras", nameBg: "Хондурас", continent: "North America" },
  { code: "JM", name: "Jamaica", nameBg: "Ямайка", continent: "North America" },
  { code: "MX", name: "Mexico", nameBg: "Мексико", continent: "North America" },
  { code: "NI", name: "Nicaragua", nameBg: "Никарагуа", continent: "North America" },
  { code: "PA", name: "Panama", nameBg: "Панама", continent: "North America" },
  { code: "KN", name: "Saint Kitts and Nevis", nameBg: "Сейнт Китс и Невис", continent: "North America" },
  { code: "LC", name: "Saint Lucia", nameBg: "Сейнт Лусия", continent: "North America" },
  { code: "VC", name: "Saint Vincent and the Grenadines", nameBg: "Сейнт Винсънт и Гренадини", continent: "North America" },
  { code: "TT", name: "Trinidad and Tobago", nameBg: "Тринидад и Тобаго", continent: "North America" },
  { code: "US", name: "United States", nameBg: "Съединени американски щати", continent: "North America" },

  // Oceania
  { code: "AU", name: "Australia", nameBg: "Австралия", continent: "Oceania" },
  { code: "FJ", name: "Fiji", nameBg: "Фиджи", continent: "Oceania" },
  { code: "KI", name: "Kiribati", nameBg: "Кирибати", continent: "Oceania" },
  { code: "MH", name: "Marshall Islands", nameBg: "Маршалови острови", continent: "Oceania" },
  { code: "FM", name: "Micronesia", nameBg: "Микронезия", continent: "Oceania" },
  { code: "NR", name: "Nauru", nameBg: "Науру", continent: "Oceania" },
  { code: "NZ", name: "New Zealand", nameBg: "Нова Зеландия", continent: "Oceania" },
  { code: "PW", name: "Palau", nameBg: "Палау", continent: "Oceania" },
  { code: "PG", name: "Papua New Guinea", nameBg: "Папуа Нова Гвинея", continent: "Oceania" },
  { code: "WS", name: "Samoa", nameBg: "Самоа", continent: "Oceania" },
  { code: "SB", name: "Solomon Islands", nameBg: "Соломонови острови", continent: "Oceania" },
  { code: "TO", name: "Tonga", nameBg: "Тонга", continent: "Oceania" },
  { code: "TV", name: "Tuvalu", nameBg: "Тувалу", continent: "Oceania" },
  { code: "VU", name: "Vanuatu", nameBg: "Вануату", continent: "Oceania" },

  // South America
  { code: "AR", name: "Argentina", nameBg: "Аржентина", continent: "South America" },
  { code: "BO", name: "Bolivia", nameBg: "Боливия", continent: "South America" },
  { code: "BR", name: "Brazil", nameBg: "Бразилия", continent: "South America" },
  { code: "CL", name: "Chile", nameBg: "Чили", continent: "South America" },
  { code: "CO", name: "Colombia", nameBg: "Колумбия", continent: "South America" },
  { code: "EC", name: "Ecuador", nameBg: "Еквадор", continent: "South America" },
  { code: "GY", name: "Guyana", nameBg: "Гаяна", continent: "South America" },
  { code: "PY", name: "Paraguay", nameBg: "Парагвай", continent: "South America" },
  { code: "PE", name: "Peru", nameBg: "Перу", continent: "South America" },
  { code: "SR", name: "Suriname", nameBg: "Суринам", continent: "South America" },
  { code: "UY", name: "Uruguay", nameBg: "Уругвай", continent: "South America" },
  { code: "VE", name: "Venezuela", nameBg: "Венецуела", continent: "South America" },
];

export const TOTAL_COUNTRIES = COUNTRIES.length;

export const CONTINENTS: Continent[] = ["Africa", "Asia", "Europe", "North America", "Oceania", "South America"];

const CONTINENT_NAME_BG: Record<Continent, string> = {
  Africa: "Африка",
  Asia: "Азия",
  Europe: "Европа",
  "North America": "Северна Америка",
  Oceania: "Океания",
  "South America": "Южна Америка",
};

/** Continent section-heading text for the given language — same
 * "resolve per-render, don't store a locale-specific copy" pattern as
 * getCountryName below. */
export function getContinentName(continent: Continent, language: Language): string {
  return language === "bg" ? CONTINENT_NAME_BG[continent] : continent;
}

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function getCountry(code: string): Country | undefined {
  return BY_CODE.get(code.toUpperCase());
}

/** The country's display name in the given language, falling back to the
 * English name if the code isn't tracked (defensive — callers that already
 * checked getCountry() won't hit this, but it keeps the signature simple
 * for call sites that just want a string for a known-tracked code). */
export function getCountryName(code: string, language: Language): string {
  const country = getCountry(code);
  if (!country) return code;
  return language === "bg" ? country.nameBg : country.name;
}
