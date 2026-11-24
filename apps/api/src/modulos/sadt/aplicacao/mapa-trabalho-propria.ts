// Mapa de trabalho da bancada no banco do cliente (F3.5, 05-SADT linha 8): a leitura da bancada de cada exame pelo
// modelo de mapa do setor e dos exames retidos nos lotes de trabalho, e a retenção e a volta à fila do exame na
// bancada. Reter grava o exame no lote aberto do dia da bancada (o lote nasce na primeira retenção, numerado pela
// sequência de negócio) com a situação "retido" e o motivo; soltar devolve o item a "pendente". Nada é apagado: a
// trilha guarda o antes e o depois de cada passagem. A regra (motivo, situação do exame, bancada) é do domínio.
import {
  type BancadaDoItem,
  conferirRetencao,
  escolherBancada,
  type ExameNoMapa,
  MENSAGEM_RETENCAO,
  type Retencao,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  recusa,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FUSO_PADRAO, relogioNoFuso } from '../../exames/relogio.js';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';

const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const n = (v: unknown) => Number(v);

export const esquemaReterExame = z
  .object({ exame: z.number().int().positive(), motivo: z.string().trim().min(5).max(500) })
  .strict();
export const esquemaSoltarExame = z.object({ exame: z.number().int().positive() }).strict();

/** Situação do item no lote. */
export interface RetencaoGravada {
  readonly id: number;
  readonly exame: number;
  readonly lote: string;
  readonly situacao: 'retido' | 'pendente';
}

/**
 * As bancadas candidatas de cada exame pedido: só modelos de mapa ativos do setor do exame pedido (o do item ou, sem
 * ele, o da requisição), com a bancada ativa do mesmo setor e o setor do estabelecimento da sessão. A escolha entre
 * candidatas é do domínio (escolherBancada).
 */
function sqlBancadas(k: number): string {
  return `SELECT ei.id AS item, b.id AS bancada, b.descricao, mb.limite_exames, mb.id AS modelo
     FROM exame_item ei
     JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id AND r.excluido_em IS NULL
     JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id)
                              AND sd.estabelecimento_id = r.estabelecimento_id
     JOIN modelo_mapa_bancada mb ON mb.setor_diagnostico_id = sd.id AND mb.ativo = TRUE
     JOIN modelo_mapa_bancada_exame mbe ON mbe.modelo_mapa_bancada_id = mb.id AND mbe.exame_id = ei.exame_id
                                       AND mbe.excluido_em IS NULL AND mbe.somente_interesse = FALSE
     JOIN bancada_analitica b ON b.id = mb.bancada_analitica_id AND b.ativo = TRUE
                             AND b.setor_diagnostico_id = mb.setor_diagnostico_id
    WHERE r.estabelecimento_id = ? AND ei.excluido_em IS NULL AND ei.id IN (${lista(k)})`;
}

const bancadaDe = (r: Record<string, unknown>): BancadaDoItem => ({
  item: n(r['item']),
  bancada: n(r['bancada']),
  nome: String(r['descricao']),
  limite: r['limite_exames'] === null ? null : n(r['limite_exames']),
  modelo: n(r['modelo']),
});

/** As bancadas candidatas dos exames do mapa e os itens retidos nos lotes do estabelecimento. */
export async function lerBancadasDoMapa(
  l: Leitor,
  est: number,
  itens: readonly ExameNoMapa[],
): Promise<{ bancadas: BancadaDoItem[]; retencoes: Retencao[] }> {
  const ids = itens.map((x) => x.id);
  if (!ids.length) return { bancadas: [], retencoes: [] };
  const bancadas = (await l.consultar(sqlBancadas(ids.length), [est, ...ids], { teto: 5000 })).map(bancadaDe);
  const retencoes = (
    await l.consultar(
      `SELECT gi.exame_item_id, gi.motivo FROM grupo_trabalho_bancada_item gi
         JOIN grupo_trabalho_bancada g ON g.id = gi.grupo_trabalho_bancada_id
        WHERE g.estabelecimento_id = ? AND g.excluido_em IS NULL AND gi.excluido_em IS NULL
          AND gi.situacao = 'retido' AND gi.exame_item_id IN (${lista(ids.length)})`,
      [est, ...ids],
      { teto: 5000 },
    )
  ).map((r) => ({ item: n(r['exame_item_id']), motivo: String(r['motivo'] ?? '') }));
  return { bancadas, retencoes };
}

const TABELAS = ['grupo_trabalho_bancada', 'grupo_trabalho_bancada_item', 'sequencia_negocio'];

export class ServicoMapaTrabalho {
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

  /** Retém o exame na bancada, com o motivo (fora do lote até ser solto). */
  reter(c: ContextoSadt, entrada: unknown): Promise<RetencaoGravada> {
    const e = esquemaReterExame.parse(entrada);
    return this.gravar(c, 'sadt.mapa.reter', true, e.exame, e.motivo);
  }

  /** Devolve o exame retido à fila da bancada. */
  soltar(c: ContextoSadt, entrada: unknown): Promise<RetencaoGravada> {
    const e = esquemaSoltarExame.parse(entrada);
    return this.gravar(c, 'sadt.mapa.soltar', false, e.exame, null);
  }

  private async gravar(
    c: ContextoSadt,
    nome: string,
    reter: boolean,
    item: number,
    motivo: string | null,
  ): Promise<RetencaoGravada> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: RetencaoGravada | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        const usuario = tx.contexto.usuario;
        const agora = new Date();
        const [ei] = await tx.consultarParaAtualizar(
          `SELECT ei.id, ei.situacao, ei.exame_id FROM exame_item ei
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id AND r.excluido_em IS NULL
            WHERE ei.id = ? AND r.estabelecimento_id = ? AND ei.excluido_em IS NULL`,
          [item, est],
        );
        if (!ei) throw recusa('exame-inexistente', 'O exame não existe neste estabelecimento.');
        const [atual] = await tx.consultarParaAtualizar(
          `SELECT gi.id, gi.versao, g.numero FROM grupo_trabalho_bancada_item gi
             JOIN grupo_trabalho_bancada g ON g.id = gi.grupo_trabalho_bancada_id
            WHERE g.estabelecimento_id = ? AND g.excluido_em IS NULL AND gi.excluido_em IS NULL
              AND gi.situacao = 'retido' AND gi.exame_item_id = ?`,
          [est, item],
        );
        // A mesma escolha do mapa: modelo do setor do exame pedido, no estabelecimento da sessão.
        const escolhida = escolherBancada((await tx.consultar(sqlBancadas(1), [est, item])).map(bancadaDe));
        const b = escolhida
          ? await tx.uma('SELECT id, setor_diagnostico_id FROM bancada_analitica WHERE id = ?', [
              escolhida.bancada,
            ])
          : undefined;
        const falha = conferirRetencao({
          reter,
          motivo,
          situacaoExame: String(ei['situacao']),
          retidoAgora: atual !== undefined,
          temBancada: escolhida !== null && b != null,
        });
        if (falha) throw recusa(falha, MENSAGEM_RETENCAO[falha]);
        if (!reter) {
          await tx.alterar('grupo_trabalho_bancada_item', n(atual!['id']), n(atual!['versao']), {
            situacao: 'pendente',
          });
          saida = { id: n(atual!['id']), exame: item, lote: String(atual!['numero']), situacao: 'pendente' };
          return { id: saida.id };
        }
        const fuso = await tx.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
        const hoje = relogioNoFuso(String(fuso?.['fuso_horario'] || FUSO_PADRAO)).hoje;
        const [aberto] = await tx.consultarParaAtualizar(
          `SELECT id, numero FROM grupo_trabalho_bancada
            WHERE estabelecimento_id = ? AND bancada_analitica_id = ? AND data_trabalho = ? AND situacao = 'aberto'
              AND excluido_em IS NULL ORDER BY id LIMIT 1`,
          [est, b!['id'], hoje],
        );
        let lote = aberto ? n(aberto['id']) : 0;
        let numero = aberto ? String(aberto['numero']) : '';
        if (!aberto) {
          await garantirSequencia(
            tx,
            { tipo: 'grupo_trabalho_bancada', estabelecimento: est, prefixo: 'LT-' },
            { usuario, agora },
          );
          numero = (await tx.proximoNumero('grupo_trabalho_bancada')).formatado;
          lote = await tx.incluir('grupo_trabalho_bancada', {
            estabelecimento_id: est,
            numero,
            setor_diagnostico_id: b!['setor_diagnostico_id'],
            bancada_analitica_id: b!['id'],
            modelo_mapa_bancada_id: escolhida!.modelo,
            data_trabalho: hoje,
            aberto_em: agora,
            aberto_por_usuario_id: usuario,
            situacao: 'aberto',
          });
        }
        const [ja] = await tx.consultarParaAtualizar(
          `SELECT id, versao FROM grupo_trabalho_bancada_item
            WHERE grupo_trabalho_bancada_id = ? AND exame_item_id = ? AND excluido_em IS NULL`,
          [lote, item],
        );
        let id: number;
        if (ja) {
          id = n(ja['id']);
          await tx.alterar('grupo_trabalho_bancada_item', id, n(ja['versao']), {
            situacao: 'retido',
            motivo,
          });
        } else {
          const seq = await tx.uma(
            'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM grupo_trabalho_bancada_item WHERE grupo_trabalho_bancada_id = ?',
            [lote],
          );
          id = await tx.incluir('grupo_trabalho_bancada_item', {
            grupo_trabalho_bancada_id: lote,
            sequencia: n(seq?.['s'] ?? 1),
            exame_item_id: item,
            situacao: 'retido',
            motivo,
          });
        }
        saida = { id, exame: item, lote: numero, situacao: 'retido' };
        return { id };
      },
      alvo: () => ({ tabela: 'grupo_trabalho_bancada_item', id: saida?.id ?? null }),
      trilha: () => ({ dados: { evento: nome, exame: item }, motivo }),
    });
    const chave = `sadt:${c.chaveIdempotencia ?? randomUUID()}`;
    await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    if (saida) return saida;
    // A mesma chave repetida: a situação relida do banco.
    return this.nucleo.lerSomente(this.ctxNucleo(c), async (l) => {
      const r = await l.uma(
        `SELECT gi.id, gi.situacao, g.numero FROM grupo_trabalho_bancada_item gi
           JOIN grupo_trabalho_bancada g ON g.id = gi.grupo_trabalho_bancada_id
          WHERE g.estabelecimento_id = ? AND gi.exame_item_id = ? AND gi.excluido_em IS NULL ORDER BY gi.id DESC LIMIT 1`,
        [est, item],
      );
      return {
        id: n(r?.['id'] ?? 0),
        exame: item,
        lote: String(r?.['numero'] ?? ''),
        situacao: r?.['situacao'] === 'retido' ? 'retido' : 'pendente',
      };
    });
  }
}
