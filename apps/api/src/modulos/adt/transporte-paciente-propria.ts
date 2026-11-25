// Pedido de transporte do paciente na alta, na transferência e entre setores (C1-066, 03-PEP linha 125), no banco do
// cliente. As regras são as puras de @sgh/dominio-internacao (transporte-paciente.ts); aqui ficam a leitura e a
// gravação. Contrato de efeito em `solicitacao_transporte_paciente`:
//   - solicitar: o pedido ligado à internação (paciente, atendimento, a alta vigente e o setor atual como origem, que o
//     pedido pode trocar) ou ao atendimento, com tipo, prioridade, destino (setor, estabelecimento externo ou endereço),
//     meio, posição, condição, oxigênio, monitorização, maca, acompanhante e previsão; quem pediu e quando; situação
//     'solicitado';
//   - agendar: previsão, meio, ambulância, posição e acompanhante, situação 'agendado';
//   - iniciar: hora da saída, situação 'em_andamento';
//   - concluir: chegada, retorno do veículo e distância, situação 'concluido';
//   - cancelar: motivo do cadastro (e a observação), situação 'cancelado' — antes da saída; nada se apaga.
// Cada ação confere a versão lida e grava a trilha pelo executor.
import {
  conferirAcaoTransporte,
  conferirPedidoTransporte,
  ordenarFilaTransporte,
  PRIORIDADES_TRANSPORTE,
  SITUACOES_TRANSPORTE,
  TIPOS_TRANSPORTE,
  tipoTransporteDaAlta,
} from '@sgh/dominio-internacao';
import type { Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

/** Nome de cada operação no executor (trilha). */
const OPERACAO = {
  agendar: 'internacao.transporte.agendar',
  iniciar: 'internacao.transporte.iniciar',
  concluir: 'internacao.transporte.concluir',
  cancelar: 'internacao.transporte.cancelar',
} as const;

export const PORTA_TRANSPORTE_PACIENTE = Symbol('PORTA_TRANSPORTE_PACIENTE');

const TABELA = 'solicitacao_transporte_paciente';
const TABELAS = [TABELA];

const iso = (v: unknown): string | null =>
  v === null || v === undefined ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();
const quando = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));
const id = z.number().int().positive();
const idOuNull = id.nullable().default(null);
const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((s) => (s ? s : null));

const esquemaSolicitar = z
  .object({
    internacao: idOuNull,
    atendimento: idOuNull,
    tipo: z.enum(TIPOS_TRANSPORTE),
    prioridade: z.enum(PRIORIDADES_TRANSPORTE).default('rotina'),
    meio: idOuNull,
    posicao: idOuNull,
    origemSetor: idOuNull,
    origemDescricao: texto(150),
    destinoSetor: idOuNull,
    destinoExterno: idOuNull,
    destinoDescricao: texto(150),
    condicao: texto(300),
    requerOxigenio: z.boolean().default(false),
    requerMonitorizacao: z.boolean().default(false),
    requerMaca: z.boolean().default(false),
    acompanhanteProfissional: idOuNull,
    acompanhanteNome: texto(150),
    previsto: quando.nullable().default(null),
    observacao: texto(1000),
  })
  .strict();

const esquemaFiltro = z
  .object({
    situacao: z.enum([...SITUACOES_TRANSPORTE, 'abertos']).optional(),
    internacao: z.coerce.number().int().positive().optional(),
    paciente: z.coerce.number().int().positive().optional(),
  })
  .strict();

export interface TransportePacienteLido {
  readonly id: number;
  readonly paciente: number;
  readonly prontuario: string | null;
  readonly atendimento: number | null;
  readonly internacao: number | null;
  readonly internacaoNumero: string | null;
  readonly alta: number | null;
  readonly tipo: string;
  readonly prioridade: string;
  readonly meio: number | null;
  readonly meioNome: string | null;
  readonly meioExigeAmbulancia: boolean;
  readonly posicao: number | null;
  readonly ambulancia: number | null;
  readonly ambulanciaPlaca: string | null;
  readonly origemSetor: number | null;
  readonly origemNome: string | null;
  readonly destinoSetor: number | null;
  readonly destinoExterno: number | null;
  readonly destinoNome: string | null;
  readonly condicao: string | null;
  readonly requerOxigenio: boolean;
  readonly requerMonitorizacao: boolean;
  readonly requerMaca: boolean;
  readonly acompanhanteNome: string | null;
  readonly solicitado: string;
  readonly previsto: string | null;
  readonly saida: string | null;
  readonly chegada: string | null;
  readonly retorno: string | null;
  readonly distanciaKm: number | null;
  readonly situacao: string;
  readonly motivoCancelamento: string | null;
  readonly observacao: string | null;
  readonly versao: number;
}

const SELECAO = `SELECT t.*, p.numero_prontuario, i.numero AS internacao_numero, m.descricao AS meio_nome,
       m.exige_ambulancia, a.placa AS ambulancia_placa, so.nome AS origem_nome,
       COALESCE(sd.nome, ee.nome, t.destino_descricao) AS destino_nome, mc.descricao AS motivo_nome
  FROM solicitacao_transporte_paciente t
  JOIN paciente p ON p.id = t.paciente_id
  LEFT JOIN internacao i ON i.id = t.internacao_id
  LEFT JOIN meio_transporte m ON m.id = t.meio_transporte_id
  LEFT JOIN ambulancia a ON a.id = t.ambulancia_id
  LEFT JOIN setor_funcional so ON so.id = t.origem_setor_funcional_id
  LEFT JOIN setor_funcional sd ON sd.id = t.destino_setor_funcional_id
  LEFT JOIN estabelecimento_externo ee ON ee.id = t.destino_estabelecimento_externo_id
  LEFT JOIN motivo_cancelamento_transporte mc ON mc.id = t.motivo_cancelamento_transporte_id`;

function lido(x: Record<string, unknown>): TransportePacienteLido {
  return {
    id: num(x['id']),
    paciente: num(x['paciente_id']),
    prontuario: txtOuNull(x['numero_prontuario']),
    atendimento: numOuNull(x['atendimento_id']),
    internacao: numOuNull(x['internacao_id']),
    internacaoNumero: txtOuNull(x['internacao_numero']),
    alta: numOuNull(x['alta_hospitalar_id']),
    tipo: String(x['tipo']),
    prioridade: String(x['prioridade']),
    meio: numOuNull(x['meio_transporte_id']),
    meioNome: txtOuNull(x['meio_nome']),
    meioExigeAmbulancia: bool(x['exige_ambulancia']),
    posicao: numOuNull(x['posicao_paciente_transporte_id']),
    ambulancia: numOuNull(x['ambulancia_id']),
    ambulanciaPlaca: txtOuNull(x['ambulancia_placa']),
    origemSetor: numOuNull(x['origem_setor_funcional_id']),
    origemNome: txtOuNull(x['origem_nome']) ?? txtOuNull(x['origem_descricao']),
    destinoSetor: numOuNull(x['destino_setor_funcional_id']),
    destinoExterno: numOuNull(x['destino_estabelecimento_externo_id']),
    destinoNome: txtOuNull(x['destino_nome']),
    condicao: txtOuNull(x['condicao_transporte']),
    requerOxigenio: bool(x['requer_oxigenio']),
    requerMonitorizacao: bool(x['requer_monitorizacao']),
    requerMaca: bool(x['requer_maca']),
    acompanhanteNome: txtOuNull(x['acompanhante_nome']),
    solicitado: iso(x['solicitado_em'])!,
    previsto: iso(x['previsto_em']),
    saida: iso(x['saida_em']),
    chegada: iso(x['chegada_em']),
    retorno: iso(x['retorno_em']),
    distanciaKm: numOuNull(x['distancia_km']),
    situacao: String(x['situacao']),
    motivoCancelamento: txtOuNull(x['motivo_nome']),
    observacao: txtOuNull(x['observacao']),
    versao: num(x['versao']),
  };
}

async function exigir(l: Leitor, sql: string, p: unknown[], oQue: string): Promise<Record<string, unknown>> {
  const r = await l.uma(sql, p);
  if (!r) throw naoEncontrado(oQue);
  return r;
}

/** Meio de transporte ativo: devolve se exige ambulância (nulo quando não informado). */
async function meioDoPedido(l: Leitor, meio: number | null): Promise<boolean | null> {
  if (meio === null) return null;
  const m = await exigir(
    l,
    'SELECT exige_ambulancia FROM meio_transporte WHERE id = ? AND ativo = TRUE',
    [meio],
    'Meio de transporte',
  );
  return bool(m['exige_ambulancia']);
}

export class PortaTransportePacientePropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, TABELAS, 'internacao.transporte');
  }

  /** Cadastros para as escolhas da tela (só os ativos). */
  opcoes(c: ContextoPortaPropria) {
    return this.ler(c, 'opcoes', async (l, est) => {
      const lista = async (sql: string, p: unknown[] = []) =>
        (await l.consultar(sql, p)).map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
      return {
        meios: (
          await l.consultar(
            'SELECT id, descricao, exige_ambulancia FROM meio_transporte WHERE ativo = TRUE ORDER BY descricao LIMIT 200',
          )
        ).map((x) => ({
          id: num(x['id']),
          nome: String(x['descricao']),
          exigeAmbulancia: bool(x['exige_ambulancia']),
        })),
        posicoes: await lista(
          'SELECT id, descricao AS nome FROM posicao_paciente_transporte WHERE ativo = TRUE ORDER BY descricao LIMIT 200',
        ),
        ambulancias: await lista(
          `SELECT id, CONCAT(placa, COALESCE(CONCAT(' · ', descricao), '')) AS nome FROM ambulancia
            WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL ORDER BY placa LIMIT 500`,
          [est.id],
        ),
        setores: await lista(
          `SELECT id, nome FROM setor_funcional WHERE estabelecimento_id = ? AND excluido_em IS NULL
            ORDER BY nome LIMIT 2000`,
          [est.id],
        ),
        externos: await lista(
          `SELECT id, nome FROM estabelecimento_externo
            WHERE ativo = TRUE AND recebe_transferencia = TRUE AND excluido_em IS NULL ORDER BY nome LIMIT 3000`,
        ),
        motivos: await lista(
          `SELECT id, descricao AS nome FROM motivo_cancelamento_transporte
            WHERE ativo = TRUE AND tipo_uso IN ('cancelamento', 'ambos') ORDER BY descricao LIMIT 200`,
        ),
      };
    });
  }

  /** A internação vista para o pedido: paciente, setor atual, a alta vigente e o tipo sugerido pelo destino dela. */
  internacao(c: ContextoPortaPropria, internacaoId: number) {
    return this.ler(c, 'internacao', async (l, est) => {
      const i = await exigir(
        l,
        `SELECT i.id, i.numero, i.paciente_id, i.atendimento_id, i.situacao, p.numero_prontuario,
                u.setor_funcional_id
           FROM internacao i JOIN paciente p ON p.id = i.paciente_id
           JOIN unidade_internacao u ON u.id = i.unidade_internacao_id
          WHERE i.id = ? AND i.estabelecimento_id = ? AND i.excluido_em IS NULL`,
        [internacaoId, est.id],
        'Internação',
      );
      const alta = await l.uma(
        `SELECT id, destino, destino_estabelecimento_externo_id, alta_em FROM alta_hospitalar
          WHERE internacao_id = ? AND situacao <> 'cancelada' AND excluido_em IS NULL ORDER BY id DESC LIMIT 1`,
        [internacaoId],
      );
      return {
        id: num(i['id']),
        numero: String(i['numero']),
        paciente: num(i['paciente_id']),
        prontuario: txtOuNull(i['numero_prontuario']),
        atendimento: num(i['atendimento_id']),
        situacao: String(i['situacao']),
        setorAtual: numOuNull(i['setor_funcional_id']),
        alta: alta
          ? {
              id: num(alta['id']),
              destino: String(alta['destino']),
              destinoExterno: numOuNull(alta['destino_estabelecimento_externo_id']),
              em: iso(alta['alta_em']),
            }
          : null,
        tipoSugerido: alta ? tipoTransporteDaAlta(String(alta['destino'])) : ('interno' as const),
      };
    });
  }

  /** Fila (abertos, por prioridade e previsão) ou os pedidos da internação ou do paciente (o histórico inteiro). */
  async listar(c: ContextoPortaPropria, filtro: unknown): Promise<TransportePacienteLido[]> {
    const f = entradaValida(esquemaFiltro, filtro);
    return this.ler(c, 'listar', async (l, est) => {
      const situacao = f.situacao ?? (f.internacao || f.paciente ? null : 'abertos');
      const abertos = situacao === 'abertos' ? 1 : 0;
      const exata = situacao && situacao !== 'abertos' ? situacao : null;
      const rs = await l.consultar(
        `${SELECAO}
          WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL
            AND (? = 0 OR t.situacao IN ('solicitado', 'agendado', 'em_andamento'))
            AND (? IS NULL OR t.situacao = ?)
            AND (? IS NULL OR t.internacao_id = ?) AND (? IS NULL OR t.paciente_id = ?)
          ORDER BY t.solicitado_em DESC, t.id DESC LIMIT 1000`,
        [
          est.id,
          abertos,
          exata,
          exata,
          f.internacao ?? null,
          f.internacao ?? null,
          f.paciente ?? null,
          f.paciente ?? null,
        ],
      );
      const itens = rs.map(lido);
      return abertos ? ordenarFilaTransporte(itens) : itens;
    });
  }

  async solicitar(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaSolicitar, entrada);
    return this.gravar(c, 'internacao.transporte.solicitar', TABELAS, async (tx, est, usuario) => {
      const agora = new Date();
      // Paciente, atendimento, alta e origem pela internação (ou pelo atendimento), sempre do estabelecimento da sessão.
      let paciente: number;
      let atendimento: number | null = e.atendimento;
      let alta: number | null = null;
      let origemSetor = e.origemSetor;
      if (e.internacao !== null) {
        const i = await exigir(
          tx,
          `SELECT i.paciente_id, i.atendimento_id, u.setor_funcional_id FROM internacao i
             JOIN unidade_internacao u ON u.id = i.unidade_internacao_id
            WHERE i.id = ? AND i.estabelecimento_id = ? AND i.excluido_em IS NULL`,
          [e.internacao, est.id],
          'Internação',
        );
        paciente = num(i['paciente_id']);
        atendimento = num(i['atendimento_id']);
        if (origemSetor === null && e.origemDescricao === null)
          origemSetor = numOuNull(i['setor_funcional_id']);
        const a = await tx.uma(
          `SELECT id FROM alta_hospitalar WHERE internacao_id = ? AND situacao <> 'cancelada' AND excluido_em IS NULL
            ORDER BY id DESC LIMIT 1`,
          [e.internacao],
        );
        alta = a ? num(a['id']) : null;
      } else {
        const a = await exigir(
          tx,
          'SELECT paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.atendimento ?? 0, est.id],
          'Atendimento',
        );
        paciente = num(a['paciente_id']);
      }
      for (const [setor, oQue] of [
        [origemSetor, 'Setor de origem'],
        [e.destinoSetor, 'Setor de destino'],
      ] as const)
        if (setor !== null)
          await exigir(
            tx,
            'SELECT id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
            [setor, est.id],
            oQue,
          );
      if (e.destinoExterno !== null)
        await exigir(
          tx,
          'SELECT id FROM estabelecimento_externo WHERE id = ? AND ativo = TRUE AND excluido_em IS NULL',
          [e.destinoExterno],
          'Estabelecimento de destino',
        );
      if (e.posicao !== null)
        await exigir(
          tx,
          'SELECT id FROM posicao_paciente_transporte WHERE id = ? AND ativo = TRUE',
          [e.posicao],
          'Posição do paciente',
        );
      if (e.acompanhanteProfissional !== null)
        await exigir(
          tx,
          'SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL',
          [e.acompanhanteProfissional],
          'Profissional acompanhante',
        );
      const meioExigeAmbulancia = await meioDoPedido(tx, e.meio);
      const abertos =
        e.internacao === null
          ? 0
          : num(
              (
                await tx.uma(
                  `SELECT COUNT(*) AS n FROM solicitacao_transporte_paciente
                    WHERE internacao_id = ? AND tipo = ? AND excluido_em IS NULL
                      AND situacao IN ('solicitado', 'agendado', 'em_andamento')`,
                  [e.internacao, e.tipo],
                )
              )?.['n'],
            );
      const p = conferirPedidoTransporte({
        tipo: e.tipo,
        prioridade: e.prioridade,
        internacao: e.internacao,
        atendimento,
        origemSetor,
        origemDescricao: e.origemDescricao,
        destinoSetor: e.destinoSetor,
        destinoExterno: e.destinoExterno,
        destinoDescricao: e.destinoDescricao,
        requerOxigenio: e.requerOxigenio,
        requerMonitorizacao: e.requerMonitorizacao,
        meioExigeAmbulancia,
        previsto: e.previsto,
        abertosMesmoTipo: abertos,
        agora,
      });
      if (p.length) throw recusaRegra('Pedido de transporte recusado', p);
      const novo = await tx.incluir(TABELA, {
        estabelecimento_id: est.id,
        paciente_id: paciente,
        atendimento_id: atendimento,
        internacao_id: e.internacao,
        alta_hospitalar_id: alta,
        tipo: e.tipo,
        prioridade: e.prioridade,
        meio_transporte_id: e.meio,
        posicao_paciente_transporte_id: e.posicao,
        origem_setor_funcional_id: origemSetor,
        origem_descricao: e.origemDescricao,
        destino_setor_funcional_id: e.destinoSetor,
        destino_estabelecimento_externo_id: e.destinoExterno,
        destino_descricao: e.destinoDescricao,
        condicao_transporte: e.condicao,
        requer_oxigenio: e.requerOxigenio,
        requer_monitorizacao: e.requerMonitorizacao,
        requer_maca: e.requerMaca,
        acompanhante_profissional_id: e.acompanhanteProfissional,
        acompanhante_nome: e.acompanhanteNome,
        solicitante_usuario_id: usuario,
        solicitado_em: agora,
        previsto_em: e.previsto,
        situacao: 'solicitado',
        observacao: e.observacao,
      });
      return { tabela: TABELA, id: novo };
    });
  }

  /** Ação no pedido (agendar, saída, chegada, cancelar), com a regra do domínio e a versão lida. */
  private agir(
    c: ContextoPortaPropria,
    alvo: number,
    acao: 'agendar' | 'iniciar' | 'concluir' | 'cancelar',
    versao: number,
    montar: (
      t: Record<string, unknown>,
      tx: Leitor,
      agora: Date,
    ) => Promise<{
      campos: Record<string, unknown>;
      meio: number | null;
      ambulancia: number | null;
      previsto?: Date | null;
      saida?: Date | null;
      chegada?: Date | null;
      retorno?: Date | null;
      distanciaKm?: number | null;
      motivo?: number | null;
    }>,
  ): Promise<{ id: number; situacao: string }> {
    return this.gravar(c, OPERACAO[acao], TABELAS, async (tx, est) => {
      const t = await exigir(
        tx,
        `SELECT situacao, meio_transporte_id, ambulancia_id, previsto_em, saida_em, requer_oxigenio,
                requer_monitorizacao FROM solicitacao_transporte_paciente
          WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [alvo, est.id],
        'Pedido de transporte',
      );
      const agora = new Date();
      const m = await montar(t, tx, agora);
      const exige = await meioDoPedido(tx, m.meio);
      const r = conferirAcaoTransporte({
        acao,
        situacao: String(t['situacao']),
        meioDefinido: m.meio !== null,
        meioExigeAmbulancia: exige === true,
        requerOxigenio: bool(t['requer_oxigenio']),
        requerMonitorizacao: bool(t['requer_monitorizacao']),
        ambulancia: m.ambulancia,
        previsto: m.previsto ?? null,
        saida: m.saida ?? null,
        chegada: m.chegada ?? null,
        retorno: m.retorno ?? null,
        distanciaKm: m.distanciaKm ?? null,
        motivoCancelamento: m.motivo ?? null,
        agora,
      });
      if (!r.situacao) throw recusaRegra('Transporte recusado', r.problemas);
      await tx.alterar(TABELA, alvo, versao, { ...m.campos, situacao: r.situacao });
      return { tabela: TABELA, id: alvo, situacao: r.situacao };
    });
  }

  agendar(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const x = entradaValida(
      z
        .object({
          previsto: quando,
          meio: idOuNull,
          ambulancia: idOuNull,
          posicao: idOuNull,
          acompanhanteNome: texto(150),
          versao: z.number().int().positive(),
        })
        .strict(),
      entrada,
    );
    return this.agir(c, alvo, 'agendar', x.versao, async (t, tx) => {
      const meio = x.meio ?? numOuNull(t['meio_transporte_id']);
      const ambulancia = x.ambulancia ?? numOuNull(t['ambulancia_id']);
      if (x.ambulancia !== null) await this.exigirAmbulancia(c, tx, x.ambulancia);
      if (x.posicao !== null)
        await exigir(
          tx,
          'SELECT id FROM posicao_paciente_transporte WHERE id = ? AND ativo = TRUE',
          [x.posicao],
          'Posição do paciente',
        );
      return {
        meio,
        ambulancia,
        previsto: x.previsto,
        campos: {
          previsto_em: x.previsto,
          meio_transporte_id: meio,
          ambulancia_id: ambulancia,
          ...(x.posicao !== null ? { posicao_paciente_transporte_id: x.posicao } : {}),
          ...(x.acompanhanteNome !== null ? { acompanhante_nome: x.acompanhanteNome } : {}),
        },
      };
    });
  }

  iniciar(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const x = entradaValida(
      z
        .object({
          saida: quando.optional(),
          ambulancia: idOuNull,
          versao: z.number().int().positive(),
        })
        .strict(),
      entrada,
    );
    return this.agir(c, alvo, 'iniciar', x.versao, async (t, tx, agora) => {
      const ambulancia = x.ambulancia ?? numOuNull(t['ambulancia_id']);
      if (x.ambulancia !== null) await this.exigirAmbulancia(c, tx, x.ambulancia);
      const saida = x.saida ?? agora;
      return {
        meio: numOuNull(t['meio_transporte_id']),
        ambulancia,
        saida,
        campos: { saida_em: saida, ambulancia_id: ambulancia },
      };
    });
  }

  concluir(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const x = entradaValida(
      z
        .object({
          chegada: quando.optional(),
          retorno: quando.nullable().default(null),
          distanciaKm: z.number().max(100_000).nullable().default(null),
          versao: z.number().int().positive(),
        })
        .strict(),
      entrada,
    );
    return this.agir(c, alvo, 'concluir', x.versao, async (t, _tx, agora) => {
      const chegada = x.chegada ?? agora;
      return {
        meio: numOuNull(t['meio_transporte_id']),
        ambulancia: numOuNull(t['ambulancia_id']),
        saida: t['saida_em'] ? new Date(iso(t['saida_em'])!) : null,
        chegada,
        retorno: x.retorno,
        distanciaKm: x.distanciaKm,
        campos: { chegada_em: chegada, retorno_em: x.retorno, distancia_km: x.distanciaKm },
      };
    });
  }

  cancelar(c: ContextoPortaPropria, alvo: number, entrada: unknown) {
    const x = entradaValida(
      z
        .object({
          motivo: id.nullable().default(null),
          observacao: texto(1000),
          versao: z.number().int().positive(),
        })
        .strict(),
      entrada,
    );
    return this.agir(c, alvo, 'cancelar', x.versao, async (t, tx) => {
      if (x.motivo !== null)
        await exigir(
          tx,
          `SELECT id FROM motivo_cancelamento_transporte
            WHERE id = ? AND ativo = TRUE AND tipo_uso IN ('cancelamento', 'ambos')`,
          [x.motivo],
          'Motivo do cancelamento',
        );
      return {
        meio: numOuNull(t['meio_transporte_id']),
        ambulancia: numOuNull(t['ambulancia_id']),
        motivo: x.motivo,
        campos: {
          motivo_cancelamento_transporte_id: x.motivo,
          ...(x.observacao !== null ? { observacao: x.observacao } : {}),
        },
      };
    });
  }

  private async exigirAmbulancia(c: ContextoPortaPropria, tx: Leitor, ambulancia: number): Promise<void> {
    await exigir(
      tx,
      `SELECT a.id FROM ambulancia a JOIN estabelecimento e ON e.id = a.estabelecimento_id
        WHERE a.id = ? AND a.ativo = TRUE AND a.excluido_em IS NULL AND e.codigo = ?`,
      [ambulancia, c.hospital],
      'Ambulância',
    );
  }
}
