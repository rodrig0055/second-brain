import { RouteSheet } from "@/components/ui/route-sheet";
import { newView, SHEET_WIDTH } from "../../views";

export default async function NewSheet() {
  const view = await newView();
  return (
    <RouteSheet title={view.title} width={SHEET_WIDTH}>
      {view.body}
    </RouteSheet>
  );
}
