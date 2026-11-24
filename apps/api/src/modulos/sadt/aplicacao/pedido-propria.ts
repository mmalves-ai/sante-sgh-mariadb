// Pedido de exames, cancelamento do item, kit com versão, recoleta e sub-amostras no banco do cliente (F3.5, 05-SADT
// linhas 4, 5 e 7). Cada gravação é uma operação do Executor do núcleo, com a trilha na mesma transação; a regra mora em
// @sgh/dominio-sadt (pedido.ts e recoleta.ts) e aqui fica só a leitura do cadastro e a gravação do que a regra decide.
// Nada se apaga: o item cancelado fica com o motivo e o evento, a amostra rejeitada fica ligada à recoleta e a primária
// fica ligada às alíquotas.
import {
  codigoDaAmostra,
  conferirAliquotagem,
  conferirCancelamento,
  conferirColetaDaRecoleta,
  conferirFechamentoRecoleta,
  conferirRecoleta,
  decisaoDoPedido,
  destinoDosExamesAoCancelar,
  type ExameDaAmostra,
  idadeEmDias,
  itensDaVersaoDoKit,
  itensDoPedido,
  type KitNoPedido,
  planoDeSubamostras,
  RecusaAmostra,
  RecusaPedido,
  type RegraRestricao,
  type RegraSubamostra,
  type RestricaoAcionada,
  restricoesAcionadas,
  type Sexo,
} from '@sgh/dominio-sadt';
import {
  type ContextoNucleo,
  definirOperacao,
  type Executor,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FUSO_PADRAO, relogioNoFuso } from '../../exames/relogio.js';
import type { NucleoSadt } from '../porta-propria.js';
import type { ContextoSadt } from '../porta.js';

// ── Entradas (validadas na rota e de novo aqui) ─────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const exameDoPedido = z.object({
  exame: id,
  setor: id.nullable().default(null),
  material: id.nullable().default(null),
  quantidade: z.number().int().min(1).max(99).default(1),
  urgente: z.boolean().default(false),
});

export const esquemaPedidoExames = z.object({
  atendimento: id,
  setor: id,
  solicitante: id.nullable().default(null),
  tipo: z.enum(['pedido_prontuario', 'lancado_no_setor', 'externo']).default('lancado_no_setor'),
  prioridade: z.enum(['rotina', 'urgente', 'emergencia']).default('rotina'),
  exames: z.array(exameDoPedido).max(200).default([]),
  kits: z.array(id).max(20).default([]),
  indicacaoClinica: z.string().trim().max(2000).nullable().default(null),
  confirmado: z.boolean().default(false),
  justificativa: z.string().trim().max(500).nullable().default(null),
});
export type PedidoExames = z.infer<typeof esquemaPedidoExames>;

export const esquemaCancelarItem = z.object({
  motivo: id,
  complemento: z.string().trim().max(500).nullable().default(null),
  notificarSolicitante: z.boolean().default(false),
});

export const esquemaVersaoKit = z.object({
  kit: id.nullable().default(null),
  codigo: z.string().trim().min(1).max(30).nullable().default(null),
  nome: z.string().trim().min(2).max(150),
  geraBateria: z.boolean().default(false),
  horaSugeridaColeta: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .default(null),
  itens: z
    .array(exameDoPedido.omit({ urgente: true }))
    .min(1)
    .max(100),
});

export const esquemaPedirRecoleta = z.object({
  motivo: id,
  observacao: z.string().trim().max(2000).nullable().default(null),
  coletaPrevistaEm: z.string().datetime({ offset: true }).nullable().default(null),
});

export const esquemaCancelarRecoleta = z.object({
  motivo: z.string().trim().min(5).max(500),
  /** O que acontece com os exames que esperavam a recoleta: cancelar com o motivo do cadastro ou manter pendentes. */
  destinoExames: z.enum(['cancelar', 'manter']).nullable().default(null),
  motivoCancelamentoExame: id.nullable().default(null),
});

/** A coleta da recoleta com a identificação positiva do paciente (a mesma exigência da coleta comum). */
export const esquemaColetarRecoleta = z.object({
  identificadoresConferidos: z.boolean().default(false),
  pulseira: z.string().trim().max(120).nullable().default(null),
  estacao: z.string().trim().max(64).nullable().default(null),
});

// ── Saídas ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface AvaliacaoDoPedido {
  readonly itens: readonly { sequencia: number; exame: number; kitVersao: number | null }[];
  readonly restricoes: readonly RestricaoAcionada[];
  readonly segue: boolean;
  readonly codigo: string | null;
  readonly motivo: string | null;
}

export interface PedidoGravado {
  readonly requisicao: number;
  readonly numero: string;
  readonly itens: readonly { id: number; exame: number; sequencia: number }[];
  readonly excecoes: number;
}

export interface KitVigente {
  readonly id: number;
  readonly codigo: string;
  readonly nome: string;
  readonly versao: number;
  readonly numeroVersao: number;
  readonly itens: readonly { exame: number; nome: string; material: number | null; quantidade: number }[];
}

export interface RecoletaLida {
  readonly id: number;
  readonly numero: string;
  readonly situacao: string;
  readonly amostraOriginal: number;
  readonly codigoOriginal: string;
  readonly novaAmostra: number | null;
  readonly motivo: string;
  readonly solicitadaEm: string;
  readonly paciente: number;
}

export interface AtendimentoDoPedido {
  readonly id: number;
  readonly numero: string;
  readonly paciente: number;
  readonly nome: string;
  readonly prontuario: string;
  readonly sexo: Sexo | null;
  readonly nascimento: string | null;
  readonly idadeAnos: number | null;
}

// ── Utilitários ─────────────────────────────────────────────────────────────────────────────────────────────

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
const dataIso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const hora = (v: unknown) => (v === null || v === undefined ? null : String(v).slice(0, 5));

/** As recusas da regra viram o problema da API (422 com o código). */
function daRegra<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RecusaPedido || e instanceof RecusaAmostra) throw recusa(e.codigo, e.message);
    throw e;
  }
}

export const TABELAS_PEDIDO = [
  'requisicao_exame',
  'exame_item',
  'item_exame_evento',
  'excecao_restricao_exame',
  'kit_exame',
  'kit_exame_versao',
  'kit_exame_versao_item',
  'amostra_biologica',
  'amostra_biologica_exame',
  'amostra_biologica_evento',
  'nova_coleta',
  'sequencia_negocio',
] as const;

async function relogio(l: Leitor, est: number) {
  const f = await l.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
  return relogioNoFuso(texto(f?.['fuso_horario']) || FUSO_PADRAO);
}

const sexoDe = (sigla: unknown): Sexo | null => {
  const s = texto(sigla).toUpperCase();
  return s === 'F' ? 'feminino' : s === 'M' ? 'masculino' : null;
};

function regraDe(r: Linha): RegraRestricao {
  return {
    id: n(r['id']),
    exame: n(r['exame_id']),
    tipo: texto(r['tipo_restricao']) === 'alerta' ? 'alerta' : 'bloqueio',
    setor: nn(r['setor_diagnostico_id']),
    unidade: nn(r['unidade_assistencial_id']),
    material: nn(r['material_biologico_id']),
    sexo: r['sexo'] === null ? null : (texto(r['sexo']) as Sexo),
    idadeMinimaDias: nn(r['idade_minima_dias']),
    idadeMaximaDias: nn(r['idade_maxima_dias']),
    tipoAtendimento: null,
    diaSemana: nn(r['dia_semana']),
    horaInicio: hora(r['hora_inicio']),
    horaFim: hora(r['hora_fim']),
    intervaloMinimoDias: nn(r['intervalo_minimo_dias']),
    permiteExcecao: Boolean(r['permite_excecao']),
    mensagem: texto(r['mensagem']),
    vigenciaInicio: dataIso(r['vigencia_inicio']) ?? '1900-01-01',
    vigenciaFim: dataIso(r['vigencia_fim']),
  };
}

const SELECT_ATENDIMENTO = `SELECT a.id, a.numero, a.paciente_id, pa.numero_prontuario, pf.nome, pf.nome_social,
       pf.usa_nome_social, pf.data_nascimento, sx.sigla AS sexo
  FROM atendimento a JOIN paciente pa ON pa.id = a.paciente_id
  JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id LEFT JOIN sexo sx ON sx.id = pf.sexo_id`;

function atendimentoDe(a: Linha): AtendimentoDoPedido {
  const nasc = dataIso(a['data_nascimento']);
  const dias = nasc ? idadeEmDias(nasc, new Date().toISOString().slice(0, 10)) : null;
  const social = Number(a['usa_nome_social'] ?? 0) === 1 || a['usa_nome_social'] === true;
  return {
    id: n(a['id']),
    numero: texto(a['numero']),
    paciente: n(a['paciente_id']),
    nome: social && a['nome_social'] ? texto(a['nome_social']) : texto(a['nome']),
    prontuario: texto(a['numero_prontuario']),
    sexo: sexoDe(a['sexo']),
    nascimento: nasc,
    idadeAnos: dias === null ? null : Math.floor(dias / 365.25),
  };
}

// ── Serviço ─────────────────────────────────────────────────────────────────────────────────────────────────

export class ServicoPedidoSadt {
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

  private ler<T>(c: ContextoSadt, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = this.est(c);
    return this.nucleo.lerSomente(this.ctxNucleo(c), (l) => fn(l, est));
  }

  /** Uma gravação pelo Executor: trilha com a tabela e o id do alvo, idempotente pela chave da tela. */
  private async gravar<T extends { readonly id?: number; readonly requisicao?: number }>(
    c: ContextoSadt,
    nome: string,
    tabela: string,
    fn: (tx: TxOperacao, est: number) => Promise<T>,
  ): Promise<T> {
    const est = this.est(c);
    let saida: { valor: T } | null = null;
    const op = definirOperacao({
      nome,
      tabelas: TABELAS_PEDIDO,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(tx, est) };
        return { valor: JSON.stringify(saida.valor) };
      },
      alvo: () => ({
        tabela,
        id: saida ? (saida.valor.id ?? saida.valor.requisicao ?? null) : null,
      }),
      trilha: () => ({ dados: { evento: nome }, motivo: null }),
    });
    const chave = `sadt:${c.chaveIdempotencia ?? randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...this.ctxNucleo(c), chaveIdempotencia: chave },
    );
    if (saida) return (saida as { valor: T }).valor;
    const v = r.resultado['valor'];
    return (typeof v === 'string' ? JSON.parse(v) : null) as T;
  }

  // ── Pedido ────────────────────────────────────────────────────────────────────────────────────────────────

  /** A avaliação do pedido antes de gravar (a tela mostra os avisos na hora, sem gravar nada). */
  avaliarPedido(c: ContextoSadt, entrada: unknown, podeAutorizarExcecao = false): Promise<AvaliacaoDoPedido> {
    const p = esquemaPedidoExames.parse(entrada);
    return this.ler(c, async (l, est) => {
      const a = await this.avaliar(l, est, p, podeAutorizarExcecao);
      return {
        itens: a.itens.map((i) => ({ sequencia: i.sequencia, exame: i.exame, kitVersao: i.kitVersao })),
        restricoes: a.acionadas,
        ...a.decisao,
      };
    });
  }

  private async avaliar(l: Leitor, est: number, p: PedidoExames, podeAutorizarExcecao: boolean) {
    const at = await l.uma(
      `SELECT a.id, a.paciente_id, a.fonte_pagadora_id, a.profissional_id, a.unidade_assistencial_id,
              pf.data_nascimento, sx.sigla AS sexo
         FROM atendimento a JOIN paciente pa ON pa.id = a.paciente_id
         JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id LEFT JOIN sexo sx ON sx.id = pf.sexo_id
        WHERE a.id = ? AND a.estabelecimento_id = ?`,
      [p.atendimento, est],
    );
    if (!at) throw recusa('atendimento-inexistente', 'O atendimento não existe neste estabelecimento.');
    const setor = await l.uma(
      'SELECT id FROM setor_diagnostico WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [p.setor, est],
    );
    if (!setor) throw recusa('setor-inexistente', 'O setor executante não existe neste estabelecimento.');
    const kits: KitNoPedido[] = [];
    for (const k of p.kits) {
      const v = await l.uma(
        `SELECT v.id, v.numero_versao FROM kit_exame k JOIN kit_exame_versao v ON v.kit_exame_id = k.id
          WHERE k.id = ? AND k.ativo = TRUE AND k.excluido_em IS NULL AND v.vigencia_fim IS NULL
          ORDER BY v.numero_versao DESC LIMIT 1`,
        [k],
      );
      if (!v) throw recusa('kit-inexistente', 'O kit não existe, está inativo ou não tem versão vigente.');
      const itens = await l.consultar(
        `SELECT exame_id, setor_diagnostico_id, material_biologico_id, quantidade FROM kit_exame_versao_item
          WHERE kit_exame_versao_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [n(v['id'])],
      );
      kits.push({
        kit: k,
        versao: n(v['id']),
        numeroVersao: n(v['numero_versao']),
        itens: itens.map((i) => ({
          exame: n(i['exame_id']),
          setor: nn(i['setor_diagnostico_id']),
          material: nn(i['material_biologico_id']),
          quantidade: n(i['quantidade']),
        })),
      });
    }
    const urgente = p.prioridade !== 'rotina';
    const montados = daRegra(() =>
      itensDoPedido(
        p.exames.map((e) => ({ ...e, urgente: e.urgente || urgente })),
        kits,
        urgente,
      ),
    );
    // O setor de cada item (avulso ou de kit) é do estabelecimento da sessão, como o setor do pedido.
    const setoresItens = [...new Set(montados.map((i) => i.setor).filter((x): x is number => x !== null))];
    if (setoresItens.length) {
      const sOk = await l.consultar(
        `SELECT id FROM setor_diagnostico WHERE estabelecimento_id = ? AND excluido_em IS NULL AND id IN (${lista(setoresItens.length)})`,
        [est, ...setoresItens],
      );
      if (sOk.length !== setoresItens.length)
        throw recusa(
          'setor-inexistente',
          'O setor executante de algum exame não existe neste estabelecimento.',
        );
    }
    const exames = [...new Set(montados.map((i) => i.exame))];
    // Sem material escolhido, vale o material padrão do cadastro do exame (a restrição por material é avaliada nele).
    const padroes = await l.consultar(
      `SELECT exame_id, MIN(material_biologico_id) AS material FROM exame_material
        WHERE exame_id IN (${lista(exames.length)}) GROUP BY exame_id`,
      exames,
    );
    const padraoDe = (exame: number) =>
      nn(padroes.find((x) => n(x['exame_id']) === exame)?.['material'] ?? null);
    const itens = montados.map((i) => ({ ...i, material: i.material ?? padraoDe(i.exame) }));
    const ok = await l.consultar(
      `SELECT id FROM exame WHERE ativo = TRUE AND excluido_em IS NULL AND id IN (${lista(exames.length)})`,
      exames,
    );
    if (ok.length !== exames.length)
      throw recusa('exame-inexistente', 'Algum exame do pedido não existe ou está inativo.');
    const rel = await relogio(l, est);
    const regras = (
      await l.consultar(
        `SELECT * FROM restricao_exame WHERE estabelecimento_id = ? AND ativo = TRUE AND exame_id IN (${lista(exames.length)})`,
        [est, ...exames],
      )
    ).map(regraDe);
    const paciente = n(at['paciente_id']);
    const excecoes = regras.length
      ? await l.consultar(
          `SELECT id, restricao_exame_id FROM excecao_restricao_exame
            WHERE ativo = TRUE AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
              AND restricao_exame_id IN (${lista(regras.length)})
              AND ((abrangencia = 'estabelecimento' AND estabelecimento_id = ?) OR (abrangencia = 'paciente' AND paciente_id = ?))`,
          [rel.hoje, rel.hoje, ...regras.map((r) => r.id), est, paciente],
        )
      : [];
    const excecaoDe = (regra: number) => {
      const e = excecoes.find((x) => n(x['restricao_exame_id']) === regra);
      return e ? n(e['id']) : null;
    };
    const anteriores = regras.some((r) => r.intervaloMinimoDias)
      ? await l.consultar(
          `SELECT ei.exame_id, r.solicitado_em FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
            WHERE r.paciente_id = ? AND ei.situacao NOT IN ('cancelado','recusado') AND ei.excluido_em IS NULL
              AND ei.exame_id IN (${lista(exames.length)})`,
          [paciente, ...exames],
        )
      : [];
    const nasc = dataIso(at['data_nascimento']);
    const acionadas = itens.flatMap((i) =>
      restricoesAcionadas(
        regras,
        {
          exame: i.exame,
          setor: i.setor ?? p.setor,
          material: i.material,
          unidade: nn(at['unidade_assistencial_id']),
          tipoAtendimento: null,
          sexo: sexoDe(at['sexo']),
          idadeDias: idadeEmDias(nasc, rel.hoje),
          data: rel.hoje,
          hora: rel.hora,
          anteriores: anteriores
            .filter((x) => n(x['exame_id']) === i.exame)
            .map((x) => dataIso(x['solicitado_em']) ?? ''),
        },
        excecaoDe,
      ),
    );
    const decisao = decisaoDoPedido(acionadas, {
      confirmado: p.confirmado,
      justificativa: p.justificativa,
      podeAutorizarExcecao,
    });
    return { at, itens, acionadas, decisao, paciente };
  }

  /** Abre a requisição com os itens (avulsos e de kit), já com as restrições decididas e as exceções registradas. */
  abrirPedido(c: ContextoSadt, entrada: unknown, podeAutorizarExcecao = false): Promise<PedidoGravado> {
    const p = esquemaPedidoExames.parse(entrada);
    return this.gravar(c, 'sadt.pedido.aberto', 'requisicao_exame', (tx, est) =>
      this.abrirNaTransacao(tx, est, p, podeAutorizarExcecao),
    );
  }

  /**
   * O corpo da abertura do pedido dentro de uma transação já aberta (a conversão do orçamento abre o pedido na mesma
   * transação que marca o orçamento convertido). As tabelas tocadas são as de TABELAS_PEDIDO.
   */
  async abrirNaTransacao(
    tx: TxOperacao,
    est: number,
    p: PedidoExames,
    podeAutorizarExcecao = false,
  ): Promise<PedidoGravado> {
    const a = await this.avaliar(tx, est, p, podeAutorizarExcecao);
    if (!a.decisao.segue)
      throw recusa(a.decisao.codigo ?? 'restricao', a.decisao.motivo ?? 'Pedido recusado.');
    const usuario = tx.contexto.usuario;
    const agora = new Date();
    const numero = (await tx.proximoNumero('requisicao_exame')).formatado;
    const requisicao = await tx.incluir('requisicao_exame', {
      estabelecimento_id: est,
      numero,
      paciente_id: a.paciente,
      atendimento_id: p.atendimento,
      setor_diagnostico_id: p.setor,
      solicitante_profissional_id: p.solicitante ?? n(a.at['profissional_id']),
      unidade_assistencial_id: nn(a.at['unidade_assistencial_id']),
      fonte_pagadora_id: n(a.at['fonte_pagadora_id']),
      tipo_solicitacao: p.tipo,
      prioridade: p.prioridade,
      situacao: 'solicitada',
      solicitado_em: agora,
      indicacao_clinica: p.indicacaoClinica,
      origem: 'sistema',
    });
    const gravados: { id: number; exame: number; sequencia: number }[] = [];
    let excecoes = 0;
    for (const i of a.itens) {
      const item = await tx.incluir('exame_item', {
        requisicao_exame_id: requisicao,
        sequencia: i.sequencia,
        exame_id: i.exame,
        setor_diagnostico_id: i.setor ?? p.setor,
        material_biologico_id: i.material,
        quantidade: i.quantidade,
        urgente: i.urgente,
        situacao: 'solicitado',
        origem: 'sistema',
      });
      const doItem = a.acionadas.filter((x) => x.exame === i.exame);
      await tx.incluir('item_exame_evento', {
        exame_item_id: item,
        operacao: 'inclusao',
        evento: 'solicitado',
        ocorrido_em: agora,
        usuario_id: usuario,
        situacao_nova: 'solicitado',
        setor_diagnostico_id: i.setor ?? p.setor,
        dados: JSON.stringify({
          kitVersao: i.kitVersao,
          restricoes: doItem.map((x) => ({
            regra: x.regra,
            tipo: x.tipo,
            motivo: x.motivo,
            excecao: x.excecao,
          })),
        }),
      });
      for (const regra of a.decisao.excecoesNovas) {
        if (!doItem.some((x) => x.regra === regra)) continue;
        await tx.incluir('excecao_restricao_exame', {
          restricao_exame_id: regra,
          abrangencia: 'item_exame',
          exame_item_id: item,
          justificativa: p.justificativa,
          autorizado_por_usuario_id: usuario,
          autorizado_em: agora,
          vigencia_inicio: agora.toISOString().slice(0, 10),
          ativo: true,
        });
        excecoes += 1;
      }
      gravados.push({ id: item, exame: i.exame, sequencia: i.sequencia });
    }
    return { requisicao, numero, itens: gravados, excecoes };
  }

  /** Cancela o item com o motivo do cadastro; a requisição fica cancelada quando o último item cai. */
  cancelarItem(
    c: ContextoSadt,
    item: number,
    entrada: unknown,
  ): Promise<{ id: number; requisicaoCancelada: boolean }> {
    const p = esquemaCancelarItem.parse(entrada);
    return this.gravar(c, 'sadt.item.cancelado', 'exame_item', async (tx, est) => {
      const [it] = await tx.consultarParaAtualizar(
        `SELECT ei.id, ei.versao, ei.situacao, ei.requisicao_exame_id, ei.setor_diagnostico_id
           FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE ei.id = ? AND r.estabelecimento_id = ? AND ei.excluido_em IS NULL`,
        [item, est],
        { teto: 1 },
      );
      if (!it) throw recusa('exame-inexistente', 'O exame não existe neste estabelecimento.');
      const m = await tx.uma(
        'SELECT ativo, aplica_a, exige_complemento FROM motivo_cancelamento_item_exame WHERE id = ?',
        [p.motivo],
      );
      daRegra(() =>
        conferirCancelamento(
          texto(it['situacao']),
          m
            ? {
                ativo: Boolean(m['ativo']),
                aplicaA: texto(m['aplica_a']) as 'exame',
                exigeComplemento: Boolean(m['exige_complemento']),
              }
            : { ativo: false, aplicaA: 'exame', exigeComplemento: false },
          p.complemento,
        ),
      );
      const agora = new Date();
      const usuario = tx.contexto.usuario;
      await tx.alterar('exame_item', item, n(it['versao']), {
        situacao: 'cancelado',
        cancelado_em: agora,
        cancelado_por_usuario_id: usuario,
        motivo_cancelamento_item_exame_id: p.motivo,
      });
      await tx.incluir('item_exame_evento', {
        exame_item_id: item,
        operacao: 'alteracao',
        evento: 'cancelado',
        ocorrido_em: agora,
        usuario_id: usuario,
        situacao_anterior: texto(it['situacao']),
        situacao_nova: 'cancelado',
        motivo_cancelamento_item_exame_id: p.motivo,
        motivo: p.complemento,
        setor_diagnostico_id: nn(it['setor_diagnostico_id']),
        notificar_solicitante: p.notificarSolicitante,
      });
      const req = n(it['requisicao_exame_id']);
      const vivos = await tx.uma(
        `SELECT COUNT(*) AS n FROM exame_item WHERE requisicao_exame_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'`,
        [req],
      );
      let requisicaoCancelada = false;
      if (n(vivos?.['n']) === 0) {
        const [r] = await tx.consultarParaAtualizar(
          'SELECT versao FROM requisicao_exame WHERE id = ?',
          [req],
          {
            teto: 1,
          },
        );
        await tx.alterar('requisicao_exame', req, n(r!['versao']), {
          situacao: 'cancelada',
          cancelado_em: agora,
          cancelado_por_usuario_id: usuario,
          motivo_cancelamento: 'Todos os exames da requisição foram cancelados.',
        });
        requisicaoCancelada = true;
      }
      return { id: item, requisicaoCancelada };
    });
  }

  /** Os eventos do item (a trilha clínica do exame pedido), do mais antigo ao mais novo. */
  eventosDoItem(c: ContextoSadt, item: number) {
    return this.ler(c, async (l, est) => {
      const ok = await l.uma(
        `SELECT ei.id FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE ei.id = ? AND r.estabelecimento_id = ?`,
        [item, est],
      );
      if (!ok) return null;
      const ev = await l.consultar(
        `SELECT e.evento, e.ocorrido_em, e.situacao_anterior, e.situacao_nova, e.motivo, m.descricao AS motivo_cadastro
           FROM item_exame_evento e LEFT JOIN motivo_cancelamento_item_exame m ON m.id = e.motivo_cancelamento_item_exame_id
          WHERE e.exame_item_id = ? ORDER BY e.ocorrido_em, e.id`,
        [item],
      );
      return ev.map((e) => ({
        evento: texto(e['evento']),
        em: e['ocorrido_em'] instanceof Date ? e['ocorrido_em'].toISOString() : texto(e['ocorrido_em']),
        de: e['situacao_anterior'] === null ? null : texto(e['situacao_anterior']),
        para: e['situacao_nova'] === null ? null : texto(e['situacao_nova']),
        motivo:
          e['motivo_cadastro'] === null
            ? e['motivo'] === null
              ? null
              : texto(e['motivo'])
            : texto(e['motivo_cadastro']),
      }));
    });
  }

  /** Motivos ativos de cancelamento do exame e de recoleta (as escolhas da tela). */
  motivos(c: ContextoSadt) {
    return this.ler(c, async (l, est) => ({
      setores: (
        await l.consultar(
          'SELECT id, nome FROM setor_diagnostico WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY nome',
          [est],
        )
      ).map((x) => ({ id: n(x['id']), nome: texto(x['nome']) })),
      cancelamento: (
        await l.consultar(
          `SELECT id, descricao, exige_complemento FROM motivo_cancelamento_item_exame
            WHERE ativo = TRUE AND aplica_a IN ('exame','ambos') ORDER BY descricao`,
          [],
        )
      ).map((m) => ({
        id: n(m['id']),
        descricao: texto(m['descricao']),
        exigeComplemento: Boolean(m['exige_complemento']),
      })),
      recoleta: (
        await l.consultar(
          'SELECT id, descricao FROM motivo_nova_coleta WHERE ativo = TRUE ORDER BY descricao',
          [],
        )
      ).map((m) => ({ id: n(m['id']), descricao: texto(m['descricao']) })),
    }));
  }

  // ── Paciente e atendimento do pedido (a tela escolhe por busca, nunca por número digitado às cegas) ──────────────

  /** Atendimentos do estabelecimento pelo número do atendimento, pelo prontuário ou pelo nome do paciente. */
  buscarAtendimentos(c: ContextoSadt, termo: string): Promise<AtendimentoDoPedido[]> {
    const t = termo.trim();
    if (t.length < 2) return Promise.resolve([]);
    const digitos = /^\d+$/.test(t);
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `${SELECT_ATENDIMENTO}
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL
            AND (${digitos ? 'a.numero = ? OR pa.numero_prontuario = ?' : 'pf.nome LIKE ? OR pf.nome_social LIKE ?'})
          ORDER BY a.id DESC LIMIT 30`,
        digitos ? [est, t, t] : [est, `%${t}%`, `%${t}%`],
      );
      return ls.map(atendimentoDe);
    });
  }

  /**
   * O cabeçalho do paciente do atendimento (nome, idade, sexo, prontuário, estabelecimento) e as requisições dele no
   * estabelecimento, com os itens e a situação de cada um: a visão por paciente onde se cancela o item depois do pedido.
   */
  pedidosDoAtendimento(c: ContextoSadt, atendimento: number) {
    return this.ler(c, async (l, est) => {
      const a = await l.uma(`${SELECT_ATENDIMENTO} WHERE a.id = ? AND a.estabelecimento_id = ?`, [
        atendimento,
        est,
      ]);
      if (!a) return null;
      const reqs = await l.consultar(
        `SELECT r.id, r.numero, r.situacao, r.solicitado_em, r.prioridade FROM requisicao_exame r
          WHERE r.paciente_id = ? AND r.estabelecimento_id = ? AND r.excluido_em IS NULL
          ORDER BY r.solicitado_em DESC LIMIT 50`,
        [n(a['paciente_id']), est],
      );
      const itens = reqs.length
        ? await l.consultar(
            `SELECT ei.id, ei.requisicao_exame_id, ei.sequencia, ei.situacao, ei.coleta_pendente, e.nome
               FROM exame_item ei JOIN exame e ON e.id = ei.exame_id
              WHERE ei.excluido_em IS NULL AND ei.requisicao_exame_id IN (${lista(reqs.length)})
              ORDER BY ei.requisicao_exame_id, ei.sequencia`,
            reqs.map((r) => n(r['id'])),
          )
        : [];
      const est_ = await l.uma('SELECT nome FROM estabelecimento WHERE id = ?', [est]);
      return {
        atendimento: { ...atendimentoDe(a), estabelecimento: texto(est_?.['nome']) },
        requisicoes: reqs.map((r) => ({
          id: n(r['id']),
          numero: texto(r['numero']),
          situacao: texto(r['situacao']),
          prioridade: texto(r['prioridade']),
          solicitadaEm:
            r['solicitado_em'] instanceof Date ? r['solicitado_em'].toISOString() : texto(r['solicitado_em']),
          itens: itens
            .filter((i) => n(i['requisicao_exame_id']) === n(r['id']))
            .map((i) => ({
              id: n(i['id']),
              sequencia: n(i['sequencia']),
              exame: texto(i['nome']),
              situacao: texto(i['situacao']),
              coletaPendente: Number(i['coleta_pendente'] ?? 0) === 1 || i['coleta_pendente'] === true,
            })),
        })),
      };
    });
  }

  // ── Kit com versão ────────────────────────────────────────────────────────────────────────────────────────

  kits(c: ContextoSadt): Promise<KitVigente[]> {
    return this.ler(c, async (l) => {
      const ks = await l.consultar(
        `SELECT k.id, k.codigo, k.nome, v.id AS versao, v.numero_versao FROM kit_exame k
           JOIN kit_exame_versao v ON v.kit_exame_id = k.id AND v.vigencia_fim IS NULL
          WHERE k.ativo = TRUE AND k.excluido_em IS NULL ORDER BY k.nome LIMIT 500`,
        [],
      );
      if (ks.length === 0) return [];
      const itens = await l.consultar(
        `SELECT i.kit_exame_versao_id, i.exame_id, e.nome, i.material_biologico_id, i.quantidade
           FROM kit_exame_versao_item i JOIN exame e ON e.id = i.exame_id
          WHERE i.excluido_em IS NULL AND i.kit_exame_versao_id IN (${lista(ks.length)}) ORDER BY i.sequencia`,
        ks.map((k) => n(k['versao'])),
      );
      return ks.map((k) => ({
        id: n(k['id']),
        codigo: texto(k['codigo']),
        nome: texto(k['nome']),
        versao: n(k['versao']),
        numeroVersao: n(k['numero_versao']),
        itens: itens
          .filter((i) => n(i['kit_exame_versao_id']) === n(k['versao']))
          .map((i) => ({
            exame: n(i['exame_id']),
            nome: texto(i['nome']),
            material: nn(i['material_biologico_id']),
            quantidade: n(i['quantidade']),
          })),
      }));
    });
  }

  /** Nova versão do kit: a vigente é encerrada (fica no histórico) e a nova passa a valer para os pedidos. */
  salvarVersaoKit(
    c: ContextoSadt,
    entrada: unknown,
  ): Promise<{ id: number; versao: number; numeroVersao: number }> {
    const p = esquemaVersaoKit.parse(entrada);
    const itens = daRegra(() => itensDaVersaoDoKit(p.itens));
    return this.gravar(c, 'sadt.kit.versao', 'kit_exame', async (tx, est) => {
      const exs = [...new Set(itens.map((i) => i.exame))];
      const okEx = await tx.consultar(
        `SELECT id FROM exame WHERE ativo = TRUE AND excluido_em IS NULL AND id IN (${lista(exs.length)})`,
        exs,
      );
      if (okEx.length !== exs.length)
        throw recusa('exame-inexistente', 'Algum exame do kit não existe ou está inativo.');
      const sets = [...new Set(itens.map((i) => i.setor).filter((x): x is number => x !== null))];
      if (sets.length) {
        const okS = await tx.consultar(
          `SELECT id FROM setor_diagnostico WHERE estabelecimento_id = ? AND excluido_em IS NULL AND id IN (${lista(sets.length)})`,
          [est, ...sets],
        );
        if (okS.length !== sets.length)
          throw recusa(
            'setor-inexistente',
            'O setor de algum exame do kit não existe neste estabelecimento.',
          );
      }
      const agora = new Date();
      let kit = p.kit;
      let numero = 1;
      if (kit === null) {
        if (!p.codigo) throw recusa('codigo-obrigatorio', 'Informe o código do kit novo.');
        kit = await tx.incluir('kit_exame', {
          codigo: p.codigo,
          nome: p.nome,
          gera_bateria: p.geraBateria,
          hora_sugerida_coleta: p.horaSugeridaColeta,
          ativo: true,
          origem: 'sistema',
        });
      } else {
        const [k] = await tx.consultarParaAtualizar(
          'SELECT id, versao FROM kit_exame WHERE id = ? AND excluido_em IS NULL',
          [kit],
          { teto: 1 },
        );
        if (!k) throw recusa('kit-inexistente', 'O kit não existe.');
        await tx.alterar('kit_exame', kit, n(k['versao']), {
          nome: p.nome,
          gera_bateria: p.geraBateria,
          hora_sugerida_coleta: p.horaSugeridaColeta,
        });
        const vig = await tx.consultarParaAtualizar(
          'SELECT id, versao, numero_versao, vigencia_fim FROM kit_exame_versao WHERE kit_exame_id = ? ORDER BY numero_versao DESC',
          [kit],
        );
        numero = vig.length ? n(vig[0]!['numero_versao']) + 1 : 1;
        // A versão vigente é encerrada agora (nunca apagada): os pedidos antigos continuam apontando para ela.
        for (const v of vig.filter((x) => x['vigencia_fim'] === null))
          await tx.alterar('kit_exame_versao', n(v['id']), n(v['versao']), { vigencia_fim: agora });
      }
      const versao = await tx.incluir('kit_exame_versao', {
        kit_exame_id: kit,
        operacao: numero === 1 ? 'inclusao' : 'alteracao',
        ocorrido_em: agora,
        usuario_id: tx.contexto.usuario,
        numero_versao: numero,
        nome: p.nome,
        gera_bateria: p.geraBateria,
        hora_sugerida_coleta: p.horaSugeridaColeta,
        vigencia_inicio: agora,
        dados: JSON.stringify({ itens: itens.length }),
      });
      for (const i of itens)
        await tx.incluir('kit_exame_versao_item', {
          kit_exame_versao_id: versao,
          sequencia: i.sequencia,
          exame_id: i.exame,
          material_biologico_id: i.material,
          setor_diagnostico_id: i.setor,
          quantidade: i.quantidade,
          origem: 'sistema',
        });
      return { id: kit, versao, numeroVersao: numero };
    });
  }

  // ── Recoleta ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Pede a recoleta da amostra: a original é rejeitada (se ainda ativa), os exames voltam à coleta e a pendência nasce. */
  pedirRecoleta(c: ContextoSadt, amostra: number, entrada: unknown): Promise<{ id: number; numero: string }> {
    const p = esquemaPedirRecoleta.parse(entrada);
    return this.gravar(c, 'sadt.recoleta.pedida', 'nova_coleta', async (tx, est) => {
      const [am] = await tx.consultarParaAtualizar(
        `SELECT am.id, am.versao, am.situacao, am.requisicao_exame_id, am.amostra_pai_id, r.paciente_id
           FROM amostra_biologica am LEFT JOIN requisicao_exame r ON r.id = am.requisicao_exame_id
          WHERE am.id = ? AND am.estabelecimento_id = ? AND am.excluido_em IS NULL`,
        [amostra, est],
        { teto: 1 },
      );
      if (!am || am['requisicao_exame_id'] === null)
        throw recusa('amostra-inexistente', 'A amostra de paciente não existe neste estabelecimento.');
      const aberta = await tx.uma(
        `SELECT id FROM nova_coleta WHERE amostra_biologica_id = ? AND excluido_em IS NULL
            AND situacao IN ('pendente','contato_realizado','agendada') LIMIT 1`,
        [amostra],
      );
      const m = await tx.uma(
        'SELECT ativo, gera_nova_amostra, descricao FROM motivo_nova_coleta WHERE id = ?',
        [p.motivo],
      );
      const aliquotas = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao FROM amostra_biologica WHERE amostra_pai_id = ? AND excluido_em IS NULL',
        [amostra],
      );
      const { rejeitarOriginal, rejeitarAliquotas } = daRegra(() =>
        conferirRecoleta(
          texto(am['situacao']),
          !!aberta,
          m ? { ativo: Boolean(m['ativo']), geraNovaAmostra: Boolean(m['gera_nova_amostra']) } : null,
          {
            ehAliquota: am['amostra_pai_id'] !== null,
            aliquotas: aliquotas.map((x) => ({ id: n(x['id']), situacao: texto(x['situacao']) })),
          },
        ),
      );
      const agora = new Date();
      const usuario = tx.contexto.usuario;
      if (rejeitarOriginal) {
        await tx.alterar('amostra_biologica', amostra, n(am['versao']), {
          situacao: 'rejeitada',
          motivo_nova_coleta_id: p.motivo,
        });
        await tx.incluir('amostra_biologica_evento', {
          amostra_biologica_id: amostra,
          operacao: 'alteracao',
          evento: 'rejeitada',
          ocorrido_em: agora,
          usuario_id: usuario,
          descricao: texto(m!['descricao']).slice(0, 500),
          dados: JSON.stringify({ de: texto(am['situacao']), recoleta: true }),
        });
      }
      // As alíquotas vivas da primária são rejeitadas junto: o exame fica ligado a uma única amostra viva (a nova). O
      // vínculo antigo fica no banco como histórico; amostra rejeitada não atende exame (a coleta comum também lê assim).
      for (const al of aliquotas.filter((x) => rejeitarAliquotas.includes(n(x['id'])))) {
        await tx.alterar('amostra_biologica', n(al['id']), n(al['versao']), {
          situacao: 'rejeitada',
          motivo_nova_coleta_id: p.motivo,
        });
        await tx.incluir('amostra_biologica_evento', {
          amostra_biologica_id: n(al['id']),
          operacao: 'alteracao',
          evento: 'rejeitada',
          ocorrido_em: agora,
          usuario_id: usuario,
          descricao: texto(m!['descricao']).slice(0, 500),
          dados: JSON.stringify({ de: texto(al['situacao']), recoleta: true, amostraPai: amostra }),
        });
      }
      const itens = await tx.consultarParaAtualizar(
        `SELECT ei.id, ei.versao, ei.situacao FROM amostra_biologica_exame abe JOIN exame_item ei ON ei.id = abe.exame_item_id
          WHERE abe.amostra_biologica_id = ? AND abe.excluido_em IS NULL AND ei.situacao IN ('solicitado','coletado','em_analise')`,
        [amostra],
      );
      const numero = (await tx.proximoNumero('nova_coleta')).formatado;
      const idNova = await tx.incluir('nova_coleta', {
        estabelecimento_id: est,
        numero,
        paciente_id: n(am['paciente_id']),
        requisicao_exame_id: n(am['requisicao_exame_id']),
        amostra_biologica_id: amostra,
        motivo_nova_coleta_id: p.motivo,
        solicitante_usuario_id: usuario,
        solicitado_em: agora,
        situacao: p.coletaPrevistaEm ? 'agendada' : 'pendente',
        coleta_prevista_em: p.coletaPrevistaEm ? new Date(p.coletaPrevistaEm) : null,
        observacao: p.observacao,
        origem: 'sistema',
      });
      for (const i of itens) {
        await tx.alterar('exame_item', n(i['id']), n(i['versao']), {
          situacao: 'solicitado',
          refazimento: true,
          coleta_pendente: true,
          motivo_pendencia: texto(m!['descricao']).slice(0, 500),
        });
        await tx.incluir('item_exame_evento', {
          exame_item_id: n(i['id']),
          operacao: 'alteracao',
          evento: 'nova_coleta',
          ocorrido_em: agora,
          usuario_id: usuario,
          situacao_anterior: texto(i['situacao']),
          situacao_nova: 'solicitado',
          amostra_biologica_id: amostra,
          motivo: texto(m!['descricao']).slice(0, 500),
          dados: JSON.stringify({ recoleta: idNova }),
        });
      }
      return { id: idNova, numero };
    });
  }

  /** Coleta a recoleta: a amostra nova (marcada como repetição, com o motivo) liga-se à original pela pendência. */
  coletarRecoleta(
    c: ContextoSadt,
    recoleta: number,
    entrada: unknown,
  ): Promise<{ id: number; amostra: number; codigo: string }> {
    const e = esquemaColetarRecoleta.parse(entrada ?? {});
    const prefixo = c.hospital ?? 'H';
    return this.gravar(c, 'sadt.recoleta.coletada', 'nova_coleta', async (tx, est) => {
      const [nc] = await tx.consultarParaAtualizar(
        `SELECT nc.id, nc.versao, nc.situacao, nc.amostra_biologica_id, nc.requisicao_exame_id, nc.motivo_nova_coleta_id,
                am.material_biologico_id, am.recipiente_coleta_id, am.setor_diagnostico_id, nc.paciente_id,
                p.numero_prontuario,
                EXISTS (SELECT 1 FROM internacao i WHERE i.atendimento_id = r.atendimento_id) AS internado
           FROM nova_coleta nc JOIN amostra_biologica am ON am.id = nc.amostra_biologica_id
           JOIN requisicao_exame r ON r.id = nc.requisicao_exame_id JOIN paciente p ON p.id = nc.paciente_id
          WHERE nc.id = ? AND nc.estabelecimento_id = ? AND nc.excluido_em IS NULL`,
        [recoleta, est],
        { teto: 1 },
      );
      if (!nc) throw recusa('recoleta-inexistente', 'A recoleta não existe neste estabelecimento.');
      daRegra(() => conferirFechamentoRecoleta(texto(nc['situacao']), 'coletar'));
      const internado = Number(nc['internado'] ?? 0) === 1 || nc['internado'] === true;
      daRegra(() =>
        conferirColetaDaRecoleta({
          internado,
          identificadoresConferidos: e.identificadoresConferidos,
          pulseiraLida: e.pulseira,
          pulseiraDoPaciente: [`P${n(nc['paciente_id'])}`, texto(nc['numero_prontuario'])].filter(Boolean),
          estacao: e.estacao,
        }),
      );
      const original = n(nc['amostra_biologica_id']);
      const itens = await tx.consultarParaAtualizar(
        `SELECT ei.id, ei.versao FROM amostra_biologica_exame abe JOIN exame_item ei ON ei.id = abe.exame_item_id
          WHERE abe.amostra_biologica_id = ? AND abe.excluido_em IS NULL AND ei.situacao = 'solicitado'`,
        [original],
      );
      if (itens.length === 0)
        throw recusa(
          'sem-exames',
          'Nenhum exame da amostra original espera a recoleta (cancelados ou já coletados).',
        );
      const agora = new Date();
      const usuario = tx.contexto.usuario;
      const provisorio = `R${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`;
      const amostra = await tx.incluir('amostra_biologica', {
        estabelecimento_id: est,
        codigo_barras: provisorio,
        requisicao_exame_id: n(nc['requisicao_exame_id']),
        material_biologico_id: n(nc['material_biologico_id']),
        recipiente_coleta_id: nn(nc['recipiente_coleta_id']),
        setor_diagnostico_id: nn(nc['setor_diagnostico_id']),
        situacao: 'coletada',
        coletada_em: agora,
        repeticao: true,
        motivo_nova_coleta_id: n(nc['motivo_nova_coleta_id']),
        origem: 'sistema',
      });
      const codigo = codigoDaAmostra(prefixo, amostra);
      await tx.alterar('amostra_biologica', amostra, 1, { codigo_barras: codigo });
      for (const i of itens) {
        await tx.incluir('amostra_biologica_exame', {
          amostra_biologica_id: amostra,
          exame_item_id: n(i['id']),
        });
        await tx.alterar('exame_item', n(i['id']), n(i['versao']), {
          situacao: 'coletado',
          coletado_em: agora,
          coleta_pendente: false,
        });
        await tx.incluir('item_exame_evento', {
          exame_item_id: n(i['id']),
          operacao: 'alteracao',
          evento: 'coletado',
          ocorrido_em: agora,
          usuario_id: usuario,
          situacao_anterior: 'solicitado',
          situacao_nova: 'coletado',
          amostra_biologica_id: amostra,
          dados: JSON.stringify({ recoleta, amostraOriginal: original }),
        });
      }
      await tx.incluir('amostra_biologica_evento', {
        amostra_biologica_id: amostra,
        operacao: 'inclusao',
        evento: 'coletada',
        ocorrido_em: agora,
        usuario_id: usuario,
        dados: JSON.stringify({
          recoleta,
          amostraOriginal: original,
          identificadoresConferidos: true,
          pulseiraConferida: internado,
          estacao: e.estacao,
        }),
      });
      await tx.alterar('nova_coleta', recoleta, n(nc['versao']), {
        situacao: 'coletada',
        nova_amostra_biologica_id: amostra,
        coletada_em: agora,
      });
      return { id: recoleta, amostra, codigo };
    });
  }

  /**
   * Cancela a recoleta com o motivo e decide o destino dos exames que a esperavam (regra no domínio): cancelados com o
   * motivo do cadastro, ou mantidos pendentes de coleta com o aviso. Cada exame recebe o evento com o usuário.
   */
  cancelarRecoleta(
    c: ContextoSadt,
    recoleta: number,
    entrada: unknown,
  ): Promise<{ id: number; exames: number }> {
    const p = esquemaCancelarRecoleta.parse(entrada);
    return this.gravar(c, 'sadt.recoleta.cancelada', 'nova_coleta', async (tx, est) => {
      const [nc] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao, amostra_biologica_id FROM nova_coleta WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [recoleta, est],
        { teto: 1 },
      );
      if (!nc) throw recusa('recoleta-inexistente', 'A recoleta não existe neste estabelecimento.');
      daRegra(() => conferirFechamentoRecoleta(texto(nc['situacao']), 'cancelar', p.motivo));
      const { cancelarExames } = daRegra(() =>
        destinoDosExamesAoCancelar(p.destinoExames, p.motivoCancelamentoExame),
      );
      if (cancelarExames) {
        const m = await tx.uma(
          'SELECT ativo, aplica_a, exige_complemento FROM motivo_cancelamento_item_exame WHERE id = ?',
          [p.motivoCancelamentoExame],
        );
        daRegra(() =>
          conferirCancelamento(
            'solicitado',
            m
              ? {
                  ativo: Boolean(m['ativo']),
                  aplicaA: texto(m['aplica_a']) as 'exame',
                  exigeComplemento: false,
                }
              : { ativo: false, aplicaA: 'exame', exigeComplemento: false },
            p.motivo,
          ),
        );
      }
      const agora = new Date();
      const usuario = tx.contexto.usuario;
      const itens = await tx.consultarParaAtualizar(
        `SELECT ei.id, ei.versao, ei.situacao, ei.setor_diagnostico_id FROM amostra_biologica_exame abe
           JOIN exame_item ei ON ei.id = abe.exame_item_id
          WHERE abe.amostra_biologica_id = ? AND abe.excluido_em IS NULL AND ei.excluido_em IS NULL
            AND ei.situacao = 'solicitado' AND ei.coleta_pendente = TRUE`,
        [n(nc['amostra_biologica_id'])],
      );
      const aviso = `Recoleta cancelada: ${p.motivo}`.slice(0, 500);
      for (const i of itens) {
        if (cancelarExames) {
          await tx.alterar('exame_item', n(i['id']), n(i['versao']), {
            situacao: 'cancelado',
            cancelado_em: agora,
            cancelado_por_usuario_id: usuario,
            motivo_cancelamento_item_exame_id: p.motivoCancelamentoExame,
            coleta_pendente: false,
          });
          await tx.incluir('item_exame_evento', {
            exame_item_id: n(i['id']),
            operacao: 'alteracao',
            evento: 'cancelado',
            ocorrido_em: agora,
            usuario_id: usuario,
            situacao_anterior: 'solicitado',
            situacao_nova: 'cancelado',
            motivo_cancelamento_item_exame_id: p.motivoCancelamentoExame,
            motivo: aviso,
            setor_diagnostico_id: nn(i['setor_diagnostico_id']),
            dados: JSON.stringify({ recoleta, recoletaCancelada: true }),
          });
        } else {
          await tx.alterar('exame_item', n(i['id']), n(i['versao']), { motivo_pendencia: aviso });
          await tx.incluir('item_exame_evento', {
            exame_item_id: n(i['id']),
            operacao: 'alteracao',
            evento: 'nova_coleta',
            ocorrido_em: agora,
            usuario_id: usuario,
            situacao_anterior: 'solicitado',
            situacao_nova: 'solicitado',
            motivo: aviso,
            setor_diagnostico_id: nn(i['setor_diagnostico_id']),
            dados: JSON.stringify({ recoleta, recoletaCancelada: true, mantidoPendente: true }),
          });
        }
      }
      await tx.alterar('nova_coleta', recoleta, n(nc['versao']), {
        situacao: 'cancelada',
        cancelada_em: agora,
        motivo_cancelamento: p.motivo,
      });
      return { id: recoleta, exames: itens.length };
    });
  }

  recoletas(c: ContextoSadt, o: { abertas: boolean; paciente?: number }): Promise<RecoletaLida[]> {
    return this.ler(c, async (l, est) => {
      const r = await l.consultar(
        `SELECT nc.id, nc.numero, nc.situacao, nc.amostra_biologica_id, am.codigo_barras, nc.nova_amostra_biologica_id,
                m.descricao, nc.solicitado_em, nc.paciente_id
           FROM nova_coleta nc JOIN amostra_biologica am ON am.id = nc.amostra_biologica_id
           JOIN motivo_nova_coleta m ON m.id = nc.motivo_nova_coleta_id
          WHERE nc.estabelecimento_id = ? AND nc.excluido_em IS NULL
            ${o.abertas ? "AND nc.situacao IN ('pendente','contato_realizado','agendada')" : ''}
            ${o.paciente ? 'AND nc.paciente_id = ?' : ''}
          ORDER BY nc.solicitado_em DESC LIMIT 500`,
        o.paciente ? [est, o.paciente] : [est],
      );
      return r.map((x) => ({
        id: n(x['id']),
        numero: texto(x['numero']),
        situacao: texto(x['situacao']),
        amostraOriginal: n(x['amostra_biologica_id']),
        codigoOriginal: texto(x['codigo_barras']),
        novaAmostra: nn(x['nova_amostra_biologica_id']),
        motivo: texto(x['descricao']),
        solicitadaEm:
          x['solicitado_em'] instanceof Date ? x['solicitado_em'].toISOString() : texto(x['solicitado_em']),
        paciente: n(x['paciente_id']),
      }));
    });
  }

  // ── Sub-amostras ──────────────────────────────────────────────────────────────────────────────────────────

  /** Gera as alíquotas da amostra primária recebida pelas regras do exame; a primária fica "aliquotada". */
  gerarSubamostras(
    c: ContextoSadt,
    amostra: number,
  ): Promise<{ id: number; subamostras: readonly { id: number; codigo: string; exames: number }[] }> {
    const prefixo = c.hospital ?? 'H';
    return this.gravar(c, 'sadt.amostra.aliquotada', 'amostra_biologica', async (tx, est) => {
      const [am] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, requisicao_exame_id, material_biologico_id, recipiente_coleta_id, coletada_em
           FROM amostra_biologica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [amostra, est],
        { teto: 1 },
      );
      if (!am) throw recusa('amostra-inexistente', 'A amostra não existe neste estabelecimento.');
      const filhas = await tx.uma(
        'SELECT COUNT(*) AS n FROM amostra_biologica WHERE amostra_pai_id = ? AND excluido_em IS NULL',
        [amostra],
      );
      const material = n(am['material_biologico_id']);
      const exames: ExameDaAmostra[] = (
        await tx.consultar(
          `SELECT ei.id, ei.exame_id, COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id) AS setor_diagnostico_id
             FROM amostra_biologica_exame abe JOIN exame_item ei ON ei.id = abe.exame_item_id
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
            WHERE abe.amostra_biologica_id = ? AND abe.excluido_em IS NULL AND ei.situacao <> 'cancelado'`,
          [amostra],
        )
      ).map((e) => ({
        exameItem: n(e['id']),
        exame: n(e['exame_id']),
        setor: nn(e['setor_diagnostico_id']),
        material,
      }));
      const ids = [...new Set(exames.map((e) => e.exame))];
      const regras: RegraSubamostra[] = ids.length
        ? (
            await tx.consultar(
              // Só as regras dos setores deste estabelecimento (e com destino também dele, quando há destino).
              `SELECT rs.* FROM regra_subamostra rs
                 JOIN setor_diagnostico sd ON sd.id = rs.setor_diagnostico_id AND sd.estabelecimento_id = ?
                 LEFT JOIN setor_diagnostico dd ON dd.id = rs.destino_setor_diagnostico_id
                WHERE rs.ativo = TRUE AND rs.exame_id IN (${lista(ids.length)})
                  AND (rs.destino_setor_diagnostico_id IS NULL OR dd.estabelecimento_id = ?)`,
              [est, ...ids, est],
            )
          ).map((r) => ({
            id: n(r['id']),
            exame: n(r['exame_id']),
            setor: n(r['setor_diagnostico_id']),
            material: nn(r['material_biologico_id']),
            bancada: nn(r['bancada_analitica_id']),
            destinoSetor: nn(r['destino_setor_diagnostico_id']),
            geraSubamostra: Boolean(r['gera_subamostra']),
            examePrimario: Boolean(r['exame_primario']),
            agrupamento: (r['agrupamento_etiqueta'] ?? null) as RegraSubamostra['agrupamento'],
          }))
        : [];
      const plano = planoDeSubamostras(exames, regras);
      daRegra(() => conferirAliquotagem(texto(am['situacao']), n(filhas?.['n']) > 0, plano));
      const agora = new Date();
      const usuario = tx.contexto.usuario;
      const saida: { id: number; codigo: string; exames: number }[] = [];
      for (const g of plano) {
        const filha = await tx.incluir('amostra_biologica', {
          estabelecimento_id: est,
          codigo_barras: `A${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`,
          requisicao_exame_id: n(am['requisicao_exame_id']),
          amostra_pai_id: amostra,
          regra_subamostra_id: g.regra,
          material_biologico_id: material,
          recipiente_coleta_id: nn(am['recipiente_coleta_id']),
          setor_diagnostico_id: g.setor,
          bancada_analitica_id: g.bancada,
          situacao: 'recebida',
          coletada_em: am['coletada_em'],
          recebida_em: agora,
          recebida_por_usuario_id: usuario,
          origem: 'sistema',
        });
        const codigo = codigoDaAmostra(prefixo, filha);
        await tx.alterar('amostra_biologica', filha, 1, { codigo_barras: codigo });
        for (const ei of g.exameItens)
          await tx.incluir('amostra_biologica_exame', {
            amostra_biologica_id: filha,
            exame_item_id: ei,
            bancada_analitica_id: g.bancada,
          });
        await tx.incluir('amostra_biologica_evento', {
          amostra_biologica_id: filha,
          operacao: 'inclusao',
          evento: 'aliquotada',
          ocorrido_em: agora,
          usuario_id: usuario,
          setor_diagnostico_id: g.setor,
          bancada_analitica_id: g.bancada,
          dados: JSON.stringify({ amostraPai: amostra, regra: g.regra }),
        });
        saida.push({ id: filha, codigo, exames: g.exameItens.length });
      }
      await tx.alterar('amostra_biologica', amostra, n(am['versao']), { situacao: 'aliquotada' });
      await tx.incluir('amostra_biologica_evento', {
        amostra_biologica_id: amostra,
        operacao: 'alteracao',
        evento: 'aliquotada',
        ocorrido_em: agora,
        usuario_id: usuario,
        dados: JSON.stringify({ subamostras: saida.map((s) => s.id) }),
      });
      return { id: amostra, subamostras: saida };
    });
  }
}
