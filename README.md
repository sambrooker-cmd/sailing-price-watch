# Sailing Price Watch

Daily price tracker for the Ambassador Cruise Line Google ad feed. It records lead and per-cabin prices and flags
sailings that newly qualify for was/now creative under UK reference-pricing rules. For those, it renders ad cards
for approval. It never touches any ad account.

- `daily.py`: the whole daily job (run by `.github/workflows/price-watch.yml`)
- `enrich.py`, `tracker.py`, `render_cards.py`: fetch, compare, render
- `site/` + `build_site.py`: the tracker dashboard, published with GitHub Pages (`.github/workflows/pages.yml`)
- `state/`: current price history · `runs/`: one change list per day · `cards/`: rendered cards

See CLAUDE.md for rules, open decisions and the cutover checklist.
