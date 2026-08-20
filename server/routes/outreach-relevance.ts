/**
 * How likely is this post to be about currency risk, and what about it?
 *
 * Weighted rather than a keyword match, because "risk" alone means nothing and
 * "cedi depreciation" means everything. Two points clears the default bar, so a
 * single strong term or two weak ones is enough — the drafter is told to decline
 * an irrelevant post anyway, and this filter exists to save calls rather than to
 * be the last line of judgement.
 *
 * Each signal carries a label as well as a weight. The label is what builds the
 * people list: someone whose posts keep matching "currency" and "importers" is
 * described by what they actually write about, which is a better qualification
 * than their job title. Titles are aspirational; posts are evidence.
 */
const SIGNALS: Array<[RegExp, number, string]> = [
  // The subject itself.
  [/\b(fx|forex|foreign exchange|currency risk|exchange rate)\b/i, 3, "currency"],
  [/\b(hedg\w+|forward contract|currency forward|devalu\w+)\b/i, 3, "hedging"],
  [/\b(cedi|naira|kwacha|shilling|rand|birr|dirham)\b/i, 3, "african-currency"],
  // The people who have it.
  [/\b(import\w*|export\w*|supplier payment|letter of credit|trade finance)\b/i, 2, "trade"],
  [/\b(treasury|working capital|cash ?flow|margin\w*|procurement)\b/i, 2, "treasury"],
  [/\b(cfo|finance director|treasurer|head of finance)\b/i, 2, "finance-lead"],
  // Where.
  [/\b(ghana|nigeria|kenya|africa|frontier market|emerging market)\b/i, 2, "frontier"],
  [/\b(usd\/|usdghs|usdngn|usdkes|dollar shortage|capital control)\b/i, 3, "fx-market"],
  // Adjacent, weak on their own.
  [/\b(stablecoin|usdc|on-?chain|defi)\b/i, 1, "stablecoin"],
  [/\b(volatil\w+|depreciat\w+|inflation)\b/i, 1, "macro"],
];

export function relevanceScore(text: string): number {
  let score = 0;
  for (const [re, weight] of SIGNALS) if (re.test(text)) score += weight;
  return score;
}

/** Which subjects this post touched. Used to describe a person over time. */
export function matchedTopics(text: string): string[] {
  const hits: string[] = [];
  for (const [re, , label] of SIGNALS) if (re.test(text)) hits.push(label);
  return hits;
}
