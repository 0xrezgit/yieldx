# Logo sources

Local copies (64×64 WebP, resized from the source; no inline SVG) of network and
protocol marks, used only to identify the network/protocol next to its name.
All marks are trademarks of their owners; no endorsement is implied.

Retrieved 2026-09-29 from the DefiLlama icon CDN (`icons.llamao.fi`), which serves the
images of the DefiLlama `icons` repository (github.com/DefiLlama/icons). DefiLlama
publishes these for identifying chains and protocols; brand terms of each owner apply.

| File | Network / protocol | Registry key | Source path |
|---|---|---|---|
| networks/ethereum.webp | Ethereum | eip155:1 | chains/rsz_ethereum |
| networks/optimism.webp | Optimism | eip155:10 | chains/rsz_optimism.jpg |
| networks/flare.webp | Flare | eip155:14 | chains/rsz_flare.jpg |
| networks/bnb.webp | BNB Chain | eip155:56 | chains/rsz_binance |
| networks/monad.webp | Monad | eip155:143 | chains/rsz_monad.jpg |
| networks/sonic.webp | Sonic | eip155:146 | chains/rsz_sonic.jpg |
| networks/xlayer.webp | X Layer | eip155:196 | chains/rsz_x-layer.jpg |
| networks/hyperevm.webp | HyperEVM | eip155:999 | chains/rsz_hyperliquid.jpg |
| networks/robinhood.webp | Robinhood Chain | eip155:4663 | chains/rsz_robinhood.jpg |
| networks/mantle.webp | Mantle | eip155:5000 | chains/rsz_mantle.jpg |
| networks/base.webp | Base | eip155:8453 | chains/rsz_base.jpg |
| networks/plasma.webp | Plasma | eip155:9745 | chains/rsz_plasma.jpg |
| networks/arbitrum.webp | Arbitrum | eip155:42161 | chains/rsz_arbitrum.jpg |
| networks/hemi.webp | Hemi | eip155:43111 | chains/rsz_hemi.jpg |
| networks/avalanche.webp | Avalanche | eip155:43114 | chains/rsz_avalanche |
| networks/berachain.webp | Berachain | eip155:80094 | chains/rsz_berachain.jpg |
| networks/katana.webp | Katana | eip155:747474 | chains/rsz_katana.jpg |
| networks/solana.webp | Solana | solana:mainnet | chains/rsz_solana |
| networks/unichain.webp | Unichain | eip155:130 | chains/rsz_unichain (retrieved 2026-10-06, `?w=64&h=64`) |
| networks/polygon.webp | Polygon | eip155:137 | chains/rsz_polygon (retrieved 2026-10-06, `?w=64&h=64`) |
| networks/arc.webp | Arc | eip155:5042 | chains/rsz_arc (retrieved 2026-10-06, `?w=64&h=64`) |
| protocols/pendle.webp | Pendle | pendle | protocols/pendle |
| protocols/exponent.webp | Exponent | exponent | protocols/exponent |
| protocols/spectra.webp | Spectra | spectra | protocols/spectra |

Token logos are not stored: they come at runtime from each adapter, matched by the
token's identity (never by ticker search):

- Pendle: `proIcon` / `simpleIcon` of the market (Pendle's own bucket).
- Spectra: `logoURI` of the market's baseIbt / ibt / underlying token.
- Exponent (Solana): Jupiter token API, looked up by the underlying **mint address**.

A token without a logo from these sources is shown with a monogram of its symbol.
Coverage check on 2026-09-29: 137 of 140 live markets have a working logo (103 URLs,
0 failing); no source for Exponent srEHYUSD and srONyc (Jupiter has no icon for
their mints) and Spectra ESPN.

## Tokens (RWA loops)

Local copies (256×256 WebP, sharp on 3× screens; resized from the source) of real-world-asset token marks, used
only next to the token's name. The issuers' own files are too heavy for a 32-pixel row
(ONyc's is a 4000×4000 PNG, 3 MB, served in 13 s). Retrieved 2026-11-08 from the URLs
Jupiter's token list gives for each mint (lite-api.jup.ag/tokens/v2/search).

| File | Token | Mint (Solana) | Source |
|---|---|---|---|
| tokens/onyc.webp | ONyc (OnRe) | 5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5 | arweave.net/PyZzfGP-CqzaVlxTU3sb-I5uv4ZZKwnY8aCjcWn9S1A |
| tokens/pt-onyc.webp | PT-ONyc-10JAN27 (Exponent) | HH7FiYbEfDwQoK2ZJpkMz1T6wG6TqPsWcxWCtEVgigrZ | cdn.exponent.finance/pt-tokens/PT-ONyc.svg |
| tokens/auto.webp | AUTO (Figure) | GNE6oDS6jHrfaV3GQVVCCp37fDnT7PiPuewMKBj2bqNm | storage.googleapis.com/hastra-cdn-prod/spl/autotoken.png |
| tokens/prime.webp | PRIME (Figure) | 3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7 | storage.googleapis.com/hastra-cdn-prod/spl/primetoken.png |
| tokens/pst.webp | PST (Huma) | 59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw | meta.huma.finance/pst.svg |
| tokens/reusd.webp | reUSD (Re Protocol) | 2uxaYT1fVrp6Fg2BrxQcyKSW91hefM6dG9krpbeDiirT | gateway.irys.xyz/9y3EEjMgUU9jHAS5cse5AC4GjVBh4Qr1QYDtZ78G3UzV |
