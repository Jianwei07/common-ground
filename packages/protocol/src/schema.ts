import { z } from "zod";

import { isProjectPath, normalizeProjectPath } from "./path";

const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/, "IDs may contain letters, numbers, underscores, and hyphens only");

export const runtimeIdSchema = z.enum(["typescript", "javascript", "python", "go", "rust"]);

export const groundFileSchema = z
  .object({
    path: z.string().refine(isProjectPath, "Invalid relative project path"),
    content: z.string(),
  })
  .strict();

export const runConfigurationSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(80),
    runtimeId: runtimeIdSchema,
    entrypoint: z.string().refine(isProjectPath, "Invalid entrypoint"),
    stdin: z.string().max(1_000_000).optional(),
  })
  .strict();

const codeLinkSchema = z
  .object({
    id: idSchema,
    elementId: z.string().min(1).max(256),
    target: z
      .object({
        kind: z.literal("code"),
        path: z.string().refine(isProjectPath, "Invalid code target path"),
        line: z.number().int().positive().max(10_000_000).optional(),
        symbol: z.string().trim().min(1).max(256).optional(),
      })
      .strict(),
  })
  .strict();

const runLinkSchema = z
  .object({
    id: idSchema,
    elementId: z.string().min(1).max(256),
    target: z
      .object({
        kind: z.literal("run"),
        runConfigurationId: idSchema,
        pinnedRunId: idSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const groundLinkSchema = z.union([codeLinkSchema, runLinkSchema]);

export const pinnedRunSchema = z
  .object({
    id: idSchema,
    configurationId: idSchema,
    createdAt: z.iso.datetime(),
    exitCode: z.number().int().nullable(),
    reason: z.enum(["completed", "cancelled", "timeout", "limit"]),
    stdout: z.string(),
    stderr: z.string(),
  })
  .strict()
  .superRefine((run, context) => {
    if (new TextEncoder().encode(run.stdout + run.stderr).byteLength > 1_000_000) {
      context.addIssue({ code: "custom", message: "Pinned output exceeds 1 MB" });
    }
  });

export const groundRunsSchema = z
  .object({
    configurations: z.array(runConfigurationSchema).max(100),
    pinnedResults: z.array(pinnedRunSchema).max(100),
  })
  .strict();

export const canvasDocumentSchema = z
  .object({
    elements: z.array(z.record(z.string(), z.unknown())).max(100_000),
    appState: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const groundManifestV1Schema = z
  .object({
    format: z.literal("common-ground"),
    version: z.literal(1),
    workspaceId: idSchema,
    name: z.string().trim().min(1).max(120),
    canvas: z.literal("canvas.excalidraw"),
    filesRoot: z.literal("workspace/"),
    links: z.literal("links.json"),
    runs: z.literal("runs.json"),
  })
  .strict();

export const groundWorkspaceSchema = z
  .object({
    workspaceId: idSchema,
    name: z.string().trim().min(1).max(120),
    canvas: canvasDocumentSchema,
    files: z.array(groundFileSchema).max(1_000),
    links: z.array(groundLinkSchema).max(10_000),
    runs: groundRunsSchema,
  })
  .strict()
  .superRefine((workspace, context) => {
    const files = new Set<string>();
    for (const [index, file] of workspace.files.entries()) {
      const path = normalizeProjectPath(file.path);
      if (files.has(path)) {
        context.addIssue({ code: "custom", message: `Duplicate file path: ${path}`, path: ["files", index, "path"] });
      }
      files.add(path);
    }

    const elementIds = new Set(
      workspace.canvas.elements
        .map((element) => element.id)
        .filter((id): id is string => typeof id === "string"),
    );
    const runIds = uniqueIds(workspace.runs.configurations, "runs.configurations", context);
    const pinnedIds = uniqueIds(workspace.runs.pinnedResults, "runs.pinnedResults", context);
    uniqueIds(workspace.links, "links", context);

    for (const [index, configuration] of workspace.runs.configurations.entries()) {
      if (!files.has(normalizeProjectPath(configuration.entrypoint))) {
        context.addIssue({
          code: "custom",
          message: `Missing entrypoint: ${configuration.entrypoint}`,
          path: ["runs", "configurations", index, "entrypoint"],
        });
      }
    }
    for (const [index, result] of workspace.runs.pinnedResults.entries()) {
      if (!runIds.has(result.configurationId)) {
        context.addIssue({
          code: "custom",
          message: `Missing run configuration: ${result.configurationId}`,
          path: ["runs", "pinnedResults", index, "configurationId"],
        });
      }
    }
    for (const [index, link] of workspace.links.entries()) {
      if (!elementIds.has(link.elementId)) {
        context.addIssue({ code: "custom", message: `Missing canvas element: ${link.elementId}`, path: ["links", index, "elementId"] });
      }
      if (link.target.kind === "code" && !files.has(normalizeProjectPath(link.target.path))) {
        context.addIssue({ code: "custom", message: `Missing code target: ${link.target.path}`, path: ["links", index, "target", "path"] });
      }
      if (link.target.kind === "run") {
        if (!runIds.has(link.target.runConfigurationId)) {
          context.addIssue({ code: "custom", message: "Missing linked run configuration", path: ["links", index, "target"] });
        }
        if (link.target.pinnedRunId && !pinnedIds.has(link.target.pinnedRunId)) {
          context.addIssue({ code: "custom", message: "Missing linked pinned run", path: ["links", index, "target"] });
        }
      }
    }
  });

function uniqueIds(
  values: ReadonlyArray<{ id: string }>,
  label: string,
  context: z.RefinementCtx,
): Set<string> {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    if (ids.has(value.id)) {
      context.addIssue({ code: "custom", message: `Duplicate ID in ${label}: ${value.id}`, path: [index, "id"] });
    }
    ids.add(value.id);
  });
  return ids;
}

export const runRequestSchema = z
  .object({
    requestId: idSchema,
    runtimeId: runtimeIdSchema,
    files: z.array(groundFileSchema).min(1).max(1_000),
    entrypoint: z.string().refine(isProjectPath, "Invalid entrypoint"),
    stdin: z.string().max(1_000_000).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    const paths = new Set<string>();
    let bytes = 0;
    request.files.forEach((file, index) => {
      const path = normalizeProjectPath(file.path);
      if (paths.has(path)) {
        context.addIssue({ code: "custom", message: `Duplicate file path: ${path}`, path: ["files", index, "path"] });
      }
      paths.add(path);
      bytes += new TextEncoder().encode(file.content).byteLength;
    });
    if (bytes > 10_000_000) {
      context.addIssue({ code: "custom", message: "Submitted source exceeds 10 MB", path: ["files"] });
    }
    if (!paths.has(normalizeProjectPath(request.entrypoint))) {
      context.addIssue({ code: "custom", message: "Entrypoint must be one of the submitted files", path: ["entrypoint"] });
    }
  });

const outputEventSchema = z
  .object({
    requestId: idSchema,
    type: z.enum(["stdout", "stderr"]),
    chunk: z.string(),
  })
  .strict();

const statusEventSchema = z
  .object({
    requestId: idSchema,
    type: z.literal("status"),
    status: z.enum(["queued", "running"]),
  })
  .strict();

const exitEventSchema = z
  .object({
    requestId: idSchema,
    type: z.literal("exit"),
    exitCode: z.number().int().nullable(),
    reason: z.enum(["completed", "cancelled", "timeout", "limit"]),
  })
  .strict();

export const runEventSchema = z.union([outputEventSchema, statusEventSchema, exitEventSchema]);

export type GroundManifestV1 = z.infer<typeof groundManifestV1Schema>;
export type GroundFile = z.infer<typeof groundFileSchema>;
export type GroundLink = z.infer<typeof groundLinkSchema>;
export type RunConfiguration = z.infer<typeof runConfigurationSchema>;
export type PinnedRun = z.infer<typeof pinnedRunSchema>;
export type GroundRuns = z.infer<typeof groundRunsSchema>;
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;
export type GroundWorkspace = z.infer<typeof groundWorkspaceSchema>;
export type RunRequest = z.infer<typeof runRequestSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type RuntimeId = z.infer<typeof runtimeIdSchema>;
