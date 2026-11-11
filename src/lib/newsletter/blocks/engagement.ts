/**
 * Engagement blocks: the half of the content framework that is not a product.
 *
 * These earn their place by being opened and read, not by being clicked, so
 * most of them carry no link at all. Every one of them still has to survive
 * Gmail, so no scripts, no forms, no animation.
 */
import { T, priceParts } from "../tokens";
import { defineBlock, type BlockBase, type RenderCtx } from "./types";
import { FONT, esc, sectionTitle, eyebrow, makeButton, productRows } from "./kit";

export type ZodiacBlock = BlockBase & {
  type: "zodiac";
  sign: string;
  dateRange?: string;
  traits?: string;
  body?: string;
  image?: string;
  href?: string;
  products?: string[];
};

export type GiftHackBlock = BlockBase & {
  type: "giftHack";
  title?: string;
  items: Array<{ heading: string; sub: string; image?: string }>;
};

export type EducationBlock = BlockBase & {
  type: "education";
  title: string;
  body: string;
  image?: string;
  href?: string;
  linkLabel?: string;
};

export type SpinWheelBlock = BlockBase & {
  type: "spinWheel";
  title: string;
  body?: string;
  buttonLabel: string;
  href: string;
  image?: string;
};

export type ScrambleBlock = BlockBase & {
  type: "scramble";
  title: string;
  hint: string;
  answer: string;
  footer: string;
  /** Overrides the generated scramble when the team wants a specific one. */
  letters?: string;
};

export type GuideBlock = BlockBase & {
  type: "guide";
  title: string;
  items: Array<{ image: string; heading: string; sub: string; href?: string }>;
};

/**
 * The puzzle letters. Previously the emitter printed a hardcoded "ROSWELNFU"
 * no matter what the answer was, so every scramble shipped the same puzzle.
 * Sorting the answer's letters is a real scramble and is deterministic, so the
 * preview and the send always agree.
 */
function scrambleOf(b: ScrambleBlock): string {
  if (b.letters) return b.letters.toUpperCase();
  const letters = b.answer.replace(/[^a-z]/gi, "").toUpperCase().split("");
  // Seeded from the answer so the preview and the send always show the same
  // puzzle. Sorting alphabetically would also be deterministic, but it reads as
  // sorted rather than scrambled and gives the game away.
  let seed = 0;
  for (const ch of b.answer) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const next = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 0x100000000;
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  return letters.join("");
}

export const zodiacDef = defineBlock<ZodiacBlock>({
  kind: "zodiac",
  label: "Zodiac",
  category: "engagement",
  blurb: "The sign of the month and what to send someone born under it.",
  productSlots: "grid",
  fields: [
    { name: "sign", label: "Sign" },
    { name: "dateRange", label: "Dates" },
    { name: "traits", label: "Traits", hint: 'e.g. "Loyal, stubborn, generous"' },
    { name: "body", label: "Body", kind: "long" },
    { name: "image", label: "Image URL", kind: "url", inline: false },
    { name: "href", label: "Link", kind: "url", inline: false },
  ],
  variants: [
    {
      id: "card",
      label: "Card",
      render: (b, ctx) => [
        ctx.row(`
          <div style="background:#ffffff;border-radius:18px;padding:24px 22px;text-align:center;font-family:${FONT}">
            ${eyebrow("This month's sign")}
            <div style="margin-top:8px;font-size:30px;font-weight:800;color:${T.navy}">${ctx.ed("sign", b.sign)}</div>
            ${b.dateRange || ctx.editable ? `<div style="margin-top:4px;font-size:12px;font-weight:700;letter-spacing:2px;color:${T.pink}">${ctx.ed("dateRange", b.dateRange ?? "")}</div>` : ""}
            ${b.traits || ctx.editable ? `<div style="margin-top:10px;font-size:14px;font-weight:700;color:${T.pink}">${ctx.ed("traits", b.traits ?? "")}</div>` : ""}
            ${b.body || ctx.editable ? `<div style="margin-top:10px;font-size:15px;line-height:1.55;color:${T.navy}">${ctx.ed("body", b.body ?? "")}</div>` : ""}
          </div>`, T.blush, "28px 26px"),
        ...(b.products?.length ? productRows(b.products, b.products.length % 3 === 0 ? 3 : 2, ctx, { bg: T.blush }) : []),
      ],
    },
    {
      id: "split",
      label: "Split",
      blurb: "Illustration beside the reading",
      render: (b, ctx) => [
        ctx.row(`
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            ${b.image ? `<th class="col" width="40%" valign="middle" style="width:40%;font-weight:400;padding:0 12px 0 0">
              <img src="${b.image}" alt="${esc(b.sign)}" width="210" style="display:block;width:100%;height:auto;border-radius:14px;border:0">
            </th>` : ""}
            <th class="col" width="${b.image ? "60%" : "100%"}" valign="middle" style="width:${b.image ? "60%" : "100%"};font-weight:400;padding:0">
              <div style="text-align:left;font-family:${FONT}">
                <div style="font-size:11px;font-weight:800;letter-spacing:2px;color:${T.pink};text-transform:uppercase">This month's sign</div>
                <div style="margin-top:6px;font-size:26px;font-weight:800;color:${T.navy}">${ctx.ed("sign", b.sign)}</div>
                ${b.dateRange || ctx.editable ? `<div style="margin-top:3px;font-size:12px;font-weight:700;color:${T.pink}">${ctx.ed("dateRange", b.dateRange ?? "")}</div>` : ""}
                ${b.body || ctx.editable ? `<div style="margin-top:9px;font-size:14px;line-height:1.55;color:${T.navy}">${ctx.ed("body", b.body ?? "")}</div>` : ""}
              </div>
            </th>
          </tr></table>`, T.blush, "26px 26px"),
        ...(b.products?.length ? productRows(b.products, b.products.length % 3 === 0 ? 3 : 2, ctx, { bg: T.blush }) : []),
      ],
    },
  ],
  empty: () => ({
    type: "zodiac",
    sign: "Virgo",
    dateRange: "23 AUG TO 22 SEP",
    traits: "Precise, loyal, quietly generous",
    body: "A Virgo notices the details, so send something considered rather than something loud.",
    products: [],
  }),
  products: (b) => b.products ?? [],
  links: (b, ctx) =>
    (b.href ? [{ href: b.href, alt: b.sign, width: 600 }] : []).concat(
      (b.products ?? []).map((n) => {
        const p = ctx.catalog.get(n) ?? null;
        return { href: p?.link ?? "", alt: p ? `${p.title} - ${priceParts(p).now}` : n, width: 200, row: "grid3" };
      }),
    ),
  images: (b) => (b.image ? [b.image] : []),
});

export const giftHackDef = defineBlock<GiftHackBlock>({
  kind: "giftHack",
  label: "Gift hack",
  category: "engagement",
  blurb: "Practical tips. Reads as help, not as a pitch.",
  fields: [{ name: "title", label: "Title" }],
  items: {
    prop: "items",
    label: "Tip",
    max: 5,
    fields: [
      { name: "heading", label: "Heading" },
      { name: "sub", label: "Detail", kind: "long" },
      { name: "image", label: "Image URL", kind: "url", inline: false },
    ],
  },
  variants: [
    {
      id: "numbered",
      label: "Numbered list",
      render: (b, ctx) => b.items.length === 0 && !(b.title ?? "").trim() ? [] : [ctx.row(`
        <div style="font-family:${FONT}">
          ${sectionTitle(ctx.ed("title", b.title ?? "Gift hacks"))}
          ${b.items.map((it, n) => `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px"><tr>
            <td width="40" valign="top" style="width:40px;padding:0">
              <div style="width:30px;height:30px;line-height:30px;border-radius:15px;background:${T.pink};color:#fff;
                 text-align:center;font-size:14px;font-weight:800">${n + 1}</div>
            </td>
            <td valign="top" style="padding:0 0 0 4px">
              <div style="font-size:16px;font-weight:800;color:${T.navy};line-height:1.3">${esc(it.heading)}</div>
              <div style="margin-top:4px;font-size:14px;line-height:1.5;color:${T.navy}">${esc(it.sub)}</div>
            </td>
          </tr></table>`).join("")}
        </div>`, T.lavender, "28px 28px 22px")],
    },
    {
      id: "cards",
      label: "Photo cards",
      render: (b, ctx) => b.items.length === 0 ? [] : [
        ctx.row(sectionTitle(ctx.ed("title", b.title ?? "Gift hacks")), T.lavender, "28px 26px 4px"),
        ...b.items.map((it) => ctx.row(`
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            ${it.image ? `<th class="col" width="38%" valign="middle" style="width:38%;font-weight:400;padding:8px 12px 8px 0">
              <img src="${it.image}" alt="${esc(it.heading)}" width="200" style="display:block;width:100%;height:auto;border-radius:12px;border:0">
            </th>` : ""}
            <th class="col" width="${it.image ? "62%" : "100%"}" valign="middle" style="width:${it.image ? "62%" : "100%"};font-weight:400;padding:8px 0">
              <div style="text-align:left;font-family:${FONT}">
                <div style="font-size:17px;font-weight:800;color:${T.pink};line-height:1.25">${esc(it.heading)}</div>
                <div style="margin-top:5px;font-size:14px;line-height:1.5;color:${T.navy}">${esc(it.sub)}</div>
              </div>
            </th>
          </tr></table>`, T.lavender, "0 26px")),
        ctx.row("", T.lavender, "12px 0 0"),
      ],
    },
    {
      id: "single",
      label: "One big tip",
      render: (b, ctx) => {
        const it = b.items[0];
        if (!it) return [];
        return [ctx.row(`
          <div style="text-align:center;font-family:${FONT}">
            ${eyebrow(b.title ?? "Gift hack")}
            <div style="margin-top:8px;font-size:23px;font-weight:800;line-height:1.3;color:${T.navy}">${esc(it.heading)}</div>
            <div style="margin-top:9px;font-size:15px;line-height:1.55;color:${T.navy}">${esc(it.sub)}</div>
          </div>`, T.blush, "30px 30px")];
      },
    },
  ],
  empty: () => ({
    type: "giftHack",
    title: "Gift hacks",
    items: [
      { heading: "Send it the night before", sub: "Morning delivery slots go first, especially on a Friday." },
      { heading: "Write the card first", sub: "It is the part they keep." },
    ],
  }),
  images: (b) => b.items.map((it) => it.image ?? "").filter(Boolean),
});

export const educationDef = defineBlock<EducationBlock>({
  kind: "education",
  label: "Education content",
  category: "engagement",
  blurb: "Flower care, meanings, how-to. The block that earns the open next week.",
  fields: [
    { name: "title", label: "Title" },
    { name: "body", label: "Body", kind: "long" },
    { name: "image", label: "Image URL", kind: "url", inline: false },
    { name: "href", label: "Read-more link", kind: "url", inline: false },
    { name: "linkLabel", label: "Link label" },
  ],
  variants: [
    {
      id: "article",
      label: "Article",
      render: (b, ctx) => !b.title.trim() && !b.body.trim() ? [] : [ctx.row(`
        <div style="font-family:${FONT}">
          ${b.image ? `<img src="${b.image}" alt="${esc(b.title)}" width="548" style="display:block;width:100%;height:auto;border-radius:14px;border:0;margin-bottom:14px">` : ""}
          <div style="font-size:22px;font-weight:800;line-height:1.28;color:${T.navy}">${ctx.ed("title", b.title)}</div>
          <div style="margin-top:9px;font-size:15px;line-height:1.6;color:${T.navy}">${ctx.ed("body", b.body)}</div>
          ${b.href ? `<div style="margin-top:12px"><a class="fx-link" href="${b.href}" style="font-size:14px;font-weight:800;color:${T.pink};text-decoration:underline">${esc(b.linkLabel ?? "Read more")}</a></div>` : ""}
        </div>`, T.lavender, "28px 28px 24px")],
    },
    {
      id: "did-you-know",
      label: "Did you know",
      blurb: "Blush panel, no image needed",
      render: (b, ctx) => !b.title.trim() && !b.body.trim() ? [] : [ctx.row(`
        <div style="text-align:center;font-family:${FONT}">
          ${eyebrow("Did you know")}
          <div style="margin-top:8px;font-size:21px;font-weight:800;line-height:1.3;color:${T.navy}">${ctx.ed("title", b.title)}</div>
          <div style="margin-top:9px;font-size:15px;line-height:1.6;color:${T.navy}">${ctx.ed("body", b.body)}</div>
          ${b.href ? `<div style="margin-top:12px"><a class="fx-link" href="${b.href}" style="font-size:13px;font-weight:800;color:${T.pink};text-decoration:underline">${esc(b.linkLabel ?? "Read more")}</a></div>` : ""}
        </div>`, T.blush, "30px 30px")],
    },
    {
      id: "split",
      label: "Split",
      render: (b, ctx) => !b.title.trim() && !b.body.trim() ? [] : [ctx.row(`
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          ${b.image ? `<th class="col" width="42%" valign="middle" style="width:42%;font-weight:400;padding:0 12px 0 0">
            <img src="${b.image}" alt="${esc(b.title)}" width="225" style="display:block;width:100%;height:auto;border-radius:14px;border:0">
          </th>` : ""}
          <th class="col" width="${b.image ? "58%" : "100%"}" valign="middle" style="width:${b.image ? "58%" : "100%"};font-weight:400;padding:0">
            <div style="text-align:left;font-family:${FONT}">
              <div style="font-size:19px;font-weight:800;line-height:1.28;color:${T.navy}">${ctx.ed("title", b.title)}</div>
              <div style="margin-top:7px;font-size:14px;line-height:1.55;color:${T.navy}">${ctx.ed("body", b.body)}</div>
              ${b.href ? `<div style="margin-top:10px"><a class="fx-link" href="${b.href}" style="font-size:13px;font-weight:800;color:${T.pink};text-decoration:underline">${esc(b.linkLabel ?? "Read more")}</a></div>` : ""}
            </div>
          </th>
        </tr></table>`, T.lavender, "26px 26px")],
    },
  ],
  empty: () => ({
    type: "education",
    title: "Why your flowers last longer in a short vase",
    body: "Stems drink from the bottom, so a shorter vase means a shorter journey. Trim at an angle, change the water every other day, and keep them out of direct sun.",
  }),
  links: (b) => (b.href ? [{ href: b.href, alt: b.title, width: 600 }] : []),
  images: (b) => (b.image ? [b.image] : []),
});

export const spinWheelDef = defineBlock<SpinWheelBlock>({
  kind: "spinWheel",
  label: "Spin the wheel",
  category: "engagement",
  blurb: "Sends readers to the on-site game. The wheel itself cannot run inside an email.",
  fields: [
    { name: "title", label: "Title" },
    { name: "body", label: "Body", kind: "long" },
    { name: "buttonLabel", label: "Button label" },
    { name: "href", label: "Link", kind: "url", inline: false },
    { name: "image", label: "Image URL", kind: "url", inline: false },
  ],
  variants: [
    {
      id: "card",
      label: "Card",
      render: (b, ctx) => [ctx.row(`
        <div style="background:#ffffff;border:2px solid ${T.pink};border-radius:20px;padding:26px 24px;text-align:center;font-family:${FONT}">
          ${b.image ? `<img src="${b.image}" alt="" width="140" style="display:block;margin:0 auto 12px;width:140px;height:auto;border:0">` : ""}
          <div style="font-size:24px;font-weight:800;line-height:1.25;color:${T.navy}">${ctx.ed("title", b.title)}</div>
          ${b.body || ctx.editable ? `<div style="margin-top:9px;font-size:15px;line-height:1.55;color:${T.navy}">${ctx.ed("body", b.body ?? "")}</div>` : ""}
          <div style="margin-top:16px">${makeButton(b.buttonLabel, b.href, undefined, T.pink)}</div>
        </div>`, T.lavender, "22px 26px 28px")],
    },
    {
      id: "banner",
      label: "Pink banner",
      render: (b, ctx) => [ctx.row(`
        <div style="text-align:center;font-family:${FONT};color:#ffffff">
          <div style="font-size:23px;font-weight:800;line-height:1.25">${ctx.ed("title", b.title)}</div>
          ${b.body || ctx.editable ? `<div style="margin-top:8px;font-size:14px;line-height:1.5;opacity:.95">${ctx.ed("body", b.body ?? "")}</div>` : ""}
          <div style="margin-top:14px"><a href="${b.href}" style="display:inline-block;background:#ffffff;color:${T.pink};
            border-radius:22px;padding:12px 28px;font-size:14px;font-weight:800;letter-spacing:1px;text-decoration:none">${esc(b.buttonLabel)}</a></div>
        </div>`, T.pink, "30px 26px")],
    },
  ],
  empty: (ctx) => ({ type: "spinWheel", title: "Spin to win", buttonLabel: "SPIN THE WHEEL", href: ctx.home }),
  links: (b) => [{ href: b.href, alt: b.title, width: 600 }],
  images: (b) => (b.image ? [b.image] : []),
});

export const scrambleDef = defineBlock<ScrambleBlock>({
  kind: "scramble",
  label: "Word scramble",
  category: "engagement",
  blurb: "A puzzle with the answer hidden. Letters are generated from the answer.",
  fields: [
    { name: "title", label: "Title" },
    { name: "hint", label: "Hint" },
    { name: "answer", label: "Answer", hint: "Never printed in the email" },
    { name: "letters", label: "Scramble override", kind: "code" },
    { name: "footer", label: "Footer" },
  ],
  variants: [
    {
      id: "letters",
      label: "Spaced letters",
      render: (b, ctx) => [ctx.row(`
        <div style="text-align:center;font-family:${FONT}">
          <div style="font-size:22px;line-height:1.3;font-weight:800;color:${T.navy}">${ctx.ed("title", b.title)}</div>
          <div style="margin-top:13px;font-size:16px;color:${T.navy}">${ctx.ed("hint", b.hint)}</div>
          <div style="margin-top:14px;font-size:24px;font-weight:900;letter-spacing:9px;color:${T.pink}">${esc(scrambleOf(b))}</div>
          <div style="margin-top:16px;font-size:15px;line-height:1.45;color:${T.navy}">${ctx.ed("footer", b.footer)}</div>
        </div>`, T.blush, "32px 26px")],
    },
    {
      id: "boxes",
      label: "Letter tiles",
      render: (b, ctx) => !b.answer.trim() ? [] : [ctx.row(`
        <div style="text-align:center;font-family:${FONT}">
          <div style="font-size:22px;line-height:1.3;font-weight:800;color:${T.navy}">${ctx.ed("title", b.title)}</div>
          <div style="margin-top:13px;font-size:16px;color:${T.navy}">${ctx.ed("hint", b.hint)}</div>
          <div style="margin-top:16px">
            ${scrambleOf(b).split("").map((ch) => `<span style="display:inline-block;width:32px;height:38px;line-height:38px;margin:3px;
              background:#ffffff;border-radius:7px;font-size:19px;font-weight:800;color:${T.pink}">${esc(ch)}</span>`).join("")}
          </div>
          <div style="margin-top:16px;font-size:15px;line-height:1.45;color:${T.navy}">${ctx.ed("footer", b.footer)}</div>
        </div>`, T.blush, "32px 22px")],
    },
  ],
  empty: () => ({
    type: "scramble",
    title: "Guess the flower",
    hint: "It turns to follow the light",
    answer: "SUNFLOWER",
    footer: "Reply with your answer and we will send a voucher to the first ten.",
  }),
});

export const guideDef = defineBlock<GuideBlock>({
  kind: "guide",
  label: "Gift guide rows",
  category: "engagement",
  blurb: 'Editorial rows: a photo and a shout, e.g. "IF THEY ARE FAR AWAY". Use landscape photos; a tall one leaves the copy floating.',
  fields: [{ name: "title", label: "Title" }],
  items: {
    prop: "items",
    label: "Row",
    max: 6,
    fields: [
      { name: "image", label: "Image URL", kind: "url", inline: false },
      { name: "heading", label: "Heading" },
      { name: "sub", label: "Sub line" },
      { name: "href", label: "Link", kind: "url", inline: false },
    ],
  },
  variants: [
    {
      id: "rows",
      label: "Photo rows",
      render: (b, ctx) => guideRows(b, ctx, false),
    },
    {
      id: "alternating",
      label: "Alternating sides",
      blurb: "Photo swaps left and right down the list",
      render: (b, ctx) => guideRows(b, ctx, true),
    },
  ],
  empty: () => ({
    type: "guide",
    title: "Who are you sending to?",
    items: [
      { image: "", heading: "IF THEY ARE FAR AWAY", sub: "Send something that lasts past the day." },
      { image: "", heading: "IF YOU ALMOST FORGOT", sub: "Same-day delivery still has your back." },
    ],
  }),
  links: (b) => b.items.map((it) => ({ href: it.href ?? "", alt: it.heading, width: 600 })),
  images: (b) => b.items.map((it) => it.image).filter(Boolean),
});

function guideRows(b: GuideBlock, ctx: RenderCtx, alternate: boolean): string[] {
  // Nothing to show is not a band of colour with nothing in it.
  if (b.items.length === 0 && !b.title.trim()) return [];

  const rows = [ctx.row(
    `<div style="text-align:center;font-family:${FONT};font-size:26px;line-height:1.2;font-weight:800;color:${T.navy}">${ctx.ed("title", b.title)}</div>`,
    T.blush, "30px 26px 18px")];

  for (const [n, it] of b.items.entries()) {
    const photoFirst = !alternate || n % 2 === 0;

    // The gutter is a spacer CELL, not padding on the columns.
    //
    // Every column here carries class="col", and the mobile rule sets
    // .col{padding:4px!important} -- which flattened the asymmetric padding the
    // gutter used to rely on and left the photo touching the copy panel. A cell
    // of fixed width is structure: no media query can collapse it.
    const photo = `
      <th class="col" width="43%" valign="middle" style="width:43%;font-weight:400;padding:0">
        ${it.href ? `<a class="fx-tile" href="${it.href}" style="display:block;text-decoration:none">` : ""}
        <img class="fx-shot" src="${it.image}" alt="${esc(it.heading)}" width="240"
          style="display:block;width:100%;height:auto;border-radius:14px;border:0;background:${T.tile}">
        ${it.href ? "</a>" : ""}
      </th>`;
    const copy = `
      <th class="col" width="49%" valign="middle" style="width:49%;font-weight:400;padding:0">
        <div style="background:${T.lavender};border-radius:14px;padding:20px 18px;text-align:center;font-family:${FONT}">
          <div style="font-size:18px;line-height:1.25;font-weight:800;color:${T.pink};letter-spacing:.3px">${esc(it.heading)}</div>
          <div style="margin-top:8px;font-size:15px;line-height:1.5;color:${T.navy}">${esc(it.sub)}</div>
        </div>
      </th>`;
    const gutter = `<th width="8%" style="width:8%;font-weight:400;padding:0;font-size:0;line-height:0">&nbsp;</th>`;

    rows.push(ctx.row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%">
        <tr>${photoFirst ? photo + gutter + copy : copy + gutter + photo}</tr>
      </table>`,
      // The bottom padding is the gap between rows, so the last one closes the
      // block rather than needing a spacer row after it.
      T.blush, "0 26px 14px"));
  }

  rows.push(ctx.row("", T.blush, "0 0 8px"));
  return rows;
}
