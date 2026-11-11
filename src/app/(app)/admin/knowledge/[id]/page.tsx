import { FormPage } from "../../form-page";
import { editView } from "../views";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const view = await editView((await params).id);
  return <FormPage title={view.title}>{view.body}</FormPage>;
}
