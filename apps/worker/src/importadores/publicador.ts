// Publicador das cargas de catálogo aprovadas (ficha do M13, seção 5 e regra 6; cap-10 §10.11): a cada ciclo,
// por estabelecimento, as cargas aprovadas ou em publicação recebem o lote seguinte ao último confirmado, pelo
// executor do M04 (a operação do catálogo, uma transação curta por lote), só dentro da janela fora do pico. O
// lote confirmado fica em SGH_CAT_CARGA na mesma transação do lote: depois de uma falha ou de uma parada, a
// publicação retoma pelo lote seguinte, sem repetir nem pular. Cancelada entre lotes, para. Lote recusado
// (responsável, contrato, colisão com outro sistema): a carga fica "falhou" com o motivo, e nada do lote é gravado.
// O worker não baixa nada da internet: o arquivo foi enviado pela tela e está na área de preparação.
// Carga aprovada numa sessão "como" (ADR 0021; marca em SGH_CAT_CARGA, script 0141): cada lote e a marcação de
// falha rodam marcados como a sessão, com o aprovador como alvo: a imagem antes/depois vai à SGH_SUP_IMAGEM na
// transação do lote, e a SGH_TRILHA leva o ator real na ORIGEM.
import { definicaoCatalogo, type ItemLoteCatalogo, type LoteCatalogo } from '@sgh/contratos';
import { camposDaChave, dentroDaJanela, type JanelaPublicacao, proximoLote } from '@sgh/dominio-catalogo';
import {
  type CargaCatalogoLida,
  cargasAPublicar,
  type ContextoOperacao,
  ErroOperacao,
  type Escritor,
  executarComo,
  type Executor,
  itensDoLoteCatalogo,
  type Leitor,
  lerCargaCatalogo,
  mudarSituacaoCargaCatalogo,
  operacao,
} from '@sgh/legado';

export interface DependenciasPublicador {
  readonly rede: string;
  readonly hospital: string;
  readonly executor: Executor;
  ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T>;
  gravarSgh<T>(fn: (e: Escritor) => Promise<T>): Promise<T>;
  readonly janela: JanelaPublicacao;
  /** Minutos desde a meia-noite no relógio do estabelecimento. */
  agoraMinutos(): number;
  /** Fora de produção, a janela pode ser ignorada (CATALOGO_PUBLICAR_FORA_DA_JANELA=sim). */
  readonly ignorarJanela: boolean;
  /** Lotes por carga em cada ciclo (transações curtas, uma depois da outra). */
  readonly lotesPorCiclo: number;
  /** Teste e integração: o escritor da transação desfeita (senão, cada lote confirma). */
  readonly escritor?: Escritor;
  readonly log?: (msg: string, c: Record<string, unknown>) => void;
}

export interface ResultadoCiclo {
  readonly carga: number;
  readonly lotes: number;
  readonly situacao: 'publicando' | 'publicada' | 'falhou' | 'aguardando-janela' | 'parada';
  readonly motivo: string | null;
}

/** Item do lote a partir da linha da área de preparação. */
export function itemDaLinha(l: {
  readonly entidade: string;
  readonly chave: string;
  readonly comparacao: string | null;
  readonly antes: Readonly<Record<string, string | number | null>> | null;
  readonly depois: Readonly<Record<string, string | number | null>> | null;
}): ItemLoteCatalogo {
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
function comoDaCarga<T>(c: CargaCatalogoLida, fn: () => Promise<T>): Promise<T> {
  const m = c.como;
  if (!m || !c.aprovador) return fn();
  return executarComo(
    { sessao: m.sessao, acao: m.acao, atorTipo: m.atorTipo, idConta: m.idConta, alvo: c.aprovador },
    fn,
  );
}

async function marcarFalha(d: DependenciasPublicador, c: CargaCatalogoLida, motivo: string): Promise<void> {
  const atual = await d.ler((l) => lerCargaCatalogo(l, d.hospital, c.id));
  if (!atual || !['aprovada', 'publicando'].includes(atual.situacao)) return;
  const f = (e: Escritor) =>
    mudarSituacaoCargaCatalogo(
      e,
      {
        hospital: d.hospital,
        id: c.id,
        versao: atual.versao,
        de: ['aprovada', 'publicando'],
        para: 'falhou',
        aprovador: null,
        motivo,
      },
      {
        rede: d.rede,
        hospital: d.hospital,
        usuario: atual.aprovador ?? 'SGH.WORKER',
        evento: 'catalogo.carga.rejeitada',
        recurso: 'catalogo.carga',
        operacao: 'catalogo.carga.falhou',
        chaveNaturalAlvo: `CARGA:${c.id}`,
        resultado: 'falha',
        estacao: 'WORKER:publicador',
        correlacao: `catalogo-${c.id}`,
      },
    );
  await comoDaCarga(atual, () => (d.escritor ? f(d.escritor) : d.gravarSgh(f)));
}

/** Publica até `lotesPorCiclo` lotes da carga (um por transação). */
export async function publicarCarga(
  d: DependenciasPublicador,
  c: CargaCatalogoLida,
): Promise<ResultadoCiclo> {
  const def = definicaoCatalogo(c.catalogo);
  if (!def) return { carga: c.id, lotes: 0, situacao: 'parada', motivo: 'catálogo desconhecido' };
  if (!d.ignorarJanela && !dentroDaJanela(d.janela, d.agoraMinutos()))
    return { carga: c.id, lotes: 0, situacao: 'aguardando-janela', motivo: null };
  let feitos = 0;
  for (let n = 0; n < d.lotesPorCiclo; n++) {
    // Relida a cada lote: cancelada entre lotes, para.
    const atual = n === 0 ? c : await d.ler((l) => lerCargaCatalogo(l, d.hospital, c.id));
    if (!atual || !['aprovada', 'publicando'].includes(atual.situacao))
      return {
        carga: c.id,
        lotes: feitos,
        situacao: atual?.situacao === 'publicada' ? 'publicada' : 'parada',
        motivo: null,
      };
    const lote = proximoLote(atual.lotes.total, atual.lotes.publicados);
    if (lote === null) return { carga: c.id, lotes: feitos, situacao: 'publicada', motivo: null };
    const linhas = await d.ler((l) => itensDoLoteCatalogo(l, c.id, lote));
    const entrada: LoteCatalogo = {
      carga: c.id,
      lote,
      lotes: atual.lotes.total,
      edicao: atual.edicao,
      sha256: atual.sha256,
      itens: linhas.map(itemDaLinha),
    };
    const ctx: ContextoOperacao = {
      rede: d.rede,
      hospital: d.hospital,
      traceId: `catalogo-${c.id}-lote-${lote}`.slice(0, 64),
      usuarioLegado: atual.aprovador ?? atual.responsavel,
      idempotencyKey: `catalogo-${c.id}-lote-${lote}-de-${atual.lotes.total}`,
      estacao: 'WORKER:publicador',
    };
    try {
      await comoDaCarga(atual, () =>
        d.executor.executar(
          operacao(def.operacao),
          d.hospital,
          entrada,
          ctx,
          d.escritor ? { escritor: d.escritor } : {},
        ),
      );
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
      await marcarFalha(d, c, motivo.slice(0, 200));
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
  const cargas = await d.ler((l) => cargasAPublicar(l, d.hospital));
  const r: ResultadoCiclo[] = [];
  for (const c of cargas) r.push(await publicarCarga(d, c));
  return r;
}
