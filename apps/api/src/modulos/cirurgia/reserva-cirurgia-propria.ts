// Reserva de equipamentos e hemocomponentes para a cirurgia (F8, 04-CC linha 103), no banco do cliente
// (`reserva_equipamento_cirurgia`, `reserva_hemocomponente_cirurgia`).
// Contrato de efeito:
//   - leitura: as reservas vigentes do agendamento (equipamento com período e situação; hemocomponente com a prova
//     cruzada e o item da requisição transfusional ligado, com as bolsas já liberadas), o período padrão (a janela da
//     cirurgia), os equipamentos e hemocomponentes que podem ser pedidos e os itens de requisição transfusional do
//     paciente que podem atender a reserva (sem cirurgia ou desta cirurgia). Só leitura;
//   - reservar equipamento: uma linha com a sequência seguinte, o período (o informado ou a janela da cirurgia) e a
//     situação "reservado"; o equipamento fica travado na transação, e o período que cruza outra reserva vigente do
//     mesmo equipamento (qualquer cirurgia) é recusado (422) sem escrita; a reserva de cirurgia cancelada, suspensa,
//     reprovada ou realizada não ocupa o equipamento;
//   - pedir hemocomponente: uma linha com a sequência seguinte, a quantidade de bolsas, a situação "solicitada" e a
//     prova cruzada "solicitada" quando o tipo a exige ("dispensada" quando não);
//   - ligar à requisição: a reserva guarda o item da requisição transfusional (mesmo paciente, mesmo tipo, requisição
//     viva e sem outra cirurgia), passa a "reservada" com as bolsas já liberadas (sem bolsa liberada segue
//     "solicitada", com o vínculo gravado), e a requisição sem cirurgia passa a apontar esta cirurgia (a agência a
//     enxerga). O item que já atende outra reserva vigente e a reserva já ligada são recusados (422) sem escrita, com o
//     item travado na transação; as opções da leitura não trazem o item já ligado;
//   - cancelar: a reserva fica com a situação cancelada e a versão lida; nunca apagada. Na cirurgia cancelada,
//     suspensa ou reprovada, o cancelamento libera a reserva ainda aberta.
// Cirurgia de outro estabelecimento: 404 do agendamento, sem escrita.
import {
  conferirCancelamentoEquipamento,
  conferirCancelamentoHemocomponente,
  conferirReservaEquipamento,
  conferirReservaHemocomponente,
  conferirVinculoRequisicao,
  listaMaterialAberta,
  type OcupacaoEquipamento,
  periodoDaCirurgia,
  provaCruzadaInicial,
  reservaLiberavel,
  reservaPeloVinculo,
} from '@sgh/dominio-cirurgia';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_RESERVA_CIRURGIA = Symbol('PORTA_RESERVA_CIRURGIA');

const AGENDAMENTO = 'agendamento_cirurgico';
const EQUIPAMENTO = 'reserva_equipamento_cirurgia';
const HEMO = 'reserva_hemocomponente_cirurgia';
const REQUISICAO = 'requisicao_transfusao';
const ERRNO_LINHA_MUDOU = 1020;

type Linha = Record<string, unknown>;

export interface ReservaEquipamentoLida {
  readonly id: number;
  readonly versao: number;
  readonly sequencia: number;
  readonly equipamento: number;
  readonly codigo: string;
  readonly nome: string;
  readonly quantidade: number;
  readonly inicio: string;
  readonly fim: string;
  readonly situacao: string;
}

export interface ReservaHemocomponenteLida {
  readonly id: number;
  readonly versao: number;
  readonly sequencia: number;
  readonly hemocomponente: number;
  readonly sigla: string;
  readonly descricao: string;
  readonly quantidade: number;
  readonly quantidadeReservada: number;
  readonly provaCruzada: string;
  readonly situacao: string;
  readonly observacao: string | null;
  readonly requisicaoItem: number | null;
  readonly requisicaoNumero: string | null;
  readonly bolsasLiberadas: number | null;
}

export interface ItemRequisicaoCandidato {
  readonly item: number;
  readonly requisicao: string;
  readonly hemocomponente: number;
  readonly sigla: string;
  readonly bolsas: number;
  readonly liberadas: number;
  readonly situacao: string;
}

export interface ReservasDaCirurgia {
  readonly agendamento: number;
  readonly numero: string;
  readonly situacao: string;
  readonly aberta: boolean;
  /** A reserva aberta pode ser cancelada (cirurgia aberta, ou cancelada, suspensa ou reprovada para liberar). */
  readonly liberavel: boolean;
  readonly periodo: { readonly inicio: string; readonly fim: string } | null;
  readonly equipamentos: ReservaEquipamentoLida[];
  readonly hemocomponentes: ReservaHemocomponenteLida[];
  readonly opcoes: {
    readonly equipamentos: { id: number; codigo: string; nome: string }[];
    readonly hemocomponentes: { id: number; sigla: string; descricao: string; exigeProva: boolean }[];
    readonly requisicoes: ItemRequisicaoCandidato[];
  };
}

const id = z.number().int().positive();
const instante = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
const esquemaEquipamento = z
  .object({
    equipamento: id,
    quantidade: z.number().optional(),
    inicio: instante.optional(),
    fim: instante.optional(),
    procedimentoAgendamento: id.optional(),
  })
  .strict();
const esquemaHemo = z
  .object({
    hemocomponente: id,
    quantidade: z.number(),
    observacao: z.string().trim().max(255).optional(),
    procedimentoAgendamento: id.optional(),
  })
  .strict();
const esquemaVinculo = z.object({ requisicaoItem: id, versao: id }).strict();
const esquemaVersao = z.object({ versao: id }).strict();

const SQL_EQUIPAMENTOS = `
  SELECT r.id, r.versao, r.sequencia, r.equipamento_saude_id, e.codigo, e.nome, r.quantidade_solicitada,
         DATE_FORMAT(r.reserva_inicio, '%Y-%m-%d %H:%i') AS inicio, DATE_FORMAT(r.reserva_fim, '%Y-%m-%d %H:%i') AS fim, r.situacao
    FROM reserva_equipamento_cirurgia r
    JOIN equipamento_saude e ON e.id = r.equipamento_saude_id
   WHERE r.agendamento_cirurgico_id = ? AND r.excluido_em IS NULL
   ORDER BY r.sequencia`;
const SQL_HEMO = `
  SELECT r.id, r.versao, r.sequencia, r.hemocomponente_id, h.sigla, h.descricao, r.quantidade_solicitada,
         r.quantidade_reservada, r.situacao_prova_cruzada, r.situacao, r.observacao, r.requisicao_transfusao_item_id,
         q.numero AS requisicao_numero, i.quantidade_atendida
    FROM reserva_hemocomponente_cirurgia r
    JOIN hemocomponente h ON h.id = r.hemocomponente_id
    LEFT JOIN requisicao_transfusao_item i ON i.id = r.requisicao_transfusao_item_id
    LEFT JOIN requisicao_transfusao q ON q.id = i.requisicao_transfusao_id
   WHERE r.agendamento_cirurgico_id = ? AND r.excluido_em IS NULL
   ORDER BY r.sequencia`;
const SQL_ITEM_REQUISICAO = `
  SELECT i.id AS item, i.versao AS item_versao, q.id AS requisicao, q.versao AS requisicao_versao, q.numero,
         i.hemocomponente_id, h.sigla, q.paciente_id, q.agendamento_cirurgico_id, q.situacao AS situacao_requisicao,
         i.situacao AS situacao_item, i.quantidade_bolsas, i.quantidade_atendida
    FROM requisicao_transfusao_item i
    JOIN requisicao_transfusao q ON q.id = i.requisicao_transfusao_id
    JOIN hemocomponente h ON h.id = i.hemocomponente_id
   WHERE q.estabelecimento_id = ? AND q.excluido_em IS NULL AND i.excluido_em IS NULL`;

const equipamentoLido = (r: Linha): ReservaEquipamentoLida => ({
  id: num(r['id']),
  versao: num(r['versao']),
  sequencia: num(r['sequencia']),
  equipamento: num(r['equipamento_saude_id']),
  codigo: String(r['codigo']),
  nome: String(r['nome']),
  quantidade: num(r['quantidade_solicitada']),
  inicio: String(r['inicio']),
  fim: String(r['fim']),
  situacao: String(r['situacao']),
});

const hemoLido = (r: Linha): ReservaHemocomponenteLida => ({
  id: num(r['id']),
  versao: num(r['versao']),
  sequencia: num(r['sequencia']),
  hemocomponente: num(r['hemocomponente_id']),
  sigla: String(r['sigla']),
  descricao: String(r['descricao']),
  quantidade: num(r['quantidade_solicitada']),
  quantidadeReservada: num(r['quantidade_reservada']),
  provaCruzada: String(r['situacao_prova_cruzada']),
  situacao: String(r['situacao']),
  observacao: txtOuNull(r['observacao']),
  requisicaoItem: numOuNull(r['requisicao_transfusao_item_id']),
  requisicaoNumero: txtOuNull(r['requisicao_numero']),
  bolsasLiberadas: numOuNull(r['quantidade_atendida']),
});

interface AgendamentoLido {
  readonly id: number;
  readonly numero: string;
  readonly situacao: string;
  readonly paciente: number;
  readonly periodo: { readonly inicio: string; readonly fim: string } | null;
}

export class PortaReservaCirurgiaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, [AGENDAMENTO, EQUIPAMENTO, HEMO, REQUISICAO], 'cirurgia.reserva');
  }

  private async agendamento(
    l: Leitor,
    est: number,
    agendamento: number,
    travar: boolean,
  ): Promise<AgendamentoLido> {
    const sql = `SELECT id, numero, situacao, paciente_id, DATE_FORMAT(inicio_previsto_em, '%Y-%m-%d %H:%i') AS inicio,
                        duracao_prevista_minutos
                   FROM agendamento_cirurgico
                  WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`;
    const [a] = travar
      ? await (l as TxOperacao).consultarParaAtualizar<Linha>(sql, [agendamento, est])
      : await l.consultar<Linha>(sql, [agendamento, est]);
    if (!a) throw naoEncontrado('Agendamento cirúrgico');
    return {
      id: agendamento,
      numero: String(a['numero']),
      situacao: String(a['situacao']),
      paciente: num(a['paciente_id']),
      periodo: periodoDaCirurgia(txtOuNull(a['inicio']), numOuNull(a['duracao_prevista_minutos'])),
    };
  }

  private async conferirProcedimento(l: Leitor, agendamento: number, proc: number | undefined) {
    if (proc === undefined) return null;
    const p = await l.uma(
      `SELECT id FROM agendamento_cirurgico_procedimento
        WHERE id = ? AND agendamento_cirurgico_id = ? AND excluido_em IS NULL`,
      [proc, agendamento],
    );
    if (!p)
      throw recusaRegra('Reserva recusada', [
        { campo: 'procedimentoAgendamento', mensagem: 'O procedimento não é desta cirurgia.' },
      ]);
    return proc;
  }

  private async proximaSequencia(
    tx: TxOperacao,
    tabela: typeof EQUIPAMENTO | typeof HEMO,
    agendamento: number,
  ) {
    const sql =
      tabela === EQUIPAMENTO
        ? 'SELECT COALESCE(MAX(sequencia), 0) AS s FROM reserva_equipamento_cirurgia WHERE agendamento_cirurgico_id = ?'
        : 'SELECT COALESCE(MAX(sequencia), 0) AS s FROM reserva_hemocomponente_cirurgia WHERE agendamento_cirurgico_id = ?';
    return num((await tx.uma(sql, [agendamento]))?.['s']) + 1;
  }

  /** As reservas da cirurgia, o período padrão e o que pode ser pedido. */
  reservas(c: ContextoPortaPropria, agendamento: number): Promise<ReservasDaCirurgia> {
    return this.ler(c, 'leitura', async (l, est) => {
      const a = await this.agendamento(l, est.id, agendamento, false);
      const equipamentos = (await l.consultar<Linha>(SQL_EQUIPAMENTOS, [agendamento])).map(equipamentoLido);
      const hemocomponentes = (await l.consultar<Linha>(SQL_HEMO, [agendamento])).map(hemoLido);
      const eqs = await l.consultar<Linha>(
        `SELECT id, codigo, nome FROM equipamento_saude
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'desativado' AND tipo = 'medico'
          ORDER BY nome, codigo LIMIT 500`,
        [est.id],
      );
      const hs = await l.consultar<Linha>(
        'SELECT id, sigla, descricao, exige_prova_compatibilidade FROM hemocomponente WHERE ativo ORDER BY descricao',
      );
      const reqs = await l.consultar<Linha>(
        `${SQL_ITEM_REQUISICAO} AND q.paciente_id = ? AND q.situacao <> 'cancelada' AND i.situacao <> 'cancelado'
            AND (q.agendamento_cirurgico_id IS NULL OR q.agendamento_cirurgico_id = ?)
            AND NOT EXISTS (SELECT 1 FROM reserva_hemocomponente_cirurgia x
                             WHERE x.requisicao_transfusao_item_id = i.id AND x.excluido_em IS NULL
                               AND x.situacao IN ('solicitada', 'reservada'))
          ORDER BY q.solicitado_em DESC, i.sequencia LIMIT 100`,
        [est.id, a.paciente, agendamento],
      );
      return {
        agendamento,
        numero: a.numero,
        situacao: a.situacao,
        aberta: listaMaterialAberta(a.situacao),
        liberavel: reservaLiberavel(a.situacao),
        periodo: a.periodo,
        equipamentos,
        hemocomponentes,
        opcoes: {
          equipamentos: eqs.map((r) => ({
            id: num(r['id']),
            codigo: String(r['codigo']),
            nome: String(r['nome']),
          })),
          hemocomponentes: hs.map((r) => ({
            id: num(r['id']),
            sigla: String(r['sigla']),
            descricao: String(r['descricao']),
            exigeProva: Boolean(num(r['exige_prova_compatibilidade'])),
          })),
          requisicoes: reqs.map((r) => ({
            item: num(r['item']),
            requisicao: String(r['numero']),
            hemocomponente: num(r['hemocomponente_id']),
            sigla: String(r['sigla']),
            bolsas: num(r['quantidade_bolsas']),
            liberadas: num(r['quantidade_atendida']),
            situacao: String(r['situacao_item']),
          })),
        },
      };
    });
  }

  /** Reserva o equipamento no período (o informado ou a janela da cirurgia), sem cruzar outra reserva dele. */
  async reservarEquipamento(c: ContextoPortaPropria, agendamento: number, entrada: unknown) {
    const e = entradaValida(esquemaEquipamento, entrada);
    return this.gravarSemCorrida(c, 'cirurgia.reserva.equipamento-incluir', async (tx, est) => {
      const a = await this.agendamento(tx, est.id, agendamento, true);
      const [eq] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, situacao FROM equipamento_saude
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [e.equipamento, est.id],
      );
      const periodo = e.inicio && e.fim ? { inicio: e.inicio, fim: e.fim } : a.periodo;
      if (!periodo)
        throw recusaRegra('Reserva recusada', [
          {
            campo: 'inicio',
            mensagem: 'A cirurgia ainda não tem horário: informe o início e o fim da reserva.',
          },
        ]);
      const ocupacoes = eq
        ? (
            await tx.consultar<Linha>(
              `SELECT r.agendamento_cirurgico_id, a.numero, a.situacao AS situacao_agendamento, DATE_FORMAT(r.reserva_inicio, '%Y-%m-%d %H:%i') AS inicio,
                      DATE_FORMAT(r.reserva_fim, '%Y-%m-%d %H:%i') AS fim, r.situacao
                 FROM reserva_equipamento_cirurgia r
                 JOIN agendamento_cirurgico a ON a.id = r.agendamento_cirurgico_id
                WHERE r.equipamento_saude_id = ? AND r.excluido_em IS NULL AND a.excluido_em IS NULL
                  AND r.situacao IN ('reservado', 'confirmado', 'em_uso')
                  AND a.situacao NOT IN ('cancelado', 'suspenso', 'reprovado', 'realizado')
                  AND r.reserva_inicio < ? AND r.reserva_fim > ?`,
              [e.equipamento, `${periodo.fim}:00`, `${periodo.inicio}:00`],
            )
          ).map((r): OcupacaoEquipamento => ({
            agendamento: num(r['agendamento_cirurgico_id']),
            numero: String(r['numero']),
            inicio: String(r['inicio']),
            fim: String(r['fim']),
            situacao: String(r['situacao']),
            situacaoAgendamento: String(r['situacao_agendamento']),
          }))
        : [];
      const quantidade = e.quantidade ?? 1;
      const problemas = conferirReservaEquipamento(
        a,
        { ...periodo, quantidade },
        eq ? { situacao: String(eq['situacao']) } : null,
        ocupacoes,
      );
      if (problemas.length) throw recusaRegra('Reserva de equipamento recusada', problemas);
      const proc = await this.conferirProcedimento(tx, agendamento, e.procedimentoAgendamento);
      const novo = await tx.incluir(EQUIPAMENTO, {
        agendamento_cirurgico_id: agendamento,
        sequencia: await this.proximaSequencia(tx, EQUIPAMENTO, agendamento),
        equipamento_saude_id: e.equipamento,
        agendamento_cirurgico_procedimento_id: proc,
        quantidade_solicitada: quantidade,
        reserva_inicio: `${periodo.inicio}:00`,
        reserva_fim: `${periodo.fim}:00`,
        situacao: 'reservado',
      });
      return { tabela: EQUIPAMENTO, id: novo, agendamento };
    });
  }

  /** Pede o hemocomponente para a cirurgia, com a prova cruzada pedida quando o tipo a exige. */
  async pedirHemocomponente(c: ContextoPortaPropria, agendamento: number, entrada: unknown) {
    const e = entradaValida(esquemaHemo, entrada);
    return this.gravarSemCorrida(c, 'cirurgia.reserva.hemocomponente-incluir', async (tx, est) => {
      const a = await this.agendamento(tx, est.id, agendamento, true);
      const h = await tx.uma(
        'SELECT id, ativo, exige_prova_compatibilidade FROM hemocomponente WHERE id = ?',
        [e.hemocomponente],
      );
      const problemas = conferirReservaHemocomponente(
        a.situacao,
        e.quantidade,
        h ? { ativo: Boolean(num(h['ativo'])) } : null,
      );
      if (problemas.length) throw recusaRegra('Pedido de hemocomponente recusado', problemas);
      const proc = await this.conferirProcedimento(tx, agendamento, e.procedimentoAgendamento);
      const novo = await tx.incluir(HEMO, {
        agendamento_cirurgico_id: agendamento,
        sequencia: await this.proximaSequencia(tx, HEMO, agendamento),
        hemocomponente_id: e.hemocomponente,
        agendamento_cirurgico_procedimento_id: proc,
        quantidade_solicitada: e.quantidade,
        situacao_prova_cruzada: provaCruzadaInicial(Boolean(num(h?.['exige_prova_compatibilidade']))),
        situacao: 'solicitada',
        observacao: e.observacao || null,
      });
      return { tabela: HEMO, id: novo, agendamento };
    });
  }

  /** Liga a reserva ao item da requisição transfusional; a requisição sem cirurgia passa a apontar esta. */
  async ligarRequisicao(c: ContextoPortaPropria, agendamento: number, reserva: number, entrada: unknown) {
    const e = entradaValida(esquemaVinculo, entrada);
    return this.gravarSemCorrida(c, 'cirurgia.reserva.hemocomponente-requisicao', async (tx, est) => {
      const a = await this.agendamento(tx, est.id, agendamento, true);
      const [r] = await tx.consultarParaAtualizar<Linha>(
        `SELECT id, hemocomponente_id, situacao, quantidade_solicitada, requisicao_transfusao_item_id
           FROM reserva_hemocomponente_cirurgia
          WHERE id = ? AND agendamento_cirurgico_id = ? AND excluido_em IS NULL`,
        [reserva, agendamento],
      );
      if (!r) throw naoEncontrado('Reserva de hemocomponente');
      const [i] = await tx.consultarParaAtualizar<Linha>(`${SQL_ITEM_REQUISICAO} AND i.id = ?`, [
        est.id,
        e.requisicaoItem,
      ]);
      const item = i
        ? {
            hemocomponente: num(i['hemocomponente_id']),
            paciente: num(i['paciente_id']),
            agendamento: numOuNull(i['agendamento_cirurgico_id']),
            situacaoRequisicao: String(i['situacao_requisicao']),
            situacaoItem: String(i['situacao_item']),
            quantidadeBolsas: num(i['quantidade_bolsas']),
            quantidadeAtendida: num(i['quantidade_atendida']),
          }
        : null;
      // Com o item travado acima, as outras reservas vigentes ligadas a ele são lidas com trava (leitura atual).
      const outras = i
        ? await tx.consultarParaAtualizar<Linha>(
            `SELECT id FROM reserva_hemocomponente_cirurgia
              WHERE requisicao_transfusao_item_id = ? AND id <> ? AND excluido_em IS NULL
                AND situacao IN ('solicitada', 'reservada')`,
            [e.requisicaoItem, reserva],
          )
        : [];
      const problemas = conferirVinculoRequisicao(
        a,
        {
          hemocomponente: num(r['hemocomponente_id']),
          situacao: String(r['situacao']),
          requisicaoItem: numOuNull(r['requisicao_transfusao_item_id']),
        },
        item,
        outras.length,
      );
      if (problemas.length || !item || !i) throw recusaRegra('Vínculo com a requisição recusado', problemas);
      const v = reservaPeloVinculo(num(r['quantidade_solicitada']), item);
      await tx.alterar(HEMO, reserva, e.versao, {
        requisicao_transfusao_item_id: e.requisicaoItem,
        situacao: v.situacao,
        quantidade_reservada: v.quantidadeReservada,
      });
      if (item.agendamento === null)
        await tx.alterar(REQUISICAO, num(i['requisicao']), num(i['requisicao_versao']), {
          agendamento_cirurgico_id: agendamento,
        });
      return { tabela: HEMO, id: reserva, agendamento, requisicao: String(i['numero']) };
    });
  }

  /** Cancela a reserva (equipamento ou hemocomponente): a linha fica com a situação cancelada, nunca apagada. */
  async cancelar(
    c: ContextoPortaPropria,
    agendamento: number,
    tipo: 'equipamento' | 'hemocomponente',
    reserva: number,
    entrada: unknown,
  ) {
    const e = entradaValida(esquemaVersao, entrada);
    const nome =
      tipo === 'equipamento'
        ? 'cirurgia.reserva.equipamento-cancelar'
        : 'cirurgia.reserva.hemocomponente-cancelar';
    return this.gravarSemCorrida(c, nome, async (tx, est) => {
      const a = await this.agendamento(tx, est.id, agendamento, true);
      const sql =
        tipo === 'equipamento'
          ? `SELECT situacao FROM reserva_equipamento_cirurgia
              WHERE id = ? AND agendamento_cirurgico_id = ? AND excluido_em IS NULL`
          : `SELECT situacao FROM reserva_hemocomponente_cirurgia
              WHERE id = ? AND agendamento_cirurgico_id = ? AND excluido_em IS NULL`;
      const [r] = await tx.consultarParaAtualizar<Linha>(sql, [reserva, agendamento]);
      if (!r) throw naoEncontrado('Reserva');
      const situacao = String(r['situacao']);
      const problemas =
        tipo === 'equipamento'
          ? conferirCancelamentoEquipamento(a.situacao, situacao)
          : conferirCancelamentoHemocomponente(a.situacao, situacao);
      if (problemas.length) throw recusaRegra('Cancelamento recusado', problemas);
      const tabela = tipo === 'equipamento' ? EQUIPAMENTO : HEMO;
      await tx.alterar(tabela, reserva, e.versao, {
        situacao: tipo === 'equipamento' ? 'cancelado' : 'cancelada',
      });
      return { tabela, id: reserva, agendamento };
    });
  }

  /**
   * A leitura com trava de uma linha que outra transação confirmou depois do instantâneo desta é recusada pelo banco
   * (erro 1020): vira 409, nada gravado, para a tela reler e tentar de novo.
   */
  private async gravarSemCorrida<T extends Record<string, unknown>>(
    c: ContextoPortaPropria,
    nome: string,
    fn: (
      tx: TxOperacao,
      est: { id: number; fuso: string },
      usuario: number,
    ) => Promise<T & { tabela: string; id: number | null }>,
  ): Promise<T> {
    try {
      return await this.gravar(c, nome, [AGENDAMENTO, EQUIPAMENTO, HEMO, REQUISICAO], fn);
    } catch (erro) {
      if ((erro as { errno?: unknown } | null)?.errno === ERRNO_LINHA_MUDOU)
        throw new ErroOperacao(
          409,
          'gravacao-concorrente',
          'Gravação simultânea',
          'Outra gravação mudou as reservas desta cirurgia ao mesmo tempo. Nada foi gravado: confira e grave de novo.',
        );
      throw erro;
    }
  }
}
