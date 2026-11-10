// A market price against the item's usual one: far above (a single listing
// at a fantasy price after the cheap ones sold), far below (a bargain), and
// "coded" prices (a round sum with a few odd digits: 10,000,123). Shared by
// the Market and Inventory plugins (the same file in both; Market's dev/ci.sh
// checks they match). No page here.
(() => {
  const HIGH = 5; // this many times the usual price: far above
  const LOW = 0.4; // this share of it or less: far below
  const MIN_GAP = 50_000; // and at least this much apart (cheap items jump easily)

  const median = (vals) => {
    const v = vals.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
  };

  /** The fork's price history of a server (copy_prices.py: { hours, days,
   *  items: { id: { h, d } } }), checked, or null. */
  function readHistory(doc) {
    if (!doc || doc.v !== 1 || !Array.isArray(doc.hours) || !Array.isArray(doc.days) || !doc.items || typeof doc.items !== "object") return null;
    return { hours: doc.hours, days: doc.days, items: doc.items, server: doc.server ?? null };
  }

  /** An item's usual lowest listing: the median of its days before today
   *  (at least 3 of them), else of its hours before the last (at least 6),
   *  else null. { price, from: "days" | "hours", n }. */
  function usual(hist, id) {
    const it = hist?.items?.[String(id)];
    if (!it) return null;
    const d = (Array.isArray(it.d) ? it.d.slice(0, -1) : []).filter((x) => x > 0);
    if (d.length >= 3) return { price: median(d), from: "days", n: d.length };
    const h = (Array.isArray(it.h) ? it.h.slice(0, -1) : []).filter((x) => x > 0);
    if (h.length >= 6) return { price: median(h), from: "hours", n: h.length };
    return null;
  }

  /** A round sum and a few odd digits (10,000,123; 20,000,003): what a
   *  seller types to find their buyer's listing, or a placeholder. */
  function coded(price) {
    if (!Number.isFinite(price) || price < 1_000_000) return false;
    const millions = Math.floor(price / 1_000_000);
    const rest = price % 1_000_000;
    return rest > 0 && rest < 1000 && millions % 5 === 0;
  }

  /**
   * What to make of a price `p` ({ price, listings, change, soldAvg }):
   * { kind: "high" | "low" | null, ratio, ref, refFrom, coded, thin, fair }.
   * The reference is the usual price (history), else the average sale, else
   * the price before the last change (aion2.exchange's change %). Far below
   * needs a history or sales: a drop against only the hour before is often
   * the end of an earlier fantasy price. `fair` is what to count it at: the
   * reference when far above, else the price.
   */
  function judge(p, use = null) {
    const price = p?.price;
    if (!(price > 0)) return null;
    let ref = null;
    let refFrom = null;
    if (use?.price > 0) {
      ref = use.price;
      refFrom = use.from;
    } else if (p.soldAvg > 0) {
      ref = p.soldAvg;
      refFrom = "sales";
    } else if (Number.isFinite(p.change) && p.change > -100 && p.change !== 0) {
      ref = Math.round(price / (1 + p.change / 100));
      refFrom = "change";
    }
    const ratio = ref ? price / ref : null;
    let kind = null;
    if (ratio != null && ratio >= HIGH && price - ref >= MIN_GAP) kind = "high";
    else if (ratio != null && ratio <= LOW && ref - price >= MIN_GAP && refFrom !== "change") kind = "low";
    return { kind, ratio, ref, refFrom, coded: coded(price), thin: (p.listings ?? 0) <= 1, fair: kind === "high" ? ref : price };
  }

  /** A plain sentence on why (for a tooltip or a list). */
  function reason(j, kina = (v) => Math.round(v).toLocaleString("en-US")) {
    if (!j) return "";
    const from = { days: "its usual price (median of the last days)", hours: "its usual price (median of the last hours)",
      sales: "its average sale", change: "the lowest listing an hour before" }[j.refFrom] || "";
    const parts = [];
    if (j.kind === "high") parts.push(`${j.ratio >= 100 ? Math.round(j.ratio).toLocaleString("en-US") : j.ratio.toFixed(1)} × ${from} (${kina(j.ref)})`);
    if (j.kind === "low") parts.push(`only ${Math.round(j.ratio * 100)} % of ${from} (${kina(j.ref)})`);
    if (j.thin) parts.push("a single listing");
    if (j.coded) parts.push("a round sum with odd last digits, as sellers use to mark a listing for one buyer");
    return parts.join("; ");
  }

  globalThis.MarketAnomaly = Object.freeze({ readHistory, usual, judge, coded, reason, median, HIGH, LOW });
})();
