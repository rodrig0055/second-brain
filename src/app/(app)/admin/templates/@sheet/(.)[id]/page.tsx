import { RouteSheet } from "@/components/ui/route-sheet";
import { editView, SHEET_WIDTH } from "../../views";

export default async function EditSheet({ params }: { params: Promise<{ id: string }> }) {
  const view = await editView((await params).id);
  return (
    <RouteSheet title={view.title} width={SHEET_WIDTH}>
      {view.body}
    </RouteSheet>
  );
}
