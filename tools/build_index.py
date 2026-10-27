"""Rebuild data/index.json from the per-exam CSV files in data/.

Run after adding, removing or editing any data/*.csv:
    python tools/build_index.py
"""
import csv
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / 'data'


def main():
    exams = []
    for path in sorted(DATA.glob('*.csv'), key=lambda p: p.name.lower()):
        with open(path, encoding='utf-8-sig', newline='') as f:
            rows = list(csv.DictReader(f))
        if not rows:
            continue
        exams.append({'title': rows[0]['title'], 'file': path.name, 'count': len(rows)})
    with open(DATA / 'index.json', 'w', encoding='utf-8', newline='\n') as f:
        json.dump(exams, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'{len(exams)} exams, {sum(e["count"] for e in exams)} questions')


if __name__ == '__main__':
    main()
