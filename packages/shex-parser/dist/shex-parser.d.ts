interface ParserSchemaOptions {
    duplicateOption: "ignore" | "replace";
    index: boolean;
}
declare type ContextError = Error & {
    location: {
        first_line: string;
        first_column: number;
    };
    hash: {
        pos: string;
    };
};
declare const ShExParserCjsModule: {
    construct: (baseIRI: string, prefixes?: Record<string, string>, schemaOptions?: ParserSchemaOptions) => any;
};
//# sourceMappingURL=shex-parser.d.ts.map