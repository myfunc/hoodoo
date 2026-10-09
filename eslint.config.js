import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';

/** Numbers that read as themselves: identity, halves, signs. */
const PLAIN_NUMBERS = new Set([-1, 0, 0.5, 1, 2, 3, 4]);
const HEX_COLOUR = /^#[0-9a-f]{3,8}$/i;
const FUNCTION_NODES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** Canon C2: tuning numbers and colours live in top-level tables, never inside a function body. */
const noLiteralsInFunctions = {
  meta: { type: 'problem', messages: { literal: 'Move {{value}} into a named constant (C2).' } },
  create(context) {
    const insideFunction = (node) => {
      for (let p = node.parent; p; p = p.parent) if (FUNCTION_NODES.has(p.type)) return true;
      return false;
    };
    const signed = (node) => (node.parent.type === 'UnaryExpression' && node.parent.operator === '-' ? -node.value : node.value);
    return {
      Literal(node) {
        const isNumber = typeof node.value === 'number';
        const isColour = typeof node.value === 'string' && HEX_COLOUR.test(node.value);
        if (!isNumber && !isColour) return;
        if (isNumber && PLAIN_NUMBERS.has(signed(node))) return;
        // Array indices (m[10]) are positions, not tuning.
        if (isNumber && node.parent.type === 'MemberExpression' && node.parent.computed && node.parent.property === node) return;
        if (!insideFunction(node)) return;
        context.report({ node, messageId: 'literal', data: { value: String(node.raw) } });
      },
    };
  },
};

/** Layers: App → Input/UI → Render/IO → World → Assets → Model → Core. Nothing reaches up. */
const UPPER = ['./src/render', './src/ui', './src/input', './src/io', './src/app'];
const LAYERS = [
  { target: './src/core', from: ['./src/model', './src/world', './src/assets', ...UPPER] },
  { target: './src/model', from: ['./src/world', './src/assets', ...UPPER] },
  { target: './src/assets', from: ['./src/world', ...UPPER] },
  { target: './src/world', from: UPPER },
  { target: './src/io', from: ['./src/render', './src/ui', './src/input', './src/app'] },
  { target: './src/render', from: ['./src/ui', './src/input', './src/io', './src/app'] },
  { target: './src/input', from: ['./src/ui', './src/io', './src/app'] },
  { target: './src/ui', from: ['./src/app'] },
];

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.base],
    plugins: { 'import-x': importX, canon: { rules: { 'no-literals-in-functions': noLiteralsInFunctions } } },
    settings: { 'import-x/resolver': { node: { extensions: ['.ts'] } } },
    rules: {
      'import-x/no-cycle': ['error', { ignoreExternal: true }],
      'import-x/no-restricted-paths': ['error', { zones: LAYERS }],
      'canon/no-literals-in-functions': 'error',
      'no-empty': 'error',
    },
  },
  {
    files: ['src/**/__tests__/**/*.ts'],
    rules: { 'canon/no-literals-in-functions': 'off' },
  },
);
