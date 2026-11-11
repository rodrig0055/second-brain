import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { taskTemplates, teams } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { getModelOptions } from "@/lib/models";
import { TemplateEditor } from "@/components/template-editor";
import { deleteTemplate, saveTemplate } from "./actions";

/**
 * What the create and edit forms show, loaded once for both places they open:
 * the full page (a shared link, a refresh) and the side panel over the list.
 */

export async function newView() {
  await requireAdmin();
  const [allTeams, models] = await Promise.all([
    db.query.teams.findMany({ orderBy: [asc(teams.name)] }),
    getModelOptions(),
  ]);
  return {
    title: "New template",
    body: <TemplateEditor action={saveTemplate} teams={allTeams} models={models} />,
  };
}

export async function editView(id: string) {
  await requireAdmin();
  const [template, allTeams, models] = await Promise.all([
    db.query.taskTemplates.findFirst({ where: eq(taskTemplates.id, id) }),
    db.query.teams.findMany({ orderBy: [asc(teams.name)] }),
    getModelOptions(),
  ]);
  if (!template) notFound();
  return {
    title: `Edit: ${template.name}`,
    body: (
      <TemplateEditor
        action={saveTemplate}
        deleteAction={deleteTemplate}
        teams={allTeams}
        models={models}
        template={template}
      />
    ),
  };
}

export const SHEET_WIDTH = 896;
