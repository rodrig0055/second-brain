import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectImages,
  extractMetadata,
  htmlToMarkdown,
  isChallengePage,
  looksEmpty,
} from "./fetch-page";

const BASE = new URL("https://bloomly-sg.example/product/celebratory-sunshine");

const PRODUCT = `<!doctype html><html><head>
<title>Celebratory Sunshine - Bloomly SG</title>
<meta name="description" content="A radiant bouquet.">
<meta property="og:title" content="Celebratory Sunshine">
<meta property="og:image" content="/img/meta/600_main.webp?v=2">
</head><body>
<nav>Birthdays Occasions</nav>
<main><h1>Celebratory Sunshine</h1><p>Sunflowers and a graduation bear. ${"Lovely. ".repeat(40)}</p>
<img src="https://cdn.example.com/variant/600_a.webp">
<img data-src="//cdn.example.com/variant/600_b.webp?w=1">
<img src="https://cdn.example.com/variant/150_thumb.webp">
<img src="/assets/logo.png">
<img src="data:image/gif;base64,AAAA">
<h2>You may also like</h2>
<img src="https://cdn.example.com/variant/600_crosssell.webp">
</main><footer>© Bloomly</footer></body></html>`;

test("extractMetadata reads title, description and an absolute og:image", () => {
  const meta = extractMetadata(PRODUCT, BASE);
  assert.equal(meta.title, "Celebratory Sunshine - Bloomly SG");
  assert.equal(meta.description, "A radiant bouquet.");
  assert.equal(meta.ogTitle, "Celebratory Sunshine");
  assert.equal(meta.ogImage, "https://bloomly-sg.example/img/meta/600_main.webp?v=2");
});

test("collectImages leads with og:image and stops at the cross-sell section", () => {
  assert.deepEqual(collectImages(PRODUCT, BASE), [
    "https://bloomly-sg.example/img/meta/600_main.webp",
    "https://cdn.example.com/variant/600_a.webp",
    "https://cdn.example.com/variant/600_b.webp",
  ]);
});

test("htmlToMarkdown keeps page copy and drops nav/footer chrome", () => {
  const md = htmlToMarkdown(PRODUCT, BASE);
  assert.match(md, /Sunflowers and a graduation bear/);
  assert.doesNotMatch(md, /Birthdays Occasions/);
  assert.doesNotMatch(md, /© Bloomly/);
});

test("isChallengePage spots Cloudflare interstitials", () => {
  assert.equal(isChallengePage("<html><head><title>Just a moment...</title>"), true);
  assert.equal(isChallengePage('<script src="/cdn-cgi/challenge-platform/x.js">'), true);
  assert.equal(isChallengePage(PRODUCT), false);
});

test("looksEmpty flags JS shells but not real pages", () => {
  assert.equal(
    looksEmpty('<html><body><div id="root"></div><script>var a=1</script></body></html>'),
    true,
  );
  assert.equal(looksEmpty(PRODUCT), false);
});
