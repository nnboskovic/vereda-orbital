#!/usr/bin/env node
// Builds the listening page from motifs.json: lab/index.html, served beside the rendered WAVs.
const fs = require("fs"), path = require("path");
const motifs = JSON.parse(fs.readFileSync(path.join(__dirname, "../out/motifs.json"), "utf8"));
const tpl = fs.readFileSync(path.join(__dirname, "template.html"), "utf8");
fs.writeFileSync(path.join(__dirname, "index.html"), tpl.replace("/*MOTIFS*/[]", JSON.stringify(motifs)));
console.log("built lab/index.html with", motifs.length, "motifs");
