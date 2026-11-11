import { FormPage } from "../../form-page";
import { newView } from "../views";

export default async function NewPage() {
  const view = await newView();
  return <FormPage title={view.title}>{view.body}</FormPage>;
}
