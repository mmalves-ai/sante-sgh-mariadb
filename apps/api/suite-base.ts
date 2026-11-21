// F2-L: a suíte padrão da API é a do boot. Ela tem os specs do fecho do login (os arquivos de tsconfig.login.json,
// que é também o portão de tipos) e os dos módulos registrados em src/modulos/registro.ts (migrados). O resto do
// código trazido fica fora do boot por configuração (API_MODULOS) e, igualmente, fora desta suíte: roda pelo
// projeto "api-pendente" (vitest.pendente.config.ts), que mede a migração e não é portão.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REGISTRO_MODULOS } from './src/modulos/registro.js';

const fecho = (JSON.parse(readFileSync(resolve(import.meta.dirname, 'tsconfig.login.json'), 'utf8')) as {
  files: string[];
}).files;

/** Os specs de unidade do fecho do login (os de integração rodam por vitest.integracao.config.ts). */
export const SPECS_FECHO = fecho.filter((f) => f.endsWith('.spec.ts') && !f.endsWith('.int.spec.ts'));

/** Os specs dos módulos migrados (registrados), por pasta. */
export const SPECS_REGISTRADOS = Object.keys(REGISTRO_MODULOS).map((m) => `src/modulos/${m}/**/*.spec.ts`);

export const SUITE_BASE = [...SPECS_FECHO, ...SPECS_REGISTRADOS];

/** Fora de qualquer suíte de unidade: integração, referência do boot antigo e dependências. */
export const FORA = ['src/**/*.int.spec.ts', '**/node_modules/**'];
