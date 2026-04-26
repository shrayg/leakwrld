# Static images (site UI)

All URLs are served from the repo root as **`/images/...`** (see `server.js`: `/images/` static prefix + legacy redirects).

| File | Role |
|------|------|
| **`face.png`** | Favicon, PWA icon, OG/Twitter defaults, placeholders — **PNG** (valid signature). |
| **`preview.jpg`** | Marketing/preview asset — **JPEG** (`.jpg` extension; do not rename to `.png`). |
| **`top_preview.png`** | Age-disclaimer banner image — **PNG**. |
| **`checkout/image1.png`** … | Checkout page screenshot slots — **`image2.jpg`** / **`image3.jpg`** are JPEG with correct extensions. |

Category tiles on disk live under **`/thumbnails/`** (separate from this folder).

Legacy URLs **`/face.png`**, **`/checkout-images/…`**, etc. **301 redirect** here so old links keep working.
