"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OWL = exports.XSD = exports.RDF = exports.SX = void 0;
const SXNamespaceIri = "http://www.w3.org/ns/shex#";
const SXNamespaceMembers = [
    "Schema",
    "@context",
    "imports",
    "startActs",
    "start",
    "shapes",
    "ShapeOr",
    "ShapeAnd",
    "shapeExprs",
    "nodeKind",
    "NodeConstraint",
    "iri",
    "bnode",
    "nonliteral",
    "literal",
    "datatype",
    "length",
    "minlength",
    "maxlength",
    "pattern",
    "flags",
    "mininclusive",
    "minexclusive",
    "maxinclusive",
    "maxexclusive",
    "totaldigits",
    "fractiondigits",
    "values",
    "ShapeNot",
    "shapeExpr",
    "Shape",
    "closed",
    "extra",
    "expression",
    "semActs",
    "ShapeRef",
    "reference",
    "ShapeExternal",
    "EachOf",
    "OneOf",
    "expressions",
    "min",
    "max",
    "annotation",
    "TripleConstraint",
    "inverse",
    "negated",
    "predicate",
    "valueExpr",
    "Inclusion",
    "include",
    "Language",
    "languageTag",
    "IriStem",
    "LiteralStem",
    "LanguageStem",
    "stem",
    "IriStemRange",
    "LiteralStemRange",
    "LanguageStemRange",
    "exclusion",
    "Wildcard",
    "SemAct",
    "name",
    "code",
    "Annotation",
    "object",
];
exports.SX = {
    _namespace: SXNamespaceIri,
    ...SXNamespaceMembers.reduce((allMembers, member) => {
        return { ...allMembers, [member]: SXNamespaceIri + member };
    }, {}),
};
const RDFNamespaceIri = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFNamespaceMembers = ["type", "first", "rest", "nil"];
exports.RDF = {
    _namespace: RDFNamespaceIri,
    ...RDFNamespaceMembers.reduce((allMembers, member) => {
        return { ...allMembers, [member]: SXNamespaceIri + member };
    }, {}),
};
const XSDNamespaceIri = "http://www.w3.org/2001/XMLSchema#";
const XSDNamespaceMembers = ["anyURI"];
exports.XSD = {
    _namespace: XSDNamespaceIri,
    ...XSDNamespaceMembers.reduce((allMembers, member) => {
        return { ...allMembers, [member]: SXNamespaceIri + member };
    }, {}),
};
const OWLNamespaceIri = "http://www.w3.org/2002/07/owl#";
const OWLNamespaceMembers = ["Thing"];
exports.OWL = {
    _namespace: OWLNamespaceIri,
    ...OWLNamespaceMembers.reduce((allMembers, member) => {
        return { ...allMembers, [member]: SXNamespaceIri + member };
    }, {}),
};
//# sourceMappingURL=namespaces.js.map