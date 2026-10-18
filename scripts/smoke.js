"use strict";
// Drives the running demo (npm run demo) through the full story via its HTTP API.
// Exit code 0 only if every step behaves as the protocol requires.
const BASE = "http://127.0.0.1:3000/api/";
const post = async (p, b) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) });
  return { status: r.status, json: await r.json() };
};
const get = async (p) => (await fetch(BASE + p)).json();
let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${extra}`);
  if (!cond) failures++;
};

(async () => {
  const inv = (await post("invoice", { amountEth: "0.25", memo: "smoke" })).json.invoice;
  check("invoice created", !!inv);
  const dep = (await post("deposit", { eth: "1" })).json;
  check("deposit", dep.ok);
  const pay = (await post("pay", { invoiceId: inv.id, noteIndex: dep.note, mode: "relayer" })).json;
  check("pay via relayer", pay.ok, pay.ok ? `(proof ${pay.proveMs} ms, gas ${pay.gasUsed})` : pay.error);
  const st = await get("state");
  check("tx sender is the relayer, not the payer", pay.txFrom !== st.payerAddress);
  const scan = (await post("merchant/scan")).json;
  check("merchant detects stealth payment", scan.found === 1);
  const sweep = (await post("merchant/sweep")).json;
  check("merchant sweeps one-time address", Number(sweep.swept) > 0.2, `(${sweep.swept} ETH)`);

  const rc = (await post("receipt", { paymentIndex: 0 })).json;
  check("receipt proof", rc.ok, `(${rc.proveMs} ms)`);
  const v1 = await post("verify", rc.receipt);
  check("verifier accepts receipt", v1.status === 200 && v1.json.ok);
  const v2 = await post("verify", rc.receipt);
  check("verifier rejects replay", v2.status === 409);

  const dis = (await post("disclosure", { paymentIndex: 0 })).json;
  const aud = (await post("audit", dis.disclosure)).json;
  check("auditor verifies disclosed payment", aud.ok);
  const forged = (await post("audit", { ...dis.disclosure, amount: "1" })).json;
  check("auditor rejects forged disclosure", !forged.ok);

  await post("policy", { block: true });
  const blocked = await post("deposit", { eth: "0.1" });
  check("blocked payer cannot deposit", !blocked.json.ok);
  await post("policy", { block: false });

  const obs = await get("observer");
  const payEv = obs.find((o) => o.kind === "Payment");
  check("observer sees payment sent by relayer", payEv && payEv.from !== st.payerAddress);

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll smoke checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
