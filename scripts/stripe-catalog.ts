/** Create (or verify) the Man Friday catalog in Stripe via the Stripe CLI.
 *
 *    npx tsx scripts/stripe-catalog.ts            # test mode, dry run
 *    npx tsx scripts/stripe-catalog.ts --apply    # test mode, create what's missing
 *    npx tsx scripts/stripe-catalog.ts --live --apply
 *
 *  Idempotent: products are found by metadata.mf_key, prices by lookup key.
 *  A price whose amount or interval drifted from lib/site.ts is reported, never
 *  silently changed — Stripe prices are immutable; fix it by creating a new
 *  price and moving the lookup key (transfer_lookup_key) on purpose.
 *  Uses the CLI's own stored login, so no key is read or printed here.
 */
import { execFileSync } from "node:child_process";
import { CATALOG } from "../lib/billing-catalog";

const live = process.argv.includes("--live");
const apply = process.argv.includes("--apply");
const mode = live ? ["--live"] : [];

function stripe(args: string[]): any {
  const out = execFileSync("stripe", [...args, ...mode], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const data = JSON.parse(out);
  if (data.error) throw new Error(`${args.slice(0, 2).join(" ")}: ${data.error.message}`);
  return data;
}

const products: any[] = stripe(["products", "list", "--limit", "100"]).data;
console.log(`${live ? "LIVE" : "TEST"} mode · ${apply ? "apply" : "dry run"}`);

let problems = 0;
for (const item of CATALOG) {
  let product = products.find((p) => p.metadata?.mf_key === item.key && p.metadata?.app === "manfriday");
  if (!product) {
    if (!apply) {
      console.log(`  would create product  ${item.name}`);
    } else {
      const args = ["products", "create", "--name", item.name, "--description", item.description, "-d", `tax_code=${item.taxCode}`];
      for (const [k, v] of Object.entries(item.metadata)) args.push("-d", `metadata[${k}]=${v}`);
      product = stripe(args);
      console.log(`  created product       ${item.name}  ${product.id}`);
    }
  } else if (product.description !== item.description) {
    if (!apply) console.log(`  would update description  ${item.name}`);
    else {
      product = stripe(["products", "update", product.id, "--description", item.description]);
      console.log(`  updated description   ${item.name}`);
    }
  }
  if (product && product.tax_code !== item.taxCode) {
    // Tax code is mutable on a product, so fix it in place.
    if (!apply) console.log(`  would set tax code    ${item.name}  ${product.tax_code ?? "none"} -> ${item.taxCode}`);
    else {
      product = stripe(["products", "update", product.id, "-d", `tax_code=${item.taxCode}`]);
      console.log(`  set tax code          ${item.name}  ${product.tax_code}`);
    }
  } else if (product) {
    console.log(`  ok product            ${item.name}  ${product.id}  ${product.tax_code}${product.active ? "" : "  (ARCHIVED)"}`);
  }

  for (const price of item.prices) {
    const found = stripe(["prices", "list", "-d", `lookup_keys[]=${price.lookupKey}`, "--limit", "1"]).data[0];
    const label = `${price.lookupKey.padEnd(20)} $${(price.amountCents / 100).toFixed(2)}${price.recurring ? ` every ${price.recurring.intervalCount} ${price.recurring.interval}` : " once"}`;
    if (found) {
      const drift =
        found.unit_amount !== price.amountCents ||
        found.currency !== "usd" ||
        (price.recurring
          ? found.recurring?.interval !== price.recurring.interval || found.recurring?.interval_count !== price.recurring.intervalCount
          : found.recurring !== null) ||
        (product && found.product !== product.id);
      if (drift) { problems++; console.log(`    DRIFT price        ${label}  (${found.id} is ${found.unit_amount} ${JSON.stringify(found.recurring)})`); }
      else console.log(`    ok price           ${label}  ${found.id}`);
      continue;
    }
    if (!apply || !product) { console.log(`    would create price ${label}`); continue; }
    const args = [
      "prices", "create", "--product", product.id, "--currency", "usd",
      "--unit-amount", String(price.amountCents), "--lookup-key", price.lookupKey,
      "-d", `metadata[app]=manfriday`, "-d", `metadata[term]=${price.term}`,
      "-d", "tax_behavior=exclusive",
    ];
    if (price.recurring) args.push("-d", `recurring[interval]=${price.recurring.interval}`, "-d", `recurring[interval_count]=${price.recurring.intervalCount}`);
    const created = stripe(args);
    console.log(`    created price      ${label}  ${created.id}`);
  }
}
// ── billing portal: card, invoices, switch plan/period, cancel at period end ──
{
  const fresh: any[] = stripe(["products", "list", "--limit", "100"]).data;
  const subProducts = CATALOG.filter((c) => c.prices.some((p) => p.recurring)).map((c) => {
    const prod = fresh.find((p) => p.metadata?.mf_key === c.key && p.metadata?.app === "manfriday");
    const priceIds = c.prices
      .filter((p) => p.recurring)
      .map((p) => stripe(["prices", "list", "-d", `lookup_keys[]=${p.lookupKey}`, "--limit", "1"]).data[0]?.id)
      .filter(Boolean);
    return prod ? { product: prod.id, prices: priceIds } : null;
  }).filter(Boolean) as { product: string; prices: string[] }[];

  const configs: any[] = stripe(["get", "/v1/billing_portal/configurations", "-d", "limit=20", "-d", "active=true"]).data;
  const existing = configs.find((c) => c.metadata?.app === "manfriday");
  const args: string[] = [
    "-d", "business_profile[headline]=Man Friday — manage your plan",
    "-d", "business_profile[privacy_policy_url]=https://manfriday.app/privacy",
    "-d", "business_profile[terms_of_service_url]=https://manfriday.app/terms",
    "-d", "default_return_url=https://manfriday.app/settings#s-plan",
    "-d", "features[invoice_history][enabled]=true",
    "-d", "features[payment_method_update][enabled]=true",
    "-d", "features[customer_update][enabled]=true",
    "-d", "features[customer_update][allowed_updates][0]=email",
    "-d", "features[customer_update][allowed_updates][1]=address",
    "-d", "features[subscription_cancel][enabled]=true",
    "-d", "features[subscription_cancel][mode]=at_period_end",
    "-d", "features[subscription_update][enabled]=true",
    "-d", "features[subscription_update][default_allowed_updates][0]=price",
    "-d", "features[subscription_update][proration_behavior]=create_prorations",
    "-d", "metadata[app]=manfriday",
  ];
  subProducts.forEach((sp, i) => {
    args.push("-d", `features[subscription_update][products][${i}][product]=${sp.product}`);
    sp.prices.forEach((pid, j) => args.push("-d", `features[subscription_update][products][${i}][prices][${j}]=${pid}`));
  });
  if (!apply) console.log(`  ${existing ? "would update" : "would create"} billing portal configuration`);
  else if (existing) { stripe(["post", `/v1/billing_portal/configurations/${existing.id}`, ...args]); console.log(`  updated portal config ${existing.id}`); }
  else { const c = stripe(["post", "/v1/billing_portal/configurations", ...args]); console.log(`  created portal config ${c.id}`); }
}

if (problems) { console.log(`\n${problems} price(s) drifted from lib/site.ts`); process.exit(1); }
