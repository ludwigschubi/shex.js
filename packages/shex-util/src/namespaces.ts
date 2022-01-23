interface LDNamespace extends Record<string, string> {
  _namespace: string;
}

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
export const SX: LDNamespace = {
  _namespace: SXNamespaceIri,
  ...SXNamespaceMembers.reduce((allMembers, member) => {
    return { ...allMembers, [member]: SXNamespaceIri + member };
  }, {}),
};

const RDFNamespaceIri = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFNamespaceMembers = ["type", "first", "rest", "nil"];
export const RDF: LDNamespace = {
  _namespace: RDFNamespaceIri,
  ...RDFNamespaceMembers.reduce((allMembers, member) => {
    return { ...allMembers, [member]: SXNamespaceIri + member };
  }, {}),
};

const XSDNamespaceIri = "http://www.w3.org/2001/XMLSchema#";
const XSDNamespaceMembers = ["anyURI"];
export const XSD: LDNamespace = {
  _namespace: XSDNamespaceIri,
  ...XSDNamespaceMembers.reduce((allMembers, member) => {
    return { ...allMembers, [member]: SXNamespaceIri + member };
  }, {}),
};

const OWLNamespaceIri = "http://www.w3.org/2002/07/owl#";
const OWLNamespaceMembers = ["Thing"];
export const OWL: LDNamespace = {
  _namespace: OWLNamespaceIri,
  ...OWLNamespaceMembers.reduce((allMembers, member) => {
    return { ...allMembers, [member]: SXNamespaceIri + member };
  }, {}),
};
