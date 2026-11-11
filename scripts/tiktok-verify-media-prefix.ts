/**
 * Prove to TikTok that we own the URL prefix our social media is served from,
 * which TikTok requires before it will publish any video or photo by URL.
 *
 * Our media is on R2's public `pub-….r2.dev` host. We cannot add a DNS record
 * to r2.dev, so this verifies a URL PREFIX instead of a domain: TikTok hands
 * back a signature file name and content, we put that file inside the prefix,
 * and TikTok fetches it.
 *
 *   set -a && . ./.env.local && set +a && npx tsx scripts/tiktok-verify-media-prefix.ts
 *
 * Needs TIKTOK_APP_ID / TIKTOK_APP_SECRET and the STORAGE_* variables (the R2
 * bucket). Idempotent: re-running re-uploads the file and re-checks. When it
 * prints "verified", set TIKTOK_MEDIA_PREFIXES to the prefix in Vercel.
 */
import { tiktokApp, tiktokPost } from "../src/lib/integrations/tiktok/api";
import { s3Put } from "../src/lib/storage/s3";

/** Everything Compose writes for social lives under here (src/lib/social/media.ts). */
const KEY_PREFIX = "social/";

type PropertyInfo = {
  url_property_info?: {
    url?: string;
    property_status?: number;
    signature?: string;
    file_name?: string;
  };
};

async function main() {
  const base = process.env.STORAGE_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("STORAGE_PUBLIC_BASE_URL is not set.");
  const prefix = `${base}/${KEY_PREFIX}`;
  const { appId, secret } = tiktokApp();
  const meta = { url_property_meta: { property_type: 2, url: prefix } };

  console.log(`Adding URL prefix ${prefix}`);
  const added = await tiktokPost<PropertyInfo>("/business/property/add/", null, {
    app_id: appId,
    secret,
    ...meta,
  });
  const info = added.url_property_info ?? {};
  if (info.property_status === 1) {
    console.log("Already verified.");
  } else {
    if (!info.signature || !info.file_name) {
      throw new Error(`TikTok returned no signature for ${prefix}: ${JSON.stringify(added)}`);
    }
    // TikTok fetches <prefix><file_name> and compares the body to the signature.
    // One ".txt", never two: the doc warns a doubled extension fails silently.
    const fileName = info.file_name.replace(/(\.txt)+$/i, ".txt");
    const { url } = await s3Put(`${KEY_PREFIX}${fileName}`, info.signature, {
      contentType: "text/plain",
    });
    console.log(`Uploaded signature file: ${url}`);
  }

  const checked = await tiktokPost<PropertyInfo>("/business/property/verify/", null, {
    app_id: appId,
    secret,
    ...meta,
  });
  const status = checked.url_property_info?.property_status;
  if (status === 1) {
    console.log(`verified. Set TIKTOK_MEDIA_PREFIXES=${prefix} in Vercel.`);
  } else {
    console.log(`Not verified yet (status ${status}). R2 can take a minute to serve the file; run again.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
