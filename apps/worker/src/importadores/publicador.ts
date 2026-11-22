// Publicador das cargas de catálogo aprovadas (ficha do M13, seção 5 e regra 6; cap-10 §10.11): a cada ciclo,
// por estabelecimento, as cargas aprovadas ou em publicação recebem o lote seguinte ao último confirmado, por uma
// operação do Executor (uma transação curta por lote), só dentro da janela fora do pico. O lote confirmado fica em
// carga_catalogo na mesma transação do lote: depois de uma falha ou de uma parada, a publicação retoma pelo lote
// seguinte, sem repetir nem pular. Cancelada entre lotes, para. Lote recusado (contrato, entidade sem mapa, item que
// mudou depois da comparação, conflito de versão): a carga fica "falhou" com o motivo, e nada do lote é gravado.
// O worker não baixa nada da internet: o arquivo foi enviado pela tela e está na área de preparação.
// Carga aprovada numa sessão "como" (ADR 0021): cada lote e a marcação de falha rodam marcados como a sessão, com o
// aprovador como alvo (a trilha leva o ator real). A porta própria ainda não lê a marca (pedido de DDL do lote 05-13).
// O acesso ao banco é a porta (PortaPublicacaoCatalogo); a própria está em porta-propria.ts.
// Melhoria: o publicador não conhece mais a "responsabilidade" de um sistema externo pelo catálogo: o produto é o
//   único dono dos catálogos (ADR 0003); a recusa por contrato de dados segue a regra do domínio (decidirPublicacao).
import { definicaoCatalogo, type ItemLoteCatalogo, type LoteCatalogo } from '@sgh/contratos';
import { camposDaChave, dentroDaJanela, type JanelaPublicacao, proximoLote } from '@sgh/dominio-catalogo';
import { ErroOperacao, executarComo, type MarcaComo } from '@sgh/nucleo';

export type ValorLinhaCatalogo = string | number | null;

/** A carga como o publicador a vê (vocabulário neutro: ids, datas ISO, contagens). */
export interface CargaAPublicar {
  readonly id: number;
  readonly catalogo: string;
  readonly situacao: string;
  readonly edicao: string | null;
  readonly sha256: string;
  readonly lotes: { readonly total: number; readonly publicados: number };
  readonly versao: number;
  /** Quem aprovou (usuario.id): a publicação grava em nome dele. */
  readonly aprovadorId: number | null;
  /** Login de quem aprovou (alvo da marca "como"). */
  readonly aprovador: string | null;
  /** Sessão "como" em que a carga foi aprovada (null: aprovação normal). */
  readonly como: Omit<MarcaComo, 'alvo'> | null;
}

/** Linha da área de preparação que entra no lote. */
export interface LinhaDoLote {
  readonly entidade: string;
  readonly chave: string;
  readonly comparacao: string | null;
  readonly antes: Readonly<Record<string, ValorLinhaCatalogo>> | null;
  readonly depois: Readonly<Record<string, ValorLinhaCatalogo>> | null;
}

/** O que o publicador pede ao banco de um estabelecimento. */
export interface PortaPublicacaoCatalogo {
  cargasAPublicar(): Promise<readonly CargaAPublicar[]>;
  carga(id: number): Promise<CargaAPublicar | null>;
  itensDoLote(carga: number, lote: number): Promise<readonly LinhaDoLote[]>;
  /** Uma transação: grava os itens nas tabelas do catálogo e confirma o lote na carga (recusa: ErroOperacao). */
  publicarLote(carga: CargaAPublicar, entrada: LoteCatalogo): Promise<void>;
  /** A carga vai a "falhou" com o motivo (só se ainda estiver aprovada ou publicando). */
  marcarFalha(carga: CargaAPublicar, motivo: string): Promise<void>;
}

export interface DependenciasPublicador {
  readonly porta: PortaPublicacaoCatalogo;
  readonly janela: JanelaPublicacao;
  /** Minutos desde a meia-noite no relógio do estabelecimento. */
  agoraMinutos(): number;
  /** Fora de produção, a janela pode ser ignorada (CATALOGO_PUBLICAR_FORA_DA_JANELA=sim). */
  readonly ignorarJanela: boolean;
  /** Lotes por carga em cada ciclo (transações curtas, uma depois da outra). */
  readonly lotesPorCiclo: number;
  readonly log?: (msg: string, c: Record<string, unknown>) => void;
}

export interface ResultadoCiclo {
  readonly carga: number;
  readonly lotes: number;
  readonly situacao: 'publicando' | 'publicada' | 'falhou' | 'aguardando-janela' | 'parada';
  readonly motivo: string | null;
}

const EM_PUBLICACAO = ['aprovada', 'publicando'];

/** Item do lote a partir da linha da área de preparação. */
export function itemDaLinha(l: LinhaDoLote): ItemLoteCatalogo {
  const valores = { ...(l.depois ?? {}) };
  const alterado = l.comparacao === 'alterado' && l.antes;
  return {
    entidade: l.entidade,
    acao: l.comparacao === 'novo' ? 'incluir' : 'alterar',
    chave: camposDaChave(l.chave),
    valores,
    ...(alterado
      ? { antes: Object.fromEntries(Object.keys(valores).map((k) => [k, l.antes?.[k] ?? null])) }
      : {}),
  };
}

/** Roda `fn` marcado como a sessão "como" da aprovação, quando a carga tem a marca. */
function comoDaCarga<T>(c: CargaAPublicar, fn: () => Promise<T>): Promise<T> {
  const m = c.como;
  if (!m || !c.aprovador) return fn();
  return executarComo({ ...m, alvo: c.aprovador }, fn);
}

async function marcarFalha(d: DependenciasPublicador, c: CargaAPublicar, motivo: string): Promise<void> {
  const atual = await d.porta.carga(c.id);
  if (!atual || !EM_PUBLICACAO.includes(atual.situacao)) return;
  await comoDaCarga(atual, () => d.porta.marcarFalha(atual, motivo));
}

/** Publica até `lotesPorCiclo` lotes da carga (um por transação). */
export async function publicarCarga(d: DependenciasPublicador, c: CargaAPublicar): Promise<ResultadoCiclo> {
  const def = definicaoCatalogo(c.catalogo);
  if (!def) return { carga: c.id, lotes: 0, situacao: 'parada', motivo: 'catálogo desconhecido' };
  if (!d.ignorarJanela && !dentroDaJanela(d.janela, d.agoraMinutos()))
    return { carga: c.id, lotes: 0, situacao: 'aguardando-janela', motivo: null };
  let feitos = 0;
  for (let n = 0; n < d.lotesPorCiclo; n++) {
    // Relida a cada lote: cancelada entre lotes, para.
    const atual = n === 0 ? c : await d.porta.carga(c.id);
    if (!atual || !EM_PUBLICACAO.includes(atual.situacao))
      return {
        carga: c.id,
        lotes: feitos,
        situacao: atual?.situacao === 'publicada' ? 'publicada' : 'parada',
        motivo: null,
      };
    const lote = proximoLote(atual.lotes.total, atual.lotes.publicados);
    if (lote === null) return { carga: c.id, lotes: feitos, situacao: 'publicada', motivo: null };
    const linhas = await d.porta.itensDoLote(c.id, lote);
    const entrada: LoteCatalogo = {
      carga: c.id,
      lote,
      lotes: atual.lotes.total,
      edicao: atual.edicao,
      sha256: atual.sha256,
      itens: linhas.map(itemDaLinha),
    };
    try {
      await comoDaCarga(atual, () => d.porta.publicarLote(atual, entrada));
      feitos++;
      d.log?.('lote de catálogo publicado', {
        carga: c.id,
        lote,
        lotes: atual.lotes.total,
        itens: entrada.itens.length,
      });
    } catch (e) {
      const motivo =
        e instanceof ErroOperacao
          ? `Lote ${lote}: ${e.problema.detail ?? e.problema.title} (${e.problema.codigo ?? 'recusa'})`
          : `Lote ${lote}: falha inesperada; a publicação retoma por este lote.`;
      await marcarFalha(d, c, motivo.slice(0, 500));
      d.log?.('lote de catálogo recusado', {
        carga: c.id,
        lote,
        codigo: e instanceof ErroOperacao ? (e.problema.codigo ?? 'recusa') : 'erro',
      });
      return { carga: c.id, lotes: feitos, situacao: 'falhou', motivo };
    }
    if (lote === atual.lotes.total)
      return { carga: c.id, lotes: feitos, situacao: 'publicada', motivo: null };
  }
  return { carga: c.id, lotes: feitos, situacao: 'publicando', motivo: null };
}

/** Ciclo do estabelecimento: as cargas aprovadas ou em publicação, uma depois da outra. */
export async function cicloPublicacao(d: DependenciasPublicador): Promise<ResultadoCiclo[]> {
  const cargas = await d.porta.cargasAPublicar();
  const r: ResultadoCiclo[] = [];
  for (const c of cargas) r.push(await publicarCarga(d, c));
  return r;
}
