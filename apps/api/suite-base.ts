// A suíte padrão da API é a do código migrado. F2-L: os specs do fecho do login (tsconfig.login.json, que é também o
// portão de tipos). F2.2/F2.3: mais os do fecho cumulativo (tsconfig.migrado.json), onde cada lote põe todos os seus
// arquivos, specs inclusive. É por arquivo, não por pasta: um módulo registrado pode ter specs de um lote de onda
// seguinte ainda por migrar (ex.: os specs da configuração do lote 02-02), e esses não entram até o lote fechar. O resto
// do código trazido fica fora do boot por configuração (API_MODULOS) e, igualmente, fora desta suíte: roda pelo projeto
// "api-pendente" (vitest.pendente.config.ts), que mede a migração e não é portão.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Os arquivos de um tsconfig de fecho ([] se ainda não existe). */
const arquivos = (nome: string): string[] => {
  const p = resolve(import.meta.dirname, nome);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as { files: string[] }).files : [];
};

/** Fecho do login mais o fecho cumulativo da F2.2/F2.3 (módulos migrados, ligados ou não). */
const fecho = [...new Set([...arquivos('tsconfig.login.json'), ...arquivos('tsconfig.migrado.json')])];

/** Os specs de unidade do fecho (os de integração rodam por vitest.integracao.config.ts). */
export const SPECS_FECHO = fecho.filter((f) => f.endsWith('.spec.ts') && !f.endsWith('.int.spec.ts'));

export const SUITE_BASE = [...SPECS_FECHO];

/** Fora de qualquer suíte de unidade: integração, referência do boot antigo e dependências. */
export const FORA = ['src/**/*.int.spec.ts', '**/node_modules/**'];
