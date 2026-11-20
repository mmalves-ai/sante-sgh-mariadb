// ESLint (configuração plana) da raiz, com as fronteiras do monorepo (convencoes.md §3).
import nx from '@nx/eslint-plugin';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

// Só @sgh/legado conhece o driver Firebird.
const driversFirebird = ['node-firebird', 'node-firebird-*', 'node-firebird-driver*'];
// Biblioteca de componentes de base só dentro de @sgh/ui (DP-51: as telas nunca a importam direto).
const bibliotecaDeComponentes = [
  'primevue',
  'primevue/*',
  '@primeuix/*',
  'openvue',
  'openvue/*',
  '@openvue/*',
];
// Regras puras (dominio-*) sem Nest, banco ou HTTP.
const proibidosNoDominio = [
  ...driversFirebird,
  '@nestjs/*',
  'fastify',
  '@fastify/*',
  'axios',
  'undici',
  'vue',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out-tsc/**',
      '**/node_modules/**',
      '**/*.timestamp-*',
      '**/test-results/**',
      '**/playwright-report/**',
      '.nx/**',
      '.pnpm-store/**',
      '.pnpm-cache/**',
      '.pnpm-state/**',
      '.npm-cache/**',
      '.cache-local/**',
      '.tmp/**',
      '.seguranca/**',
      'planejamento/**',
      'marketing/**',
      'treinamento/**',
      'entrevistas/**',
      'respostas/**',
      'tools/verificadores/seguranca/semgrep/**',
      // Gerados por `pnpm legado:tipos` (não editar).
      'packages/legado/src/tipos/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Só as regras de correção do Vue; a forma do código é do Prettier.
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'], sourceType: 'module' },
    },
  },
  {
    // M07, regra 15: todo texto de tela pelo vue-i18n (nenhum texto cru no template).
    files: ['apps/web/src/**/*.vue', 'packages/ui/src/**/*.vue'],
    rules: {
      'vue/no-bare-strings-in-template': [
        'error',
        {
          allowlist: [
            '(',
            ')',
            ',',
            '.',
            '&',
            '+',
            '-',
            '=',
            '*',
            '/',
            '#',
            '%',
            '!',
            '?',
            ':',
            '[',
            ']',
            '{',
            '}',
            '<',
            '>',
            '·',
            '—',
            '|',
          ],
          attributes: {
            '/.+/': [
              'title',
              'aria-label',
              'aria-placeholder',
              'aria-roledescription',
              'aria-valuetext',
              'placeholder',
              'alt',
              // Props de texto dos componentes próprios e do OpenVue (um rotulo="Nome" cru também é erro).
              'rotulo',
              'titulo',
              'texto',
              'legenda',
              'confirmacao',
              'header',
              'label',
            ],
          },
          directives: ['v-text'],
        },
      ],
    },
  },
  {
    // O TypeScript já confere nomes globais (recomendação do typescript-eslint).
    files: ['**/*.ts', '**/*.vue'],
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['**/*.ts', '**/*.vue', '**/*.js', '**/*.mjs'],
    plugins: { '@nx': nx },
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: false,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'tipo:contratos',
              onlyDependOnLibsWithTags: ['tipo:contratos'],
              bannedExternalImports: proibidosNoDominio,
            },
            {
              sourceTag: 'tipo:dominio',
              onlyDependOnLibsWithTags: ['tipo:contratos'],
              bannedExternalImports: proibidosNoDominio,
            },
            {
              sourceTag: 'tipo:legado',
              onlyDependOnLibsWithTags: ['tipo:contratos'],
            },
            {
              sourceTag: 'tipo:ui',
              onlyDependOnLibsWithTags: ['tipo:contratos'],
              bannedExternalImports: [...driversFirebird, '@nestjs/*'],
            },
            {
              sourceTag: 'tipo:web',
              onlyDependOnLibsWithTags: ['tipo:contratos', 'tipo:ui', 'tipo:dominio'],
              bannedExternalImports: [...driversFirebird, ...bibliotecaDeComponentes, '@nestjs/*', 'pino'],
            },
            {
              sourceTag: 'tipo:api',
              onlyDependOnLibsWithTags: ['tipo:contratos', 'tipo:dominio', 'tipo:legado'],
              bannedExternalImports: driversFirebird,
            },
            {
              sourceTag: 'tipo:worker',
              onlyDependOnLibsWithTags: ['tipo:contratos', 'tipo:dominio', 'tipo:legado'],
              // O worker não abre HTTP (ARQ-1): nada de servidor Nest/Fastify nem cliente/servidor HTTP cru.
              bannedExternalImports: [
                ...driversFirebird,
                '@nestjs/platform-*',
                'fastify',
                '@fastify/*',
                'node:http',
                'node:https',
                'http',
                'https',
              ],
            },
            {
              sourceTag: 'tipo:testes',
              onlyDependOnLibsWithTags: ['tipo:contratos', 'tipo:dominio', 'tipo:legado'],
              bannedExternalImports: driversFirebird,
            },
            {
              sourceTag: 'tipo:ferramenta',
              // M09: as ferramentas de conversão (formularios:converter) usam as regras puras dos domínios.
              // M04: o assinatura:testar monta os cenários com a massa sintética de packages/testes.
              onlyDependOnLibsWithTags: ['tipo:contratos', 'tipo:dominio', 'tipo:legado', 'tipo:testes'],
              bannedExternalImports: driversFirebird,
            },
          ],
        },
      ],
    },
  },
);
