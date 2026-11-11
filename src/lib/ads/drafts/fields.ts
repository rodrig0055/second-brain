/**
 * The vocabulary the brief and the pipeline share.
 *
 * Its own module because both a server action and a client form need it, and
 * the modules those live in pull in the database and the model SDK, which have
 * no business in a browser bundle.
 */

/** Meta's button types, limited to the ones a commerce ad actually uses. */
export const CTA_OPTIONS = [
  "SHOP_NOW",
  "LEARN_MORE",
  "ORDER_NOW",
  "BUY_NOW",
  "GET_OFFER",
  "SIGN_UP",
] as const;

export type CallToAction = (typeof CTA_OPTIONS)[number];

/**
 * Input names the brief reads by convention.
 *
 * The template owns its questions, so these are looked up rather than required:
 * a template that drops `eventDate` simply lints without a date to compare, and
 * one that adds a question gets it interpolated into the prompt like any other.
 */
export const BRIEF_FIELDS = {
  goal: "goal",
  purpose: "purpose",
  eventDate: "eventDate",
  funnel: "funnel",
  linkUrl: "linkUrl",
  notes: "notes",
} as const;
