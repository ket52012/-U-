// u-query: TRC20/ERC20 地址查询站 (Cloudflare Workers + D1)
// 玻璃拟态 UI，支持 USDT 转账历史、收支统计、安全检测

const BG_URL = "https://t.633668.xyz/file/1782251244863_16pic_8721377_b.jpg";
const TRONGRID = "https://api.trongrid.io";
const USDT_TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDT_ETH = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const ETH_RPC = "https://ethereum-rpc.publicnode.com";
const APPROVE_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";

// ---------- 硬编码配置（无数据库） ----------
const CONFIG = {
  site_title: "U查询",
  energy_title: "⚡️ TRON 波场能量租赁｜低成本转账\n💰 2 TRX = 65K 能量\n📌 能量需求参考\n🔹 转账给没有 USDT 的地址：需要 130K 能量（4 TRX）\n🔹 转账给已有 USDT 的地址：需要 65K 能量（2 TRX）\n🚀 使用方法\n转账前，向下方能量租赁地址转入对应数量的 TRX，即可获取能量，降低 USDT 转账所需的 TRX 费用！\n📋 能量租赁地址（点击复制）\n                     ⬇️⬇️⬇️",
  energy_addr: "TELGi717vptMEB3k2j2ipTm283HiKtBp76",
  energy_btn: "复制地址",
  exchange_title: "24小时自动U换TRX 1U起换 最高2000U\n转U给这个地址 会有别的地址自动给你转TRX",
  exchange_addr: "",
  exchange_btn: "复制地址",
  tg_label: "TG客服",
  tg_btn: "联系",
  tg_url: "",
  report_url: "",
  footer_text: "志远导航",
  footer_url: "https://633668.xyz",
  trongrid_key: "",
  etherscan_key: ""
};

// ---------- 通用工具 ----------
function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtNum(n) {
  if (!isFinite(n)) return "0";
  let s = n.toFixed(6).replace(/\.?0+$/, "");
  return s === "" ? "0" : s;
}
function fmtTrunc2(n) {
  if (!isFinite(n)) return "0.00";
  return (Math.floor(n * 100) / 100).toFixed(2);
}
function fmtTime(ms) {
  if (!ms) return "-";
  const d = new Date(Number(ms) + 8 * 3600 * 1000); // 转北京时间
  const p = (x) => String(x).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " +
    p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
}
function b58encode(bytes) {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let z = 0;
  while (z < bytes.length && bytes[z] === 0) z++;
  let n = 0n;
  for (let i = z; i < bytes.length; i++) n = n * 256n + BigInt(bytes[i]);
  let s = "";
  while (n > 0n) { s = A[Number(n % 58n)] + s; n = n / 58n; }
  return "1".repeat(z) + (s || "");
}
async function hexToTronAddr(hex) {
  const bs = new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16)));
  const h1 = await crypto.subtle.digest("SHA-256", bs);
  const h2 = await crypto.subtle.digest("SHA-256", h1);
  const full = new Uint8Array(bs.length + 4);
  full.set(bs, 0);
  full.set(new Uint8Array(h2).slice(0, 4), bs.length);
  return b58encode(full);
}
// base58 转 hex（41开头）
function tronAddrToHex(addr) {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of addr) { n = n * 58n + BigInt(A.indexOf(c)); }
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  // 去掉末尾4字节校验码，保留21字节（41+20）
  const bs = new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16)));
  return Array.from(bs.slice(0, 21)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// 查 USDT 当前授权额度（链上实时）
async function getUsdtAllowance(ownerHex, spenderHex) {
  try {
    const param = "000000000000000000000000" + ownerHex.slice(2) + "000000000000000000000000" + spenderHex.slice(2);
    const r = await fetch(TRONGRID + "/wallet/triggerconstantcontract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner_address: ownerHex,
        contract_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c", // USDT
        function_selector: "allowance(address,address)",
        parameter: param
      })
    });
    if (!r.ok) return null;
    const j = await r.json();
    const hex = ((j.constant_result || [])[0] || "0x0");
    return BigInt(hex);
  } catch (e) { return null; }
}

// ---------- D1 设置（/admin 后台可改） ----------
async function getSettings(env) {
  const out = Object.assign({}, CONFIG);
  try {
    const r = await env.DB.prepare("SELECT k,v FROM settings").all();
    (r.results || []).forEach((row) => { out[row.k] = row.v; });
  } catch (e) { /* 表不存在时用默认 */ }
  out.trongrid_key = (env.TRONGRID_KEY || out.trongrid_key || "");
  out.etherscan_key = (env.ETHERSCAN_KEY || out.etherscan_key || "");
  return out;
}
async function saveSettings(env, obj) {
  const keys = Object.keys(CONFIG).concat(["trongrid_key", "etherscan_key"]);
  for (const k of keys) {
    if (obj[k] !== undefined) {
      await env.DB.prepare("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
        .bind(k, String(obj[k])).run();
    }
  }
}

// ---------- TronGrid 客户端（带 429 重试） ----------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function tgFetch(path, key, method, body) {
  const headers = {};
  if (key) headers["TRON-PRO-API-KEY"] = key;
  let lastErr = null;
  for (let i = 0; i < 6; i++) {
    const opt = { headers };
    if (method === "POST") { opt.method = "POST"; opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
    let r;
    try { r = await fetch(TRONGRID + path, opt); }
    catch (e) { lastErr = e; await sleep(1000 * (i + 1)); continue; }
    if (r.status === 429 || r.status >= 500) {
      lastErr = new Error("TronGrid 繁忙(" + r.status + ")，稍后重试");
      await sleep(1200 * (i + 1));
      continue;
    }
    if (!r.ok) throw new Error("TronGrid 请求失败(" + r.status + ")");
    return r.json();
  }
  throw lastErr;
}
async function tgGet(path, key) { return tgFetch(path, key, "GET"); }
async function tgPost(path, body, key) { return tgFetch(path, key, "POST", body); }

async function queryTron(address, settings, onP) {
  const key = settings.trongrid_key || "";
  const addrL = address.toLowerCase();
  const base = "/v1/accounts/" + address;
  const prog = (m, p) => { if (onP) { try { onP(m, p); } catch (e) {} } };

  // 首批并行：账户信息、能量、第一页转账、最早一笔、授权扫描
  const acctP = tgGet(base, key);
  const energyP = tgPost("/wallet/getaccountresource", { address, visible: true }, key).catch(() => null);
  const page1P = tgGet(base + "/transactions/trc20?contract_address=" + USDT_TRON + "&limit=200&order_by=block_timestamp,desc", key);
  const firstP = tgGet(base + "/transactions/trc20?contract_address=" + USDT_TRON + "&limit=1&order_by=block_timestamp,asc", key).catch(() => null);
  const approveP = tgGet(base + "/transactions?limit=200&order_by=block_timestamp,desc", key).catch(() => null);
  const [acctJ, resEnergy, page1J, firstJ, approveJ] = await Promise.all([acctP, energyP, page1P, firstP, approveP]);
  prog("账户信息获取完成", 15);

  // 1. 账户信息
  const a = (acctJ.data && acctJ.data[0]) || {};
  const trxBal = parseInt(a.balance || "0", 10) / 1e6;
  let usdtBal = 0;
  (a.trc20 || []).forEach((obj) => {
    Object.keys(obj).forEach((k) => {
      if (k.toLowerCase() === USDT_TRON.toLowerCase()) usdtBal = parseInt(obj[k] || "0", 10) / 1e6;
    });
  });

  // 2. 能量
  let energy = 0, energyLimit = 0;
  if (resEnergy) {
    energy = (resEnergy.EnergyLimit || 0) - (resEnergy.EnergyUsed || 0);
    energyLimit = resEnergy.EnergyLimit || 0;
  }

  // 3. USDT 转账：先处理第一页，再分页拉剩余（最多 2000 条）
  const transfers = [];
  let totalIn = 0, totalOut = 0, inCount = 0, outCount = 0;
  const pushTx = (tx) => {
    const dec = parseInt(((tx.token_info || {}).decimals) || "6", 10);
    const raw = parseInt(tx.value || "0", 10);
    const amt = raw / Math.pow(10, dec);
    if (!isFinite(amt) || amt <= 0 || amt > 1e12) return; // 过滤脏数据（如 max uint256）
    const dir = (tx.to || "").toLowerCase() === addrL ? "in" : "out";
    if (dir === "in") { totalIn += amt; inCount++; } else { totalOut += amt; outCount++; }
    const ts = Number(tx.block_timestamp || 0);
    transfers.push({
      dir, amount: fmtTrunc2(amt), time: fmtTime(ts), ts,
      counterparty: dir === "in" ? tx.from : tx.to, hash: tx.transaction_id
    });
  };
  (page1J.data || []).forEach(pushTx);
  let fp = page1J.meta && page1J.meta.fingerprint, pages = 1;
  while (fp && pages < 2) {
    await sleep(300);
    const r = await tgGet(base + "/transactions/trc20?contract_address=" + USDT_TRON +
      "&limit=200&order_by=block_timestamp,desc&fingerprint=" + encodeURIComponent(fp), key);
    const list = r.data || [];
    if (!list.length) break;
    list.forEach(pushTx);
    fp = r.meta && r.meta.fingerprint;
    pages++;
    prog("正在拉取转账记录（第" + pages + "页）…", Math.min(85, 15 + pages * 12));
  }

  // 3b. 首次时间
  let firstTs = 0;
  if (firstJ && firstJ.data && firstJ.data.length) firstTs = Number(firstJ.data[0].block_timestamp || 0);

  // 4. 安全检测：多签 + 授权
  let multisig = false;
  const permBad = (p) => p && (parseInt(p.threshold || "1", 10) > 1 || (p.keys || []).length > 1);
  if (permBad(a.owner_permission) || (a.active_permissions || []).some(permBad)) multisig = true;

  const approvals = [];
  if (approveJ) {
    for (const tx of (approveJ.data || [])) {
      const c = tx.raw_data && tx.raw_data.contract && tx.raw_data.contract[0];
      if (!c || c.type !== "TriggerSmartContract") continue;
      const p = c.parameter && c.parameter.value;
      if (!p || (p.contract_address || "").toLowerCase() !== USDT_TRON.toLowerCase()) continue;
      const data = (p.data || "").toLowerCase();
      if (data.indexOf("095ea7b3") === 0 && data.length >= 8 + 128) {
        const spenderHex = "41" + data.substr(8 + 24, 40);
        const amtHex = data.substr(8 + 64, 64);
        let spender;
        try { spender = await hexToTronAddr(spenderHex); } catch (e) { spender = "0x" + data.substr(8 + 24, 40); }
        let amtStr;
        if (/^f+$/i.test(amtHex)) amtStr = "无限";
        else { try { amtStr = fmtNum(Number(BigInt("0x" + amtHex)) / 1e6); } catch (e) { amtStr = "未知"; } }
        approvals.push({ spender, token: "USDT", amount: amtStr });
        if (approvals.length >= 5) break;
      }
    }
  }
  prog("安全检测完成", 92);

  return {
    native: { symbol: "TRX", balance: trxBal.toFixed(2) },
    usdt: usdtBal.toFixed(2),
    firstTx: firstTs ? fmtTime(firstTs) : "-",
    energy: energy, energyLimit: energyLimit,
    security: { approval: approvals.slice(0, 5), multisig: multisig },
    stats: { in: fmtNum(totalIn), inCount, out: fmtNum(totalOut), outCount },
    transfers
  };
}

async function queryEth(address, settings, onP) {
  const key = settings.etherscan_key || "";
  if (!key) throw new Error("ERC20 查询需要 Etherscan API Key，请让管理员在后台配置");
  const addrL = address.toLowerCase();
  const prog = (m, p) => { if (onP) { try { onP(m, p); } catch (e) {} } };

  async function rpc(method, params) {
    const r = await fetch(ETH_RPC, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    if (!r.ok) throw new Error("ETH RPC 请求失败(" + r.status + ")");
    const j = await r.json();
    if (j.error) throw new Error("ETH RPC 错误: " + j.error.message);
    return j.result;
  }
  // USDT 余额 call 数据
  const callData = "0x70a08231" + "000000000000000000000000" + address.slice(2).toLowerCase();

  async function es(params) {
    const r = await fetch("https://api.etherscan.io/api?" + params + "&apikey=" + encodeURIComponent(key));
    if (!r.ok) throw new Error("Etherscan 请求失败(" + r.status + ")");
    return r.json();
  }
  // 并行：余额、转账、授权
  const balP = rpc("eth_getBalance", [address, "latest"]);
  const usdtP = rpc("eth_call", [{ to: USDT_ETH, data: callData }, "latest"]);
  const txP = es("module=account&action=tokentx&contractaddress=" + USDT_ETH + "&address=" + address +
    "&startblock=0&endblock=99999999&sort=desc");
  const topic1 = "0x000000000000000000000000" + address.slice(2).toLowerCase();
  const logP = es("module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=" + USDT_ETH +
    "&topic0=" + APPROVE_TOPIC + "&topic0_1_opr=and&topic1=" + topic1).catch(() => null);
  const [ethHex, balHex, txj, lj] = await Promise.all([balP, usdtP, txP, logP]);
  prog("余额获取完成", 30);

  const ethBal = parseInt(ethHex || "0x0", 16) / 1e18;
  const usdtBal = parseInt(balHex || "0x0", 16) / 1e6;

  // USDT 转账
  if (txj.status !== "1" && txj.message !== "No transactions found") throw new Error("Etherscan: " + (txj.message || "查询失败"));
  const transfers = [];
  let totalIn = 0, totalOut = 0, inCount = 0, outCount = 0, firstTs = 0;
  for (const tx of (txj.result || [])) {
    const dec = parseInt(tx.tokenDecimal || "6", 10);
    const raw = parseInt(tx.value || "0", 10);
    const amt = raw / Math.pow(10, dec);
    if (!isFinite(amt) || amt <= 0 || amt > 1e12) continue; // 过滤脏数据
    const dir = (tx.to || "").toLowerCase() === addrL ? "in" : "out";
    if (dir === "in") { totalIn += amt; inCount++; } else { totalOut += amt; outCount++; }
    const ts = Number(tx.timeStamp || 0) * 1000;
    if (!firstTs || ts < firstTs) firstTs = ts;
    transfers.push({
      dir, amount: fmtTrunc2(amt), time: fmtTime(ts), ts,
      counterparty: dir === "in" ? tx.from : tx.to, hash: tx.hash
    });
    if (transfers.length >= 2000) break;
  }
  prog("转账记录获取完成", 65);
  // 授权检测：Approval 事件（含数量）
  const approvals = [];
  if (lj && lj.status === "1" && lj.result) {
    for (const l of lj.result) {
      const spender = "0x" + (l.topics[2] || "").slice(-40);
      const amtHex = ((l.data || "0x").slice(2) || "0");
      let amtStr;
      if (/^f+$/i.test(amtHex)) amtStr = "无限";
      else { try { amtStr = fmtNum(parseInt(amtHex, 16) / 1e6); } catch (e) { amtStr = "未知"; } }
      approvals.push({ spender, token: "USDT", amount: amtStr });
      if (approvals.length >= 5) break;
    }
  }
  prog("安全检测完成", 85);

  return {
    native: { symbol: "ETH", balance: ethBal.toFixed(2) },
    usdt: usdtBal.toFixed(2),
    firstTx: firstTs ? fmtTime(firstTs) : "-",
    energy: 0, energyLimit: 0,
    security: { approval: approvals.slice(0, 5), multisig: false },
    stats: { in: fmtNum(totalIn), inCount, out: fmtNum(totalOut), outCount },
    transfers
  };
}

// ---------- 页面模板 ----------
function css() {
  return '<style>' +
  '*{margin:0;padding:0;box-sizing:border-box}' +
  'body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;' +
  'background:url("' + BG_URL + '") center/cover fixed no-repeat;min-height:100vh;color:#fff}' +
  'body::before{content:"";position:fixed;inset:0;z-index:-1;' +
  'background:linear-gradient(135deg,rgba(8,12,30,.62),rgba(8,12,30,.30) 55%,rgba(20,10,40,.55))}' +
  '.wrap{max-width:860px;margin:0 auto;padding:28px 16px 60px;position:relative;z-index:2}' +
  '#meteor-cv{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50}' +
  '.glass{will-change:transform}' +
  '.btn,.fbtn,.calcbtn,.backbtn,.frange button{transition:transform .15s ease,filter .15s ease}' +
  '.btn:hover,.fbtn:hover,.calcbtn:hover,.backbtn:hover,.frange button:hover{transform:translateY(-1px) scale(1.02);filter:brightness(1.12)}' +
  '.btn:active,.fbtn:active,.calcbtn:active,.backbtn:active,.frange button:active{transform:translateY(0) scale(1)}' +
  '.glass{background:rgba(255,255,255,.10);backdrop-filter:blur(18px) saturate(160%);-webkit-backdrop-filter:blur(18px) saturate(160%);' +
  'border:1px solid rgba(255,255,255,.22);border-radius:20px;box-shadow:0 8px 32px rgba(0,0,0,.28)}' +
  '.hero{text-align:center;padding:38px 24px 30px;margin-bottom:18px}' +
  '.hero h1{font-size:30px;font-weight:800;letter-spacing:2px;margin-bottom:6px;' +
  'background:linear-gradient(90deg,#7dd3fc,#c4b5fd,#f9a8d4);-webkit-background-clip:text;background-clip:text;color:transparent}' +
  '.hero p{font-size:13px;color:rgba(255,255,255,.75);letter-spacing:1px}' +
  '.search{display:flex;gap:10px;margin-top:22px}' +
  '.search input{flex:1;padding:14px 18px;border-radius:14px;border:1px solid rgba(255,255,255,.25);' +
  'background:rgba(255,255,255,.12);color:#fff;font-size:15px;outline:none}' +
  '.search input::placeholder{color:rgba(255,255,255,.5)}' +
  '.search input:focus{border-color:#7dd3fc;box-shadow:0 0 0 3px rgba(125,211,252,.25)}' +
  '.btn{padding:14px 30px;border:none;border-radius:14px;font-size:15px;font-weight:700;color:#fff;cursor:pointer;' +
  'background:linear-gradient(135deg,#3b82f6,#8b5cf6);box-shadow:0 4px 18px rgba(99,102,241,.45);transition:.2s;white-space:nowrap}' +
  '.btn:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(99,102,241,.6)}' +
  '.btn:active{transform:translateY(0)}' +
  '.chain-hint{margin-top:12px;font-size:12px;color:rgba(255,255,255,.65)}' +
  '.cards{display:grid;grid-template-columns:1fr;gap:14px;margin-top:16px}' +
  '.card{padding:20px}' +
  '.card h3{font-size:15px;font-weight:700;margin-bottom:10px;color:#fef3c7;white-space:pre-wrap;line-height:1.7}' +
  '.addr-row{display:flex;gap:8px;align-items:center;justify-content:flex-start;flex-wrap:wrap}' +
  '.addr{padding:11px 13px;border-radius:12px;border:1px solid rgba(255,165,0,.5);background:rgba(0,0,0,.28);' +
  'font-size:12.5px;word-break:break-all;color:#fde68a;font-family:ui-monospace,monospace;cursor:pointer;max-width:100%}' +
  '.copy{padding:11px 16px;border:none;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;color:#fff;' +
  'background:linear-gradient(135deg,#f59e0b,#ef4444);white-space:nowrap}' +
  '.price-line{text-align:center;margin:18px 0 4px;padding:14px 20px;font-size:14px;color:rgba(255,255,255,.9);letter-spacing:.5px}' +
  '.price-line b{color:#4ade80;font-size:17px}' +
  '.tg-row{text-align:center;margin-top:14px;font-size:14px}' +
  '.tg-row a{display:inline-block;padding:8px 22px;border-radius:999px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);' +
  'color:#fff;text-decoration:none;font-weight:700;margin-left:6px}' +
  '#result{margin-top:18px;display:none}' +
  '.r-head{padding:22px;text-align:center}' +
  '.r-addr{font-size:13px;word-break:break-all;color:#e0e7ff;font-family:ui-monospace,monospace;margin:8px 0}' +
  '.badge{display:inline-block;padding:4px 14px;border-radius:999px;font-size:12px;font-weight:700;' +
  'background:rgba(74,222,128,.18);border:1px solid rgba(74,222,128,.5);color:#4ade80}' +
  '.bal-row{display:flex;gap:16px;margin-top:18px;justify-content:center;flex-wrap:wrap}' +
  '.bal{padding:12px 22px;text-align:center;border:1px solid rgba(255,255,255,.22);border-radius:14px;' +
  'background:rgba(255,255,255,.06);backdrop-filter:blur(12px);display:inline-block;min-width:120px}' +
  '.bal .v{font-size:30px;font-weight:800;color:#fff;letter-spacing:.5px;text-shadow:0 2px 16px rgba(0,0,0,.35);margin-top:6px}' +
  '.bal .v.usdt{background:linear-gradient(90deg,#4ade80,#bef264);-webkit-background-clip:text;background-clip:text;color:transparent}' +
  '.bal .k{font-size:14px;color:rgba(255,255,255,.92);letter-spacing:1px;font-weight:600}' +
  '.sec-card{margin:10px auto 0;max-width:640px;padding:8px 16px;border-radius:12px;text-align:center;' +
  'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(12px)}' +
  '.sec-t{font-weight:800;font-size:16px;color:rgba(255,255,255,.92)}' +
  '.sec-line{font-size:16px;color:rgba(255,255,255,.88)}' +
  '.prog{padding:34px 28px;text-align:center}' +
  '.prog-bar{height:10px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden;margin:18px 0 12px}' +
  '.prog-fill{height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#3b82f6,#8b5cf6,#ec4899);transition:width .35s}' +
  '.prog-msg{font-size:13px;color:rgba(255,255,255,.85)}' +
  '.prog-pct{font-size:26px;font-weight:800;color:#fff;margin-top:4px}' +
  '.warn-card{margin:12px auto 0;max-width:640px;padding:14px 18px;border-radius:14px;text-align:left;' +
  'background:rgba(248,113,113,.10);border:1px solid rgba(248,113,113,.45)}' +
  '.warn-t{font-weight:800;color:#f87171;font-size:14px;margin-bottom:8px}' +
  '.warn-line{font-size:13px;color:rgba(255,255,255,.88);margin:5px 0;word-break:break-all}' +
  '.safe-card{margin:12px auto 0;max-width:640px;padding:12px 18px;border-radius:14px;text-align:center;' +
  'background:rgba(74,222,128,.10);border:1px solid rgba(74,222,128,.30);backdrop-filter:blur(12px)}' +
  '.safe-t{font-weight:700;color:#4ade80;font-size:14px}' +
  '.meta{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-top:16px;font-size:14.5px;color:rgba(255,255,255,.95)}' +
  '.sec{display:flex;gap:10px;justify-content:center;margin-top:12px;flex-wrap:wrap}' +
  '.sec span{padding:7px 16px;border-radius:999px;font-size:13px;font-weight:700}' +
  '.ok{background:rgba(74,222,128,.15);border:1px solid rgba(74,222,128,.5);color:#4ade80}' +
  '.bad{background:rgba(248,113,113,.15);border:1px solid rgba(248,113,113,.5);color:#f87171}' +
  '.stats{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}' +
  '.frange{display:flex;gap:10px;justify-content:center;margin-top:16px}' +
  '.frange button{padding:9px 26px;border-radius:999px;border:1px solid rgba(255,255,255,.25);' +
  'background:rgba(255,255,255,.08);color:rgba(255,255,255,.75);font-size:13px;font-weight:700;cursor:pointer;transition:.2s}' +
  '.frange button.on{background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-color:transparent;color:#fff;' +
  'box-shadow:0 4px 14px rgba(99,102,241,.45)}' +
  '.stat{padding:18px;text-align:center}' +
  '.stat .v{font-size:22px;font-weight:800}' +
  '.stat .k{font-size:12px;color:rgba(255,255,255,.65);margin-top:4px}' +
  '.in .v{color:#4ade80}.out .v{color:#f87171}' +
  '.report-btn{display:block;margin:16px auto 0;padding:13px 34px;border:none;border-radius:999px;font-size:15px;font-weight:800;' +
  'color:#fff;cursor:pointer;background:linear-gradient(135deg,#f59e0b,#f97316);box-shadow:0 4px 18px rgba(249,115,22,.45)}' +
  '.tbl{margin-top:14px;overflow:hidden}' +
  '.tbl-head,.tbl-row{display:grid;grid-template-columns:64px 1fr 150px;gap:8px;padding:12px 16px;align-items:center}' +
  '.tbl-head{font-size:12.5px;color:rgba(255,255,255,.6);border-bottom:1px solid rgba(255,255,255,.14);font-weight:700}' +
  '.tbl-row{border-bottom:1px solid rgba(255,255,255,.07);font-size:13px}' +
  '.tbl-row:last-child{border-bottom:none}' +
  '.amt-in{color:#4ade80;font-weight:800}.amt-out{color:#f87171;font-weight:800}' +
  '.mono.cp{cursor:pointer}.mono.cp:hover{color:#7dd3fc}' +
  'a.mono.hash{color:rgba(255,255,255,.65);text-decoration:none}a.mono.hash:hover{color:#7dd3fc;text-decoration:underline}' +
  '.mono{font-family:ui-monospace,monospace;font-size:11.5px;color:rgba(255,255,255,.75);word-break:break-all}' +
  '.ttime{font-size:12px;color:rgba(255,255,255,.7)}' +
  '.loading{text-align:center;padding:30px;font-size:14px;color:rgba(255,255,255,.8)}' +
  '.err{margin-top:14px;padding:16px;text-align:center;color:#fca5a5;font-size:14px}' +
  '.foot{text-align:center;margin-top:18px;padding:16px 20px;font-size:12px;color:rgba(255,255,255,.65)}' +
  '.foot a{color:#7dd3fc;text-decoration:none;font-weight:700}' +
  '.foot a:hover{text-decoration:underline}' +
  '.foot-nav{font-size:17px;letter-spacing:1px}' +
  '.foot-sub{margin-top:8px;font-size:12px;color:rgba(255,255,255,.5)}' +
  '.calc{margin:14px 0 4px;padding:16px;border-radius:14px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.12)}' +
  '.calc-row{display:flex;align-items:center;gap:10px;margin:12px 0;flex-wrap:wrap}' +
  '.calc-row:first-child{margin-top:0}.calc-row:last-child{margin-bottom:0}' +
  '.calc-label{font-size:13px;font-weight:700;color:#fde68a}' +
  '.calc-rate{font-size:13px;color:#4ade80;font-weight:700;margin-left:auto}' +
  '.calc-rates{display:flex;gap:10px;margin-left:auto;align-items:baseline}' +
  '.rate-real{font-size:12px;color:rgba(255,255,255,.55)}' +
  '.rate-show{font-size:13px;color:#4ade80;font-weight:700}' +
  '.calc-row input{width:110px;padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.25);' +
  'background:rgba(255,255,255,.12);color:#fff;font-size:14px;outline:none;text-align:center}' +
  '.calc-unit{font-size:13px;color:rgba(255,255,255,.7)}' +
  '.calc-arrow{color:#7dd3fc;font-weight:800}' +
  '.calc-out{font-size:16px;font-weight:800;color:#fff}' +
  '.backbtn{margin-bottom:14px;padding:10px 26px;border-radius:999px;border:1px solid rgba(255,255,255,.28);' +
  'background:rgba(255,255,255,.10);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
  'color:#fff;font-size:14px;font-weight:700;cursor:pointer}' +
  '.backbtn:hover{background:rgba(255,255,255,.18)}' +
  '@media(max-width:640px){' +
  '.wrap{padding:18px 12px 44px}' +
  '.hero{padding:26px 16px 20px}' +
  '.hero h1{font-size:23px}' +
  '.search{flex-direction:column}' +
  '.search .btn{width:100%}' +
  '.card{padding:16px}' +
  '.card h3{font-size:14px}' +
  '.bal-row{gap:16px}' +
  '.bal .v{font-size:24px}' +
  '.stats{gap:10px}.stat{padding:14px 10px}.stat .v{font-size:18px}' +
  '.tbl-head{display:none}' +
  '.tbl-row{grid-template-columns:1fr;gap:6px;padding:13px 16px}' +
  '.frange button{padding:9px 20px}' +
  '.report-btn{width:100%;padding:13px 10px;font-size:14px}' +
  '}' +
  '</style>';
}

function homePage(s, pageUrl) {
  const nl2br = (t) => esc(t).replace(/\n/g, "<br>");
  const ogTitle = esc(s.site_title);
  const ogDesc = "查余额、租能量、换TRX";
  const ogImg = "https://t.633668.xyz/file/1782251244863_16pic_8721377_b.jpg";
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>' + ogTitle + '</title>' +
  '<meta property="og:type" content="website">' +
  '<meta property="og:title" content="' + ogTitle + '">' +
  '<meta property="og:description" content="' + ogDesc + '">' +
  '<meta property="og:image" content="' + ogImg + '">' +
  '<meta property="og:url" content="' + esc(pageUrl) + '">' +
  '<meta name="twitter:card" content="summary_large_image">' +
  '<meta name="twitter:title" content="' + ogTitle + '">' +
  '<meta name="twitter:description" content="' + ogDesc + '">' +
  '<meta name="twitter:image" content="' + ogImg + '">' +
  css() + '</head><body><div class="wrap">' +
  '<div id="homeview">' +

  '<div class="glass hero"><h1>' + esc(s.site_title) + '</h1>' +
  '<p>查余额 · 转账记录 · 地址信息 · 统计收入支出</p>' +
  '<div class="search"><input id="addr" placeholder="请输入地址 (TRC20 以 T 开头 / ERC20 以 0x 开头)">' +
  '<button class="btn" onclick="doQuery()">开始查</button></div>' +
  '<div class="chain-hint">自动识别链类型：TRC20 / ERC20</div></div>' +

  '<div class="cards">' +
  (s.energy_addr ?
    '<div class="glass card"><h3>' + nl2br(s.energy_title) + '</h3>' +
    '<div class="addr-row"><div class="addr" title="点击复制" onclick="copyTxt(\'' + esc(s.energy_addr) + '\',this)">' + esc(s.energy_addr) + '</div>' +
    '<button class="copy" onclick="copyTxt(\'' + esc(s.energy_addr) + '\',this)">' + esc(s.energy_btn) + '</button></div></div>' : '') +
  (s.exchange_addr ?
    '<div class="glass card"><h3>' + nl2br(s.exchange_title) + '</h3>' +
    '<div class="addr-row"><div class="addr" title="点击复制" onclick="copyTxt(\'' + esc(s.exchange_addr) + '\',this)">' + esc(s.exchange_addr) + '</div>' +
    '<button class="copy" onclick="copyTxt(\'' + esc(s.exchange_addr) + '\',this)">' + esc(s.exchange_btn) + '</button></div></div>' : '') +
  // U换TRX 实时汇率计算器（无地址时也显示，只展示客户价）
  '<div class="glass card"><h3>💱 TRX 实时兑换计算器</h3>' +
  '<div class="calc"><div class="calc-row"><span class="calc-label">U → TRX</span>' +
  '<span class="calc-rate" id="r_u2t">加载中…</span></div>' +
  '<div class="calc-row"><input id="in_u" value="1" inputmode="decimal" onfocus="this.select()" oninput="calcU()"><span class="calc-unit">U</span><span class="calc-arrow">→</span><span class="calc-out" id="out_t">-</span></div>' +
  '<div class="calc-row"><span class="calc-label">TRX → 人民币</span>' +
  '<span class="calc-rate" id="r_t2c">加载中…</span></div>' +
  '<div class="calc-row"><input id="in_t" value="1" inputmode="decimal" onfocus="this.select()" oninput="calcT()"><span class="calc-unit">TRX</span><span class="calc-arrow">→</span><span class="calc-out" id="out_c">-</span></div>' +
  '</div></div>' +
  '</div>' +

  '<div class="glass price-line" id="okxprice">欧意前十商家购买均价加载中…</div>' +
  (s.tg_url ? '<div class="tg-row">' + esc(s.tg_label) + '<a href="' + esc(s.tg_url) + '" target="_blank">' + esc(s.tg_btn) + '</a></div>' : '') +
  '</div>' + // end homeview

  '<div id="result" style="display:none"></div>' +

  '<div class="glass foot">' + (s.footer_url ? '<a class="foot-nav" href="' + esc(s.footer_url) + '" target="_blank">' + esc(s.footer_text) + '</a>' : '') + '<div class="foot-sub">数据来源于链上公开信息，仅供参考</div></div>' +
  '</div>' +

  '<script>' +
  'document.addEventListener("keydown",function(e){' +
  'if(e.key==="F12"||(e.ctrlKey&&e.shiftKey&&(e.key==="I"||e.key==="J"||e.key==="C"))||(e.ctrlKey&&e.key==="U")){e.preventDefault();return false}});' +
  'document.addEventListener("contextmenu",function(e){e.preventDefault();return false});' +
  'if(!/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)){' +
  'setInterval(function(){if(window.outerWidth-window.innerWidth>160||window.outerHeight-window.innerHeight>160){' +
  'document.body.innerHTML="<div style=\\"position:fixed;inset:0;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;z-index:9999\\">\\u7981\\u6b62\\u8c03\\u8bd5</div>"}},1000)}' +
  '(function(){var cv=document.createElement("canvas");cv.id="meteor-cv";document.body.appendChild(cv);' +
  'var ctx=cv.getContext("2d");function rs(){cv.width=innerWidth;cv.height=innerHeight}rs();addEventListener("resize",rs);' +
  'var ms=[];var lane=0;var lanes=[0.58,0.68,0.78,0.88,0.97];' +
  'function spawnOne(initY){var w=cv.width;var lx=lanes[lane%lanes.length];lane++;' +
  'ms.push({x:w*(lx+(Math.random()-0.5)*0.03),y:initY!==undefined?initY:-40-Math.random()*60,' +
  'vx:-(0.8+Math.random()*0.8),vy:4+Math.random()*2,' +
  'len:110+Math.random()*110,life:1,decay:0.004+Math.random()*0.003})}' +
  'spawnOne(80);spawnOne(300);spawnOne(520);' +
  'setInterval(function(){if(ms.length<5)spawnOne()},700);' +
  'function tick(){ctx.clearRect(0,0,cv.width,cv.height);' +
  'for(var i=ms.length-1;i>=0;i--){var m=ms[i];m.x+=m.vx;m.y+=m.vy;m.life-=m.decay;' +
  'if(m.life<=0||m.y>cv.height+60){ms.splice(i,1);continue}' +
  'var tx=m.x-m.vx*m.len/6,ty=m.y-m.vy*m.len/6;' +
  'var g=ctx.createLinearGradient(m.x,m.y,tx,ty);' +
  'g.addColorStop(0,"rgba(255,255,255,"+(0.95*m.life)+")");g.addColorStop(0.3,"rgba(200,220,255,"+(0.6*m.life)+")");g.addColorStop(1,"rgba(255,255,255,0)");' +
  'ctx.strokeStyle=g;ctx.lineWidth=3;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(m.x,m.y);ctx.lineTo(tx,ty);ctx.stroke();' +
  'ctx.fillStyle="rgba(255,255,255,"+(0.95*m.life)+")";ctx.beginPath();ctx.arc(m.x,m.y,2.6,0,7);ctx.fill();' +
  'ctx.fillStyle="rgba(180,210,255,"+(0.35*m.life)+")";ctx.beginPath();ctx.arc(m.x,m.y,5,0,7);ctx.fill()}' +
  'requestAnimationFrame(tick)}tick()})();' +
  'function bindTilt(){document.querySelectorAll("#homeview .glass,#result .r-head,#result .stat").forEach(function(el){if(el._tb)return;el._tb=1;' +
  'var tx=0,ty=0,cx=0,cy=0,raf=null;' +
  'function anim(){cx+=(tx-cx)*0.12;cy+=(ty-cy)*0.12;' +
  'el.style.transform="perspective(900px) rotateY("+cx.toFixed(2)+"deg) rotateX("+cy.toFixed(2)+"deg)";' +
  'if(Math.abs(tx-cx)>0.02||Math.abs(ty-cy)>0.02){raf=requestAnimationFrame(anim)}else{raf=null}}' +
  'el.addEventListener("mousemove",function(e){var r=el.getBoundingClientRect();' +
  'tx=((e.clientX-r.left)/r.width-.5)*4;ty=-((e.clientY-r.top)/r.height-.5)*4;' +
  'if(!raf)raf=requestAnimationFrame(anim)});' +
  'el.addEventListener("mouseleave",function(){tx=0;ty=0;if(!raf)raf=requestAnimationFrame(anim)})})}' +
  'document.addEventListener("DOMContentLoaded",bindTilt);' +
  'function copyTxt(t,el){function done(ok){if(!el)return;var old=el.textContent;' +
  'el.textContent=ok?"\\u2713 \\u590d\\u5236\\u6210\\u529f":"\\u590d\\u5236\\u5931\\u8d25";' +
  'setTimeout(function(){el.textContent=old},1500)}' +
  'if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){done(true)},function(){done(false)})}' +
  'else{var ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);ta.select();' +
  'try{document.execCommand("copy");done(true)}catch(e){done(false)}document.body.removeChild(ta)}}' +
  'var QD=null,curRange="all";' +
  'function doQuery(){var a=document.getElementById("addr").value.trim();if(!a){alert("请输入地址");return}' +
  'document.getElementById("homeview").style.display="none";' +
  'var box=document.getElementById("result");box.style.display="block";' +
  'box.innerHTML="<div class=\\"glass prog\\"><div class=\\"prog-pct\\" id=\\"ppct\\">0%</div>" +' +
  '"<div class=\\"prog-bar\\"><div class=\\"prog-fill\\" id=\\"pfill\\"></div></div>" +' +
  '"<div class=\\"prog-msg\\" id=\\"pmsg\\">正在连接…</div></div>";box.scrollIntoView({behavior:"smooth"});' +
  'var es=new EventSource("/api/query-stream?address="+encodeURIComponent(a));' +
  'es.onmessage=function(e){var j;try{j=JSON.parse(e.data)}catch(x){return}' +
  'if(j.progress!==undefined){document.getElementById("pfill").style.width=j.progress+"%";' +
  'document.getElementById("ppct").textContent=j.progress+"%";' +
  'if(j.msg)document.getElementById("pmsg").textContent=j.msg}' +
  'if(j.done){es.close();' +
  'if(j.error){box.innerHTML="<div class=\\"glass err\\">"+j.error+"</div>"}' +
  'else{QD=j.result;curRange="all";renderAll()}}};' +
  'es.onerror=function(){es.close();box.innerHTML="<div class=\\"glass err\\">网络错误，请重试</div>"};}' +
  'document.getElementById("addr").addEventListener("keydown",function(e){if(e.key==="Enter")doQuery()});' +
  'fetch("/api/okx-price").then(function(r){return r.json()}).then(function(j){' +
  'var el=document.getElementById("okxprice");if(!el)return;' +
  'if(j.ok){el.innerHTML="欧意前十商家购买均价1USDT=<b>"+j.price+"</b> RMB"}' +
  'else{el.textContent="欧意前十商家购买均价暂未获取"}}).catch(function(){' +
  'var el=document.getElementById("okxprice");if(el)el.textContent="欧意前十商家购买均价暂未获取"});' +
  'var RATES=null;' +
  'function calcU(){if(!RATES||!RATES.showU2T)return;var u=parseFloat(document.getElementById("in_u").value)||0;' +
  'document.getElementById("out_t").textContent=(u*RATES.showU2T).toFixed(1)+" TRX"}' +
  'function calcT(){if(!RATES||!RATES.showT2C)return;var t=parseFloat(document.getElementById("in_t").value)||0;' +
  'document.getElementById("out_c").textContent=(t*RATES.showT2C).toFixed(1)+" 元"}' +
  'fetch("/api/rates").then(function(r){return r.json()}).then(function(j){' +
  'if(!j.ok||!j.showU2T)return;RATES=j;' +
  'document.getElementById("r_u2t").textContent="1U = "+j.showU2T.toFixed(1)+" TRX";' +
  'if(j.showT2C)document.getElementById("r_t2c").textContent="1TRX = "+j.showT2C.toFixed(1)+" 元";' +
  'calcU();calcT()}).catch(function(){' +
  'document.getElementById("r_u2t").textContent="获取失败";document.getElementById("r_t2c").textContent="获取失败"});' +
  'function goHome(){document.getElementById("result").style.display="none";' +
  'document.getElementById("homeview").style.display="block";window.scrollTo(0,0)}' +
  'function copyAddr(el){copyTxt(el.textContent.trim(),el)}' +
  'function fnum(n){var s=n.toFixed(6).replace(/\\.?0+$/,"");return s===""?"0":s}' +
  'function fnum2(n){return n.toFixed(2)}' +
  'function bjBounds(){var off=8*3600*1000,b=new Date(Date.now()+off);' +
  'return{day:Date.UTC(b.getUTCFullYear(),b.getUTCMonth(),b.getUTCDate())-off,' +
  'month:Date.UTC(b.getUTCFullYear(),b.getUTCMonth(),1)-off}}' +
  'function setRange(r){curRange=r;renderAll()}' +
  'function renderAll(){if(!QD)return;var j=QD,b=bjBounds(),list=j.transfers;' +
  'if(curRange==="today")list=list.filter(function(t){return t.ts>=b.day});' +
  'else if(curRange==="month")list=list.filter(function(t){return t.ts>=b.month});' +
  'var tin=0,tout=0,ic=0,oc=0;' +
  'list.forEach(function(t){var a=parseFloat(t.amount)||0;if(t.dir==="in"){tin+=a;ic++}else{tout+=a;oc++}});' +
  'var h="",chainName=j.chain==="tron"?"TRC20":"ERC20";' +
  'h+="<button class=\\"backbtn\\" onclick=\\"goHome()\\">← 返回主页</button>";' +
  'h+="<div class=\\"glass r-head\\"><span class=\\"badge\\">"+chainName+"</span><div class=\\"r-addr\\">"+j.address+"</div>";' +
  'h+="<div class=\\"bal-row\\"><div class=\\"bal\\"><div class=\\"k\\">"+j.native.symbol+" 余额</div><div class=\\"v\\">"+j.native.balance+"</div></div>";' +
  'h+="<div class=\\"bal\\"><div class=\\"k\\">USDT 余额</div><div class=\\"v usdt\\">"+j.usdt+"</div></div></div>";' +
  'h+="<div class=\\"meta\\"><span>首次使用: "+j.firstTx+"</span>";' +
  'if(j.chain==="tron")h+="<span>能量: "+j.energy+" / "+j.energyLimit+"</span>";h+="</div>";' +
  'var ap=j.security.approval||[];var isMs=j.security.multisig;' +
  'h+="<div class=\\"sec-card\\"><span class=\\"sec-t\\">地址安全检测：</span>";' +
  'h+="<span class=\\"sec-line\\">"+(ap.length?"有授权 ❗️":"无授权 ✅")+"</span><span style=\\"margin:0 10px;color:rgba(255,255,255,.3)\\">|</span>";' +
  'h+="<span class=\\"sec-line\\">"+(isMs?"有多签 ❗️":"无多签 ✅")+"</span>";' +
  'h+="</div>";' +
  'if(ap.length){h+="<div class=\\"warn-card\\"><div class=\\"warn-t\\">❌ 发现授权</div>";' +
  'for(var ai=0;ai<ap.length;ai++){var a2p=ap[ai];' +
  'h+="<div class=\\"warn-line\\">授权地址：<span class=\\"mono\\">"+a2p.spender+"</span></div>";' +
  'h+="<div class=\\"warn-line\\">授权币种："+a2p.token+"</div>";' +
  'h+="<div class=\\"warn-line\\">授权数量："+a2p.amount+"</div>";' +
  'if(ai<ap.length-1)h+="<div style=\\"border-top:1px solid rgba(248,113,113,.25);margin:8px 0\\"></div>"}' +
  'h+="</div>"}' +
  'if(isMs){h+="<div class=\\"warn-card\\"><div class=\\"warn-t\\">❌ 多签地址</div>" +' +
  '"<div class=\\"warn-line\\">该地址存在多签权限</div></div>"}' +
  'h+="</div>";' +
  'h+="<div class=\\"frange\\"><button data-r=\\"today\\" class=\\""+(curRange==="today"?"on":"")+"\\" onclick=\\"setRange(\\\'today\\\')\\">今天</button>";' +
  'h+="<button data-r=\\"month\\" class=\\""+(curRange==="month"?"on":"")+"\\" onclick=\\"setRange(\\\'month\\\')\\">本月</button>";' +
  'h+="<button data-r=\\"all\\" class=\\""+(curRange==="all"?"on":"")+"\\" onclick=\\"setRange(\\\'all\\\')\\">全部</button></div>";' +
  'h+="<div class=\\"stats\\"><div class=\\"glass stat in\\"><div class=\\"v\\">"+fnum2(tin)+"</div><div class=\\"k\\">USDT 总收入（"+ic+" 笔）</div></div>";' +
  'h+="<div class=\\"glass stat out\\"><div class=\\"v\\">"+fnum2(tout)+"</div><div class=\\"k\\">USDT 总支出（"+oc+" 笔）</div></div></div>";' +
  (s.report_url ? 'h+="<button class=\\"report-btn\\" onclick="window.open(\\""+' + JSON.stringify(s.report_url) + '.replace(\\"{address}\\",j.address),\\"_blank\\")">点击查看此地址黑U反洗钱报告</button>";' : '') +
  'h+="<div class=\\"glass tbl\\"><div class=\\"tbl-head\\"><span>数量</span><span>交易时间 / 对方地址</span><span>交易哈希</span></div>";' +
  'var show=list.slice(0,100);' +
  'var exUrl=j.chain==="tron"?"https://tronscan.org/#/transaction/":"https://etherscan.io/tx/";' +
  'for(var i=0;i<show.length;i++){var t=show[i];' +
  'h+="<div class=\\"tbl-row\\"><span class=\\""+(t.dir==="in"?"amt-in":"amt-out")+"\\">"+(t.dir==="in"?"+":"-")+t.amount+"</span>";' +
  'h+="<span><div class=\\"ttime\\">"+t.time+"</div><div class=\\"mono cp\\" title=\\"点击复制\\" onclick=\\"copyAddr(this)\\">"+t.counterparty+"</div></span>";' +
  'h+="<a class=\\"mono hash\\" href=\\""+exUrl+t.hash+"\\" target=\\"_blank\\">"+t.hash.slice(0,20)+"…</a></div>"}' +
  'h+="</div>";if(list.length>100)h+="<div class=\\"foot\\">仅显示最近 100 条，共 "+list.length+" 条</div>";' +
  'document.getElementById("result").innerHTML=h;bindTilt()}' +
  '</scr' + 'ipt></body></html>';
}

// ---------- 后台（只读状态页，无数据库） ----------
// ---------- 后台（/admin，可配置） ----------
function adminPage(logged, s) {
  if (!logged) {
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>后台登录</title>' + css() + '</head><body><div class="wrap" style="max-width:420px">' +
    '<div class="glass hero"><h1>后台登录</h1><div class="search" style="margin-top:18px">' +
    '<input id="pw" type="password" placeholder="请输入管理密码">' +
    '<button class="btn" onclick="login()">登录</button></div></div></div>' +
    '<script>function login(){var p=document.getElementById("pw").value;' +
    'fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:p})})' +
    '.then(function(r){return r.json()}).then(function(j){if(j.ok)location.reload();else alert("密码错误")})}' +
    'document.getElementById("pw").addEventListener("keydown",function(e){if(e.key==="Enter")login()});' +
    '</scr' + 'ipt></body></html>';
  }
  const F = (k, label, ph, ta) => {
    const v = esc(s[k] || "");
    const inp = ta
      ? '<textarea id="f_' + k + '" rows="3" placeholder="' + esc(ph || "") + '">' + v + '</textarea>'
      : '<input id="f_' + k + '" value="' + v + '" placeholder="' + esc(ph || "") + '">';
    return '<div class="frow"><label>' + label + '</label>' + inp + '</div>';
  };
  const keys = Object.keys(CONFIG);
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>后台配置</title>' + css() +
  '<style>.frow{margin-bottom:14px}.frow label{display:block;font-size:13px;margin-bottom:6px;color:rgba(255,255,255,.8)}' +
  '.frow input,.frow textarea{width:100%;padding:11px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.25);' +
  'background:rgba(255,255,255,.10);color:#fff;font-size:14px;outline:none;resize:vertical}' +
  '.sec-t{font-size:15px;font-weight:800;margin:20px 0 12px;color:#fde68a;letter-spacing:1px}' +
  '.rval{padding:10px 14px;border-radius:12px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.12);' +
  'font-size:13px;color:#e0e7ff}</style>' +
  '</head><body><div class="wrap"><div class="glass card" style="padding:26px">' +
  '<h2 style="margin-bottom:6px">网站配置</h2>' +
  '<p style="font-size:12px;color:rgba(255,255,255,.6);margin-bottom:8px">改完点保存，前台即时生效</p>' +
  '<div class="sec-t">实时汇率（欧易）</div>' +
  '<div class="rval" id="adm_rates">加载中…</div>' +
  '<div class="sec-t">基本</div>' +
  F("site_title", "网站标题", "") +
  '<div class="sec-t">租能量卡片</div>' +
  F("energy_title", "卡片文案（换行用回车）", "", 1) + F("energy_addr", "租能量地址", "T…") + F("energy_btn", "按钮文字", "") +
  '<div class="sec-t">U 换 TRX 卡片</div>' +
  F("exchange_title", "卡片文案（换行用回车）", "", 1) + F("exchange_addr", "兑换地址", "T…") + F("exchange_btn", "按钮文字", "") +
  '<div class="sec-t">其他展示</div>' +
  F("tg_label", "客服标签", "") + F("tg_url", "客服链接", "https://t.me/…") + F("tg_btn", "客服按钮文字", "") +
  F("footer_text", "页底链接文字", "") + F("footer_url", "页底链接地址", "") +
  '<div class="sec-t">接口密钥（也可走 Worker secrets，secrets 优先）</div>' +
  F("trongrid_key", "TronGrid API Key（可选）", "") +
  F("etherscan_key", "Etherscan API Key（查 ERC20 必填）", "") +
  '<button class="btn" style="width:100%;margin-top:10px" onclick="save()">保存配置</button>' +
  '<div id="msg" style="text-align:center;margin-top:10px;font-size:13px"></div>' +
  '</div></div>' +
  '<script>var keys=' + JSON.stringify(keys) + ';' +
  'function save(){var o={};keys.forEach(function(k){var el=document.getElementById("f_"+k);if(el)o[k]=el.value});' +
  'var msg=document.getElementById("msg");msg.textContent="保存中…";msg.style.color="#fde68a";' +
  'fetch("/api/admin/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(o)})' +
  '.then(function(r){return r.json()}).then(function(j){' +
  'msg.textContent=j.ok?"✓ 已保存":("保存失败"+(j.error?("："+j.error):""));' +
  'msg.style.color=j.ok?"#4ade80":"#f87171"}).catch(function(e){' +
  'msg.textContent="保存失败：网络错误";msg.style.color="#f87171"});}' +
  'fetch("/api/rates").then(function(r){return r.json()}).then(function(j){' +
  'var el=document.getElementById("adm_rates");' +
  'if(!j.ok){el.textContent="获取失败";return}' +
  'var t=[];' +
  'if(j.realU2T&&j.showU2T)t.push("实时 1U="+j.realU2T.toFixed(2)+" TRX；展示 1U="+j.showU2T.toFixed(2)+" TRX");' +
  'if(j.realT2C&&j.showT2C)t.push("实时 1TRX="+j.realT2C.toFixed(2)+" 元；展示 1TRX="+j.showT2C.toFixed(2)+" 元");' +
  'el.innerHTML=t.join("<br>")||"获取失败";' +
  'el.style.fontSize="14px";el.style.lineHeight="1.8"}).catch(function(){' +
  'document.getElementById("adm_rates").textContent="获取失败"});' +
  '</scr' + 'ipt></body></html>';
}

function isAuthed(req, env) {
  const c = req.headers.get("Cookie") || "";
  return env.ADMIN_PASSWORD && c.indexOf("adm=" + env.ADMIN_PASSWORD) !== -1;
}

// 费率：展示价 = 实时价 -/+ 手续费（改这里即可调整）
const FEE_U2T = 0.2;  // U换TRX，展示少 0.2
const FEE_T2C = 0.3;  // TRX换人民币，展示多 0.3 元

// 汇率缓存（60秒），减少对欧易的请求频率
let ratesCache = null;
let ratesCacheTime = 0;
const RATES_TTL = 60 * 1000;

async function fetchWithRetry(url, tries) {
  let lastErr = null;
  for (let i = 0; i < (tries || 2); i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
      if (r.ok) return r;
      lastErr = new Error("http " + r.status);
    } catch (e) { lastErr = e; }
    if (i + 1 < (tries || 2)) await new Promise((res) => setTimeout(res, 800));
  }
  throw lastErr;
}

async function getUsdtCny() {
  const r = await fetchWithRetry("https://www.okx.com/v3/c2c/tradingOrders/books?quoteCurrency=CNY&baseCurrency=USDT&side=sell&paymentMethod=all&userType=all&showTrade=false", 2);
  const j = await r.json();
  const sells = (((j || {}).data || {}).sell || []).slice(0, 10);
  const prices = sells.map((x) => parseFloat(x.price)).filter((x) => x > 0);
  if (!prices.length) throw new Error("empty");
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}
async function getTrxUsdt() {
  const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
  // 优先欧易现货
  try {
    const r = await fetchWithRetry("https://www.okx.com/api/v5/market/ticker?instId=TRX-USDT", 2);
    const j = await r.json();
    const last = parseFloat((((j || {}).data || [])[0] || {}).last);
    if (last > 0) return last; // 1 TRX = ? USDT
  } catch (e) {}
  // 兜底 CoinGecko
  const r2 = await fetchWithRetry("https://api.coingecko.com/api/v3/simple/price?ids=tron&vs_currencies=usd", 2);
  const j2 = await r2.json();
  const usd = parseFloat((((j2 || {}).tron || {}).usd));
  if (!usd || usd <= 0) throw new Error("empty");
  return usd;
}
// ---------- 路由 ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/") {
      const s = await getSettings(env);
      const pageUrl = new URL(request.url).origin + "/";
      return new Response(homePage(s, pageUrl), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (path === "/admin") {
      const s = await getSettings(env);
      return new Response(adminPage(isAuthed(request, env), s), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (path === "/api/query" && request.method === "GET") {
      const address = (url.searchParams.get("address") || "").trim();
      if (!address) return json({ ok: false, error: "请输入地址" });
      let chain = null;
      if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) chain = "tron";
      else if (/^0x[0-9a-fA-F]{40}$/.test(address)) chain = "eth";
      else return json({ ok: false, error: "地址格式不正确，仅支持 TRC20（T开头）与 ERC20（0x开头）地址" });
      const settings = await getSettings(env);
      try {
        const data = chain === "tron" ? await queryTron(address, settings) : await queryEth(address, settings);
        return json(Object.assign({ ok: true, chain, address }, data));
      } catch (e) {
        return json({ ok: false, error: e.message || "查询失败，请稍后重试" });
      }
    }
    if (path === "/api/query-stream" && request.method === "GET") {
      const address = (url.searchParams.get("address") || "").trim();
      let chain = null;
      if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) chain = "tron";
      else if (/^0x[0-9a-fA-F]{40}$/.test(address)) chain = "eth";
      const ts = new TransformStream();
      const writer = ts.writable.getWriter();
      const enc = new TextEncoder();
      const send = (o) => writer.write(enc.encode("data: " + JSON.stringify(o) + "\n\n"));
      ctx.waitUntil((async () => {
        try {
          if (!address) await send({ done: true, error: "请输入地址" });
          else if (!chain) await send({ done: true, error: "地址格式不正确，仅支持 TRC20（T开头）与 ERC20（0x开头）地址" });
          else {
            const settings = await getSettings(env);
            await send({ progress: 5, msg: "开始查询…" });
            const cb = (m, p) => send({ progress: p, msg: m });
            const data = chain === "tron"
              ? await queryTron(address, settings, cb)
              : await queryEth(address, settings, cb);
            await send({ done: true, result: Object.assign({ ok: true, chain, address }, data) });
          }
        } catch (e) {
          try { await send({ done: true, error: e.message || "查询失败，请稍后重试" }); } catch (e2) {}
        } finally {
          try { writer.close(); } catch (e) {}
        }
      })());
      return new Response(ts.readable, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" }
      });
    }
    if (path === "/api/okx-price" && request.method === "GET") {
      try {
        const avg = await getUsdtCny();
        return json({ ok: true, price: avg.toFixed(3) });
      } catch (e) {
        return json({ ok: false });
      }
    }
    if (path === "/api/rates" && request.method === "GET") {
      try {
        // 缓存命中直接返回
        const now = Date.now();
        if (ratesCache && now - ratesCacheTime < RATES_TTL) {
          return json(Object.assign({ ok: true, cached: true }, ratesCache));
        }
        // U2T 和 T2C 独立获取，部分失败不影响另一部分
        let trxUsdt = null, usdtCny = null;
        try { trxUsdt = await getTrxUsdt(); } catch (e) {}
        try { usdtCny = await getUsdtCny(); } catch (e) {}
        if (!trxUsdt && !usdtCny) throw new Error("all failed");
        const out = {};
        if (trxUsdt) {
          const usdtPerTrx = 1 / trxUsdt;
          out.realU2T = usdtPerTrx;
          out.showU2T = Math.max(0, usdtPerTrx - FEE_U2T);
        }
        if (trxUsdt && usdtCny) {
          const trxCny = trxUsdt * usdtCny;
          out.realT2C = trxCny;
          out.showT2C = trxCny + FEE_T2C;
        }
        ratesCache = out;
        ratesCacheTime = now;
        return json(Object.assign({ ok: true }, out));
      } catch (e) {
        // 缓存兜底：即使过期也比没有强
        if (ratesCache) return json(Object.assign({ ok: true, cached: true, stale: true }, ratesCache));
        return json({ ok: false });
      }
    }
    if (path === "/api/admin/login" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      if (env.ADMIN_PASSWORD && b.password === env.ADMIN_PASSWORD) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Set-Cookie": "adm=" + env.ADMIN_PASSWORD + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400"
          }
        });
      }
      return json({ ok: false });
    }
    if (path === "/api/admin/settings") {
      if (!isAuthed(request, env)) return json({ ok: false, error: "未登录" }, 401);
      if (request.method === "GET") return json({ ok: true, settings: await getSettings(env) });
      if (request.method === "POST") {
        try {
          const b = await request.json().catch(() => ({}));
          await saveSettings(env, b);
          return json({ ok: true });
        } catch (e) {
          return json({ ok: false, error: "数据库写入失败" });
        }
      }
    }
    return new Response("Not Found", { status: 404 });
  }
};
