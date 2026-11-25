import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "../herdr/mods/my-toast/route.js";

test("route: agent notification becomes a banner", () => {
  const p = { title: "Claude needs you", body: "api", action: { name: "agent.focus", args: { terminal: "t7" } }, overlay: "o1" };
  assert.deepEqual(route(p, "/x/herdr-app"), { title: "Claude needs you", body: "api", do: "agent.focus", doArgs: '{"terminal":"t7"}' });
});

test("route: other notifications stay in-app", () => {
  assert.equal(route({ title: "Copied" }, "/x/herdr-app"), null);
  assert.equal(route({ title: "x", action: { name: "pane.focus", args: {} } }, "/x/herdr-app"), null);
});

test("route: no herdr-app keeps it in-app", () => {
  assert.equal(route({ title: "Claude finished", action: { name: "agent.focus", args: { terminal: "t7" } } }, null), null);
});
