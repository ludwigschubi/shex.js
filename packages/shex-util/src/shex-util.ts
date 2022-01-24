// **ShExUtil** provides ShEx utility functions

import { SX, RDF, OWL } from "./namespaces";
import {
  NodeConstraint,
  Schema,
  SemAct,
  Shape,
  shapeExpr,
  shapeExprRef,
  ShapeNot,
  ShapeOr,
  TripleConstraint,
  tripleExpr,
} from "shexj";
import { Store } from "n3";

const ShExTerm = require("@shexjs/term");
const Visitor = require("@shexjs/visitor");
const Hierarchy = require("hierarchy-closure");

const Missed = {}; // singleton
const UNBOUNDED = -1;

interface LDTerm {
  value: string;
  type?: string;
  language?: string;
}

interface SchemaMeta extends Schema {
  _prefixes?: Record<string, string>;
  _index?: Record<string, string>;
}

interface ShapeReference {
  type: string;
  shapeLabel: string;
  tc: TripleConstraint;
  newType?: string;
}

interface BiDiClosure {
  needs: Record<number, number[]>;
  neededBy: Record<number, number[]>;
  inCycle: never[];
  test: () => void;
  add: (needer: number, needie: number) => void;
  trim: () => void;
  foundIn: Record<string, shapeExpr>;
  addIn: (tripleExpr: string, shapeExpr: shapeExpr) => void;
}

interface Solution {
  type: string;
  predicate?: string;
  node?: string;
  ldterm?: LDTerm | string;
  solution: Solution;
  expressions: Solution[];
  solutions: Solution[];
  object: LDTerm | string;
  referenced: Solution;
  extensions: string[];
  nested?: Solution | Result;
  shapeExpr?: shapeExpr;
  shapeExprs?: shapeExpr[];
}

interface Result {
  [key: string]: Solution | Solution[] | LDTerm | LDTerm[] | Result | Result[];
}

export function extend(
  base: Record<string, LDTerm | Solution>,
  extendWith: shapeExpr[]
): shapeExpr {
  if (!base) base = {};
  for (
    let i = 1, l = extendWith.length, arg;
    i < l && (arg = extendWith[i] || {});
    i++
  )
    for (let name in arg as Record<string, LDTerm | Solution>)
      base[name] = (arg as Record<string, LDTerm | Solution>)[name] as LDTerm;
  return base as unknown as shapeExpr;
}

export function isTerm(t: string | LDTerm) {
  return (
    typeof t !== "object" ||
    ("value" in t &&
      Object.keys(t).reduce((r: boolean, k: string) => {
        return r === false
          ? r
          : ["value", "type", "language"].indexOf(k) !== -1;
      }, true))
  );
}

export function isShapeRef(expr: string | any) {
  return typeof expr === "string"; // test for JSON-LD @ID
}

function ldify(term: string | LDTerm) {
  if (typeof term === "string" && term[0] !== '"') return term;
  const ret: LDTerm = { value: ShExTerm.getLiteralValue(term) };
  const dt = ShExTerm.getLiteralType(term);
  if (
    dt &&
    dt !== "http://www.w3.org/2001/XMLSchema#string" &&
    dt !== "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"
  )
    ret.type = dt;
  const lang = ShExTerm.getLiteralLanguage(term);
  if (lang) ret.language = lang;
  return ret;
}

export const ShExUtil = {
  SX: SX,
  RDF: RDF,
  version: function () {
    return "0.5.0";
  },

  Visitor: Visitor,
  index: Visitor.index,

  /* getAST - compile a traditional regular expression abstract syntax tree.
   * Tested but not used at present.
   */
  getAST: function (schema: Schema) {
    return {
      type: "AST",
      shapes: schema.shapes?.reduce((ret, shape: shapeExpr) => {
        ret[typeof shape === "string" ? shape : (shape.id as string)] = {
          type: "ASTshape",
          expression:
            typeof shape !== "string" && "expression" in shape
              ? _compileShapeToAST(shape.expression as tripleExpr, [], schema)
              : shape,
        };
        return ret;
      }, {} as Record<string, { type: string; expression: any }>),
    };

    /* _compileShapeToAST - compile a shape expression to an abstract syntax tree.
     *
     * currently tested but not used.
     */
    function _compileShapeToAST(
      expression: tripleExpr,
      tripleConstraints: tripleExpr[],
      schema: Schema
    ) {
      function Epsilon() {
        this.type = "Epsilon";
      }

      function TripleConstraint(
        ordinal,
        predicate,
        inverse,
        negated,
        valueExpr
      ) {
        this.type = "TripleConstraint";
        // this.ordinal = ordinal; @@ does 1card25
        this.inverse = !!inverse;
        this.negated = !!negated;
        this.predicate = predicate;
        if (valueExpr !== undefined) this.valueExpr = valueExpr;
      }

      function Choice(disjuncts) {
        this.type = "Choice";
        this.disjuncts = disjuncts;
      }

      function EachOf(conjuncts) {
        this.type = "EachOf";
        this.conjuncts = conjuncts;
      }

      function SemActs(expression, semActs) {
        this.type = "SemActs";
        this.expression = expression;
        this.semActs = semActs;
      }

      function KleeneStar(expression) {
        this.type = "KleeneStar";
        this.expression = expression;
      }

      function _compileExpression(expr, schema) {
        let repeated, container;

        /* _repeat: map expr with a min and max cardinality to a corresponding AST with Groups and Stars.
           expr 1 1 => expr
           expr 0 1 => Choice(expr, Eps)
           expr 0 3 => Choice(EachOf(expr, Choice(EachOf(expr, Choice(expr, EPS)), Eps)), Eps)
           expr 2 5 => EachOf(expr, expr, Choice(EachOf(expr, Choice(EachOf(expr, Choice(expr, EPS)), Eps)), Eps))
           expr 0 * => KleeneStar(expr)
           expr 1 * => EachOf(expr, KleeneStar(expr))
           expr 2 * => EachOf(expr, expr, KleeneStar(expr))

           @@TODO: favor Plus over Star if Epsilon not in expr.
        */
        function _repeat(expr, min, max) {
          if (min === undefined) {
            min = 1;
          }
          if (max === undefined) {
            max = 1;
          }

          if (min === 1 && max === 1) {
            return expr;
          }

          const opts =
            max === UNBOUNDED
              ? new KleeneStar(expr)
              : Array.from(Array(max - min)).reduce(function (ret, elt, ord) {
                  return ord === 0
                    ? new Choice([expr, new Epsilon()])
                    : new Choice([new EachOf([expr, ret]), new Epsilon()]);
                }, undefined);

          const reqd =
            min !== 0
              ? new EachOf(
                  Array.from(Array(min))
                    .map(function (ret) {
                      return expr; // @@ something with ret
                    })
                    .concat(opts)
                )
              : opts;
          return reqd;
        }

        if (typeof expr === "string") {
          // Inclusion
          const included = schema._index.tripleExprs[expr].expression;
          return _compileExpression(included, schema);
        } else if (expr.type === "TripleConstraint") {
          // predicate, inverse, negated, valueExpr, annotations, semActs, min, max
          const valueExpr =
            "valueExprRef" in expr
              ? schema.valueExprDefns[expr.valueExprRef]
              : expr.valueExpr;
          const ordinal = tripleConstraints.push(expr) - 1;
          const tp = new TripleConstraint(
            ordinal,
            expr.predicate,
            expr.inverse,
            expr.negated,
            valueExpr
          );
          repeated = _repeat(tp, expr.min, expr.max);
          return expr.semActs ? new SemActs(repeated, expr.semActs) : repeated;
        } else if (expr.type === "OneOf") {
          container = new Choice(
            expr.expressions.map(function (e) {
              return _compileExpression(e, schema);
            })
          );
          repeated = _repeat(container, expr.min, expr.max);
          return expr.semActs ? new SemActs(repeated, expr.semActs) : repeated;
        } else if (expr.type === "EachOf") {
          container = new EachOf(
            expr.expressions.map(function (e) {
              return _compileExpression(e, schema);
            })
          );
          repeated = _repeat(container, expr.min, expr.max);
          return expr.semActs ? new SemActs(repeated, expr.semActs) : repeated;
        } else throw Error("unexpected expr type: " + expr.type);
      }

      return expression
        ? _compileExpression(expression, schema)
        : new Epsilon();
    }
  },

  // tests
  // console.warn("HERE:", ShExJtoAS({"type":"Schema","shapes":[{"id":"http://all.example/S1","type":"Shape","expression":
  //  { "id":"http://all.example/S1e", "type":"EachOf","expressions":[ ] },
  // // { "id":"http://all.example/S1e","type":"TripleConstraint","predicate":"http://all.example/p1"},
  // "extra":["http://all.example/p3","http://all.example/p1","http://all.example/p2"]
  // }]}).shapes['http://all.example/S1']);

  ShExJtoAS: function (schema: SchemaMeta) {
    schema._prefixes = schema._prefixes || {};
    schema._index = this.index(schema);
    return schema;
  },

  AStoShExJ: function (schema: SchemaMeta) {
    schema["@context"] =
      schema["@context"] || "http://www.w3.org/ns/shex.jsonld";
    delete schema["_index"];
    delete schema["_prefixes"];
    return schema;
  },

  ShExRVisitor: function (knownShapeExprs: string[]) {
    const v = ShExUtil.Visitor();
    const knownExpressions = {} as Record<
      string,
      { refCount: number; expr: shapeExpr }
    >;
    const oldVisitShapeExpr = v.visitShapeExpr,
      oldVisitExpression = v.visitExpression;
    v.keepShapeExpr = oldVisitShapeExpr;

    v.visitShapeExpr = v.visitValueExpr = function (
      expr: shapeExpr,
      label: string
    ) {
      if (typeof expr === "string") return expr;
      if ("id" in expr) {
        if (
          knownShapeExprs.indexOf(expr.id as string) !== -1 ||
          Object.keys(expr).length === 1
        )
          return expr.id;
        delete expr.id;
      }
      return oldVisitShapeExpr.call(this, expr, label);
    };

    v.visitExpression = function (expr: shapeExpr) {
      if (typeof expr === "string")
        // shortcut for recursive references e.g. 1Include1 and ../doc/TODO.md
        return expr;
      if ("id" in expr) {
        if (expr.id && expr.id in knownExpressions) {
          knownExpressions[expr.id as string].refCount++;
          return expr.id;
        }
      }
      const ret = oldVisitExpression.call(this, expr);
      // Everything from RDF has an ID, usually a BNode.
      knownExpressions[expr.id as string] = { refCount: 1, expr: ret };
      return ret;
    };

    v.cleanIds = function () {
      for (let k in knownExpressions) {
        const known = knownExpressions[k];
        if (
          known.refCount === 1 &&
          typeof known.expr !== "string" &&
          ShExTerm.isBlank(known.expr.id)
        )
          delete known.expr.id;
      }
    };

    return v;
  },

  // tests
  // const shexr = ShExUtil.ShExRtoShExJ({ "type": "Schema", "shapes": [
  //   { "id": "http://a.example/S1", "type": "Shape",
  //     "expression": {
  //       "type": "TripleConstraint", "predicate": "http://a.example/p1",
  //       "valueExpr": {
  //         "type": "ShapeAnd", "shapeExprs": [
  //           { "type": "NodeConstraint", "nodeKind": "bnode" },
  //           { "id": "http://a.example/S2", "type": "Shape",
  //             "expression": {
  //               "type": "TripleConstraint", "predicate": "http://a.example/p2" } }
  //           //            "http://a.example/S2"
  //         ] } } },
  //   { "id": "http://a.example/S2", "type": "Shape",
  //     "expression": {
  //       "type": "TripleConstraint", "predicate": "http://a.example/p2" } }
  // ] });
  // console.warn("HERE:", shexr.shapes[0].expression.valueExpr);
  // ShExUtil.ShExJtoAS(shexr);
  // console.warn("THERE:", shexr.shapes["http://a.example/S1"].expression.valueExpr);

  ShExRtoShExJ: function (schema: Schema) {
    // compile a list of known shapeExprs
    let knownShapeExprs: string[] = [];
    if ("shapes" in schema) {
      knownShapeExprs = [
        ...knownShapeExprs,
        ...(schema.shapes?.map((sh) => {
          return typeof sh !== "string" && sh.id ? sh.id : (sh as string);
        }) ?? []),
      ];
    }

    // normalize references to those shapeExprs
    const v = this.ShExRVisitor(knownShapeExprs);
    if ("start" in schema) schema.start = v.visitShapeExpr(schema.start);
    if ("shapes" in schema)
      schema.shapes = schema.shapes?.map((sh) => {
        return v.keepShapeExpr(sh);
      });

    // remove extraneous BNode IDs
    v.cleanIds();
    return schema;
  },

  valGrep: function (
    obj: Record<string, any>,
    type: string,
    f: (prop: any) => any
  ) {
    const _ShExUtil = this;
    const ret = [];
    for (let i in obj) {
      const o = obj[i];
      if (typeof o === "object") {
        if ("type" in o && o.type === type) ret.push(f(o));
        ret.push.apply(ret, _ShExUtil.valGrep(o, type, f));
      }
    }
    return ret;
  },

  n3jsToTurtle: function (res: any) {
    function termToLex(node: LDTerm) {
      return typeof node === "object"
        ? '"' +
            node.value +
            '"' +
            ("type" in node
              ? "^^<" + node.type + ">"
              : "language" in node
              ? "@" + node.language
              : "")
        : ShExTerm.isIRI(node)
        ? "<" + node + ">"
        : ShExTerm.isBlank(node)
        ? node
        : "???";
    }
    return this.valGrep(res, "TestedTriple", function (t) {
      return (
        ["subject", "predicate", "object"]
          .map((k) => {
            return termToLex(t[k]);
          })
          .join(" ") + " ."
      );
    });
  },

  valToN3js: function (res: any, factory: any) {
    return this.valGrep(res, "TestedTriple", function (t) {
      const ret = JSON.parse(JSON.stringify(t));
      if (typeof t.object === "object")
        ret.object =
          '"' +
          t.object.value +
          '"' +
          ("type" in t.object
            ? "^^" + t.object.type
            : "language" in t.object
            ? "@" + t.object.language
            : "");
      return ShExTerm.externalTriple(ret, factory);
    });
  },

  /* canonicalize: move all tripleExpression references to their first expression.
   *
   */
  canonicalize: function (schema: Schema, trimIRI: string) {
    const ret = JSON.parse(JSON.stringify(schema));
    ret["@context"] = ret["@context"] || "http://www.w3.org/ns/shex.jsonld";
    delete ret._prefixes;
    delete ret._base;
    let index = ret._index || this.index(schema);
    delete ret._index;
    delete ret._sourceMap;
    // Don't delete ret.productions as it's part of the AS.
    const v = ShExUtil.Visitor();
    const knownExpressions: string[] = [];
    const oldVisitInclusion = v.visitInclusion,
      oldVisitExpression = v.visitExpression;
    v.visitInclusion = function (inclusion: string) {
      if (
        knownExpressions.indexOf(inclusion) === -1 &&
        inclusion in index.tripleExprs
      ) {
        knownExpressions.push(inclusion);
        return oldVisitExpression.call(v, index.tripleExprs[inclusion]);
      }
      return oldVisitInclusion.call(v, inclusion);
    };
    v.visitExpression = function (expression: shapeExpr) {
      if (typeof expression === "object" && "id" in expression) {
        const shape =
          typeof expression !== "string"
            ? (expression.id as string)
            : expression;
        if (knownExpressions.indexOf(shape) === -1) {
          knownExpressions.push(shape);
          return oldVisitExpression.call(v, index.tripleExprs[shape]);
        }
        return shape; // Inclusion
      }
      return oldVisitExpression.call(v, expression);
    };
    if (trimIRI) {
      v.visitIRI = function (i: string) {
        return i.replace(trimIRI, "");
      };
      if ("imports" in ret) ret.imports = v.visitImports(ret.imports);
    }
    if ("shapes" in ret) {
      ret.shapes = Object.keys(index.shapeExprs)
        .sort()
        .map((k) => {
          if ("extra" in index.shapeExprs[k]) index.shapeExprs[k].extra.sort();
          return v.visitShapeExpr(index.shapeExprs[k]);
        });
    }
    return ret;
  },

  BiDiClosure: function () {
    return {
      needs: {} as Record<number, number[]>,
      neededBy: {} as Record<number, number[]>,
      inCycle: [],
      test: function () {
        function expect(l: any, r: any) {
          const ls = JSON.stringify(l),
            rs = JSON.stringify(r);
          if (ls !== rs) throw Error(ls + " !== " + rs);
        }
        // this.add(1, 2); expect(this.needs, { 1:[2]                     }); expect(this.neededBy, { 2:[1]                     });
        // this.add(3, 4); expect(this.needs, { 1:[2], 3:[4]              }); expect(this.neededBy, { 2:[1], 4:[3]              });
        // this.add(2, 3); expect(this.needs, { 1:[2,3,4], 2:[3,4], 3:[4] }); expect(this.neededBy, { 2:[1], 3:[2,1], 4:[3,2,1] });

        this.add(2, 3);
        expect(this.needs, { 2: [3] });
        expect(this.neededBy, { 3: [2] });
        this.add(1, 2);
        expect(this.needs, { 1: [2, 3], 2: [3] });
        expect(this.neededBy, { 3: [2, 1], 2: [1] });
        this.add(1, 3);
        expect(this.needs, { 1: [2, 3], 2: [3] });
        expect(this.neededBy, { 3: [2, 1], 2: [1] });
        this.add(3, 4);
        expect(this.needs, { 1: [2, 3, 4], 2: [3, 4], 3: [4] });
        expect(this.neededBy, { 3: [2, 1], 2: [1], 4: [3, 2, 1] });
        this.add(6, 7);
        expect(this.needs, { 6: [7], 1: [2, 3, 4], 2: [3, 4], 3: [4] });
        expect(this.neededBy, { 7: [6], 3: [2, 1], 2: [1], 4: [3, 2, 1] });
        this.add(5, 6);
        expect(this.needs, {
          5: [6, 7],
          6: [7],
          1: [2, 3, 4],
          2: [3, 4],
          3: [4],
        });
        expect(this.neededBy, {
          7: [6, 5],
          6: [5],
          3: [2, 1],
          2: [1],
          4: [3, 2, 1],
        });
        this.add(5, 7);
        expect(this.needs, {
          5: [6, 7],
          6: [7],
          1: [2, 3, 4],
          2: [3, 4],
          3: [4],
        });
        expect(this.neededBy, {
          7: [6, 5],
          6: [5],
          3: [2, 1],
          2: [1],
          4: [3, 2, 1],
        });
        this.add(7, 8);
        expect(this.needs, {
          5: [6, 7, 8],
          6: [7, 8],
          7: [8],
          1: [2, 3, 4],
          2: [3, 4],
          3: [4],
        });
        expect(this.neededBy, {
          7: [6, 5],
          6: [5],
          8: [7, 6, 5],
          3: [2, 1],
          2: [1],
          4: [3, 2, 1],
        });
        this.add(4, 5);
        expect(this.needs, {
          1: [2, 3, 4, 5, 6, 7, 8],
          2: [3, 4, 5, 6, 7, 8],
          3: [4, 5, 6, 7, 8],
          4: [5, 6, 7, 8],
          5: [6, 7, 8],
          6: [7, 8],
          7: [8],
        });
        expect(this.neededBy, {
          2: [1],
          3: [2, 1],
          4: [3, 2, 1],
          5: [4, 3, 2, 1],
          6: [5, 4, 3, 2, 1],
          7: [6, 5, 4, 3, 2, 1],
          8: [7, 6, 5, 4, 3, 2, 1],
        });
      },
      add: function (needer: number, needie: number) {
        const r = this;
        if (!(needer in r.needs)) r.needs[needer] = [];
        if (!(needie in r.neededBy)) r.neededBy[needie] = [];

        // // [].concat.apply(r.needs[needer], [needie], r.needs[needie]). emitted only last element
        r.needs[needer] = r.needs[needer]
          .concat([needie], r.needs[needie])
          .filter(function (el, ord, l) {
            return el !== undefined && l.indexOf(el) === ord;
          });
        // // [].concat.apply(r.neededBy[needie], [needer], r.neededBy[needer]). emitted only last element
        r.neededBy[needie] = r.neededBy[needie]
          .concat([needer], r.neededBy[needer])
          .filter(function (el, ord, l) {
            return el !== undefined && l.indexOf(el) === ord;
          });

        if (needer in this.neededBy)
          this.neededBy[needer].forEach(function (e) {
            r.needs[e] = r.needs[e]
              .concat([needie], r.needs[needie])
              .filter(function (el, ord, l) {
                return el !== undefined && l.indexOf(el) === ord;
              });
          });

        if (needie in this.needs)
          this.needs[needie].forEach(function (e) {
            r.neededBy[e] = r.neededBy[e]
              .concat([needer], r.neededBy[needer])
              .filter(function (el, ord, l) {
                return el !== undefined && l.indexOf(el) === ord;
              });
          });
        // this.neededBy[needie].push(needer);

        if (r.needs[needer].indexOf(needer) !== -1)
          r.inCycle = r.inCycle.concat(
            r.needs[needer] as unknown as ConcatArray<never>
          );
      },
      trim: function () {
        function _trim(a: number[]) {
          // filter(function (el, ord, l) { return l.indexOf(el) === ord; })
          for (let i = a.length - 1; i > -1; --i)
            if (a.indexOf(a[i]) < i) a.splice(i, i + 1);
        }
        for (const k in this.needs) _trim(this.needs[k]);
        for (const k in this.neededBy) _trim(this.neededBy[k]);
      },
      foundIn: {} as Record<string, shapeExpr>,
      addIn: function (tripleExpr: string, shapeExpr: shapeExpr) {
        this.foundIn[tripleExpr] = shapeExpr;
      },
    };
  },
  /** @@TODO tests
   * options:
   *   no: don't do anything; just report nestable shapes
   *   transform: function to change shape labels
   */
  nestShapes: function (
    schema: SchemaMeta,
    options: {
      no?: boolean;
      rename?: boolean;
      noNestPattern?: string;
      transform?: (id: string) => string;
    } = {}
  ) {
    const _ShExUtil = this;
    const index = schema._index || this.index(schema);
    if (!("no" in options)) {
      options.no = false;
    }

    let shapeLabels = Object.keys(index.shapeExprs || []);
    let shapeReferences: Record<
      string,
      { type: string; shapeLabel: string; tc: TripleConstraint }[]
    > = {};
    shapeLabels.forEach((label) => {
      let shape = index.shapeExprs[label];
      noteReference(label); // just note the shape so we have a complete list at the end
      if (shape.type === "Shape") {
        if ("expression" in shape) {
          (_ShExUtil.simpleTripleConstraints(shape) || []).forEach((tc) => {
            tc = tc as TripleConstraint;
            let target = _ShExUtil.getValueType(tc.valueExpr as NodeConstraint);
            noteReference(target as string, {
              type: "tc",
              shapeLabel: label,
              tc: tc,
            });
          });
        }
      } else if (shape.type === "NodeConstraint") {
        // can't have any refs to other shapes
      } else {
        throw Error(
          "nestShapes currently only supports Shapes and NodeConstraints"
        );
      }
    });
    let nestables = Object.keys(shapeReferences)
      .filter(
        (label) =>
          shapeReferences[label].length === 1 &&
          typeof shapeReferences[label][0] !== "string" &&
          shapeReferences[label][0].type === "tc" && // no inheritance support yet
          label in index.shapeExprs &&
          index.shapeExprs[label].type === "Shape" // Don't nest e.g. valuesets for now. @@ needs an option
      )
      .filter(
        (nestable) =>
          !("noNestPattern" in options) ||
          (options.noNestPattern &&
            !nestable.match(RegExp(options.noNestPattern)))
      )
      .reduce((acc, label: string) => {
        acc[label] = {
          referrer: shapeReferences[label][0].shapeLabel,
          predicate: shapeReferences[label][0].tc.predicate,
        };
        return acc;
      }, {} as Record<string, { referrer: string; predicate: string }>);
    if (!options.no) {
      let oldToNew = {} as Record<string, string>;

      if (options.rename) {
        if (!("transform" in options)) {
          const transform = () => {
            let map = shapeLabels.reduce((acc, k, idx) => {
              acc[k] = "_:renamed" + idx;
              return acc;
            }, {} as Record<string, string>);
            return function (id: string) {
              return map[id];
            };
          };
          options.transform = transform();
        }
        Object.keys(nestables).forEach((oldName) => {
          let shapeExpr = index.shapeExprs[oldName];
          let newName = options.transform
            ? options.transform(oldName)
            : oldName;
          oldToNew[oldName] = shapeExpr.id = newName;
          shapeLabels[shapeLabels.indexOf(oldName)] = newName;
          nestables[newName] = nestables[oldName];
          (nestables as unknown as Record<string, { was: string }>)[
            newName
          ].was = oldName;
          delete nestables[oldName];

          // @@ maybe update index when done?
          index.shapeExprs[newName] = index.shapeExprs[oldName];
          delete index.shapeExprs[oldName];

          if (shapeReferences[oldName].length !== 1) {
            throw Error(
              "assertion: " +
                oldName +
                " doesn't have one reference: [" +
                shapeReferences[oldName] +
                "]"
            );
          }
          let ref = shapeReferences[oldName][0];
          if (ref.type === "tc") {
            if (typeof ref.tc.valueExpr === "string") {
              // ShapeRef
              ref.tc.valueExpr = newName;
            } else {
              throw Error(
                "assertion: rename not implemented for TripleConstraint expr: " +
                  ref.tc.valueExpr
              );
              // _ShExUtil.setValueType(ref, newName)
            }
          } else if (ref.type === "Shape") {
            throw Error("assertion: rename not implemented for Shape: " + ref);
          } else {
            throw Error(
              "assertion: " + ref.type + " not TripleConstraint or Shape"
            );
          }
        });

        Object.keys(nestables).forEach((k) => {
          let n = nestables[k] as unknown as {
            referrer: string;
            newReferrer: string;
          };
          if (n.referrer in oldToNew) {
            n.newReferrer = oldToNew[n.referrer];
          }
        });

        // Restore old order for more concise diffs.
        let shapesCopy = {} as Record<string, shapeExpr>;
        shapeLabels.forEach(
          (label) => (shapesCopy[label] = index.shapeExprs[label])
        );
        index.shapeExprs = shapesCopy;
      } else {
        const doomed: number[] = [];
        const ids =
          schema.shapes?.map((s) => (typeof s === "string" ? s : s.id)) ?? [];
        Object.keys(nestables).forEach((oldName) => {
          const borged = index.shapeExprs[oldName];
          // In principle, the ShExJ shouldn't have a Decl if the above criteria are met,
          // but the ShExJ may be generated by something which emits Decls regardless.
          shapeReferences[oldName][0].tc.valueExpr = borged;
          const delme = ids.indexOf(oldName);
          if (
            schema.shapes &&
            ((typeof schema.shapes[delme] === "string" &&
              schema.shapes[delme] !== oldName) ||
              (typeof schema.shapes[delme] !== "string" &&
                (schema.shapes[delme] as Shape).id !== oldName))
          )
            throw Error(
              "assertion: found " +
                (typeof schema.shapes[delme] === "string"
                  ? schema.shapes[delme]
                  : (schema.shapes[delme] as Shape).id) +
                " instead of " +
                oldName
            );
          doomed.push(delme);
          delete index.shapeExprs[oldName];
        });
        doomed
          .sort((l, r) => r - l)
          .forEach((delme) => {
            if (schema.shapes) {
              const id = (
                typeof schema.shapes[delme] === "string"
                  ? schema.shapes[delme]
                  : (schema.shapes[delme] as Shape).id
              ) as string;
              if (!nestables[id])
                throw Error("deleting unexpected shape " + id);
              delete (schema.shapes[delme] as Shape).id;
              schema.shapes.splice(delme, 1);
            }
          });
      }
    }
    // console.dir(nestables)
    // console.dir(shapeReferences)
    return nestables;

    function noteReference(id: string, reference?: ShapeReference) {
      if (!(id in shapeReferences)) {
        shapeReferences[id] = [];
      }
      if (reference) {
        shapeReferences[id].push(reference);
      }
    }
  },

  /** @@TODO tests
   *
   */
  getPredicateUsage: function (
    schema: Schema,
    untyped: Record<string, any> = {}
  ) {
    const _ShExUtil = this;

    if (!schema.shapes) return {};

    // populate shapeHierarchy
    let shapeHierarchy = Hierarchy.create();
    Object.keys(schema.shapes).forEach((label, labelIndex) => {
      let shapeExpr = (schema.shapes as shapeExpr[])[labelIndex];
      if (typeof shapeExpr !== "string" && shapeExpr.type === "Shape") {
        (
          (
            shapeExpr as {
              extends?: {
                reference: ShapeReference;
              }[];
            }
          ).extends || []
        ).forEach((superShape) =>
          shapeHierarchy.add(superShape.reference, label)
        );
      }
    });
    Object.keys(schema.shapes).forEach((label) => {
      if (!(label in shapeHierarchy.parents))
        shapeHierarchy.parents[label] = [];
    });

    let predicates: Record<
      string,
      {
        commonType: string | null;
        polymorphic?: boolean;
        uses?: string[];
      }
    > = {}; // IRI->{ uses: [shapeLabel], commonType: shapeExpr }
    Object.keys(schema.shapes).forEach((shapeLabel, shapeLabelIndex) => {
      let shapeExpr = (schema.shapes as shapeExpr[])[shapeLabelIndex];
      if (typeof shapeExpr !== "string" && shapeExpr.type === "Shape") {
        let tcs = _ShExUtil.simpleTripleConstraints(shapeExpr) || [];
        tcs.forEach((tc) => {
          tc = tc as TripleConstraint;
          let newType = _ShExUtil.getValueType(
            (tc as TripleConstraint).valueExpr as NodeConstraint
          ) as string;
          if (!(tc.predicate in predicates)) {
            predicates[tc.predicate] = {
              uses: [shapeLabel],
              commonType: newType,
              polymorphic: false,
            };
            if (typeof newType === "object") {
              untyped[tc.predicate] = {
                shapeLabel,
                predicate: tc.predicate,
                newType,
                references: [],
              };
            }
          } else {
            predicates[tc.predicate].uses?.push(shapeLabel);
            let curType = predicates[tc.predicate].commonType;
            if (typeof curType === "object" || curType === null) {
              // another use of a predicate with no commonType
              // console.warn(`${shapeLabel} ${tc.predicate}:${newType} uses untypable predicate`)
              untyped[tc.predicate].references.push({ shapeLabel, newType });
            } else if (typeof newType === "object") {
              // first use of a predicate with no detectable commonType
              predicates[tc.predicate].commonType = null;
              untyped[tc.predicate] = {
                shapeLabel,
                predicate: tc.predicate,
                curType,
                newType,
                references: [],
              };
            } else if (curType === newType) {
              // same type again
            } else if (
              shapeHierarchy.parents[curType] &&
              shapeHierarchy.parents[curType].indexOf(newType) !== -1
            ) {
              predicates[tc.predicate].polymorphic = true; // already covered by current commonType
            } else {
              let idx = shapeHierarchy.parents[newType]
                ? shapeHierarchy.parents[newType].indexOf(curType)
                : -1;
              if (idx === -1) {
                let intersection = shapeHierarchy.parents[curType]
                  ? shapeHierarchy.parents[curType].filter(
                      (lab: string) =>
                        -1 !== shapeHierarchy.parents[newType].indexOf(lab)
                    )
                  : [];
                if (intersection.length === 0) {
                  untyped[tc.predicate] = {
                    shapeLabel,
                    predicate: tc.predicate,
                    curType,
                    newType,
                    references: [],
                  };
                  // console.warn(`${shapeLabel} ${tc.predicate} : ${newType} isn\'t related to ${curType}`)
                  predicates[tc.predicate].commonType = null;
                } else {
                  predicates[tc.predicate].commonType = intersection[0];
                  predicates[tc.predicate].polymorphic = true;
                }
              } else {
                predicates[tc.predicate].commonType =
                  shapeHierarchy.parents[newType][idx];
                predicates[tc.predicate].polymorphic = true;
              }
            }
          }
        });
      }
    });
    return predicates;
  },

  /** @@TODO tests
   *
   */
  simpleTripleConstraints: function (shape: shapeExpr) {
    if (typeof shape === "string" || !("expression" in shape)) {
      return [];
    }
    if (
      typeof shape.expression !== "string" &&
      shape.expression?.type === "TripleConstraint"
    ) {
      return [shape.expression];
    }
    if (
      typeof shape.expression !== "string" &&
      shape.expression?.type === "EachOf" &&
      !shape.expression.expressions.find(
        (expr) => typeof expr !== "string" && expr.type !== "TripleConstraint"
      )
    ) {
      return shape.expression.expressions;
    }
    throw Error("can't (yet) express " + JSON.stringify(shape));
  },

  getValueType: function (valueExpr: NodeConstraint & { reference?: string }) {
    if (typeof valueExpr === "string") {
      return valueExpr;
    }
    if (valueExpr.reference) {
      return valueExpr.reference;
    }
    if (valueExpr.nodeKind === "iri") {
      return OWL.Thing;
    } // !! push this test to callers
    if (valueExpr.datatype) {
      return valueExpr.datatype;
    }
    // if (valueExpr.extends && valueExpr.extends.length === 1) { return valueExpr.extends[0] }
    return valueExpr; // throw Error('no value type for ' + JSON.stringify(valueExpr))
  },

  /** getDependencies: find which shappes depend on other shapes by inheritance
   * or inclusion.
   * TODO: rewrite in terms of Visitor.
   */
  getDependencies: function (schema: Schema, ret?: BiDiClosure) {
    ret = ret || this.BiDiClosure();
    (schema.shapes || []).forEach(function (shape) {
      function _walkShapeExpression(shapeExpr: shapeExpr, negated: number) {
        if (typeof shapeExpr === "string") {
          // ShapeRef
          ret?.add(
            Number(typeof shape === "string" ? shape : shape.id),
            Number(shapeExpr)
          );
        } else if (
          shapeExpr.type === "ShapeOr" ||
          shapeExpr.type === "ShapeAnd"
        ) {
          shapeExpr.shapeExprs.forEach(function (expr) {
            _walkShapeExpression(expr, negated);
          });
        } else if (shapeExpr.type === "ShapeNot") {
          _walkShapeExpression(shapeExpr.shapeExpr, negated ^ 1); // !!! test negation
        } else if (shapeExpr.type === "Shape") {
          _walkShape(shapeExpr, negated);
        } else if (shapeExpr.type === "NodeConstraint") {
          // no impact on dependencies
        } else if (shapeExpr.type === "ShapeExternal") {
        } else
          throw Error(
            "expected Shape{And,Or,Ref,External} or NodeConstraint in " +
              JSON.stringify(shapeExpr)
          );
      }

      function _walkShape(shape: shapeExpr, negated: number) {
        function _walkTripleExpression(
          tripleExpr: tripleExpr,
          negated: number
        ) {
          function _exprGroup(exprs: tripleExpr[], negated: number) {
            exprs.forEach(function (nested) {
              _walkTripleExpression(nested, negated); // ?? negation allowed?
            });
          }

          function _walkTripleConstraint(
            tc: TripleConstraint,
            negated: number
          ) {
            if (tc.valueExpr) _walkShapeExpression(tc.valueExpr, negated);
            if (
              negated &&
              ret?.inCycle.indexOf(
                (typeof shape === "string" ? shape : shape.id) as never
              ) !== -1
            )
              // illDefined/negatedRefCycle.err
              throw Error(
                "Structural error: " +
                  (typeof shape === "string" ? shape : shape.id) +
                  " appears in negated cycle"
              );
          }

          if (typeof tripleExpr === "string") {
            // Inclusion
            ret?.add(
              Number(typeof shape === "string" ? shape : shape.id),
              Number(tripleExpr)
            );
          } else {
            if ("id" in tripleExpr) ret?.addIn(tripleExpr.id as string, shape);
            if (tripleExpr.type === "TripleConstraint") {
              _walkTripleConstraint(tripleExpr, negated);
            } else if (
              tripleExpr.type === "OneOf" ||
              tripleExpr.type === "EachOf"
            ) {
              _exprGroup(tripleExpr.expressions, 0);
            } else {
              throw Error(
                "expected {TripleConstraint,OneOf,EachOf,Inclusion} in " +
                  tripleExpr
              );
            }
          }
        }

        if (typeof shape !== "string" && "expression" in shape)
          _walkTripleExpression(shape.expression as tripleExpr, negated);
      }
      _walkShapeExpression(shape, 0); // 0 means false for bitwise XOR
    });
    return ret;
  },

  /** partition: create subset of a schema with only desired shapes and
   * their dependencies.
   *
   * @schema: input schema
   * @partition: shape name or array of desired shape names
   * @deps: (optional) dependency tree from getDependencies.
   *        map(shapeLabel -> [shapeLabel])
   */
  partition: function (
    schema: SchemaMeta,
    includes: string | string[],
    deps: Record<string, string[] | Record<string, string | string[]>>,
    cantFind: (what: string, why: string) => void
  ) {
    const inputIndex = schema._index || this.index(schema);
    const outputIndex = {
      shapeExprs: {} as Record<string, shapeExpr>,
      tripleExprs: {} as Record<string, tripleExpr>,
    };
    includes = includes instanceof Array ? includes : [includes];

    // build dependency tree if not passed one
    deps = deps || this.getDependencies(schema);
    cantFind =
      cantFind ||
      function (what, why) {
        throw new Error(
          "Error: can't find shape " +
            (why ? why + " dependency " + what : what)
        );
      };
    const partition: Record<string, shapeExpr[]> = {};
    for (let k in schema)
      partition[k] = k === "shapes" ? [] : (schema.shapes as shapeExpr[]);
    includes.forEach(function (i) {
      if (i in outputIndex.shapeExprs) {
        // already got it.
      } else if (i in inputIndex.shapeExprs) {
        const adding = inputIndex.shapeExprs[i];
        partition.shapes.push(adding);
        outputIndex.shapeExprs[adding.id] = adding;
        if (i in deps.needs)
          (deps.needs as Record<string, string[]>)[i].forEach(function (n) {
            // Turn any needed TE into an SE.
            if (n in deps.foundIn)
              n = (deps.foundIn as Record<string, string | string[]>)[
                n
              ] as string;

            if (n in outputIndex.shapeExprs) {
            } else if (n in inputIndex.shapeExprs) {
              const needed = inputIndex.shapeExprs[n];
              partition.shapes.push(needed);
              outputIndex.shapeExprs[needed.id] = needed;
            } else cantFind(n, i);
          });
      } else {
        cantFind(i, "supplied");
      }
    });
    return partition;
  },

  /** @@TODO flatten: return copy of input schema with all shape and value class
   * references substituted by a copy of their referent.
   *
   * @schema: input schema
   */
  flatten: function (schema: Schema) {
    const v = this.Visitor();
    return v.visitSchema(schema);
  },

  // @@ put predicateUsage here

  emptySchema: function () {
    return {
      type: "Schema",
    };
  },
  merge: function (
    left: Record<string, any>,
    right: Record<string, any>,
    overwrite: boolean,
    inPlace: boolean
  ) {
    const ret = inPlace ? left : this.emptySchema();

    function mergeArray(attr: string) {
      Object.keys(left[attr] || {}).forEach(function (key) {
        if (!(attr in ret)) ret[attr] = {};
        ret[attr][key] = left[attr][key];
      });
      Object.keys(right[attr] || {}).forEach(function (key) {
        if (!(attr in left) || !(key in left[attr]) || overwrite) {
          if (!(attr in ret)) ret[attr] = {};
          ret[attr][key] = right[attr][key];
        }
      });
    }

    function mergeMap(attr: string) {
      (left[attr] || {}).forEach(function (
        _value: any,
        key: number,
        _map: any[]
      ) {
        if (!(attr in ret)) ret[attr] = {};
        ret[attr].set(key, left[attr].get(key));
      });
      (right[attr] || {}).forEach(function (
        _value: any,
        key: number,
        _map: any[]
      ) {
        if (!(attr in left) || !left[attr].has(key) || overwrite) {
          if (!(attr in ret)) ret[attr] = {};
          ret[attr].set(key, right[attr].get(key));
        }
      });
    }

    // base
    if ("_base" in left) ret._base = left._base;
    if ("_base" in right)
      if (!("_base" in left) || overwrite) ret._base = right._base;

    mergeArray("_prefixes");

    mergeMap("_sourceMap");

    if ("imports" in right)
      if (!("imports" in left) || overwrite) ret.imports = right.imports;

    // startActs
    if ("startActs" in left) ret.startActs = left.startActs;
    if ("startActs" in right)
      if (!("startActs" in left) || overwrite) ret.startActs = right.startActs;

    // start
    if ("start" in left) ret.start = left.start;
    if ("start" in right)
      if (!("start" in left) || overwrite) ret.start = right.start;

    let lindex = left._index || this.index(left);

    // shapes
    if (!inPlace)
      (left.shapes || []).forEach(function (lshape: any) {
        if (!("shapes" in ret)) ret.shapes = [];
        ret.shapes.push(lshape);
      });
    (right.shapes || []).forEach(function (rshape: any) {
      if (
        !("shapes" in left) ||
        !(rshape.id in lindex.shapeExprs) ||
        overwrite
      ) {
        if (!("shapes" in ret)) ret.shapes = [];
        ret.shapes.push(rshape);
      }
    });

    if (left._index || right._index) ret._index = this.index(ret); // inefficient; could build above

    return ret;
  },

  absolutizeResults: function (parsed: Record<string, any>, base: string) {
    // !! duplicate of Validation-test.js:84: const referenceResult = parseJSONFile(resultsFile...)
    function mapFunction(k: string, obj: Record<string, string>) {
      // resolve relative URLs in results file
      if (
        [
          "shape",
          "reference",
          "node",
          "subject",
          "predicate",
          "object",
        ].indexOf(k) !== -1 &&
        ShExTerm.isIRI(obj[k])
      ) {
        obj[k] = ShExTerm.resolveRelativeIRI(base, obj[k]);
      }
    }

    function resolveRelativeURLs(obj: Record<string, any>) {
      Object.keys(obj).forEach(function (k) {
        if (typeof obj[k] === "object") {
          resolveRelativeURLs(obj[k]);
        }
        if (mapFunction) {
          mapFunction(k, obj);
        }
      });
    }
    resolveRelativeURLs(parsed);
    return parsed;
  },

  getProofGraph: function (res: any, db: Store, dataFactory: any) {
    function _dive1(solns: Solution) {
      if (solns.type === "NodeConstraintTest") {
      } else if (
        solns.type === "SolutionList" ||
        solns.type === "ShapeAndResults"
      ) {
        solns.solutions.forEach((s) => {
          if (s.solution)
            // no .solution for <S> {}
            _dive1(s.solution);
        });
      } else if (solns.type === "ShapeOrResults") {
        _dive1(solns.solution);
      } else if (solns.type === "ShapeTest") {
        if ("solution" in solns) _dive1(solns.solution);
      } else if (
        solns.type === "OneOfSolutions" ||
        solns.type === "EachOfSolutions"
      ) {
        solns.solutions.forEach((s: Solution) => {
          _dive1(s);
        });
      } else if (
        solns.type === "OneOfSolution" ||
        solns.type === "EachOfSolution"
      ) {
        solns.expressions.forEach((s: Solution) => {
          _dive1(s);
        });
      } else if (solns.type === "TripleConstraintSolutions") {
        solns.solutions.map((s) => {
          if (s.type !== "TestedTriple")
            throw Error("unexpected result type: " + s.type);
          const s2 = s;
          if (typeof s2.object === "object")
            s2.object =
              '"' +
              s2.object.value.replace(/"/g, '\\"') +
              '"' +
              (s2.object.language
                ? "@" + s2.object.language
                : s2.object.type
                ? "^^" + s2.object.type
                : "");
          db.addQuad(ShExTerm.externalTriple(s2, dataFactory));
          if ("referenced" in s) {
            _dive1(s.referenced);
          }
        });
      } else if (solns.type === "Recursion") {
      } else {
        throw Error(
          "unexpected expr type " + solns.type + " in " + JSON.stringify(solns)
        );
      }
    }
    _dive1(res);
    return db;
  },

  validateSchema: function (schema: Schema) {
    // obselete, but may need other validations in the future.
    const visitor = this.Visitor();
    let currentExtra: null | undefined | string[] = null;
    let currentLabel: null | undefined | string[] | string = currentExtra;
    let currentNegated = false;
    let inTE = false;
    const oldVisitShape = visitor.visitShape;
    const negativeDeps = Hierarchy.create();
    const positiveDeps = Hierarchy.create();
    let index =
      (
        schema as Schema & {
          index: {
            shapeExprs: Record<string, shapeExpr>;
            tripleExprs: Record<string, tripleExpr>;
          };
        }
      ).index || this.index(schema);

    visitor.visitShape = function (shape: shapeExpr, label: string) {
      const lastExtra = currentExtra;
      currentExtra = (shape as Shape).extra;
      const ret = oldVisitShape.call(visitor, shape, label);
      currentExtra = lastExtra;
      return ret;
    };

    const oldVisitShapeNot = visitor.visitShapeNot;
    visitor.visitShapeNot = function (shapeNot: ShapeNot, label: string) {
      const lastNegated = currentNegated;
      currentNegated = false;
      const ret = oldVisitShapeNot.call(visitor, shapeNot, label);
      currentNegated = lastNegated;
      return ret;
    };

    const oldVisitTripleConstraint = visitor.visitTripleConstraint;
    visitor.visitTripleConstraint = function (expr: TripleConstraint) {
      const lastNegated = currentNegated;
      if (currentExtra && currentExtra.indexOf(expr.predicate) !== -1)
        currentNegated = false;
      inTE = true;
      const ret = oldVisitTripleConstraint.call(visitor, expr);
      inTE = false;
      currentNegated = lastNegated;
      return ret;
    };

    const oldVisitShapeRef = visitor.visitShapeRef;
    visitor.visitShapeRef = function (shapeRef: shapeExprRef) {
      if (!(shapeRef in index.shapeExprs))
        throw firstError(
          Error(
            "Structural error: reference to " +
              JSON.stringify(shapeRef) +
              " not found in schema shape expressions:\n" +
              dumpKeys(index.shapeExprs) +
              "."
          ),
          shapeRef
        );
      if (!inTE && shapeRef === currentLabel)
        throw firstError(
          Error(
            "Structural error: circular reference to " + currentLabel + "."
          ),
          shapeRef
        );
      (currentNegated ? negativeDeps : positiveDeps).add(
        currentLabel,
        shapeRef
      );
      return oldVisitShapeRef.call(visitor, shapeRef);
    };

    const oldVisitInclusion = visitor.visitInclusion;
    visitor.visitInclusion = function (inclusion: string) {
      const refd = index.tripleExprs[inclusion];
      if (!refd)
        throw firstError(
          Error(
            "Structural error: included shape " +
              inclusion +
              " not found in schema triple expressions:\n" +
              dumpKeys(index.tripleExprs) +
              "."
          ),
          inclusion
        );
      // if (refd.type !== "Shape")
      //   throw Error("Structural error: " + inclusion + " is not a simple shape.");
      return oldVisitInclusion.call(visitor, inclusion);
    };

    (schema.shapes || []).forEach(function (shape) {
      currentLabel = (typeof shape === "string" ? shape : shape.id) as string;
      visitor.visitShapeExpr(
        shape,
        (typeof shape === "string" ? shape : shape.id) as string
      );
    });
    let circs = Object.keys(negativeDeps.children).filter(
      (k) =>
        negativeDeps.children[k].filter(
          (k2: string) =>
            (k2 in negativeDeps.children &&
              negativeDeps.children[k2].indexOf(k) !== -1) ||
            (k2 in positiveDeps.children &&
              positiveDeps.children[k2].indexOf(k) !== -1)
        ).length > 0
    );
    if (circs.length)
      throw firstError(
        Error(
          "Structural error: circular negative dependencies on " +
            circs.join(",") +
            "."
        ),
        circs[0]
      );

    function dumpKeys(obj: Record<string, any>) {
      return obj
        ? Object.keys(obj)
            .map((u) => (u.substr(0, 2) === "_:" ? u : "<" + u + ">"))
            .join("\n        ")
        : "- none defined -";
    }

    function firstError(e: Error & { location?: string }, obj: string) {
      if ("_sourceMap" in schema)
        e.location = ((
          schema as Schema & { _sourceMap: Map<string, string[]> }
        )._sourceMap.get(obj) || [undefined])[0];
      return e;
    }
  },

  /** isWellDefined: assert that schema is well-defined.
   *
   * @schema: input schema
   * @@TODO
   */
  isWellDefined: function (schema: SchemaMeta) {
    this.validateSchema(schema);
    // const deps = this.getDependencies(schema);
    return schema;
  },

  walkVal: function (
    val: string | Solution,
    cb: (val: string | Solution) => Solution | Record<string, Solution[]> | any
  ): null | Solution | Record<string, Solution[]> {
    const _ShExUtil = this;
    if (typeof val === "string") {
      // ShapeRef
      return null; // 1NOTRefOR1dot_pass-inOR
    } else if (val.type === "SolutionList") {
      // dependent_shape
      return val.solutions.reduce((ret, exp) => {
        const n = _ShExUtil.walkVal(exp, cb) as Record<string, Solution[]>;
        if (n)
          Object.keys(n).forEach((k) => {
            if (k in ret) ret[k] = ret[k].concat(n[k]);
            else ret[k] = n[k];
          });
        return ret;
      }, {} as Record<string, Solution[]>);
    } else if (val.type === "NodeConstraintTest") {
      // 1iri_pass-iri
      return _ShExUtil.walkVal(val.shapeExpr as Solution, cb);
    } else if (val.type === "NodeConstraint") {
      // 1iri_pass-iri
      return null;
    } else if (val.type === "ShapeTest") {
      // 0_empty
      const vals = [] as Solution[];
      visitSolution(val, vals); // A ShapeTest is a sort of Solution.
      const ret = vals.length
        ? { "http://shex.io/reflex": vals }
        : ({} as Record<string, Solution[]>);
      if ("solution" in val)
        Object.assign(ret, _ShExUtil.walkVal(val.solution, cb));
      return Object.keys(ret).length ? ret : null;
    } else if (val.type === "Shape") {
      // 1NOTNOTdot_passIv1
      return null;
    } else if (val.type === "ShapeNotTest") {
      // 1NOT_vsANDvs__passIv1
      return _ShExUtil.walkVal(val.shapeExpr as Solution, cb);
    } else if (val.type === "ShapeNotResults") {
      // NOT1dotOR2dot_pass-empty
      return _ShExUtil.walkVal(val.solution, cb);
    } else if (val.type === "Failure") {
      // NOT1dotOR2dot_pass-empty
      return null; // !!TODO
    } else if (val.type === "ShapeNot") {
      // 1NOTNOTIRI_passIo1,
      return _ShExUtil.walkVal(val.shapeExpr as Solution, cb);
    } else if (val.type === "ShapeOrResults") {
      // 1dotRefOR3_passShape1
      return _ShExUtil.walkVal(val.solution, cb);
    } else if (val.type === "ShapeOr") {
      // 1NOT_literalORvs__passIo1
      return (val.shapeExprs ?? ([] as shapeExpr[])).reduce((ret, exp) => {
        const n = _ShExUtil.walkVal(exp as Solution, cb) as Record<
          string,
          Solution[]
        >;
        if (n)
          Object.keys(n).forEach((k) => {
            if (k in ret) ret[k] = ret[k].concat(n[k]);
            else ret[k] = n[k];
          });
        return ret;
      }, {} as Record<string, Solution[]>);
    } else if (val.type === "ShapeAndResults") {
      // 1iriRef1_pass-iri
      return val.solutions.reduce((ret, exp) => {
        const n = _ShExUtil.walkVal(exp, cb) as Record<string, Solution[]>;
        if (n)
          Object.keys(n).forEach((k) => {
            if (k in ret) ret[k] = ret[k].concat(n[k]);
            else ret[k] = n[k];
          });
        return ret;
      }, {} as Record<string, Solution[]>);
    } else if (val.type === "ShapeAnd") {
      // 1NOT_literalANDvs__passIv1
      return (val.shapeExprs ?? []).reduce((ret, exp) => {
        const n = _ShExUtil.walkVal(exp as Solution, cb) as Record<
          string,
          Solution[]
        >;
        if (n)
          Object.keys(n).forEach((k) => {
            if (k in ret) ret[k] = ret[k].concat(n[k]);
            else ret[k] = n[k];
          });
        return ret;
      }, {} as Record<string, Solution[]>);
    } else if (
      val.type === "EachOfSolutions" ||
      val.type === "OneOfSolutions"
    ) {
      // 1dotOne2dot_pass_p1
      return val.solutions.reduce((ret, sln) => {
        sln.expressions.forEach((exp) => {
          const n = _ShExUtil.walkVal(exp as Solution, cb) as Record<
            string,
            Solution[]
          >;
          if (n)
            Object.keys(n).forEach((k) => {
              if (k in ret) ret[k] = ret[k].concat(n[k]);
              else ret[k] = n[k];
            });
        });
        return ret;
      }, {} as Record<string, Solution[]>);
    } else if (val.type === "TripleConstraintSolutions") {
      // 1dot_pass-noOthers
      if ("solutions" in val) {
        const ret = {} as Record<string, Solution[]>;
        const vals = [] as Solution[];
        ret[val.predicate as string] = vals;
        val.solutions.forEach((sln) => visitSolution(sln, vals));
        return vals.length ? ret : null;
      } else {
        return null;
      }
    } else if (val.type === "Recursion") {
      // 3circRefPlus1_pass-recursiveData
      return null;
    } else {
      // console.log(val);
      throw Error("unknown shapeExpression type in " + JSON.stringify(val));
    }

    function visitSolution(
      sln: Solution,
      vals: (Solution | Record<string, Solution | Solution[]>)[]
    ) {
      const toAdd = [] as Solution[];
      if (chaseList(sln.referenced)) {
        // parse 1val1IRIREF.ttl
        vals = [...vals, ...toAdd];
      } else {
        // 1dot_pass-noOthers
        const newElt = (cb(sln) || {}) as Solution;
        if ("referenced" in sln) {
          const t = _ShExUtil.walkVal(sln.referenced, cb);
          if (t) newElt.nested = t;
        }
        if (Object.keys(newElt).length > 0) vals.push(newElt);
      }
      function chaseList(li: Solution): boolean {
        if (!li) return false;
        if (li.node === RDF.nil) return true;
        if (
          "solution" in li &&
          "solutions" in li.solution &&
          li.solution.solutions.length === 1 &&
          "expressions" in li.solution.solutions[0] &&
          li.solution.solutions[0].expressions.length === 2 &&
          typeof li.solution.solutions[0].expressions[0] !== "string" &&
          "predicate" in li.solution.solutions[0].expressions[0] &&
          (li.solution.solutions[0].expressions[0] as TripleConstraint)
            .predicate === RDF.first &&
          typeof li.solution.solutions[0].expressions[1] !== "string" &&
          "predicate" in li.solution.solutions[0].expressions[1] &&
          (li.solution.solutions[0].expressions[1] as TripleConstraint)
            .predicate === RDF.rest
        ) {
          const expressions = li.solution.solutions[0].expressions;
          const ent = expressions[0];
          const rest = expressions[1].solutions[0];
          const member = ent.solutions[0];
          let newElt = cb(member);
          if ("referenced" in member) {
            const t = _ShExUtil.walkVal(member.referenced, cb);
            if (t) {
              if (newElt) newElt.nested = t;
              else newElt = t;
            }
          }
          if (newElt) vals.push(newElt);
          return rest.object === RDF.nil
            ? true
            : Boolean(
                chaseList(
                  rest.referenced.type === "ShapeOrResults" // heuristic for `nil OR @<list>` idiom
                    ? rest.referenced.solution
                    : rest.referenced
                )
              );
        }
        return false;
      }
    }
  },

  /**
   * Convert val results to a property tree.
   * @exports
   * @returns {@code {p1:[{p2: v2},{p3: v3}]}}
   */
  valToValues: function (val: Solution) {
    return this.walkVal(val, function (sln) {
      return typeof sln !== "string" && "object" in sln
        ? { ldterm: sln.object }
        : null;
    });
  },

  valToExtension: function (val: Solution, lookfor: string) {
    const map = this.walkVal(val, function (sln) {
      return typeof sln !== "string" && "extensions" in sln
        ? { extensions: (sln as Solution).extensions }
        : null;
    });
    function extensions(obj: Result | Result[]): Result[] | Result | LDTerm {
      const list = [];
      let crushed: null | Record<string, string | LDTerm> = {};
      function crush(elt: Result | LDTerm) {
        if (crushed === null) return elt;
        if (Array.isArray(elt)) {
          crushed = null;
          return elt;
        }
        for (const k in elt) {
          if (k in crushed) {
            crushed = null;
            return elt;
          }
          crushed[k] = ldify((elt as Result)[k] as LDTerm);
        }
        return elt;
      }
      for (const k in obj) {
        if (k === "extensions") {
          if ((obj as Result)[k])
            list.push(
              crush(
                ldify(
                  ((obj as Result)[k] as Result)[lookfor] as LDTerm
                ) as LDTerm
              )
            );
        } else if (k === "nested") {
          const nested = extensions((obj as Result)[k] as Result);
          if (Array.isArray(nested)) nested.forEach(crush);
          else crush(nested);
          list.push(nested);
        } else {
          list.push(crush(extensions((obj as Result)[k] as Result) as Result));
        }
      }
      return list.length === 1
        ? (list[0] as Result)
        : crushed
        ? (crushed as Result)
        : (list as Result[]);
    }
    return extensions(map as Record<string, Solution | Solution[]>);
  },

  valuesToSchema: function (values: Result) {
    // console.log(JSON.stringify(values, null, "  "));
    const v = values;
    const t = (values[RDF.type] as Solution[])[0].ldterm;
    if (t === SX.Schema) {
      /* Schema { "@context":"http://www.w3.org/ns/shex.jsonld"
       *           startActs:[SemAct+]? start:(shapeExpr|labeledShapeExpr)?
       *           shapes:[labeledShapeExpr+]? }
       */
      const ret: Schema = {
        "@context": "http://www.w3.org/ns/shex.jsonld",
        type: "Schema",
      };
      if (SX.startActs in v)
        ret.startActs = (v[SX.startActs] as Solution[]).map((e) => {
          const ret = {
            type: "SemAct",
            name: ((e.nested as Result)[SX.name] as Solution[])[0].ldterm,
          } as SemAct;
          if (SX.code in (e.nested ?? {}))
            ret.code = (
              ((e.nested as Result)[SX.code] as Solution[])[0].ldterm as LDTerm
            ).value;
          return ret;
        }) as SemAct[];
      if (SX.imports in v)
        ret.imports = (v[SX.imports] as Solution[]).map((e) => {
          return e.ldterm as string;
        });
      if (values[SX.start])
        ret.start = extend(
          { id: (values[SX.start] as Solution[])[0].ldterm as LDTerm },
          [shapeExpr((values[SX.start] as Solution[])[0].nested as Result)]
        ) as unknown as shapeExpr;
      const shapes = values[SX.shapes];
      if (shapes) {
        ret.shapes = (shapes as Solution[]).map((v) => {
          return extend({ id: v.ldterm as LDTerm }, [
            shapeExpr(v.nested as Result),
          ]) as shapeExpr;
        });
      }
      // console.log(ret);
      return ret;
    } else {
      throw Error("unknown schema type in " + JSON.stringify(values));
    }
    function findType(
      v: Result,
      elts: Record<
        string,
        { nary?: boolean; prop?: string | null; expr?: boolean }
      >,
      f: (v: Solution | Result) => shapeExpr
    ) {
      const t = (
        (v[RDF.type] as Solution[] | Result[])[0].ldterm as string
      ).substr(SX._namespace.length);
      const elt = elts[t];
      if (!elt) return Missed;
      if (elt.nary && elt.prop) {
        const ret = {
          type: t,
        };
        (ret as unknown as Record<string, (LDTerm | shapeExpr | undefined)[]>)[
          elt.prop
        ] = (v[SX[elt.prop]] as Solution[]).map((e) => {
          return valueOf(e);
        });
        return ret;
      } else {
        const ret = {
          type: t,
        };
        if (elt.prop) {
          (ret as unknown as Record<string, Solution | string>)[elt.prop] =
            valueOf((v[SX[elt.prop]] as Solution[])[0]) as Solution | string;
        }
        return ret;
      }

      function valueOf(x: Solution) {
        return elt.expr && "nested" in x
          ? extend({ id: x.ldterm as LDTerm }, [
              f(x.nested as Solution | Result),
            ])
          : x.ldterm;
      }
    }
    function shapeExpr(v: Result): shapeExpr {
      // shapeExpr = ShapeOr | ShapeAnd | ShapeNot | NodeConstraint | Shape | ShapeRef | ShapeExternal;
      const elts = {
        ShapeAnd: { nary: true, expr: true, prop: "shapeExprs" },
        ShapeOr: { nary: true, expr: true, prop: "shapeExprs" },
        ShapeNot: { nary: false, expr: true, prop: "shapeExpr" },
        ShapeRef: { nary: false, expr: false, prop: "reference" },
        ShapeExternal: { nary: false, expr: false, prop: null },
      };
      const ret = findType(
        v,
        elts,
        shapeExpr as (v: Solution | Result) => shapeExpr
      );
      if (ret !== Missed) return ret;

      const t = (v[RDF.type] as Record<string, Solution>)[0].ldterm;
      if (t === SX.Shape) {
        const ret = { type: "Shape" };
        ["closed"].forEach((a) => {
          if (SX[a] in v)
            (ret as unknown as Record<string, boolean>)[a] = !!(
              (v[SX[a]] as Record<string, Solution>)[0].ldterm as LDTerm
            )?.value;
        });
        if (SX.extra in v)
          (ret as unknown as Record<string, LDTerm[]>).extra = (
            v[SX.extra] as Solution[]
          ).map((e) => {
            return e.ldterm as LDTerm;
          });
        if (SX.expression in v) {
          (ret as unknown as Record<string, Solution | LDTerm>).expression =
            "nested" in (v[SX.expression] as Solution[])[0]
              ? (extend(
                  { id: (v[SX.expression] as Solution[])[0].ldterm as LDTerm },
                  [tripleExpr((v[SX.expression] as Solution[])[0].nested)]
                ) as Solution)
              : ((v[SX.expression] as Solution[])[0].ldterm as LDTerm);
        }
        if (SX.annotation in v)
          (ret as unknown as Record<string, Partial<Solution>[]>).annotations =
            (v[SX.annotation] as Solution[]).map((e) => {
              return {
                type: "Annotation",
                predicate: ((e.nested as Result)[SX.predicate] as Solution[])[0]
                  .ldterm as string,
                object: ((e.nested as Result)[SX.object] as Solution[])[0]
                  .ldterm,
              };
            });
        if (SX.semActs in v)
          (ret as unknown as Record<string, Partial<Solution>[]>).semActs = (
            v[SX.semActs] as Solution[]
          ).map((e) => {
            const ret = {
              type: "SemAct",
              name: ((e.nested as Result)[SX.name] as Solution[])[0].ldterm,
            };
            if (SX.code in (e.nested as Result))
              (ret as unknown as { code: string }).code = (
                ((e.nested as Result)[SX.code] as Solution[])[0]
                  .ldterm as LDTerm
              )?.value;
            return ret;
          });
        return ret;
      } else if (t === SX.NodeConstraint) {
        const ret = { type: "NodeConstraint" };
        if (SX.values in v)
          ret.values = v[SX.values].map((v1) => {
            return objectValue(v1);
          });
        if (SX.nodeKind in v)
          ret.nodeKind = v[SX.nodeKind][0].ldterm.substr(SX._namespace.length);
        [
          "length",
          "minlength",
          "maxlength",
          "mininclusive",
          "maxinclusive",
          "minexclusive",
          "maxexclusive",
          "totaldigits",
          "fractiondigits",
        ].forEach((a) => {
          if (SX[a] in v) ret[a] = parseFloat(v[SX[a]][0].ldterm.value);
        });
        if (SX.pattern in v) ret.pattern = v[SX.pattern][0].ldterm.value;
        if (SX.flags in v) ret.flags = v[SX.flags][0].ldterm.value;
        if (SX.datatype in v) ret.datatype = v[SX.datatype][0].ldterm;
        return ret;
      } else {
        throw Error("unknown shapeExpr type in " + JSON.stringify(v));
      }
    }

    function objectValue(v, expectString) {
      if ("nested" in v) {
        const t = v.nested[RDF.type][0].ldterm;
        if ([SX.IriStem, SX.LiteralStem, SX.LanguageStem].indexOf(t) !== -1) {
          const ldterm = v.nested[SX.stem][0].ldterm.value;
          return {
            type: t.substr(SX._namespace.length),
            stem: ldterm,
          };
        } else if ([SX.Language].indexOf(t) !== -1) {
          return {
            type: "Language",
            languageTag: v.nested[SX.languageTag][0].ldterm.value,
          };
        } else if (
          [SX.IriStemRange, SX.LiteralStemRange, SX.LanguageStemRange].indexOf(
            t
          ) !== -1
        ) {
          const st = v.nested[SX.stem][0];
          let stem = st;
          if (typeof st === "object") {
            if (typeof st.ldterm === "object") {
              stem = st.ldterm;
            } else if (st.ldterm.startsWith("_:")) {
              stem = { type: "Wildcard" };
            }
          }
          const ret = {
            type: t.substr(SX._namespace.length),
            stem: stem.type !== "Wildcard" ? stem.value : stem,
          };
          if (SX.exclusion in v.nested) {
            // IriStemRange:
            // * [{"ldterm":"http://a.example/v1"},{"ldterm":"http://a.example/v3"}] <-- no value
            // * [{"ldterm":"_:b836","nested":{a:[{"ldterm":sx:IriStem}],
            //                                 sx:stem:[{"ldterm":{"value":"http://a.example/v1"}}]}},
            //    {"ldterm":"_:b838","nested":{a:[{"ldterm":sx:IriStem}],
            //                                 sx:stem:[{"ldterm":{"value":"http://a.example/v3"}}]}}]

            // LiteralStemRange:
            // * [{"ldterm":{"value":"v1"}},{"ldterm":{"value":"v3"}}]
            // * [{"ldterm":"_:b866","nested":{a:[{"ldterm":sx:LiteralStem}],
            //                                 sx:stem:[{"ldterm":{"value":"v1"}}]}},
            //    {"ldterm":"_:b868","nested":{a:[{"ldterm":sx:LiteralStem}],
            //                                 sx:stem:[{"ldterm":{"value":"v3"}}]}}]

            // LanguageStemRange:
            // * [{"ldterm":{"value":"fr-be"}},{"ldterm":{"value":"fr-ch"}}]
            // * [{"ldterm":"_:b851","nested":{a:[{"ldterm":sx:LanguageStem}],
            //                                 sx:stem:[{"ldterm":{"value":"fr-be"}}]}},
            //    {"ldterm":"_:b853","nested":{a:[{"ldterm":sx:LanguageStem}],
            //                                 sx:stem:[{"ldterm":{"value":"fr-ch"}}]}}]
            ret.exclusions = v.nested[SX.exclusion].map((v1) => {
              return objectValue(v1, t !== SX.IriStemRange);
            });
          }
          return ret;
        } else {
          throw Error("unknown objectValue type in " + JSON.stringify(v));
        }
      } else {
        return expectString ? v.ldterm.value : v.ldterm;
      }
    }

    function tripleExpr(v) {
      // tripleExpr = EachOf | OneOf | TripleConstraint | Inclusion ;
      const elts = {
        EachOf: { nary: true, expr: true, prop: "expressions" },
        OneOf: { nary: true, expr: true, prop: "expressions" },
        Inclusion: { nary: false, expr: false, prop: "include" },
      };
      const ret = findType(v, elts, tripleExpr);
      if (ret !== Missed) {
        minMaxAnnotSemActs(v, ret);
        return ret;
      }

      const t = v[RDF.type][0].ldterm;
      if (t === SX.TripleConstraint) {
        const ret = {
          type: "TripleConstraint",
          predicate: v[SX.predicate][0].ldterm,
        };
        ["inverse"].forEach((a) => {
          if (SX[a] in v) ret[a] = !!v[SX[a]][0].ldterm.value;
        });
        if (SX.valueExpr in v)
          ret.valueExpr = extend({ id: v[SX.valueExpr][0].ldterm }, [
            "nested" in v[SX.valueExpr][0]
              ? shapeExpr(v[SX.valueExpr][0].nested)
              : ({} as Record<string, LDTerm | Solution>),
          ]);
        minMaxAnnotSemActs(v, ret);
        return ret;
      } else {
        throw Error("unknown tripleExpr type in " + JSON.stringify(v));
      }
    }
    function minMaxAnnotSemActs(v, ret) {
      if (SX.min in v) ret.min = parseInt(v[SX.min][0].ldterm.value);
      if (SX.max in v) {
        ret.max = parseInt(v[SX.max][0].ldterm.value);
        if (isNaN(ret.max)) ret.max = UNBOUNDED;
      }
      if (SX.annotation in v)
        ret.annotations = v[SX.annotation].map((e) => {
          return {
            type: "Annotation",
            predicate: e.nested[SX.predicate][0].ldterm,
            object: e.nested[SX.object][0].ldterm,
          };
        });
      if (SX.semActs in v)
        ret.semActs = v[SX.semActs].map((e) => {
          const ret = {
            type: "SemAct",
            name: e.nested[SX.name][0].ldterm,
          };
          if (SX.code in e.nested) ret.code = e.nested[SX.code][0].ldterm.value;
          return ret;
        });
      return ret;
    }
  },
  /* -- deprecated
  valToSimple: function (val) {
    const _ShExUtil = this;
    function _join (list) {
      return list.reduce((ret, elt) => {
        Object.keys(elt).forEach(k => {
          if (k in ret) {
            ret[k] = Array.from(new Set(ret[k].concat(elt[k])));
          } else {
            ret[k] = elt[k];
          }
        });
        return ret;
      }, {});
    }
    if (typeof val === "string") {
      return val
    } else if (val.type === "TripleConstraintSolutions") {
      if ("solutions" in val) {
        return val.solutions.reduce((ret, sln) => {
          if (!("referenced" in sln))
            return {};
          const toAdd = {};
          if (chaseList(sln.referenced, toAdd)) {
            return _join(ret, toAdd);
          } else {
            return _join(ret, _ShExUtil.valToSimple(sln.referenced));
          }
          function chaseList (li) {
            if (!li) return false;
            if (li.node === RDF.nil) return true;
            if ("solution" in li && "solutions" in li.solution &&
                li.solution.solutions.length === 1 &&
                "expressions" in li.solution.solutions[0] &&
                li.solution.solutions[0].expressions.length === 2 &&
                "predicate" in li.solution.solutions[0].expressions[0] &&
                li.solution.solutions[0].expressions[0].predicate === RDF.first &&
                li.solution.solutions[0].expressions[1].predicate === RDF.rest) {
              const expressions = li.solution.solutions[0].expressions;
              const ent = expressions[0];
              const rest = expressions[1].solutions[0];
              const member = ent.solutions[0];
              const newElt = { ldterm: member.object };
              if ("referenced" in member) {
                const t = _ShExUtil.valToSimple(member.referenced);
                if (t)
                  newElt.nested = t;
              }
              toAdd = _join(toAdd, newElt);
              return rest.object === RDF.nil ?
                true :
                chaseList(rest.referenced.type === "ShapeOrResults" // heuristic for `nil  OR @<list>` idiom
                          ? rest.referenced.solution
                          : rest.referenced);
            }
          }
        }, []);
      } else {
        return [];
      }
    } else if (["TripleConstraintSolutions"].indexOf(val.type) !== -1) {
      return {  };
    } else if (val.type === "NodeConstraintTest") {
      return _ShExUtil.valToSimple(val.shapeExpr);
    } else if (val.type === "NodeConstraint") {
      const thisNode = {  };
      thisNode[n3ify(val.focus)] = [val.shape];
      return thisNode;
    } else if (val.type === "ShapeTest") {
      const thisNode = {  };
      thisNode[n3ify(val.node)] = [val.shape];
      return "solution" in val ? _join([thisNode].concat(_ShExUtil.valToSimple(val.solution))) : thisNode;
    } else if (val.type === "Shape") {
      const thisNode = {  };
      thisNode[n3ify(val.node)] = [val.shape];
      return thisNode;
    } else if (val.type === "ShapeNotTest") {
      const thisNode = {  };
      thisNode[n3ify(val.node)] = [val.shape];
      return _join(['NOT1'].concat(_ShExUtil.valToSimple(val.shapeExpr)));
    } else if (val.type === "ShapeNot") {
      const thisNode = {  };
      thisNode[n3ify(val.node)] = [val.shape];
      return _join(['NOT'].concat(_ShExUtil.valToSimple(val.shapeExpr)));
    } else if (val.type === "ShapeAnd") {
      return val.shapeExprs.map(shapeExpr => _ShExUtil.valToSimple(shapeExpr)).join ('AND');
    } else if (val.type === "ShapeOr") {
      return val.shapeExprs.map(shapeExpr => _ShExUtil.valToSimple(shapeExpr)).join ('OR');
    } else if (val.type === "Failure") {
      return _ShExUtil.errsToSimple(val);
    } else if (val.type === "Recursion") {
      return {  };
    } else if ("solutions" in val) {
      // ["SolutionList", "EachOfSolutions", "OneOfSolutions", "ShapeAndResults", "ShapeOrResults"].indexOf(val.type) !== -1
      return _join(val.solutions.map(sln => {
        return _ShExUtil.valToSimple(sln);
      }));
    } else if ("solution" in val) {
      // ["SolutionList", "EachOfSolutions", "OneOfSolutions", "ShapeAndResults", "ShapeOrResults"].indexOf(val.type) !== -1
      return _ShExUtil.valToSimple(val.solution);
    } else if ("expressions" in val) {
      return _join(val.expressions.map(sln => {
        return _ShExUtil.valToSimple(sln);
      }));
    } else {
      // console.log(val);
      throw Error("unknown shapeExpression type in " + JSON.stringify(val));
    }
    return val;
  },
*/
  simpleToShapeMap: function (x) {
    return Object.keys(x).reduce((ret, k) => {
      x[k].forEach((s) => {
        ret.push({ node: k, shape: s });
      });
      return ret;
    }, []);
  },

  absolutizeShapeMap: function (parsed, base) {
    return parsed.map((elt) => {
      return Object.assign(elt, {
        node: ShExTerm.resolveRelativeIRI(base, elt.node),
        shape: ShExTerm.resolveRelativeIRI(base, elt.shape),
      });
    });
  },

  errsToSimple: function (val) {
    const _ShExUtil = this;
    if (val.type === "FailureList") {
      return val.errors.reduce((ret, e) => {
        return ret.concat(_ShExUtil.errsToSimple(e));
      }, []);
    } else if (val.type === "Failure") {
      return ["validating " + val.node + " as " + val.shape + ":"].concat(
        errorList(val.errors).reduce((ret, e) => {
          const nested = _ShExUtil.errsToSimple(e).map((s) => "  " + s);
          return ret.length > 0
            ? ret.concat(["  OR"]).concat(nested)
            : nested.map((s) => "  " + s);
        }, [])
      );
    } else if (val.type === "TypeMismatch") {
      const nested = Array.isArray(val.errors)
        ? val.errors.reduce((ret, e) => {
            return ret.concat(
              (typeof e === "string" ? [e] : _ShExUtil.errsToSimple(e)).map(
                (s) => "  " + s
              )
            );
          }, [])
        : "  " +
          (typeof e === "string"
            ? [val.errors]
            : _ShExUtil.errsToSimple(val.errors));
      return ["validating " + n3ify(val.triple.object) + ":"].concat(nested);
    } else if (val.type === "ShapeAndFailure") {
      return Array.isArray(val.errors)
        ? val.errors.reduce((ret, e) => {
            return ret.concat(
              (typeof e === "string" ? [e] : _ShExUtil.errsToSimple(e)).map(
                (s) => "  " + s
              )
            );
          }, [])
        : "  " +
            (typeof e === "string"
              ? [val.errors]
              : _ShExUtil.errsToSimple(val.errors));
    } else if (val.type === "ShapeOrFailure") {
      return Array.isArray(val.errors)
        ? val.errors.reduce((ret, e) => {
            return ret.concat(
              " OR " + (typeof e === "string" ? [e] : _ShExUtil.errsToSimple(e))
            );
          }, [])
        : " OR " +
            (typeof e === "string"
              ? [val.errors]
              : _ShExUtil.errsToSimple(val.errors));
    } else if (val.type === "ShapeNotFailure") {
      return [
        "Node " + val.errors.node + " expected to NOT pass " + val.errors.shape,
      ];
    } else if (val.type === "ExcessTripleViolation") {
      return [
        "validating " + n3ify(val.triple.object) + ": exceeds cardinality",
      ];
    } else if (val.type === "ClosedShapeViolation") {
      return ["Unexpected triple(s): {"]
        .concat(
          val.unexpectedTriples.map((t) => {
            return (
              "  " +
              t.subject +
              " " +
              t.predicate +
              " " +
              n3ify(t.object) +
              " ."
            );
          })
        )
        .concat(["}"]);
    } else if (val.type === "NodeConstraintViolation") {
      const w = require("@shexjs/writer")();
      w._write(w._writeNodeConstraint(val.shapeExpr).join(""));
      let txt;
      w.end((err, res) => {
        txt = res;
      });
      return ["NodeConstraintError: expected to match " + txt];
    } else if (val.type === "MissingProperty") {
      return ["Missing property: " + val.property];
    } else if (val.type === "NegatedProperty") {
      return ["Unexpected property: " + val.property];
    } else if (Array.isArray(val)) {
      debugger;
      return val.reduce((ret, e) => {
        const nested = _ShExUtil.errsToSimple(e).map((s) => "  " + s);
        return ret.length ? ret.concat(["AND"]).concat(nested) : nested;
      }, []);
    } else if (val.type === "SemActFailure") {
      const nested = Array.isArray(val.errors)
        ? val.errors.reduce((ret, e) => {
            return ret.concat(
              (typeof e === "string" ? [e] : _ShExUtil.errsToSimple(e)).map(
                (s) => "  " + s
              )
            );
          }, [])
        : "  " +
          (typeof e === "string"
            ? [val.errors]
            : _ShExUtil.errsToSimple(val.errors));
      return ["rejected by semantic action:"].concat(nested);
    } else if (val.type === "SemActViolation") {
      return [val.message];
    } else if (val.type === "BooleanSemActFailure") {
      return [
        "Failed evaluating " +
          val.code +
          " on context " +
          JSON.stringify(val.ctx),
      ];
    } else {
      debugger; // console.log(val);
      throw Error("unknown shapeExpression type in " + JSON.stringify(val));
    }
    function errorList(errors) {
      return errors.reduce(function (acc, e) {
        const attrs = Object.keys(e);
        return acc.concat(
          attrs.length === 1 && attrs[0] === "errors" ? errorList(e.errors) : e
        );
      }, []);
    }
  },

  resolveRelativeIRI: ShExTerm.resolveRelativeIRI,

  resolvePrefixedIRI: function (
    prefixedIri: string,
    prefixes: Record<string, string>
  ) {
    const colon = prefixedIri.indexOf(":");
    if (colon === -1) return null;
    const prefix = prefixes[prefixedIri.substr(0, colon)];
    return prefix === undefined ? null : prefix + prefixedIri.substr(colon + 1);
  },

  parsePassedNode: function (
    passedValue: string,
    meta: { prefixes: Record<string, string>; base: string },
    deflt?: () => string,
    known?: (iri: string) => boolean,
    reportUnknown?: (iri: string) => void
  ) {
    if (passedValue === undefined || passedValue.length === 0)
      return known && known(meta.base)
        ? meta.base
        : deflt
        ? deflt()
        : this.NotSupplied;
    if (passedValue[0] === "_" && passedValue[1] === ":") return passedValue;
    if (passedValue[0] === '"') {
      const m = passedValue.match(
        /^"((?:[^"\\]|\\")*)"(?:@(.+)|\^\^(?:<(.*)>|([^:]*):(.*)))?$/
      );
      if (!m) throw Error("malformed literal: " + passedValue);
      const lex = m[1],
        lang = m[2],
        rel = m[3],
        pre = m[4],
        local = m[5];
      // Turn the literal into an N3.js atom.
      const quoted = '"' + lex + '"';
      if (lang !== undefined) return quoted + "@" + lang;
      if (pre !== undefined) {
        if (!(pre in meta.prefixes))
          throw Error(
            "error parsing node " + passedValue + ' no prefix for "' + pre + '"'
          );
        return quoted + "^^" + meta.prefixes[pre] + local;
      }
      if (rel !== undefined)
        return quoted + "^^" + ShExTerm.resolveRelativeIRI(meta.base, rel);
      return quoted;
    }
    if (!meta && known)
      return known(passedValue) ? passedValue : this.UnknownIRI;
    const relIRI =
      passedValue[0] === "<" && passedValue[passedValue.length - 1] === ">";
    if (relIRI) passedValue = passedValue.substr(1, passedValue.length - 2);
    const t = ShExTerm.resolveRelativeIRI(meta.base || "", passedValue); // fall back to base-less mode
    if (known && known(t)) return t;
    if (!relIRI) {
      const t2 = this.resolvePrefixedIRI(passedValue, meta.prefixes);
      if (t2 !== null && known && known(t2)) return t2;
    }
    return reportUnknown ? reportUnknown(t) : this.UnknownIRI;
  },

  executeQueryPromise: function (query: string, endpoint: string) {
    const queryURL = endpoint + "?query=" + encodeURIComponent(query);
    return fetch(queryURL, {
      headers: {
        Accept: "application/sparql-results+json",
      },
    })
      .then((resp) => resp.json())
      .then((t) => {
        const selects = t.head.vars;
        return t.results.bindings.map(
          (row: {
            [key: string]: {
              type: string;
              value: any;
              datatype: string;
              "xml:lang"?: string;
              prop(prop: string): string;
            };
          }) => {
            return selects.map((sel: string) => {
              const elt = row[sel];
              switch (elt.type) {
                case "uri":
                  return elt.value;
                case "bnode":
                  return "_:" + elt.value;
                case "literal":
                  const datatype = elt.datatype;
                  const lang = elt["xml:lang"];
                  return (
                    '"' +
                    elt.value +
                    '"' +
                    (datatype ? "^^" + datatype : lang ? "@" + lang : "")
                  );
                default:
                  throw "unknown XML results type: " + elt.prop("tagName");
              }
            });
          }
        );
      }); // .then(x => new Promise(resolve => setTimeout(() => resolve(x), 1000)));
  },

  executeQuery: function (query: string, endpoint: string) {
    const queryURL = endpoint + "?query=" + encodeURIComponent(query);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", queryURL, false);
    xhr.setRequestHeader("Accept", "application/sparql-results+json");
    xhr.send();
    // const selectsBlock = query.match(/SELECT\s*(.*?)\s*{/)[1];
    // const selects = selectsBlock.match(/\?[^\s?]+/g);
    const t = JSON.parse(xhr.responseText);
    const selects = t.head.vars;
    return t.results.bindings.map(
      (row: {
        [key: string]: {
          type: string;
          value: any;
          datatype: string;
          "xml:lang"?: string;
          prop(prop: string): string;
        };
      }) => {
        return selects.map((sel: string) => {
          const elt = row[sel];
          switch (elt.type) {
            case "uri":
              return elt.value;
            case "bnode":
              return "_:" + elt.value;
            case "literal":
              const datatype = elt.datatype;
              const lang = elt["xml:lang"];
              return (
                '"' +
                elt.value +
                '"' +
                (datatype ? "^^" + datatype : lang ? "@" + lang : "")
              );
            default:
              throw "unknown XML results type: " + elt.prop("tagName");
          }
        });
      }
    );

    /* TO ADD? XML results format parsed with jquery:
        $(data).find("sparql > results > result").
          each((_, row) => {
            rows.push($(row).find("binding > *:nth-child(1)").
              map((idx, elt) => {
                elt = $(elt);
                const text = elt.text();
                switch (elt.prop("tagName")) {
                case "uri": return text;
                case "bnode": return "_:" + text;
                case "literal":
                  const datatype = elt.attr("datatype");
                  const lang = elt.attr("xml:lang");
                  return "\"" + text + "\"" + (
                    datatype ? "^^" + datatype :
                    lang ? "@" + lang :
                      "");
                default: throw "unknown XML results type: " + elt.prop("tagName");
                }
              }).get());
          });
*/
  },

  rdfjsDB: function (db: any, queryTracker: any) {
    function getSubjects() {
      return db.getSubjects().map(ShExTerm.internalTerm);
    }
    function getPredicates() {
      return db.getPredicates().map(ShExTerm.internalTerm);
    }
    function getObjects() {
      return db.getObjects().map(ShExTerm.internalTerm);
    }
    function getQuads() /*: Quad[]*/ {
      return db.getQuads.apply(db, arguments).map(ShExTerm.internalTriple);
    }

    function getNeighborhood(point: string, shapeLabel: string /*, shape */) {
      // I'm guessing a local DB doesn't benefit from shape optimization.
      let startTime = new Date();
      if (queryTracker) {
        queryTracker.start(false, point, shapeLabel);
      }
      const outgoing /*: Quad[]*/ = db
        .getQuads(point, null, null, null)
        .map(ShExTerm.internalTriple);
      if (queryTracker) {
        const time = new Date();
        queryTracker.end(outgoing, time.valueOf() - startTime?.valueOf());
        startTime = time;
      }
      if (queryTracker) {
        queryTracker.start(true, point, shapeLabel);
      }
      const incoming /*: Quad[]*/ = db
        .getQuads(null, null, point, null)
        .map(ShExTerm.internalTriple);
      if (queryTracker) {
        queryTracker.end(incoming, new Date().valueOf() - startTime?.valueOf());
      }
      return {
        outgoing: outgoing,
        incoming: incoming,
      };
    }

    return {
      // size: db.size,
      getNeighborhood: getNeighborhood,
      getSubjects: getSubjects,
      getPredicates: getPredicates,
      getObjects: getObjects,
      getQuads: getQuads,
      get size() {
        return db.size;
      },
      // getQuads: function (s, p, o, graph, shapeLabel) {
      //   // console.log(Error(s + p + o).stack)
      //   if (queryTracker)
      //     queryTracker.start(!!s, s ? s : o, shapeLabel);
      //   const quads = db.getQuads(s, p, o, graph)
      //   if (queryTracker)
      //     queryTracker.end(quads, new Date() - startTime);
      //   return quads;
      // }
    };
  },

  NotSupplied: "-- not supplied --",
  UnknownIRI: "-- not found --",

  /**
   * unescape numerics and allowed single-character escapes.
   * throws: if there are any unallowed sequences
   */
  unescapeText: function (
    string: string,
    replacements: { [key: string]: string }
  ) {
    const regex = /\\u([a-fA-F0-9]{4})|\\U([a-fA-F0-9]{8})|\\(.)/g;
    try {
      string = string.replace(
        regex,
        function (
          _sequence: any,
          unicode4: string,
          unicode8: string,
          escapedChar: string
        ) {
          let charCode;
          if (unicode4) {
            charCode = parseInt(unicode4, 16);
            if (isNaN(charCode)) throw new Error(); // can never happen (regex), but helps performance
            return String.fromCharCode(charCode);
          } else if (unicode8) {
            charCode = parseInt(unicode8, 16);
            if (isNaN(charCode)) throw new Error(); // can never happen (regex), but helps performance
            if (charCode < 0xffff) return String.fromCharCode(charCode);
            return String.fromCharCode(
              0xd800 + ((charCode -= 0x10000) >> 10),
              0xdc00 + (charCode & 0x3ff)
            );
          } else {
            const replacement = replacements[escapedChar];
            if (!replacement)
              throw new Error("no replacement found for '" + escapedChar + "'");
            return replacement;
          }
        }
      );
      return string;
    } catch (error) {
      console.warn(error);
      return "";
    }
  },
};

function n3ify(ldterm: { type: string; value: string; language?: string }) {
  if (typeof ldterm !== "object") return ldterm;
  const ret = '"' + ldterm.value + '"';
  if ("language" in ldterm) return ret + "@" + ldterm.language;
  if ("type" in ldterm) return ret + "^^" + ldterm.type;
  return ret;
}
