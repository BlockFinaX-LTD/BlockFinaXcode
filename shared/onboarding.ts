/**
 * Onboarding: the short form every new account completes after sign-in.
 *
 * It asks whether the account is for an individual or an organisation, and a few
 * basic details. No ID numbers or documents: those are asked for when the user
 * first buys protection or creates a pool (see shared/compliance-schema.ts).
 * The same rules run in the app and on the server.
 */

export const ACCOUNT_TYPES = ["individual", "organisation"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const INTENTS = ["payables", "receivables", "underwrite"] as const;
export type Intent = (typeof INTENTS)[number];

export const INTENT_LABELS: Record<AccountType, Record<Intent, { title: string; line: string }>> = {
  individual: {
    payables: { title: "Protect payments I make", line: "Dollar invoices, school fees, imports" },
    receivables: { title: "Protect payments I receive", line: "Dollar income, export proceeds" },
    underwrite: { title: "Underwrite protection", line: "Back contracts with USDC and earn premiums" },
  },
  organisation: {
    payables: { title: "Protect payments we make", line: "Supplier invoices, imports, dollar debt" },
    receivables: { title: "Protect payments we receive", line: "Export proceeds, dollar revenue" },
    underwrite: { title: "Underwrite protection", line: "Back contracts with USDC and earn premiums" },
  },
};

export const INDUSTRIES = [
  "Import and distribution",
  "Export",
  "Manufacturing",
  "Agriculture and food",
  "Energy and infrastructure",
  "Healthcare and pharmaceuticals",
  "Logistics and shipping",
  "Financial services",
  "Payments and fintech",
  "Technology",
  "Education",
  "NGO or development organisation",
  "Government or public body",
  "Other",
] as const;

export const MONTHLY_VOLUMES = [
  "Under $10,000",
  "$10,000 to $100,000",
  "$100,000 to $1 million",
  "$1 million to $10 million",
  "Over $10 million",
] as const;

/** Countries we cover first, then every other ISO 3166 code. Names come from Intl.DisplayNames. */
export const PRIORITY_COUNTRIES = ["GH", "NG", "KE", "ZA", "EG"] as const;
export const COUNTRIES = [
  ...PRIORITY_COUNTRIES,
  ..."AD AE AF AG AI AL AM AO AR AS AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE ER ES ET FI FJ FM FR GA GB GD GE GM GN GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MS MT MU MV MW MX MY MZ NA NE NI NL NO NP NR NZ OM PA PE PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VC VE VG VI VN VU WS XK YE ZM ZW".split(" "),
];

export interface OnboardingInput {
  accountType: AccountType;
  fullName: string;
  country: string;
  intents: Intent[];
  /** Individuals only. */
  phone?: string;
  /** Organisations only. */
  jobTitle?: string;
  legalName?: string;
  registrationCountry?: string;
  registrationNumber?: string;
  industry?: string;
  monthlyVolume?: string;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

/** Cleans the form and returns it with a list of problems, in the order the form shows them. */
export function validateOnboarding(raw: unknown): { value: OnboardingInput; problems: string[] } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const accountType = (ACCOUNT_TYPES as readonly string[]).includes(b.accountType as string) ? (b.accountType as AccountType) : null;
  if (!accountType) problems.push("Choose individual or organisation.");
  const org = accountType === "organisation";

  const fullName = text(b.fullName);
  if (fullName.length < 2 || fullName.length > 120 || !/[A-Za-z\u00C0-\uFFFF]/.test(fullName)) problems.push("Enter your full name.");
  // Both account types give the person's country of residence: it sharpens sanctions screening.
  const country = text(b.country).toUpperCase();
  if (!COUNTRIES.includes(country)) problems.push("Choose your country of residence.");

  const intents = Array.isArray(b.intents)
    ? INTENTS.filter((i) => (b.intents as unknown[]).includes(i))
    : [];
  if (!intents.length) problems.push("Choose at least one thing you want to do.");

  const value: OnboardingInput = { accountType: accountType ?? "individual", fullName, country, intents };

  if (accountType === "individual") {
    const phone = text(b.phone);
    const digits = phone.replace(/\D/g, "");
    if (!/^\+?[\d\s()-]+$/.test(phone) || digits.length < 7 || digits.length > 15) problems.push("Enter a phone number, with the country code.");
    value.phone = phone;
  }

  if (org) {
    const jobTitle = text(b.jobTitle);
    const legalName = text(b.legalName);
    const registrationCountry = text(b.registrationCountry).toUpperCase();
    const registrationNumber = text(b.registrationNumber);
    const industry = text(b.industry);
    const monthlyVolume = text(b.monthlyVolume);
    if (jobTitle.length < 2 || jobTitle.length > 80) problems.push("Enter your job title.");
    if (legalName.length < 2 || legalName.length > 160) problems.push("Enter the organisation's legal name.");
    if (!COUNTRIES.includes(registrationCountry)) problems.push("Choose the country where the organisation is registered.");
    if (registrationNumber.length < 2 || registrationNumber.length > 40) problems.push("Enter the registration number.");
    if (!(INDUSTRIES as readonly string[]).includes(industry)) problems.push("Choose an industry.");
    if (!(MONTHLY_VOLUMES as readonly string[]).includes(monthlyVolume)) problems.push("Choose the expected monthly amount.");
    Object.assign(value, { jobTitle, legalName, registrationCountry, registrationNumber, industry, monthlyVolume });
  }

  return { value, problems };
}

/** The workspace a new account opens in: Underwriter only when that is all they chose. */
export function startingRole(intents: Intent[]): "hedger" | "underwriter" {
  return intents.length === 1 && intents[0] === "underwrite" ? "underwriter" : "hedger";
}
