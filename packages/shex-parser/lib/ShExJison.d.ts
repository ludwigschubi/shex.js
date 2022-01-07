/**
 * Returns a Parser implementing JisonParserApi and a Lexer implementing JisonLexerApi.
 */
declare const UNBOUNDED = -1;
declare const ShExUtil: any;
declare const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#", RDF_TYPE: string, RDF_FIRST: string, RDF_REST: string, RDF_NIL: string, XSD = "http://www.w3.org/2001/XMLSchema#", XSD_INTEGER: string, XSD_DECIMAL: string, XSD_FLOAT: string, XSD_DOUBLE: string, XSD_BOOLEAN: string, XSD_TRUE: string, XSD_FALSE: string, XSD_PATTERN: string, XSD_MININCLUSIVE: string, XSD_MINEXCLUSIVE: string, XSD_MAXINCLUSIVE: string, XSD_MAXEXCLUSIVE: string, XSD_LENGTH: string, XSD_MINLENGTH: string, XSD_MAXLENGTH: string, XSD_TOTALDIGITS: string, XSD_FRACTIONDIGITS: string;
declare const numericDatatypes: string[];
declare const absoluteIRI: RegExp, schemeAuthority: RegExp, dotSegments: RegExp;
declare const numericFacets: string[];
declare function lowercase(string: any): any;
declare function appendTo(array: any, item: any): any;
declare function appendAllTo(array: any, items: any): any;
declare function extend(base: any): any;
declare function unionAll(): any[];
declare function _resolveIRI(iri: any): any;
declare function _removeDotSegments(iri: any): any;
declare function expression(expr: any, attr: any): {
    expression: any;
};
declare function path(type: any, items: any): {
    type: string;
    pathType: any;
    items: any;
};
declare function createLiteral(value: any, type: any): {
    value: any;
    type: any;
};
declare function blank(): string;
declare let blankId: number;
declare let _fileName: any;
declare const stringEscapeReplacements: {
    '\\': string;
    "'": string;
    '"': string;
    t: string;
    b: string;
    n: string;
    r: string;
    f: string;
}, semactEscapeReplacements: {
    '\\': string;
    '%': string;
}, pnameEscapeReplacements: {
    '\\': string;
    "'": string;
    '"': string;
    n: string;
    r: string;
    t: string;
    f: string;
    b: string;
    _: string;
    '~': string;
    '.': string;
    '-': string;
    '!': string;
    $: string;
    '&': string;
    '(': string;
    ')': string;
    '*': string;
    '+': string;
    ',': string;
    ';': string;
    '=': string;
    '/': string;
    '?': string;
    '#': string;
    '@': string;
    '%': string;
};
declare function unescapeString(string: any, trimLength: any): {
    value: any;
};
declare function unescapeLangString(string: any, trimLength: any): any;
declare function unescapeRegexp(regexp: any): {
    pattern: any;
};
declare function keyValObject(key: any, val: any): {};
declare function unescapeSemanticAction(key: any, string: any): {
    type: string;
    name: any;
    code: any;
};
declare function error(e: any, yy: any): void;
declare function expandPrefix(prefix: any, yy: any): any;
declare function addShape(label: any, shape: any, yy: any): void;
declare function addProduction(label: any, production: any, yy: any): void;
declare function addSourceMap(obj: any, yy: any): any;
declare function shapeJunction(type: any, shapeAtom: any, juncts: any): any;
declare function nonest(shapeAtom: any): any;
declare const EmptyObject: {};
declare const EmptyShape: {
    type: string;
};
declare const JisonParser: any, o: any;
declare const JisonLexer: any;
declare function ShExJisonParser(yy?: {}, lexer?: any): void;
declare namespace ShExJisonParser {
    var _setBase: (baseIRI: any) => void;
    var _resetBlanks: () => void;
    var reset: () => void;
    var _setFileName: (fn: any) => void;
    var prototype: any;
}
declare function ShExJisonLexer(yy?: {}): void;
declare namespace ShExJisonLexer {
    var prototype: any;
}
//# sourceMappingURL=ShExJison.d.ts.map