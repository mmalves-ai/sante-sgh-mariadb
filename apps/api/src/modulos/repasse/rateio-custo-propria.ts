// Rateio do repasse por setor e custos do prestador descontados do médico no banco do cliente (F8, 06-FAT linha 49).
// As regras são as puras de @sgh/dominio-repasse (rateio-setor); aqui ficam a leitura e a gravação. Contrato de efeito:
//   - tipo de desconto: `tipo_desconto_repasse` (código único, natureza, forma e o padrão que a forma pede); inativar
//     só marca `ativo` (nada apagado);
//   - custo do prestador: `custo_profissional` do médico com o tipo, o setor que gera a despesa (centro de custo), a
//     forma (valor ou percentual da produção), a faixa, a frequência e a vigência; outro vigente do mesmo médico, tipo
//     e descrição no período: 422 sem gravar. O desconto em si entra na apuração pelo lançamento da remuneração
//     variável (`desconto_custo_repasse`, C2-083);
//   - regra de rateio: `regra_rateio_repasse` do médico ou do grupo de repasse com a base (repasse ou custo) e
//     `regra_rateio_repasse_setor` com um setor por linha (o centro de custo vem do setor quando não é informado), a
//     soma exatamente 100%; outra vigente do mesmo dono no período: 422 sem gravar;
//   - encerrar (custo ou regra): só grava `vigencia_fim` (nunca estende, nunca apaga);
//   - ratear a apuração (em apuração ou apurada): `apuracao_repasse_rateio_setor` com uma linha por médico e setor (o
//     valor da base pela regra do médico, ou do grupo dele); ratear de novo atualiza a linha do mesmo médico e setor e
//     marca como excluída a que deixou de valer (nada apagado); apuração aprovada, liberada, paga ou cancelada: 422.
import {
  BASES_RATEIO,
  conflitoDeVigencia,
  FORMAS_TIPO_DESCONTO,
  FREQUENCIAS_CUSTO,
  type MedicoNaApuracao,
  NATUREZAS_TIPO_DESCONTO,
  type RegraRateioVigente,
  ratearApuracaoPorSetor,
  validarCustoDoPrestador,
  validarRegraRateioSetor,
  validarTipoDescontoRepasse,
} from '@sgh/dominio-repasse';
import type { Leitor } from '@sgh/nucleo';
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

export const PORTA_RATEIO_CUSTO_REPASSE = Symbol('PORTA_RATEIO_CUSTO_REPASSE');

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
const enumDe = <T extends string>(xs: readonly T[]) => z.enum(xs as unknown as [T, ...T[]]);

const esquemaTipo = z
  .object({
    codigo: z.string().trim().min(1).max(30),
    descricao: z.string().trim().min(1).max(150),
    natureza: enumDe(NATUREZAS_TIPO_DESCONTO),
    forma: enumDe(FORMAS_TIPO_DESCONTO).default('informado'),
    valorPadrao: z.number().nonnegative().nullable().default(null),
    percentualPadrao: z.number().nullable().default(null),
  })
  .strict();

const esquemaSituacaoTipo = z.object({ versao, ativo: z.boolean() }).strict();

const esquemaCusto = z
  .object({
    profissional: id,
    tipo: id,
    centroCusto: id.nullable().default(null),
    descricao: z.string().trim().min(1).max(150),
    natureza: z.enum(['desconto', 'acrescimo']).default('desconto'),
    forma: z.enum(['valor', 'percentual']),
    valor: z.number().nullable().default(null),
    percentual: z.number().nullable().default(null),
    faixaInicial: z.number().nullable().default(null),
    faixaFinal: z.number().nullable().default(null),
    frequencia: enumDe(FREQUENCIAS_CUSTO).default('mensal'),
    incideBaseImposto: z.boolean().default(false),
    calculaSobreLiquido: z.boolean().default(false),
    inicio: data,
    fim: data.nullable().default(null),
  })
  .strict();

const esquemaRegra = z
  .object({
    descricao: z.string().trim().min(1).max(150),
    profissional: id.nullable().default(null),
    grupoRepasse: id.nullable().default(null),
    base: enumDe(BASES_RATEIO).default('repasse'),
    inicio: data,
    fim: data.nullable().default(null),
    setores: z
      .array(
        z.object({ setor: id, centroCusto: id.nullable().default(null), percentual: z.number() }).strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

const esquemaEncerrar = z.object({ versao, fim: data }).strict();
const esquemaRatear = z.object({ apuracao: id }).strict();

export const TIPOS_ENCERRAVEIS = ['custo', 'rateio'] as const;
export type TipoEncerravel = (typeof TIPOS_ENCERRAVEIS)[number];

const SITUACOES_RATEAVEIS = ['em_apuracao', 'apurada'];

export class PortaRateioCustoRepassePropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(
      nucleo,
      cliente,
      [
        'tipo_desconto_repasse',
        'custo_profissional',
        'regra_rateio_repasse',
        'regra_rateio_repasse_setor',
        'apuracao_repasse_rateio_setor',
        'apuracao_repasse',
      ],
      'repasse.rateio-custo',
    );
  }

  // ── Leitura ────────────────────────────────────────────────────────────────────────────────────────

  /** Tipos de desconto, custos e regras de rateio (do médico, ou de todos) e as listas da tela. */
  painel(c: ContextoPortaPropria, profissional: number | null) {
    return this.ler(c, 'painel', async (l, est) => {
      const nome = (col: string) => `(SELECT pf.nome FROM profissional pr JOIN pessoa_fisica pf
                                       ON pf.id = pr.pessoa_fisica_id WHERE pr.id = ${col})`;
      const tipos = (
        await l.consultar<Linha>(
          'SELECT * FROM tipo_desconto_repasse ORDER BY ativo DESC, descricao LIMIT 500',
        )
      ).map((x) => ({
        id: num(x['id']),
        codigo: String(x['codigo']),
        descricao: String(x['descricao']),
        natureza: String(x['natureza']),
        forma: String(x['forma_calculo']),
        valorPadrao: numOuNull(x['valor_padrao']),
        percentualPadrao: numOuNull(x['percentual_padrao']),
        ativo: Boolean(num(x['ativo'])),
        versao: num(x['versao']),
      }));
      const custos = (
        await l.consultar<Linha>(
          `SELECT r.*, ${nome('r.profissional_id')} AS profissional_nome, t.descricao AS tipo_descricao,
                  cc.nome AS centro_nome
             FROM custo_profissional r JOIN tipo_desconto_repasse t ON t.id = r.tipo_desconto_repasse_id
             LEFT JOIN centro_custo cc ON cc.id = r.centro_custo_id
            WHERE r.estabelecimento_id = ? AND (? IS NULL OR r.profissional_id = ?) AND r.profissional_id IS NOT NULL
              AND r.ativo
            ORDER BY r.vigencia_inicio DESC, r.id DESC LIMIT 500`,
          [est.id, profissional, profissional],
        )
      ).map((x) => ({
        id: num(x['id']),
        profissional: num(x['profissional_id']),
        profissionalNome: txtOuNull(x['profissional_nome']),
        tipo: num(x['tipo_desconto_repasse_id']),
        tipoDescricao: String(x['tipo_descricao']),
        centroCusto: numOuNull(x['centro_custo_id']),
        centroNome: txtOuNull(x['centro_nome']),
        descricao: txtOuNull(x['descricao']) ?? String(x['tipo_descricao']),
        natureza: String(x['natureza']),
        forma: String(x['forma_calculo']),
        valor: numOuNull(x['valor']),
        percentual: numOuNull(x['percentual']),
        faixaInicial: numOuNull(x['faixa_inicial']),
        faixaFinal: numOuNull(x['faixa_final']),
        frequencia: String(x['frequencia']),
        inicio: dataTexto(x['vigencia_inicio'])!,
        fim: dataTexto(x['vigencia_fim']),
        versao: num(x['versao']),
      }));
      const regrasLinhas = await l.consultar<Linha>(
        `SELECT r.*, ${nome('r.profissional_id')} AS profissional_nome, g.descricao AS grupo_descricao
           FROM regra_rateio_repasse r LEFT JOIN grupo_repasse g ON g.id = r.grupo_repasse_id
          WHERE r.estabelecimento_id = ? AND r.ativo
            AND (? IS NULL OR r.profissional_id = ?
                 OR r.grupo_repasse_id IN (SELECT gp.grupo_repasse_id FROM grupo_repasse_profissional gp
                                            WHERE gp.profissional_id = ? AND gp.estabelecimento_id = ?
                                              AND gp.excluido_em IS NULL))
          ORDER BY r.vigencia_inicio DESC, r.id DESC LIMIT 500`,
        [est.id, profissional, profissional, profissional, est.id],
      );
      const setoresDe = await this.setoresDasRegras(
        l,
        regrasLinhas.map((x) => num(x['id'])),
      );
      const regras = regrasLinhas.map((x) => ({
        id: num(x['id']),
        descricao: String(x['descricao']),
        profissional: numOuNull(x['profissional_id']),
        profissionalNome: txtOuNull(x['profissional_nome']),
        grupoRepasse: numOuNull(x['grupo_repasse_id']),
        grupoDescricao: txtOuNull(x['grupo_descricao']),
        base: String(x['base_rateio']),
        inicio: dataTexto(x['vigencia_inicio'])!,
        fim: dataTexto(x['vigencia_fim']),
        versao: num(x['versao']),
        setores: setoresDe.get(num(x['id'])) ?? [],
      }));
      const setores = (
        await l.consultar<Linha>(
          `SELECT s.id, s.nome, s.centro_custo_id, cc.nome AS centro_nome FROM setor_funcional s
             LEFT JOIN centro_custo cc ON cc.id = s.centro_custo_id
            WHERE s.estabelecimento_id = ? AND s.ativo AND s.excluido_em IS NULL ORDER BY s.nome LIMIT 1000`,
          [est.id],
        )
      ).map((x) => ({
        id: num(x['id']),
        nome: String(x['nome']),
        centroCusto: numOuNull(x['centro_custo_id']),
        centroNome: txtOuNull(x['centro_nome']),
      }));
      const centros = (
        await l.consultar<Linha>(
          'SELECT id, nome FROM centro_custo WHERE estabelecimento_id = ? AND ativo ORDER BY nome LIMIT 1000',
          [est.id],
        )
      ).map((x) => ({ id: num(x['id']), nome: String(x['nome']) }));
      const grupos = (
        await l.consultar<Linha>(
          'SELECT id, descricao FROM grupo_repasse WHERE ativo ORDER BY descricao LIMIT 500',
          [],
        )
      ).map((x) => ({ id: num(x['id']), descricao: String(x['descricao']) }));
      return { tipos, custos, regras, setores, centros, grupos };
    });
  }

  private async setoresDasRegras(l: Leitor, regras: readonly number[]) {
    const mapa = new Map<
      number,
      {
        setor: number;
        setorNome: string;
        centroCusto: number;
        centroNome: string | null;
        percentual: number;
      }[]
    >();
    if (!regras.length) return mapa;
    for (const x of await l.consultar<Linha>(
      `SELECT rs.*, s.nome AS setor_nome, cc.nome AS centro_nome FROM regra_rateio_repasse_setor rs
         LEFT JOIN setor_funcional s ON s.id = rs.setor_funcional_id
         LEFT JOIN centro_custo cc ON cc.id = rs.centro_custo_id
        WHERE rs.regra_rateio_repasse_id IN (${regras.map(() => '?').join(',')}) AND rs.excluido_em IS NULL
        ORDER BY rs.regra_rateio_repasse_id, rs.sequencia`,
      [...regras],
    )) {
      const k = num(x['regra_rateio_repasse_id']);
      const lista = mapa.get(k) ?? [];
      lista.push({
        setor: num(x['setor_funcional_id']),
        setorNome: String(x['setor_nome'] ?? ''),
        centroCusto: num(x['centro_custo_id']),
        centroNome: txtOuNull(x['centro_nome']),
        percentual: num(x['percentual']),
      });
      mapa.set(k, lista);
    }
    return mapa;
  }

  /** O rateio da apuração: o já gravado por setor e o que a regra vigente daria agora, com as pendências. */
  rateioDaApuracao(c: ContextoPortaPropria, apuracao: number) {
    return this.ler(c, 'rateio', async (l, est) => {
      const a = await this.apuracao(l, est.id, apuracao);
      const calculo = await this.calcular(l, est.id, apuracao, a.competencia);
      const gravado = (
        await l.consultar<Linha>(
          `SELECT r.profissional_id, r.setor_funcional_id, r.valor_rateio, s.nome AS setor_nome,
                  (SELECT pf.nome FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
                    WHERE p.id = r.profissional_id) AS profissional_nome
             FROM apuracao_repasse_rateio_setor r JOIN setor_funcional s ON s.id = r.setor_funcional_id
            WHERE r.apuracao_repasse_id = ? AND r.excluido_em IS NULL ORDER BY r.sequencia`,
          [apuracao],
        )
      ).map((x) => ({
        profissional: num(x['profissional_id']),
        profissionalNome: txtOuNull(x['profissional_nome']),
        setor: num(x['setor_funcional_id']),
        setorNome: String(x['setor_nome']),
        valor: num(x['valor_rateio']),
      }));
      const porSetor = new Map<number, { setor: number; setorNome: string; valor: number }>();
      for (const g of gravado) {
        const s = porSetor.get(g.setor) ?? { setor: g.setor, setorNome: g.setorNome, valor: 0 };
        s.valor = Math.round((s.valor + g.valor) * 100) / 100;
        porSetor.set(g.setor, s);
      }
      return {
        apuracao: { id: apuracao, competencia: a.competencia, situacao: a.situacao },
        rateavel: SITUACOES_RATEAVEIS.includes(a.situacao),
        gravado,
        totaisPorSetor: [...porSetor.values()].sort((x, y) => y.valor - x.valor),
        simulado: calculo.parcelas.map((p) => ({
          profissional: p.profissional,
          setor: p.setor,
          regra: p.regra,
          base: p.base,
          valor: p.centavos / 100,
        })),
        pendencias: calculo.pendencias,
      };
    });
  }

  private async apuracao(l: Leitor, est: number, apuracao: number) {
    const a = await l.uma<Linha>(
      'SELECT id, competencia, situacao FROM apuracao_repasse WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [apuracao, est],
    );
    if (!a) throw naoEncontrado('Apuração');
    return { competencia: `${dataTexto(a['competencia'])!.slice(0, 7)}-01`, situacao: String(a['situacao']) };
  }

  private async calcular(l: Leitor, est: number, apuracao: number, comp: string) {
    const producao = new Map<number, number>();
    for (const x of await l.consultar<Linha>(
      `SELECT profissional_id, SUM(valor_repasse) AS total FROM apuracao_repasse_item
        WHERE apuracao_repasse_id = ? AND excluido_em IS NULL AND profissional_id IS NOT NULL
        GROUP BY profissional_id`,
      [apuracao],
    ))
      producao.set(num(x['profissional_id']), cent(x['total']));
    const custo = new Map<number, number>();
    for (const x of await l.consultar<Linha>(
      `SELECT cp.profissional_id, SUM(d.valor) AS total FROM desconto_custo_repasse d
         JOIN custo_profissional cp ON cp.id = d.custo_profissional_id
        WHERE d.apuracao_repasse_id = ? AND d.excluido_em IS NULL AND cp.profissional_id IS NOT NULL
        GROUP BY cp.profissional_id`,
      [apuracao],
    ))
      custo.set(num(x['profissional_id']), cent(x['total']));
    const profs = [...new Set([...producao.keys(), ...custo.keys()])];
    if (!profs.length) return { parcelas: [], pendencias: [] };
    const grupos = new Map<number, number[]>();
    for (const x of await l.consultar<Linha>(
      `SELECT profissional_id, grupo_repasse_id FROM grupo_repasse_profissional
        WHERE estabelecimento_id = ? AND excluido_em IS NULL AND vigencia_inicio <= LAST_DAY(?)
          AND (vigencia_fim IS NULL OR vigencia_fim >= ?) AND profissional_id IN (${profs.map(() => '?').join(',')})`,
      [est, comp, comp, ...profs],
    )) {
      const p = num(x['profissional_id']);
      grupos.set(p, [...(grupos.get(p) ?? []), num(x['grupo_repasse_id'])]);
    }
    const regrasLinhas = await l.consultar<Linha>(
      `SELECT * FROM regra_rateio_repasse
        WHERE estabelecimento_id = ? AND ativo AND vigencia_inicio <= LAST_DAY(?)
          AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
          AND (profissional_id IS NOT NULL OR grupo_repasse_id IS NOT NULL)`,
      [est, comp, comp],
    );
    const setores = await this.setoresDasRegras(
      l,
      regrasLinhas.map((x) => num(x['id'])),
    );
    const regras: RegraRateioVigente[] = regrasLinhas.map((x) => ({
      id: num(x['id']),
      profissional: numOuNull(x['profissional_id']),
      grupoRepasse: numOuNull(x['grupo_repasse_id']),
      base: String(x['base_rateio']) === 'custo' ? 'custo' : 'repasse',
      inicio: dataTexto(x['vigencia_inicio'])!,
      fim: dataTexto(x['vigencia_fim']),
      setores: (setores.get(num(x['id'])) ?? []).map((s) => ({ setor: s.setor, percentual: s.percentual })),
    }));
    const medicos: MedicoNaApuracao[] = profs.map((p) => ({
      profissional: p,
      repasseCentavos: producao.get(p) ?? 0,
      custoCentavos: custo.get(p) ?? 0,
      grupos: grupos.get(p) ?? [],
    }));
    return ratearApuracaoPorSetor(medicos, regras, comp);
  }

  // ── Gravação ───────────────────────────────────────────────────────────────────────────────────────

  incluirTipo(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaTipo, entrada);
    return this.gravar(c, 'repasse.tipo-desconto.incluir', ['tipo_desconto_repasse'], async (tx) => {
      const problemas = [...validarTipoDescontoRepasse(e)];
      if (await tx.uma('SELECT id FROM tipo_desconto_repasse WHERE codigo = ?', [e.codigo]))
        problemas.push({ campo: 'codigo', mensagem: 'Já existe tipo de desconto com este código.' });
      if (problemas.length) throw recusaRegra('Tipo de desconto recusado', problemas);
      const novo = await tx.incluir('tipo_desconto_repasse', {
        codigo: e.codigo,
        descricao: e.descricao,
        natureza: e.natureza,
        forma_calculo: e.forma,
        valor_padrao: e.forma === 'valor_fixo' ? e.valorPadrao : null,
        percentual_padrao: e.forma === 'percentual' ? e.percentualPadrao : null,
      });
      return { tabela: 'tipo_desconto_repasse', id: novo };
    });
  }

  situacaoTipo(c: ContextoPortaPropria, tipo: number, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaSituacaoTipo, entrada);
    return this.gravar(c, 'repasse.tipo-desconto.situacao', ['tipo_desconto_repasse'], async (tx) => {
      if (!(await tx.uma('SELECT id FROM tipo_desconto_repasse WHERE id = ?', [tipo])))
        throw naoEncontrado('Tipo de desconto');
      await tx.alterar('tipo_desconto_repasse', tipo, e.versao, { ativo: e.ativo });
      return { tabela: 'tipo_desconto_repasse', id: tipo };
    });
  }

  incluirCusto(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaCusto, entrada);
    return this.gravar(c, 'repasse.custo-prestador.incluir', ['custo_profissional'], async (tx, est) => {
      if (
        !(await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [e.profissional]))
      )
        throw naoEncontrado('Profissional');
      if (!(await tx.uma('SELECT id FROM tipo_desconto_repasse WHERE id = ? AND ativo', [e.tipo])))
        throw recusaRegra('Custo recusado', [
          { campo: 'tipo', mensagem: 'O tipo de desconto tem de estar ativo.' },
        ]);
      if (
        e.centroCusto !== null &&
        !(await tx.uma('SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ?', [
          e.centroCusto,
          est.id,
        ]))
      )
        throw naoEncontrado('Centro de custo');
      const existentes = await tx.consultarParaAtualizar<Linha>(
        `SELECT vigencia_inicio, vigencia_fim FROM custo_profissional
          WHERE estabelecimento_id = ? AND profissional_id = ? AND tipo_desconto_repasse_id = ? AND descricao = ? AND ativo`,
        [est.id, e.profissional, e.tipo, e.descricao],
      );
      const problemas = [
        ...validarCustoDoPrestador(e),
        ...conflitoDeVigencia(
          e,
          existentes.map((x) => ({
            inicio: dataTexto(x['vigencia_inicio'])!,
            fim: dataTexto(x['vigencia_fim']),
          })),
        ),
      ];
      if (problemas.length) throw recusaRegra('Custo recusado', problemas);
      const novo = await tx.incluir('custo_profissional', {
        estabelecimento_id: est.id,
        profissional_id: e.profissional,
        tipo_desconto_repasse_id: e.tipo,
        centro_custo_id: e.centroCusto,
        descricao: e.descricao,
        natureza: e.natureza,
        forma_calculo: e.forma,
        valor: e.forma === 'valor' ? e.valor : null,
        percentual: e.forma === 'percentual' ? e.percentual : null,
        faixa_inicial: e.faixaInicial,
        faixa_final: e.faixaFinal,
        frequencia: e.frequencia,
        incide_base_imposto: e.incideBaseImposto,
        calcula_sobre_liquido: e.calculaSobreLiquido,
        vigencia_inicio: e.inicio,
        vigencia_fim: e.fim,
      });
      return { tabela: 'custo_profissional', id: novo };
    });
  }

  incluirRegra(c: ContextoPortaPropria, entrada: unknown): Promise<{ id: number }> {
    const e = entradaValida(esquemaRegra, entrada);
    return this.gravar(
      c,
      'repasse.rateio-setor.regra.incluir',
      ['regra_rateio_repasse', 'regra_rateio_repasse_setor'],
      async (tx, est) => {
        if (
          e.profissional !== null &&
          !(await tx.uma('SELECT id FROM profissional WHERE id = ? AND excluido_em IS NULL', [
            e.profissional,
          ]))
        )
          throw naoEncontrado('Profissional');
        if (
          e.grupoRepasse !== null &&
          !(await tx.uma('SELECT id FROM grupo_repasse WHERE id = ? AND ativo', [e.grupoRepasse]))
        )
          throw naoEncontrado('Grupo de repasse');
        const problemas = [...validarRegraRateioSetor({ ...e, prestadorTerceiro: null })];
        // O centro de custo da linha vem do setor quando não é informado; setor de outro estabelecimento, inativo ou sem
        // centro (e sem centro informado) não entra.
        const centros: number[] = [];
        for (const [i, s] of e.setores.entries()) {
          const setor = await tx.uma<Linha>(
            'SELECT centro_custo_id FROM setor_funcional WHERE id = ? AND estabelecimento_id = ? AND ativo AND excluido_em IS NULL',
            [s.setor, est.id],
          );
          if (!setor) {
            problemas.push({
              campo: `setores.${i}.setor`,
              mensagem: 'Setor inexistente ou inativo neste estabelecimento.',
            });
            continue;
          }
          const centro = s.centroCusto ?? numOuNull(setor['centro_custo_id']);
          if (centro === null) {
            problemas.push({
              campo: `setores.${i}.centroCusto`,
              mensagem: 'O setor não tem centro de custo; informe o centro de custo da linha.',
            });
            continue;
          }
          if (
            s.centroCusto !== null &&
            !(await tx.uma('SELECT id FROM centro_custo WHERE id = ? AND estabelecimento_id = ?', [
              centro,
              est.id,
            ]))
          ) {
            problemas.push({ campo: `setores.${i}.centroCusto`, mensagem: 'Centro de custo inexistente.' });
            continue;
          }
          centros.push(centro);
        }
        const existentes = await tx.consultarParaAtualizar<Linha>(
          `SELECT vigencia_inicio, vigencia_fim FROM regra_rateio_repasse
            WHERE estabelecimento_id = ? AND ativo AND profissional_id <=> ? AND grupo_repasse_id <=> ?`,
          [est.id, e.profissional, e.grupoRepasse],
        );
        problemas.push(
          ...conflitoDeVigencia(
            e,
            existentes.map((x) => ({
              inicio: dataTexto(x['vigencia_inicio'])!,
              fim: dataTexto(x['vigencia_fim']),
            })),
          ),
        );
        if (problemas.length) throw recusaRegra('Regra de rateio recusada', problemas);
        const novo = await tx.incluir('regra_rateio_repasse', {
          estabelecimento_id: est.id,
          descricao: e.descricao,
          profissional_id: e.profissional,
          grupo_repasse_id: e.grupoRepasse,
          base_rateio: e.base,
          vigencia_inicio: e.inicio,
          vigencia_fim: e.fim,
        });
        for (const [i, s] of e.setores.entries())
          await tx.incluir('regra_rateio_repasse_setor', {
            regra_rateio_repasse_id: novo,
            sequencia: i + 1,
            centro_custo_id: centros[i],
            setor_funcional_id: s.setor,
            percentual: s.percentual,
          });
        return { tabela: 'regra_rateio_repasse', id: novo };
      },
    );
  }

  encerrar(
    c: ContextoPortaPropria,
    tipo: TipoEncerravel,
    alvo: number,
    entrada: unknown,
  ): Promise<{ id: number }> {
    const x = entradaValida(esquemaEncerrar, entrada);
    const tabela = tipo === 'custo' ? 'custo_profissional' : 'regra_rateio_repasse';
    const nome =
      tipo === 'custo' ? 'repasse.custo-prestador.encerrar' : 'repasse.rateio-setor.regra.encerrar';
    return this.gravar(c, nome, [tabela], async (tx, est) => {
      const f =
        tipo === 'custo'
          ? await tx.uma<Linha>(
              'SELECT vigencia_inicio, vigencia_fim FROM custo_profissional WHERE id = ? AND estabelecimento_id = ? AND ativo',
              [alvo, est.id],
            )
          : await tx.uma<Linha>(
              'SELECT vigencia_inicio, vigencia_fim FROM regra_rateio_repasse WHERE id = ? AND estabelecimento_id = ? AND ativo',
              [alvo, est.id],
            );
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
      await tx.alterar(tabela, alvo, x.versao, { vigencia_fim: x.fim });
      return { tabela, id: alvo };
    });
  }

  /** Grava o rateio da apuração por médico e setor; ratear de novo atualiza e marca como excluída a que saiu. */
  ratear(
    c: ContextoPortaPropria,
    entrada: unknown,
  ): Promise<{
    gravadas: number;
    excluidas: number;
    pendencias: { profissional: number; motivo: string }[];
  }> {
    const e = entradaValida(esquemaRatear, entrada);
    return this.gravar(
      c,
      'repasse.rateio-setor.apuracao.ratear',
      ['apuracao_repasse_rateio_setor', 'apuracao_repasse'],
      async (tx, est, usuario) => {
        const trava = await tx.consultarParaAtualizar<Linha>(
          'SELECT id, competencia, situacao FROM apuracao_repasse WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
          [e.apuracao, est.id],
        );
        const a = trava[0];
        if (!a) throw naoEncontrado('Apuração');
        if (!SITUACOES_RATEAVEIS.includes(String(a['situacao'])))
          throw recusaRegra('Rateio recusado', [
            {
              campo: 'apuracao',
              mensagem: 'Só a apuração em apuração ou apurada recebe o rateio por setor.',
            },
          ]);
        const comp = `${dataTexto(a['competencia'])!.slice(0, 7)}-01`;
        const calc = await this.calcular(tx, est.id, e.apuracao, comp);
        const atuais = await tx.consultarParaAtualizar<Linha>(
          `SELECT id, sequencia, profissional_id, setor_funcional_id, valor_rateio, versao, excluido_em
             FROM apuracao_repasse_rateio_setor WHERE apuracao_repasse_id = ?`,
          [e.apuracao],
        );
        const porChave = new Map(
          atuais.map((x) => [`${num(x['profissional_id'])}|${num(x['setor_funcional_id'])}`, x]),
        );
        let seq = atuais.reduce((m, x) => Math.max(m, num(x['sequencia'])), 0);
        const usadas = new Set<string>();
        let gravadas = 0;
        for (const p of calc.parcelas) {
          const k = `${p.profissional}|${p.setor}`;
          usadas.add(k);
          const valor = p.centavos / 100;
          const x = porChave.get(k);
          if (!x) {
            seq += 1;
            await tx.incluir('apuracao_repasse_rateio_setor', {
              apuracao_repasse_id: e.apuracao,
              sequencia: seq,
              profissional_id: p.profissional,
              setor_funcional_id: p.setor,
              valor_rateio: valor,
            });
            gravadas += 1;
          } else if (cent(x['valor_rateio']) !== p.centavos || x['excluido_em'] !== null) {
            await tx.alterar('apuracao_repasse_rateio_setor', num(x['id']), num(x['versao']), {
              valor_rateio: valor,
              excluido_em: null,
              excluido_por: null,
            });
            gravadas += 1;
          }
        }
        let excluidas = 0;
        for (const [k, x] of porChave)
          if (!usadas.has(k) && x['excluido_em'] === null) {
            await tx.alterar('apuracao_repasse_rateio_setor', num(x['id']), num(x['versao']), {
              excluido_em: new Date(),
              excluido_por: usuario,
            });
            excluidas += 1;
          }
        return {
          tabela: 'apuracao_repasse',
          id: e.apuracao,
          gravadas,
          excluidas,
          pendencias: calc.pendencias,
        };
      },
    );
  }
}
