/**
 * How likely is this post to be about currency risk?
 *
 * Weighted rather than a keyword match, because "risk" alone means nothing and
 * "cedi depreciation" means everything. Two points clears the default bar, so a
 * single strong term or two weak ones is enough — the drafter is told to decline
 * an irrelevant post anyway, and this filter exists to save calls rather than to
 * be the last line of judgement.
 */
const SIGNALS: Array<[RegExp, number]> = [
  // The subject itself.
  [/\b(fx|forex|foreign exchange|currency risk|exchange rate)\b/i, 3],
  [/\b(hedg\w+|forward contract|currency forward|devalu\w+)\b/i, 3],
  [/\b(cedi|naira|kwacha|shilling|rand|birr|dirham)\b/i, 3],
  // The people who have it.
  [/\b(import\w*|export\w*|supplier payment|letter of credit|trade finance)\b/i, 2],
  [/\b(treasury|working capital|cash ?flow|margin\w*|procurement)\b/i, 2],
  [/\b(cfo|finance director|treasurer|head of finance)\b/i, 2],
  // Where.
  [/\b(ghana|nigeria|kenya|africa|frontier market|emerging market)\b/i, 2],
  [/\b(usd\/|usdghs|usdngn|usdkes|dollar shortage|capital control)\b/i, 3],
  // Adjacent, weak on their own.
  [/\b(stablecoin|usdc|on-?chain|defi)\b/i, 1],
  [/\b(volatil\w+|depreciat\w+|inflation)\b/i, 1],
];

export function relevanceScore(text: string): number {
  let score = 0;
  for (const [re, weight] of SIGNALS) if (re.test(text)) score += weight;
  return score;
}
