// Banco de desenvolvimento para as ferramentas de leitura (indicadores:controle, datamart:carregar,
// faturamento:reproduzir, contas:inventario, guardas de privilégio, k6): o MariaDB do produto pelo @sgh/nucleo, só em
// AMBIENTE=dev, só em loopback e nunca num endereço de outro projeto. Toda leitura em transação READ ONLY
// (nucleo.lerSomente). Quem abre encerra o núcleo. A leitura do sistema de origem é só do conector (regra 3).
// Melhoria: o cliente vem de --cliente= ou de SGH_CLIENTE_LEITURA, nunca fixo no código.
// Melhoria: a carga recebe o id do estabelecimento resolvido pelo código (isolamento entre estabelecimentos do cliente).
// Melhoria: a trava confere o host e a porta do MariaDB configurado contra os endereços ocupados da VM.
import { resolve } from 'node:path';
import {
  type Ambiente,
  NucleoProprio,
  ambienteDe,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  ehLoopback,
  lerConfiguracaoNucleo,
} from '@sgh/nucleo';
import type { NucleoDaCarga } from './datamart-carga.ts';
import { ENDERECOS_OCUPADOS, PORTAS_OCUPADAS } from './portas-ocupadas.ts';

const raiz = resolve(import.meta.dirname, '../../..');
const FORMATO_CLIENTE = /^[a-z][a-z0-9_]{1,39}$/;

/** O ambiente efetivo do repositório (.env da raiz sobre o processo); valores nunca impressos. */
export function ambienteDoRepositorio(): Record<string, string | undefined> {
  return ambienteEfetivo(process.env, caminhoArquivoAmbiente(process.env, raiz)).env;
}

/** Motivo da recusa do banco de dev (null: pode ler). Só nomes e regras na mensagem, nunca valores. */
export function motivoRecusaBancoDev(env: Ambiente): string | null {
  if (ambienteDe(env) !== 'dev') return 'a leitura do banco de desenvolvimento roda só em AMBIENTE=dev';
  let host: string;
  let porta: number;
  try {
    ({ host, porta } = lerConfiguracaoNucleo(env));
  } catch (e) {
    return `configuração do banco inválida (${e instanceof Error ? e.name : 'erro'})`;
  }
  if (!ehLoopback(host)) return 'o banco configurado não está em loopback';
  if (PORTAS_OCUPADAS.includes(porta) || ENDERECOS_OCUPADOS.includes(`${host.trim()}:${porta}`))
    return 'o banco configurado está num endereço de outro projeto';
  return null;
}

/** O cliente pedido (--cliente=<código> ou SGH_CLIENTE_LEITURA), conferido; null se não informado. */
export function clienteDaLeitura(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const v = (argv.find((a) => a.startsWith('--cliente='))?.slice(10) ?? env['SGH_CLIENTE_LEITURA'] ?? '').trim();
  if (!v) return null;
  if (!FORMATO_CLIENTE.test(v)) throw new Error('--cliente: código em minúsculas, de 2 a 40 caracteres.');
  return v;
}

export interface BancoDev {
  readonly nucleo: NucleoProprio;
  readonly cliente: string;
}

/** Abre o núcleo sobre o banco de dev do cliente (recusa fora de dev ou fora do loopback). */
export function abrirBancoDev(cliente: string, env: Ambiente = ambienteDoRepositorio()): BancoDev {
  const motivo = motivoRecusaBancoDev(env);
  if (motivo) throw new Error(`Recusado: ${motivo}.`);
  if (!FORMATO_CLIENTE.test(cliente)) throw new Error('Código de cliente inválido.');
  return { nucleo: new NucleoProprio({ env }), cliente };
}

/** Nome antigo, mantido para as ferramentas que ainda o importam. */
export const abrirNucleoCopia = abrirBancoDev;

/** Códigos dos estabelecimentos do cliente (dado do cliente inteiro: sem filtro de estabelecimento). */
export async function codigosDosEstabelecimentos(nucleo: NucleoProprio, cliente: string): Promise<string[]> {
  const r = await nucleo.lerSomente({ cliente, correlacao: 'ferramenta-estabelecimentos' }, (l) =>
    l.consultar<{ codigo: string }>('SELECT codigo FROM estabelecimento ORDER BY codigo'),
  );
  return r.map((x) => String(x.codigo));
}

/**
 * A carga do data mart sobre o núcleo próprio: a "rede" é o cliente e o "hospital" é o código do estabelecimento.
 * Cada leitura é uma transação READ ONLY no banco do cliente (que guarda todos os estabelecimentos): o código é
 * resolvido no id do estabelecimento (não excluído) dentro da mesma transação e entregue à leitura, que filtra por ele.
 * Código desconhecido: recusa (a liberação trata a recusa como desligada).
 */
export function nucleoDaCarga(nucleo: NucleoProprio, cliente: string): NucleoDaCarga {
  return {
    rede: cliente,
    lerSomente: (c, fn) =>
      nucleo.lerSomente({ cliente, correlacao: c.traceId }, async (l) => {
        const est = await l.uma<{ id: number | string }>(
          'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
          [c.hospital],
        );
        if (!est) throw new Error(`${c.hospital}: estabelecimento não encontrado no cliente.`);
        return fn(l, Number(est.id));
      }),
  };
}
