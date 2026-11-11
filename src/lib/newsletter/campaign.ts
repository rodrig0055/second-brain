/**
 * The campaign model: what a newsletter IS, independent of how it is rendered.
 *
 * This is the contract between the brain (which proposes one of these from the
 * content framework + brief) and the renderers (which turn it into an email).
 *
 * The block vocabulary itself lives in ./blocks, one module per kind. This file
 * deliberately holds no switch over block types: everything that used to need
 * one now reads the registry instead.
 */
import type { RegisteredBlock } from "./blocks";

export type Product = { name: string };

/** A stored block. Every kind declares its own shape in its own module. */
export type Block = RegisteredBlock;

/**
 * Rows must be full. Six and three go 3-across, four and two go 2-across; any
 * count that would leave a lone tile has no valid layout and returns null.
 * Decided 2026-09-14 against the shipped sends, which never orphan a tile.
 */
export function gridColumns(n: number): 2 | 3 | null {
  if (n <= 0) return null;
  if (n % 3 === 0) return 3;
  if (n % 2 === 0) return 2;
  return null;
}

/** Largest count <= n that fills its rows. Used where trimming is acceptable. */
export function fullRowCount(n: number): number {
  for (let k = n; k > 0; k--) if (gridColumns(k)) return k;
  return 0;
}

export type Campaign = {
  brand: string;
  domain: string;
  date: string;
  subject: string;
  preheader: string;
  blocks: Block[];
};
