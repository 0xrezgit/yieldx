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
