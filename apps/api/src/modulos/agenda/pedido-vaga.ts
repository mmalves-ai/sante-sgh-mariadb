// Pedido de vaga do médico no prontuário (02-AGE linha 53): o profissional pede a marcação de uma consulta, exame ou
// procedimento que ainda não tem vaga, e o pedido entra na lista de espera da agenda com quem pediu e os itens. A regra
// é a pura de @sgh/dominio-agenda (`validarPedidoVaga`, prioridade pelo grupo legal da fila); aqui ficam a leitura por
// paciente e a gravação pelo executor (trilha na mesma transação). Contrato de efeito:
//   - `lista_espera` situação 'aguardando', solicitante_profissional_id = o profissional vinculado ao usuário, a
//     especialidade (ou a agenda, ou o primeiro item da agenda como alvo), a prioridade (urgência clínica e grupo
//     legal), o prazo limite e a observação clínica;
//   - `lista_espera_item` um por procedimento pedido (sequência 1..n, item da agenda ou procedimento faturável,
//     quantidade, situação 'aguardando');
//   - `lista_espera_historico` evento 'entrada' com o solicitante e os itens.
// Daí em diante o pedido é da fila da agenda (oferta, marcação, encerramento: porta-propria.ts), e os itens
// acompanham o encerramento (pedido-vaga-itens.ts: marcado com a marcação ou cancelado, na mesma transação). O pedido que vem da
// central de regulação nasce no aceite (regulacao-entrada-propria.ts, solicitacao_regulacao_id). Nada se apaga.
import { MAXIMO_ITENS_PEDIDO_VAGA, prioridadeGravadaNaEspera, validarPedidoVaga } from '@sgh/dominio-agenda';
import {
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import { complementoDosPedidos, type ItemPedidoLido } from './pedido-vaga-itens.js';
import { dataNoFuso } from './pre-cadastro-marcacao.js';
import { grupoLegalDaEspera } from './prioridade-espera.js';
import type { NucleoAgenda } from './porta-propria.js';

export type { ItemPedidoLido } from './pedido-vaga-itens.js';

const num = (v: unknown): number => Number(v);
const txt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const dataIso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const instante = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);
const FUSO_PADRAO = 'America/Sao_Paulo';
const id = z.number().int().positive();

export const esquemaPedidoVaga = z
  .object({
    paciente: id,
    especialidade: id.nullable().default(null),
    agenda: id.nullable().default(null),
    prioridade: z.enum(['normal', 'urgente']).default('normal'),
    prioridadeLegal: id.nullable().default(null),
    prazoLimite: z.string().nullable().default(null),
    observacao: z.string().trim().max(600).nullable().default(null),
    itens: z
      .array(
        z
          .object({
            itemAgendavel: id.nullable().default(null),
            itemFaturavel: id.nullable().default(null),
            quantidade: z.number().positive().default(1),
          })
          .strict(),
      )
      .max(MAXIMO_ITENS_PEDIDO_VAGA + 1),
  })
  .strict();
export type EntradaPedidoVaga = z.infer<typeof esquemaPedidoVaga>;

export interface ContextoPedidoVaga {
  readonly hospital: string;
  readonly login: string;
}
export interface PedidoVagaLido {
  readonly id: number;
  readonly situacao: string;
  readonly prioridade: string;
  readonly entradaEm: string | null;
  readonly prazoLimite: string | null;
  readonly especialidade: string | null;
  readonly agenda: string | null;
  readonly solicitante: string | null;
  readonly regulacao: string | null;
  readonly observacao: string | null;
  readonly itens: readonly ItemPedidoLido[];
}
export interface PedidosVagaDoPaciente {
  readonly pedidos: readonly PedidoVagaLido[];
  readonly especialidades: readonly { id: number; nome: string }[];
  readonly itens: readonly { id: number; nome: string; tipo: string }[];
  /** O profissional vinculado ao usuário: sem ele, a tela só lê. */
  readonly solicitante: { id: number; nome: string } | null;
}

/** Profissional vinculado ao usuário no estabelecimento, na data. */
async function profissionalDoUsuario(
  l: Pick<Leitor, 'uma'>,
  usuario: number,
  est: number,
  dia: string,
): Promise<{ id: number; nome: string } | null> {
  const r = await l.uma(
    `SELECT v.profissional_id, pf.nome FROM usuario_vinculo_profissional v
       JOIN profissional pr ON pr.id = v.profissional_id JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
      WHERE v.usuario_id = ? AND v.estabelecimento_id = ? AND v.excluido_em IS NULL AND v.profissional_id IS NOT NULL
        AND v.vigencia_inicio <= ? AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= ?)
      ORDER BY v.vigencia_inicio DESC LIMIT 1`,
    [usuario, est, dia, dia],
  );
  return r ? { id: num(r['profissional_id']), nome: String(r['nome']) } : null;
}

export class PedidosVagaPropria {
  private readonly executor: Executor;
  private readonly incluirOp = definirOperacao<EntradaPedidoVaga, { id: number; itens: number }>({
    nome: 'agenda.pedido_vaga_incluir',
    tabelas: ['lista_espera', 'lista_espera_item', 'lista_espera_historico'],
    entrada: esquemaPedidoVaga as unknown as z.ZodType<EntradaPedidoVaga>,
    gravar: (tx, e, ctx) => this.gravar(tx, e, ctx),
    alvo: (_e, r) => ({ tabela: 'lista_espera', id: r.id }),
  });

  constructor(
    private readonly nucleo: NucleoAgenda,
    private readonly cliente: string,
    private readonly agora: () => Date = () => new Date(),
  ) {
    this.executor = nucleo.criarExecutor();
  }

  private hoje(): string {
    return dataNoFuso(FUSO_PADRAO, this.agora());
  }

  private async quem(c: ContextoPedidoVaga): Promise<{ estabelecimento: number; usuario: number | null }> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: 'pedido-vaga' }, async (l) => {
      const e = await l.uma('SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL', [
        c.hospital,
      ]);
      if (!e)
        throw new ErroOperacao(
          403,
          'estabelecimento-desconhecido',
          'Estabelecimento',
          'O estabelecimento da sessão não existe no cliente.',
        );
      const u = await l.uma('SELECT id FROM usuario WHERE login = ? AND excluido_em IS NULL', [c.login]);
      return { estabelecimento: num(e['id']), usuario: u ? num(u['id']) : null };
    });
  }

  /** Pedidos de vaga do paciente na unidade (abertos primeiro), com os itens, e as opções da tela. */
  async doPaciente(c: ContextoPedidoVaga, paciente: number): Promise<PedidosVagaDoPaciente> {
    const q = await this.quem(c);
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: 'pedido-vaga', estabelecimento: q.estabelecimento },
      async (l) => {
        const ps = await l.consultar(
          `SELECT le.id, le.situacao, le.prioridade, le.entrada_em, le.prazo_limite, le.observacao,
              em.descricao AS especialidade, a.nome AS agenda, pf.nome AS solicitante, sr.numero AS regulacao
             FROM lista_espera le
             LEFT JOIN especialidade_medica em ON em.id = le.especialidade_medica_id
             LEFT JOIN agenda_servico a ON a.id = le.agenda_servico_id
             LEFT JOIN profissional pr ON pr.id = le.solicitante_profissional_id
             LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
             LEFT JOIN solicitacao_regulacao sr ON sr.id = le.solicitacao_regulacao_id
            WHERE le.estabelecimento_id = ? AND le.paciente_id = ? AND le.excluido_em IS NULL
              AND (le.solicitante_profissional_id IS NOT NULL OR le.solicitacao_regulacao_id IS NOT NULL)
            ORDER BY le.situacao IN ('aguardando', 'ofertado') DESC, le.entrada_em DESC LIMIT 100`,
          [q.estabelecimento, paciente],
        );
        const comp = await complementoDosPedidos(
          l,
          ps.map((p) => num(p['id'])),
        );
        const especialidades = await l.consultar(
          'SELECT id, descricao FROM especialidade_medica WHERE ativo ORDER BY descricao LIMIT 500',
        );
        const itens = await l.consultar(
          `SELECT id, descricao, tipo_item FROM item_agendavel WHERE ativo AND excluido_em IS NULL
            ORDER BY descricao LIMIT 1000`,
        );
        const solicitante =
          q.usuario === null
            ? null
            : await profissionalDoUsuario(l, q.usuario, q.estabelecimento, this.hoje());
        return {
          pedidos: ps.map((p) => ({
            id: num(p['id']),
            situacao: String(p['situacao']),
            prioridade: String(p['prioridade']),
            entradaEm: instante(p['entrada_em']),
            prazoLimite: dataIso(p['prazo_limite']),
            especialidade: txt(p['especialidade']),
            agenda: txt(p['agenda']),
            solicitante: txt(p['solicitante']),
            regulacao: txt(p['regulacao']),
            observacao: txt(p['observacao']),
            itens: comp.get(num(p['id']))?.itens ?? [],
          })),
          especialidades: especialidades.map((x) => ({ id: num(x['id']), nome: String(x['descricao']) })),
          itens: itens.map((x) => ({
            id: num(x['id']),
            nome: String(x['descricao']),
            tipo: String(x['tipo_item']),
          })),
          solicitante,
        };
      },
    );
  }

  async incluir(
    c: ContextoPedidoVaga & { correlacao: string; chaveIdempotencia: string; enderecoIp?: string },
    entrada: unknown,
  ): Promise<{ resultado: { id: number; itens: number }; repetida: boolean }> {
    const q = await this.quem(c);
    if (q.usuario === null)
      throw recusa('usuario-sem-conta', 'Pedir vaga exige uma conta de usuário do cliente.');
    const ctx: ContextoOperacao = {
      cliente: this.cliente,
      estabelecimento: q.estabelecimento,
      usuario: q.usuario,
      correlacao: c.correlacao.slice(0, 64),
      chaveIdempotencia: c.chaveIdempotencia.slice(0, 80),
      ...(c.enderecoIp ? { enderecoIp: c.enderecoIp } : {}),
    };
    const r = await this.executor.executar(this.incluirOp, this.cliente, entrada, ctx);
    return { resultado: r.resultado, repetida: r.repetida };
  }

  private async gravar(
    tx: TxOperacao,
    e: EntradaPedidoVaga,
    ctx: ContextoOperacao,
  ): Promise<{ id: number; itens: number }> {
    const est = Number(ctx.estabelecimento);
    const hoje = this.hoje();
    const solicitante = await profissionalDoUsuario(tx, Number(ctx.usuario), est, hoje);
    const regra = validarPedidoVaga({
      solicitante: solicitante?.id ?? null,
      regulacao: null,
      especialidade: e.especialidade,
      agenda: e.agenda,
      itens: e.itens,
      prazoLimite: e.prazoLimite,
      hoje,
    });
    if (!regra.ok)
      throw recusa('pedido-vaga-invalido', regra.problemas.map((p) => p.mensagem).join(' '), {
        campos: regra.problemas.map((p) => p.campo),
      });
    const pac = await tx.uma('SELECT id FROM paciente WHERE id = ? AND excluido_em IS NULL', [e.paciente]);
    if (!pac) throw recusa('paciente-inexistente', 'O paciente não existe.', { campos: ['paciente'] });
    if (e.especialidade !== null) {
      const x = await tx.uma('SELECT id FROM especialidade_medica WHERE id = ? AND ativo', [e.especialidade]);
      if (!x)
        throw recusa('especialidade-inexistente', 'A especialidade não existe ou está inativa.', {
          campos: ['especialidade'],
        });
    }
    if (e.agenda !== null) {
      const x = await tx.uma(
        'SELECT id FROM agenda_servico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [e.agenda, est],
      );
      if (!x)
        throw recusa('agenda-inexistente', 'A agenda não existe neste estabelecimento.', {
          campos: ['agenda'],
        });
    }
    for (const [i, it] of e.itens.entries()) {
      const x =
        it.itemAgendavel !== null
          ? await tx.uma('SELECT id FROM item_agendavel WHERE id = ? AND ativo AND excluido_em IS NULL', [
              it.itemAgendavel,
            ])
          : await tx.uma(
              "SELECT id FROM item_faturavel WHERE id = ? AND situacao = 'ativo' AND excluido_em IS NULL",
              [it.itemFaturavel],
            );
      if (!x)
        throw recusa('item-inexistente', 'Um procedimento pedido não existe ou está inativo.', {
          campos: [`itens.${i}`],
        });
    }
    const grupo = await grupoLegalDaEspera(tx, {
      paciente: e.paciente,
      informada: e.prioridadeLegal,
      data: hoje,
    });
    const prioridade = prioridadeGravadaNaEspera(e.prioridade, grupo);
    const agora = this.agora();
    const lista = await tx.incluir('lista_espera', {
      estabelecimento_id: est,
      paciente_id: e.paciente,
      agenda_servico_id: e.agenda,
      especialidade_medica_id: e.especialidade,
      item_agendavel_id: regra.itemPrincipal,
      prioridade,
      grupo_prioridade_legal_id: grupo,
      solicitante_profissional_id: solicitante!.id,
      situacao: 'aguardando',
      entrada_em: agora,
      prazo_limite: e.prazoLimite,
      observacao: e.observacao || null,
      responsavel_usuario_id: ctx.usuario,
      origem: 'sistema',
    });
    let seq = 0;
    for (const it of e.itens)
      await tx.incluir('lista_espera_item', {
        lista_espera_id: lista,
        sequencia: ++seq,
        item_agendavel_id: it.itemAgendavel,
        item_faturavel_id: it.itemFaturavel,
        quantidade: it.quantidade,
        situacao: 'aguardando',
        origem: 'sistema',
      });
    await tx.incluir('lista_espera_historico', {
      lista_espera_id: lista,
      operacao: 'inclusao',
      evento: 'entrada',
      dados: JSON.stringify({
        prioridade,
        grupoPrioridadeLegal: grupo,
        informada: e.prioridadeLegal,
        solicitante: solicitante!.id,
        itens: e.itens.length,
      }),
      ocorrido_em: agora,
      usuario_id: ctx.usuario,
    });
    return { id: lista, itens: e.itens.length };
  }
}
