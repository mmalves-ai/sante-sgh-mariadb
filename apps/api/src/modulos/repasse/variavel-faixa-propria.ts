// Remuneração variável por faixa e o rateio da equipe no banco do cliente (F8, 06-FAT linha 48). As regras puras ficam
// em @sgh/dominio-repasse (variavel-faixa); aqui, a leitura da medida e a gravação. Contrato de efeito:
//   - equipe: `equipe_repasse_variavel` (código único no estabelecimento) e os membros em
//     `equipe_repasse_variavel_membro` com a cota, o chefe e a vigência; a composição vigente soma 100%;
//   - recompor a equipe numa data: os membros vigentes ganham `vigencia_fim` no dia anterior e a nova composição entra
//     com a data de início (nada apagado; o histórico das cotas fica);
//   - regra: `regra_repasse_variavel` (profissional ou equipe, indicador, período, filtros de fonte pagadora, plano e
//     item, pacote, evento do acréscimo e evento do desconto) e as faixas em `regra_repasse_variavel_faixa`; regra
//     que cruza outra vigente do mesmo beneficiário e indicador: 422 sem gravar; encerrar só grava `vigencia_fim`;
//   - medida do período (das apurações do repasse não canceladas das competências do período): quantidade de
//     procedimentos (itens apurados), de cirurgias (itens com ato cirúrgico), valor produzido (faturado), valor
//     recebido (faturado menos glosa) e resultado (margem do custeio apurado); a produção do repasse é a base;
//   - lançar na apuração (em apuração ou apurada, só na competência que fecha o período): cada parte vira
//     `lancamento_repasse` (tipo 'apuracao', favorecido próprio do profissional, evento do acréscimo ou do desconto,
//     valor positivo, referente com o código da regra e a competência); os totais de `apuracao_repasse` somam o
//     acréscimo no bruto e o desconto nos descontos; lançar de novo não duplica (o referente identifica o lançado).
import {
  AJUSTES_FAIXA,
  type AjusteFaixa,
  calcularVariavelFaixa,
  conferirComposicao,
  conflitoRegraVariavel,
  type FaixaVariavel,
  INDICADORES_VARIAVEL,
  type IndicadorVariavel,
  type MembroEquipeVariavel,
  membrosVigentes,
  PERIODOS_VARIAVEL,
  type PeriodoVariavel,
  periodoDaCompetencia,
  ratearEquipe,
  ultimoDiaDoMes,
  validarMembroEquipe,
  validarRegraVariavelFaixa,
} from '@sgh/dominio-repasse';
import type { Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import { civil } from '../exames/relogio.js';
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

export const PORTA_VARIAVEL_FAIXA = Symbol('PORTA_VARIAVEL_FAIXA');

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dataTexto = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const cent = (v: unknown): number => Math.round(Number(v ?? 0) * 100);
const diaAnterior = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};

const esquemaMembro = z
  .object({
    profissional: id.nullable().default(null),
    terceiro: id.nullable().default(null),
    cota: z.number(),
    chefe: z.boolean().default(false),
  })
  .strict();

const esquemaEquipe = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    nome: z.string().trim().min(1).max(150),
    descricao: z.string().trim().max(500).nullable().default(null),
    inicio: data,
    membros: z.array(esquemaMembro).min(1).max(60),
  })
  .strict();

const esquemaRecompor = z
  .object({
    versao: z.number().int().positive(),
    inicio: data,
    membros: z.array(esquemaMembro).min(1).max(60),
  })
  .strict();

const esquemaFaixa = z
  .object({
    de: z.number().finite(),
    ate: z.number().finite().nullable().default(null),
    ajuste: z.enum(AJUSTES_FAIXA as unknown as [AjusteFaixa, ...AjusteFaixa[]]).default('acrescimo'),
    percentual: z.number().finite().nullable().default(null),
    valorFixo: z.number().finite().nullable().default(null),
    incremento: z.number().finite().nullable().default(null),
    sobreLiquido: z.boolean().default(false),
  })
  .strict();

const esquemaRegra = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    profissional: id.nullable().default(null),
    equipe: id.nullable().default(null),
    indicador: z.enum(INDICADORES_VARIAVEL as unknown as [IndicadorVariavel, ...IndicadorVariavel[]]),
    periodo: z
      .enum(PERIODOS_VARIAVEL as unknown as [PeriodoVariavel, ...PeriodoVariavel[]])
      .default('mensal'),
    fontePagadora: id.nullable().default(null),
    plano: id.nullable().default(null),
    itemFaturavel: id.nullable().default(null),
    considerarPacote: z.boolean().default(false),
    percentualPacote: z.number().finite().nullable().default(null),
    evento: id,
    eventoDesconto: id.nullable().default(null),
    inicio: data,
    fim: data.nullable().default(null),
    faixas: z.array(esquemaFaixa).max(20),
  })
  .strict();

const esquemaEncerrar = z.object({ versao: z.number().int().positive(), fim: data }).strict();

export interface ParteSimulada {
  readonly profissional: number | null;
  readonly terceiro: number | null;
  readonly nome: string;
  readonly cota: number;
  readonly valor: number;
  readonly lancado: boolean;
}

export interface RegraSimulada {
  readonly regra: number;
  readonly codigo: string;
  readonly descricao: string;
  readonly beneficiario: string;
  readonly indicador: IndicadorVariavel;
  readonly periodo: PeriodoVariavel;
  readonly periodoInicio: string;
  readonly periodoFim: string;
  readonly fecha: boolean;
  readonly medida: number;
  readonly base: number;
  readonly faixa: number | null;
  readonly percentual: number;
  readonly valor: number;
  readonly memoria: string;
  readonly referente: string;
  readonly partes: readonly ParteSimulada[];
  readonly pendencias: readonly string[];
}

const SITUACOES_LANCAVEIS = ['em_apuracao', 'apurada'];
const NOME_PROF = `(SELECT pf.nome FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
                    WHERE pr.id = m.profissional_id)`;

export class PortaVariavelFaixaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(
      nucleo,
      cliente,
      [
        'equipe_repasse_variavel',
        'equipe_repasse_variavel_membro',
        'regra_repasse_variavel',
        'regra_repasse_variavel_faixa',
        'lancamento_repasse',
        'apuracao_repasse',
      ],
      'repasse.variavel-faixa',
    );
  }

  // ── Leitura ────────────────────────────────────────────────────────────────────────────────────────

  /** Regras, equipes (com a composição e o histórico) e as listas da tela. */
  painel(c: ContextoPortaPropria) {
    return this.ler(c, 'painel', async (l, est) => {
      const equipes = await this.equipes(l, est.id);
      const regras = await this.regras(l, est.id);
      const eventos = (
        await l.consultar<Linha>(
          `SELECT id, codigo, nome, natureza FROM evento_repasse
            WHERE estabelecimento_id = ? AND ativo AND natureza IN ('rendimento','desconto') ORDER BY codigo LIMIT 500`,
          [est.id],
        )
      ).map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        nome: String(x['nome']),
        natureza: String(x['natureza']),
      }));
      const fontes = (
        await l.consultar<Linha>(
          'SELECT id, nome FROM fonte_pagadora WHERE excluido_em IS NULL ORDER BY nome LIMIT 1000',
          [],
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
      const apuracoes = (
        await l.consultar<Linha>(
          `SELECT id, numero, competencia, situacao FROM apuracao_repasse
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelada'
            ORDER BY competencia DESC, id DESC LIMIT 24`,
          [est.id],
        )
      ).map((x) => ({
        id: num(x['id']),
        numero: String(x['numero']),
        competencia: dataTexto(x['competencia'])!,
        situacao: String(x['situacao']),
      }));
      return { regras, equipes, eventos, fontes, apuracoes };
    });
  }

  private async equipes(l: Leitor, est: number) {
    const eqs = await l.consultar<Linha>(
      `SELECT id, codigo, nome, descricao, ativo, versao FROM equipe_repasse_variavel
        WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY codigo`,
      [est],
    );
    if (!eqs.length) return [];
    const ids = eqs.map((e) => num(e['id']));
    const membros = await l.consultar<Linha>(
      `SELECT m.*, ${NOME_PROF} AS nome_prof,
              (SELECT t.nome FROM prestador_terceiro t WHERE t.id = m.prestador_terceiro_id) AS nome_terceiro
         FROM equipe_repasse_variavel_membro m
        WHERE m.equipe_repasse_variavel_id IN (${ids.map(() => '?').join(',')}) AND m.excluido_em IS NULL
        ORDER BY m.vigencia_inicio DESC, m.sequencia`,
      ids,
    );
    return eqs.map((e) => ({
      id: num(e['id']),
      codigo: String(e['codigo']),
      nome: String(e['nome']),
      descricao: txtOuNull(e['descricao']),
      ativo: bool(e['ativo']),
      versao: num(e['versao']),
      membros: membros
        .filter((m) => num(m['equipe_repasse_variavel_id']) === num(e['id']))
        .map((m) => ({
          id: num(m['id']),
          profissional: numOuNull(m['profissional_id']),
          terceiro: numOuNull(m['prestador_terceiro_id']),
          nome: String(m['nome_prof'] ?? m['nome_terceiro'] ?? ''),
          cota: Number(m['cota_percentual']),
          chefe: bool(m['chefe_equipe']),
          inicio: dataTexto(m['vigencia_inicio'])!,
          fim: dataTexto(m['vigencia_fim']),
        })),
    }));
  }

  private async regras(l: Leitor, est: number, so?: number) {
    const rs = await l.consultar<Linha>(
      `SELECT r.*, (SELECT pf.nome FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
                     WHERE pr.id = r.profissional_id) AS nome_prof,
              (SELECT e.nome FROM equipe_repasse_variavel e WHERE e.id = r.equipe_repasse_variavel_id) AS nome_equipe,
              (SELECT f.nome FROM fonte_pagadora f WHERE f.id = r.fonte_pagadora_id) AS nome_fonte,
              (SELECT v.nome FROM evento_repasse v WHERE v.id = r.evento_repasse_id) AS nome_evento,
              (SELECT v.nome FROM evento_repasse v WHERE v.id = r.evento_desconto_repasse_id) AS nome_evento_desconto
         FROM regra_repasse_variavel r
        WHERE r.estabelecimento_id = ? AND (? IS NULL OR r.id = ?)
        ORDER BY r.ativo DESC, r.codigo, r.vigencia_inicio DESC`,
      [est, so ?? null, so ?? null],
    );
    if (!rs.length) return [];
    const ids = rs.map((r) => num(r['id']));
    const fx = await l.consultar<Linha>(
      `SELECT * FROM regra_repasse_variavel_faixa
        WHERE regra_repasse_variavel_id IN (${ids.map(() => '?').join(',')}) AND excluido_em IS NULL
        ORDER BY regra_repasse_variavel_id, faixa_inicial`,
      ids,
    );
    return rs.map((r) => ({
      id: num(r['id']),
      codigo: String(r['codigo']),
      descricao: String(r['descricao']),
      profissional: numOuNull(r['profissional_id']),
      equipe: numOuNull(r['equipe_repasse_variavel_id']),
      beneficiario: String(r['nome_prof'] ?? r['nome_equipe'] ?? ''),
      indicador: String(r['indicador']) as IndicadorVariavel,
      periodo: String(r['periodo_apuracao']) as PeriodoVariavel,
      fontePagadora: numOuNull(r['fonte_pagadora_id']),
      fonteNome: txtOuNull(r['nome_fonte']),
      plano: numOuNull(r['plano_fonte_pagadora_id']),
      itemFaturavel: numOuNull(r['item_faturavel_id']),
      considerarPacote: bool(r['considera_pacote']),
      percentualPacote: r['percentual_pacote'] === null ? null : Number(r['percentual_pacote']),
      evento: numOuNull(r['evento_repasse_id']),
      eventoNome: txtOuNull(r['nome_evento']),
      eventoDesconto: numOuNull(r['evento_desconto_repasse_id']),
      eventoDescontoNome: txtOuNull(r['nome_evento_desconto']),
      inicio: dataTexto(r['vigencia_inicio'])!,
      fim: dataTexto(r['vigencia_fim']),
      ativo: bool(r['ativo']),
      versao: num(r['versao']),
      faixas: fx
        .filter((f) => num(f['regra_repasse_variavel_id']) === num(r['id']))
        .map((f): FaixaVariavel => ({
          de: Number(f['faixa_inicial']),
          ate: f['faixa_final'] === null ? null : Number(f['faixa_final']),
          ajuste: String(f['tipo_ajuste']) as AjusteFaixa,
          percentual: f['percentual'] === null ? null : Number(f['percentual']),
          valorFixo: f['valor_fixo'] === null ? null : Number(f['valor_fixo']),
          incremento: f['percentual_incremento'] === null ? null : Number(f['percentual_incremento']),
          sobreLiquido: bool(f['calcula_sobre_liquido']),
        })),
    }));
  }

  // ── Equipe ─────────────────────────────────────────────────────────────────────────────────────────

  private async conferirMembros(
    l: Leitor,
    membros: readonly z.infer<typeof esquemaMembro>[],
    inicio: string,
  ): Promise<MembroEquipeVariavel[]> {
    const ms: MembroEquipeVariavel[] = membros.map((m) => ({ ...m, inicio, fim: null }));
    const problemas = [...ms.flatMap((m) => validarMembroEquipe(m)), ...conferirComposicao(ms, inicio)];
    if (problemas.length) throw recusaRegra('Composição da equipe recusada', problemas);
    for (const m of ms) {
      if (
        m.profissional !== null &&
        !(await l.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [m.profissional]))
      )
        throw naoEncontrado('Profissional');
      if (
        m.terceiro !== null &&
        !(await l.uma('SELECT id FROM prestador_terceiro WHERE id = ?', [m.terceiro]))
      )
        throw naoEncontrado('Prestador terceiro');
    }
    return ms;
  }

  /** Cria a equipe com a composição inicial (cotas somando 100%). */
  incluirEquipe(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaEquipe, entrada);
    return this.gravar(
      c,
      'repasse.variavel.equipe.incluir',
      ['equipe_repasse_variavel', 'equipe_repasse_variavel_membro'],
      async (tx, est) => {
        const ms = await this.conferirMembros(tx, e.membros, e.inicio);
        if (
          await tx.uma('SELECT id FROM equipe_repasse_variavel WHERE estabelecimento_id = ? AND codigo = ?', [
            est.id,
            e.codigo,
          ])
        )
          throw recusaRegra('Equipe recusada', [
            { campo: 'codigo', mensagem: 'Já existe equipe com este código.' },
          ]);
        const eq = await tx.incluir('equipe_repasse_variavel', {
          estabelecimento_id: est.id,
          codigo: e.codigo,
          nome: e.nome,
          descricao: e.descricao,
          ativo: true,
          origem: 'sistema',
        });
        let seq = 0;
        for (const m of ms)
          await tx.incluir('equipe_repasse_variavel_membro', {
            equipe_repasse_variavel_id: eq,
            sequencia: ++seq,
            profissional_id: m.profissional,
            prestador_terceiro_id: m.terceiro,
            cota_percentual: m.cota,
            chefe_equipe: m.chefe,
            vigencia_inicio: e.inicio,
            vigencia_fim: null,
            origem: 'sistema',
          });
        return { tabela: 'equipe_repasse_variavel', id: eq };
      },
    );
  }

  /** Nova composição a partir de `inicio`: os vigentes encerram no dia anterior; nada é apagado. */
  recomporEquipe(c: ContextoPortaPropria, equipe: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaRecompor, entrada);
    return this.gravar(
      c,
      'repasse.variavel.equipe.recompor',
      ['equipe_repasse_variavel', 'equipe_repasse_variavel_membro'],
      async (tx, est) => {
        const eq = await tx.uma<Linha>(
          'SELECT id FROM equipe_repasse_variavel WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [equipe, est.id],
        );
        if (!eq) throw naoEncontrado('Equipe');
        const ms = await this.conferirMembros(tx, e.membros, e.inicio);
        const atuais = await tx.consultarParaAtualizar<Linha>(
          `SELECT id, versao, vigencia_inicio, vigencia_fim FROM equipe_repasse_variavel_membro
            WHERE equipe_repasse_variavel_id = ? AND excluido_em IS NULL`,
          [equipe],
        );
        const ontem = diaAnterior(e.inicio);
        for (const a of atuais) {
          const ini = dataTexto(a['vigencia_inicio'])!;
          const fim = dataTexto(a['vigencia_fim']);
          if (fim !== null && fim < e.inicio) continue;
          if (ini >= e.inicio)
            throw recusaRegra('Composição recusada', [
              {
                campo: 'inicio',
                mensagem:
                  'Já há composição começando nesta data ou depois; a nova composição começa depois dela.',
              },
            ]);
          await tx.alterar('equipe_repasse_variavel_membro', num(a['id']), num(a['versao']), {
            vigencia_fim: ontem,
          });
        }
        let seq = num(
          (
            await tx.uma<Linha>(
              'SELECT COALESCE(MAX(sequencia), 0) AS s FROM equipe_repasse_variavel_membro WHERE equipe_repasse_variavel_id = ?',
              [equipe],
            )
          )?.['s'],
        );
        for (const m of ms)
          await tx.incluir('equipe_repasse_variavel_membro', {
            equipe_repasse_variavel_id: equipe,
            sequencia: ++seq,
            profissional_id: m.profissional,
            prestador_terceiro_id: m.terceiro,
            cota_percentual: m.cota,
            chefe_equipe: m.chefe,
            vigencia_inicio: e.inicio,
            vigencia_fim: null,
            origem: 'sistema',
          });
        await tx.alterar('equipe_repasse_variavel', equipe, e.versao, { ativo: true });
        return { tabela: 'equipe_repasse_variavel', id: equipe };
      },
    );
  }

  // ── Regra ──────────────────────────────────────────────────────────────────────────────────────────

  incluirRegra(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaRegra, entrada);
    return this.gravar(
      c,
      'repasse.variavel.faixa.incluir',
      ['regra_repasse_variavel', 'regra_repasse_variavel_faixa'],
      async (tx, est) => {
        const problemas = validarRegraVariavelFaixa(e);
        if (e.faixas.some((f) => f.ajuste === 'desconto') && e.eventoDesconto === null)
          problemas.push({
            campo: 'eventoDesconto',
            mensagem: 'Faixa de desconto pede o evento de desconto.',
          });
        if (problemas.length) throw recusaRegra('Regra recusada', problemas);
        if (
          !(await tx.uma(
            `SELECT id FROM evento_repasse WHERE id = ? AND estabelecimento_id = ? AND ativo AND natureza = 'rendimento'`,
            [e.evento, est.id],
          ))
        )
          throw recusaRegra('Regra recusada', [
            { campo: 'evento', mensagem: 'O evento do acréscimo é um rendimento ativo do estabelecimento.' },
          ]);
        if (
          e.eventoDesconto !== null &&
          !(await tx.uma(
            `SELECT id FROM evento_repasse WHERE id = ? AND estabelecimento_id = ? AND ativo AND natureza = 'desconto'`,
            [e.eventoDesconto, est.id],
          ))
        )
          throw recusaRegra('Regra recusada', [
            {
              campo: 'eventoDesconto',
              mensagem: 'O evento do desconto é um desconto ativo do estabelecimento.',
            },
          ]);
        if (
          e.profissional !== null &&
          !(await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [
            e.profissional,
          ]))
        )
          throw naoEncontrado('Profissional');
        if (
          e.equipe !== null &&
          !(await tx.uma(
            'SELECT id FROM equipe_repasse_variavel WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
            [e.equipe, est.id],
          ))
        )
          throw naoEncontrado('Equipe');
        if (
          e.fontePagadora !== null &&
          !(await tx.uma('SELECT id FROM fonte_pagadora WHERE id = ?', [e.fontePagadora]))
        )
          throw naoEncontrado('Fonte pagadora');
        if (
          e.plano !== null &&
          !(await tx.uma('SELECT id FROM plano_fonte_pagadora WHERE id = ?', [e.plano]))
        )
          throw naoEncontrado('Plano');
        if (
          e.itemFaturavel !== null &&
          !(await tx.uma('SELECT id FROM item_faturavel WHERE id = ?', [e.itemFaturavel]))
        )
          throw naoEncontrado('Item faturável');
        if (
          await tx.uma('SELECT id FROM regra_repasse_variavel WHERE estabelecimento_id = ? AND codigo = ?', [
            est.id,
            e.codigo,
          ])
        )
          throw recusaRegra('Regra recusada', [
            { campo: 'codigo', mensagem: 'Já existe regra com este código.' },
          ]);
        const existentes = await tx.consultarParaAtualizar<Linha>(
          `SELECT vigencia_inicio, vigencia_fim FROM regra_repasse_variavel
            WHERE estabelecimento_id = ? AND ativo AND indicador = ?
              AND (profissional_id <=> ?) AND (equipe_repasse_variavel_id <=> ?)`,
          [est.id, e.indicador, e.profissional, e.equipe],
        );
        const conflito = conflitoRegraVariavel(
          e,
          existentes.map((x) => ({
            inicio: dataTexto(x['vigencia_inicio'])!,
            fim: dataTexto(x['vigencia_fim']),
          })),
        );
        if (conflito.length) throw recusaRegra('Regra recusada', conflito);
        const regra = await tx.incluir('regra_repasse_variavel', {
          estabelecimento_id: est.id,
          codigo: e.codigo,
          descricao: e.descricao,
          equipe_repasse_variavel_id: e.equipe,
          profissional_id: e.profissional,
          indicador: e.indicador,
          periodo_apuracao: e.periodo,
          fonte_pagadora_id: e.fontePagadora,
          plano_fonte_pagadora_id: e.plano,
          item_faturavel_id: e.itemFaturavel,
          evento_repasse_id: e.evento,
          evento_desconto_repasse_id: e.eventoDesconto,
          considera_pacote: e.considerarPacote,
          percentual_pacote: e.percentualPacote,
          vigencia_inicio: e.inicio,
          vigencia_fim: e.fim,
          ativo: true,
        });
        let seq = 0;
        for (const f of [...e.faixas].sort((a, b) => a.de - b.de))
          await tx.incluir('regra_repasse_variavel_faixa', {
            regra_repasse_variavel_id: regra,
            sequencia: ++seq,
            faixa_inicial: f.de,
            faixa_final: f.ate,
            tipo_ajuste: f.ajuste,
            percentual: f.percentual,
            valor_fixo: f.valorFixo,
            percentual_incremento: f.incremento,
            calcula_sobre_liquido: f.sobreLiquido,
            origem: 'sistema',
          });
        return { tabela: 'regra_repasse_variavel', id: regra };
      },
    );
  }

  /** Encerra a regra (só `vigencia_fim`, dentro da vigência; nunca estende nem apaga). */
  encerrarRegra(c: ContextoPortaPropria, regra: number, entrada: unknown): Promise<{ id: number }> {
    const x = entradaValida(esquemaEncerrar, entrada);
    return this.gravar(c, 'repasse.variavel.faixa.encerrar', ['regra_repasse_variavel'], async (tx, est) => {
      const r = await tx.uma<Linha>(
        'SELECT vigencia_inicio, vigencia_fim FROM regra_repasse_variavel WHERE id = ? AND estabelecimento_id = ?',
        [regra, est.id],
      );
      if (!r) throw naoEncontrado('Regra de remuneração variável');
      const ini = dataTexto(r['vigencia_inicio'])!;
      const fim = dataTexto(r['vigencia_fim']);
      if (x.fim < ini || (fim !== null && x.fim >= fim))
        throw recusaRegra('Encerramento recusado', [
          {
            campo: 'fim',
            mensagem: 'O fim fica entre o início da vigência e o fim atual; encerrar não estende.',
          },
        ]);
      await tx.alterar('regra_repasse_variavel', regra, x.versao, { vigencia_fim: x.fim });
      return { tabela: 'regra_repasse_variavel', id: regra };
    });
  }

  // ── Cálculo ────────────────────────────────────────────────────────────────────────────────────────

  private async apuracao(l: Leitor, est: number, apuracao: number) {
    const a = await l.uma<Linha>(
      `SELECT competencia, situacao, versao, valor_bruto, valor_descontos, valor_liquido FROM apuracao_repasse
        WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [apuracao, est],
    );
    if (!a) throw naoEncontrado('Apuração do repasse');
    return {
      competencia: dataTexto(a['competencia'])!,
      situacao: String(a['situacao']),
      versao: num(a['versao']),
      bruto: cent(a['valor_bruto']),
      descontos: cent(a['valor_descontos']),
      liquido: cent(a['valor_liquido']),
    };
  }

  simular(c: ContextoPortaPropria, apuracao: number) {
    return this.ler(c, 'simular', async (l, est) => {
      const a = await this.apuracao(l, est.id, apuracao);
      return {
        apuracao,
        competencia: a.competencia,
        situacao: a.situacao,
        regras: await this.calcular(l, est.id, a.competencia),
      };
    });
  }

  private async medir(
    l: Leitor,
    est: number,
    r: Awaited<ReturnType<PortaVariavelFaixaPropria['regras']>>[number],
    profs: readonly number[],
    comps: readonly string[],
  ) {
    const fator = r.considerarPacote
      ? `CASE WHEN COALESCE(ci.pertence_pacote, FALSE) THEN ${Number(r.percentualPacote ?? 100) / 100} ELSE 1 END`
      : '1';
    const filtros: string[] = [];
    const p: unknown[] = [est, ...comps, ...profs];
    if (!r.considerarPacote) filtros.push('AND COALESCE(ci.pertence_pacote, FALSE) = FALSE');
    if (r.fontePagadora !== null) {
      filtros.push('AND ch.fonte_pagadora_id = ?');
      p.push(r.fontePagadora);
    }
    if (r.plano !== null) {
      filtros.push('AND ch.plano_fonte_pagadora_id = ?');
      p.push(r.plano);
    }
    if (r.itemFaturavel !== null) {
      filtros.push('AND ci.item_faturavel_id = ?');
      p.push(r.itemFaturavel);
    }
    const m = profs.length
      ? await l.uma<Linha>(
          `SELECT COUNT(*) AS itens,
                  COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM ato_cirurgico_procedimento acp
                                                    WHERE acp.conta_hospitalar_item_id = i.conta_hospitalar_item_id)
                                      THEN i.conta_hospitalar_item_id END) AS cirurgias,
                  COALESCE(SUM(i.valor_faturado * ${fator}), 0) AS produzido,
                  COALESCE(SUM((i.valor_faturado - i.valor_glosa) * ${fator}), 0) AS recebido,
                  COALESCE(SUM(i.valor_repasse * ${fator}), 0) AS repasse
             FROM apuracao_repasse_item i
             JOIN apuracao_repasse a ON a.id = i.apuracao_repasse_id
             LEFT JOIN conta_hospitalar_item ci ON ci.id = i.conta_hospitalar_item_id
             LEFT JOIN conta_hospitalar ch ON ch.id = COALESCE(i.conta_hospitalar_id, ci.conta_hospitalar_id)
            WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao <> 'cancelada'
              AND a.competencia IN (${comps.map(() => '?').join(',')}) AND i.excluido_em IS NULL
              AND i.profissional_id IN (${profs.map(() => '?').join(',')}) ${filtros.join(' ')}`,
          p,
        )
      : null;
    const descontos = profs.length
      ? cent(
          (
            await l.uma<Linha>(
              `SELECT COALESCE(SUM(lr.valor), 0) AS v FROM lancamento_repasse lr
                 JOIN evento_repasse ev ON ev.id = lr.evento_repasse_id
                WHERE lr.estabelecimento_id = ? AND ev.natureza = 'desconto' AND lr.situacao <> 'cancelado'
                  AND lr.excluido_em IS NULL AND lr.competencia IN (${comps.map(() => '?').join(',')})
                  AND lr.profissional_id IN (${profs.map(() => '?').join(',')})`,
              [est, ...comps, ...profs],
            )
          )?.['v'],
        )
      : 0;
    let margem: number | null = null;
    if (r.indicador === 'resultado') {
      margem = 0;
      for (const comp of comps) {
        const ap = await l.uma<Linha>(
          `SELECT SUM(cc.valor_receita - cc.custo_final) AS m FROM apuracao_custo_centro cc
            WHERE cc.apuracao_custo_id = (SELECT ac.id FROM apuracao_custo ac
                                           WHERE ac.estabelecimento_id = ? AND ac.competencia = ? AND ac.excluido_em IS NULL
                                             AND ac.substituida_por_apuracao_custo_id IS NULL
                                             AND ac.situacao IN ('apurada','fechada')
                                           ORDER BY ac.id DESC LIMIT 1)`,
          [est, comp],
        );
        margem += cent(ap?.['m']);
      }
    }
    const repasse = cent(m?.['repasse']);
    const medidas: Record<IndicadorVariavel, number> = {
      quantidade_procedimentos: num(m?.['itens']),
      quantidade_cirurgias: num(m?.['cirurgias']),
      valor_produzido: cent(m?.['produzido']) / 100,
      valor_recebido: cent(m?.['recebido']) / 100,
      resultado: (margem ?? 0) / 100,
    };
    return { medida: medidas[r.indicador], bruta: repasse, liquida: repasse - descontos, margem };
  }

  private async calcular(l: Leitor, est: number, competencia: string): Promise<RegraSimulada[]> {
    const fimMes = ultimoDiaDoMes(competencia);
    const regras = (await this.regras(l, est)).filter(
      (r) => r.ativo && r.inicio <= fimMes && (r.fim === null || r.fim >= competencia),
    );
    const equipes = await this.equipes(l, est);
    const out: RegraSimulada[] = [];
    for (const r of regras) {
      const per = periodoDaCompetencia(r.periodo, competencia);
      const dataFim = ultimoDiaDoMes(per.fim);
      const pendencias: string[] = [];
      const referente = `VARF ${r.codigo} ${competencia.slice(0, 7)}`;
      let membros: {
        profissional: number | null;
        terceiro: number | null;
        nome: string;
        cota: number;
        chefe: boolean;
      }[];
      if (r.equipe !== null) {
        const eq = equipes.find((x) => x.id === r.equipe);
        membros = eq ? membrosVigentes(eq.membros, dataFim) : [];
        const comp = eq ? conferirComposicao(eq.membros, dataFim) : [];
        pendencias.push(...comp.map((x) => x.mensagem));
      } else {
        membros = [
          { profissional: r.profissional, terceiro: null, nome: r.beneficiario, cota: 100, chefe: true },
        ];
      }
      const profs = membros.map((x) => x.profissional).filter((x): x is number => x !== null);
      const med = await this.medir(l, est, r, profs, per.competencias);
      const calc = calcularVariavelFaixa({
        indicador: r.indicador,
        faixas: r.faixas,
        medida: med.medida,
        producaoBrutaCentavos: med.bruta,
        producaoLiquidaCentavos: med.liquida,
        margemCentavos: med.margem,
      });
      if (!per.fecha)
        pendencias.push(
          `O período ${per.inicio.slice(0, 7)} a ${per.fim.slice(0, 7)} fecha em ${per.fim.slice(0, 7)}; nada a lançar nesta competência.`,
        );
      if (calc.valorCentavos < 0 && r.eventoDesconto === null)
        pendencias.push('Faixa de desconto sem evento de desconto.');
      const lancados = profs.length
        ? new Set(
            (
              await l.consultar<Linha>(
                `SELECT profissional_id FROM lancamento_repasse
                  WHERE estabelecimento_id = ? AND referente = ? AND situacao <> 'cancelado' AND excluido_em IS NULL
                    AND profissional_id IN (${profs.map(() => '?').join(',')})`,
                [est, referente, ...profs],
              )
            ).map((x) => num(x['profissional_id'])),
          )
        : new Set<number>();
      const partes =
        per.fecha && calc.valorCentavos !== 0 && !pendencias.length
          ? ratearEquipe(calc.valorCentavos, membros)
          : [];
      for (const pt of partes)
        if (pt.membro.terceiro !== null)
          pendencias.push(
            `${pt.membro.nome}: prestador terceiro recebe pelo repasse do prestador; a parte não é lançada aqui.`,
          );
      out.push({
        regra: r.id,
        codigo: r.codigo,
        descricao: r.descricao,
        beneficiario: r.beneficiario,
        indicador: r.indicador,
        periodo: r.periodo,
        periodoInicio: per.inicio,
        periodoFim: per.fim,
        fecha: per.fecha,
        medida: med.medida,
        base: calc.baseCentavos / 100,
        faixa: calc.ordemFaixa,
        percentual: calc.percentual,
        valor: calc.valorCentavos / 100,
        memoria: calc.memoria,
        referente,
        partes: partes.map((pt) => ({
          profissional: pt.membro.profissional,
          terceiro: pt.membro.terceiro,
          nome: pt.membro.nome,
          cota: pt.membro.cota,
          valor: pt.valorCentavos / 100,
          lancado: pt.membro.profissional !== null && lancados.has(pt.membro.profissional),
        })),
        pendencias,
      });
    }
    return out;
  }

  /** Lança na apuração as partes ainda não lançadas das regras que fecham o período na competência. */
  lancar(
    c: ContextoPortaPropria,
    apuracao: number,
  ): Promise<{ lancamentos: number; credito: number; debito: number; pendencias: string[] }> {
    return this.gravar(
      c,
      'repasse.variavel.faixa.lancar',
      ['lancamento_repasse', 'apuracao_repasse'],
      async (tx, est) => {
        const a = await this.apuracao(tx, est.id, apuracao);
        if (!SITUACOES_LANCAVEIS.includes(a.situacao))
          throw recusaRegra('Lançamento recusado', [
            {
              campo: 'apuracao',
              mensagem: 'Só a apuração em apuração ou apurada recebe a remuneração variável.',
            },
          ]);
        await tx.consultarParaAtualizar('SELECT id FROM apuracao_repasse WHERE id = ?', [apuracao]);
        const sim = await this.calcular(tx, est.id, a.competencia);
        const regras = new Map((await this.regras(tx, est.id)).map((r) => [r.id, r]));
        const hoje = civil(new Date(), est.fuso).data;
        const pendencias: string[] = [];
        let lancamentos = 0;
        let credito = 0;
        let debito = 0;
        for (const s of sim) {
          pendencias.push(...s.pendencias.map((x) => `${s.codigo}: ${x}`));
          const r = regras.get(s.regra)!;
          for (const pt of s.partes) {
            if (pt.lancado || pt.profissional === null || pt.valor === 0) continue;
            const evento = pt.valor > 0 ? r.evento : r.eventoDesconto;
            if (evento === null) continue;
            const fav = await tx.uma<Linha>(
              `SELECT id FROM favorecido_repasse
                WHERE estabelecimento_id = ? AND profissional_id = ? AND ativo AND tipo_favorecido = 'proprio_profissional'
                  AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
                ORDER BY fonte_pagadora_id IS NULL DESC, vigencia_inicio DESC LIMIT 1`,
              [est.id, pt.profissional, ultimoDiaDoMes(a.competencia), a.competencia],
            );
            if (!fav) {
              pendencias.push(
                `${s.codigo}: ${pt.nome} sem favorecido próprio vigente; a parte não foi lançada.`,
              );
              continue;
            }
            const cents = Math.round(Math.abs(pt.valor) * 100);
            await tx.incluir('lancamento_repasse', {
              estabelecimento_id: est.id,
              favorecido_repasse_id: num(fav['id']),
              tipo_favorecido: 'medico',
              profissional_id: pt.profissional,
              evento_repasse_id: evento,
              tipo_lancamento: 'apuracao',
              apuracao_repasse_id: apuracao,
              competencia: a.competencia,
              data_lancamento: hoje,
              valor: cents / 100,
              percentual: s.percentual || null,
              valor_calculado: true,
              referente: s.referente.slice(0, 150),
              observacao: `${s.memoria}${r.equipe !== null ? ` Cota ${pt.cota}% da equipe ${s.beneficiario}.` : ''}`,
              situacao: 'aberto',
            });
            lancamentos += 1;
            if (pt.valor > 0) credito += cents;
            else debito += cents;
          }
        }
        if (credito || debito)
          await tx.alterar('apuracao_repasse', apuracao, a.versao, {
            valor_bruto: (a.bruto + credito) / 100,
            valor_descontos: (a.descontos + debito) / 100,
            valor_liquido: (a.liquido + credito - debito) / 100,
          });
        return {
          tabela: 'apuracao_repasse',
          id: apuracao,
          lancamentos,
          credito: credito / 100,
          debito: debito / 100,
          pendencias,
        };
      },
    );
  }
}
