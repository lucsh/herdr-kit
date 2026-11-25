import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "../herdr/mods/my-toast/route.js";

const agent = { title: "Claude needs you", body: "api", action: { name: "agent.focus", args: { terminal: "t7" } }, overlay: "o1" };

test("route: agent notification becomes a banner", () => {
  assert.deepEqual(route(agent, '{"authorized":true,"at":"x"}'), { title: "Claude needs you", body: "api", do: "agent.focus", doArgs: '{"terminal":"t7"}' });
});

test("route: other notifications stay in-app", () => {
  assert.equal(route({ title: "Copied" }, '{"authorized":true}'), null);
  assert.equal(route({ title: "x", action: { name: "pane.focus", args: {} } }, '{"authorized":true}'), null);
});

test("route: banners not allowed keeps it in-app", () => {
  assert.equal(route(agent, '{"authorized":false}'), null);
  assert.equal(route(agent, null), null);
  assert.equal(route(agent, "{oops"), null);
});
