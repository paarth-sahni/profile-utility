/**
 * Purpose: test-only preload (`node --require`). The `server-only` package throws when imported outside a
 * React Server Components build; in unit tests we want to import server modules (route handlers, lib/db), so
 * resolve it to the package's empty module instead. Never used by the app itself.
 */
const path = require("node:path");
const Module = require("node:module");
const EMPTY = path.join(path.dirname(require.resolve("server-only")), "empty.js");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return EMPTY;
  return resolve.call(this, request, ...rest);
};
