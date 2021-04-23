import { promises as fs } from "fs";
import path from "upath";
import templates from "../templates";
import * as logger from "../shared/logger";

type Page = {
  name: string;
  projectId: string;
  path: string;
  url: string;
};

async function isUserManagedFile(path: string) {
  try {
    const content = await fs.readFile(path);
    return !content
      .toString()
      .startsWith("/** This file is auto-generated by Plasmic");
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

let didWarnConflictingRoot = false;
let didWarnConflictingCatchAll = false;

async function syncIndexPage(
  page: Page | undefined,
  pageDir: string,
  fileExtension: string
) {
  const fileName = `index.${fileExtension}`;
  const filePath = path.join(pageDir, fileName);
  const managedByUser = await isUserManagedFile(filePath);

  // Do not modify the file if it is managed by the user.
  if (managedByUser) {
    if (page && !didWarnConflictingRoot) {
      logger.warn(
        `Top-level ${fileName} detected.\nPlasmic uses a catch-all file to register Plasmic pages. Because of this conflict, Plasmic wont register this page.`
      );
      didWarnConflictingRoot = true;
    }
    return;
  }

  if (!page) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    return;
  }

  await fs.writeFile(
    filePath,
    templates.PlasmicPage({
      name: page.name,
      projectId: page.projectId,
    })
  );
}

async function syncCatchAllPage(
  pages: Page[],
  pageDir: string,
  fileExtension: string
) {
  const fileName = `[...plasmicLoaderPage].${fileExtension}`;
  const filePath = path.join(pageDir, fileName);
  const topLevelPages = await fs.readdir(pageDir);
  const conflictingCatchAll = topLevelPages.find(
    (page) => page.startsWith("[") && page !== fileName
  );

  if (conflictingCatchAll && !didWarnConflictingCatchAll) {
    logger.warn(
      `Top-level ${conflictingCatchAll} detected.\nPlasmic uses a catch-all file to register Plasmic pages. Because of this conflict, Plasmic wont register this page.`
    );
    didWarnConflictingCatchAll = true;
    return;
  }

  const pagesToWrite: Page[] = [];
  for (const page of pages) {
    if (page.url === "/") continue;
    try {
      const possiblePath =
        path.join(pageDir, ...page.url.substring(1).split("/")) + `.${fileExtension}`;
      await fs.access(possiblePath);
      continue;
    } catch (error) {
      if (error.code === "ENOENT") {
        pagesToWrite.push(page);
        continue;
      }
      throw error;
    }
  }

  if (!pagesToWrite.length) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    return;
  }

  await fs.writeFile(
    filePath,
    templates.NextPage({
      pages: pagesToWrite.map((page) => ({
        ...page,
        url: page.url.substring(1),
        urlpaths: page.url.substring(1).split("/"),
      })),
    })
  );
}

export async function generateNextPages(
  pages: Page[],
  dir: string,
  config: any
) {
  const extension = config.code.lang === "js" ? "js" : "tsx";

  await Promise.all([
    syncIndexPage(
      pages.find((page) => page.url === "/"),
      dir,
      extension
    ),
    syncCatchAllPage(pages, dir, extension),
  ]);
}
