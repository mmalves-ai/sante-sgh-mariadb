// Partida da ferramenta: .env.sante do repositório e o núcleo do legado com o driver nativo, só leitura
// (mesmo modelo de tools/schema-check/src/comum.ts; as ferramentas não importam umas às outras).
import { resolve } from 'node:path';
import {
  NucleoLegado,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  lerCodigos,
  lerConfiguracaoNucleo,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';

export const raiz = resolve(import.meta.dirname, '../../..');

export function opcoesDe(argv: readonly string[]): Record<string, string> {
  const opcoes: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--([a-z][a-z0-9-]*)=(.*)$/.exec(a);
    if (m?.[1] && m[2] !== undefined) opcoes[m[1]] = m[2];
  }
  return opcoes;
}

export function criarNucleo(): { nucleo: NucleoLegado; codigos: string[] } {
  const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
  const nucleo = new NucleoLegado({
    env,
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
    aviso: (msg, campos) => console.warn(`[aviso] ${msg} ${JSON.stringify(campos)}`),
  });
  return { nucleo, codigos: lerCodigos(env) };
}

/** `--hospital=<cod>` (um só) dentro de ESTABELECIMENTOS. */
export function escolherCodigo(pedido: string | undefined, configurados: readonly string[]): string {
  if (!pedido || pedido === 'todos') throw new Error('Informe --hospital=<código> (um estabelecimento).');
  if (!configurados.includes(pedido)) {
    throw new Error(
      `Estabelecimento "${pedido}" não está em ESTABELECIMENTOS (${configurados.join(', ') || 'nenhum'}).`,
    );
  }
  return pedido;
}
