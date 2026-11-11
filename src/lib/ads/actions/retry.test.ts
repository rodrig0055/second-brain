import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ResponseTooLargeError,
  TransportError,
} from "@/lib/integrations/http";
import { MetaApiError } from "@/lib/integrations/meta/client";
import { routeWriteFailure, type FailureRoute } from "./retry";

function route(
  err: unknown,
  actionKind: string,
  attempts = 0,
): FailureRoute {
  return routeWriteFailure(err, { actionKind, attempts });
}

/** Meta answered and refused, transiently. Nothing was applied. */
const rateLimited = new MetaApiError(400, {
  message: "User request limit reached",
  code: 17,
});

/** Meta answered and refused, permanently. */
const noPermission = new MetaApiError(403, {
  message: "(#200) Requires ads_management permission",
  code: 200,
});

/** The reply never arrived. Meta may or may not have applied the write. */
const timedOut = new TransportError("timed out", true);
const connectionLost = new TransportError("socket hang up", false);

test("a lost reply on creation is never retried", () => {
  // The whole point. Creating an ad twice is two ads, and the second one is
  // spending money nobody approved.
  assert.equal(route(timedOut, "create_ad"), "outcome_unknown");
  assert.equal(route(connectionLost, "create_ad"), "outcome_unknown");
  assert.equal(
    route(new ResponseTooLargeError(1024), "create_ad"),
    "outcome_unknown",
  );
});

test("a lost reply on a status change is retried, because repeating it is a no-op", () => {
  assert.equal(route(timedOut, "pause_ad"), "retry");
  assert.equal(route(connectionLost, "activate_ad"), "retry");
});

test("running out of attempts does not make a lost reply any more known", () => {
  // Two prior attempts is the last one allowed, so this is the end of the road.
  // Ending at `failed` here would claim the ad is still active when it may not
  // be, so it ends at outcome_unknown even for the repeatable kinds.
  assert.equal(route(timedOut, "pause_ad", 2), "outcome_unknown");
  assert.equal(route(timedOut, "create_ad", 2), "outcome_unknown");
});

test("a refusal Meta actually sent is a failure, not an unknown", () => {
  // Meta answered, so nothing is half-applied. A rate limit is worth another
  // go; a permissions error is the same answer every time.
  assert.equal(route(rateLimited, "pause_ad"), "retry");
  assert.equal(route(rateLimited, "create_ad"), "retry");
  assert.equal(route(noPermission, "pause_ad"), "failed");
  assert.equal(route(noPermission, "create_ad"), "failed");
});

test("a transient refusal stops retrying once the attempts are spent", () => {
  assert.equal(route(rateLimited, "pause_ad", 2), "failed");
});

test("an ordinary error is a failure", () => {
  // e.g. "Meta returned no creative id" — a reply arrived, it was just useless.
  assert.equal(route(new Error("Meta returned no creative id."), "create_ad"), "failed");
});

test("the phase 4 field writes are repeatable, creation still is not", () => {
  // Setting daily_budget to 50000 twice leaves it at 50000. Creating twice
  // leaves two ads spending money nobody approved.
  for (const kind of ["set_status", "set_budget", "set_schedule"]) {
    assert.equal(route(timedOut, kind), "retry", `${kind} was not repeatable`);
  }
  assert.equal(route(timedOut, "create_ad"), "outcome_unknown");
});

test("creating a campaign is never retried, like creating an ad", () => {
  // Neither is findable by a tag the way an ad is, so a repeat leaves two
  // campaigns and no way to tell which was wanted.
  assert.equal(route(timedOut, "create_structure"), "outcome_unknown");
  assert.equal(route(connectionLost, "create_structure"), "outcome_unknown");
  // A refusal Meta actually sent is still safe to retry: nothing was made.
  assert.equal(route(rateLimited, "create_structure"), "retry");
});
