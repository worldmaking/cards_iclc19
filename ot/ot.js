let assert = require ("assert");

// see https://github.com/worldmaking/cards/wiki/List-of-Operational-Transforms
/*
	Every op should be invertible (which means, destructive edits must include full detail of what is to be deleted)
	Changes are rebased by graph path (rather than character position as in text documents)

	Simultaneous edits must be merged: the second is rebased by the first. 

*/

function deepEqual(a, b) {
	// FIXME expensive lazy way:
	return JSON.stringify(a) == JSON.stringify(b);
}

function deepCopy(a) {
	// FIXME expensive lazy way:
	return JSON.parse(JSON.stringify(a));
}

// copy all properties from src to dst
// excepting any reserved keys (op, path)
let copyProps = function(src, dst) {
	for (let k in src) {
		if (k == "op" || k == "path") continue;
		// recursive objects (deep copy)
		// FIXME expensive lazy way:
		dst[k] = deepCopy(src[k]);
	}
	return dst;
}

// find a path within a tree:
let findPath = function(tree, path) {
	let steps = path.split(".");
	let n = tree;
	for (let k in steps) {
		assert(n[k], "failed to find path");
		n = n[k];
	}
	return n;
}

// given a tree, find the node that contains last item on path
// returns [undefined, path] if the path could not be fully resolved
let findPathContainer = function(tree, path) {
	let steps = path.split(".");
	let last;
	let container;
	let node = tree;
	for (let i=0; i<steps.length; i++) {
		let k = steps[i]
		//assert(node[k], "failed to find path: "+k);
		if (!node[k]) return [undefined, k];
		last = k;
		container = node;
		node = node[k];
	}
	return [container, last];
}

// given path "a.b.c.d", creates object root.a.b.c.d
// throws error if root.a.b.c doesn't exist
// throws error if root.a.b.c.d already exists
let makePath = function(root, path) {
	let steps = path.split(".");
	let last = steps.pop();
	let n = root;
	for (let k of steps) {
		assert(n[k], "failed to find path");
		n = n[k];
	}
	assert(!n[last], "path already exists")
	let o = { _props: {} };
	n[last] = o;
	return o;
}

// given a delta it returns the inverse operation 
// such that applying inverse(delta) undoes all changes contained in delta
let inverseDelta = function(delta) {
	if (Array.isArray(delta)) {
		let res = [];
		// invert in reverse order:
		for (let i=delta.length-1; i>=0; i--) {
			res.push(inverseDelta(delta[i]));
		}
		return res;
	} else {
		switch (delta.op) {
			case "newnode": {
				let d = {
					op: "delnode",
					path: delta.path,
				};
				copyProps(delta, d);
				return d;
			} break;
			case "delnode": {
				let d = {
					op: "newnode",
					path: delta.path,
				};
				copyProps(delta, d);
				return d;
			} break;
			
			case "connect": {
				return {
					op: "disconnect",
					paths: [ delta.paths[0], delta.paths[1] ]
				}
			} break;
			case "disconnect": {
				return {
					op: "connect",
					paths: [ delta.paths[0], delta.paths[1] ]
				}
			} break;
			case "repath": {
				return {
					op: "repath",
					paths: [delta.paths[1], delta.paths[0]],
				};
			} break;
		}
	}
}

// rebase B in terms of the changes in A
// returns new list of deltas containing both effects of A then B:
let rebase = function(B, A, result) {
	if (Array.isArray(A)) {
		for (let a of A) {
			try {
				// rebase B in terms of a:
				let b = rebase(B, a, result);
				// push a into result first
				result.push(deepCopy(a));
				// finally, add resolved B to result
				if (b) result.push(b);
			} catch(e) {
				throw(e);
			}
		}
	} else if (Array.isArray(B)) {
		// A is a single edit:
		for (let b of B) {
			// then rebase b in terms of the single edit in A:
			rebase(b, A, result);
		}
	} else {
		// both A and B are now single edits
		// check the two operations to see if they could have any influence on each other
		// use 'b' as the resolved edit:
		let b = deepCopy(B);

		// check for conflicts:
		switch (A.op) {
			case "connect": {
				// if B is the same connect, skip it
				if (b.op == "connect" && b.paths[0]==A.paths[0] && b.paths[1]==A.paths[1]) {
					return; // skip duplicate operation
				}
			} break;
			case "disconnect": {
				// if B is the same disconnect, skip it
				if (b.op == "disconnect" && b.paths[0]==A.paths[0] && b.paths[1]==A.paths[1]) {
					return; // skip duplicate operation
				}
			} break;
			case "newnode": {
				// check duplicate ops:
				if (deepEqual(A, b)) {
					return; // skip duplicate operation
				}
				// otherwise error on same name:
				if (A.path == b.path) {
					throw("cannot create node; path already exists");
				}
			} break;
			case "delnode": {
				// if B is the same op, skip it
				if (b.op == "delnode" && b.path==A.path) {
					return; // skip duplicate operation
				}
				// check path use
				let path = A.path;
				if ((b.path && b.path == A.path) ||
					(b.paths && (b.paths[0] == A.path || b.paths[1] == A.path))) {
					throw("cannot delete node; path is used in subsequent edits")
				}
			} break;
			case "repath": {
				// if any other op uses the same path, have to change it:
				let [src, dst] = A.path;
				if (b.path == src) { b.path = dst; } 
				if (b.paths && b.paths[0] == src) { b.paths[0] = dst; }
				if (b.paths && b.paths[1] == src) { b.paths[1] = dst; }
			} break;	
		}
		return b;
	}
	return;
}

let mergeDeltasToGraph = function(graph, deltasA, deltasB) {
	/*
		first, try to rebase deltasB in terms of deltasA
		then apply deltasA, then apply rebased-deltasB

		lots of ways this can fail
	*/
	
}

let applyDeltasToGraph = function (graph, deltas) {
	if (Array.isArray(deltas)) {
		for (let d of deltas) {
			applyDeltasToGraph(graph, d);
		}
	} else {
		switch (deltas.op) {
			case "repath": {
				let [ctr0, src] = findPathContainer(graph.nodes, deltas.paths[0]);
				let [ctr1, dst] = findPathContainer(graph.nodes, deltas.paths[1]);
				assert(ctr0, "repath failed; couldn't find source");
				assert(ctr1 == undefined, "repath failed; destination already exists");
				// find destination container:
				let steps = deltas.paths[1].split(".");
				steps.pop(); // ignoring the last element
				let container = graph.nodes;
				for (let i=0; i<steps.length; i++) {
					let k = steps[i]
					container = container[k];
				}

				// move it
				container[dst] = ctr0[src];
				delete ctr0[src];				
				// repath arcs:
				for (let arc of graph.arcs) {
					if (arc[0] == deltas.paths[0]) arc[0] = deltas.paths[1];
					if (arc[1] == deltas.paths[0]) arc[1] = deltas.paths[1];
				}
			} break;
			
			case "newnode": {
				let o = makePath(graph.nodes, deltas.path);
				copyProps(deltas, o._props);
			} break;
			case "delnode": {
				let [ctr, name] = findPathContainer(graph.nodes, deltas.path);
				let o = ctr[name];
				assert(o, "delnode failed: path not found");
				// assert o._props match delta props:
				for (let k in o._props) {
					assert(deepEqual(o._props[k], deltas[k]), "delnode failed; properties do not match");
				}
				// assert o has no child nodes
				// keys should either be ['_props'] or just []:
				let keys = Object.keys(o);
				assert((keys.length == 1 && keys[0]=="_props") || keys.length == 0, "delnode failed; node has children");
				delete ctr[name];
			} break;
			case "connect": {
				// assert connection does not yet exist
				assert(undefined == graph.arcs.find(e => e[0]==deltas.paths[0] && e[1]==deltas.paths[1]), "connect failed: arc already exists");

				graph.arcs.push([ deltas.paths[0], deltas.paths[1] ]);
			} break;
			case "disconnect": {
				// find matching arc; there should only be 1.
				let index = -1;
				for (let i in graph.arcs) {
					let a = graph.arcs[i];
					if (a[0] == deltas.paths[0] && a[1] == deltas.paths[1]) {
						assert(index == -1, "disconnect failed: more than one matching arc");
						index = i;
					}
				}
				assert(index != -1, "disconnect failed: no matching arc found");
				graph.arcs.splice(index, 1);
			} break;
		}
	}
	return graph;
}

let makeGraph = function(deltas) {
	let graph = {
		nodes: {},
		arcs: []	
	};
	return graph;
}

let graphFromDeltas = function(deltas) {
	return applyDeltasToGraph(makeGraph(), deltas);
}

let deltasFromGraph = function(graph, deltas) {
	nodesToDeltas(graph.nodes, deltas, "");

	for (let a of graph.arcs) {
		// TODO: assert that the paths exist?
		deltas.push({
			op: "connect",
			paths: [ a[0], a[1] ]
		})
	}
	return deltas;
}

function nodesToDeltas(nodes, deltas, pathprefix) {
	for (let name in nodes) {
		if (name == "_props") continue;
		let group = [];
		let n = nodes[name];
		let p = n._props;
		let d = copyProps(n._props, {
			op: "newnode", 
			path: pathprefix + name, 
		});
		group.push(d);
		// also push children:
		nodesToDeltas(n, group, pathprefix+name+".");

		deltas.push(group);
	}
	return deltas;
}

let propToString = function(prop) {
	if (typeof prop == "number") {
		return prop;
	} else if (typeof prop == "string") {
		return `"${prop}"`;
	} else if (Array.isArray(prop)) {
		return `[${prop.map(propToString).join(",")}]`
	}
}

let propsToString = function(props) {
	let res = [];
	for (let k of Object.keys(props)) {
		let v = props[k];
		
		res.push(`${k}=${propToString(v)}`)
	}
	return res.join(", ");
}

let nodeToString = function(node, indent) {
	let keys = Object.keys(node);
	let children = [];
	let props = "";
	if (node._props) {
		props = `[${propsToString(node._props, indent)}]`;
	}
	for (let key of keys) {
		if (key != "_props") {
			let s = `${"  ".repeat(indent)}${key} ${nodeToString(node[key], indent+1)}`;
			children.push(s);
		}
	}

	if (children.length > 0) {
		if (props) props += `\n`
		props += `${children.join("\n")}`;
	} 

	return props;
}

let graphToString = function(graph) {
	assert(graph.nodes);
	assert(graph.arcs);
	let arcstrings = [];
	for (let a of graph.arcs) {
		arcstrings.push(`\n${a[0]} -> ${a[1]}`);
	}
	return `${nodeToString(graph.nodes, 0)}${arcstrings.join("")}`;
}

let deltaToString = function(delta) {
	// { op:"newnode", path:"a", kind:"noise", pos:[10,10] }, 
	let args = [];
	for (let k of Object.keys(delta)) {
		if (k != "op" && k != "path" && k != "paths") {
			args.push(`${k}=${propToString(delta[k])}`);
		}
	}
	let path = delta.path;
	if (!path && delta.paths) {
		path = delta.paths.join(", ");
	}
	return `${delta.op} (${path}) ${args.join(", ")}`
}

let deltasToString = function(deltas, indent) {
	if (indent == undefined) indent = 0
	if (Array.isArray(deltas)) {
		return deltas.map(function(v) {
			return deltasToString(v, indent+1)
		}).join(`\n${"  ".repeat(indent)}`);
	} else {
		return deltaToString(deltas);
	}
}

module.exports = {
	makeGraph: makeGraph,

	graphFromDeltas: graphFromDeltas,
	deltasFromGraph: deltasFromGraph,
	inverseDelta: inverseDelta,
	applyDeltasToGraph: applyDeltasToGraph,

	// utils:
	findPathContainer: findPathContainer,
	graphToString: graphToString,
	deltasToString: deltasToString,

	deepEqual: deepEqual,
	deepCopy: deepCopy,
}