// One ESLint rule for every G2 JavaScript check; each messageId is the G2 rule id.
const CHILD_PROCESS = new Set(['child_process', 'node:child_process']);
const SYNC = new Set(['execSync', 'execFileSync', 'spawnSync']);
const SHELL_OPTION = new Set(['spawn', 'execFile']);
const GLOBAL_EVENTS = new Set(['uncaughtException', 'unhandledRejection']);
const LISTEN = new Set(['on', 'once', 'addListener', 'prependListener']);
const ROUTER = new Set(['commandRouter', 'coreCommand']);

const keyOf = (node) => (node.computed ? node.property.value : node.property.name);
const isMember = (node, object, props) =>
  node?.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === object && props.has(keyOf(node));
const isRequireOfChildProcess = (node) =>
  node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' &&
  node.arguments[0]?.type === 'Literal' && CHILD_PROCESS.has(node.arguments[0].value);
const keyName = (key) => key.name ?? key.value;
// shell: true or a shell path runs one; only a literal false (or empty path) is known not to.
const hasShellOption = (args) =>
  args.some((a) => a.type === 'ObjectExpression' &&
    a.properties.some((p) => p.type === 'Property' && keyName(p.key) === 'shell' && (p.value.type !== 'Literal' || Boolean(p.value.value))));

export const rule = {
  meta: {
    type: 'problem',
    messages: {
      'G2.js.sync-exec': '{{name}} blocks the backend while the command runs',
      'G2.js.shell': '{{name}} runs the command through a shell',
      'G2.js.process-exit': 'process.{{name}} stops the whole backend',
      'G2.js.global-handler': "process.{{name}}('{{event}}') changes how the whole backend fails",
      'G2.js.command-router-override': 'replacing commandRouter.{{name}} changes Volumio for every plugin',
      'G2.js.console-log': 'console.log bypasses the Volumio logger',
    },
  },
  create(context) {
    const { sourceCode } = context;
    // Scope analysis runs before traversal: a name resolves to its declaration wherever it is written.
    const variableOf = (identifier) => {
      for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
        const variable = scope.set.get(identifier.name);
        if (variable) return variable;
      }
      return undefined;
    };
    // What a name is bound to: the child_process module ({ module }), one of its functions ({ fn }), or neither.
    const bindingOf = (identifier) => {
      const def = variableOf(identifier)?.defs[0];
      if (def?.type === 'ImportBinding') {
        if (!CHILD_PROCESS.has(def.parent.source.value)) return undefined;
        return def.node.type === 'ImportSpecifier' ? { fn: keyName(def.node.imported) } : { module: true };
      }
      if (def?.type !== 'Variable') return undefined;
      const { id, init } = def.node;
      if (isRequireOfChildProcess(init)) {
        if (id.type === 'Identifier') return { module: true };
        const prop = id.type === 'ObjectPattern' &&
          id.properties.find((p) => p.type === 'Property' && p.value.type === 'Identifier' && p.value.name === identifier.name);
        return prop ? { fn: keyName(prop.key) } : undefined;
      }
      if (init?.type === 'MemberExpression' && isRequireOfChildProcess(init.object) && id.type === 'Identifier') return { fn: keyOf(init) };
      return undefined;
    };
    const childProcessFunction = (callee) => {
      if (callee.type === 'Identifier') return bindingOf(callee)?.fn;
      if (callee.type !== 'MemberExpression') return undefined;
      if (isRequireOfChildProcess(callee.object)) return keyOf(callee);
      return callee.object.type === 'Identifier' && bindingOf(callee.object)?.module ? keyOf(callee) : undefined;
    };
    const report = (node, messageId, data) => context.report({ node, messageId, data });
    // A file with a shebang is an executable run as its own process, not a module the backend loads.
    const ownProcess = context.sourceCode.text.startsWith('#!');

    return {
      CallExpression(node) {
        const name = childProcessFunction(node.callee);
        if (SYNC.has(name)) return report(node, 'G2.js.sync-exec', { name });
        if (name === 'exec' || (SHELL_OPTION.has(name) && hasShellOption(node.arguments))) return report(node, 'G2.js.shell', { name });
        if (!ownProcess && isMember(node.callee, 'process', new Set(['exit', 'abort']))) return report(node, 'G2.js.process-exit', { name: keyOf(node.callee) });
        const event = node.arguments[0]?.value;
        if (!ownProcess && isMember(node.callee, 'process', LISTEN) && GLOBAL_EVENTS.has(event)) {
          return report(node, 'G2.js.global-handler', { name: keyOf(node.callee), event });
        }
        if (isMember(node.callee, 'console', new Set(['log']))) return report(node, 'G2.js.console-log');
        return undefined;
      },
      AssignmentExpression(node) {
        const target = node.left;
        if (target.type === 'MemberExpression' && target.object.type === 'MemberExpression' && ROUTER.has(keyOf(target.object))) {
          report(node, 'G2.js.command-router-override', { name: keyOf(target) });
        }
      },
    };
  },
};
