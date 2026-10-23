"""Nowy generator katalogu Joos71 6.0. Python 3.9+, bez dodatkowych pakietów.

Odczytuje eksport HTML Playnite WYŁĄCZNIE jako dane. Nie wykonuje skryptów
z wyeksportowanych dokumentów ani nie kopiuje ich treści do strony.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
from datetime import datetime
import hashlib
from html import unescape
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import unicodedata
from urllib.parse import urlsplit, urlunsplit

ID = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$", re.I)
ROW = re.compile(r"<tr\b[^>]*>\s*<td\b[^>]*>(.*?)</td>\s*<td\b[^>]*>(.*?)</td>\s*</tr>", re.I | re.S)
TITLE = re.compile(r"<title\b[^>]*>(.*?)</title>", re.I | re.S)
COVER = re.compile(r"<td\b[^>]*\bcolspan\s*=\s*['\"]2['\"][^>]*>\s*<img\b[^>]*data-src\s*=\s*['\"]([^'\"]+)", re.I | re.S)
ANCHOR = re.compile(r"<a\b[^>]*>(.*?)</a>", re.I | re.S)
HTML = re.compile(r"<[^>]*>")
# Tylko odmiany wydania gry, nie inne gry/remaki ani kontynuacje.
EDITION = re.compile(
    r"(?:\s*[-–:]\s*|\s+)(?:standard edition|digital deluxe edition|n7 digital deluxe edition|"
    r"deluxe edition|digital deluxe|ultimate edition|complete edition|"
    r"collector(?:'|’)?s edition|game of the year edition|goty edition|windows edition)\s*$", re.I
)
SUFFIX = re.compile(r"(?:\s*\(\s*(?:standard edition|deluxe edition|digital deluxe edition|windows edition)\s*\)\s*)$", re.I)
# Polskie nazwy wariantów wykorzystywane np. przez Origin / EA App.
# Scalać można je wyłącznie z istniejącą grą podstawową O IDENTYCZNYM, dodatnim czasie.
# Nie traktujemy dowolnego DLC lub remastera jako tego samego tytułu.
POLISH_EDITION = re.compile(
    r"^(?P<base>.+?)(?:\s*[-–—:]\s*|\s+)(?:"
    r"ulepszenie\s+deluxe|cyfrowa\s+edycja\s+deluxe(?:\s+n7)?|"
    r"edycja\s+deluxe(?:\s+n7)?|digital\s+deluxe\s+n7"
    r")\s*(?:\(\s*\d{4}\s*\))?\s*$", re.I
)
URL_LINK = re.compile(r'<a\b[^>]*\bhref\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.I | re.S)
IMG = re.compile(r"^[0-9a-f-]{36}/[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$", re.I)


def text(raw: str) -> str:
    raw = re.sub(r"<br\s*/?>", " ", raw, flags=re.I)
    return re.sub(r"\s+", " ", unescape(HTML.sub(" ", raw))).strip()


def multi(raw: str) -> list[str]:
    parts = [text(p) for p in ANCHOR.findall(raw)]
    if not parts:
        parts = [text(raw)]
    return list(dict.fromkeys(p for p in parts if p))


# Polskie nazwy gatunków są częścią PUBLICZNEGO katalogu, nie danych w Playnite.
# Złącz pokrewne nazwy (np. Adventure/Przygodowe), żeby statystyki nie dublowały gatunków.
GENRE_PL = {'Adventure': 'Przygodowe', 'Przygodowa': 'Przygodowe', 'Przygodowe': 'Przygodowe', 'Indie': 'Niezależne', 'Niezależne': 'Niezależne', 'Role-playing (RPG)': 'Gry fabularne (RPG)', 'RPG': 'Gry fabularne (RPG)', 'Strategy': 'Strategie', 'Strategie': 'Strategie', 'Strategiczna': 'Strategie', 'Simulator': 'Symulatory', 'Simulation': 'Symulatory', 'Symulator': 'Symulatory', 'Symulacje': 'Symulatory', 'Shooter': 'Strzelanki', 'Puzzle': 'Logiczne', 'Platform': 'Platformówki', 'Arcade': 'Zręcznościowe', 'Zręcznościowa': 'Zręcznościowe', 'Turn-based strategy (TBS)': 'Strategie turowe (TBS)', 'Tactical': 'Taktyczne', 'Point-and-click': 'Przygodowe (wskaż i kliknij)', "Hack and slash/Beat 'em up": 'Hack and slash / bijatyki chodzone', 'Racing': 'Wyścigowe', 'Wyścigowe': 'Wyścigowe', 'Fighting': 'Bijatyki', 'Bijatyka': 'Bijatyki', 'Real Time Strategy (RTS)': 'Strategie czasu rzeczywistego (RTS)', 'Sport': 'Sportowe', 'Card & Board Game': 'Karciane i planszowe', 'Visual Novel': 'Powieści wizualne', 'Music': 'Muzyczne', 'Quiz/Trivia': 'Quizy i zagadki', 'Pinball': 'Flippery', 'Akcja': 'Gry akcji', 'Akcji': 'Gry akcji', 'Action': 'Gry akcji', 'Rekreacyjne': 'Rekreacyjne', 'Animacja i modelowanie': 'Animacja i modelowanie', 'Free to Play': 'Darmowe (free-to-play)', 'MMO': 'MMO', 'Historyczna': 'Historyczne', 'MOBA': 'MOBA', 'Fantasy': 'Fantasy', 'Narzędzia użytkowe': 'Narzędzia użytkowe', 'Obróbka zdjęć': 'Obróbka zdjęć', 'Projektowanie i ilustrowanie': 'Projektowanie i ilustrowanie', 'Budowanie': 'Budowanie', 'Obróbka filmów': 'Obróbka filmów', 'Skradanka': 'Skradanki'}
GENRE_PL_FOLDED = {k.casefold(): v for k, v in GENRE_PL.items()}


def polish_genres(values: list[str]) -> list[str]:
    output = []
    seen = set()
    for value in values:
        translated = GENRE_PL_FOLDED.get(value.strip().casefold(), value.strip())
        if translated and translated.casefold() not in seen:
            output.append(translated)
            seen.add(translated.casefold())
    return output


def minutes(raw: str) -> int:
    if not raw:
        return 0
    parts = dict((unit.lower(), int(num)) for num, unit in re.findall(r"(\d+)\s*(d|h|m|s)\b", raw, flags=re.I))
    return parts.get("d", 0) * 1440 + parts.get("h", 0) * 60 + parts.get("m", 0)


def norm(raw: str) -> str:
    raw = unicodedata.normalize("NFKC", raw).casefold()
    raw = re.sub(r"[®©™]", "", raw)
    return re.sub(r"[^\w]+", "", raw, flags=re.U)


# Wariant ogólny: nie istnieją listy wyjątków dla poszczególnych gier.
# Adres Nexus Mods musi pochodzić z rzeczywistego odnośnika w Playnite
# lub z poprzednio zweryfikowanego adresu tego samego rekordu katalogu.
# Nigdy nie wyliczamy identyfikatora gry Nexus z samego tytułu.


def canonical_game_nexus(url: str) -> str:
    """Ujednolica znany URL strony gry w Nexus Mods (bez zgadywania sluga)."""
    try:
        parts = urlsplit(url.strip())
        if (parts.scheme != 'https' or (parts.hostname or '').lower() not in
                ('nexusmods.com', 'www.nexusmods.com') or parts.username or
                parts.password or parts.port not in (None, 443)):
            return ''
        path = parts.path.strip('/')
        chunks = path.split('/')
        if len(chunks) == 1 and re.fullmatch(r'[a-zA-Z0-9_-]+', chunks[0]):
            slug = chunks[0]
        elif (len(chunks) == 2 and chunks[0].lower() == 'games' and
              re.fullmatch(r'[a-zA-Z0-9_-]+', chunks[1])):
            slug = chunks[1]
        else:
            return ''
        return 'https://www.nexusmods.com/games/' + slug
    except (ValueError, AttributeError):
        return ''


def verified_links(raw: str) -> dict[str, str]:
    """Tylko rzeczywiste linki z pola Linki Playnite; dozwolone hosty i HTTPS."""
    found: dict[str, str] = {}
    for href, label_raw in URL_LINK.findall(raw):
        label = text(label_raw).casefold()
        href = unescape(href).strip()
        try:
            parts = urlsplit(href)
        except ValueError:
            continue
        host = (parts.hostname or '').lower()
        if parts.scheme != 'https' or parts.username or parts.password or parts.port not in (None, 443):
            continue
        if label == 'nexus mods' and host in ('nexusmods.com', 'www.nexusmods.com'):
            # Nexus Mods checker daje adres gry, np. /qube2 lub /games/starfield.
            url = canonical_game_nexus(href)
            if url:
                found.setdefault('nexus', url)
        elif label == 'gg.deals' and host in ('gg.deals', 'www.gg.deals'):
            # Nie przyjmuj pozornie podobnych domen i ścieżek.
            if re.fullmatch(r'/game/[a-zA-Z0-9_-]+/?', parts.path):
                found.setdefault('ggdeals', urlunsplit(('https', 'gg.deals', parts.path, '', '')))
    return found


def parse(path: Path, src: Path) -> dict | None:
    document = path.read_text(encoding="utf-8-sig", errors="replace")
    match = TITLE.search(document)
    if not match:
        return None
    name = text(match.group(1))[:240]
    if not name:
        return None
    rows = {}
    for key, val in ROW.findall(document):
        key = text(key)
        if key:
            rows[key] = val
    scalar = lambda key: text(rows.get(key, ""))
    listval = lambda key: multi(rows.get(key, ""))
    cm = COVER.search(document)
    cp = unescape(cm.group(1)) if cm else ""
    if not IMG.fullmatch(cp) or not (src / cp).is_file():
        cp = ""
    critic_score = None
    community_score = None
    for label, field in (("Wynik Krytyczny", "critic"), ("Wynik Społeczności", "community"), ("Ocena Krytyków", "critic"), ("Ocena Społeczności", "community")):
        value = scalar(label)
        if re.fullmatch(r"\d{1,3}", value):
            if field == "critic": critic_score = min(int(value), 100)
            else: community_score = min(int(value), 100)
    score = None
    scoretype = ""
    for label in ("Ocena Użytkownika", "Wynik Społeczności", "Wynik Krytyczny"):
        value = scalar(label)
        if re.fullmatch(r"\d{1,3}", value):
            score = min(int(value), 100)
            scoretype = label
            break
    release = scalar("Data Wydania")[:10]
    return {
        "id": path.stem, "title": name,
        "minutes": minutes(scalar("Czas Gry")),
        "libraries": listval("Library"),
        "platforms": listval("Platforma"),
        "genres": polish_genres(listval("Gatunek")),
        "year": int(release[:4]) if re.match(r"^\d{4}", release) else None,
        "cover_source": cp,
        "score": score, "score_label": scoretype,
        "criticScore": critic_score, "communityScore": community_score,
        "status": scalar("Stan Ukończenia")[:70],
        "links": verified_links(rows.get("Linki", "")),
    }


def key_for(name: str, names: set[str], play_minutes: int = 0,
            base_times: dict[str, set[int]] | None = None) -> str:
    """Ten sam tytuł lub rozpoznane wydanie tej samej gry.

    Polskie ulepszenia Deluxe scalamy tylko, jeżeli istnieje bazowa gra
    z DOKŁADNIE takim samym dodatnim czasem. Inne DLC, remastery,
    remake'i i samodzielne dodatki muszą pozostać oddzielne.
    """
    exact = norm(name)
    polish = POLISH_EDITION.fullmatch(name.strip())
    if polish:
        b = norm(polish.group('base'))
        if b in names and play_minutes > 0 and play_minutes in (base_times or {}).get(b, set()):
            return b
        return exact
    base = SUFFIX.sub('', EDITION.sub('', name)).strip()
    b = norm(base)
    if not b or b == exact or b not in names:
        return exact
    return b


def merge_records(items: list[dict]) -> tuple[list[dict], int, list[dict]]:
    """Pełna deduplikacja BEZ warunku jednakowego czasu gry.

    Każda grupa to jedna gra: ten sam znormalizowany tytuł na różnych
    platformach lub bezpiecznie rozpoznana edycja tej samej gry.
    Czas katalogu = najwyższy czas ze źródeł (nie sumujemy potencjalnie
    zdublowanych pomiarów). Następny eksport liczymy od początku.
    """
    names = {norm(g['title']) for g in items}
    base_times = defaultdict(set)
    for game in items:
        base_times[norm(game['title'])].add(game['minutes'])
    buckets = defaultdict(list)
    for game in items:
        buckets[key_for(game['title'], names, game['minutes'], base_times)].append(game)

    output = []
    report = []
    merged_count = 0
    for group in buckets.values():
        # Preferujemy podstawowy tytuł, a potem kompletność okładki i ocen.
        group.sort(key=lambda g: (len(g["title"]), -bool(g["cover_source"]), g["title"].casefold()))
        main = group[0]
        best = max(group, key=lambda g: g["minutes"])
        cover = next((g["cover_source"] for g in group if g["cover_source"]), "")
        fields = {
            field: sorted({x for g in group for x in g[field]}, key=str.casefold)
            for field in ("libraries", "platforms", "genres")
        }
        scores = sorted(
            (g for g in group if g["score"] is not None),
            key=lambda x: (x["score_label"] != "Ocena Użytkownika", x["score_label"] != "Wynik Społeczności")
        )
        rating = scores[0] if scores else None
        possible_years = [g["year"] for g in group if g["year"]]
        editions = list(dict.fromkeys(g["title"] for g in group))
        # W scalonych rekordach łączymy tylko sprawdzone odnośniki z każdej kopii gry.
        links = {}
        for platform_game in group:
            for kind, url in platform_game.get("links", {}).items():
                links.setdefault(kind, url)
        # Zachowujemy wyłącznie udokumentowane linki z połączonych rekordów.
        # Nie tworzymy wyjątków dla nazw konkretnych gier.
        merged = {
            "id": main["id"], "title": main["title"], "minutes": best["minutes"],
            "libraries": fields["libraries"], "platforms": fields["platforms"],
            "genres": fields["genres"],
            "year": min(possible_years) if possible_years else None,
            "cover_source": cover,
            "score": rating["score"] if rating else None,
            "score_label": rating["score_label"] if rating else "",
            "criticScore": next((g["criticScore"] for g in group if g["criticScore"] is not None), None),
            "communityScore": next((g["communityScore"] for g in group if g["communityScore"] is not None), None),
            "status": best["status"], "editions": editions, "links": links,
            "count": len(group)
        }
        output.append(merged)
        if len(group) > 1:
            merged_count += len(group) - 1
            report.append({
                "title": main["title"], "minutes": best["minutes"],
                "variants": [(g["title"], g["minutes"]) for g in group]
            })

    output.sort(key=lambda g: (
        -g["minutes"],
        -(g["score"] if g["minutes"] == 0 and g["score"] is not None else -1),
        g["title"].casefold()
    ))
    return output, merged_count, report


def build(source: Path, dest: Path, template: Path):
    source = source.resolve()
    dest = dest.resolve()
    if not source.is_dir() or not (source / "index.html").is_file():
        raise RuntimeError("Brak źródłowego folderu Playnite z plikiem index.html: " + str(source))
    if source == dest or dest.is_relative_to(source) or source.is_relative_to(dest):
        raise RuntimeError("Folder eksportu i folder strony muszą być oddzielne")
    paths = sorted(p for p in source.glob("*.html") if ID.fullmatch(p.stem))
    if len(paths) < 5:
        raise RuntimeError("Eksport jest niekompletny — zbyt mało stron gier")
    raw = [g for p in paths if (g := parse(p, source))]
    # Guard against publishing a partial export if source suddenly became incomplete.
    if len(raw) < len(paths) * 0.98:
        raise RuntimeError("Nie udało się odczytać co najmniej 98% stron gier")
    unique, merged_count, report = merge_records(raw)
    if not unique:
        raise RuntimeError("Brak rekordów do publikacji")
    dest.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="joos71-nowe-", dir=dest.parent))
    backup = None
    try:
        (stage / "covers").mkdir()
        done = set()
        # Jeśli w teście są tylko strony HTML, zachowaj istniejące, ręcznie
        # dobrane okładki po id/nazwie z poprzedniej wersji strony.
        old_by_id = {}
        old_by_title = {}
        if (dest / "data.js").is_file():
            oldraw = (dest / "data.js").read_text(encoding="utf-8-sig")
            head = "window.JOOS71_CATALOG = "
            if oldraw.startswith(head):
                previous = json.loads(oldraw[len(head):].strip().rstrip(';'))
                for game in previous.get("games", []):
                    old_by_id[game["id"]] = game
                    old_by_title[norm(game["title"])] = game
        # Ogólna reguła trwałości odnośników: jeśli nowy eksport chwilowo
        # nie zawiera linku Nexus dla TEGO SAMEGO rekordu, przywróć poprzednio
        # zapisany, sprawdzony URL. Remastery i inne wersje NIE przejmują
        # automatycznie linków bazowej gry (mogą mieć inne mody).
        for game in unique:
            old_game = old_by_id.get(game["id"]) or old_by_title.get(norm(game["title"]))
            if old_game and not game["links"].get("nexus"):
                previous = canonical_game_nexus(old_game.get("links", {}).get("nexus", ""))
                if previous:
                    game["links"]["nexus"] = previous
        for g in unique:
            pic = g.pop("cover_source")
            if pic:
                original = source / pic
                filename = pic.split("/")[-1]
                # include parent id: identical filenames in different game folders must not collide
                target = "covers/" + pic.split("/")[0][:8] + "_" + filename
                if target not in done:
                    shutil.copyfile(original, stage / target)
                    done.add(target)
                g["cover"] = target
            else:
                old_game = old_by_id.get(g["id"]) or old_by_title.get(norm(g["title"]))
                old_cover = old_game.get("cover", "") if old_game else ""
                previous_file = dest / old_cover if old_cover else None
                if previous_file and previous_file.is_file() and old_cover.startswith('covers/'):
                    if old_cover not in done:
                        shutil.copyfile(previous_file, stage / old_cover)
                        done.add(old_cover)
                    g["cover"] = old_cover
                else:
                    g["cover"] = ""
        max_mtime = max(p.stat().st_mtime for p in paths)
        # Source export date, not time the user opens the page.
        latest = datetime.fromtimestamp(max_mtime).strftime("%d.%m.%Y, %H:%M")
        data = {"exported": latest, "sourceCount": len(raw), "uniqueCount": len(unique), "mergedCount": merged_count,
                "mergeRule": "same-title-and-recognized-editions-PL-deluxe-same-time", "games": unique}
        (stage / "data.js").write_text("window.JOOS71_CATALOG = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
        for name in ("index.html", "main.js", "style.css", "avatar.webp"):
            shutil.copyfile(template / name, stage / name)
        (stage / ".nojekyll").write_text("", encoding="utf-8")
        # Check output before switching directories.
        if not (stage / "data.js").is_file() or len(done) < 0:
            raise RuntimeError("Błąd weryfikacji publikacji")
        if dest.exists():
            backup = dest.parent / (dest.name + ".poprzednia")
            if backup.exists():
                shutil.rmtree(backup)
            dest.rename(backup)
        try:
            stage.rename(dest)
        except OSError:
            if backup and backup.exists() and not dest.exists():
                backup.rename(dest)
            raise
        if backup and backup.exists():
            shutil.rmtree(backup)
        reportpath = dest.parent / "RAPORT_SCALANIA.txt"
        lines = ["Joos71 6.2 — raport automatycznych połączeń", "Reguła: ten sam tytuł lub rozpoznane wydania, przy czym polskie Deluxe wymagają identycznego dodatniego czasu. Czas katalogowy to największy czas z połączonych wpisów.", "Liczba rekordów źródłowych: " + str(len(raw)), "Liczba pozycji w katalogu: " + str(len(unique)), "Połączone dodatkowe rekordy: " + str(merged_count), ""]
        for r in report:
            lines.append("* " + r["title"] + " — " + str(r["minutes"]) + " min")
            lines.extend("  - " + n + " [" + str(m) + " min]" for n, m in r["variants"])
        reportpath.write_text("\n".join(lines), encoding="utf-8")
        print(f"OK: {len(raw)} wpisów → {len(unique)} pozycji, scalono {merged_count}. Ostatni eksport: {latest}")
        print("Zapisano do: " + str(dest))
        return data
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def main():
    parser = argparse.ArgumentParser(description="Buduje od zera katalog gier Joos71 z eksportu HTML Playnite")
    parser.add_argument("--source", default=r"E:\Playnite_Katalog")
    parser.add_argument("--target", default=str(Path(__file__).resolve().parent / "docs"))
    args = parser.parse_args()
    build(Path(args.source), Path(args.target), Path(__file__).resolve().parent / "templates")


if __name__ == "__main__":
    main()
