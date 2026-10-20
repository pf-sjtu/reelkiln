import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig((current) => ({
  ...current,
  resolve: {
    ...current.resolve,
    modules: [process.cwd() + "/node_modules", ...(current.resolve?.modules ?? ["node_modules"])],
  },
}));
// Allow remote assets and absolute file:// paths from anywhere on disk —
// every render is invoked with input props pointing at a job directory.
Config.setChromiumOpenGlRenderer("angle");
