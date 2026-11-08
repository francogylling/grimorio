// Grimorio: avisos en el celular (ventas de Festival in a Box, baneos, precios y resumen semanal).
// Lo corre GitHub Actions cada 30 minutos. Necesita el secreto GRIMORIO_AVISOS, que la app genera en Ajustes → Avisos.
// El secreto trae el id del gist de sincronización y la llave privada para firmar los avisos: nunca se guarda en el repo.
import fs from "fs";
import crypto from "crypto";

const DRY = !!process.env.DRY_RUN;
const raw = (process.env.GRIMORIO_AVISOS || "").trim();
if(!raw){ console.log("Avisos sin configurar (falta el secreto GRIMORIO_AVISOS)."); process.exit(0); }
let cfg; try{ cfg = JSON.parse(Buffer.from(raw, "base64").toString("utf8")); }catch(e){ console.log("El secreto GRIMORIO_AVISOS no es válido."); process.exit(0); }
const webpush = DRY ? null : (await import("web-push")).default;
if(webpush) webpush.setVapidDetails("https://francogylling.github.io/grimorio/", cfg.p, cfg.k);

const ROOT = new URL("..", import.meta.url).pathname;
const STATE_F = ROOT + "avisos/estado.json";
const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
const H = 3600e3, D = 24*H;
const lima = d => new Date(d.getTime() - 5*H);               // Lima = UTC-5, sin horario de verano
const limaDay = d => lima(d).toISOString().slice(0,10);
const hash = s => crypto.createHash("sha256").update(cfg.g + "|" + s).digest("hex").slice(0,16);
let state; try{ state = JSON.parse(fs.readFileSync(STATE_F, "utf8")); }catch(e){ state = null; }
const first = !state; state = state || { sent:{} };
const sent = k => !!state.sent[hash(k)];
const mark = k => { state.sent[hash(k)] = now.toISOString().slice(0,10); };

async function getData(){
  const src = process.env.GIST_FILE;
  if(src) return JSON.parse(fs.readFileSync(src, "utf8")).data;
  const hd = { "User-Agent":"grimorio-avisos", Accept:"application/vnd.github+json" };
  if(process.env.GITHUB_TOKEN) hd.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
  const g = await (await fetch(`https://api.github.com/gists/${cfg.g}`, { headers:hd })).json();
  const f = g.files && g.files["grimorio-sync.json"]; if(!f) throw new Error("No encontré el gist de sincronización");
  const txt = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
  return JSON.parse(txt).data;
}
const data = await getData();
const subs = (data.push || []).filter(s => s && s.endpoint && s.keys);
const prefs = Object.assign({ sale:true, bans:true, prices:true, week:true }, (data.settings || {}).notify || {});
const EN = (data.settings || {}).lang === "en", T = (es, en) => EN ? en : es;
const fdate = d => d.toLocaleDateString(EN ? "en-US" : "es-PE", { day:"numeric", month:"long", timeZone:"America/Lima" });
const out = [];
const send = (key, title, body, url, tag) => { if(sent(key)) return; mark(key); if(!first) out.push({ title, body, url: url || "./", tag: tag || key }); };

// 1) Ventas de Festival in a Box (fechas en el CONS de la app)
if(prefs.sale){
  const html = fs.readFileSync(ROOT + "index.html", "utf8");
  const m = html.match(/const CONS = \[([\s\S]*?)\]\.map\(/);
  const cons = m ? Function(`return [${m[1]}]`)() : [];
  for(const e of cons){
    if(e.sold) continue;
    const s = new Date(e.start), sale = e.sale ? new Date(e.sale) : new Date(s.getTime() - 25*D), est = !e.sale;
    const name = e.name.replace("MagicCon: ", "");
    const hhmm = lima(sale).toISOString().slice(11,16);
    if(now >= sale) { if(now - sale < 2*H) send(`sale|${e.name}|open|${sale.toISOString()}`, `Festival in a Box: ${name}`, est ? T("Debería abrir la venta por estos días. Revisa Secret Lair.", "The sale should open around now. Check Secret Lair.") : T("¡Abrió la venta! Entra ya a Secret Lair.", "The sale is open! Go to Secret Lair now."), "./#inicio", "venta"); continue; }
    if(est){ if(sale - now <= 3*D) send(`sale|${e.name}|3d`, T(`Se acerca la venta de Festival in a Box: ${name}`, `Festival in a Box sale is coming: ${name}`), T(`Fecha estimada: alrededor del ${fdate(sale)}. Wizards confirma el día y la hora unos días antes.`, `Estimated date: around ${fdate(sale)}. Wizards confirms the day and time a few days before.`), "./#inicio", "venta"); continue; }
    if(sale - now <= D) send(`sale|${e.name}|24h|${sale.toISOString()}`, T(`Mañana abre la venta: ${name}`, `The sale opens tomorrow: ${name}`), T(`Festival in a Box sale a las ${hhmm} (hora de Lima).`, `Festival in a Box goes on sale at ${hhmm} (Lima time).`), "./#inicio", "venta");
    if(sale - now <= H) send(`sale|${e.name}|1h|${sale.toISOString()}`, T(`En 1 hora: Festival in a Box ${name}`, `In 1 hour: Festival in a Box ${name}`), T(`La venta abre a las ${hhmm} (hora de Lima). Ten tu cuenta lista.`, `The sale opens at ${hhmm} (Lima time). Have your account ready.`), "./#inicio", "venta");
  }
}

// 2) Baneos (news.json, que se actualiza cada semana)
if(prefs.bans){
  let news = []; try{ news = JSON.parse(fs.readFileSync(ROOT + "news.json", "utf8")).items || []; }catch(e){}
  const today = limaDay(now), hourLima = lima(now).getUTCHours();
  for(const n of news.filter(n => n.k === "baneos")){
    if(n.d === today && hourLima >= 9) send(`ban|day|${n.d}`, T("Hoy es el anuncio de baneos", "Banned list announcement today"), T(n.t, n.te || "Wizards publishes the banned and restricted update today."), "./#reglas", "baneos");
    if(n.d <= today && (now - new Date(n.d + "T12:00:00Z")) < 10*D && !/^Próximo anuncio/.test(n.t)) send(`ban|news|${n.t}`, T("Baneos: ", "Bans: ") + (EN && n.te || n.t), (EN && n.xe || n.x).slice(0, 160), "./#reglas", "baneos");
  }
}

// 3) Alertas de precio (una vez al día, después de las 8:00 en Lima)
if(prefs.prices && lima(now).getUTCHours() >= 8){
  const al = Object.entries(data.alerts || {}).filter(([,a]) => a && a.id && a.max > 0);
  if(al.length && !sent(`price-run|${limaDay(now)}`)){
    mark(`price-run|${limaDay(now)}`);
    const price = {};
    for(let i = 0; i < al.length; i += 75){
      try{
        const r = await fetch("https://api.scryfall.com/cards/collection", { method:"POST", headers:{ "Content-Type":"application/json", Accept:"application/json", "User-Agent":"grimorio-avisos/1.0" }, body: JSON.stringify({ identifiers: al.slice(i, i+75).map(([,a]) => ({ id:a.id })) }) });
        const j = await r.json(); (j.data || []).forEach(c => { const p = c.prices || {}; const v = p.usd ?? p.usd_foil ?? p.usd_etched; if(v != null) price[c.id] = +v; });
      }catch(e){ console.log("Scryfall falló:", e.message); }
      await new Promise(r => setTimeout(r, 600));
    }
    const hits = al.map(([name,a]) => ({ name, v: price[a.id], max:a.max })).filter(h => h.v != null && h.v <= h.max && !sent(`price|${h.name}|${h.v}`));
    hits.forEach(h => mark(`price|${h.name}|${h.v}`));
    if(hits.length && !first) out.push({ title: hits.length === 1 ? T(`Bajó de precio: ${hits[0].name}`, `Price drop: ${hits[0].name}`) : T(`${hits.length} cartas bajaron de precio`, `${hits.length} cards dropped in price`), body: hits.slice(0, 4).map(h => `${h.name}: $${h.v.toFixed(2)} (${T("tu tope", "your limit")} $${h.max.toFixed(2)})`).join(" · "), url:"./#tienda", tag:"precios" });
  }
}

// 4) Resumen semanal (domingo desde las 19:00 en Lima)
if(prefs.week){
  const L = lima(now);
  if(L.getUTCDay() === 0 && L.getUTCHours() >= 19){
    const wk = limaDay(now), since = now.getTime() - 7*D;
    const added = (data.log || []).filter(x => x.t >= since && x.qty > 0).reduce((a,x) => a + x.qty, 0);
    const spent = (data.buys || []).filter(b => b.t >= since).reduce((a,b) => a + (+b.pen || 0), 0);
    const hist = (data.history || []).filter(h => h.v > 0), last = hist[hist.length-1];
    const old = [...hist].reverse().find(h => new Date(h.d).getTime() <= since) || hist[0];
    const parts = [];
    if(added) parts.push(T(`agregaste ${added} carta${added === 1 ? "" : "s"}`, `you added ${added} card${added === 1 ? "" : "s"}`));
    if(spent) parts.push(T(`gastaste S/ ${spent.toFixed(2)}`, `you spent S/ ${spent.toFixed(2)}`));
    if(last) parts.push(T("tu colección vale $", "your collection is worth $") + `${last.v.toFixed(2)}${old && old !== last ? ` (${last.v >= old.v ? "▲" : "▼"} $${Math.abs(last.v - old.v).toFixed(2)})` : ""}`);
    if(parts.length) send(`week|${wk}`, T("Tu semana en Grimorio", "Your week in Grimorio"), parts.join(", ").replace(/^./, c => c.toUpperCase()) + ".", "./#inicio", "semana");
  }
}

// Enviar a cada dispositivo
for(const n of out){
  for(const s of subs){
    if(DRY){ console.log("AVISO →", (s.dev || "?"), JSON.stringify(n)); continue; }
    try{ await webpush.sendNotification({ endpoint:s.endpoint, keys:s.keys }, JSON.stringify(n), { TTL: 12*3600, urgency: n.tag === "venta" ? "high" : "normal" }); console.log("Enviado:", n.tag); }
    catch(e){ console.log("No se pudo enviar a un dispositivo:", e.statusCode || e.message); }
  }
}
if(!subs.length) console.log("No hay dispositivos con avisos activados.");
// Limpiar marcas de más de 90 días y guardar
const cut = new Date(now.getTime() - 90*D).toISOString().slice(0,10);
for(const [k,v] of Object.entries(state.sent)) if(v < cut) delete state.sent[k];
fs.mkdirSync(ROOT + "avisos", { recursive:true });
fs.writeFileSync(STATE_F, JSON.stringify(state, null, 1) + "\n");
console.log(`Listo: ${out.length} aviso(s)${first ? " (primera vez: solo marqué lo pendiente, sin enviar)" : ""}.`);
