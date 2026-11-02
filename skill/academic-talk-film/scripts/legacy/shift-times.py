#!/usr/bin/env python3
"""Shift chapter-relative times in a block of the talk script.

    python3 shift-times.py index.html "<start marker>" "<end marker>" <delta> [--prefix c4] [--min 18.6]

Every literal `<prefix> + N` between the first occurrence of the start marker
and the first occurrence of the end marker after it gets N + delta (only when
N >= --min, if given). The end marker itself is not shifted. Prints how many
literals changed. Chapter markers, DURATION and the public build are not
touched: update those by hand and re-run cplist.sh.
"""
import re, sys

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = dict(a[2:].split('=', 1) if '=' in a else (a[2:], None) for a in sys.argv[1:] if a.startswith('--'))
    if len(args) < 4:
        print(__doc__); sys.exit(1)
    path, start, end, delta = args[0], args[1], args[2], float(args[3])
    prefix = opts.get('prefix') or 'c4'
    lo = float(opts['min']) if opts.get('min') else -1e9
    s = open(path, encoding='utf-8').read()
    i = s.index(start); j = s.index(end, i)
    pat = re.compile(re.escape(prefix) + r' \+ (\d+(?:\.\d+)?)')
    n = [0]
    def rep(m):
        v = float(m.group(1))
        if v < lo: return m.group(0)
        n[0] += 1
        return '%s + %g' % (prefix, round(v + delta, 2))
    blk = pat.sub(rep, s[i:j])
    open(path, 'w', encoding='utf-8').write(s[:i] + blk + s[j:])
    print('shifted', n[0], 'literals by', delta, 'in', path)

if __name__ == '__main__':
    main()
