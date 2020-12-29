import { Plugin } from "@yarnpkg/core";
import { AddCommand } from "./commands/add";
import { ListCommand } from "./commands/list";

const plugin: Plugin = {
  commands: [ListCommand, AddCommand],
};
export default plugin;
