// Stylelint (M07, regra 1): nenhuma cor solta. Toda cor vem de token (variável --sgh-*); hexadecimal, nome
// de cor e funções de cor só em packages/ui/src/tokens/ (que é TypeScript e gera a folha de variáveis).
const corSolta = {
  'color-no-hex': true,
  'color-named': 'never',
  'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color'],
};

export default {
  rules: corSolta,
  overrides: [
    { files: ['**/*.vue', '**/*.html'], customSyntax: 'postcss-html' },
    {
      files: ['packages/ui/src/tokens/**'],
      rules: { 'color-no-hex': null, 'color-named': null, 'function-disallowed-list': null },
    },
  ],
  ignoreFiles: [
    '**/dist/**',
    '**/node_modules/**',
    '**/coverage/**',
    'planejamento/**',
    'marketing/**',
    'entrevistas/**',
  ],
};
