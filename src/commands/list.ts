import { BaseCommand } from "@yarnpkg/cli";
import {
  Configuration,
  Project,
  StreamReport,
  structUtils,
} from "@yarnpkg/core";
import { Command, Usage } from "clipanion";
import { stringifyIdent } from "@yarnpkg/core/lib/structUtils";

export class ListCommand extends BaseCommand {
  @Command.Boolean(`--json`, {
    description: `Format the output as an NDJSON stream`,
  })
  json: boolean = false;

  // TODO usage

  @Command.Path(`plugin-manager`, `list`)
  async execute() {
    const configuration = await Configuration.find(
      this.context.cwd,
      this.context.plugins
    );
    const { project } = await Project.find(configuration, this.context.cwd);

    const report = await StreamReport.start(
      {
        configuration,
        json: this.json,
        stdout: this.context.stdout,
      },
      async (report) => {
        const plugins: { path: string; spec: string }[] = [];
        await Configuration.updateConfiguration(
          project.cwd,
          (current: { [key: string]: unknown }) => {
            if (Array.isArray(current.plugins)) {
              for (const plugin of current.plugins) {
                plugins.push({
                  path: plugin?.path || plugin,
                  spec: plugin?.spec || plugin,
                });
              }
            }
            return current;
          }
        );

        const managedPlugins = plugins
          .filter(({ spec }) => spec.startsWith("plugin-manager::"))
          .map(({ spec }) => {
            // TODO try-catch
            const entry = JSON.parse(spec.slice("plugin-manager::".length));
            return structUtils.makeDescriptor(
              structUtils.parseDescriptor(entry.descriptor),
              entry.version
            );
          });

        for (const descriptor of managedPlugins) {
          report.reportJson({
            name: structUtils.stringifyIdent(descriptor),
            version: descriptor.range,
          });
          report.reportInfo(null, structUtils.stringifyDescriptor(descriptor));
        }
      }
    );

    return report.exitCode();
  }
}
