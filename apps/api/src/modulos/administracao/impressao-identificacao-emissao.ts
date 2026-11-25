// A emissão da pulseira e da etiqueta do paciente passa por aqui (01-ADM L79): antes de mandar à fila da estação, a
// regra confere se é 1ª impressão ou reimpressão (que só sai com o motivo do catálogo); depois de mandar, grava a
// impressão (via 1) ou a reimpressão (registro com motivo, via, estação e impressora). O mesmo pedido repetido
// (a fila devolve "já estava") não grava de novo. Sem banco próprio (sessão sintética), a emissão segue como era.
import { randomUUID } from 'node:crypto';
import type { TipoIdentificacao } from '@sgh/dominio-documento';
import { problema } from './comum.js';
import type { ImpressaoIdentificacaoPropria } from './impressao-identificacao-propria.js';

export const IMPRESSAO_IDENTIFICACAO = Symbol('IMPRESSAO_IDENTIFICACAO');

export interface IdentificacaoDoImpresso {
  readonly via: number;
  readonly reimpressao: boolean;
  /** Nome da impressora resolvida pela estação (nulo: nenhuma configurada; sai na fila da estação). */
  readonly impressora: string | null;
}

/** O tipo da identificação do impresso (nulo: ficha e demais impressos, que não passam por este controle). */
export function tipoDaIdentificacao(impresso: string): TipoIdentificacao | null {
  if (impresso === 'pulseira') return 'pulseira';
  return impresso === 'etiqueta' || impresso.startsWith('etiqueta-') ? 'etiqueta' : null;
}

interface SessaoDoImpresso {
  readonly hospital: string;
  readonly login: string;
  readonly req: { readonly ip?: string; readonly headers: Record<string, string | string[] | undefined> };
}

export async function emitirComIdentificacao<G extends { fila: { novo: boolean } | null }>(
  porta: ImpressaoIdentificacaoPropria | null,
  s: SessaoDoImpresso,
  alvo: { readonly atendimento: number } | { readonly internacao: number },
  pedido: {
    readonly impresso: string;
    readonly formato: 'zpl' | 'pdf';
    readonly copias: number;
    readonly motivo?: number | undefined;
    readonly complemento?: string | undefined;
    readonly estacao?: number | undefined;
  },
  emitir: () => Promise<G>,
): Promise<G & { identificacao: IdentificacaoDoImpresso | null }> {
  const tipo = tipoDaIdentificacao(pedido.impresso);
  if (!porta || !tipo) return { ...(await emitir()), identificacao: null };
  const ip = s.req.ip ? String(s.req.ip) : undefined;
  const c = { hospital: s.hospital, login: s.login, ...(ip ? { enderecoIp: ip } : {}) };
  const entrada = {
    ...alvo,
    tipo,
    ...(pedido.motivo !== undefined ? { motivo: pedido.motivo } : {}),
    ...(pedido.complemento ? { complemento: pedido.complemento } : {}),
    ...(pedido.estacao !== undefined ? { estacao: pedido.estacao } : {}),
    quantidade: pedido.copias,
    destino: pedido.formato === 'pdf' ? ('pdf' as const) : ('impressora' as const),
  };
  const previa = await porta.conferir(c, entrada).catch((x: unknown) => problema(x));
  const gerado = await emitir();
  const bruto = s.req.headers['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  const d =
    gerado.fila && !gerado.fila.novo
      ? previa
      : await porta
          .registrar(
            {
              ...c,
              correlacao: 'impressao-identificacao',
              chaveIdempotencia: `${typeof chave === 'string' && chave.length >= 8 ? chave : randomUUID()}:ident`,
            },
            entrada,
          )
          .catch((x: unknown) => problema(x));
  return {
    ...gerado,
    identificacao: { via: d.via, reimpressao: d.reimpressao, impressora: d.impressora?.nome ?? null },
  };
}
