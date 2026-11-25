// Publicação do fato contábil na transação do documento (ADR 0003): o módulo que grava o documento com efeito contábil
// chama `publicarFatos` dentro da própria operação do Executor (declarando TABELAS_PUBLICACAO_FATO); o estorno do
// documento chama `estornarFatosDaOrigem`. A regra (catálogo, competência, valor, forma canônica, quem estornar) é do
// @sgh/dominio-contabil; aqui só a leitura e a gravação. O fato nasce `pendente` e a contabilização (worker ou tela de
// reprocessamento) aplica a regra publicada do tipo. Idempotente: o mesmo efeito (mesma impressão) não duplica.
import { createHash } from 'node:crypto';
import { TIPOS_FATO, type TipoFato, type ValorCampoFato } from '@sgh/contratos';
import {
  estornosDosFatos,
  fatoParaPublicar,
  type FatoParaPublicar,
  type FatoPublicadoLido,
} from '@sgh/dominio-contabil';
import type { TxOperacao } from '@sgh/nucleo';

/** Tabelas que a operação do documento declara para publicar o fato (o evento nativo nasce na primeira vez). */
export const TABELAS_PUBLICACAO_FATO = ['fato_contabil', 'evento_contabil'] as const;

const MODULO_DO_TIPO: Readonly<Record<number, string>> = {
  1: 'financeiro',
  3: 'faturamento',
  7: 'patrimonio',
  8: 'folha',
  9: 'estoque',
  10: 'financeiro',
  12: 'repasse',
};

const resumo = (s: string) => createHash('sha256').update(s).digest('hex');

async function eventoDoTipo(tx: TxOperacao, tipo: TipoFato): Promise<number> {
  const e = await tx.uma('SELECT id FROM evento_contabil WHERE codigo = ?', [tipo]);
  if (e) return Number(e['id']);
  const def = TIPOS_FATO[tipo];
  return tx.incluir('evento_contabil', {
    codigo: tipo,
    descricao: def.rotulo,
    modulo: MODULO_DO_TIPO[def.origem] ?? 'contabilidade',
    nativo: true,
  });
}

export interface ResultadoPublicacao {
  /** Ids dos fatos gravados agora (o repetido não entra). */
  readonly gravados: number[];
  readonly repetidos: number;
  /** Documentos sem efeito contábil (valor zero). */
  readonly semEfeito: number;
}

/** Publica os fatos do documento na transação da operação. */
export async function publicarFatos(
  tx: TxOperacao,
  estabelecimento: number,
  fatos: readonly FatoParaPublicar[],
): Promise<ResultadoPublicacao> {
  const gravados: number[] = [];
  let repetidos = 0;
  let semEfeito = 0;
  const eventos = new Map<TipoFato, number>();
  for (const f of fatos) {
    const l = fatoParaPublicar(f);
    if (!l) {
      semEfeito += 1;
      continue;
    }
    let evento = eventos.get(l.tipo);
    if (evento === undefined) {
      evento = await eventoDoTipo(tx, l.tipo);
      eventos.set(l.tipo, evento);
    }
    // O mesmo efeito já publicado e vivo é repetição; publicado e estornado (conta reaberta e fechada de novo com o
    // mesmo total) é reemissão: a impressão ganha o número da reemissão (a chave única não deixa repetir a anterior).
    let impressao = resumo(l.conteudo);
    let repetido = false;
    for (let k = 1; ; k++) {
      const ja = await tx.uma(
        `SELECT f.id,
                (SELECT COUNT(*) FROM fato_contabil e WHERE e.estornado_fato_contabil_id = f.id AND e.excluido_em IS NULL)
                  AS estornos
           FROM fato_contabil f
          WHERE f.entidade_origem = ? AND f.entidade_origem_id = ? AND f.evento_contabil_id = ? AND f.impressao = ?`,
        [l.entidade, l.entidadeId, evento, impressao],
      );
      if (!ja) break;
      if (Number(ja['estornos']) === 0) {
        repetido = true;
        break;
      }
      impressao = resumo(`${l.conteudo}|reemissao:${k}`);
    }
    if (repetido) {
      repetidos += 1;
      continue;
    }
    gravados.push(
      await tx.incluir('fato_contabil', {
        estabelecimento_id: estabelecimento,
        evento_contabil_id: evento,
        entidade_origem: l.entidade,
        entidade_origem_id: l.entidadeId,
        data_fato: l.data,
        competencia: l.competencia,
        valor: l.valor,
        centro_custo_id: l.centroCusto,
        documento: l.documento,
        campos: JSON.stringify(l.campos),
        impressao,
        estorno: false,
        situacao: 'pendente',
        origem: 'sistema',
      }),
    );
  }
  return { gravados, repetidos, semEfeito };
}

const dataIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

function camposDe(v: unknown): Readonly<Record<string, ValorCampoFato>> {
  if (v === null || v === undefined) return {};
  const o = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return o && typeof o === 'object' ? (o as Record<string, ValorCampoFato>) : {};
}

/**
 * Estorna os fatos publicados pelas linhas do documento estornado: um fato de estorno por fato original ainda sem
 * estorno, na data do estorno, apontando para o original (que fica). Devolve os ids dos estornos gravados.
 */
export async function estornarFatosDaOrigem(
  tx: TxOperacao,
  estabelecimento: number,
  entidade: string,
  ids: readonly number[],
  dataEstorno: string,
  motivo: string,
): Promise<number[]> {
  if (ids.length === 0) return [];
  const marcas = ids.map(() => '?').join(',');
  const linhas = await tx.consultar(
    `SELECT f.id, f.evento_contabil_id, f.entidade_origem_id, ev.codigo, f.data_fato, f.valor, f.centro_custo_id,
            f.campos, f.estorno,
            (SELECT COUNT(*) FROM fato_contabil e WHERE e.estornado_fato_contabil_id = f.id AND e.excluido_em IS NULL)
              AS estornos
       FROM fato_contabil f JOIN evento_contabil ev ON ev.id = f.evento_contabil_id
      WHERE f.estabelecimento_id = ? AND f.entidade_origem = ? AND f.entidade_origem_id IN (${marcas})
        AND f.excluido_em IS NULL
      ORDER BY f.id`,
    [estabelecimento, entidade, ...ids],
  );
  const porId = new Map(linhas.map((r) => [Number(r['id']), r]));
  const lidos: FatoPublicadoLido[] = linhas.map((r) => ({
    id: Number(r['id']),
    tipo: String(r['codigo']),
    data: dataIso(r['data_fato']),
    valor: String(r['valor']),
    centroCusto: r['centro_custo_id'] === null ? null : Number(r['centro_custo_id']),
    campos: camposDe(r['campos']),
    estorno: Boolean(Number(r['estorno'])),
    estornado: Number(r['estornos']) > 0,
  }));
  const gravados: number[] = [];
  for (const e of estornosDosFatos(lidos, dataEstorno, motivo)) {
    const o = porId.get(e.fatoId)!;
    gravados.push(
      await tx.incluir('fato_contabil', {
        estabelecimento_id: estabelecimento,
        evento_contabil_id: Number(o['evento_contabil_id']),
        entidade_origem: entidade,
        entidade_origem_id: Number(o['entidade_origem_id']),
        data_fato: e.data,
        competencia: e.competencia,
        valor: e.valor,
        centro_custo_id: e.centroCusto,
        documento: e.documento,
        campos: JSON.stringify(e.campos),
        impressao: resumo(e.conteudo),
        estorno: true,
        estornado_fato_contabil_id: e.fatoId,
        situacao: 'pendente',
        origem: 'sistema',
      }),
    );
  }
  return gravados;
}
