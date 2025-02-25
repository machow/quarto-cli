/*
 * format-html-notebook-preview.ts
 *
 * Copyright (C) 2020-2022 Posit Software, PBC
 */
import { formatResourcePath } from "../../core/resources.ts";
import { renderEjs } from "../../core/ejs.ts";
import { asArray } from "../../core/array.ts";
import * as ld from "../../core/lodash.ts";

import {
  kClearHiddenClasses,
  kDownloadUrl,
  kNotebookViewStyle,
  kOutputFile,
  kTemplate,
  kTheme,
  kTo,
} from "../../config/constants.ts";
import { Format, NotebookPreviewDescriptor } from "../../config/types.ts";

import { RenderServices } from "../../command/render/types.ts";

import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
} from "path/mod.ts";
import { renderFiles } from "../../command/render/render-files.ts";
import { kNotebookViewStyleNotebook } from "./format-html-constants.ts";
import { dirAndStem, pathWithForwardSlashes } from "../../core/path.ts";
import { kAppendixStyle } from "./format-html-shared.ts";
import { ProjectContext } from "../../project/types.ts";
import { projectIsBook } from "../../project/project-shared.ts";
import { logProgress } from "../../core/log.ts";

export interface NotebookPreview {
  title: string;
  href: string;
  filename?: string;
  supporting?: string[];
}

export interface NotebookPreviewTask {
  input: string;
  nbPath: string;
  title?: string;
  nbPreviewFile?: string;
  callback?: (nbPreview: NotebookPreview) => void;
}

interface NotebookPreviewOptions {
  title: string;
  url?: string;
  previewFileName: string;
  downloadUrl?: string;
  downloadFileName?: string;
}

export const notebookPreviewer = (
  nbView: boolean | NotebookPreviewDescriptor | NotebookPreviewDescriptor[],
  format: Format,
  services: RenderServices,
  project?: ProjectContext,
  quiet?: boolean,
) => {
  const isBook = projectIsBook(project);
  const previewQueue: NotebookPreviewTask[] = [];

  const nbDescriptors: Record<string, NotebookPreviewDescriptor> = {};
  if (nbView) {
    if (typeof (nbView) !== "boolean") {
      asArray(nbView).forEach((view) => {
        const existingView = nbDescriptors[view.notebook];
        nbDescriptors[view.notebook] = {
          ...existingView,
          ...view,
        };
      });
    }
  }
  const descriptor = (
    notebook: string,
  ) => {
    return nbDescriptors[notebook];
  };

  const enQueuePreview = (
    input: string,
    nbPath: string,
    title?: string,
    nbPreviewFile?: string,
    callback?: (nbPreview: NotebookPreview) => void,
  ) => {
    previewQueue.push({ input, nbPath, title, nbPreviewFile, callback });
  };

  const renderPreviews = async () => {
    const rendered: Record<string, NotebookPreview> = {};

    // Render each notebook only once (so filter by
    // notebook path to consolidate the list)
    const uniqueWork = ld.uniqBy(
      previewQueue,
      (work: NotebookPreviewTask) => {
        return work.nbPath;
      },
    ) as NotebookPreviewTask[];

    const total = uniqueWork.length;
    if (total > 0) {
      logProgress(`\nRendering notebook previews`);
    }
    for (let i = 0; i < total; i++) {
      const work = uniqueWork[i];
      const { nbPath, input, title, nbPreviewFile } = work;

      const nbDir = dirname(nbPath);
      const filename = basename(nbPath);
      const inputDir = dirname(input);

      if (nbView !== false) {
        // Read options for this notebook
        const descriptor: NotebookPreviewDescriptor | undefined =
          nbDescriptors[nbPath];
        const nbAbsPath = isAbsolute(nbPath) ? nbPath : join(inputDir, nbPath);

        const supporting: string[] = [];
        const nbRelPath = relative(inputDir, nbAbsPath);
        logProgress(`[${i + 1}/${total}] ${nbRelPath}`);

        // Render an output version of the notebook
        let downloadUrl = undefined;
        let downloadFileName = undefined;
        if (!descriptor?.[kDownloadUrl] && !isBook) {
          const outputNb = await renderOutputNotebook(
            inputDir,
            nbAbsPath,
            services,
            project,
            quiet,
          );
          downloadUrl = outputNb.href;

          // Ensure that the output file name for this notebook preview is an `.ipynb`
          if (extname(nbAbsPath) !== ".ipynb") {
            downloadFileName = `${basename(nbAbsPath)}.ipynb`;
          }

          supporting.push(...outputNb.supporting);
        }

        const htmlPreview = await renderHtmlView(
          inputDir,
          nbAbsPath,
          {
            title: descriptor?.title || title || basename(nbPath),
            previewFileName: nbPreviewFile || `${basename(nbPath)}.html`,
            url: descriptor?.url,
            downloadUrl: descriptor?.[kDownloadUrl] || downloadUrl,
            downloadFileName,
          },
          format,
          services,
          project,
          quiet,
        );
        if (htmlPreview.supporting) {
          supporting.push(...htmlPreview.supporting);
        }

        const nbPreview = {
          title: htmlPreview.title,
          href: htmlPreview.href,
          supporting,
        };
        rendered[work.nbPath] = nbPreview;
        if (work.callback) {
          work.callback(nbPreview);
        }
      } else {
        const nbPreview = {
          href: pathWithForwardSlashes(join(nbDir, filename)),
          title: title || filename,
          filename,
        };
        rendered[work.nbPath] = nbPreview;
        if (work.callback) {
          work.callback(nbPreview);
        }
      }
    }
    return rendered;
  };

  return {
    enQueuePreview,
    renderPreviews,
    descriptor,
  };
};

async function renderOutputNotebook(
  inputDir: string,
  nbAbsPath: string,
  services: RenderServices,
  project?: ProjectContext,
  quiet?: boolean,
): Promise<{ href: string; supporting: string[] }> {
  // The target output file name
  const [_dir, stem] = dirAndStem(nbAbsPath);
  const outputFileName = `${stem}.out.ipynb`;

  // Render the notebook and update the path
  const rendered = await renderFiles(
    [{ path: nbAbsPath, formats: ["ipynb"] }],
    {
      services,
      flags: {
        metadata: {
          [kTo]: "ipynb",
          [kOutputFile]: outputFileName,
          [kClearHiddenClasses]: true,
        },
        quiet,
      },
      echo: true,
      warning: true,
    },
    [],
    undefined,
    project,
  );
  if (rendered.error) {
    throw new Error(`Failed to render output ipynb for notebook ${nbAbsPath}`, {
      cause: rendered.error,
    });
  }

  const supporting = [];
  for (const renderedFile of rendered.files) {
    supporting.push(join(inputDir, renderedFile.file));
    if (renderedFile.supporting) {
      supporting.push(...renderedFile.supporting.map((file) => {
        return isAbsolute(file) ? file : join(inputDir, file);
      }));
    }
  }

  return {
    href: outputFileName,
    supporting,
  };
}

// Renders an HTML preview of a notebook
async function renderHtmlView(
  inputDir: string,
  nbAbsPath: string,
  options: NotebookPreviewOptions,
  format: Format,
  services: RenderServices,
  project?: ProjectContext,
  quiet?: boolean,
): Promise<NotebookPreview> {
  // Compute the preview title
  if (options.url === undefined) {
    // Use the special `embed` template for this render
    const embedHtmlEjs = formatResourcePath(
      "html",
      join("embed", "template.ejs.html"),
    );
    const embedTemplate = renderEjs(embedHtmlEjs, {
      title: options.title,
      path: options.downloadUrl || basename(nbAbsPath),
      filename: options.downloadFileName || basename(nbAbsPath),
    });
    const templatePath = services.temp.createFile({ suffix: ".html" });
    Deno.writeTextFileSync(templatePath, embedTemplate);

    // Render the notebook and update the path
    const rendered = await renderFiles(
      [{ path: nbAbsPath, formats: ["html"] }],
      {
        services,
        flags: {
          metadata: {
            [kTo]: "html",
            [kTheme]: format.metadata[kTheme],
            [kOutputFile]: options.previewFileName,
            [kTemplate]: templatePath,
            [kNotebookViewStyle]: kNotebookViewStyleNotebook,
            [kAppendixStyle]: "none",
            [kClearHiddenClasses]: true,
          },
          quiet,
        },
        echo: true,
        warning: true,
      },
      [],
      undefined,
      project,
    );
    if (rendered.error) {
      throw new Error(`Failed to render preview for notebook ${nbAbsPath}`, {
        cause: rendered.error,
      });
    }

    const supporting = [];
    for (const renderedFile of rendered.files) {
      supporting.push(join(inputDir, renderedFile.file));
      if (renderedFile.supporting) {
        supporting.push(...renderedFile.supporting.map((file) => {
          return isAbsolute(file) ? file : join(inputDir, file);
        }));
      }
    }

    const nbRelPath = relative(inputDir, nbAbsPath);
    return {
      title: options.title,
      href: pathWithForwardSlashes(
        join(dirname(nbRelPath), options.previewFileName),
      ),
      supporting,
    };
  } else {
    return {
      title: options.title,
      href: options.url,
    };
  }
}
