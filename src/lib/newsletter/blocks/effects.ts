/**
 * Hover, transition and motion.
 *
 * All of it lives in the document's one <style> block, because :hover and
 * @keyframes cannot be inlined. That makes every rule here PURE ENHANCEMENT:
 * strip the block and the email must be complete and correct, which
 * scripts/newsletter/test-blocks.ts asserts on all 62 designs.
 *
 * Worth it for this audience. Opens on Bloomly SG break down 60% Apple Mail,
 * 32% Gmail, 0.14% Outlook desktop, and Can I Email lists hover, transition
 * and animation as supported in both Apple Mail and Gmail. The low headline
 * support numbers (animation 31.7%) are dragged down by Outlook desktop and
 * regional clients that barely appear in these sends.
 *
 * Two constraints shape what is here:
 *
 *   Hover needs a pointing device. Most of that Apple share is iPhone, where
 *   hover does not exist, so hover is polish for desktop readers and nothing
 *   is allowed to depend on it.
 *
 *   Email has no scroll trigger. An animation on a block below the fold has
 *   already finished by the time anyone scrolls to it, so motion is confined
 *   to the hero. Animating a product grid would be work nobody ever sees.
 */
import { T } from "../tokens";

export const EFFECTS_CSS = `
  /* Hover: decoration only.
   *
   * Every rule that touches a property the block also sets INLINE carries
   * !important, and that is not laziness. An inline declaration beats a
   * stylesheet one at any specificity, so without it the rule silently does
   * nothing. Two effects shipped broken that way before a browser test caught
   * them; scripts/newsletter/test-blocks.ts now fails the build instead.
   *
   * Gmail is 32% of opens and does not support transform, so nothing here
   * relies on movement alone: every hover also changes a colour or a shadow,
   * which Gmail does support. */
  .fx-btn{transition:background-color .18s ease,transform .18s ease,box-shadow .18s ease}
  .fx-btn:hover{background-color:${T.navyDeep}!important;transform:translateY(-1px);box-shadow:0 5px 16px rgba(55,68,105,.3)}
  .fx-tile{transition:transform .22s ease}
  .fx-tile:hover{transform:translateY(-3px)}
  .fx-shot{transition:border-color .22s ease,box-shadow .22s ease}
  .fx-tile:hover .fx-shot{border-color:${T.navy}!important;box-shadow:0 10px 22px rgba(55,68,105,.2)}
  .fx-nav{transition:opacity .18s ease,transform .18s ease}
  .fx-nav:hover{opacity:.84;transform:translateY(-2px)}
  .fx-link{transition:color .18s ease}
  .fx-link:hover{color:${T.pink}!important}

  /* Motion: the hero only, because nothing below the fold is ever watched.
   *
   * Animations outrank inline styles in the cascade, so these need no
   * !important. fxRise leads with opacity and fxPulse with a glow, so Gmail
   * sees a fade and a pulse even though it ignores the transform. */
  @keyframes fxRise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
  @keyframes fxPulse{
    0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(214,58,96,.5)}
    50%{transform:scale(1.05);box-shadow:0 0 0 12px rgba(214,58,96,0)}
  }
  .fx-rise{animation:fxRise .55s cubic-bezier(.22,.61,.36,1) both}
  .fx-d1{animation-delay:.09s}
  .fx-d2{animation-delay:.18s}
  .fx-d3{animation-delay:.27s}
  /* Three beats, not forever: this replays on every open, and a badge that
     never stops moving is the kind of thing people mute a sender over. */
  .fx-pulse{animation:fxPulse 2.2s ease-in-out .9s 3}
  /* Both classes set the \`animation\` shorthand, so the later one wins outright
     and the badge pulsed without ever rising. Declaring the pair explicitly is
     the only way to run both. */
  .fx-rise.fx-pulse{animation:fxRise .55s cubic-bezier(.22,.61,.36,1) both,fxPulse 2.2s ease-in-out .9s 3}

  /* Someone who has asked their OS for less motion gets none of it. */
  @media (prefers-reduced-motion:reduce){
    .fx-rise,.fx-pulse{animation:none!important}
    .fx-btn,.fx-tile,.fx-shot,.fx-nav,.fx-link{transition:none!important}
  }
`;
