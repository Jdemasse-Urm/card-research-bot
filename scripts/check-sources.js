// Read-only smoke test of the free data sources (no API key needed): npm run check
import * as pc from "../lib/sources/pricecharting.js";
import * as ygo from "../lib/sources/ygoprodeck.js";
import * as op from "../lib/sources/onepiece.js";

const show = (label, v) => console.log(`\n== ${label}\n` + JSON.stringify(v, null, 1).slice(0, 1500));

const s = await pc.search("ken griffey jr 1989 upper deck 1");
show("PriceCharting search", s.slice(0, 3));
const c = await pc.card(s[0].url);
show("PriceCharting card", { title: c.title, set: c.set, priceGuide: c.priceGuide, volume: c.salesVolume, trend: c.trendPct, salesGrades: Object.keys(c.recentSales), sample: Object.values(c.recentSales)[0]?.slice(0, 3) });
show("Yu-Gi-Oh", (await ygo.lookup("Dark Magician Girl")).slice(0, 1).map((x) => ({ ...x, printings: x.printings.slice(0, 3) })));
show("One Piece", (await op.lookup("Monkey.D.Luffy OP05-119")).slice(0, 4));
console.log("\nAll sources OK");
