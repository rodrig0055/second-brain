/**
 * Soft navigation keeps a slot's last state, so without a match here the panel
 * would stay open on the next page. Each Social page resets it to nothing:
 * this one for the overview, and one re-export per sub-page. Not a catch-all,
 * which would make every unknown /social/* URL a route and turn its 404 into
 * a 200.
 */
export default function NoSheet() {
  return null;
}
