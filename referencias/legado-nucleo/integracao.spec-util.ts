// Partida dos testes de integração do núcleo sobre a cópia descartável (./pnpm testes:integracao).
// Só AMBIENTE=dev, host em loopback e nunca uma porta de outro projeto (3050 = sante-firebird).
// Saída dos testes: contagens, estados e marcadores; nenhum valor de linha.
import { resolve } from 'node:path';
import { ambienteEfetivo, caminhoArquivoAmbiente } from './arquivo-ambiente.js';
import { lerConfiguracaoNucleo } from './configuracao.js';
import { criarDriverNativo } from './driver-nativo.js';
import { lerEstabelecimentos } from './estabelecimentos.js';
import { NucleoLegado } from './legado.js';
import { PORTAS_OCUPADAS } from './trava-saidas.js';

export const raiz = resolve(import.meta.dirname, '../../../..');
export const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
export const estabelecimentos = lerEstabelecimentos(env);
export const codigos = estabelecimentos.map((e) => e.codigo);

export function conferirAlvos(): void {
  if ((env['AMBIENTE']?.trim() || 'dev') !== 'dev') throw new Error('Integração só em AMBIENTE=dev.');
  for (const e of estabelecimentos) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(e.host))
      throw new Error(`${e.codigo}: host fora do loopback.`);
    if (PORTAS_OCUPADAS.includes(e.porta))
      throw new Error(`${e.codigo}: porta de outro projeto (nunca o sante-firebird).`);
  }
}

export function criarNucleoIntegracao(extra: Record<string, string> = {}): NucleoLegado {
  conferirAlvos();
  const e = { ...env, ...extra };
  return new NucleoLegado({
    env: e,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(e).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
}

export const contexto = (hospital: string, rede: string) => ({ rede, hospital, traceId: 'integracao' });
