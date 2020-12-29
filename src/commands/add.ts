import { Command } from "clipanion";
import { WorkspaceRequiredError } from "@yarnpkg/cli";
import {
  Configuration,
  Project,
  Cache,
  LightReport,
  StreamReport,
  MessageName,
  CommandContext,
  structUtils,
} from "@yarnpkg/core";
import { suggestUtils } from "@yarnpkg/plugin-essentials";
import { savePlugin } from "./savePlugin"; // TODO
import axios from "axios";

/**
 * Command to add a plugin using a descriptor
 */
export class AddCommand extends Command<CommandContext> {
  @Command.Rest()
  packages: Array<string> = [];

  @Command.Boolean(`--json`, {
    description: `Format the output as an NDJSON stream`,
  })
  json: boolean = false;

  // TODO add usage

  @Command.Path("plugin-manager", "add")
  async execute(): Promise<0 | 1> {
    const configuration = await Configuration.find(
      this.context.cwd,
      this.context.plugins
    );
    const { project, workspace } = await Project.find(
      configuration,
      this.context.cwd
    );
    const cache = await Cache.find(configuration);

    if (!workspace)
      throw new WorkspaceRequiredError(project.cwd, this.context.cwd);

    const modifier = suggestUtils.Modifier.CARET;

    const strategies = [suggestUtils.Strategy.LATEST];

    const maxResults = 1;

    const allSuggestions = await Promise.all(
      this.packages.map(async (pseudoDescriptor) => {
        const request = structUtils.parseDescriptor(pseudoDescriptor);

        const target = suggestUtils.Target.REGULAR;

        // TODO do we need workspace here? do we need any of this suggestions stuff?
        const suggestions = await suggestUtils.getSuggestedDescriptors(
          request,
          {
            project,
            workspace,
            cache,
            target,
            modifier,
            strategies,
            maxResults,
          }
        );

        return [request, suggestions, target] as const;
      })
    );

    const checkReport = await LightReport.start(
      {
        configuration,
        stdout: this.context.stdout,
        suggestInstall: false,
      },
      async (report) => {
        for (const [request, { suggestions, rejections }] of allSuggestions) {
          const nonNullSuggestions = suggestions.filter(
            (suggestion) => suggestion.descriptor !== null
          ) as Array<suggestUtils.Suggestion>;
          if (nonNullSuggestions.length === 0) {
            const [firstError] = rejections;
            const prettyError = this.cli.error(firstError);
            report.reportError(
              MessageName.CANT_SUGGEST_RESOLUTIONS,
              `${structUtils.prettyDescriptor(
                configuration,
                request
              )} can't be resolved to a satisfying range:\n\n${prettyError}`
            );
          }

          const tentativeSelected = nonNullSuggestions[0].descriptor;
          if (!tentativeSelected.name.startsWith("yarn-plugin-")) {
            report.reportError(
              MessageName.CANT_SUGGEST_RESOLUTIONS,
              `${structUtils.prettyDescriptor(
                configuration,
                request
              )} must start with "yarn-plugin-"`
            );
          }
        }
      }
    );

    if (checkReport.hasErrors()) {
      return checkReport.exitCode();
    }

    const streamReport = await StreamReport.start(
      {
        configuration,
        stdout: this.context.stdout,
      },
      async (report) => {
        for (const [, { suggestions }] of allSuggestions) {
          const nonNullSuggestions = suggestions.filter(
            (suggestion) => suggestion.descriptor !== null
          ) as Array<suggestUtils.Suggestion>;
          const providedDescriptor = nonNullSuggestions[0].descriptor;
          const { name, range } = providedDescriptor;

          const filenameWithoutExtension = name.slice("yarn-".length);

          // TODO try `.js` and `.cjs`
          const filename = `${filenameWithoutExtension}.js`;

          const prettyIdent = structUtils.stringifyIdent(providedDescriptor);

          // https://unpkg.com/yarn-plugin-dotenv/bundles/@yarnpkg/plugin-dotenv.js
          const unpkgUrl = `https://unpkg.com/${prettyIdent}@${range}/bundles/@yarnpkg/${filename}`;
          const resp = await axios.get(unpkgUrl);
          // console.log(resp)

          // /yarn-plugin-dotenv@0.1.1/bundles/@yarnpkg/plugin-dotenv.js
          const finalUrl = resp.request.path;
          const prefix = `/${prettyIdent}@`;
          const version = finalUrl.slice(
            prefix.length,
            finalUrl.indexOf("/", prefix.length)
          );

          const resolutionDescriptor = structUtils.makeDescriptor(
            providedDescriptor,
            `npm:${version}`
          );
          const packageDescriptor = structUtils.makeDescriptor(
            providedDescriptor,
            `npm:${range}`
          );

          // const path = `.yarn/plugins/@yarnpkg/${filename}`
          const pluginSpec = `plugin-manager::${JSON.stringify({
            version,
            resolution: structUtils.stringifyDescriptor(resolutionDescriptor),
            descriptor: structUtils.stringifyDescriptor(packageDescriptor),
          })}`;
          const pluginBuffer = resp.data;

          await savePlugin(pluginSpec, pluginBuffer, { project, report });
        }
      }
    );

    return streamReport.exitCode();
  }
}
