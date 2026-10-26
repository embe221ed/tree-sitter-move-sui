import Parser = require("tree-sitter");
import Move = require("./index.js");

const parser = new Parser();
parser.setLanguage(Move);
new Parser.Query(Move, "(module_definition) @module");
