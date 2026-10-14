const fs = require("node:fs");
const path = require("node:path");

const source = path.join(__dirname, "..", "src", "backend", "fountain-js", "fountain-parser.js");
const target = path.join(__dirname, "..", "src", "backend", "fountain-js", "fountain-parser.cjs");

fs.copyFileSync(source, target);