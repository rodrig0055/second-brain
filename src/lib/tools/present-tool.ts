import { tool } from "ai";
import { presentInput } from "@/lib/genui/blocks";

/**
 * `present`: the model draws part of its answer as UI instead of markdown.
 *
 * The blocks live in the tool INPUT, which the chat renders (see
 * components/genui). Execution only acknowledges, so the result fed back to
 * the model costs a few tokens however big the table was.
 */
export function presentTools() {
  return {
    present: tool({
      description:
        "Show part of your answer as interactive UI in the chat instead of markdown. " +
        "Use it when the shape of the answer is not prose:\n" +
        "- choices: you are offering 2 to 8 alternatives (headlines, captions, angles, " +
        "next steps) and the user should pick one. Each option is clickable and sends " +
        "its `reply` back as the user's next message.\n" +
        "- draft: a finished piece of copy the user will paste somewhere (caption, " +
        "email, ad text). One block per draft; it gets a copy button.\n" +
        "- form: you need two or more specific inputs before you can do the work " +
        "(dates, budget, audience, product). Ask with a form, not a list of questions.\n" +
        "- kpis / table / chart: numbers YOU computed or compared. Data returned by " +
        "other tools is already shown to the user automatically, so never re-present it.\n" +
        "- callout: one important caveat or warning.\n" +
        "Keep a short text sentence around it for context; do not repeat the block " +
        "contents in text.",
      inputSchema: presentInput,
      execute: async ({ blocks }) => ({ shown: blocks.length }),
    }),
  };
}

/**
 * Appended to the chat system prompt (chat only: task runs don't render tool
 * parts yet). Without it, models retype every tool result as a markdown table
 * that sits right under the same table drawn from the data.
 */
export const GENERATIVE_UI_GUIDANCE = `

## How your answers are displayed
Results from data tools (GA4, Meta, Google Ads, Shopify, Search Console, SendPulse, storefront, social) are shown to the user automatically as KPI tiles, charts and sortable tables, right where you called the tool. Do not rewrite those results as markdown tables or long lists of figures. Lead with what matters (the insight, the change, what to do), quoting only the few numbers your point needs.
Use the \`present\` tool when your answer is a set of options to pick from, a finished draft to copy, a form of inputs you need, or numbers you computed yourself.`;
