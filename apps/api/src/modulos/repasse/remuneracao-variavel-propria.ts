// Remuneração variável do profissional no banco do cliente (F8, 07-FIN linha 157). As regras são as puras de
// @sgh/dominio-repasse (remuneracao-variavel); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - mínimo garantido: `regra_repasse_minimo_garantido` com o valor mensal, o evento do complemento e a vigência;
//   - valor fixo mensal (C2-100): `regra_repasse_valor_fixo` do profissional com a descrição, o valor, o evento, o dia
//     de pagamento e a vigência; lançado uma vez por competência (o já lançado noutra apuração da mesma competência
//     não entra de novo); a de lançamento manual (`lancamento_automatico` falso) não entra no cálculo;
//   - percentual do resultado: `regra_repasse_resultado` com o centro de custo (nulo: o estabelecimento) e o percentual;
//   - meta de produtividade: `meta_produtividade_repasse` com o indicador, a forma do prêmio, o peso e o evento, e as
//     faixas em `meta_produtividade_repasse_faixa`; o valor apurado da competência em `apuracao_meta_produtividade`
//     (a correção marca `substituida_em` na anterior e cria outra; nada apagado);
//   - regra que cruza outra vigente do mesmo profissional (e centro ou indicador): 422 sem gravar; encerrar só grava
//     `vigencia_fim` (nunca apaga, nunca estende);
//   - lançar na apuração (em apuração ou apurada): cada crédito vira `lancamento_repasse` (tipo 'apuracao', favorecido
//     próprio do profissional vigente, evento da regra, valor calculado, referente com a regra e a competência) e cada
//     custo do prestador vira `desconto_custo_repasse` (regra de custo, tipo de desconto, valor); os totais da apuração
//     (`apuracao_repasse`: bruto, descontos, líquido) somam o lançado; lançar de novo não duplica (o referente e a
//     regra de custo identificam o já lançado); apuração aprovada, liberada, paga ou cancelada: 422.
import {
  calcularRemuneracaoVariavel,
  conflitoDeVigencia,
  ehCompetencia,
  type EntradaRemuneracaoVariavel,
  type FaixaMeta,
  FORMAS_PREMIO,
  type FormaPremio,
  type RemuneracaoVariavel,
  ultimoDiaDoMes,
  validarMeta,
  validarMinimoGarantido,
  validarRegraResultado,
  validarValorFixo,
  vigenteNaCompetencia,
} from '@sgh/dominio-repasse';
import type { Leitor } from '@sgh/nucleo';
import { z } from 'zod';
import { civil } from '../exames/relogio.js';
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

export const PORTA_REMUNERACAO_VARIAVEL = Symbol('PORTA_REMUNERACAO_VARIAVEL');

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const versao = z.number().int().positive();
const dataTexto = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).slice(0, 10);
const cent = (v: unknown): number => Math.round(Number(v ?? 0) * 100);

const esquemaMinimo = z
  .object({
    profissional: id,
    valorMinimo: z.number().positive(),
    evento: id,
    complementoAutomatico: z.boolean().default(true),
    inicio: data,
    fim: data.nullable().default(null),
  })
  .strict();

const esquemaFixo = z
  .object({
    profissional: id,
    descricao: z.string().trim().min(1).max(150),
    valorMensal: z.number().positive(),
    evento: id,
    diaPagamento: z.number().int().min(1).max(31).nullable().default(null),
    lancamentoAutomatico: z.boolean().default(true),
    inicio: data,
    fim: data.nullable().default(null),
  })
  .strict();

const esquemaResultado = z
  .object({
    profissional: id,
    centroCusto: id.nullable().default(null),
    evento: id,
    percentual: z.number(),
    inicio: data,
    fim: data.nullable().default(null),
  })
  .strict();

const esquemaMeta = z
  .object({
    profissional: id,
    indicador: id,
    centroCusto: id.nullable().default(null),
    evento: id,
    forma: z.enum(FORMAS_PREMIO as unknown as [FormaPremio, ...FormaPremio[]]),
    peso: z.number().default(100),
    inicio: data,
    fim: data.nullable().default(null),
    faixas: z
      .array(
        z.object({ de: z.number(), ate: z.number().nullable().default(null), premio: z.number() }).strict(),
      )
      .max(20),
  })
  .strict();

const esquemaApurado = z
  .object({
    competencia: data,
    valor: z.number().finite(),
    observacao: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

const esquemaEncerrar = z.object({ versao, fim: data }).strict();

export const TIPOS_REGRA_VARIAVEL = ['minimo', 'fixo', 'resultado', 'meta'] as const;
export type TipoRegraVariavel = (typeof TIPOS_REGRA_VARIAVEL)[number];

export interface ItemSimulado {
  readonly tipo: string;
  readonly regra: number;
  readonly evento: number | null;
  readonly sentido: 'credito' | 'debito';
  readonly valor: number;
  readonly memoria: string;
  readonly referente: string;
  readonly lancado: boolean;
}

export interface SimulacaoProfissional {
  readonly profissional: number;
  readonly nome: string;
  readonly producao: number;
  readonly credito: number;
  readonly debito: number;
  readonly itens: readonly ItemSimulado[];
  readonly pendencias: readonly string[];
}

const SITUACOES_LANCAVEIS = ['em_apuracao', 'apurada'];

export class PortaRemuneracaoVariavelPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(
      nucleo,
      cliente,
      [
        'regra_repasse_minimo_garantido',
        'regra_repasse_valor_fixo',
        'regra_repasse_resultado',
        'meta_produtividade_repasse',
        'meta_produtividade_repasse_faixa',
        'apuracao_meta_produtividade',
        'lancamento_repasse',
        'desconto_custo_repasse',
        'apuracao_repasse',
      ],
      'repasse.remuneracao-variavel',
    );
  }

  // ── Leitura ────────────────────────────────────────────────────────────────────────────────────────

  /** As regras do profissional (ou de todos) e o que a tela precisa para escolher: eventos, indicadores e centros. */
  painel(c: ContextoPortaPropria, profissional: number | null) {
    return this.ler(c, 'painel', async (l, est) => {
      const p = [est.id, profissional, profissional];
      const filtro = 'r.estabelecimento_id = ? AND (? IS NULL OR r.profissional_id = ?)';
      const nome = `(SELECT pf.nome FROM profissional pr JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
                      WHERE pr.id = r.profissional_id)`;
      const minimos = (
        await l.consultar<Linha>(
          `SELECT r.*, ${nome} AS profissional_nome, e.nome AS evento_nome
             FROM regra_repasse_minimo_garantido r LEFT JOIN evento_repasse e ON e.id = r.evento_repasse_id
            WHERE ${filtro} ORDER BY r.vigencia_inicio DESC, r.id DESC LIMIT 500`,
          p,
        )
      ).map((x) => ({
        ...base(x),
        valorMinimo: num(x['valor_minimo']),
        complementoAutomatico: Boolean(num(x['complemento_automatico'])),
      }));
      const fixos = (
        await l.consultar<Linha>(
          `SELECT r.*, ${nome} AS profissional_nome, e.nome AS evento_nome
             FROM regra_repasse_valor_fixo r LEFT JOIN evento_repasse e ON e.id = r.evento_repasse_id
            WHERE ${filtro} AND r.profissional_id IS NOT NULL AND r.ativo
            ORDER BY r.vigencia_inicio DESC, r.id DESC LIMIT 500`,
          p,
        )
      ).map((x) => ({
        ...base(x),
        descricao: String(x['descricao']),
        valorMensal: num(x['valor_mensal']),
        diaPagamento: numOuNull(x['dia_pagamento']),
        lancamentoAutomatico: Boolean(num(x['lancamento_automatico'])),
      }));
      const resultados = (
        await l.consultar<Linha>(
          `SELECT r.*, ${nome} AS profissional_nome, e.nome AS evento_nome, cc.nome AS centro_nome
             FROM regra_repasse_resultado r LEFT JOIN evento_repasse e ON e.id = r.evento_repasse_id
             LEFT JOIN centro_custo cc ON cc.id = r.centro_custo_id
            WHERE ${filtro} ORDER BY r.vigencia_inicio DESC, r.id DESC LIMIT 500`,
          p,
        )
      ).map((x) => ({
        ...base(x),
        centroCusto: numOuNull(x['centro_custo_id']),
        centroNome: txtOuNull(x['centro_nome']),
        percentual: num(x['percentual']),
      }));
      const metasL = await l.consultar<Linha>(
        `SELECT r.*, ${nome} AS profissional_nome, e.nome AS evento_nome, cc.nome AS centro_nome,
                i.codigo AS indicador_codigo, i.descricao AS indicador_descricao, i.unidade, i.sentido
           FROM meta_produtividade_repasse r JOIN indicador_produtividade i ON i.id = r.indicador_produtividade_id
           LEFT JOIN evento_repasse e ON e.id = r.evento_repasse_id
           LEFT JOIN centro_custo cc ON cc.id = r.centro_custo_id
          WHERE ${filtro} ORDER BY r.vigencia_inicio DESC, r.id DESC LIMIT 500`,
        p,
      );
      const faixas = await this.faixas(
        l,
        metasL.map((x) => num(x['id'])),
      );
      const apurados = await this.apurados(
        l,
        metasL.map((x) => num(x['id'])),
      );
      const metas = metasL.map((x) => ({
        ...base(x),
        indicador: num(x['indicador_produtividade_id']),
        indicadorCodigo: String(x['indicador_codigo']),
        indicadorDescricao: String(x['indicador_descricao']),
        unidade: txtOuNull(x['unidade']),
        sentido: String(x['sentido']),
        centroCusto: numOuNull(x['centro_custo_id']),
        centroNome: txtOuNull(x['centro_nome']),
        forma: String(x['forma_premio']) as FormaPremio,
        peso: num(x['peso']),
        faixas: faixas.get(num(x['id'])) ?? [],
        apurados: apurados.get(num(x['id'])) ?? [],
      }));
      const custos = (
        await l.consultar<Linha>(
          `SELECT r.id, r.profissional_id, ${nome} AS profissional_nome, r.descricao, r.natureza, r.forma_calculo,
                  r.valor, r.percentual, r.faixa_inicial, r.faixa_final, r.frequencia, r.vigencia_inicio,
                  r.vigencia_fim, t.descricao AS tipo_descricao
             FROM custo_profissional r JOIN tipo_desconto_repasse t ON t.id = r.tipo_desconto_repasse_id
            WHERE ${filtro} AND r.ativo ORDER BY r.vigencia_inicio DESC, r.id DESC LIMIT 500`,
          p,
        )
      ).map((x) => ({
        id: num(x['id']),
        profissional: num(x['profissional_id']),
        profissionalNome: txtOuNull(x['profissional_nome']),
        descricao: txtOuNull(x['descricao']) ?? String(x['tipo_descricao']),
        natureza: String(x['natureza']),
        forma: String(x['forma_calculo']),
        valor: x['valor'] === null ? null : num(x['valor']),
        percentual: x['percentual'] === null ? null : num(x['percentual']),
        faixaInicial: x['faixa_inicial'] === null ? null : num(x['faixa_inicial']),
        faixaFinal: x['faixa_final'] === null ? null : num(x['faixa_final']),
        frequencia: String(x['frequencia']),
        inicio: dataTexto(x['vigencia_inicio'])!,
        fim: dataTexto(x['vigencia_fim']),
      }));
      const eventos = (
        await l.consultar<Linha>(
          `SELECT id, codigo, nome FROM evento_repasse
            WHERE estabelecimento_id = ? AND ativo AND natureza = 'rendimento' AND tipo_lancamento = 'credito'
            ORDER BY nome LIMIT 500`,
          [est.id],
        )
      ).map((x) => ({ id: num(x['id']), codigo: String(x['codigo']), nome: String(x['nome']) }));
      const indicadores = (
        await l.consultar<Linha>(
          `SELECT id, codigo, descricao, unidade, sentido, dimensao FROM indicador_produtividade
            WHERE ativo ORDER BY descricao LIMIT 500`,
        )
      ).map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        unidade: txtOuNull(x['unidade']),
        sentido: String(x['sentido']),
        dimensao: String(x['dimensao']),
      }));
      const centros = (
        await l.consultar<Linha>(
          'SELECT id, codigo, nome FROM centro_custo WHERE estabelecimento_id = ? ORDER BY nome LIMIT 1000',
          [est.id],
        )
      ).map((x) => ({ id: num(x['id']), codigo: String(x['codigo']), nome: String(x['nome']) }));
      const apuracoes = (
        await l.consultar<Linha>(
          `SELECT id, numero, competencia, situacao FROM apuracao_repasse
            WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao IN ('em_apuracao','apurada')
            ORDER BY competencia DESC, id DESC LIMIT 60`,
          [est.id],
        )
      ).map((x) => ({
        id: num(x['id']),
        numero: String(x['numero']),
        competencia: dataTexto(x['competencia'])!,
        situacao: String(x['situacao']),
      }));
      return { minimos, fixos, resultados, metas, custos, eventos, indicadores, centros, apuracoes };
    });
  }

  private async faixas(l: Leitor, metas: readonly number[]): Promise<Map<number, FaixaMeta[]>> {
    const m = new Map<number, FaixaMeta[]>();
    if (!metas.length) return m;
    const linhas = await l.consultar<Linha>(
      `SELECT meta_produtividade_repasse_id AS meta, limite_inicial, limite_final, premio
         FROM meta_produtividade_repasse_faixa
        WHERE meta_produtividade_repasse_id IN (${metas.map(() => '?').join(',')}) ORDER BY sequencia`,
      metas,
    );
    for (const x of linhas) {
      const lista = m.get(num(x['meta'])) ?? [];
      lista.push({
        de: num(x['limite_inicial']),
        ate: x['limite_final'] === null ? null : num(x['limite_final']),
        premio: num(x['premio']),
      });
      m.set(num(x['meta']), lista);
    }
    return m;
  }

  private async apurados(l: Leitor, metas: readonly number[]) {
    const m = new Map<number, { competencia: string; valor: number; fonte: string }[]>();
    if (!metas.length) return m;
    const linhas = await l.consultar<Linha>(
      `SELECT meta_produtividade_repasse_id AS meta, competencia, valor_apurado, fonte
         FROM apuracao_meta_produtividade
        WHERE substituida_em IS NULL AND meta_produtividade_repasse_id IN (${metas.map(() => '?').join(',')})
        ORDER BY competencia DESC LIMIT 2000`,
      metas,
    );
    for (const x of linhas) {
      const lista = m.get(num(x['meta'])) ?? [];
      lista.push({
        competencia: dataTexto(x['competencia'])!,
        valor: num(x['valor_apurado']),
        fonte: String(x['fonte']),
      });
      m.set(num(x['meta']), lista);
    }
    return m;
  }

  /** O cálculo da remuneração variável de cada profissional com regra vigente na competência da apuração. */
  simular(
    c: ContextoPortaPropria,
    apuracao: number,
    profissional: number | null,
  ): Promise<{
    apuracao: number;
    competencia: string;
    situacao: string;
    profissionais: SimulacaoProfissional[];
  }> {
    return this.ler(c, 'simular', async (l, est) => {
      const a = await this.apuracao(l, est.id, apuracao);
      return {
        apuracao,
        competencia: a.competencia,
        situacao: a.situacao,
        profissionais: await this.calcular(l, est.id, apuracao, a.competencia, profissional),
      };
    });
  }

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

  private async calcular(
    l: Leitor,
    est: number,
    apuracao: number,
    comp: string,
    profissional: number | null,
  ): Promise<SimulacaoProfissional[]> {
    const fimMes = ultimoDiaDoMes(comp);
    const vig =
      'r.estabelecimento_id = ? AND (? IS NULL OR r.profissional_id = ?) AND r.vigencia_inicio <= ? AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= ?)';
    const pv = [est, profissional, profissional, fimMes, comp];
    const minimos = await l.consultar<Linha>(
      `SELECT r.* FROM regra_repasse_minimo_garantido r WHERE ${vig} AND r.complemento_automatico ORDER BY r.vigencia_inicio DESC`,
      pv,
    );
    const fixos = await l.consultar<Linha>(
      `SELECT r.* FROM regra_repasse_valor_fixo r
        WHERE ${vig} AND r.profissional_id IS NOT NULL AND r.ativo AND r.lancamento_automatico`,
      pv,
    );
    const resultados = await l.consultar<Linha>(`SELECT r.* FROM regra_repasse_resultado r WHERE ${vig}`, pv);
    const metas = await l.consultar<Linha>(
      `SELECT r.*, i.codigo AS indicador_codigo, i.indicador_id
         FROM meta_produtividade_repasse r JOIN indicador_produtividade i ON i.id = r.indicador_produtividade_id
        WHERE ${vig}`,
      pv,
    );
    const custos = await l.consultar<Linha>(
      `SELECT r.*, (SELECT COUNT(*) FROM desconto_custo_repasse d
                     WHERE d.custo_profissional_id = r.id AND d.excluido_em IS NULL AND d.apuracao_repasse_id <> ?) AS anteriores
         FROM custo_profissional r WHERE ${vig} AND r.ativo AND r.profissional_id IS NOT NULL`,
      [apuracao, ...pv],
    );
    const profs = new Set<number>();
    for (const x of [...minimos, ...fixos, ...resultados, ...metas, ...custos])
      profs.add(num(x['profissional_id']));
    if (!profs.size) return [];
    const lista = [...profs];
    const marc = lista.map(() => '?').join(',');
    const producao = new Map<number, number>();
    for (const x of await l.consultar<Linha>(
      `SELECT profissional_id, SUM(valor_repasse) AS total FROM apuracao_repasse_item
        WHERE apuracao_repasse_id = ? AND excluido_em IS NULL AND profissional_id IN (${marc})
        GROUP BY profissional_id`,
      [apuracao, ...lista],
    ))
      producao.set(num(x['profissional_id']), cent(x['total']));
    const nomes = new Map<number, string>();
    for (const x of await l.consultar<Linha>(
      `SELECT p.id, pf.nome FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id IN (${marc})`,
      lista,
    ))
      nomes.set(num(x['id']), String(x['nome']));
    const faixas = await this.faixas(
      l,
      metas.map((x) => num(x['id'])),
    );
    const margem = await this.margens(l, est, comp);
    const lancados = new Set<string>();
    for (const x of await l.consultar<Linha>(
      `SELECT profissional_id, referente FROM lancamento_repasse
        WHERE apuracao_repasse_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado' AND profissional_id IN (${marc})`,
      [apuracao, ...lista],
    ))
      lancados.add(`${num(x['profissional_id'])}|${String(x['referente'])}`);
    // O fixo é um por competência: o já lançado noutra apuração (não cancelado) da mesma competência não entra de novo.
    const fixosNaCompetencia = new Set<string>();
    for (const x of await l.consultar<Linha>(
      `SELECT profissional_id, referente FROM lancamento_repasse
        WHERE estabelecimento_id = ? AND competencia = ? AND apuracao_repasse_id <> ? AND excluido_em IS NULL
          AND situacao <> 'cancelado' AND referente LIKE 'Valor fixo mensal %' AND profissional_id IN (${marc})`,
      [est, comp, apuracao, ...lista],
    ))
      fixosNaCompetencia.add(`${num(x['profissional_id'])}|${String(x['referente'])}`);
    const descontados = new Set<number>();
    for (const x of await l.consultar<Linha>(
      `SELECT custo_profissional_id FROM desconto_custo_repasse
        WHERE apuracao_repasse_id = ? AND excluido_em IS NULL AND custo_profissional_id IS NOT NULL`,
      [apuracao],
    ))
      descontados.add(num(x['custo_profissional_id']));

    const saida: SimulacaoProfissional[] = [];
    for (const prof of lista.sort((a, b) => (nomes.get(a) ?? '').localeCompare(nomes.get(b) ?? ''))) {
      const doProf = (xs: Linha[]) =>
        xs.filter(
          (x) =>
            num(x['profissional_id']) === prof &&
            vigenteNaCompetencia(
              { inicio: dataTexto(x['vigencia_inicio'])!, fim: dataTexto(x['vigencia_fim']) },
              comp,
            ),
        );
      const mins = doProf(minimos);
      const m0 = mins[0];
      const metasProf = doProf(metas);
      const valores = new Map<number, number | null>();
      for (const m of metasProf) valores.set(num(m['id']), await this.valorApurado(l, est, m, comp));
      const entrada: EntradaRemuneracaoVariavel = {
        competencia: comp,
        producaoCentavos: producao.get(prof) ?? 0,
        minimo: m0
          ? {
              id: num(m0['id']),
              valorMinimo: num(m0['valor_minimo']),
              evento: numOuNull(m0['evento_repasse_id']),
            }
          : null,
        fixos: doProf(fixos).map((f) => ({
          id: num(f['id']),
          descricao: String(f['descricao']),
          valorMensal: num(f['valor_mensal']),
          evento: numOuNull(f['evento_repasse_id']),
          lancadoNaCompetencia: fixosNaCompetencia.has(
            `${prof}|Valor fixo mensal ${comp.slice(0, 7)} (regra ${num(f['id'])})`,
          ),
        })),
        resultados: doProf(resultados).map((r) => {
          const cc = numOuNull(r['centro_custo_id']);
          const mg = margem === null ? null : cc === null ? margem.total : (margem.porCentro.get(cc) ?? null);
          return {
            id: num(r['id']),
            percentual: num(r['percentual']),
            evento: numOuNull(r['evento_repasse_id']),
            centroCusto: cc,
            margemCentavos: mg,
          };
        }),
        metas: metasProf.map((m) => ({
          id: num(m['id']),
          indicador: String(m['indicador_codigo']),
          forma: String(m['forma_premio']) as FormaPremio,
          peso: num(m['peso']),
          evento: numOuNull(m['evento_repasse_id']),
          faixas: faixas.get(num(m['id'])) ?? [],
          valorApurado: valores.get(num(m['id'])) ?? null,
        })),
        custos: doProf(custos).map((x) => ({
          id: num(x['id']),
          tipoDesconto: num(x['tipo_desconto_repasse_id']),
          descricao: txtOuNull(x['descricao']),
          natureza: String(x['natureza']) as 'desconto' | 'acrescimo',
          forma: String(x['forma_calculo']) as 'valor' | 'percentual',
          valor: x['valor'] === null ? null : num(x['valor']),
          percentual: x['percentual'] === null ? null : num(x['percentual']),
          faixaInicial: x['faixa_inicial'] === null ? null : num(x['faixa_inicial']),
          faixaFinal: x['faixa_final'] === null ? null : num(x['faixa_final']),
          frequencia: String(x['frequencia']) as 'mensal' | 'por_apuracao' | 'unica',
          jaDescontada: num(x['anteriores']) > 0,
        })),
      };
      const r: RemuneracaoVariavel = calcularRemuneracaoVariavel(entrada);
      saida.push({
        profissional: prof,
        nome: nomes.get(prof) ?? '',
        producao: entrada.producaoCentavos / 100,
        credito: r.creditoCentavos / 100,
        debito: r.debitoCentavos / 100,
        pendencias: r.pendencias,
        itens: r.itens.map((i) => ({
          tipo: i.tipo,
          regra: i.regra,
          evento: i.evento,
          sentido: i.sentido,
          valor: i.valorCentavos / 100,
          memoria: i.memoria,
          referente: i.referente,
          lancado: i.tipo === 'custo' ? descontados.has(i.regra) : lancados.has(`${prof}|${i.referente}`),
        })),
      });
    }
    return saida;
  }

  /** A margem (receita − custo final) da apuração de custos vigente da competência, por centro e no total. */
  private async margens(l: Leitor, est: number, comp: string) {
    const ap = await l.uma<Linha>(
      `SELECT id FROM apuracao_custo
        WHERE estabelecimento_id = ? AND competencia = ? AND excluido_em IS NULL
          AND substituida_por_apuracao_custo_id IS NULL AND situacao IN ('apurada','fechada')
        ORDER BY id DESC LIMIT 1`,
      [est, comp],
    );
    if (!ap) return null;
    const porCentro = new Map<number, number>();
    let total = 0;
    for (const x of await l.consultar<Linha>(
      'SELECT centro_custo_id, valor_receita, custo_final FROM apuracao_custo_centro WHERE apuracao_custo_id = ?',
      [num(ap['id'])],
    )) {
      const v = cent(x['valor_receita']) - cent(x['custo_final']);
      porCentro.set(num(x['centro_custo_id']), v);
      total += v;
    }
    return { porCentro, total };
  }

  /** O valor apurado da meta: o informado vigente; sem ele, o do indicador gerencial fechado na competência. */
  private async valorApurado(l: Leitor, est: number, meta: Linha, comp: string): Promise<number | null> {
    const inf = await l.uma<Linha>(
      `SELECT valor_apurado FROM apuracao_meta_produtividade
        WHERE meta_produtividade_repasse_id = ? AND competencia = ? AND substituida_em IS NULL
        ORDER BY id DESC LIMIT 1`,
      [num(meta['id']), comp],
    );
    if (inf) return num(inf['valor_apurado']);
    const indicador = numOuNull(meta['indicador_id']);
    if (indicador === null) return null;
    const g = await l.uma<Linha>(
      `SELECT valor FROM apuracao_indicador
        WHERE estabelecimento_id = ? AND indicador_id = ? AND competencia = ? AND situacao = 'fechada'
          AND unidade_assistencial_id IS NULL AND centro_custo_id <=> ? AND valor IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
      [est, indicador, comp, numOuNull(meta['centro_custo_id'])],
    );
    return g ? num(g['valor']) : null;
  }

  // ── Gravação das regras ────────────────────────────────────────────────────────────────────────────

  private async conferirAlvos(
    l: Leitor,
    est: number,
    e: { profissional: number; evento: number; centroCusto?: number | null; indicador?: number },
  ) {
    if (!(await l.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [e.profissional])))
      throw naoEncontrado('Profissional');
    if (
      !(await l.uma(
        `SELECT id FROM evento_repasse WHERE id = ? AND estabelecimento_id = ? AND ativo AND natureza = 'rendimento'`,
        [e.evento, est],
      ))
    )
      throw recusaRegra('Regra recusada', [
        { campo: 'evento', mensagem: 'O evento tem de ser um rendimento ativo deste estabelecimento.' },
      ]);
    if (
      e.centroCusto &&
      !(await l.uma('SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ?', [
        e.centroCusto,
        est,
      ]))
    )
      throw naoEncontrado('Centro de custo');
    if (
      e.indicador !== undefined &&
      !(await l.uma('SELECT id FROM indicador_produtividade WHERE id = ? AND ativo', [e.indicador]))
    )
      throw naoEncontrado('Indicador de produtividade');
  }

  private static vigencias(xs: Linha[]) {
    return xs.map((x) => ({ inicio: dataTexto(x['vigencia_inicio'])!, fim: dataTexto(x['vigencia_fim']) }));
  }

  incluirMinimo(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaMinimo, entrada);
    return this.gravar(
      c,
      'repasse.variavel.minimo.incluir',
      ['regra_repasse_minimo_garantido'],
      async (tx, est) => {
        await this.conferirAlvos(tx, est.id, e);
        const existentes = await tx.consultarParaAtualizar<Linha>(
          `SELECT vigencia_inicio, vigencia_fim FROM regra_repasse_minimo_garantido
            WHERE estabelecimento_id = ? AND profissional_id = ?`,
          [est.id, e.profissional],
        );
        const problemas = [
          ...validarMinimoGarantido(e),
          ...conflitoDeVigencia(e, PortaRemuneracaoVariavelPropria.vigencias(existentes)),
        ];
        if (problemas.length) throw recusaRegra('Mínimo garantido recusado', problemas);
        const novo = await tx.incluir('regra_repasse_minimo_garantido', {
          estabelecimento_id: est.id,
          profissional_id: e.profissional,
          evento_repasse_id: e.evento,
          valor_minimo: e.valorMinimo,
          complemento_automatico: e.complementoAutomatico,
          vigencia_inicio: e.inicio,
          vigencia_fim: e.fim,
        });
        return { tabela: 'regra_repasse_minimo_garantido', id: novo };
      },
    );
  }

  /** Inclui o valor fixo mensal do profissional; outro vigente com a mesma descrição no período: 422 sem gravar. */
  incluirFixo(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaFixo, entrada);
    return this.gravar(c, 'repasse.variavel.fixo.incluir', ['regra_repasse_valor_fixo'], async (tx, est) => {
      await this.conferirAlvos(tx, est.id, e);
      const existentes = await tx.consultarParaAtualizar<Linha>(
        `SELECT vigencia_inicio, vigencia_fim FROM regra_repasse_valor_fixo
          WHERE estabelecimento_id = ? AND profissional_id = ? AND descricao = ? AND ativo`,
        [est.id, e.profissional, e.descricao],
      );
      const problemas = [
        ...validarValorFixo(e),
        ...conflitoDeVigencia(e, PortaRemuneracaoVariavelPropria.vigencias(existentes)),
      ];
      if (problemas.length) throw recusaRegra('Valor fixo recusado', problemas);
      const novo = await tx.incluir('regra_repasse_valor_fixo', {
        estabelecimento_id: est.id,
        descricao: e.descricao,
        profissional_id: e.profissional,
        evento_repasse_id: e.evento,
        valor_mensal: e.valorMensal,
        dia_pagamento: e.diaPagamento,
        lancamento_automatico: e.lancamentoAutomatico,
        vigencia_inicio: e.inicio,
        vigencia_fim: e.fim,
      });
      return { tabela: 'regra_repasse_valor_fixo', id: novo };
    });
  }

  incluirResultado(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaResultado, entrada);
    return this.gravar(
      c,
      'repasse.variavel.resultado.incluir',
      ['regra_repasse_resultado'],
      async (tx, est) => {
        await this.conferirAlvos(tx, est.id, e);
        const existentes = await tx.consultarParaAtualizar<Linha>(
          `SELECT vigencia_inicio, vigencia_fim FROM regra_repasse_resultado
            WHERE estabelecimento_id = ? AND profissional_id = ? AND centro_custo_id <=> ?`,
          [est.id, e.profissional, e.centroCusto],
        );
        const problemas = [
          ...validarRegraResultado(e),
          ...conflitoDeVigencia(e, PortaRemuneracaoVariavelPropria.vigencias(existentes)),
        ];
        if (problemas.length) throw recusaRegra('Percentual do resultado recusado', problemas);
        const novo = await tx.incluir('regra_repasse_resultado', {
          estabelecimento_id: est.id,
          profissional_id: e.profissional,
          centro_custo_id: e.centroCusto,
          evento_repasse_id: e.evento,
          percentual: e.percentual,
          vigencia_inicio: e.inicio,
          vigencia_fim: e.fim,
        });
        return { tabela: 'regra_repasse_resultado', id: novo };
      },
    );
  }

  incluirMeta(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaMeta, entrada);
    return this.gravar(
      c,
      'repasse.variavel.meta.incluir',
      ['meta_produtividade_repasse', 'meta_produtividade_repasse_faixa'],
      async (tx, est) => {
        await this.conferirAlvos(tx, est.id, e);
        const existentes = await tx.consultarParaAtualizar<Linha>(
          `SELECT vigencia_inicio, vigencia_fim FROM meta_produtividade_repasse
            WHERE estabelecimento_id = ? AND profissional_id = ? AND indicador_produtividade_id = ?`,
          [est.id, e.profissional, e.indicador],
        );
        const problemas = [
          ...validarMeta(e),
          ...conflitoDeVigencia(e, PortaRemuneracaoVariavelPropria.vigencias(existentes)),
        ];
        if (problemas.length) throw recusaRegra('Meta de produtividade recusada', problemas);
        const novo = await tx.incluir('meta_produtividade_repasse', {
          estabelecimento_id: est.id,
          profissional_id: e.profissional,
          indicador_produtividade_id: e.indicador,
          centro_custo_id: e.centroCusto,
          evento_repasse_id: e.evento,
          forma_premio: e.forma,
          peso: e.peso,
          vigencia_inicio: e.inicio,
          vigencia_fim: e.fim,
        });
        const ord = [...e.faixas].sort((a, b) => a.de - b.de);
        for (const [i, f] of ord.entries())
          await tx.incluir('meta_produtividade_repasse_faixa', {
            meta_produtividade_repasse_id: novo,
            sequencia: i + 1,
            limite_inicial: f.de,
            limite_final: f.ate,
            premio: f.premio,
          });
        return { tabela: 'meta_produtividade_repasse', id: novo };
      },
    );
  }

  /** Encerra a vigência (com a versão lida); só antecipa o fim, nunca apaga nem estende. */
  encerrar(
    c: ContextoPortaPropria,
    tipo: TipoRegraVariavel,
    regra: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const x = entradaValida(esquemaEncerrar, entrada);
    const conferir = (f: Linha | null) => {
      if (!f) throw naoEncontrado('Regra');
      const inicio = dataTexto(f['vigencia_inicio'])!;
      const fim = dataTexto(f['vigencia_fim']);
      if (x.fim < inicio || (fim !== null && x.fim > fim))
        throw recusaRegra('Encerramento recusado', [
          {
            campo: 'fim',
            mensagem: 'O fim fica entre o início da vigência e o fim atual; encerrar não estende.',
          },
        ]);
    };
    if (tipo === 'minimo')
      return this.gravar(
        c,
        'repasse.variavel.minimo.encerrar',
        ['regra_repasse_minimo_garantido'],
        async (tx, est) => {
          conferir(
            await tx.uma<Linha>(
              'SELECT vigencia_inicio, vigencia_fim FROM regra_repasse_minimo_garantido WHERE id = ? AND estabelecimento_id = ?',
              [regra, est.id],
            ),
          );
          await tx.alterar('regra_repasse_minimo_garantido', regra, x.versao, { vigencia_fim: x.fim });
          return { tabela: 'regra_repasse_minimo_garantido', id: regra };
        },
      );
    if (tipo === 'fixo')
      return this.gravar(
        c,
        'repasse.variavel.fixo.encerrar',
        ['regra_repasse_valor_fixo'],
        async (tx, est) => {
          conferir(
            await tx.uma<Linha>(
              'SELECT vigencia_inicio, vigencia_fim FROM regra_repasse_valor_fixo WHERE id = ? AND estabelecimento_id = ?',
              [regra, est.id],
            ),
          );
          await tx.alterar('regra_repasse_valor_fixo', regra, x.versao, { vigencia_fim: x.fim });
          return { tabela: 'regra_repasse_valor_fixo', id: regra };
        },
      );
    if (tipo === 'resultado')
      return this.gravar(
        c,
        'repasse.variavel.resultado.encerrar',
        ['regra_repasse_resultado'],
        async (tx, est) => {
          conferir(
            await tx.uma<Linha>(
              'SELECT vigencia_inicio, vigencia_fim FROM regra_repasse_resultado WHERE id = ? AND estabelecimento_id = ?',
              [regra, est.id],
            ),
          );
          await tx.alterar('regra_repasse_resultado', regra, x.versao, { vigencia_fim: x.fim });
          return { tabela: 'regra_repasse_resultado', id: regra };
        },
      );
    return this.gravar(
      c,
      'repasse.variavel.meta.encerrar',
      ['meta_produtividade_repasse'],
      async (tx, est) => {
        conferir(
          await tx.uma<Linha>(
            'SELECT vigencia_inicio, vigencia_fim FROM meta_produtividade_repasse WHERE id = ? AND estabelecimento_id = ?',
            [regra, est.id],
          ),
        );
        await tx.alterar('meta_produtividade_repasse', regra, x.versao, { vigencia_fim: x.fim });
        return { tabela: 'meta_produtividade_repasse', id: regra };
      },
    );
  }

  /** Informa (ou corrige) o valor apurado da meta na competência; a anterior fica marcada como substituída. */
  async informarApurado(c: ContextoPortaPropria, meta: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaApurado, entrada);
    if (!ehCompetencia(e.competencia))
      throw recusaRegra('Valor recusado', [
        { campo: 'competencia', mensagem: 'A competência é o dia 1 do mês.' },
      ]);
    return this.gravar(
      c,
      'repasse.variavel.meta.apurar',
      ['apuracao_meta_produtividade'],
      async (tx, est) => {
        if (
          !(await tx.uma(
            'SELECT id FROM meta_produtividade_repasse WHERE id = ? AND estabelecimento_id = ?',
            [meta, est.id],
          ))
        )
          throw naoEncontrado('Meta de produtividade');
        const anteriores = await tx.consultarParaAtualizar<Linha>(
          `SELECT id, versao FROM apuracao_meta_produtividade
            WHERE meta_produtividade_repasse_id = ? AND competencia = ? AND substituida_em IS NULL`,
          [meta, e.competencia],
        );
        const agora = new Date();
        for (const a of anteriores)
          await tx.alterar('apuracao_meta_produtividade', num(a['id']), num(a['versao']), {
            substituida_em: agora,
          });
        const novo = await tx.incluir('apuracao_meta_produtividade', {
          meta_produtividade_repasse_id: meta,
          competencia: e.competencia,
          valor_apurado: e.valor,
          fonte: 'informado',
          observacao: e.observacao,
        });
        return { tabela: 'apuracao_meta_produtividade', id: novo };
      },
    );
  }

  // ── Lançamento na apuração ─────────────────────────────────────────────────────────────────────────

  /** Lança os créditos e os descontos calculados na apuração; o já lançado não se repete. */
  lancar(
    c: ContextoPortaPropria,
    apuracao: number,
    profissional: number | null,
  ): Promise<{
    lancamentos: number;
    descontos: number;
    credito: number;
    debito: number;
    pendencias: string[];
  }> {
    return this.gravar(
      c,
      'repasse.variavel.lancar',
      ['lancamento_repasse', 'desconto_custo_repasse', 'apuracao_repasse'],
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
        const sim = await this.calcular(tx, est.id, apuracao, a.competencia, profissional);
        const hoje = civil(new Date(), est.fuso).data;
        const pendencias: string[] = [];
        let lancamentos = 0;
        let descontos = 0;
        let credito = 0;
        let debito = 0;
        let seq = num(
          (
            await tx.uma<Linha>(
              'SELECT COALESCE(MAX(sequencia), 0) AS s FROM desconto_custo_repasse WHERE apuracao_repasse_id = ?',
              [apuracao],
            )
          )?.['s'],
        );
        for (const p of sim) {
          const fav = await tx.uma<Linha>(
            `SELECT id FROM favorecido_repasse
              WHERE estabelecimento_id = ? AND profissional_id = ? AND ativo AND tipo_favorecido = 'proprio_profissional'
                AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
              ORDER BY fonte_pagadora_id IS NULL DESC, vigencia_inicio DESC LIMIT 1`,
            [est.id, p.profissional, ultimoDiaDoMes(a.competencia), a.competencia],
          );
          for (const i of p.itens) {
            if (i.lancado) continue;
            const cents = Math.round(i.valor * 100);
            if (i.sentido === 'debito') {
              const custo = await tx.uma<Linha>(
                'SELECT tipo_desconto_repasse_id FROM custo_profissional WHERE id = ?',
                [i.regra],
              );
              seq += 1;
              await tx.incluir('desconto_custo_repasse', {
                apuracao_repasse_id: apuracao,
                sequencia: seq,
                custo_profissional_id: i.regra,
                tipo_desconto_repasse_id: num(custo?.['tipo_desconto_repasse_id']),
                competencia: a.competencia,
                descricao: i.referente.slice(0, 150),
                valor: i.valor,
                origem: 'sistema',
              });
              descontos += 1;
              debito += cents;
              continue;
            }
            if (i.evento === null) continue; // fica nas pendências do cálculo
            if (!fav) {
              pendencias.push(`${p.nome}: sem favorecido próprio vigente; o crédito não foi lançado.`);
              continue;
            }
            await tx.incluir('lancamento_repasse', {
              estabelecimento_id: est.id,
              favorecido_repasse_id: num(fav['id']),
              tipo_favorecido: 'medico',
              profissional_id: p.profissional,
              evento_repasse_id: i.evento,
              tipo_lancamento: 'apuracao',
              apuracao_repasse_id: apuracao,
              competencia: a.competencia,
              data_lancamento: hoje,
              valor: i.valor,
              valor_calculado: true,
              referente: i.referente.slice(0, 150),
              observacao: i.memoria,
              situacao: 'aberto',
            });
            lancamentos += 1;
            credito += cents;
          }
          pendencias.push(...p.pendencias.map((x) => `${p.nome}: ${x}`));
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
          descontos,
          credito: credito / 100,
          debito: debito / 100,
          pendencias,
        };
      },
    );
  }
}

function base(x: Linha) {
  return {
    id: num(x['id']),
    profissional: num(x['profissional_id']),
    profissionalNome: txtOuNull(x['profissional_nome']),
    evento: numOuNull(x['evento_repasse_id']),
    eventoNome: txtOuNull(x['evento_nome']),
    inicio: dataTexto(x['vigencia_inicio'])!,
    fim: dataTexto(x['vigencia_fim']),
    versao: num(x['versao']),
  };
}
