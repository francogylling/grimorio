"""Descarga las Reglas Completas (Comprehensive Rules) más recientes de Wizards y las guarda en rules.json.

Lo corre GitHub Actions cada semana (ver .github/workflows/reglas.yml). Si la versión no cambió, no se toca el archivo.
"""
import json, re, sys, urllib.request, datetime, html

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"}
RULES_PAGE = "https://magic.wizards.com/en/rules"


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def find_txt_url():
    page = get(RULES_PAGE).decode("utf-8", "replace")
    links = re.findall(r'href="([^"]+?\.txt)"', page)
    links = [html.unescape(l) for l in links if "comprules" in l.lower().replace("%20", "").replace(" ", "")]
    if not links:
        raise SystemExit("No encontré el enlace al .txt de las reglas en " + RULES_PAGE)
    url = links[0]
    if url.startswith("//"):
        url = "https:" + url
    return url.replace(" ", "%20")


def decode(raw):
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", "replace")


RULE = re.compile(r"^(\d{3}\.\d+[a-z]?)\.?\s+(.*)$")
SECTION = re.compile(r"^(\d{3})\.\s+(.*)$")
CHAPTER = re.compile(r"^(\d)\.\s+(.*)$")


def parse(text):
    lines = [l.strip() for l in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    eff = ""
    for l in lines[:40]:
        m = re.search(r"effective as of (.+?)\.?$", l)
        if m:
            eff = m.group(1)
            break
    # el cuerpo empieza en la segunda aparición de "1. Game Concepts" (la primera es el índice)
    starts = [i for i, l in enumerate(lines) if re.match(r"^1\.\s+Game Concepts$", l)]
    if len(starts) < 2:
        raise SystemExit("Formato inesperado: no encontré el inicio de las reglas")
    i = starts[1]
    glossary_idx = max(j for j, l in enumerate(lines) if l == "Glossary")
    credits_idx = max(j for j, l in enumerate(lines) if l == "Credits")
    chapters, sections, rules = [], [], []
    for l in lines[i:glossary_idx]:
        if not l:
            continue
        m = RULE.match(l)
        if m:
            rules.append([m.group(1), m.group(2)])
            continue
        m = SECTION.match(l)
        if m:
            sections.append([m.group(1), m.group(2)])
            continue
        m = CHAPTER.match(l)
        if m:
            chapters.append([m.group(1), m.group(2)])
            continue
        if rules:  # ejemplos y párrafos que siguen a una regla
            rules[-1][1] += "\n" + l
    glossary, cur = [], None
    for l in lines[glossary_idx + 1:credits_idx]:
        if not l:
            cur = None
            continue
        if cur is None:
            cur = [l, ""]
            glossary.append(cur)
        else:
            cur[1] = (cur[1] + "\n" + l).strip()
    if len(rules) < 1000:
        raise SystemExit(f"Muy pocas reglas leídas ({len(rules)}); no guardo nada")
    return {"effective": eff, "chapters": chapters, "sections": sections, "rules": rules, "glossary": glossary}


def main():
    url = find_txt_url()
    data = parse(decode(get(url)))
    data["source"] = url
    try:
        old = json.load(open("rules.json", encoding="utf-8"))
    except Exception:
        old = {}
    same = all(old.get(k) == data[k] for k in ("effective", "rules", "glossary"))
    if same:
        print("Las reglas no cambiaron (" + data["effective"] + ")")
        return
    data["fetched"] = datetime.date.today().isoformat()
    with open("rules.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Reglas guardadas: vigentes desde {data['effective']}, {len(data['rules'])} reglas, {len(data['glossary'])} términos")


if __name__ == "__main__":
    sys.exit(main())
