import { ethers } from "ethers";
const RPCS = ["https://base.llamarpc.com","https://base-rpc.publicnode.com","https://mainnet.base.org","https://1rpc.io/base"];
const D = "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef";
const abi = [
 "function getTotalHedgeEvents() view returns (uint256)",
 "function getEventPositionIds(uint256) view returns (uint256[])",
 "function getHedgePosition(uint256) view returns (uint256 id, uint256 eventId, address hedger, uint256 notional, uint256 premiumPaid, uint256 platformFeePaid, uint256 payoutAmount, uint8 status, bool claimed)",
];
let c = null;
for (const r of RPCS) {
  try { const p = new ethers.JsonRpcProvider(r, undefined, { staticNetwork: true });
        const t = new ethers.Contract(D, abi, p); await t.getTotalHedgeEvents();
        c = t; console.log(`rpc: ${r}`); break; } catch { console.log(`  ${r} unusable`); }
}
if (!c) { console.log("all RPCs failed"); process.exit(0); }
const n = await c.getTotalHedgeEvents();
console.log(`total events on Base: ${n}\n`);
const u = v => Number(ethers.formatUnits(v, 6));
let found = 0;
for (let e = 0; e <= Number(n) && found < 4; e++) {
  let ids = []; try { ids = await c.getEventPositionIds(e); } catch { continue; }
  for (const id of ids) {
    let q; try { q = await c.getHedgePosition(id); } catch { continue; }
    const notional = u(q.notional), prem = u(q.premiumPaid), fee = u(q.platformFeePaid);
    console.log(`position #${id} (event ${q.eventId}): notional $${notional} · premium $${prem} · fee $${fee}`);
    if (notional) process.stdout.write(`   fee/notional ${(fee/notional*100).toFixed(3)}%`);
    if (prem) process.stdout.write(`   fee/premium ${(fee/prem*100).toFixed(3)}%`);
    console.log(notional && Math.abs(fee/notional-0.05)<1e-6 ? "   ← NOTIONAL BASIS" : "");
    if (++found >= 4) break;
  }
}
if (!found) console.log("no positions exist on Base to measure");
