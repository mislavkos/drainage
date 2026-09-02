#!/usr/bin/env python3
"""Corpus tooling behind MIN_GRADE in index.html. See "Validation of the descent pick" in
DEVELOPMENT.md for what these numbers mean and why the constant is what it is.

  ./tools/canyon-corpus.py fetch [dir]     re-download the corpus from the Wayback Machine
  ./tools/canyon-corpus.py compare [tsv]   re-score the gradient thresholds from saved data

`compare` is an offline MIRROR of the app's ranking, not the app itself: it re-scores saved
drops and lengths so a threshold can be re-argued without a browser or 824 more elevation
lookups. It can drift from index.html — if the ranking itself changes shape, re-measure
against the real thing. The shipped behaviour is pinned separately by tests/flows.spec.js,
whose fixture encodes the shuttle trap (largest total drop, road-like gradient, must lose).
Its counts also differ slightly from the figures in DEVELOPMENT.md, which came from running
the real app over all 178 files: the TSV covers the 174 whose geometry re-parses cleanly
here, and lengths are computed with a local haversine rather than Turf.

The KML files themselves are NOT in this repo and must not be: ropewiki content is
CC-BY-NC-SA 3.0, which collides with this repo's MIT licence (NonCommercial vs MIT's
commercial grant, and ShareAlike would pull the whole repo with it). `fetch` pulls them
from archive.org into a local directory instead. The live site is behind a Cloudflare
challenge and is not an option — see "Why the app does not fetch a ropewiki URL".
"""
import sys, os, re, time, io, urllib.request, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__))

def fetch(dest):
    os.makedirs(dest, exist_ok=True)
    rows = [l.split() for l in io.open(os.path.join(HERE, 'canyon-corpus.txt'))
            if l.strip() and not l.startswith('#')]
    seen, got, bad = set(), 0, 0
    for ts, orig in rows:
        name = re.sub(r'[^A-Za-z0-9._()-]', '_', urllib.parse.unquote(orig.split('?')[0].rsplit('/', 1)[-1]))
        if name in seen: continue
        seen.add(name)
        if os.path.exists(os.path.join(dest, name)): got += 1; continue
        try:
            # the id_ suffix asks the archive for the original bytes, not a rewritten page
            r = urllib.request.urlopen(urllib.request.Request(
                f'https://web.archive.org/web/{ts}id_/{orig}',
                headers={'User-Agent': 'drainage-descent-pick-validation'}), timeout=45)
            b = r.read()
            if b'<LineString' not in b and b'<trkseg' not in b: bad += 1; continue
            io.open(os.path.join(dest, name), 'wb').write(b); got += 1
        except Exception:
            bad += 1
        time.sleep(0.15)      # a public archive doing us a favour — don't hammer it
    print(f'{got} files in {dest}, {bad} unavailable')

# Scored by section NAME, which the ranking never reads — so the labels are independent
# ground truth. A name matching an approach/exit/road word counts as a failure even if it
# also looks technical ("Exit after 3rd rap"), which keeps the pass rate conservative.
A = re.compile(r'approach|trail\s*head|hike\s*in|walk\s*in|access|\bdrive\b|shuttle|park|\brd\b|\broad\b|\bcar\b|up\s+ridge', re.I)
E = re.compile(r'exit|egress|return|walk\s*out|hike\s*out|back\s*to|\bout\b', re.I)
T = re.compile(r'technical|class\s*[2-9]|slot|narrow|rappel|\brap\b|descen|\bdrops?\b|gorge|creek|canyon|\bcyn\b|fork|gulch|hollow', re.I)

def compare(tsv):
    files = {}
    with io.open(tsv) as fh:
        next(fh)
        for line in fh:
            f, _i, name, length, drop, _g, _p = line.rstrip('\n').split('\t')
            files.setdefault(f, []).append((name, float(length), None if drop == '' else float(drop)))
    multi = {f: v for f, v in files.items() if len(v) > 1}
    print(f'{len(files)} files, {len(multi)} with more than one section\n')
    print(f'{"ranking":38s} {"pass":>5s} {"fail":>5s} {"no oracle":>10s} {"asks user":>10s}')
    for label, mg in [('max drop (no gate)', 0.0), ('max drop, gradient >= 3%', 0.03),
                      ('max drop, gradient >= 5%', 0.05), ('max drop, gradient >= 8%  <-- shipped', 0.08),
                      ('max drop, gradient >= 12%', 0.12)]:
        p = f = u = ask = 0
        for secs in multi.values():
            best, bv = -1, 0
            for i, (_n, L, d) in enumerate(secs):
                if d is None or L <= 0 or d / L < mg or d <= 0: continue
                if d > bv: best, bv = i, d
            if best < 0: ask += 1; continue
            nm = secs[best][0]
            if A.search(nm) or E.search(nm): f += 1
            elif T.search(nm): p += 1
            else: u += 1
        print(f'{label:38s} {p:5d} {f:5d} {u:10d} {ask:10d}')

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'compare'
    if cmd == 'fetch': fetch(sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/canyon-corpus'))
    elif cmd == 'compare': compare(sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'descent-pick.tsv'))
    else: print(__doc__)
