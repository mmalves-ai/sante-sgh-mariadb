// F78.04-1, no banco do cliente: três controles da internação. As regras são as puras de @sgh/dominio-internacao
// (controles-assistenciais.ts); aqui ficam a leitura e a gravação pelo executor (trilha na mesma transação).
// Contrato de efeito:
//   - 04-INT linha 74, formulários de declaração de óbito: o lote recebido da secretaria vira uma linha por número em
//     `formulario_declaracao_obito` ('disponivel', lote, data, órgão); usar liga o formulário à declaração de mesmo
//     número (`declaracao_obito.formulario_declaracao_obito_id` e o formulário 'utilizado' com o instante e o médico);
//     a conciliação faz isso de uma vez para as declarações sem formulário; extravio e cancelamento gravam o motivo; a
//     devolução marca as vias entregues à secretaria. Nada é apagado;
//   - 04-INT linha 75, auditoria do isolamento: os critérios por tipo de precaução em `criterio_auditoria_isolamento`; a
//     auditoria em `auditoria_isolamento` ('concluida', conformidade e percentual calculados, auditor e instante) com uma
//     linha por critério em `auditoria_isolamento_item`; o cancelamento fica com o motivo (nunca apagada);
//   - 04-INT linha 78, regulação: o quadro clínico estruturado em `quadro_clinico_regulacao` (sequência por solicitação),
//     com o evento 'evolucao_clinica' em `evento_regulacao` e os sinais vigentes copiados na solicitação; a resposta, o
//     contato, a mudança de situação e o cancelamento em `evento_regulacao` com a situação anterior e a nova, e a
//     solicitação na situação nova (com as marcas de regulada e encerrada). O envio à central segue manual: o
//     instante de envio fica nulo até haver conector confirmado.
import {
  type AcaoFormularioObito,
  type AcaoNaoConformidade,
  avaliarAuditoriaIsolamento,
  conferirQuadroClinico,
  type CriterioAuditoria,
  decidirAcaoFormularioObito,
  decidirEventoRegulacao,
  marcasDaSituacao,
  numerosDoLote,
  proximaReauditoria,
  resumoFormulariosObito,
  type SituacaoFormularioObito,
  type SituacaoRegulacao,
} from '@sgh/dominio-internacao';
import type { TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  type NucleoPortaPropria,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_CONTROLES_ASSISTENCIAIS = Symbol('PORTA_CONTROLES_ASSISTENCIAIS');

const TABELAS = [
  'formulario_declaracao_obito',
  'declaracao_obito',
  'criterio_auditoria_isolamento',
  'auditoria_isolamento',
  'auditoria_isolamento_item',
  'quadro_clinico_regulacao',
  'evento_regulacao',
  'solicitacao_regulacao',
  'aviso_clinico',
];

/** Origem dos avisos que a auditoria do isolamento gera para a CCIH (comissão de controle de infecção hospitalar). */
const ORIGEM_AVISO_ISOLAMENTO = { modulo: 'qualidade.ccih', entidade: 'auditoria_isolamento' } as const;

const id = z.number().int().positive();
const idOuNull = id.nullable().default(null);
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const versao = z.number().int().positive();
const motivo = z.string().trim().max(500).nullable().default(null);
const decimal = (min: number, max: number) => z.number().min(min).max(max).nullable().default(null);
const inteiro = (max: number) => z.number().int().min(0).max(max).nullable().default(null);

const esquemaLote = z
  .object({
    inicial: z.string().trim().min(1).max(11),
    final: z.string().trim().min(1).max(11),
    lote: z.string().trim().max(30).nullable().default(null),
    recebidoEm: dataIso,
    orgao: z.string().trim().max(150).nullable().default(null),
    responsavel: idOuNull,
  })
  .strict();

const esquemaAcaoFormulario = z
  .object({
    acao: z.enum(['usar', 'extraviar', 'cancelar', 'devolver']),
    declaracao: idOuNull,
    motivo,
    versao,
  })
  .strict();

const esquemaCriterio = z
  .object({
    tipoPrecaucao: id,
    descricao: z.string().trim().min(3).max(500),
    orientacao: z.string().trim().max(2000).nullable().default(null),
    acao: z.enum(['registrar', 'alertar', 'bloquear']).default('registrar'),
    validadeDias: z.number().int().positive().max(365).nullable().default(null),
  })
  .strict();

const esquemaAuditoria = z
  .object({
    isolamento: id,
    observacao: z.string().trim().max(2000).nullable().default(null),
    respostas: z
      .array(
        z
          .object({
            criterio: id,
            resposta: z.enum(['conforme', 'nao_conforme', 'nao_se_aplica']),
            naoConformidade: z.string().trim().max(1000).nullable().default(null),
            acaoCorretiva: z.string().trim().max(1000).nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

const esquemaCancelarAuditoria = z.object({ motivo: z.string().trim().min(10).max(500), versao }).strict();

const esquemaQuadro = z
  .object({
    quadroClinico: z.string().trim().min(1).max(20_000),
    condicaoGeral: z.enum(['estavel', 'instavel', 'grave', 'critico']),
    nivelConsciencia: idOuNull,
    suporteOxigenio: idOuNull,
    fluxoOxigenio: decimal(0, 100),
    fracaoInspirada: decimal(0, 100),
    peep: decimal(0, 99),
    faixaDiurese: idOuNull,
    frequenciaCardiaca: inteiro(1000),
    frequenciaRespiratoria: inteiro(1000),
    pressaoSistolica: inteiro(1000),
    pressaoDiastolica: inteiro(1000),
    temperatura: decimal(0, 99),
    saturacao: decimal(0, 999),
    usaDrogaVasoativa: z.boolean().default(false),
    drogasVasoativas: z.string().trim().max(500).nullable().default(null),
    necessitaIsolamento: z.boolean().default(false),
    germes: z.array(id).max(10).default([]),
    germeMultirresistente: z.string().trim().max(200).nullable().default(null),
    versao,
  })
  .strict();

const esquemaResolverAviso = z.object({ providencia: z.string().trim().min(3).max(2000), versao }).strict();

const esquemaEvento = z
  .object({
    tipo: z.enum(['resposta', 'mudanca_situacao', 'contato_central', 'cancelamento']),
    situacaoNova: z
      .enum(['solicitada', 'em_analise', 'autorizada', 'negada', 'cancelada', 'concluida'])
      .nullable()
      .default(null),
    observacao: z.string().trim().max(2000).nullable().default(null),
    versao,
  })
  .strict();

export interface FormularioObitoLido {
  readonly id: number;
  readonly numero: string;
  readonly lote: string | null;
  readonly recebidoEm: string;
  readonly orgao: string | null;
  readonly situacao: SituacaoFormularioObito;
  readonly declaracao: { id: number; numero: string; situacao: string; paciente: number } | null;
  readonly utilizadoEm: string | null;
  readonly motivo: string | null;
  readonly versao: number;
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const dia = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);

/** Campos da solicitação que o quadro atualiza: número ou id só quando veio preenchido; marca só quando veio. */
export function sinaisVigentes(
  e: z.infer<typeof esquemaQuadro>,
  veio: (campo: string) => boolean,
): Record<string, unknown> {
  const valores: Record<string, unknown> = {
    suporte_oxigenio_id: e.suporteOxigenio,
    fluxo_oxigenio_litros_minuto: e.fluxoOxigenio,
    nivel_consciencia_id: e.nivelConsciencia,
    faixa_diurese_id: e.faixaDiurese,
    frequencia_cardiaca: e.frequenciaCardiaca,
    frequencia_respiratoria: e.frequenciaRespiratoria,
    temperatura: e.temperatura,
    saturacao_oxigenio: e.saturacao,
    pressao_sistolica: e.pressaoSistolica,
    pressao_diastolica: e.pressaoDiastolica,
    peep: e.peep,
    fracao_inspirada_oxigenio: e.fracaoInspirada,
  };
  const r: Record<string, unknown> = { resumo_clinico: e.quadroClinico };
  for (const [k, v] of Object.entries(valores)) if (v !== null && v !== undefined) r[k] = v;
  if (veio('necessitaIsolamento')) r['isolamento_necessario'] = e.necessitaIsolamento;
  return r;
}

function recusou(titulo: string, r: { ok: false; codigo: string; mensagem: string }): never {
  throw recusaRegra(titulo, [{ campo: r.codigo, mensagem: r.mensagem }]);
}

/** Lê uma linha travando-a até o fim da transação (SELECT ... FOR UPDATE pelo escritor). */
async function travada(tx: TxOperacao, sql: string, p: unknown[]): Promise<Record<string, unknown> | null> {
  return (await tx.consultarParaAtualizar(sql, p))[0] ?? null;
}

export class PortaControlesAssistenciaisPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: NucleoPortaPropria, cliente: string) {
    super(nucleo, cliente, TABELAS, 'internacao.controles');
  }

  // ── Formulários de declaração de óbito (04-INT linha 74) ─────────────────────────────────────────────────────

  formulariosObito(c: ContextoPortaPropria, situacao?: string | null) {
    return this.ler(c, 'formularios-obito', async (l, est) => {
      const todos = await l.consultar(
        `SELECT f.id, f.numero, f.lote_recebimento, f.recebido_em, f.orgao_fornecedor, f.situacao, f.utilizado_em,
                f.motivo_cancelamento, f.versao, d.id AS d_id, d.numero AS d_numero, d.situacao AS d_situacao,
                d.paciente_id AS d_paciente
           FROM formulario_declaracao_obito f LEFT JOIN declaracao_obito d ON d.id = f.declaracao_obito_id
          WHERE f.estabelecimento_id = ? AND f.excluido_em IS NULL
          ORDER BY f.numero`,
        [est.id],
      );
      const pendentes = await l.uma(
        `SELECT COUNT(*) AS n FROM declaracao_obito
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'emitida' AND formulario_declaracao_obito_id IS NULL`,
        [est.id],
      );
      const itens: FormularioObitoLido[] = todos.map((r) => ({
        id: num(r['id']),
        numero: String(r['numero']),
        lote: txtOuNull(r['lote_recebimento']),
        recebidoEm: dia(r['recebido_em']),
        orgao: txtOuNull(r['orgao_fornecedor']),
        situacao: String(r['situacao']) as SituacaoFormularioObito,
        declaracao: r['d_id']
          ? {
              id: num(r['d_id']),
              numero: String(r['d_numero']),
              situacao: String(r['d_situacao']),
              paciente: num(r['d_paciente']),
            }
          : null,
        utilizadoEm: iso(r['utilizado_em']),
        motivo: txtOuNull(r['motivo_cancelamento']),
        versao: num(r['versao']),
      }));
      return {
        itens: situacao ? itens.filter((i) => i.situacao === situacao) : itens,
        resumo: resumoFormulariosObito(itens.map((i) => i.situacao)),
        declaracoesSemFormulario: num(pendentes?.['n']),
      };
    });
  }

  receberLote(c: ContextoPortaPropria, entrada: unknown): Promise<{ quantidade: number; primeiro: number }> {
    const e = entradaValida(esquemaLote, entrada);
    const r = numerosDoLote(e.inicial, e.final);
    if (!r.ok) recusou('Lote recusado', r);
    const numeros = (r as { numeros: string[] }).numeros;
    return this.gravar(
      c,
      'internacao.formulario-obito.receber-lote',
      ['formulario_declaracao_obito'],
      async (tx, est) => {
        const ph = numeros.map(() => '?').join(',');
        const ja = await tx.consultar(
          `SELECT COUNT(*) AS n FROM formulario_declaracao_obito WHERE numero IN (${ph})`,
          numeros,
        );
        if (num(ja[0]?.['n']) > 0)
          throw recusaRegra('Lote recusado', [
            { campo: 'inicial', mensagem: `${num(ja[0]?.['n'])} número(s) deste lote já estão cadastrados.` },
          ]);
        let primeiro = 0;
        for (const numero of numeros) {
          const novo = await tx.incluir('formulario_declaracao_obito', {
            estabelecimento_id: est.id,
            numero,
            lote_recebimento: e.lote,
            recebido_em: e.recebidoEm,
            orgao_fornecedor: e.orgao,
            situacao: 'disponivel',
            responsavel_profissional_id: e.responsavel,
          });
          if (!primeiro) primeiro = novo;
        }
        return { tabela: 'formulario_declaracao_obito', id: primeiro, quantidade: numeros.length, primeiro };
      },
    );
  }

  private async aplicarAcao(
    tx: TxOperacao,
    estId: number,
    f: Record<string, unknown>,
    acao: AcaoFormularioObito,
    declaracaoId: number | null,
    motivoInformado: string | null,
    versaoFormulario: number,
  ): Promise<SituacaoFormularioObito> {
    const declaracaoAlvo = acao === 'usar' ? declaracaoId : numOuNull(f['declaracao_obito_id']);
    const d = declaracaoAlvo
      ? await travada(
          tx,
          `SELECT id, numero, situacao, versao, profissional_id, formulario_declaracao_obito_id FROM declaracao_obito
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [declaracaoAlvo, estId],
        )
      : null;
    if (acao === 'usar' && declaracaoAlvo && !d) throw naoEncontrado('Declaração de óbito');
    const v = decidirAcaoFormularioObito(String(f['situacao']) as SituacaoFormularioObito, acao, {
      motivo: motivoInformado,
      numeroFormulario: String(f['numero']),
      declaracao: d
        ? {
            numero: String(d['numero']),
            situacao: String(d['situacao']) as 'rascunho' | 'emitida' | 'cancelada',
            jaTemFormulario: d['formulario_declaracao_obito_id'] != null,
          }
        : null,
    });
    if (!v.ok) recusou('Formulário não alterado', v);
    const { nova, motivo: m } = v as { nova: SituacaoFormularioObito; motivo: string | null };
    const agora = new Date();
    if (acao === 'usar') {
      await tx.alterar('formulario_declaracao_obito', num(f['id']), versaoFormulario, {
        situacao: nova,
        declaracao_obito_id: num(d!['id']),
        utilizado_em: agora,
        responsavel_profissional_id: numOuNull(d!['profissional_id']),
      });
      await tx.alterar('declaracao_obito', num(d!['id']), num(d!['versao']), {
        formulario_declaracao_obito_id: num(f['id']),
      });
    } else {
      await tx.alterar('formulario_declaracao_obito', num(f['id']), versaoFormulario, {
        situacao: nova,
        ...(m ? { motivo_cancelamento: m } : {}),
      });
    }
    return nova;
  }

  acaoFormulario(c: ContextoPortaPropria, formulario: number, entrada: unknown) {
    const e = entradaValida(esquemaAcaoFormulario, entrada);
    return this.gravar(
      c,
      `internacao.formulario-obito.${e.acao}`,
      ['formulario_declaracao_obito', 'declaracao_obito'],
      async (tx, est) => {
        const f = await travada(
          tx,
          'SELECT * FROM formulario_declaracao_obito WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [formulario, est.id],
        );
        if (!f) throw naoEncontrado('Formulário de declaração de óbito');
        const situacao = await this.aplicarAcao(tx, est.id, f, e.acao, e.declaracao, e.motivo, e.versao);
        return { tabela: 'formulario_declaracao_obito', id: formulario, situacao };
      },
    );
  }

  /** Liga, de uma vez, cada declaração emitida sem formulário ao formulário disponível de mesmo número. */
  conciliarUsos(c: ContextoPortaPropria): Promise<{ ligados: number; semFormulario: number }> {
    return this.gravar(
      c,
      'internacao.formulario-obito.conciliar',
      ['formulario_declaracao_obito', 'declaracao_obito'],
      async (tx, est) => {
        const pares = await tx.consultar(
          `SELECT f.id AS f_id, d.id AS d_id FROM declaracao_obito d
             JOIN formulario_declaracao_obito f
               ON f.estabelecimento_id = d.estabelecimento_id AND f.numero = d.numero AND f.situacao = 'disponivel'
              AND f.excluido_em IS NULL
            WHERE d.estabelecimento_id = ? AND d.excluido_em IS NULL AND d.situacao = 'emitida'
              AND d.formulario_declaracao_obito_id IS NULL`,
          [est.id],
        );
        for (const p of pares) {
          const f = await travada(tx, 'SELECT * FROM formulario_declaracao_obito WHERE id = ?', [p['f_id']]);
          await this.aplicarAcao(tx, est.id, f!, 'usar', num(p['d_id']), null, num(f!['versao']));
        }
        const resto = await tx.uma(
          `SELECT COUNT(*) AS n FROM declaracao_obito WHERE estabelecimento_id = ? AND excluido_em IS NULL
              AND situacao = 'emitida' AND formulario_declaracao_obito_id IS NULL`,
          [est.id],
        );
        return {
          tabela: 'formulario_declaracao_obito',
          id: pares.length ? num(pares[0]!['f_id']) : null,
          ligados: pares.length,
          semFormulario: num(resto?.['n']),
        };
      },
    );
  }

  // ── Auditoria do isolamento (04-INT linha 75) ────────────────────────────────────────────────────────────────

  private async criteriosDo(
    l: { consultar: TxOperacao['consultar'] },
    tipo: number,
  ): Promise<(CriterioAuditoria & { ordem: number; orientacao: string | null })[]> {
    const rs = await l.consultar(
      `SELECT id, ordem, descricao, orientacao, acao_nao_conformidade, validade_dias FROM criterio_auditoria_isolamento
        WHERE tipo_precaucao_id = ? AND ativo ORDER BY ordem`,
      [tipo],
    );
    return rs.map((r) => ({
      id: num(r['id']),
      ordem: num(r['ordem']),
      descricao: String(r['descricao']),
      orientacao: txtOuNull(r['orientacao']),
      acao: String(r['acao_nao_conformidade']) as AcaoNaoConformidade,
      validadeDias: numOuNull(r['validade_dias']),
    }));
  }

  criteriosAuditoria(c: ContextoPortaPropria, tipoPrecaucao: number) {
    return this.ler(c, 'criterios-isolamento', async (l) => ({
      itens: await this.criteriosDo(l as never, tipoPrecaucao),
    }));
  }

  incluirCriterio(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number; ordem: number }> {
    const e = entradaValida(esquemaCriterio, entrada);
    return this.gravar(
      c,
      'internacao.isolamento.incluir-criterio',
      ['criterio_auditoria_isolamento'],
      async (tx) => {
        const t = await tx.uma('SELECT id FROM tipo_precaucao WHERE id = ? AND ativo', [e.tipoPrecaucao]);
        if (!t) throw naoEncontrado('Tipo de precaução');
        const m = await tx.uma(
          'SELECT COALESCE(MAX(ordem), 0) AS o FROM criterio_auditoria_isolamento WHERE tipo_precaucao_id = ?',
          [e.tipoPrecaucao],
        );
        const ordem = num(m?.['o']) + 1;
        const novo = await tx.incluir('criterio_auditoria_isolamento', {
          tipo_precaucao_id: e.tipoPrecaucao,
          ordem,
          descricao: e.descricao,
          orientacao: e.orientacao,
          acao_nao_conformidade: e.acao,
          validade_dias: e.validadeDias,
          ativo: true,
        });
        return { tabela: 'criterio_auditoria_isolamento', id: novo, ordem };
      },
    );
  }

  /** Isolamentos ativos do estabelecimento com a última auditoria e a reauditoria (vencida ou não). */
  isolamentosParaAuditar(c: ContextoPortaPropria) {
    return this.ler(c, 'isolamentos-auditar', async (l, est) => {
      const rs = await l.consultar(
        `SELECT i.id, i.paciente_id, i.internacao_id, i.leito_hospitalar_id, i.tipo_precaucao_id, i.data_hora_inicio,
                t.descricao AS tipo, lh.codigo AS leito,
                (SELECT MAX(a.auditado_em) FROM auditoria_isolamento a
                  WHERE a.isolamento_paciente_id = i.id AND a.situacao = 'concluida' AND a.excluido_em IS NULL) AS ultima
           FROM isolamento_paciente i JOIN tipo_precaucao t ON t.id = i.tipo_precaucao_id
           LEFT JOIN leito_hospitalar lh ON lh.id = i.leito_hospitalar_id
          WHERE i.estabelecimento_id = ? AND i.situacao = 'ativo' AND i.excluido_em IS NULL
          ORDER BY i.data_hora_inicio`,
        [est.id],
      );
      const agora = Date.now();
      const itens = [];
      for (const r of rs) {
        const criterios = await this.criteriosDo(l as never, num(r['tipo_precaucao_id']));
        const ultima = r['ultima'] ? new Date(r['ultima'] as string) : null;
        const proxima = ultima ? proximaReauditoria(ultima, criterios) : null;
        itens.push({
          isolamento: num(r['id']),
          paciente: num(r['paciente_id']),
          internacao: numOuNull(r['internacao_id']),
          leito: txtOuNull(r['leito']),
          tipoPrecaucao: { id: num(r['tipo_precaucao_id']), descricao: String(r['tipo']) },
          inicio: iso(r['data_hora_inicio']),
          ultimaAuditoria: ultima?.toISOString() ?? null,
          proximaAuditoria: proxima?.toISOString() ?? null,
          auditoriaPendente: !ultima || (proxima !== null && proxima.getTime() <= agora),
          criterios: criterios.length,
        });
      }
      return { itens };
    });
  }

  auditar(c: ContextoPortaPropria, entrada: unknown) {
    const e = entradaValida(esquemaAuditoria, entrada);
    return this.gravar(
      c,
      'internacao.isolamento.auditar',
      ['auditoria_isolamento', 'auditoria_isolamento_item', 'aviso_clinico'],
      async (tx, est, usuario) => {
        const i = await tx.uma(
          `SELECT id, paciente_id, internacao_id, leito_hospitalar_id, tipo_precaucao_id, situacao FROM isolamento_paciente
            WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
          [e.isolamento, est.id],
        );
        if (!i) throw naoEncontrado('Isolamento');
        if (i['internacao_id'] == null)
          throw recusaRegra('Auditoria recusada', [
            {
              campo: 'isolamento',
              mensagem: 'A auditoria no leito é do paciente internado: o isolamento não tem internação.',
            },
          ]);
        const criterios = await this.criteriosDo(tx, num(i['tipo_precaucao_id']));
        const r = avaliarAuditoriaIsolamento(String(i['situacao']) === 'ativo', criterios, e.respostas);
        if (!r.ok) recusou('Auditoria recusada', r);
        const v = r as Exclude<typeof r, { ok: false }>;
        const auditoria = await tx.incluir('auditoria_isolamento', {
          isolamento_paciente_id: num(i['id']),
          internacao_id: num(i['internacao_id']),
          leito_hospitalar_id: numOuNull(i['leito_hospitalar_id']),
          tipo_precaucao_id: num(i['tipo_precaucao_id']),
          auditor_usuario_id: usuario,
          auditado_em: new Date(),
          conformidade_geral: v.geral,
          percentual_conformidade: v.percentual,
          situacao: 'concluida',
          observacao: e.observacao,
        });
        const ordem = new Map(criterios.map((x) => [x.id, x.ordem]));
        const respostas = [...e.respostas].sort((a, b) => ordem.get(a.criterio)! - ordem.get(b.criterio)!);
        for (const [n, x] of respostas.entries())
          await tx.incluir('auditoria_isolamento_item', {
            auditoria_isolamento_id: auditoria,
            sequencia: n + 1,
            criterio_auditoria_isolamento_id: x.criterio,
            resposta: x.resposta,
            nao_conformidade: x.resposta === 'nao_conforme' ? x.naoConformidade : null,
            acao_corretiva: x.acaoCorretiva,
          });
        // Critério não conforme com ação "alertar" ou "bloquear": aviso pendente para a CCIH, ligado à auditoria.
        let aviso: number | null = null;
        if (v.alertas.length) {
          const bloqueia = v.alertas.some((x) => x.acao === 'bloquear');
          const internacao = await tx.uma('SELECT atendimento_id FROM internacao WHERE id = ?', [
            num(i['internacao_id']),
          ]);
          aviso = await tx.incluir('aviso_clinico', {
            estabelecimento_id: est.id,
            paciente_id: numOuNull(i['paciente_id']),
            atendimento_id: numOuNull(internacao?.['atendimento_id']),
            titulo: bloqueia
              ? 'Isolamento: não conformidade que exige bloqueio'
              : 'Isolamento: não conformidade na auditoria',
            mensagem: v.alertas
              .map((x) => `${x.acao === 'bloquear' ? 'Bloquear' : 'Alertar'}: ${x.descricao}`)
              .join('\n')
              .slice(0, 20_000),
            prioridade: bloqueia ? 'critica' : 'alta',
            canal: 'sistema',
            exibe_janela: bloqueia,
            situacao: 'pendente',
            gerado_em: new Date(),
            modulo_origem: ORIGEM_AVISO_ISOLAMENTO.modulo,
            entidade_origem: ORIGEM_AVISO_ISOLAMENTO.entidade,
            entidade_origem_chave: auditoria,
          });
        }
        return {
          tabela: 'auditoria_isolamento',
          id: auditoria,
          aviso,
          geral: v.geral,
          percentual: v.percentual,
          alertas: v.alertas,
        };
      },
    );
  }

  cancelarAuditoria(c: ContextoPortaPropria, auditoria: number, entrada: unknown) {
    const e = entradaValida(esquemaCancelarAuditoria, entrada);
    return this.gravar(
      c,
      'internacao.isolamento.cancelar-auditoria',
      ['auditoria_isolamento', 'aviso_clinico'],
      async (tx, est) => {
        const a = await tx.uma(
          `SELECT a.id, a.situacao, a.observacao FROM auditoria_isolamento a
           JOIN isolamento_paciente i ON i.id = a.isolamento_paciente_id
          WHERE a.id = ? AND i.estabelecimento_id = ? AND a.excluido_em IS NULL`,
          [auditoria, est.id],
        );
        if (!a) throw naoEncontrado('Auditoria do isolamento');
        if (String(a['situacao']) === 'cancelada')
          throw recusaRegra('Auditoria já cancelada', [
            { campo: 'situacao', mensagem: 'A auditoria já está cancelada.' },
          ]);
        const obs = [txtOuNull(a['observacao']), `Cancelada: ${e.motivo}`]
          .filter(Boolean)
          .join(' | ')
          .slice(0, 2000);
        await tx.alterar('auditoria_isolamento', auditoria, e.versao, {
          situacao: 'cancelada',
          observacao: obs,
        });
        // O aviso da auditoria cancelada deixa de valer (fica, cancelado, no histórico).
        const avisos = await tx.consultarParaAtualizar(
          `SELECT id, versao FROM aviso_clinico WHERE entidade_origem = ? AND entidade_origem_chave = ?
              AND modulo_origem = ? AND situacao IN ('pendente','enviado','lido') AND excluido_em IS NULL`,
          [ORIGEM_AVISO_ISOLAMENTO.entidade, auditoria, ORIGEM_AVISO_ISOLAMENTO.modulo],
        );
        for (const x of avisos)
          await tx.alterar('aviso_clinico', num(x['id']), num(x['versao']), { situacao: 'cancelado' });
        return { tabela: 'auditoria_isolamento', id: auditoria };
      },
    );
  }

  /** Lista da CCIH: avisos das auditorias do isolamento (pendentes por padrão), do mais grave ao mais antigo. */
  avisosIsolamento(c: ContextoPortaPropria, todos = false) {
    return this.ler(c, 'avisos-isolamento', async (l, est) => {
      const rs = await l.consultar(
        `SELECT v.id, v.paciente_id, v.titulo, v.mensagem, v.prioridade, v.situacao, v.gerado_em, v.resolvido_em,
                v.entidade_origem_chave AS auditoria, v.versao, a.isolamento_paciente_id, a.leito_hospitalar_id
           FROM aviso_clinico v JOIN auditoria_isolamento a ON a.id = v.entidade_origem_chave
          WHERE v.estabelecimento_id = ? AND v.modulo_origem = ? AND v.entidade_origem = ? AND v.excluido_em IS NULL
            ${todos ? '' : "AND v.situacao IN ('pendente','enviado','lido')"}
          ORDER BY FIELD(v.prioridade, 'critica', 'alta', 'normal', 'baixa'), v.gerado_em, v.id`,
        [est.id, ORIGEM_AVISO_ISOLAMENTO.modulo, ORIGEM_AVISO_ISOLAMENTO.entidade],
      );
      return {
        itens: rs.map((r) => ({
          id: num(r['id']),
          paciente: numOuNull(r['paciente_id']),
          auditoria: num(r['auditoria']),
          isolamento: num(r['isolamento_paciente_id']),
          titulo: String(r['titulo']),
          mensagem: String(r['mensagem']),
          prioridade: String(r['prioridade']),
          situacao: String(r['situacao']),
          geradoEm: iso(r['gerado_em']),
          resolvidoEm: iso(r['resolvido_em']),
          versao: num(r['versao']),
        })),
      };
    });
  }

  /** A CCIH dá o aviso por resolvido (a providência vai no texto); o aviso não é apagado. */
  resolverAvisoIsolamento(c: ContextoPortaPropria, aviso: number, entrada: unknown) {
    const e = entradaValida(esquemaResolverAviso, entrada);
    return this.gravar(
      c,
      'internacao.isolamento.resolver-aviso',
      ['aviso_clinico'],
      async (tx, est, usuario) => {
        const v = await travada(
          tx,
          `SELECT id, situacao, detalhes FROM aviso_clinico WHERE id = ? AND estabelecimento_id = ?
            AND modulo_origem = ? AND entidade_origem = ? AND excluido_em IS NULL`,
          [aviso, est.id, ORIGEM_AVISO_ISOLAMENTO.modulo, ORIGEM_AVISO_ISOLAMENTO.entidade],
        );
        if (!v) throw naoEncontrado('Aviso do isolamento');
        if (['resolvido', 'cancelado'].includes(String(v['situacao'])))
          throw recusaRegra('Aviso já encerrado', [
            { campo: 'situacao', mensagem: `O aviso já está ${String(v['situacao'])}.` },
          ]);
        const detalhes = [txtOuNull(v['detalhes']), `Providência: ${e.providencia}`]
          .filter(Boolean)
          .join('\n');
        await tx.alterar('aviso_clinico', aviso, e.versao, {
          situacao: 'resolvido',
          resolvido_em: new Date(),
          resolvido_usuario_id: usuario,
          detalhes,
        });
        return { tabela: 'aviso_clinico', id: aviso };
      },
    );
  }

  /** Visão por paciente: as auditorias dos isolamentos dele, com os itens. */
  auditoriasDoPaciente(c: ContextoPortaPropria, paciente: number) {
    return this.ler(c, 'auditorias-paciente', async (l, est) => {
      const as = await l.consultar(
        `SELECT a.id, a.isolamento_paciente_id, a.auditado_em, a.conformidade_geral, a.percentual_conformidade,
                a.situacao, a.observacao, a.versao, t.descricao AS tipo, u.login AS auditor
           FROM auditoria_isolamento a JOIN isolamento_paciente i ON i.id = a.isolamento_paciente_id
           JOIN tipo_precaucao t ON t.id = a.tipo_precaucao_id LEFT JOIN usuario u ON u.id = a.auditor_usuario_id
          WHERE i.paciente_id = ? AND i.estabelecimento_id = ? AND a.excluido_em IS NULL
          ORDER BY a.auditado_em DESC, a.id DESC`,
        [paciente, est.id],
      );
      const ids = as.map((a) => num(a['id']));
      const itens = ids.length
        ? await l.consultar(
            `SELECT x.auditoria_isolamento_id, x.sequencia, x.resposta, x.nao_conformidade, x.acao_corretiva,
                    k.descricao FROM auditoria_isolamento_item x
               JOIN criterio_auditoria_isolamento k ON k.id = x.criterio_auditoria_isolamento_id
              WHERE x.auditoria_isolamento_id IN (${ids.map(() => '?').join(',')}) AND x.excluido_em IS NULL
              ORDER BY x.sequencia`,
            ids,
          )
        : [];
      return {
        itens: as.map((a) => ({
          id: num(a['id']),
          isolamento: num(a['isolamento_paciente_id']),
          tipoPrecaucao: String(a['tipo']),
          auditadoEm: iso(a['auditado_em']),
          auditor: txtOuNull(a['auditor']),
          geral: txtOuNull(a['conformidade_geral']),
          percentual: a['percentual_conformidade'] == null ? null : Number(a['percentual_conformidade']),
          situacao: String(a['situacao']),
          observacao: txtOuNull(a['observacao']),
          versao: num(a['versao']),
          respostas: itens
            .filter((x) => num(x['auditoria_isolamento_id']) === num(a['id']))
            .map((x) => ({
              sequencia: num(x['sequencia']),
              criterio: String(x['descricao']),
              resposta: String(x['resposta']),
              naoConformidade: txtOuNull(x['nao_conformidade']),
              acaoCorretiva: txtOuNull(x['acao_corretiva']),
            })),
        })),
      };
    });
  }

  // ── Regulação: quadro clínico e evolução (04-INT linha 78) ───────────────────────────────────────────────────

  apoioRegulacao(c: ContextoPortaPropria) {
    return this.ler(c, 'apoio-regulacao', async (l) => {
      const lista = async (sql: string) =>
        (await l.consultar(sql)).map((r) => ({ id: num(r['id']), descricao: String(r['descricao']) }));
      return {
        niveisConsciencia: await lista(
          'SELECT id, descricao FROM nivel_consciencia WHERE ativo ORDER BY ordem_gravidade, descricao',
        ),
        suportesOxigenio: await lista(
          'SELECT id, descricao FROM suporte_oxigenio WHERE ativo ORDER BY descricao',
        ),
        faixasDiurese: await lista('SELECT id, descricao FROM faixa_diurese WHERE ativo ORDER BY descricao'),
        germes: await lista(
          'SELECT id, descricao FROM microrganismo WHERE ativo ORDER BY descricao LIMIT 500',
        ),
      };
    });
  }

  linhaDoTempoRegulacao(c: ContextoPortaPropria, solicitacao: number) {
    return this.ler(c, 'regulacao-linha-tempo', async (l, est) => {
      const s = await l.uma(
        `SELECT id, paciente_id, situacao, numero, versao, solicitado_em, regulado_em, encerrado_em
           FROM solicitacao_regulacao WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [solicitacao, est.id],
      );
      if (!s) throw naoEncontrado('Solicitação de regulação');
      const quadros = await l.consultar(
        `SELECT q.*, nc.descricao AS consciencia, so.descricao AS suporte, fd.descricao AS diurese
           FROM quadro_clinico_regulacao q LEFT JOIN nivel_consciencia nc ON nc.id = q.nivel_consciencia_id
           LEFT JOIN suporte_oxigenio so ON so.id = q.suporte_oxigenio_id LEFT JOIN faixa_diurese fd ON fd.id = q.faixa_diurese_id
          WHERE q.solicitacao_regulacao_id = ? AND q.excluido_em IS NULL ORDER BY q.sequencia DESC`,
        [solicitacao],
      );
      const eventos = await l.consultar(
        `SELECT e.id, e.tipo_evento, e.situacao_anterior, e.situacao_nova, e.observacao, e.enviado_em, e.ocorrido_em,
                u.login AS por FROM evento_regulacao e LEFT JOIN usuario u ON u.id = e.usuario_id
          WHERE e.solicitacao_regulacao_id = ? ORDER BY e.ocorrido_em DESC, e.id DESC`,
        [solicitacao],
      );
      return {
        solicitacao: {
          id: num(s['id']),
          paciente: num(s['paciente_id']),
          situacao: String(s['situacao']),
          numero: txtOuNull(s['numero']),
          versao: num(s['versao']),
          solicitadoEm: iso(s['solicitado_em']),
          reguladoEm: iso(s['regulado_em']),
          encerradoEm: iso(s['encerrado_em']),
        },
        quadros: quadros.map((q) => ({
          id: num(q['id']),
          sequencia: num(q['sequencia']),
          registradoEm: iso(q['data_hora_registro']),
          enviadoEm: iso(q['data_hora_envio']),
          quadroClinico: String(q['quadro_clinico']),
          condicaoGeral: String(q['condicao_geral']),
          consciencia: txtOuNull(q['consciencia']),
          suporteOxigenio: txtOuNull(q['suporte']),
          diurese: txtOuNull(q['diurese']),
          saturacao: q['saturacao_oxigenio'] == null ? null : Number(q['saturacao_oxigenio']),
          frequenciaCardiaca: numOuNull(q['frequencia_cardiaca']),
          usaDrogaVasoativa: bool(q['usa_droga_vasoativa']),
          necessitaIsolamento: bool(q['necessita_isolamento']),
        })),
        eventos: eventos.map((e) => ({
          id: num(e['id']),
          tipo: String(e['tipo_evento']),
          de: txtOuNull(e['situacao_anterior']),
          para: txtOuNull(e['situacao_nova']),
          observacao: txtOuNull(e['observacao']),
          enviadoEm: iso(e['enviado_em']),
          em: iso(e['ocorrido_em']),
          por: txtOuNull(e['por']),
        })),
        envio: {
          automatico: false,
          motivo: 'O envio à central é manual até a central confirmar a interface.',
        },
      };
    });
  }

  private async solicitacaoAberta(tx: TxOperacao, solicitacao: number, estId: number) {
    const s = await travada(
      tx,
      `SELECT id, situacao, versao, central_reguladora_id FROM solicitacao_regulacao
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [solicitacao, estId],
    );
    if (!s) throw naoEncontrado('Solicitação de regulação');
    return s;
  }

  registrarQuadro(c: ContextoPortaPropria, solicitacao: number, entrada: unknown) {
    const e = entradaValida(esquemaQuadro, entrada);
    return this.gravar(
      c,
      'internacao.regulacao.quadro-clinico',
      ['quadro_clinico_regulacao', 'evento_regulacao', 'solicitacao_regulacao'],
      async (tx, est, usuario) => {
        const s = await this.solicitacaoAberta(tx, solicitacao, est.id);
        const situacao = String(s['situacao']) as SituacaoRegulacao;
        if (['negada', 'cancelada', 'concluida'].includes(situacao))
          throw recusaRegra('Quadro recusado', [
            { campo: 'solicitacao', mensagem: 'A solicitação está encerrada: não recebe quadro novo.' },
          ]);
        const sup = e.suporteOxigenio
          ? await tx.uma('SELECT invasivo FROM suporte_oxigenio WHERE id = ?', [e.suporteOxigenio])
          : null;
        if (e.suporteOxigenio && !sup) throw naoEncontrado('Suporte de oxigênio');
        const v = conferirQuadroClinico({ ...e, suporteInvasivo: bool(sup?.['invasivo']) });
        if (!v.ok) recusou('Quadro recusado', v);
        const { sugerida, aviso } = v as { sugerida: string; aviso: string | null };
        const prof = await tx.uma(
          `SELECT profissional_id AS id FROM usuario_vinculo_profissional
            WHERE usuario_id = ? AND estabelecimento_id = ? AND profissional_id IS NOT NULL AND vigencia_inicio <= CURRENT_DATE
              AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE) ORDER BY vigencia_inicio DESC LIMIT 1`,
          [usuario, est.id],
        );
        const seq = await tx.uma(
          'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM quadro_clinico_regulacao WHERE solicitacao_regulacao_id = ?',
          [solicitacao],
        );
        const agora = new Date();
        const [g1, g2, g3] = e.germes;
        const quadro = await tx.incluir('quadro_clinico_regulacao', {
          solicitacao_regulacao_id: solicitacao,
          sequencia: num(seq?.['s']),
          data_hora_registro: agora,
          registro_profissional_id: numOuNull(prof?.['id']),
          quadro_clinico: e.quadroClinico,
          condicao_geral: e.condicaoGeral,
          nivel_consciencia_id: e.nivelConsciencia,
          suporte_oxigenio_id: e.suporteOxigenio,
          fluxo_oxigenio_litros_minuto: e.fluxoOxigenio,
          fracao_inspirada_oxigenio: e.fracaoInspirada,
          peep: e.peep,
          faixa_diurese_id: e.faixaDiurese,
          frequencia_cardiaca: e.frequenciaCardiaca,
          frequencia_respiratoria: e.frequenciaRespiratoria,
          pressao_sistolica: e.pressaoSistolica,
          pressao_diastolica: e.pressaoDiastolica,
          temperatura: e.temperatura,
          saturacao_oxigenio: e.saturacao,
          usa_droga_vasoativa: e.usaDrogaVasoativa,
          drogas_vasoativas: e.drogasVasoativas,
          necessita_isolamento: e.necessitaIsolamento,
          germe_1_microrganismo_id: g1 ?? null,
          germe_2_microrganismo_id: g2 ?? null,
          germe_3_microrganismo_id: g3 ?? null,
          germe_multirresistente: e.germeMultirresistente,
        });
        const nc = e.nivelConsciencia
          ? await tx.uma('SELECT codigo FROM nivel_consciencia WHERE id = ?', [e.nivelConsciencia])
          : null;
        const so = e.suporteOxigenio
          ? await tx.uma('SELECT codigo FROM suporte_oxigenio WHERE id = ?', [e.suporteOxigenio])
          : null;
        await tx.incluir('evento_regulacao', {
          solicitacao_regulacao_id: solicitacao,
          central_reguladora_id: numOuNull(s['central_reguladora_id']),
          tipo_evento: 'evolucao_clinica',
          situacao_anterior: situacao,
          situacao_nova: situacao,
          quadro_clinico: e.quadroClinico,
          frequencia_cardiaca: e.frequenciaCardiaca,
          frequencia_respiratoria: e.frequenciaRespiratoria,
          pressao_sistolica: e.pressaoSistolica,
          pressao_diastolica: e.pressaoDiastolica,
          temperatura: e.temperatura,
          saturacao_oxigenio: e.saturacao,
          nivel_consciencia: txtOuNull(nc?.['codigo'])?.slice(0, 30) ?? null,
          faixa_diurese_id: e.faixaDiurese,
          suporte_oxigenio: txtOuNull(so?.['codigo'])?.slice(0, 30) ?? null,
          fluxo_oxigenio: e.fluxoOxigenio,
          fracao_inspirada_oxigenio: e.fracaoInspirada,
          pressao_expiratoria_final: e.peep,
          usa_droga_vasoativa: e.usaDrogaVasoativa,
          isolamento_necessario: e.necessitaIsolamento,
          germe_multirresistente: e.germeMultirresistente,
          operacao: 'inclusao',
          dados: JSON.stringify({ quadro, sequencia: num(seq?.['s']), condicao: e.condicaoGeral, sugerida }),
          ocorrido_em: agora,
          usuario_id: usuario,
        });
        // Os sinais vigentes ficam na solicitação (a fila e o pedido à central leem o último quadro). Só o sinal
        // informado neste quadro troca o vigente: um quadro parcial não apaga o que o anterior registrou.
        await tx.alterar(
          'solicitacao_regulacao',
          solicitacao,
          e.versao,
          sinaisVigentes(e, (k) => Object.prototype.hasOwnProperty.call(entrada ?? {}, k)),
        );
        return {
          tabela: 'quadro_clinico_regulacao',
          id: quadro,
          sequencia: num(seq?.['s']),
          sugerida,
          aviso,
        };
      },
    );
  }

  registrarEvento(c: ContextoPortaPropria, solicitacao: number, entrada: unknown) {
    const e = entradaValida(esquemaEvento, entrada);
    return this.gravar(
      c,
      'internacao.regulacao.evento',
      ['evento_regulacao', 'solicitacao_regulacao'],
      async (tx, est, usuario) => {
        const s = await this.solicitacaoAberta(tx, solicitacao, est.id);
        const atual = String(s['situacao']) as SituacaoRegulacao;
        const d = decidirEventoRegulacao(atual, e.tipo, e.situacaoNova, e.observacao);
        if (!d.ok) recusou('Evento recusado', d);
        const nova = (d as { situacaoNova: SituacaoRegulacao | null }).situacaoNova;
        const agora = new Date();
        const evento = await tx.incluir('evento_regulacao', {
          solicitacao_regulacao_id: solicitacao,
          central_reguladora_id: numOuNull(s['central_reguladora_id']),
          tipo_evento: e.tipo,
          situacao_anterior: atual,
          situacao_nova: nova ?? atual,
          observacao: e.observacao,
          operacao: nova ? 'alteracao' : 'inclusao',
          dados: JSON.stringify({ tipo: e.tipo, de: atual, para: nova ?? atual }),
          ocorrido_em: agora,
          usuario_id: usuario,
        });
        if (nova) {
          const m = marcasDaSituacao(nova);
          await tx.alterar('solicitacao_regulacao', solicitacao, e.versao, {
            situacao: nova,
            ...(m.regulado ? { regulado_em: agora } : {}),
            ...(m.encerrado ? { encerrado_em: agora } : {}),
            ...(e.tipo === 'resposta' && e.observacao
              ? { mensagem_central: e.observacao.slice(0, 1000) }
              : {}),
          });
        } else if (e.tipo === 'resposta' && e.observacao)
          await tx.alterar('solicitacao_regulacao', solicitacao, e.versao, {
            mensagem_central: e.observacao.slice(0, 1000),
          });
        return { tabela: 'evento_regulacao', id: evento, situacao: nova ?? atual };
      },
    );
  }
}
