// BuyWise deterministic source-quality classification. NO LLM. Configurable.
// Tier is EVIDENCE strength, never product quality. Unknown domains -> LOW (0.3).
// Override via scoring_configs.source_quality_map: { tier_name: [domain_substrings] }.

export const DEFAULT_TIERS = [
  { tier: "HIGH", score: 1.0, label: "official manufacturer", domains: ["dell.com", "hp.com", "lenovo.com", "asus.com", "acer.com", "apple.com", "samsung.com", "msi.com"] },
  { tier: "HIGH", score: 0.9, label: "major retailer / official store", domains: ["costco.com", "walmart.com", "bestbuy.com", "croma.com", "vijaysales.com", "reliancedigital.in", "dellstore.com", "amazon.", "flipkart."] },
  { tier: "MEDIUM", score: 0.8, label: "reputable specialist source", domains: ["91mobiles.com", "91laptop.com", "gsmarena.com", "notebookcheck.net", "rtings.com", "tomshardware.com", "cnet.com", "theverge.com"] },
  { tier: "MEDIUM", score: 0.6, label: "general publication", domains: ["hindustantimes.com", "yahoo.com", "businessinsider.com", "ndtv.com", "indiatoday.in", "gadgets360.com", "bbc.com", "nytimes.com"] },
  { tier: "MEDIUM", score: 0.4, label: "video / user-generated", domains: ["youtube.com", "youtu.be", "reddit.com"] },
  { tier: "LOW", score: 0.3, label: "social media", domains: ["instagram.com", "facebook.com", "twitter.com", "x.com", "tiktok.com", "linkedin.com"] },
];

export function classifySource(url, customMap = null) {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return { tier: "LOW", score: 0.3, label: "unparseable url", matched: null }; }
  const tiers = normalizeMap(customMap) ?? DEFAULT_TIERS;
  for (const t of tiers) {
    const hit = t.domains.find((d) => host.includes(d.toLowerCase()));
    if (hit) return { tier: t.tier, score: t.score, label: t.label, matched: hit };
  }
  if (/\.gov(\.|$)|\.edu(\.|$)/.test(host)) return { tier: "MEDIUM", score: 0.6, label: "public institution", matched: host };
  return { tier: "LOW", score: 0.3, label: "unknown/random source", matched: null };
}

// customMap shape: { HIGH: {score: {label: [domains]}}, ... } flattened from scoring_configs JSONB.
// Returns tier-array or null when empty/invalid (caller falls back to DEFAULT_TIERS).
export function normalizeMap(customMap) {
  if (!customMap || typeof customMap !== "object" || Array.isArray(customMap)) return null;
  const out = [];
  for (const [tier, scores] of Object.entries(customMap)) {
    if (!["HIGH", "MEDIUM", "LOW"].includes(tier) || !scores || typeof scores !== "object") continue;
    for (const [scoreStr, labels] of Object.entries(scores)) {
      const score = Number(scoreStr);
      if (!(score >= 0 && score <= 1) || !labels || typeof labels !== "object") continue;
      for (const [label, domains] of Object.entries(labels)) {
        if (Array.isArray(domains) && domains.length) out.push({ tier, score, label, domains });
      }
    }
  }
  return out.length ? out : null;
}
