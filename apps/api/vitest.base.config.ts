import { resolve } from "path";

/**
 * Shared Vite resolve config for all vitest configs in this package.
 * @bi/contracts is aliased to its TypeScript source because dist/ is not
 * committed — this avoids requiring a build step before running tests.
 */
export const sharedResolve = {
  alias: {
    "@bi/contracts": resolve(__dirname, "../../packages/contracts/src/index.ts"),
  },
};
