import { Parser as ShExJison } from "./ShExJison";
interface ParserSchemaOptions {
  duplicateOption: "ignore" | "replace";
  index: boolean;
}

type ContextError = Error & {
  location: {
    first_line: string;
    first_column: number;
  };
  hash: { pos: string };
};

function contextError(e: ContextError, baseIRI: string) {
  // use the lexer's pretty-printing
  const line = e.location.first_line;
  const col = e.location.first_column + 1;
  const posStr = "pos" in e.hash ? "\n" + e.hash.pos : "";
  return `${baseIRI}\n line: ${line}, column: ${col}: ${e.message}${posStr}`;
}

const ShExParserCjsModule = (function () {
  // Creates a ShEx parser with the given pre-defined prefixes
  const prepareParser = function (
    baseIRI: string,
    prefixes: Record<string, string> = {} as Record<string, string>,
    schemaOptions: ParserSchemaOptions = {} as ParserSchemaOptions
  ) {
    // Create a copy of the prefixes
    const prefixesCopy = {} as Record<string, string>;
    for (const prefix in prefixes) prefixesCopy[prefix] = prefixes[prefix];

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
      let errors = [] as Error[];
      ShExJison.recoverable = (e: Error) => errors.push(e);
      let ret = null;
      try {
        ret = ShExJison.prototype.parse.apply(parser, arguments);
      } catch (e) {
        errors.push(e as Error);
      }
      ShExJison.reset();
      errors.forEach((e) => {
        if ("hash" in e) {
          const hash = (e as unknown as { hash: { loc?: string } }).hash;
          const location = hash.loc;
          delete hash.loc;
          Object.assign(e, hash, { location });
        }
        return e;
      });
      if (errors.length == 1) {
        const error = errors[0] as Error & { parsed: string };
        error.parsed = ret;
        throw error;
      } else if (errors.length) {
        const all = new Error(
          "" +
            errors.length +
            " parser errors:\n" +
            errors
              .map((e) => contextError(e as ContextError, baseIRI))
              .join("\n")
        ) as Error & { errors: Error[]; parsed: string };
        all.errors = errors;
        all.parsed = ret;
        throw all;
      } else {
        return ret;
      }
    }
    parser.parse = runParser;
    parser._setBase = function (base: string) {
      baseIRI = base;
    };
    parser._setFileName = ShExJison._setFileName;
    parser._setOptions = function (opts: ParserSchemaOptions) {
      ShExJison.options = opts;
    };
    parser._resetBlanks = ShExJison._resetBlanks;
    parser.reset = ShExJison.reset;
    ShExJison.options = schemaOptions;
    return parser;
  };

  return {
    construct: prepareParser,
  };
})();

if (typeof require !== "undefined" && typeof exports !== "undefined")
  module.exports = ShExParserCjsModule;
