/*
* cmd.ts
*
* Copyright (C) 2021-2022 Posit Software, PBC
*
*/
import { Command } from "cliffy/command/mod.ts";
import { initYamlIntelligenceResourcesFromFilesystem } from "../../core/schema/utils.ts";
import { createTempContext } from "../../core/temp.ts";
import { installExtension } from "../../extension/install.ts";

import { info } from "log/mod.ts";
import {
  loadTools,
  selectTool,
  updateOrInstallTool,
} from "../../tools/tools-console.ts";
import { installTool } from "../../tools/tools.ts";
import { resolveCompatibleArgs } from "../remove/cmd.ts";

export const installCommand = new Command()
  .name("install")
  .arguments("[target...]")
  .option(
    "--no-prompt",
    "Do not prompt to confirm actions",
  )
  .option(
    "--embed <extensionId>",
    "Embed this extension within another extension (used when authoring extensions).",
    {
      hidden: true,
    },
  )
  .option(
    "--update-path",
    "Update system path when a tool is installed",
  )
  .description(
    "Installs an extension or global dependency.",
  )
  .example(
    "Install TinyTeX",
    "quarto install tool tinytex",
  )
  // temporarily disabled until we get things in order in 1.28.*
  // .example(
  //   "Install Chromium",
  //   "quarto install tool chromium",
  // )
  .example(
    "Choose tool to install",
    "quarto install tool",
  )
  .action(
    async (
      options: { prompt?: boolean; embed?: string; updatePath?: boolean },
      ...target: string[]
    ) => {
      await initYamlIntelligenceResourcesFromFilesystem();
      const temp = createTempContext();

      const resolved = resolveCompatibleArgs(target || [], "tool");

      try {
        if (resolved.action === "extension") {
          // Install an extension
          if (resolved.name) {
            await installExtension(
              resolved.name,
              temp,
              options.prompt !== false,
              options.embed,
            );
          } else {
            info("Please provide an extension name, url, or path.");
          }
        } else if (resolved.action === "tool") {
          // Install a tool
          if (resolved.name) {
            // Use the tool name
            await updateOrInstallTool(
              resolved.name,
              "install",
              options.prompt,
              options.updatePath,
            );
          } else {
            // Not provided, give the user a list to choose from
            const allTools = await loadTools();
            if (allTools.filter((tool) => !tool.installed).length === 0) {
              info("All tools are already installed.");
            } else {
              // Select which tool should be installed
              const toolTarget = await selectTool(allTools, "install");
              if (toolTarget) {
                info("");
                await installTool(toolTarget, options.updatePath);
              }
            }
          }
        } else {
          // This is an unrecognized type option
          info(
            `Unrecognized option '${resolved.action}' - please choose 'tool' or 'extension'.`,
          );
        }
      } finally {
        temp.cleanup();
      }
    },
  );
