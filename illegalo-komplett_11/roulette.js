// MAP — Roulette 🎰 European/American, Live-Multiplayer, GamoCoin-Integration
// Firestore: rouletteTables/{tableId} — shared state (phase/result/bets/timer)
// GamoCoin deduct beim Wetten, payout bei Gewinn, onSnapshot synced für alle Spieler
import { app } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, onSnapshot, setDoc, updateDoc, getDoc,
  collection, query, orderBy, serverTimestamp, runTransaction, increment, addDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getBalance, addCoins, claimDailyBonus, placeBet, payout, formatCoins, DAILY_BONUS } from "./gamocoin.js";

const auth = getAuth(app);
const db   = getFirestore(app);

// ── Roulette-Nummern & Farben ──
const EU_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const US_ORDER = [0,28,9,26,30,11,7,20,32,17,5,22,34,15,3,24,36,13,1,37,27,10,25,29,12,8,19,31,18,6,21,33,16,4,23,35,14,2]; // 37=00
const RED_NUMS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function numColor(n) { if (n===0||n===37) return "green"; return RED_NUMS.has(n)?"red":"black"; }
function numLabel(n) { return n===37?"00":String(n); }

// ── Auszahlungsquoten (Einsatz × Multiplikator, exkl. Einsatz) ──
const PAYOUTS = {
  straight:35, split:17, street:11, corner:8, sixline:5,
  dozen:2, column:2, red:1, black:1, odd:1, even:1, low:1, high:1,
  half1:1, half2:1 // eu first half/second half
};

// ── State ──
let myUid = null, myName = null, myBalance = 0;
let variant = "eu";  // eu | us
let selectedChip = 10;
const CHIPS = [1,5,10,50,100,500];
const CHIP_COLORS = ["#ff3864","#f59e0b","#00e5ff","#b14aff","#ff2e9a","#39ff8c"];

// local bets: { betKey: { label, numbers, type, amount, chipColor } }
let localBets = {};
let betHistory = []; // für undo

// Multiplayer table
const TABLE_ID = "main"; // one shared table for everyone
let tableRef = null;
let tableUnsub = null;
let currentPhase = "betting"; // betting | spinning | result
let phaseTimer = null;
const BETTING_SECS = 25;
const SPIN_SECS    = 8;
const RESULT_SECS  = 6;

// ── Auth ──
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "gc-index.html"; return; }
  myUid   = user.uid;
  myName  = user.displayName || user.email;
  myBalance = await getBalance(myUid);
  updateBalanceDisplay();
  buildTable();
  buildChips();
  joinTable();
  startWheelIdle();
  document.getElementById("leave-btn").addEventListener("click", leaveTable);
});

// ── Balance ──
function updateBalanceDisplay() {
  const el = document.getElementById("balance-display");
  if (el) el.textContent = formatCoins(myBalance);
}

// ── Daily Bonus ──
window.claimBonus = async () => {
  const res = await claimDailyBonus(myUid);
  if (res.claimed) {
    myBalance += DAILY_BONUS;
    updateBalanceDisplay();
    showToast(`🎁 Daily Bonus! +${DAILY_BONUS} 🪙`);
  } else if (res.nextBonus) {
    const diff = Math.ceil((res.nextBonus - Date.now()) / 3600000);
    showToast(`Daily Bonus erst in ~${diff}h wieder verfügbar 🕐`, true);
  } else {
    showToast("Kein Bonus verfügbar.", true);
  }
};

// ── Variant ──
window.setVariant = (v) => {
  variant = v;
  document.getElementById("btn-eu").classList.toggle("on", v==="eu");
  document.getElementById("btn-us").classList.toggle("on", v==="us");
  buildTable();
  clearBets();
  drawWheel(null);
};

// ── Chip-Auswahl ──
function buildChips() {
  const row = document.getElementById("chip-row");
  row.innerHTML = CHIPS.map((c,i)=>`
    <button class="chip-btn${c===selectedChip?" on":""}" data-chip="${c}"
      style="background:${CHIP_COLORS[i]};color:#fff;"
      onclick="selectChip(${c},this)">${c}
    </button>`).join("");
}
window.selectChip = (val, btn) => {
  selectedChip = val;
  document.querySelectorAll(".chip-btn").forEach(b=>b.classList.remove("on"));
  btn.classList.add("on");
};

// ── Betting Table ──
function buildTable() {
  const tbl = document.getElementById("bet-table");
  const rows = [];
  const hasZZ = variant === "us";

  // Row 0: zeros + dozen/column labels
  rows.push(`<tr>
    <td colspan="3" class="zer-num num-cell" style="font-size:11px;width:84px;" data-bet="straight:0" onclick="addBet('straight',[0],'0',this)">0</td>
    ${hasZZ?`<td colspan="1" class="zer-num num-cell" data-bet="straight:37" onclick="addBet('straight',[37],'00',this)" style="width:28px;">00</td>`:""}
    <td colspan="4" class="wide-cell" onclick="addBet('dozen',[...r(1,12)],'1st Dozen',this)" style="cursor:pointer;">1st 12</td>
    <td colspan="4" class="wide-cell" onclick="addBet('dozen',[...r(13,24)],'2nd Dozen',this)" style="cursor:pointer;">2nd 12</td>
    <td colspan="4" class="wide-cell" onclick="addBet('dozen',[...r(25,36)],'3rd Dozen',this)" style="cursor:pointer;">3rd 12</td>
  </tr>`);

  // Number grid — 3 rows, 12 cols (1-36 in column order)
  // col layout: 1,4,7,10,13,16,19,22,25,28,31,34 → top row
  for (let row=1; row>=1 && row<=3; row--) {
    const nums = [];
    for (let col=0; col<12; col++) { nums.push(col*3 + row); }
    const cells = nums.map(n => {
      const cl = RED_NUMS.has(n)?"red-num":"blk-num";
      return `<td class="${cl} num-cell" data-bet="straight:${n}" onclick="addBet('straight',[${n}],'${n}',this)">${n}</td>`;
    }).join("");
    rows.push(`<tr>${row===3?`<td rowspan="3" class="wide-cell" style="width:16px;writing-mode:vertical-rl;font-size:6px;" onclick="addBet('column',[...r(${row},36,3)],'Col ${row}',this)">COL</td>`:""}${cells}</tr>`);
    if (row===1) row=4; // only do rows 1-3
  }
  rows.splice(1,0, buildNumRow(1));
  rows.splice(2,0, buildNumRow(2));
  rows.splice(3,0, buildNumRow(3));
  rows.splice(1,3); // replace those

  // Re-build properly
  const allRows = buildProperGrid(hasZZ);
  tbl.innerHTML = allRows;
}

function r(from, to, step=1) { const arr=[]; for(let i=from;i<=to;i+=step) arr.push(i); return arr; }

function buildProperGrid(hasZZ) {
  let html = "";
  const colspan0 = hasZZ ? "2" : "1";

  // Row: 3-row number grid + outside bets
  const numRows = [3,2,1]; // top to bottom: 3,6,9... / 2,5,8... / 1,4,7...
  const rowHtml = numRows.map((startRow, ri) => {
    const nums = [];
    for (let col=0; col<12; col++) nums.push(col*3+startRow);
    return `<tr>${nums.map(n=>{
      const cl=RED_NUMS.has(n)?"red-num":"blk-num";
      return `<td class="${cl} num-cell" onclick="addBet('straight',[${n}],'${n}',this)">${n}</td>`;
    }).join("")}
    ${ri===1?`<td rowspan="3" class="wide-cell" style="writing-mode:vertical-rl;font-size:6px;cursor:pointer;" onclick="addBet('column',[1,4,7,10,13,16,19,22,25,28,31,34],'Col 1',this)">COL<br>1</td>
              <td rowspan="3" class="wide-cell" style="writing-mode:vertical-rl;font-size:6px;cursor:pointer;" onclick="addBet('column',[2,5,8,11,14,17,20,23,26,29,32,35],'Col 2',this)">COL<br>2</td>
              <td rowspan="3" class="wide-cell" style="writing-mode:vertical-rl;font-size:6px;cursor:pointer;" onclick="addBet('column',[3,6,9,12,15,18,21,24,27,30,33,36],'Col 3',this)">COL<br>3</td>`:""}
    </tr>`;
  }).join("");

  html += `<tr>
    <td colspan="${colspan0}" class="zer-num num-cell" style="width:${hasZZ?56:28}px;font-size:11px;" onclick="addBet('straight',[0],'0',this)">0</td>
    ${hasZZ?`<td class="zer-num num-cell" style="font-size:9px;" onclick="addBet('straight',[37],'00',this)">00</td>`:""}
    <td colspan="4" class="wide-cell" style="cursor:pointer;" onclick="addBet('dozen',[1,2,3,4,5,6,7,8,9,10,11,12],'1-12',this)">1st 12</td>
    <td colspan="4" class="wide-cell" style="cursor:pointer;" onclick="addBet('dozen',[13,14,15,16,17,18,19,20,21,22,23,24],'13-24',this)">2nd 12</td>
    <td colspan="4" class="wide-cell" style="cursor:pointer;" onclick="addBet('dozen',[25,26,27,28,29,30,31,32,33,34,35,36],'25-36',this)">3rd 12</td>
  </tr>`;
  html += rowHtml;
  html += `<tr>
    <td class="wide-cell" style="cursor:pointer;" onclick="addBet('low',[...Array.from({length:18},(_,i)=>i+1)],'1-18',this)">1-18</td>
    <td class="wide-cell" style="cursor:pointer;" onclick="addBet('even',[...Array.from({length:18},(_,i)=>(i+1)*2)],'Even',this)">EVEN</td>
    <td colspan="2" class="wide-cell red-num" style="cursor:pointer;" onclick="addBet('red',[...Array.from({length:36},(_,i)=>i+1).filter(n=>[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(n))],'Red',this)">🔴</td>
    <td colspan="2" class="wide-cell blk-num" style="cursor:pointer;" onclick="addBet('black',[...Array.from({length:36},(_,i)=>i+1).filter(n=>![1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(n))],'Black',this)">⚫</td>
    <td class="wide-cell" style="cursor:pointer;" onclick="addBet('odd',[...Array.from({length:18},(_,i)=>i*2+1)],'Odd',this)">ODD</td>
    <td class="wide-cell" style="cursor:pointer;" onclick="addBet('high',[...Array.from({length:18},(_,i)=>i+19)],'19-36',this)">19-36</td>
  </tr>`;

  return html;
}

// ── Bet hinzufügen ──
window.addBet = (type, numbers, label, cell) => {
  if (currentPhase !== "betting") { showToast("Wetten nur in der Betting-Phase!", true); return; }
  if (myBalance < selectedChip) { showToast("Nicht genug 🪙!", true); return; }
  const key = `${type}:${numbers.join(",")}`;
  if (!localBets[key]) localBets[key] = { label, numbers, type, amount:0, chipColor: CHIP_COLORS[CHIPS.indexOf(selectedChip)] || "#fff" };
  betHistory.push({ key, prev: localBets[key].amount });
  localBets[key].amount += selectedChip;
  myBalance -= selectedChip;
  updateBalanceDisplay();
  updateTotalBet();
  renderBetChips();
};
window.clearBets = () => { localBets = {}; betHistory = []; updateTotalBet(); renderBetChips(); };
window.undoLastBet = () => {
  if (!betHistory.length) return;
  const last = betHistory.pop();
  if (localBets[last.key]) {
    const diff = localBets[last.key].amount - last.prev;
    localBets[last.key].amount = last.prev;
    myBalance += diff;
    if (!localBets[last.key].amount) delete localBets[last.key];
    updateBalanceDisplay();
    updateTotalBet();
    renderBetChips();
  }
};

function updateTotalBet() {
  const total = Object.values(localBets).reduce((s,b)=>s+b.amount,0);
  const el = document.getElementById("total-bet-display");
  if (el) el.textContent = total ? formatCoins(total) : "0 🪙";
}

function renderBetChips() {
  // Remove all existing chips
  document.querySelectorAll(".bet-chip").forEach(c=>c.remove());
  Object.entries(localBets).forEach(([key, bet]) => {
    // find all cells that match this bet
    const [type, numStr] = key.split(":");
    const nums = numStr.split(",").map(Number);
    const cell = document.querySelector(`[onclick*="addBet('${type}',[${nums.join(",")}]"]`);
    if (!cell) return;
    const chip = document.createElement("div");
    chip.className = "bet-chip";
    chip.style.background = bet.chipColor;
    chip.textContent = bet.amount >= 1000 ? Math.floor(bet.amount/1000)+"K" : bet.amount;
    cell.style.position = "relative";
    cell.appendChild(chip);
  });
}

// ── Roulette Rad ──
const canvas  = document.getElementById("rl-canvas");
const ctx     = canvas.getContext("2d");
const CX = canvas.width/2, CY = canvas.height/2, R = CX - 6;
let wheelAngle = 0, idleAnimId = null;

function getOrder() { return variant==="eu" ? EU_ORDER : US_ORDER; }

function drawWheel(highlightNum) {
  const order = getOrder();
  const N = order.length;
  const arc = (Math.PI*2) / N;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // outer ring
  ctx.beginPath(); ctx.arc(CX,CY,R,0,Math.PI*2); ctx.fillStyle="#1a0a24"; ctx.fill();
  ctx.beginPath(); ctx.arc(CX,CY,R,0,Math.PI*2); ctx.strokeStyle="#4a2f7a"; ctx.lineWidth=4; ctx.stroke();

  order.forEach((num, i) => {
    const startAngle = wheelAngle + i*arc - Math.PI/2;
    const endAngle   = startAngle + arc;
    const color = num===0||num===37 ? "#1a7a4a" : RED_NUMS.has(num) ? "#8b1a2a" : "#1a1a2e";
    const hl    = num===highlightNum ? "#fff" : null;

    ctx.beginPath(); ctx.moveTo(CX,CY);
    ctx.arc(CX,CY,R-4,startAngle,endAngle); ctx.closePath();
    ctx.fillStyle = hl || color; ctx.fill();
    ctx.strokeStyle="#4a2f7a"; ctx.lineWidth=1; ctx.stroke();

    // number text
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(startAngle + arc/2);
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillStyle = hl ? "#1a0a24" : "#f1edff";
    ctx.font = `bold ${N>37?8:9}px 'Press Start 2P', monospace`;
    ctx.fillText(numLabel(num), R-18, 0);
    ctx.restore();
  });

  // inner circle
  ctx.beginPath(); ctx.arc(CX,CY,R*0.38,0,Math.PI*2); ctx.fillStyle="#0a0a14"; ctx.fill();
  ctx.beginPath(); ctx.arc(CX,CY,R*0.38,0,Math.PI*2); ctx.strokeStyle="#4a2f7a"; ctx.lineWidth=3; ctx.stroke();

  // ball marker (top)
  ctx.beginPath(); ctx.arc(CX, CY-(R-8), 6, 0, Math.PI*2);
  ctx.fillStyle="#ffd60a"; ctx.fill();
}

function startWheelIdle() {
  if (idleAnimId) cancelAnimationFrame(idleAnimId);
  let angle = 0;
  function loop() {
    angle += 0.008;
    wheelAngle = angle;
    drawWheel(null);
    idleAnimId = requestAnimationFrame(loop);
  }
  idleAnimId = requestAnimationFrame(loop);
}

function animateSpin(targetNum, onDone) {
  if (idleAnimId) { cancelAnimationFrame(idleAnimId); idleAnimId = null; }
  const order = getOrder();
  const idx = order.indexOf(targetNum);
  const arc = (Math.PI*2)/order.length;
  // Target angle: idx-te Zahl soll oben stehen (bei 12 Uhr)
  const targetWheelAngle = -idx * arc + Math.PI/2;
  const extraSpins = Math.PI*2 * (6 + Math.random()*3);
  const startAngle = wheelAngle;
  const totalDelta = extraSpins + ((targetWheelAngle - startAngle) % (Math.PI*2) + Math.PI*2) % (Math.PI*2);
  const duration = 5000;
  const start = performance.now();
  function frame(now) {
    const t = Math.min((now-start)/duration, 1);
    const ease = 1 - Math.pow(1-t, 4); // ease-out quart
    wheelAngle = startAngle + totalDelta * ease;
    drawWheel(t > 0.95 ? targetNum : null);
    if (t < 1) { requestAnimationFrame(frame); }
    else { wheelAngle = targetWheelAngle; drawWheel(targetNum); onDone && onDone(); }
  }
  requestAnimationFrame(frame);
}

// ── Multiplayer Table ──
function joinTable() {
  tableRef = doc(db, "rouletteTables", TABLE_ID);
  tableUnsub = onSnapshot(tableRef, snap => {
    if (!snap.exists()) {
      // Create table if not exists
      setDoc(tableRef, {
        phase: "betting",
        phaseEnds: Date.now() + BETTING_SECS*1000,
        result: null,
        players: {},
        history: [],
        variant: "eu",
        createdAt: serverTimestamp()
      });
      return;
    }
    handleTableUpdate(snap.data());
  });
}

let lastPhase = null;
function handleTableUpdate(data) {
  currentPhase = data.phase;
  renderMpPlayers(data.players || {});
  renderHistory(data.history || []);

  const phaseLabel = document.getElementById("phase-label");
  const phaseFill  = document.getElementById("phase-fill");
  const spinBtn    = document.getElementById("spin-btn");
  const now = Date.now();
  const ends = data.phaseEnds || now;
  const total = currentPhase==="betting"?BETTING_SECS*1000:currentPhase==="spinning"?SPIN_SECS*1000:RESULT_SECS*1000;
  const left = Math.max(0, ends - now);
  const pct  = Math.min(100, (left/total)*100);
  if (phaseFill) phaseFill.style.width = pct+"%";

  if (currentPhase === "betting") {
    if (phaseLabel) phaseLabel.textContent = `💸 WETTEN! ${Math.ceil(left/1000)}s`;
    if (spinBtn) { spinBtn.disabled = false; spinBtn.textContent = `🎰 DREHEN`; }
    if (lastPhase !== "betting") startWheelIdle();
  } else if (currentPhase === "spinning") {
    if (phaseLabel) phaseLabel.textContent = "🌀 BALL ROLLT…";
    if (spinBtn) { spinBtn.disabled = true; spinBtn.textContent = "🌀 LÄUFT…"; }
    if (lastPhase !== "spinning" && data.result != null) {
      animateSpin(data.result, () => showResult(data));
    }
  } else if (currentPhase === "result") {
    if (phaseLabel) phaseLabel.textContent = "✅ ERGEBNIS";
    if (spinBtn) { spinBtn.disabled = true; }
    if (lastPhase !== "result") showResult(data);
  }
  lastPhase = currentPhase;

  // auto-advance phase on timer
  clearTimeout(phaseTimer);
  if (left > 0) {
    phaseTimer = setTimeout(() => advancePhase(data), left + 200);
  }
}

async function advancePhase(data) {
  const now = Date.now();
  if (data.phase === "betting") {
    // Pick result, commit bets
    const result = Math.floor(Math.random() * (variant==="us"?38:37));
    await setDoc(tableRef, {
      phase: "spinning",
      phaseEnds: now + SPIN_SECS*1000,
      result,
      players: data.players || {},
      history: data.history || [],
      variant
    });
    // Commit our local bets to Firestore for other players to see
    await commitBets(result);
  } else if (data.phase === "spinning") {
    await updateDoc(tableRef, { phase: "result", phaseEnds: Date.now() + RESULT_SECS*1000 });
  } else if (data.phase === "result") {
    // New round
    await setDoc(tableRef, {
      phase: "betting",
      phaseEnds: Date.now() + BETTING_SECS*1000,
      result: null,
      players: {},
      history: [(data.result != null ? data.result : 0), ...(data.history||[])].slice(0,20),
      variant
    });
    localBets = {}; betHistory = [];
    updateTotalBet(); renderBetChips();
    document.getElementById("result-display").textContent = "—";
    document.getElementById("result-display").className = "result-flash";
    startWheelIdle();
  }
}

async function commitBets(result) {
  const totalBetAmount = Object.values(localBets).reduce((s,b)=>s+b.amount,0);
  if (!totalBetAmount) return;
  // Deduct from Firestore (already deducted from local, sync)
  try {
    await updateDoc(doc(db, "users", myUid), { gamocoins: increment(-totalBetAmount) });
  } catch(e) {}
  // Calculate winnings
  const winnings = calcWinnings(result);
  if (winnings > 0) {
    await updateDoc(doc(db, "users", myUid), { gamocoins: increment(winnings) });
    myBalance = await getBalance(myUid);
    updateBalanceDisplay();
  }
  // Store bets in table for display
  try {
    await updateDoc(tableRef, {
      [`players.${myUid}`]: {
        name: myName,
        totalBet: totalBetAmount,
        winnings,
        bets: Object.fromEntries(Object.entries(localBets).map(([k,v])=>[k,{label:v.label,amount:v.amount}]))
      }
    });
  } catch(e) {}
}

function calcWinnings(result) {
  let total = 0;
  Object.values(localBets).forEach(bet => {
    if (bet.numbers.includes(result)) {
      const mult = PAYOUTS[bet.type] ?? 1;
      total += bet.amount * (mult + 1); // bet back + winnings
    }
  });
  return total;
}

function showResult(data) {
  const num = data.result;
  if (num == null) return;
  const color = numColor(num);
  const label = numLabel(num);
  const el = document.getElementById("result-display");
  el.textContent = label + (color==="red"?" 🔴":color==="black"?" ⚫":" 🟢");
  el.className = "result-flash res-" + color;

  const myPlayer = (data.players||{})[myUid];
  if (myPlayer && myPlayer.winnings > 0) {
    showToast(`🎉 GEWONNEN! +${formatCoins(myPlayer.winnings)} 🪙`);
    sfxWin();
  } else if (myPlayer && myPlayer.totalBet > 0) {
    showToast(`😔 Nächstes Mal! Kein Gewinn.`);
    sfxLose();
  }
  myBalance = myPlayer ? (myBalance + (myPlayer.winnings||0)) : myBalance;
  updateBalanceDisplay();
}

function renderMpPlayers(players) {
  const el = document.getElementById("mp-players");
  if (!el) return;
  const entries = Object.entries(players);
  if (!entries.length) { el.innerHTML = `<div class="empty">Nur du gerade.</div>`; return; }
  el.innerHTML = entries.map(([uid, p]) => `
    <div class="mp-player">
      <span>${uid===myUid?"👤 Du":p.name||"?"}</span>
      <span class="mp-bet-tag">${p.totalBet ? formatCoins(p.totalBet)+' gesetzt' : 'wartet…'}</span>
      ${p.winnings > 0 ? `<span style="color:var(--gr);font-size:12px;">+${formatCoins(p.winnings)}</span>` : ""}
    </div>`).join("");
}

function renderHistory(hist) {
  const el = document.getElementById("history-row");
  if (!el || !hist.length) return;
  el.innerHTML = hist.slice(0,15).map(n => {
    const c = numColor(n);
    const col = c==="red"?"#ff3864":c==="black"?"#c4b8e8":"#39ff8c";
    return `<div style="width:24px;height:24px;border-radius:50%;background:${c==="red"?"rgba(255,56,100,.3)":c==="black"?"rgba(30,20,50,.6)":"rgba(16,185,129,.3)"};border:1.5px solid ${col};display:flex;align-items:center;justify-content:center;font-size:9px;color:${col};font-family:'Press Start 2P',monospace;">${numLabel(n)}</div>`;
  }).join("");
}

// ── Spin Request (macht den User zum "Dealer" falls Betting-Phase noch läuft) ──
window.requestSpin = async () => {
  if (currentPhase !== "betting") return;
  const totalBetAmount = Object.values(localBets).reduce((s,b)=>s+b.amount,0);
  if (!totalBetAmount) { showToast("Erst eine Wette platzieren!", true); return; }
  // Sofort drehen — überspringt den Rest der Betting-Phase für alle
  const result = Math.floor(Math.random() * (variant==="us"?38:37));
  const now = Date.now();
  await setDoc(tableRef, {
    phase: "spinning",
    phaseEnds: now + SPIN_SECS*1000,
    result,
    players: {},
    history: [],
    variant
  });
  await commitBets(result);
};

// ── Sound-Effekte (via Web Audio, kein External Dep nötig) ──
function sfxWin() {
  try {
    const c = new (window.AudioContext||window.webkitAudioContext)();
    [523,659,784,1047].forEach((f,i) => {
      const o=c.createOscillator(),g=c.createGain();
      o.frequency.value=f; o.type="sine"; g.gain.value=0.09;
      o.connect(g); g.connect(c.destination);
      const t=c.currentTime+i*0.12;
      o.start(t); g.gain.exponentialRampToValueAtTime(0.0001,t+0.18); o.stop(t+0.18);
    });
  } catch(e){}
}
function sfxLose() {
  try {
    const c = new (window.AudioContext||window.webkitAudioContext)();
    const o=c.createOscillator(),g=c.createGain();
    o.frequency.value=220; o.type="sawtooth"; g.gain.value=0.08;
    o.connect(g); g.connect(c.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.4); o.stop(c.currentTime+0.4);
  } catch(e){}
}

// ── Toast ──
function showToast(msg, isErr=false) {
  let t = document.getElementById("toast");
  if (!t) { t=document.createElement("div"); t.id="toast"; t.style.cssText="position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#1d1530;border:1.5px solid;border-radius:10px;padding:10px 18px;font-size:14px;font-family:'VT323',monospace;z-index:9999;pointer-events:none;max-width:320px;text-align:center;"; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.color = isErr ? "#ff3864" : "#39ff8c";
  t.style.borderColor = isErr ? "#ff3864" : "#39ff8c";
  t.style.opacity = "1";
  clearTimeout(t._to);
  t._to = setTimeout(() => { t.style.opacity="0"; }, 3200);
}

// ── Cleanup ──
function leaveTable() {
  clearTimeout(phaseTimer);
  if (tableUnsub) tableUnsub();
  if (idleAnimId) cancelAnimationFrame(idleAnimId);
  window.location.href = "lobby.html";
}

// init draw
drawWheel(null);
