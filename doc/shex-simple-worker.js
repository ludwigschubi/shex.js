// // importScripts('Util.js');
// importScripts('require.js');
// //var process = {env:{}};
// importScripts('../lib/ShExValidator.js');
importScripts("require.js");
importScripts("https://rawgit.com/RubenVerborgh/N3.js/master/lib/N3Util.js"); modules["n3"]["Util"] = modules["./N3Util"] = N3Util = module.exports;
importScripts("https://rawgit.com/RubenVerborgh/N3.js/master/lib/N3Lexer.js"); modules["n3"]["Lexer"] = modules["./N3Lexer"] = N3Lexer = module.exports;
importScripts("https://rawgit.com/RubenVerborgh/N3.js/master/lib/N3Parser.js"); modules["n3"]["Parser"] = N3Parser = module.exports;
importScripts("https://rawgit.com/RubenVerborgh/N3.js/master/lib/N3Store.js"); modules["n3"]["Store"] = N3Store = module.exports;
importScripts("../lib/ShExUtil.js"); modules["./ShExUtil"] = modules["../../lib/ShExUtil"] = ShExUtil;
importScripts("../lib/ShExJison.js");
importScripts("../lib/ShExParser.js");
importScripts("../lib/ShExWriter.js");
importScripts("../lib/regex/threaded-val-nerr.js"); modules["../lib/regex/threaded-val-nerr"] = module.exports;
importScripts("../lib/regex/nfax-val-1err.js"); modules["../lib/regex/nfax-val-1err"] = module.exports;
importScripts("../lib/ShExValidator.js"); ShExValidator = module.exports;
importScripts("Util.js");

var validator = null;
onmessage = function (msg) {
  switch (msg.data.request) {
  case "create":
    var options = msg.data.options || {};
    if ("regexModule" in options)
      options.regexModule = modules[options.regexModule];
    options = Object.create({ results: "api" }, options); // default to API results
    validator = ShExValidator.construct(msg.data.schema, options);
    postMessage({ response: "created" });
    break;

  case "validate":
    var db = "endpoint" in msg.data ?
      makeQueryDB(msg.data.endpoint) :
      makeStaticDB(msg.data.data);
    var queryMap = msg.data.queryMap;
    var currentEntry = 0, options = msg.data.options || {};
    var results = Util.createResults();

    for (var currentEntry = 0; currentEntry < queryMap.length; ) {
      var singletonMap = [queryMap[currentEntry++]]; // ShapeMap with single entry.
      var newResults = validator.validate(db, singletonMap);
      // Merge into results.
      results.merge(newResults);

      // Notify caller.
      postMessage({ response: "update", results: newResults });

      // Skip entries that were already processed.
      while (currentEntry < queryMap.length &&
             results.has(queryMap[currentEntry]))
        ++currentEntry;
    }
    // Done -- show results and restore interface.
    if (options.includeDoneResults)
      postMessage({ response: "done", results: results.getShapeMap() });
    else
      postMessage({ response: "done" });
    break;

  default:
    throw "unknown request: " + JSON.stringify(msg.data);
  }

}

function makeStaticDB (triples) {
  var ret = N3Store();
  ret.addTriples(triples);
  return ret;
}

function makeQueryDB (endpoint) {
  var executeQuery = function (query, endpointParm) {
    var rows;

    var queryURL = (endpointParm || endpoint) + "?query=" + encodeURIComponent(query);
    var xhr = new XMLHttpRequest();
    xhr.open("GET", queryURL, false);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.send();
    // var selectsBlock = query.match(/SELECT\s*(.*?)\s*{/)[1];
    // var selects = selectsBlock.match(/\?[^\s?]+/g);
    var t = JSON.parse(xhr.responseText);
    var selects = t.head.vars;
    return t.results.bindings.map(row => {
      return selects.map(sel => {
        var elt = row[sel];
        switch (elt.type) {
        case "uri": return elt.value;
        case "bnode": return "_:" + elt.value;
        case "literal":
          var datatype = elt.datatype;
          var lang = elt["xml:lang"];
          return "\"" + elt.value + "\"" + (
            datatype ? "^^" + datatype :
              lang ? "@" + lang :
              "");
        default: throw "unknown XML results type: " + elt.prop("tagName");
        }
        return row[sel];
      })
    });
  };

      return {
        getTriplesByIRI: function (s, p, o) {
          var query = s ?
                `SELECT ?p ?o { <${s}> ?p ?o }`:
                `SELECT ?s ?p { ?s ?p <${o}> }`;
          var rows = executeQuery(query);
          var triples = rows.map(row =>  {
            return s ? {
              subject: s,
              predicate: row[0],
              object: row[1]
            } : {
              subject: row[0],
              predicate: row[1],
              object: o
            };
          });
          return triples;
        }
      };
}
