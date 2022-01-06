"use strict";
const ShExParserCjsModule = (function () {
    const ShExJison = require("../lib/ShExJison").Parser;
    // Creates a ShEx parser with the given pre-defined prefixes
    const prepareParser = function (baseIRI, prefixes = {}, schemaOptions = {}) {
        // Create a copy of the prefixes
        const prefixesCopy = {};
        for (const prefix in prefixes)
            prefixesCopy[prefix] = prefixes[prefix];
        // Create a new parser with the given prefixes
        // (Workaround for https://github.com/zaach/jison/issues/241)
        const parser = new ShExJison();
        function runParser() {
            // ShExJison.base = baseIRI || "";
            // ShExJison.basePath = ShExJison.base.replace(/[^\/]*$/, '');
            // ShExJison.baseRoot = ShExJison.base.match(/^(?:[a-z]+:\/*)?[^\/]*/)[0];
            ShExJison._prefixes = Object.create(prefixesCopy);
            ShExJison._imports = [];
            ShExJison._setBase(baseIRI);
            ShExJison._setFileName(baseIRI);
            ShExJison.options = schemaOptions;
            let errors = [];
            ShExJison.recoverable = (e) => errors.push(e);
            let ret = null;
            try {
                ret = ShExJison.prototype.parse.apply(parser, arguments);
            }
            catch (e) {
                errors.push(e);
            }
            ShExJison.reset();
            errors.forEach((e) => {
                if ("hash" in e) {
                    const hash = e.hash;
                    const location = hash.loc;
                    delete hash.loc;
                    Object.assign(e, hash, { location });
                }
                return e;
            });
            if (errors.length == 1) {
                const error = errors[0];
                error.parsed = ret;
                throw error;
            }
            else if (errors.length) {
                const all = new Error("" +
                    errors.length +
                    " parser errors:\n" +
                    errors.map((e) => contextError(e)).join("\n"));
                all.errors = errors;
                all.parsed = ret;
                throw all;
            }
            else {
                return ret;
            }
        }
        parser.parse = runParser;
        parser._setBase = function (base) {
            baseIRI = base;
        };
        parser._setFileName = ShExJison._setFileName;
        parser._setOptions = function (opts) {
            ShExJison.options = opts;
        };
        parser._resetBlanks = ShExJison._resetBlanks;
        parser.reset = ShExJison.reset;
        ShExJison.options = schemaOptions;
        return parser;
        function contextError(e) {
            // use the lexer's pretty-printing
            const line = e.location.first_line;
            const col = e.location.first_column + 1;
            const posStr = "pos" in e.hash ? "\n" + e.hash.pos : "";
            return `${baseIRI}\n line: ${line}, column: ${col}: ${e.message}${posStr}`;
        }
    };
    return {
        construct: prepareParser,
    };
})();
if (typeof require !== "undefined" && typeof exports !== "undefined")
    module.exports = ShExParserCjsModule;
//# sourceMappingURL=shex-parser.js.map