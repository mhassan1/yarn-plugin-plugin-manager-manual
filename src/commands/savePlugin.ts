import {
  Configuration,
  Project,
  Report,
  formatUtils,
  miscUtils,
  MessageName,
} from "@yarnpkg/core";
import { PortablePath, ppath, npath, xfs } from "@yarnpkg/fslib";
import { runInNewContext } from "vm";

export async function savePlugin(
  pluginSpec: string,
  pluginBuffer: Buffer,
  { project, report }: { project: Project; report: Report }
) {
  const { configuration } = project;

  const vmExports = {} as any;
  const vmModule = { exports: vmExports };

  runInNewContext(pluginBuffer.toString(), {
    module: vmModule,
    exports: vmExports,
  });

  const pluginName = vmModule.exports.name;

  const relativePath = `.yarn/plugins/${pluginName}.cjs` as PortablePath;
  const absolutePath = ppath.resolve(project.cwd, relativePath);

  report.reportInfo(
    MessageName.UNNAMED,
    `Saving the new plugin in ${formatUtils.pretty(
      configuration,
      relativePath,
      `magenta`
    )}`
  );
  await xfs.mkdirPromise(ppath.dirname(absolutePath), { recursive: true });
  await xfs.writeFilePromise(absolutePath, pluginBuffer);

  const pluginMeta = {
    path: relativePath,
    spec: pluginSpec,
  };

  await Configuration.updateConfiguration(project.cwd, (current: any) => {
    const plugins = [];
    let hasBeenReplaced = false;

    for (const entry of current.plugins || []) {
      const userProvidedPath = typeof entry !== `string` ? entry.path : entry;

      const pluginPath = ppath.resolve(
        project.cwd,
        npath.toPortablePath(userProvidedPath)
      );
      const { name } = miscUtils.dynamicRequire(
        npath.fromPortablePath(pluginPath)
      );

      if (name !== pluginName) {
        plugins.push(entry);
      } else {
        plugins.push(pluginMeta);
        hasBeenReplaced = true;
      }
    }

    if (!hasBeenReplaced) plugins.push(pluginMeta);

    return { ...current, plugins };
  });
}
