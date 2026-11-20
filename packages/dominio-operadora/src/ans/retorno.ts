// O retorno da ANS sobre um envio (M56, etapa 7, F6): o resultado de cada item (aceito ou rejeitado, com o erro), o CCO
// do beneficiário incluído no SIB e a situação final do envio. Fora de produção, o simulador aceita tudo e dá um CCO
// sintético; em produção, o responsável registra o que a ANS devolveu (o item não citado fica aceito, salvo o arquivo
// inteiro rejeitado). No ressarcimento ao SUS, o item aceito é a impugnação deferida (nada a pagar por ele).
import type { ItemRetornoAns, ObrigacaoAns, SituacaoEnvioAns } from '@sgh/contratos';
import type { DestinoEnvioAns } from './envio.js';
import { ccoSimulado } from './sib.js';

export interface ItemEnviadoAns {
  readonly id: number;
  readonly ordem: number;
  /** Movimento do SIB (`inclusao`, ...) ou o tipo do item nas outras obrigações. */
  readonly tipo: string;
  readonly beneficiario: number | null;
}

export interface ResultadoItem {
  readonly id: number;
  readonly aceito: boolean;
  readonly cco: string | null;
  readonly erro: string | null;
}

export type RetornoCalculado =
  | { readonly problemas: readonly string[] }
  | {
      readonly problemas: readonly [];
      readonly situacao: SituacaoEnvioAns;
      readonly itens: readonly ResultadoItem[];
    };

export function resultadoDoRetorno(
  obrigacao: ObrigacaoAns,
  destino: DestinoEnvioAns,
  itens: readonly ItemEnviadoAns[],
  entrada: {
    readonly simular?: boolean | undefined;
    readonly rejeitado?: boolean | undefined;
    readonly itens?: readonly ItemRetornoAns[] | undefined;
  },
): RetornoCalculado {
  if (entrada.simular && destino === 'ans') return { problemas: ['simular-so-fora-de-producao'] };
  if (entrada.rejeitado)
    return {
      problemas: [],
      situacao: 'rejeitado',
      itens: itens.map((i) => ({ id: i.id, aceito: false, cco: null, erro: null })),
    };
  const informados = new Map<number, ItemRetornoAns>();
  for (const r of entrada.simular ? [] : (entrada.itens ?? [])) informados.set(r.ordem, r);
  const ordens = new Set(itens.map((i) => i.ordem));
  if ([...informados.keys()].some((o) => !ordens.has(o))) return { problemas: ['item-de-outro-envio'] };
  const r: ResultadoItem[] = [];
  for (const i of itens) {
    const x = informados.get(i.ordem);
    const aceito = x ? x.aceito : true;
    let cco = x?.cco ?? null;
    if (obrigacao === 'SIB' && aceito && i.tipo === 'inclusao' && !cco) {
      if (destino === 'simulador' && i.beneficiario !== null) cco = ccoSimulado(i.beneficiario);
      else return { problemas: ['cco-obrigatorio'] };
    }
    r.push({ id: i.id, aceito, cco: aceito ? cco : null, erro: aceito ? null : (x?.erro ?? null) });
  }
  const aceitos = r.filter((x) => x.aceito).length;
  const situacao: SituacaoEnvioAns =
    aceitos === r.length ? 'aceito' : aceitos === 0 ? 'rejeitado' : 'aceitoParcial';
  return { problemas: [], situacao, itens: r };
}
