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
const hasShellTrue = (args) =>
  args.some((a) => a.type === 'ObjectExpression' &&
    a.properties.some((p) => p.type === 'Property' && (p.key.name ?? p.key.value) === 'shell' && p.value.type === 'Literal' && p.value.value === true));

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
    const modules = new Set(); // local names bound to the child_process module
    const functions = new Map(); // local name -> child_process function name

    const childProcessFunction = (callee) => {
      if (callee.type === 'Identifier') return functions.get(callee.name);
      if (callee.type !== 'MemberExpression') return undefined;
      const bound = callee.object.type === 'Identifier' && modules.has(callee.object.name);
      return bound || isRequireOfChildProcess(callee.object) ? keyOf(callee) : undefined;
    };
    const report = (node, messageId, data) => context.report({ node, messageId, data });
    // A file with a shebang is an executable run as its own process, not a module the backend loads.
    const ownProcess = context.sourceCode.text.startsWith('#!');

    return {
      VariableDeclarator(node) {
        if (isRequireOfChildProcess(node.init)) {
          if (node.id.type === 'Identifier') modules.add(node.id.name);
          if (node.id.type === 'ObjectPattern') {
            for (const p of node.id.properties) {
              if (p.type === 'Property' && p.value.type === 'Identifier') functions.set(p.value.name, p.key.name ?? p.key.value);
            }
          }
        } else if (node.init?.type === 'MemberExpression' && isRequireOfChildProcess(node.init.object) && node.id.type === 'Identifier') {
          functions.set(node.id.name, keyOf(node.init));
        }
      },
      ImportDeclaration(node) {
        if (!CHILD_PROCESS.has(node.source.value)) return;
        for (const s of node.specifiers) {
          if (s.type === 'ImportSpecifier') functions.set(s.local.name, s.imported.name);
          else modules.add(s.local.name);
        }
      },
      CallExpression(node) {
        const name = childProcessFunction(node.callee);
        if (SYNC.has(name)) return report(node, 'G2.js.sync-exec', { name });
        if (name === 'exec' || (SHELL_OPTION.has(name) && hasShellTrue(node.arguments))) return report(node, 'G2.js.shell', { name });
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
