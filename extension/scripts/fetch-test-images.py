"""Download the test images used by test/media.mjs and test/custom-topic.mjs (Wikipedia / Wikimedia Commons)
into test/images, with a manifest. Rate-limited and polite. Usage: python3 scripts/fetch-test-images.py"""
import json, os, re, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "test" / "images"
UA = {"User-Agent": "nopescope-tests/0.1 (https://github.com/; test images)"}
GROUPS = {
    "gta6": ["Grand Theft Auto VI"],
    "othergame": ["Grand Theft Auto V", "Red Dead Redemption 2", "Cyberpunk 2077", "Fortnite"],
    "miami": ["Miami Beach, Florida", "Ocean Drive (Miami Beach)"],
    "politics": ["Sejm", "United States Capitol", "Donald Tusk"],
    "trump": ["Donald Trump"],
    "neutral": ["Cat", "Pizza", "Mount Everest"],
}

def get(url):
    for i in range(5):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5 * (i + 1)); continue
            raise
    raise RuntimeError(f"rate limited: {url}")

def images(title, n=4):
    q = urllib.parse.urlencode({"action": "query", "titles": title, "generator": "images", "gimlimit": "50", "prop": "imageinfo",
                                "iiprop": "url|mime", "iiurlwidth": "512", "format": "json"})
    pages = (json.loads(get("https://en.wikipedia.org/w/api.php?" + q)).get("query", {}).get("pages", {}) or {}).values()
    out = []
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        if ii.get("mime") in ("image/jpeg", "image/png") and not re.search(r"logo|icon|symbol|flag|commons|wiki|edit|map|star", p["title"], re.I):
            out.append((p["title"], ii.get("thumburl") or ii.get("url")))
    return out[:n]

OUT.mkdir(parents=True, exist_ok=True)
manifest = []
for group, titles in GROUPS.items():
    for t in titles:
        time.sleep(2)
        for name, url in images(t):
            fn = OUT / f"{group}__{re.sub(r'[^A-Za-z0-9]+', '_', name)[:60]}.jpg"
            if not fn.exists():
                time.sleep(1); fn.write_bytes(get(url))
            manifest.append({"file": str(fn.relative_to(OUT.parent.parent)), "group": group, "source": t, "name": name})
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
print(len(manifest), "images in", OUT)
