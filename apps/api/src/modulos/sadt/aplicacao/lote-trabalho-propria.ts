// Lote de trabalho da bancada no banco do cliente (F3.5, 05-SADT linha 8): o lote materializado. Abrir grava o lote
// da bancada (numerado pela sequência de negócio) com os exames em análise que ainda não estão num lote em andamento,
// na ordem do mapa, até o limite do modelo, cada um com a sequência e a posição no suporte, e o analista; fechar
// marca o que foi processado e devolve à fila o que ficou pendente; imprimir registra a hora da impressão. Nada é
// apagado e cada passagem fica na trilha. A regra (ordem, limite, destino no fechamento) é do domínio.
import {
  type BancadaDoItem,
  type CandidatoAoLote,
  conferirAberturaDoLote,
  conferirFechamentoDoLote,
  conferirImpressaoDoLote,
  escolherBancada,
  MENSAGEM_LOTE,
  montarLote,
  type SituacaoItemLote,
  situacaoNoFechamento,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FUSO_PADRAO, relogioNoFuso } from '../../exames/relogio.js';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';

const n = (v: unknown) => Number(v);
const iso = (v: unknown) =>
  v === null || v === undefined ? null : new Date(v as string | Date).toISOString();

export const esquemaAbrirLote = z
  .object({ bancada: z.number().int().positive(), analista: z.number().int().positive().optional() })
  .strict();
export const esquemaLoteAlvo = z.object({ lote: z.number().int().positive() }).strict();

export interface ItemDoLote {
  readonly id: number;
  readonly exame: number;
  readonly sequencia: number;
  readonly posicaoSuporte: string | null;
  readonly situacao: SituacaoItemLote;
  readonly motivo: string | null;
  readonly exameNome: string;
  readonly paciente: string;
  readonly amostra: string | null;
  readonly urgente: boolean;
}

export interface LoteDeTrabalho {
  readonly id: number;
  readonly numero: string;
  readonly bancada: number;
  readonly bancadaNome: string;
  readonly data: string;
  readonly situacao: 'aberto' | 'em_processamento' | 'fechado' | 'cancelado';
  readonly analista: number | null;
  readonly analistaNome: string | null;
  readonly abertoEm: string;
  readonly fechadoEm: string | null;
  readonly impressoEm: string | null;
  readonly itens: ItemDoLote[];
}

const SQL_LOTE = `SELECT g.id, g.numero, g.situacao, g.bancada_analitica_id, b.descricao AS bancada,
         DATE_FORMAT(g.data_trabalho, '%Y-%m-%d') AS data, g.analista_usuario_id, u.nome AS analista,
         g.aberto_em, g.fechado_em, g.impresso_em
    FROM grupo_trabalho_bancada g
    JOIN bancada_analitica b ON b.id = g.bancada_analitica_id
    LEFT JOIN usuario u ON u.id = g.analista_usuario_id
   WHERE g.estabelecimento_id = ? AND g.excluido_em IS NULL`;

const SQL_ITENS = (
  k: number,
) => `SELECT gi.id, gi.grupo_trabalho_bancada_id AS lote, gi.exame_item_id, gi.sequencia,
         gi.posicao_suporte, gi.situacao, gi.motivo, e.nome AS exame_nome, pf.nome AS paciente,
         am.codigo_barras, (ei.urgente = TRUE OR r.prioridade <> 'rotina') AS urgente
    FROM grupo_trabalho_bancada_item gi
    JOIN exame_item ei ON ei.id = gi.exame_item_id
    JOIN exame e ON e.id = ei.exame_id
    JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
    JOIN paciente p ON p.id = r.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN amostra_biologica am ON am.id = gi.amostra_biologica_id
   WHERE gi.excluido_em IS NULL AND gi.grupo_trabalho_bancada_id IN (${Array.from({ length: k }, () => '?').join(', ')})
   ORDER BY gi.grupo_trabalho_bancada_id, gi.sequencia`;

/** Os lotes pedidos, com os exames na ordem da sequência. */
async function lerLotes(
  l: Leitor,
  est: number,
  filtro: string,
  params: unknown[],
): Promise<LoteDeTrabalho[]> {
  const lotes = await l.consultar(`${SQL_LOTE} AND ${filtro} ORDER BY g.id`, [est, ...params], { teto: 500 });
  if (!lotes.length) return [];
  const itens = await l.consultar(
    SQL_ITENS(lotes.length),
    lotes.map((g) => g['id']),
    { teto: 20000 },
  );
  return lotes.map((g) => ({
    id: n(g['id']),
    numero: String(g['numero']),
    bancada: n(g['bancada_analitica_id']),
    bancadaNome: String(g['bancada']),
    data: String(g['data']),
    situacao: String(g['situacao']) as LoteDeTrabalho['situacao'],
    analista: g['analista_usuario_id'] === null ? null : n(g['analista_usuario_id']),
    analistaNome: g['analista'] === null || g['analista'] === undefined ? null : String(g['analista']),
    abertoEm: iso(g['aberto_em'])!,
    fechadoEm: iso(g['fechado_em']),
    impressoEm: iso(g['impresso_em']),
    itens: itens
      .filter((i) => n(i['lote']) === n(g['id']))
      .map((i) => ({
        id: n(i['id']),
        exame: n(i['exame_item_id']),
        sequencia: n(i['sequencia']),
        posicaoSuporte: i['posicao_suporte'] === null ? null : String(i['posicao_suporte']),
        situacao: String(i['situacao']) as SituacaoItemLote,
        motivo: i['motivo'] === null ? null : String(i['motivo']),
        exameNome: String(i['exame_nome']),
        paciente: String(i['paciente']),
        amostra:
          i['codigo_barras'] === null || i['codigo_barras'] === undefined ? null : String(i['codigo_barras']),
        urgente: n(i['urgente']) === 1,
      })),
  }));
}

/**
 * Os exames em análise do setor da bancada, com as bancadas candidatas de cada um (a mesma leitura do mapa), fora os
 * que já estão num lote em andamento e os retidos; na ordem de chegada (a solicitação). A escolha é do domínio.
 */
const SQL_CANDIDATOS = `SELECT ei.id AS item, b.id AS bancada, b.descricao, mb.limite_exames, mb.id AS modelo,
         (ei.urgente = TRUE OR r.prioridade <> 'rotina') AS urgente,
         (SELECT abe.amostra_biologica_id FROM amostra_biologica_exame abe
            JOIN amostra_biologica x ON x.id = abe.amostra_biologica_id
           WHERE abe.exame_item_id = ei.id AND abe.excluido_em IS NULL AND x.excluido_em IS NULL
             AND x.situacao NOT IN ('rejeitada', 'cancelada', 'descartada')
           ORDER BY abe.amostra_biologica_id DESC LIMIT 1) AS amostra
    FROM exame_item ei
    JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id AND r.excluido_em IS NULL
    JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id)
                             AND sd.estabelecimento_id = r.estabelecimento_id
    JOIN modelo_mapa_bancada mb ON mb.setor_diagnostico_id = sd.id AND mb.ativo = TRUE
    JOIN modelo_mapa_bancada_exame mbe ON mbe.modelo_mapa_bancada_id = mb.id AND mbe.exame_id = ei.exame_id
                                      AND mbe.excluido_em IS NULL AND mbe.somente_interesse = FALSE
    JOIN bancada_analitica b ON b.id = mb.bancada_analitica_id AND b.ativo = TRUE
                            AND b.setor_diagnostico_id = mb.setor_diagnostico_id
   WHERE r.estabelecimento_id = ? AND sd.id = ? AND ei.excluido_em IS NULL AND ei.situacao = 'em_analise'
     AND NOT EXISTS (
         SELECT 1 FROM grupo_trabalho_bancada_item gi
           JOIN grupo_trabalho_bancada g ON g.id = gi.grupo_trabalho_bancada_id
          WHERE gi.exame_item_id = ei.id AND gi.excluido_em IS NULL AND g.excluido_em IS NULL
            AND (gi.situacao = 'retido'
                 OR (gi.situacao IN ('pendente', 'repetir') AND g.situacao IN ('aberto', 'em_processamento'))))
   ORDER BY COALESCE(r.solicitado_em, ei.criado_em), ei.id`;

const TABELAS = ['grupo_trabalho_bancada', 'grupo_trabalho_bancada_item', 'sequencia_negocio'];

export class ServicoLoteTrabalho {
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSadt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ctxNucleo(c: ContextoSadt): ContextoNucleo {
    return {
      cliente: c.cliente,
      estabelecimento: c.estabelecimento,
      usuario: c.usuario,
      correlacao: (c.correlacao || 'sadt').slice(0, 64),
    };
  }

  private est(c: ContextoSadt): number {
    if (c.estabelecimento === null)
      throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    return c.estabelecimento;
  }

  /** Os lotes do dia de trabalho e os que continuam em andamento de dias anteriores (nenhum fica esquecido). */
  listar(c: ContextoSadt, data: string): Promise<LoteDeTrabalho[]> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), (l) =>
      lerLotes(l, est, "(g.data_trabalho = ? OR g.situacao IN ('aberto', 'em_processamento'))", [data]),
    );
  }

  private async umLote(c: ContextoSadt, filtro: string, params: unknown[]): Promise<LoteDeTrabalho> {
    const est = this.est(c);
    const [lote] = await this.nucleo.lerSomente(this.ctxNucleo(c), (l) => lerLotes(l, est, filtro, params));
    if (!lote) throw recusa('lote-inexistente', MENSAGEM_LOTE['lote-inexistente']);
    return lote;
  }

  private async executar(
    c: ContextoSadt,
    nome: string,
    dados: Record<string, unknown>,
    gravar: (tx: TxOperacao) => Promise<number>,
  ): Promise<number | null> {
    let id: number | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        id = await gravar(tx);
        return { id };
      },
      alvo: () => ({ tabela: 'grupo_trabalho_bancada', id }),
      trilha: () => ({ dados: { evento: nome, ...dados }, motivo: null }),
    });
    const chave = `sadt:${c.chaveIdempotencia ?? randomUUID()}`;
    await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    return id;
  }

  /** Abre o lote da bancada com os exames em análise fora de lote, na ordem do mapa, até o limite do modelo. */
  async abrir(c: ContextoSadt, entrada: unknown): Promise<LoteDeTrabalho> {
    const e = esquemaAbrirLote.parse(entrada);
    const est = this.est(c);
    const id = await this.executar(c, 'sadt.lote.abrir', { bancada: e.bancada }, async (tx) => {
      const usuario = tx.contexto.usuario;
      const agora = new Date();
      // A bancada do estabelecimento, travada: duas aberturas da mesma bancada não levam o mesmo exame.
      const [b] = await tx.consultarParaAtualizar(
        `SELECT b.id, b.setor_diagnostico_id FROM bancada_analitica b
           JOIN setor_diagnostico sd ON sd.id = b.setor_diagnostico_id AND sd.estabelecimento_id = ?
          WHERE b.id = ? AND b.ativo = TRUE`,
        [est, e.bancada],
      );
      const analista = e.analista ?? usuario;
      const a =
        analista === null ? undefined : await tx.uma('SELECT id FROM usuario WHERE id = ?', [analista]);
      const linhas = b ? await tx.consultar(SQL_CANDIDATOS, [est, b['setor_diagnostico_id']]) : [];
      // A mesma escolha do mapa: entre as bancadas candidatas do exame, a do modelo mais antigo do setor.
      const porItem = new Map<number, { bancadas: BancadaDoItem[]; c: CandidatoAoLote }>();
      for (const r of linhas) {
        const item = n(r['item']);
        const g = porItem.get(item) ?? {
          bancadas: [],
          c: {
            item,
            urgente: n(r['urgente']) === 1,
            amostra: r['amostra'] === null ? null : n(r['amostra']),
          },
        };
        g.bancadas.push({
          item,
          bancada: n(r['bancada']),
          nome: String(r['descricao']),
          limite: r['limite_exames'] === null ? null : n(r['limite_exames']),
          modelo: n(r['modelo']),
        });
        porItem.set(item, g);
      }
      let modelo: BancadaDoItem | null = null;
      const candidatos: CandidatoAoLote[] = [];
      for (const g of porItem.values()) {
        const escolhida = escolherBancada(g.bancadas);
        if (escolhida?.bancada !== e.bancada) continue;
        modelo ??= escolhida;
        candidatos.push(g.c);
      }
      const falha = conferirAberturaDoLote({
        bancadaExiste: b !== undefined,
        analistaExiste: a != null,
        candidatos: candidatos.length,
      });
      if (falha) throw recusa(falha, MENSAGEM_LOTE[falha]);
      const fuso = await tx.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
      const hoje = relogioNoFuso(String(fuso?.['fuso_horario'] || FUSO_PADRAO)).hoje;
      await garantirSequencia(
        tx,
        { tipo: 'grupo_trabalho_bancada', estabelecimento: est, prefixo: 'LT-' },
        { usuario, agora },
      );
      const numero = (await tx.proximoNumero('grupo_trabalho_bancada')).formatado;
      const lote = await tx.incluir('grupo_trabalho_bancada', {
        estabelecimento_id: est,
        numero,
        setor_diagnostico_id: b!['setor_diagnostico_id'],
        bancada_analitica_id: e.bancada,
        modelo_mapa_bancada_id: modelo!.modelo,
        analista_usuario_id: analista,
        data_trabalho: hoje,
        aberto_em: agora,
        aberto_por_usuario_id: usuario,
        situacao: 'aberto',
      });
      for (const i of montarLote(candidatos, modelo!.limite))
        await tx.incluir('grupo_trabalho_bancada_item', {
          grupo_trabalho_bancada_id: lote,
          sequencia: i.sequencia,
          exame_item_id: i.item,
          amostra_biologica_id: i.amostra,
          posicao_suporte: i.posicaoSuporte,
          situacao: 'pendente',
        });
      return lote;
    });
    if (id !== null) return this.umLote(c, 'g.id = ?', [id]);
    // A mesma chave repetida: o último lote que este usuário abriu na bancada.
    return this.umLote(
      c,
      'g.bancada_analitica_id = ? AND g.aberto_por_usuario_id = ? AND g.id = (SELECT MAX(x.id) FROM grupo_trabalho_bancada x WHERE x.bancada_analitica_id = ? AND x.aberto_por_usuario_id = ?)',
      [e.bancada, c.usuario, e.bancada, c.usuario],
    );
  }

  /** Fecha o lote: processado o que saiu da análise, de volta à fila o que ficou pendente, o retido continua retido. */
  async fechar(c: ContextoSadt, entrada: unknown): Promise<LoteDeTrabalho> {
    const e = esquemaLoteAlvo.parse(entrada);
    const est = this.est(c);
    await this.executar(c, 'sadt.lote.fechar', { lote: e.lote }, async (tx) => {
      const agora = new Date();
      const [g] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao FROM grupo_trabalho_bancada WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.lote, est],
      );
      const falha = conferirFechamentoDoLote(g ? String(g['situacao']) : null);
      if (falha) throw recusa(falha, MENSAGEM_LOTE[falha]);
      const itens = await tx.consultarParaAtualizar(
        `SELECT gi.id, gi.versao, gi.situacao, ei.situacao AS situacao_exame
           FROM grupo_trabalho_bancada_item gi JOIN exame_item ei ON ei.id = gi.exame_item_id
          WHERE gi.grupo_trabalho_bancada_id = ? AND gi.excluido_em IS NULL`,
        [e.lote],
      );
      for (const i of itens) {
        const antes = String(i['situacao']) as SituacaoItemLote;
        const depois = situacaoNoFechamento(antes, String(i['situacao_exame']));
        if (depois !== antes)
          await tx.alterar('grupo_trabalho_bancada_item', n(i['id']), n(i['versao']), {
            situacao: depois,
            ...(depois === 'processado' ? { processado_em: agora } : {}),
          });
      }
      await tx.alterar('grupo_trabalho_bancada', e.lote, n(g!['versao']), {
        situacao: 'fechado',
        fechado_em: agora,
        fechado_por_usuario_id: tx.contexto.usuario,
      });
      return e.lote;
    });
    return this.umLote(c, 'g.id = ?', [e.lote]);
  }

  /** Registra a impressão do lote (a reimpressão fica na trilha) e devolve a folha: os exames na ordem do suporte. */
  async imprimir(c: ContextoSadt, entrada: unknown): Promise<LoteDeTrabalho> {
    const e = esquemaLoteAlvo.parse(entrada);
    const est = this.est(c);
    await this.executar(c, 'sadt.lote.imprimir', { lote: e.lote }, async (tx) => {
      const [g] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao FROM grupo_trabalho_bancada WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.lote, est],
      );
      const falha = conferirImpressaoDoLote(g ? String(g['situacao']) : null);
      if (falha) throw recusa(falha, MENSAGEM_LOTE[falha]);
      await tx.alterar('grupo_trabalho_bancada', e.lote, n(g!['versao']), { impresso_em: new Date() });
      return e.lote;
    });
    return this.umLote(c, 'g.id = ?', [e.lote]);
  }
}
