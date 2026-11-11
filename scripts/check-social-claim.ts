/**
 * Verify that claiming a draft for publishing is genuinely exclusive.
 *
 * This is the one piece of SQL that stops a post going out twice. The Neon HTTP
 * driver has no transactions, so exclusivity has to come from a single
 * conditional UPDATE, and the only way to know it holds is to run it against a
 * real database. Creates a temporary draft, hammers the claim, removes it.
 *
 *   npx tsx --env-file=.env.local scripts/check-social-claim.ts
 *
 * Keep in step with `claim()` in src/lib/social/publisher.ts.
 */
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const CLAIM = `
UPDATE social_post_drafts
   SET status = 'publishing', claimed_at = now(),
       publish_attempts = publish_attempts + 1, error = NULL, updated_at = now()
 WHERE id = $1
   AND ( status IN ('draft','failed')
         OR (status = 'publishing' AND claimed_at < now() - interval '10 minutes') )
 RETURNING id, status, publish_attempts`;

async function main() {
  const [brand] = await sql`select id, name from brands where slug = 'bloomly-ph'`;
  const [row] = await sql`
    insert into social_post_drafts (brand_id, channel, media_type, caption, status)
    values (${brand.id}, 'instagram', 'image', '[claim check] temporary row', 'draft')
    returning id`;
  const id = row.id;
  console.log("temp draft", id, "on", brand.name);

  try {
    const first = await sql.query(CLAIM, [id]);
    console.log("first claim  ->", first.length ? `${first[0].status} attempt ${first[0].publish_attempts}` : "no row");

    const second = await sql.query(CLAIM, [id]);
    console.log("second claim ->", second.length ? "CLAIMED AGAIN (wrong)" : "refused (correct)");

    // A stalled row must become claimable again.
    await sql`update social_post_drafts set claimed_at = now() - interval '11 minutes' where id = ${id}`;
    const third = await sql.query(CLAIM, [id]);
    console.log("after 11 min ->", third.length ? `reclaimed, attempt ${third[0].publish_attempts} (correct)` : "still refused (wrong)");

    // Terminal states must never be claimable.
    for (const status of ["published", "discarded", "scheduled"]) {
      await sql.query(`update social_post_drafts set status = $2 where id = $1`, [id, status]);
      const r = await sql.query(CLAIM, [id]);
      console.log(`${status.padEnd(10)} ->`, r.length ? "CLAIMED (wrong)" : "refused (correct)");
    }
  } finally {
    await sql`delete from social_post_drafts where id = ${id}`;
    console.log("temp row removed");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
