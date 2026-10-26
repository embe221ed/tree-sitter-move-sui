const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const Parser = require("tree-sitter");
const Move = require("./index.js");

test("the Node binding parses Move with the external scanner", () => {
  const parser = new Parser();
  parser.setLanguage(Move);
  const tree = parser.parse(`
    module test::example {
      /* outer /* nested */ comment */
      fun example(): vector<u8> { vector[1, 2] }
    }
  `);
  assert.equal(tree.rootNode.hasError, false);
  assert.equal(tree.rootNode.type, "source_file");
  assert.equal(Move.name, "move");
  assert.ok(Move.nodeTypeInfo.some(node => node.type === "module_definition"));
});

test("Bun uses node-gyp-build unless running a standalone executable", () => {
  const source = readFileSync(path.join(__dirname, "index.js"), "utf8");
  for (const standalone of [false, true]) {
    const calls = [];
    const binding = {};
    vm.runInNewContext(source, {
      __dirname,
      module: { exports: {} },
      process: { versions: { bun: "1" }, platform: "linux", arch: "x64" },
      Bun: { isStandaloneExecutable: standalone },
      require(request) {
        calls.push(request);
        if (request === "path") return path;
        if (request === "node-gyp-build") return () => binding;
        if (request.endsWith("node-types.json")) return [];
        if (request.endsWith(".node")) return binding;
        throw new Error(`Unexpected require: ${request}`);
      },
    });
    assert.equal(calls.includes("node-gyp-build"), !standalone);
    assert.equal(calls.some(request => request.endsWith(".node")), standalone);
  }
});

test("the supported Node runtime preserves generic adjacency and member fields", () => {
  const parser = new Parser();
  parser.setLanguage(Move);
  const tree = parser.parse(`
    module test::generics {
      fun run() {
        h(a /* gap */ < b, c > (d));
        generic<T>();
        value.method!<T>();
        @named;
      }
    }
  `);
  assert.equal(tree.rootNode.hasError, false);
  assert.equal(tree.rootNode.descendantsOfType("binary_expression").length, 2);
  assert.equal(tree.rootNode.descendantsOfType("type_arguments").length, 2);
  let contextualMembers = 0;
  for (const node of tree.rootNode.descendantsOfType("module_access")) {
    const contextual = node.childForFieldName("property") || node.childForFieldName("address");
    if (contextual) {
      assert.equal(node.childForFieldName("member").id, contextual.id);
      contextualMembers++;
    }
  }
  assert.equal(contextualMembers, 2);
});
