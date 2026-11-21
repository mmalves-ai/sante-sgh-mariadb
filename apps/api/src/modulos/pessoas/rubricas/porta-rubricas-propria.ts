// Porta das rubricas, incidências e tabelas legais da folha (M53, etapa F1) sobre o banco do cliente, pelo
// @sgh/nucleo: leituras numa transação somente leitura. As rubricas são do estabelecimento da sessão (rubrica,
// incidencia_rubrica com o código de incidência do eSocial, tipo_rubrica, tipo_referencia_rubrica, natureza_rubrica);
// as tabelas legais (tabela_legal_vigencia e faixa_tabela_legal) e os domínios do eSocial (codigo_incidencia_rubrica,
// natureza_rubrica) valem para a rede inteira (lei federal e tabelas oficiais: não têm estabelecimento).
// Nenhuma gravação: a tela grava pelo CRUD genérico de cada cadastro.
// Melhoria: a tabela legal de cada vigência é montada pela vigência de cada tipo (IRRF, INSS, salário-família, mínimo,
// teto, contribuinte individual) em vigor naquela data, e o que está inativo (ativo = falso, excluído) não entra.
// Melhoria: a incidência de INSS, IRRF, FGTS, PIS e sindical vem só do código de incidência do eSocial da rubrica: a
// porta lê o código e a regra é a do domínio (marcasTributoRubrica sobre codigoEsocialEhBase), nunca uma lista própria.
// O código é o que estava em vigor na data de referência da versão da rubrica: hoje (no fuso do estabelecimento) para a
// versão vigente, o fim da vigência para a versão encerrada e o início para a versão futura.
// Pendência de modelo (pedido do lote 03-10): as incidências internas sem coluna no modelo (DSR, salário-família,
// vale-transporte, pensão, RAIS, informe de rendimentos) saem falsas até o DDL `rubrica.incide_*`.
import type {
  ApoioRubricas,
  DiasAfastamentoFolha,
  IncidenciaRubricaFolha,
  RubricaFolha,
  TabelaLegalFolha,
} from '@sgh/contratos';
import { INCIDENCIAS_RUBRICA_FOLHA } from '@sgh/contratos';
import { marcasTributoRubrica } from '@sgh/dominio-pessoas';
import { type ContextoNucleo, type Leitor, type NucleoProprio, recusa } from '@sgh/nucleo';
import { ErroProblema } from '../../../problema.filter.js';
import { portaIndisponivel } from '../../exames/public-api.js';
import { FUSO_PADRAO, relogioNoFuso } from '../../exames/relogio.js';
import { type ContextoRubricas, METODOS_PORTA_RUBRICAS, type PortaRubricas } from './porta-rubricas.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoRubricas = Pick<NucleoProprio, 'lerSomente'>;

type Linha = Record<string, unknown>;
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const sim = (v: unknown) => v === true || v === 1 || v === '1';
const dataIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null;
/** Valor em reais (DECIMAL) → centavos. */
const centavos = (v: unknown) => (v === null || v === undefined ? 0 : Math.round(Number(v) * 100));
/** Percentual (DECIMAL, 7,5 = 7,5%) → centésimos de ponto (750). */
const centesimos = (v: unknown) => (v === null || v === undefined ? 0 : Math.round(Number(v) * 100));

const semGravacao = () =>
  Promise.reject(
    new ErroProblema(
      'recusa-de-negocio',
      409,
      'Operação recusada',
      'As rubricas e as tabelas legais são gravadas pelo cadastro de cada uma.',
    ),
  );

/** Tributo do código de incidência (codigo_incidencia_rubrica.tributo) → tributo da tela. */
const TRIBUTO_TELA: Readonly<Record<string, 'inss' | 'irrf' | 'fgts' | 'sindical'>> = {
  inss: 'inss',
  irrf: 'irrf',
  fgts: 'fgts',
  contribuicao_sindical: 'sindical',
};

/** Unidade da referência (tipo_referencia_rubrica.unidade) → referência da tela. */
const REFERENCIA_TELA: Readonly<Record<string, RubricaFolha['referencia']>> = {
  valor: 'valor',
  horas: 'hora',
  dias: 'dia',
  percentual: 'percentual',
  quantidade: 'referencia',
};

const SQL_RUBRICAS = `
  SELECT r.id, r.estabelecimento_id, r.codigo, r.descricao, tr.natureza AS tipo_natureza, tr.sinal,
         trr.unidade AS referencia_unidade, r.percentual_incidencia, r.prioridade_calculo, r.ativo,
         r.vigencia_inicio, r.vigencia_fim, r.usa_em_folha, r.usa_em_ferias, r.usa_em_rescisao,
         r.usa_em_decimo_terceiro, r.compoe_media_ferias, r.compoe_media_decimo_terceiro, r.compoe_media_rescisao,
         nr.codigo_esocial AS natureza
    FROM rubrica r
    JOIN tipo_rubrica tr ON tr.id = r.tipo_rubrica_id
    JOIN tipo_referencia_rubrica trr ON trr.id = r.tipo_referencia_rubrica_id
    LEFT JOIN natureza_rubrica nr ON nr.id = r.natureza_rubrica_id
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL`;

/**
 * A incidência de cada versão da rubrica e tributo, na data de referência da versão: hoje (parâmetro, no fuso do
 * estabelecimento) limitado ao intervalo da vigência da rubrica. Havendo mais de uma, vale a de início mais recente
 * (a ordem crescente faz a última sobrescrever no mapa).
 */
const SQL_INCIDENCIAS = `
  SELECT x.rubrica_id, c.tributo, c.codigo_incidencia
    FROM (SELECT r.id AS rubrica_id,
                 GREATEST(r.vigencia_inicio, CASE WHEN r.vigencia_fim IS NOT NULL AND r.vigencia_fim < ? THEN r.vigencia_fim ELSE ? END) AS referencia
            FROM rubrica r WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL) x
    JOIN incidencia_rubrica i ON i.rubrica_id = x.rubrica_id AND i.excluido_em IS NULL
     AND i.vigencia_inicio <= x.referencia AND (i.vigencia_fim IS NULL OR i.vigencia_fim >= x.referencia)
    JOIN codigo_incidencia_rubrica c ON c.id = i.codigo_incidencia_rubrica_id
   ORDER BY x.rubrica_id, c.tributo, i.vigencia_inicio`;

function rubricaDe(r: Linha, inc: ReadonlyMap<string, string>): RubricaFolha {
  const id = Number(r['id']);
  const cod = (t: string) => inc.get(`${id}:${t}`) ?? null;
  const ferias = sim(r['usa_em_ferias']);
  const tributo = marcasTributoRubrica(
    {
      inss: cod('inss'),
      irrf: cod('irrf'),
      fgts: cod('fgts'),
      sindical: cod('contribuicao_sindical'),
      pis: cod('pis_pasep'),
    },
    { ferias },
  );
  const marcas: Record<IncidenciaRubricaFolha, boolean> = {
    ...tributo,
    // Sem coluna no modelo (pedido DDL rubrica.incide_*): falsas até o DDL, ditas no cabeçalho.
    dsr: false,
    salarioFamilia: false,
    valeTransporte: false,
    pensao: false,
    rais: false,
    informeRendimentos: false,
    mediaFerias: sim(r['compoe_media_ferias']),
    media13: sim(r['compoe_media_decimo_terceiro']),
    mediaRescisao: sim(r['compoe_media_rescisao']),
    rescisao: sim(r['usa_em_rescisao']),
  };
  const incidencias = Object.fromEntries(
    INCIDENCIAS_RUBRICA_FOLHA.map((i) => [i, marcas[i]]),
  ) as RubricaFolha['incidencias'];
  const natureza = texto(r['tipo_natureza']);
  const tipo: RubricaFolha['tipo'] =
    natureza === 'informativa' && Number(r['sinal']) < 0
      ? 'informativaDedutora'
      : natureza === 'provento' ||
          natureza === 'desconto' ||
          natureza === 'base' ||
          natureza === 'informativa'
        ? natureza
        : null;
  const codigoNumerico = Number.parseInt(texto(r['codigo']), 10);
  const usos: RubricaFolha['usos'] = [];
  if (sim(r['usa_em_folha'])) usos.push('mensal');
  if (ferias) usos.push('ferias');
  if (sim(r['usa_em_rescisao'])) usos.push('rescisao');
  const nat = Number.parseInt(texto(r['natureza']), 10);
  return {
    id,
    empresa: Number(r['estabelecimento_id']),
    codigo: Number.isFinite(codigoNumerico) && codigoNumerico >= 0 ? codigoNumerico : id,
    descricao: texto(r['descricao']),
    tipo,
    referencia: REFERENCIA_TELA[texto(r['referencia_unidade'])] ?? null,
    percentual: centesimos(r['percentual_incidencia']),
    prioridade: r['prioridade_calculo'] === null ? null : Number(r['prioridade_calculo']),
    ativa: sim(r['ativo']),
    vigencia: { inicio: dataIso(r['vigencia_inicio']), fim: dataIso(r['vigencia_fim']) },
    usos,
    incidencias,
    esocial: {
      inss: cod('inss'),
      irrf: cod('irrf'),
      fgts: cod('fgts'),
      sindical: cod('contribuicao_sindical'),
    },
    natureza: Number.isFinite(nat) ? nat : null,
  };
}

/** Tipos da tabela legal que compõem a tela (o de dias de afastamento é lido à parte). */
const TIPOS_TABELA = [
  'irrf',
  'inss',
  'salario_familia',
  'salario_minimo',
  'teto_inss',
  'inss_contribuinte_individual',
] as const;

interface VigenciaTabela {
  readonly id: number;
  readonly tipo: string;
  readonly inicio: string;
  readonly linha: Linha;
  readonly faixas: Linha[];
}

/** A vigência de cada tipo em vigor na data (a de início mais recente até ela). */
function emVigor(vs: readonly VigenciaTabela[], tipo: string, data: string): VigenciaTabela | null {
  let melhor: VigenciaTabela | null = null;
  for (const v of vs)
    if (v.tipo === tipo && v.inicio <= data && (!melhor || v.inicio > melhor.inicio)) melhor = v;
  return melhor;
}

function tabelaNaData(vs: readonly VigenciaTabela[], inicio: string): TabelaLegalFolha {
  const irrf = emVigor(vs, 'irrf', inicio);
  const inss = emVigor(vs, 'inss', inicio);
  const familia = emVigor(vs, 'salario_familia', inicio);
  const minimo = emVigor(vs, 'salario_minimo', inicio);
  const teto = emVigor(vs, 'teto_inss', inicio);
  const ci = emVigor(vs, 'inss_contribuinte_individual', inicio);
  const faixas = (v: VigenciaTabela | null) =>
    (v?.faixas ?? []).map((f) => ({
      de: centavos(f['limite_inferior']),
      ate: f['limite_superior'] === null ? null : centavos(f['limite_superior']),
      aliquota: centesimos(f['aliquota']),
      deducao: centavos(f['parcela_deduzir']),
    }));
  const l = irrf?.linha ?? {};
  return {
    inicio,
    irrf: {
      faixas: faixas(irrf),
      deducaoDependente: centavos(l['deducao_dependente']),
      descontoSimplificado: centavos(l['desconto_simplificado']),
      reducao: {
        isencaoAte: centavos(l['isencao_ate']),
        reducaoDe: centavos(l['reducao_de']),
        reducaoAte: centavos(l['reducao_ate']),
        valor: centavos(l['valor_referencia']),
        semReducaoAcimaDe: centavos(l['sem_reducao_acima_de']),
      },
    },
    inss: {
      faixas: faixas(inss),
      teto: centavos(inss?.linha['teto'] ?? teto?.linha['valor_referencia'] ?? null),
    },
    salarioFamilia: (familia?.faixas ?? []).map((f) => ({
      de: centavos(f['limite_inferior']),
      ate: centavos(f['limite_superior'] ?? f['limite_inferior']),
      cota: centavos(f['valor_fixo']),
    })),
    salarioMinimo: centavos(minimo?.linha['valor_referencia'] ?? null),
    contribuinteIndividual: {
      aliquota: Math.min(
        10_000,
        centesimos(ci?.faixas[0]?.['aliquota'] ?? ci?.linha['valor_referencia'] ?? null),
      ),
      teto: centavos(ci?.linha['teto'] ?? teto?.linha['valor_referencia'] ?? null),
    },
  };
}

export class PortaRubricasPropria implements PortaRubricas {
  readonly destino = 'banco' as const;

  constructor(private readonly nucleo: NucleoRubricas) {}

  private ler<T>(c: ContextoRubricas, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(contextoDe(c), fn);
  }

  podeGravar = async () => ({ pode: true, codigo: null, motivo: null });
  executar: PortaRubricas['executar'] = semGravacao;
  gravarSgh: PortaRubricas['gravarSgh'] = semGravacao;

  rubricas(c: ContextoRubricas, empresa: number | null): Promise<RubricaFolha[]> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    // A "empresa" da tela é o estabelecimento: outra que não a da sessão não tem rubricas visíveis aqui.
    if (empresa !== null && empresa !== est) return Promise.resolve([]);
    return this.ler(c, async (l) => {
      const f = await l.uma<{ fuso_horario: string | null }>(
        'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
        [est],
      );
      const hoje = relogioNoFuso(f?.fuso_horario || FUSO_PADRAO).hoje;
      const [linhas, incs] = await Promise.all([
        l.consultar(`${SQL_RUBRICAS} ORDER BY r.codigo, r.vigencia_inicio, r.id`, [est]),
        l.consultar(SQL_INCIDENCIAS, [hoje, hoje, est]),
      ]);
      const mapa = new Map<string, string>();
      for (const i of incs)
        mapa.set(`${Number(i['rubrica_id'])}:${texto(i['tributo'])}`, texto(i['codigo_incidencia']));
      return linhas.map((r) => rubricaDe(r, mapa));
    });
  }

  tabelasLegais(c: ContextoRubricas): Promise<TabelaLegalFolha[]> {
    // Tabela legal é lei federal: vale para a rede inteira (sem estabelecimento).
    return this.ler(c, async (l) => {
      const marcas = TIPOS_TABELA.map(() => '?').join(', ');
      const linhas = await l.consultar(
        `SELECT * FROM tabela_legal_vigencia WHERE ativo = TRUE AND tipo_tabela IN (${marcas}) ORDER BY vigencia_inicio`,
        [...TIPOS_TABELA],
      );
      const faixas = linhas.length
        ? await l.consultar(
            `SELECT f.tabela_legal_vigencia_id, f.limite_inferior, f.limite_superior, f.aliquota, f.parcela_deduzir, f.valor_fixo
               FROM faixa_tabela_legal f JOIN tabela_legal_vigencia t ON t.id = f.tabela_legal_vigencia_id
              WHERE t.ativo = TRUE AND f.excluido_em IS NULL AND t.tipo_tabela IN (${marcas})
              ORDER BY f.tabela_legal_vigencia_id, f.sequencia`,
            [...TIPOS_TABELA],
          )
        : [];
      const porTabela = new Map<number, Linha[]>();
      for (const f of faixas) {
        const k = Number(f['tabela_legal_vigencia_id']);
        porTabela.set(k, [...(porTabela.get(k) ?? []), f]);
      }
      const vs: VigenciaTabela[] = linhas.map((t) => ({
        id: Number(t['id']),
        tipo: texto(t['tipo_tabela']),
        inicio: dataIso(t['vigencia_inicio']) ?? '',
        linha: t,
        faixas: porTabela.get(Number(t['id'])) ?? [],
      }));
      // Uma tabela da tela por início de vigência do IRRF ou do INSS (as que dão as faixas), da mais nova à mais antiga.
      const inicios = [
        ...new Set(vs.filter((v) => v.tipo === 'irrf' || v.tipo === 'inss').map((v) => v.inicio)),
      ]
        .sort()
        .reverse();
      return inicios.map((i) => tabelaNaData(vs, i));
    });
  }

  diasAfastamento(c: ContextoRubricas): Promise<DiasAfastamentoFolha[]> {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT vigencia_inicio, quantidade_dias FROM tabela_legal_vigencia
            WHERE tipo_tabela = 'dias_afastamento_empresa' AND ativo = TRUE AND quantidade_dias IS NOT NULL
            ORDER BY vigencia_inicio DESC`,
          [],
        )
      ).map((r) => ({ inicio: dataIso(r['vigencia_inicio']) ?? '', dias: Number(r['quantidade_dias']) })),
    );
  }

  dominios(c: ContextoRubricas): Promise<Pick<ApoioRubricas, 'incidenciasEsocial' | 'naturezas'>> {
    // Tabelas oficiais do eSocial: valem para a rede inteira.
    return this.ler(c, async (l) => {
      const [codigos, naturezas] = await Promise.all([
        l.consultar(
          `SELECT tributo, codigo_incidencia, descricao FROM codigo_incidencia_rubrica
            WHERE vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE ORDER BY tributo, codigo_incidencia`,
          [],
        ),
        l.consultar(
          `SELECT id, codigo_esocial, descricao FROM natureza_rubrica
            WHERE vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE ORDER BY codigo_esocial`,
          [],
        ),
      ]);
      const incidenciasEsocial: ApoioRubricas['incidenciasEsocial'] = {
        inss: [],
        irrf: [],
        fgts: [],
        sindical: [],
      };
      for (const r of codigos) {
        const t = TRIBUTO_TELA[texto(r['tributo'])];
        const codigo = texto(r['codigo_incidencia']).slice(0, 5);
        if (t && codigo && !incidenciasEsocial[t].some((x) => x.codigo === codigo))
          incidenciasEsocial[t].push({ codigo, rotulo: texto(r['descricao']) });
      }
      return {
        incidenciasEsocial,
        naturezas: naturezas.map((n) => ({
          id: Number(n['id']),
          codigo: texto(n['codigo_esocial']),
          rotulo: texto(n['descricao']),
        })),
      };
    });
  }
}

function contextoDe(c: ContextoRubricas): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'rubricas').slice(0, 64),
  };
}

export function portaRubricasIndisponivel(): PortaRubricas {
  return portaIndisponivel<PortaRubricas>(METODOS_PORTA_RUBRICAS);
}
