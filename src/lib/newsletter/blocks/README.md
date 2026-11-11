# Newsletter blocks

A block is one section of an email. It declares its own data shape, its editable
fields, its designs ("variants"), its outbound links and its product slots, in
one module. Everything else reads that declaration:

| Reads the registry | For |
| --- | --- |
| `emit-html.ts` | rendering the email |
| `links.ts` | every outbound link, product name and image URL |
| `validate.ts` | products, full rows, empty blocks, image URLs |
| the editor page | field inputs, the design picker, the add menu |
| `actions.ts` | which fields may be written, what a new block looks like |
| `planner.ts` | the vocabulary the brain is allowed to propose |
| `templates.ts` | the arrangements a campaign can start from |

Before this existed, adding a block meant editing six switch statements, and
the ones people forgot (validation, links) failed silently.

## Adding a block

1. **Write the module.** Copy the closest existing one. `engagement.ts` has the
   simplest examples; `products.ts` has the ones with product slots.

   ```ts
   export type MyBlock = BlockBase & { type: "myBlock"; title: string };

   export const myBlockDef = defineBlock<MyBlock>({
     kind: "myBlock",          // stored in the DB, never change it afterwards
     label: "My block",        // what the marketer sees
     category: "engagement",   // commercial | engagement | furniture
     blurb: "One sentence. Shown in the add menu and given to the planner.",
     fields: [{ name: "title", label: "Title" }],
     variants: [
       { id: "plain", label: "Plain", render: (b, ctx) => [ctx.row(`...`)] },
     ],
     empty: () => ({ type: "myBlock", title: "" }),
   });
   ```

2. **Register it** in `index.ts`: import it, add it to `DEFS` where you want it
   to appear in the add menu, and add its type to `RegisteredBlock`.

3. **Run the renderer test.** It walks every block in every variant, filled and
   empty, in both preview and sending mode:

   ```
   npx tsx scripts/newsletter/test-blocks.ts
   ```

   Add a filled sample for your block to its `sample()` map, or it is only
   checked empty.

That is the whole job. It appears in the add menu, the planner can propose it,
its links are validated, and its fields are editable both in the side panel and
inline in the preview.

## Rules a renderer has to follow

- **Return `<tr>` rows**, not a fragment. Use `ctx.row(inner, bg, pad)`. A grid
  returns one row per row of tiles.
- **Tables for layout.** No flexbox, no grid, no positioning. Outlook renders
  through Word.
- **Inline styles only.** The one `<style>` block in the document carries the
  mobile media query and nothing a client is allowed to drop.
- **Columns get `class="col"` and a percentage width**, so the desktop shape
  survives on a phone instead of stacking one item per screen.
- **Copy goes through `ctx.ed(field, text)`**, which escapes it and, in preview
  mode, makes it editable in place. Anything not passed through `ctx.ed` must go
  through `esc`.
- **Every image needs a real `src`.** An empty one renders as a broken-image
  icon; fall back to a typographic treatment instead (see `amplify.ts`).
- **Links are declared, not just rendered.** If your block renders an `<a>`, it
  must also appear in `links()`, or the validator cannot check it and the
  results ingester cannot attribute its clicks.

## Variants

A variant is a different design over the same data, so switching is always safe:
no copy is lost, and an unknown or removed variant id falls back to the first
one at render time rather than blanking the block. Give each one a short `label`
(it becomes a pill in the editor) and a `blurb` when the difference is not
obvious from the name.

## What not to do

- Do not change a `kind` after it ships. It is the discriminator stored in the
  `blocks` JSON of every campaign, including ones already sent.
- Do not read a brand constant. The storefront, the occasion nav, the currency
  and the logo all come from the campaign's own domain via `ctx.home`,
  `occasions(ctx.campaign.domain)`, `money()` and `ctx.assets`. A hardcoded
  `bloomly-sg.example` shipped once and pointed PH subscribers at the Singapore store.
- Do not put a script, a form, a video or a webfont-dependent layout in a block.
  Gmail strips all of them.
