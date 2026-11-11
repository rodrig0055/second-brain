import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  Output,
  stepCountIs,
  streamText,
} from "ai";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { taskRuns, taskTemplates } from "@/db/schema";
import { reviewDraft } from "@/lib/review/review";
import { accessErrorResponse, apiBrand, apiTeam } from "@/lib/access";
import { getModelOptions, providerOf, resolveModel } from "@/lib/models";
import { buildSystemPrompt, fillTemplate } from "@/lib/prompt";
import { fetchPageContext, urlInputs } from "@/lib/fetch-page";
import { reportSchema } from "@/lib/reports/schema";
import { buildSeoTools } from "@/lib/tools";
import { buildBrainTools } from "@/lib/tools/brain-tools";
import { logUsage } from "@/lib/usage";
import { hasCapability } from "@/lib/workspaces";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const {
      templateId,
      brandId,
      inputs,
      model,
    }: {
      templateId?: string;
      brandId?: string;
      inputs?: Record<string, string>;
      model?: string;
    } = await req.json();

    if (!templateId || !brandId) {
      return Response.json({ error: "Missing template or brand" }, { status: 400 });
    }

    const template = await db.query.taskTemplates.findFirst({
      where: eq(taskTemplates.id, templateId),
      with: { team: true },
    });
    if (!template || !template.isActive) {
      return Response.json({ error: "Template not found" }, { status: 404 });
    }
    const { user } = await apiTeam(template.team.slug);
    // 404/403s if the user has no access to the selected brand.
    const { brand } = await apiBrand(brandId);

    // Per-run model override: use it only if it's a known model id, else fall
    // back to the template's configured model.
    const modelOptions = await getModelOptions();
    const runModel = modelOptions.some((o) => o.id === model)
      ? model!
      : template.model;

    const cleanInputs: Record<string, string> = {};
    for (const field of template.inputFields) {
      const v = inputs?.[field.name];
      if (field.required && (!v || !v.trim())) {
        return Response.json(
          { error: `Missing required field: ${field.label}` },
          { status: 400 },
        );
      }
      cleanInputs[field.name] = (v ?? "").slice(0, 8000);
    }

    const [run] = await db
      .insert(taskRuns)
      .values({
        templateId: template.id,
        userId: user.id,
        brandId: brand.id,
        inputs: cleanInputs,
        model: runModel,
        status: "running",
      })
      .returning();

    const system = await buildSystemPrompt(brand.id, template.teamId);
    let prompt = fillTemplate(template.promptTemplate, cleanInputs);

    // Fetch any URL inputs server-side and append the extracted page context.
    const urls = urlInputs(cleanInputs).slice(0, 2);
    if (urls.length > 0) {
      const fetched = await Promise.all(urls.map(fetchPageContext));
      const blocks = urls
        .map((u, i) => (fetched[i] ? `# Fetched content from ${u}\n${fetched[i]}` : null))
        .filter(Boolean);
      if (blocks.length > 0) {
        prompt += `\n\n---\n\n${blocks.join("\n\n")}`;
      }
    }


    // SEO templates get live SEO tools (GSC via BigQuery + Ahrefs); every brand
    // additionally gets the brain tools for whatever integrations it has
    // connected (Shopify, …). All bound to the selected brand. Text-only if none.
    const seoTools = hasCapability(template.team.slug, "seoTools") ? buildSeoTools(brand) : {};
    const brainTools = await buildBrainTools(brand, template.team.slug);
    const tools = { ...seoTools, ...brainTools };
    const hasTools = Object.keys(tools).length > 0;

    const resolvedModel = await resolveModel(runModel);

    // Report templates gather data via tools, then return a typed object (KPI
    // tiles + tables) instead of prose. We stream the tool-call steps as
    // UI-message parts (so the client can show live activity), then write the
    // final validated report as a custom `data-report` part for <ReportView>.
    if (template.renderAs === "report") {
      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          const result = streamText({
            model: resolvedModel,
            // Stop the upstream model call if the client disconnects.
            abortSignal: req.signal,
            // Anthropic: system prompt as a leading system message so an
            // Anthropic cache_control breakpoint can ride on it, caching the
            // system + tool-definition prefix for the 5-min window;
            // allowSystemInMessages silences the injection warning (trusted,
            // server-assembled prompt). Other providers keep the plain
            // system/prompt options and cache the prefix automatically.
            ...(providerOf(runModel) === "anthropic"
              ? {
                  allowSystemInMessages: true,
                  messages: [
                    {
                      role: "system" as const,
                      content: system,
                      providerOptions: {
                        anthropic: { cacheControl: { type: "ephemeral" } },
                      },
                    },
                    { role: "user" as const, content: prompt },
                  ],
                }
              : { system, prompt }),
            tools: hasTools ? tools : undefined,
            stopWhen: hasTools ? stepCountIs(8) : undefined,
            experimental_output: Output.object({ schema: reportSchema }),
            onFinish: async ({ totalUsage }) => {
              await logUsage({
                kind: "task",
                model: runModel,
                usage: totalUsage,
                userId: user.id,
                brandId: brand.id,
                teamId: template.teamId,
                refId: run.id,
              });
            },
          });
          // Stream text + tool-call parts for the live activity line.
          writer.merge(result.toUIMessageStream());
          // Then the final typed report object.
          const report = await result.output;
          await db
            .update(taskRuns)
            .set({ output: JSON.stringify(report), status: "done" })
            .where(eq(taskRuns.id, run.id));
          writer.write({ type: "data-report", data: report });
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : "Report generation failed.";
          // Persist the reason (in `output`) so the Outputs view can show *why* it failed.
          void db
            .update(taskRuns)
            .set({ status: "error", output: msg })
            .where(eq(taskRuns.id, run.id));
          return msg;
        },
      });
      return createUIMessageStreamResponse({
        stream,
        headers: { "X-Run-Id": run.id },
      });
    }

    const result = streamText({
      model: resolvedModel,
      // Stop the upstream model call if the client disconnects.
      abortSignal: req.signal,
      // Anthropic: leading cache_control system message (see report branch
      // above); other providers keep plain system/prompt and cache the prefix
      // automatically.
      ...(providerOf(runModel) === "anthropic"
        ? {
            allowSystemInMessages: true,
            messages: [
              {
                role: "system" as const,
                content: system,
                providerOptions: {
                  anthropic: { cacheControl: { type: "ephemeral" } },
                },
              },
              { role: "user" as const, content: prompt },
            ],
          }
        : { system, prompt }),
      tools: hasTools ? tools : undefined,
      stopWhen: hasTools ? stepCountIs(8) : undefined,
      onFinish: async ({ text, totalUsage }) => {
        await db
          .update(taskRuns)
          .set({ output: text, status: "done" })
          .where(eq(taskRuns.id, run.id));
        await logUsage({
          kind: "task",
          model: runModel,
          usage: totalUsage,
          userId: user.id,
          brandId: brand.id,
          teamId: template.teamId,
          refId: run.id,
        });

        // The review gate, on the streaming path. The draft is already on the
        // user's screen, so unlike runTaskOnce this cannot regenerate — the
        // honest thing is to record the verdict and show the receipt on the run,
        // not to pretend a gate blocked delivery. The receipt is what the person
        // reads before they paste the copy anywhere.
        if (template.reviewGate) {
          try {
            const review = await reviewDraft({
              draft: text,
              task: prompt,
              brandId: brand.id,
              teamId: template.teamId,
              userId: user.id,
              refId: run.id,
            });
            await db
              .update(taskRuns)
              .set({ review: review as unknown as Record<string, unknown> })
              .where(eq(taskRuns.id, run.id));
          } catch (err) {
            // A broken reviewer must never lose the output that already streamed.
            console.error("review gate failed for run", run.id, err);
          }
        }
      },
      onError: async ({ error }) => {
        await db
          .update(taskRuns)
          .set({
            status: "error",
            output: error instanceof Error ? error.message : "Generation failed.",
          })
          .where(eq(taskRuns.id, run.id));
      },
    });

    return result.toUIMessageStreamResponse({
      headers: { "X-Run-Id": run.id },
      // Surface the real failure reason to the runner instead of the SDK's masked default.
      onError: (error) =>
        error instanceof Error ? error.message : "Generation failed.",
    });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    console.error("task run error", err);
    return Response.json({ error: "Task run failed" }, { status: 500 });
  }
}
