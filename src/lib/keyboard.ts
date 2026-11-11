import type { KeyboardEvent } from "react";

/**
 * True when this Enter keydown is an IME confirming a conversion candidate, not a submit.
 *
 * Thai, Vietnamese, Chinese, Japanese and Korean input methods use Enter to commit the
 * character being composed. A handler that submits on every Enter sends half-typed text.
 * `isComposing` covers Chrome and Firefox; Safari delivers `compositionend` before the
 * confirming keydown, so `isComposing` is already false there, but the keydown still
 * reports `keyCode` 229 (VK_PROCESSKEY), which is why both are checked.
 */
export function isImeEnter(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}
