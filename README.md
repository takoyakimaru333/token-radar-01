# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/takoyakimaru333/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/takoyakimaru333/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of the protocol universe and ranks every pre-token protocol by implied value, with a concrete farm plan for each. The implied-value multiple is not asserted — it is calibrated from the snapshot itself: protocols that already trade price a dollar of TVL in their category (market cap / TVL), and each category's median ratio, winsorised at the 95th percentile and shrunk toward the global median, becomes the multiple for its pre-token protocols, adjusted for seven-day growth and for how long the protocol has run with no token. The board covers the full 40-protocol watchlist plus 160 early rows below the floor; the static dashboard (no network) is sortable and filterable, shows the calibration table it derived, and gives every protocol a detail view with its own model inputs and a seven-step farm plan with costs and times.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=noble-koala-43-5137&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
