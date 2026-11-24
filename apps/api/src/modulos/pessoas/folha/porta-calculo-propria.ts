// Porta do cálculo da folha sobre o MariaDB do cliente (M53.3 a M53.8), pelo @sgh/nucleo. Leituras numa transação curta
// somente leitura, filtradas pelo estabelecimento da sessão.
// Tabelas lidas: vinculo_trabalho, categoria_trabalhador, colaborador, cargo, dependente, historico_salarial, risco_funcao,
// usuario, tipo_rescisao, desligamento, rescisao, competencia_folha, calculo_folha, parcela_decimo_terceiro,
// parametro_folha e fechamento_periodo_folha.
// Gravam (gravação direta pelo executor, com a trilha na mesma transação): a vigência do salário (historico_salarial),
// os parâmetros da folha por vigência (parametro_folha) e o fechamento do período e a reabertura
// (fechamento_periodo_folha).
// O processamento da folha, a rescisão (com o desligamento), as férias e os parâmetros das obrigações são lidos por
// LeiturasCalculoFolhaPropria (folha-porta-propria-calculo.ts) e gravados por gravadorFolhaExecutor
// (folha-executor-proprio.ts), na mesma transação do gravador. Ainda recusam com `modelo-pendente` (nunca vazio nem
// gravação pela metade): a inclusão das férias e a troca para `calculada` (o recibo ligado ao processamento), as
// obrigações geradas (o arquivo cifrado pela porta de armazenamento e as situações entregue e substituída) e os
// catálogos oficiais das obrigações.
// Melhoria: o tipo do vínculo sai da categoria do trabalhador (901 estagiário, 902 residente) e do regime, pela regra pura
// `tipoVinculoDaFolha`; categoria fora da folha de empregados não entra (antes, todo vínculo saía como CLT).
// Melhoria: o FGTS depositado só é somado das folhas de competência fechada quando todo mês do contrato tem folha; se
// falta algum (por exemplo, os meses antes da virada), recusa e pede o saldo do extrato da conta vinculada. A soma não
// inclui a correção (JAM) da conta: o saldo do extrato é sempre a base preferível da multa.
// Melhoria: o adicional de insalubridade e de periculosidade da vigência do salário vem do risco da função (risco_funcao,
// laudo do SESMT) em vigor no início da vigência, em vez de digitado à parte.
// Melhoria: a carga semanal vem do cargo; sem ela, null (antes, um valor fixo).
// Melhoria: o adicional da vigência nova tem de bater com o risco da função (laudo do SESMT): sem laudo, nada de
// adicional; com direito aos dois, a escolha do empregado vai em `adicional_escolhido` (CLT art. 193, § 2º).
// Decisão: o motivo do salário é texto livre na tela e um código no modelo; grava-se o código `outro` com o texto em
// `dados.justificativa`, e a leitura devolve o texto (ou o código, nas linhas vindas de outra origem).
import type {
  ParametrosFolhaLidos,
  ProcessoNoFechamento,
  SituacaoFechamentoFolha,
  TotaisFechamentoFolha,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  ErroOperacao,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { gravacaoDireta } from '../../enfermagem/gravacao-direta.js';
import {
  type ContextoPortaM18,
  type GravacaoFeita,
  type LiberacaoGravacao,
  portaIndisponivel,
  type TrilhaDaGravacao,
} from '../../exames/public-api.js';
import { exigirUsuario, paraBanco, relogioDoEstabelecimento } from '../../qualidade/apoio-propria.js';
import {
  type ContextoCalculoFolha,
  type GravadorCalculoFolha,
  METODOS_PORTA_CALCULO_FOLHA,
  type PortaCalculoFolha,
} from './porta-calculo.js';
import { TETO_FECHAMENTOS_FOLHA } from './apoio-folha.js';
import { gravadorFolhaExecutor, TABELAS_FOLHA_EXECUTOR } from './folha-executor-proprio.js';
import { LeiturasCalculoFolhaPropria } from './folha-porta-propria-calculo.js';
import {
  competenciasDescobertas,
  type DependentesDoVinculo,
  type FechamentoDaFolha,
  type FiltroFechamentosDaFolha,
  insalubridadeDoGrau,
  type OrigemAdiantamentoDecimo,
  type SalarioDoVinculo,
  type TipoRescisaoDaFolha,
  tipoVinculoDaFolha,
  type VinculoDesligado,
  type VinculoDoCalculo,
} from './tipos-folha.js';

const n = (v: unknown): number => Number(v ?? 0);
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const doisDigitos = (x: number) => String(x).padStart(2, '0');

/** DATE do banco em ISO (AAAA-MM-DD): o driver entrega Date à meia-noite local ou texto. */
function dia(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date)
    return `${v.getFullYear()}-${doisDigitos(v.getMonth() + 1)}-${doisDigitos(v.getDate())}`;
  return String(v).slice(0, 10);
}
const diaObrigatorio = (v: unknown): string => dia(v) ?? '';
const instante = (v: unknown): string => (v instanceof Date ? v.toISOString() : texto(v));
const tipoDe = (r: Record<string, unknown>) =>
  tipoVinculoDaFolha(texto(r['categoria']), texto(r['grupo_categoria']), texto(r['regime_trabalhista']));

function contextoDe(c: ContextoPortaM18): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: c.correlacao.slice(0, 64),
  };
}

/** Recusa explícita de operação cujo registro o modelo do banco ainda não tem (pedido de DDL da obra, lote 03-06). */
function erroModeloPendente(operacao: string, falta: string): ErroOperacao {
  return new ErroOperacao(
    409,
    'modelo-pendente',
    'Operação indisponível no modelo atual',
    `${operacao}: o modelo do banco ainda não tem ${falta}. A operação volta quando a tabela for criada.`,
  );
}

/** Vínculos do estabelecimento ativos em algum dia de [inicio, fim] (com o colaborador e o cargo). */
const SQL_VINCULOS = `
  SELECT v.id, v.matricula, v.regime_trabalhista, v.data_admissao, v.data_desligamento, v.centro_custo_id,
         v.setor_funcional_id, c.profissional_id, c.cpf, g.carga_semanal_horas_padrao,
         ct.codigo_esocial AS categoria, ct.grupo AS grupo_categoria
    FROM vinculo_trabalho v
    JOIN colaborador c ON c.id = v.colaborador_id
    JOIN categoria_trabalhador ct ON ct.id = v.categoria_trabalhador_id
    LEFT JOIN cargo g ON g.id = v.cargo_id
   WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL AND c.excluido_em IS NULL
     AND v.data_admissao <= ? AND (v.data_desligamento IS NULL OR v.data_desligamento >= ?)
   ORDER BY v.id`;

export type NucleoCalculoFolha = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** As tabelas que a gravação do cálculo escreve hoje (a transação recusa as outras). */
export const TABELAS_CALCULO_FOLHA = [
  'historico_salarial',
  'parametro_folha',
  'fechamento_periodo_folha',
] as const;

const FALTA = {
  processo:
    'o processamento da folha no formato do cálculo (situação substituída, a contagem fora da folha, a data da tabela legal e dos parâmetros usados, a unidade e a memória de cada linha)',
  ferias: 'o processamento da folha no formato do cálculo, a que o recibo de férias se liga',
  feriasCompetencia: 'o processamento da folha no formato do cálculo, a que o recibo de férias se liga',
  rescisao: 'o processamento da folha no formato do cálculo, a que a rescisão se liga',
  obrigacoes:
    'o arquivo cifrado da obrigação, os parâmetros das obrigações por vigência e os códigos SEFIP, CAGED e RAIS dos catálogos oficiais',
} as const;

const GRAUS = ['nenhum', 'minimo', 'medio', 'maximo'] as const;
const GRAU_SQL = `CASE rf.grau_insalubridade WHEN 'maximo' THEN 3 WHEN 'medio' THEN 2 WHEN 'minimo' THEN 1 ELSE 0 END`;
const json = <T>(v: unknown, padrao: T): T => {
  if (v === null || v === undefined) return padrao;
  if (typeof v === 'object') return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return padrao;
  }
};

/** O período do contrato (AAAA-MM ou AAAA) no primeiro dia do banco, e de volta. */
const periodoNoBanco = (periodo: string): string =>
  periodo.length === 4 ? `${periodo}-01-01` : `${periodo}-01`;
const periodoDoBanco = (apuracao: unknown, v: unknown): string =>
  apuracao === 'anual' ? diaObrigatorio(v).slice(0, 4) : diaObrigatorio(v).slice(0, 7);
const SITUACAO_FECHAMENTO: Readonly<Record<string, SituacaoFechamentoFolha>> = {
  fechado: 'fechada',
  reaberto: 'reaberta',
};

const SQL_PARAMETROS = `
  SELECT p.id, p.estabelecimento_id, p.vigencia_inicio, p.dados, p.criado_em, u.login
    FROM parametro_folha p LEFT JOIN usuario u ON u.id = p.criado_por
   WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL
   ORDER BY p.vigencia_inicio DESC, p.id DESC`;

function parametrosDe(r: Record<string, unknown>): ParametrosFolhaLidos {
  const d = json<Omit<ParametrosFolhaLidos, 'id' | 'empresa' | 'inicio' | 'registradoPor' | 'registradoEm'>>(
    r['dados'],
    {} as never,
  );
  return {
    ...d,
    empresa: n(r['estabelecimento_id']),
    inicio: diaObrigatorio(r['vigencia_inicio']),
    id: n(r['id']),
    registradoPor: texto(r['login']),
    registradoEm: instante(r['criado_em']),
  };
}

const SQL_FECHAMENTOS = `
  SELECT f.*, uf.login AS fechado_login, ur.login AS reaberto_login
    FROM fechamento_periodo_folha f
    LEFT JOIN usuario uf ON uf.id = f.fechado_por_usuario_id
    LEFT JOIN usuario ur ON ur.id = f.reaberto_por_usuario_id
   WHERE f.estabelecimento_id = ?`;

function fechamentoDe(r: Record<string, unknown>): FechamentoDaFolha {
  return {
    id: n(r['id']),
    empresa: n(r['estabelecimento_id']),
    apuracao: r['apuracao'] === 'anual' ? 'anual' : 'mensal',
    periodo: periodoDoBanco(r['apuracao'], r['periodo_inicio']),
    numero: n(r['numero']),
    situacao: SITUACAO_FECHAMENTO[texto(r['situacao'])] ?? 'fechada',
    pagamento: dia(r['pagamento_em']),
    processos: json<ProcessoNoFechamento[]>(r['processamentos'], []),
    totais: json<TotaisFechamentoFolha>(r['totais'], {} as TotaisFechamentoFolha),
    resumo: texto(r['resumo']),
    fechadoPor: texto(r['fechado_login']),
    fechadoEm: instante(r['fechado_em']),
    reabertoPor: textoOuNulo(r['reaberto_login']),
    reabertoEm:
      r['reaberto_em'] === null || r['reaberto_em'] === undefined ? null : instante(r['reaberto_em']),
    motivo: textoOuNulo(r['motivo_reabertura']),
    versao: n(r['versao']),
  };
}

/** O risco da função do vínculo em vigor na data: o maior grau de insalubridade dos ambientes e a periculosidade. */
async function riscoDaFuncao(
  l: Pick<Leitor, 'uma'>,
  vinculo: number,
  data: string,
): Promise<{ insalubridade: number; periculosidade: boolean }> {
  const r = await l.uma(
    `SELECT MAX(${GRAU_SQL}) AS grau, MAX(rf.periculosidade) AS periculosidade
       FROM vinculo_trabalho v
       JOIN risco_funcao rf ON rf.funcao_id = v.funcao_id AND rf.excluido_em IS NULL
            AND rf.vigencia_inicio <= ? AND (rf.vigencia_fim IS NULL OR rf.vigencia_fim >= ?)
      WHERE v.id = ?`,
    [data, data, vinculo],
  );
  return {
    insalubridade: insalubridadeDoGrau(GRAUS[n(r?.['grau'])] ?? null),
    periculosidade: n(r?.['periculosidade']) === 1,
  };
}

/** O adicional escolhido da vigência nova, conferido contra o risco da função; diverge: recusa (o laudo manda). */
export function adicionalDaVigencia(
  x: { readonly insalubridade: number; readonly periculosidade: boolean },
  risco: { readonly insalubridade: number; readonly periculosidade: boolean },
): 'insalubridade' | 'periculosidade' | null {
  const divergente = () =>
    recusa(
      'adicional-diverge-do-laudo',
      'O adicional informado não bate com o risco da função no início da vigência (laudo do SESMT): corrija o risco da função ou o adicional.',
    );
  if (x.periculosidade) {
    if (!risco.periculosidade || x.insalubridade !== 0) throw divergente();
    return risco.insalubridade > 0 ? 'periculosidade' : null;
  }
  if (x.insalubridade !== risco.insalubridade) throw divergente();
  if (risco.periculosidade) {
    // Com direito aos dois, o empregado escolhe; sem insalubridade, deixar a periculosidade de fora não é escolha.
    if (risco.insalubridade === 0) throw divergente();
    return 'insalubridade';
  }
  return null;
}

/** O gravador do cálculo sobre a transação: o que tem modelo grava; o resto recusa com `modelo-pendente`. */
function gravadorCalculo(tx: TxOperacao, est: number, porta: PortaCalculoFolhaPropria): GravadorCalculoFolha {
  const agora = async () => paraBanco(await relogioDoEstabelecimento(tx, est));
  const daSessao = (empresa: number) => {
    if (empresa !== est)
      throw recusa('empresa-fora-da-sessao', 'A empresa da folha é o estabelecimento da sessão.');
  };
  return {
    // O processamento, a rescisão, as férias e as obrigações (folha-executor-proprio.ts; o que ainda não tem modelo
    // recusa lá dentro com `modelo-pendente`, sem gravar nada).
    ...gravadorFolhaExecutor(tx, est),
    salarios: (vinculos) => lerSalarios(tx, est, vinculos),
    async incluirSalario(x) {
      const [v] = await tx.consultarParaAtualizar(
        'SELECT id FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [x.vinculo, est],
      );
      if (!v) throw recusa('vinculo-inexistente', 'O vínculo não existe neste estabelecimento.');
      if ((await lerSalarios(tx, est, [x.vinculo])).some((y) => y.inicio === x.inicio))
        throw recusa(
          'vigencia-repetida',
          'Já existe uma vigência do salário com este início: escolha outra data.',
        );
      const escolhido = adicionalDaVigencia(x, await riscoDaFuncao(tx, x.vinculo, x.inicio));
      const usuario = await exigirUsuario(tx, x.por);
      return tx.incluir('historico_salarial', {
        vinculo_trabalho_id: x.vinculo,
        data_vigencia: x.inicio,
        valor_salario: x.salario,
        unidade_pagamento: 'mes',
        motivo: 'outro',
        operacao: 'inclusao',
        dados: JSON.stringify({ justificativa: x.motivo }),
        adicional_escolhido: escolhido,
        ocorrido_em: await agora(),
        usuario_id: usuario,
      });
    },
    parametros: async (empresa) =>
      empresa === est ? (await tx.consultar(SQL_PARAMETROS, [est])).map(parametrosDe) : [],
    async incluirParametros(x) {
      daSessao(x.empresa);
      const repetida = await tx.consultarParaAtualizar(
        'SELECT id FROM parametro_folha WHERE estabelecimento_id = ? AND vigencia_inicio = ? AND excluido_em IS NULL',
        [est, x.inicio],
      );
      if (repetida.length > 0)
        throw recusa(
          'vigencia-repetida',
          'Já existem parâmetros da folha com este início para a empresa: escolha outra data.',
        );
      await exigirUsuario(tx, x.por);
      const { inicio } = x;
      const dados = Object.fromEntries(
        Object.entries(x).filter(([k]) => k !== 'empresa' && k !== 'inicio' && k !== 'por'),
      ) as Omit<typeof x, 'empresa' | 'inicio' | 'por'>;
      return tx.incluir('parametro_folha', {
        estabelecimento_id: est,
        vigencia_inicio: inicio,
        dados: JSON.stringify(dados),
      });
    },
    async fechamentoEmVigorComTrava(empresa, apuracao, periodo) {
      daSessao(empresa);
      const rs = await tx.consultarParaAtualizar(
        'SELECT id, numero, situacao FROM fechamento_periodo_folha WHERE estabelecimento_id = ? AND apuracao = ? AND periodo_inicio = ?',
        [est, apuracao, periodoNoBanco(periodo)],
      );
      const vigente = rs.find((r) => r['situacao'] === 'fechado');
      return {
        vigente: vigente ? await porta.fechamentoNaTransacao(tx, est, n(vigente['id'])) : null,
        proximoNumero: rs.reduce((m, r) => Math.max(m, n(r['numero'])), 0) + 1,
      };
    },
    async incluirFechamento(x) {
      daSessao(x.empresa);
      const usuario = await exigirUsuario(tx, x.por);
      const ja = await tx.uma(
        'SELECT id FROM fechamento_periodo_folha WHERE estabelecimento_id = ? AND apuracao = ? AND periodo_inicio = ? AND numero = ?',
        [est, x.apuracao, periodoNoBanco(x.periodo), x.numero],
      );
      if (ja)
        throw recusa(
          'periodo-ja-fechado',
          'Outra pessoa fechou este período ao mesmo tempo: abra de novo e confira.',
        );
      return tx.incluir('fechamento_periodo_folha', {
        estabelecimento_id: est,
        apuracao: x.apuracao,
        periodo_inicio: periodoNoBanco(x.periodo),
        numero: x.numero,
        situacao: 'fechado',
        pagamento_em: x.apuracao === 'mensal' ? x.pagamento : null,
        processamentos: JSON.stringify(x.processos),
        totais: JSON.stringify(x.totais),
        resumo: x.resumo,
        fechado_em: await agora(),
        fechado_por_usuario_id: usuario,
      });
    },
    async reabrirFechamento(x) {
      const [r] = await tx.consultarParaAtualizar(
        'SELECT id, situacao, versao FROM fechamento_periodo_folha WHERE id = ? AND estabelecimento_id = ?',
        [x.id, est],
      );
      if (!r || r['situacao'] !== 'fechado' || n(r['versao']) !== x.versao)
        throw recusa('desatualizado', 'O fechamento mudou desde a leitura: abra de novo e confira.');
      await tx.alterar('fechamento_periodo_folha', x.id, x.versao, {
        situacao: 'reaberto',
        reaberto_em: await agora(),
        reaberto_por_usuario_id: await exigirUsuario(tx, x.por),
        motivo_reabertura: x.motivo,
      });
    },
  };
}

/**
 * Vigências do salário dos vínculos (historico_salarial: a última operação de cada data de vigência, sem as excluídas).
 * O adicional é o do risco da função do vínculo (risco_funcao) em vigor no início da vigência: o maior grau de
 * insalubridade dos ambientes da função e a periculosidade; com direito aos dois, vale o `adicional_escolhido` (sem
 * escolha, a periculosidade). Vínculo sem função ou função sem risco: sem adicional.
 */
async function lerSalarios(
  l: Pick<Leitor, 'consultar'>,
  est: number,
  vinculos: readonly number[],
): Promise<SalarioDoVinculo[]> {
  if (vinculos.length === 0) return [];
  const rs = await l.consultar(
    `SELECT h.id, h.vinculo_trabalho_id, h.data_vigencia, h.valor_salario, h.motivo, h.dados, h.operacao, h.ocorrido_em,
            h.adicional_escolhido, u.login,
            (SELECT MAX(${GRAU_SQL})
               FROM risco_funcao rf
              WHERE rf.funcao_id = v.funcao_id AND rf.excluido_em IS NULL AND rf.vigencia_inicio <= h.data_vigencia
                AND (rf.vigencia_fim IS NULL OR rf.vigencia_fim >= h.data_vigencia)) AS grau,
            (SELECT MAX(rf.periculosidade)
               FROM risco_funcao rf
              WHERE rf.funcao_id = v.funcao_id AND rf.excluido_em IS NULL AND rf.vigencia_inicio <= h.data_vigencia
                AND (rf.vigencia_fim IS NULL OR rf.vigencia_fim >= h.data_vigencia)) AS periculosidade
       FROM historico_salarial h
       JOIN vinculo_trabalho v ON v.id = h.vinculo_trabalho_id
       LEFT JOIN usuario u ON u.id = h.usuario_id
      WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL
        AND h.vinculo_trabalho_id IN (${vinculos.map(() => '?').join(', ')})
        AND NOT EXISTS (SELECT 1 FROM historico_salarial h2
                         WHERE h2.vinculo_trabalho_id = h.vinculo_trabalho_id AND h2.data_vigencia = h.data_vigencia
                           AND (h2.ocorrido_em > h.ocorrido_em OR (h2.ocorrido_em = h.ocorrido_em AND h2.id > h.id)))
      ORDER BY h.vinculo_trabalho_id, h.data_vigencia`,
    [est, ...vinculos],
  );
  return rs
    .filter((r) => r['operacao'] !== 'exclusao')
    .map((r) => {
      const insalubridade = insalubridadeDoGrau(GRAUS[n(r['grau'])] ?? null);
      // Os adicionais não se acumulam (CLT art. 193, § 2º): com os dois, vale a escolha; sem ela, a periculosidade.
      const periculosidade = n(r['periculosidade']) === 1 && r['adicional_escolhido'] !== 'insalubridade';
      const justificativa = json<{ justificativa?: unknown }>(r['dados'], {}).justificativa;
      return {
        id: n(r['id']),
        vinculo: n(r['vinculo_trabalho_id']),
        inicio: diaObrigatorio(r['data_vigencia']),
        salario: n(r['valor_salario']),
        insalubridade: periculosidade ? 0 : insalubridade,
        periculosidade,
        motivo: typeof justificativa === 'string' ? justificativa : texto(r['motivo']),
        registradoPor: texto(r['login']),
        registradoEm: instante(r['ocorrido_em']),
      };
    });
}

const pendente = (operacao: string, falta: string) => () =>
  Promise.reject(erroModeloPendente(operacao, falta));

export class PortaCalculoFolhaPropria implements PortaCalculoFolha {
  readonly destino = 'banco' as const;

  private executor: ReturnType<NucleoCalculoFolha['criarExecutor']> | null = null;

  constructor(private readonly nucleo: NucleoCalculoFolha) {
    this.leituras = new LeiturasCalculoFolhaPropria(nucleo);
  }

  /** O gravador do cálculo sobre a transação de outra operação (efeitos do autoatendimento: as férias aprovadas). */
  gravadorNaTransacao(tx: TxOperacao, est: number): GravadorCalculoFolha {
    return gravadorCalculo(tx, est, this);
  }

  private ler<T>(c: ContextoCalculoFolha, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  // ── Gravação direta (o que depende do processamento recusa dentro do gravador, sem gravar nada) ─────────────

  async podeGravar(): Promise<LiberacaoGravacao> {
    return { pode: true, codigo: null, motivo: null };
  }

  async executar(): Promise<GravacaoFeita> {
    throw recusa('operacao-desconhecida', 'O cálculo da folha não usa operação de tela do executor.');
  }

  gravarSgh<T>(
    c: ContextoCalculoFolha,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorCalculoFolha) => Promise<T>,
  ): Promise<T> {
    if (c.estabelecimento === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    this.executor ??= this.nucleo.criarExecutor();
    return gravacaoDireta(this.executor, contextoDe(c), {
      nome: 'pessoas.calculo_folha.gravar',
      tabelas: [...TABELAS_CALCULO_FOLHA, ...TABELAS_FOLHA_EXECUTOR],
      trilha,
      gravador: (tx, est) => gravadorCalculo(tx, est, this),
      fn,
    });
  }

  /** O fechamento relido na transação da gravação. */
  async fechamentoNaTransacao(
    l: Pick<Leitor, 'uma'>,
    est: number,
    id: number,
  ): Promise<FechamentoDaFolha | null> {
    const r = await l.uma(`${SQL_FECHAMENTOS} AND f.id = ?`, [est, id]);
    return r ? fechamentoDe(r) : null;
  }

  parametros(c: ContextoCalculoFolha, empresa: number): Promise<ParametrosFolhaLidos[]> {
    return this.ler(c, async (l, est) =>
      empresa === est ? (await l.consultar(SQL_PARAMETROS, [est])).map(parametrosDe) : [],
    );
  }

  fechamentos(c: ContextoCalculoFolha, f: FiltroFechamentosDaFolha): Promise<FechamentoDaFolha[]> {
    return this.ler(c, async (l, est) => {
      if (f.empresa !== undefined && f.empresa !== est) return [];
      const filtros: string[] = [];
      const p: unknown[] = [est];
      if (f.apuracao !== undefined) {
        filtros.push('f.apuracao = ?');
        p.push(f.apuracao);
      }
      if (f.periodo !== undefined) {
        filtros.push('DATE_FORMAT(f.periodo_inicio, ?) = ?');
        p.push(f.periodo.length === 4 ? '%Y' : '%Y-%m', f.periodo);
      }
      if (f.ano !== undefined) {
        filtros.push('YEAR(f.periodo_inicio) = ?');
        p.push(Number(f.ano));
      }
      if (f.situacao !== undefined) {
        filtros.push('f.situacao = ?');
        p.push(f.situacao === 'reaberta' ? 'reaberto' : 'fechado');
      }
      const rs = await l.consultar(
        `${SQL_FECHAMENTOS}${filtros.map((x) => ` AND ${x}`).join('')}
          ORDER BY f.periodo_inicio DESC, f.apuracao, f.numero DESC LIMIT ${TETO_FECHAMENTOS_FOLHA}`,
        p,
      );
      return rs.map(fechamentoDe);
    });
  }

  fechamento(c: ContextoCalculoFolha, id: number): Promise<FechamentoDaFolha | null> {
    return this.ler(c, (l, est) => this.fechamentoNaTransacao(l, est, id));
  }

  // ── Leituras sobre o modelo ──────────────────────────────────────────────────────────────────────────────

  vinculos(c: ContextoCalculoFolha, inicio: string, fim: string): Promise<VinculoDoCalculo[]> {
    return this.ler(c, async (l, est) =>
      (await l.consultar(SQL_VINCULOS, [est, fim, inicio])).flatMap((r) => {
        const tipo = tipoDe(r);
        return tipo === null
          ? []
          : [
              {
                id: n(r['id']),
                matricula: textoOuNulo(r['matricula']),
                tipo,
                admissao: diaObrigatorio(r['data_admissao']),
                desligamento: dia(r['data_desligamento']),
                centroCusto: numOuNulo(r['centro_custo_id']),
                cargaSemanal: numOuNulo(r['carga_semanal_horas_padrao']),
              },
            ];
      }),
    );
  }

  dependentes(
    c: ContextoCalculoFolha,
    vinculos: readonly number[],
    data: string,
  ): Promise<Map<number, DependentesDoVinculo>> {
    if (vinculos.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT v.id,
                COALESCE(SUM(d.dependente_irrf), 0) AS irrf,
                COALESCE(SUM(d.dependente_salario_familia), 0) AS salario_familia
           FROM vinculo_trabalho v
           LEFT JOIN dependente d ON d.colaborador_id = v.colaborador_id AND d.excluido_em IS NULL
                AND d.data_inicio_dependencia <= ? AND (d.data_fim_dependencia IS NULL OR d.data_fim_dependencia >= ?)
          WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL AND v.id IN (${vinculos.map(() => '?').join(', ')})
          GROUP BY v.id`,
        [data, data, est, ...vinculos],
      );
      return new Map(
        rs.map((r) => [n(r['id']), { irrf: n(r['irrf']), salarioFamilia: n(r['salario_familia']) }]),
      );
    });
  }

  desligados(c: ContextoCalculoFolha, de: string, ate: string): Promise<VinculoDesligado[]> {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT v.id, v.matricula, v.regime_trabalhista, v.data_admissao, v.data_desligamento, v.tipo_rescisao_id,
                  ct.codigo_esocial AS categoria, ct.grupo AS grupo_categoria,
                  (SELECT r.id FROM rescisao r JOIN desligamento d ON d.id = r.desligamento_id
                    WHERE d.vinculo_trabalho_id = v.id AND d.excluido_em IS NULL AND r.excluido_em IS NULL
                      AND r.situacao IN ('calculada', 'conferida', 'paga', 'homologada')
                    ORDER BY r.numero_complementar DESC, r.id DESC LIMIT 1) AS rescisao_id
             FROM vinculo_trabalho v
             JOIN categoria_trabalhador ct ON ct.id = v.categoria_trabalhador_id
            WHERE v.estabelecimento_id = ? AND v.excluido_em IS NULL
              AND v.data_desligamento BETWEEN ? AND ?
            ORDER BY v.data_desligamento, v.id`,
          [est, de, ate],
        )
      ).flatMap((r) => {
        const tipo = tipoDe(r);
        return tipo === null
          ? []
          : [
              {
                vinculo: n(r['id']),
                matricula: textoOuNulo(r['matricula']),
                tipo,
                admissao: diaObrigatorio(r['data_admissao']),
                desligamento: diaObrigatorio(r['data_desligamento']),
                tipoRescisao: numOuNulo(r['tipo_rescisao_id']),
                rescisao: numOuNulo(r['rescisao_id']),
              },
            ];
      }),
    );
  }

  /**
   * Soma do FGTS das folhas de competência fechada do vínculo. Recusa quando algum mês do contrato, da admissão até a
   * última competência fechada do estabelecimento, não tem folha fechada (meses antes da virada, folha não calculada):
   * a soma sairia abaixo do saldo real e a multa rescisória, subcalculada. Mesmo completa, a soma não tem a correção (JAM)
   * da conta vinculada; o saldo informado do extrato é a base preferível.
   */
  fgtsDepositado(c: ContextoCalculoFolha, vinculo: number): Promise<number> {
    return this.ler(c, async (l, est) => {
      const v = await l.uma(
        'SELECT data_admissao, data_desligamento FROM vinculo_trabalho WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [vinculo, est],
      );
      if (!v) throw recusa('vinculo-inexistente', 'O vínculo não existe neste estabelecimento.');
      const ultima = await l.uma(
        `SELECT MAX(ano * 100 + mes) AS ultima FROM competencia_folha
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND situacao = 'fechada'`,
        [est],
      );
      const rs = await l.consultar(
        `SELECT cf.ano, cf.mes, SUM(COALESCE(f.valor_fgts, 0)) AS fgts
           FROM calculo_folha f
           JOIN competencia_folha cf ON cf.id = f.competencia_folha_id
          WHERE f.vinculo_trabalho_id = ? AND f.estabelecimento_id = ? AND f.excluido_em IS NULL
            AND f.situacao IN ('calculado', 'conferido', 'fechado')
            AND cf.excluido_em IS NULL AND cf.situacao = 'fechada'
          GROUP BY cf.ano, cf.mes`,
        [vinculo, est],
      );
      const cobertas = new Set(rs.map((r) => `${n(r['ano'])}-${doisDigitos(n(r['mes']))}`));
      const total = rs.reduce((t, r) => t + Math.round(n(r['fgts']) * 100), 0) / 100;
      const u = n(ultima?.['ultima']);
      if (u === 0) return total;
      let ate = `${Math.floor(u / 100)}-${doisDigitos(u % 100)}`;
      const deslig = dia(v['data_desligamento']);
      if (deslig !== null && deslig.slice(0, 7) < ate) ate = deslig.slice(0, 7);
      const faltam = competenciasDescobertas(diaObrigatorio(v['data_admissao']), ate, cobertas);
      if (faltam.length > 0)
        throw recusa(
          'saldo-fgts-incompleto',
          `O FGTS depositado não pode ser somado das folhas: ${faltam.length} competência(s) do contrato sem folha fechada (a primeira, ${faltam[0]}). Informe o saldo do extrato da conta vinculada.`,
        );
      return total;
    });
  }

  salarios(c: ContextoCalculoFolha, vinculos: readonly number[]): Promise<SalarioDoVinculo[]> {
    if (vinculos.length === 0) return Promise.resolve([]);
    return this.ler(c, (l, est) => lerSalarios(l, est, vinculos));
  }

  /**
   * Adiantamentos do 13º do ano por vínculo (1ª parcela e adiantamento nas férias, valor bruto, sem as canceladas). A
   * parcela é do colaborador: o vínculo sai do cálculo da folha da parcela e, sem ele (parcela vinda de outra origem), do
   * único vínculo do colaborador no estabelecimento naquele ano. Colaborador com mais de um vínculo e parcela sem cálculo
   * é recusado, para não abater o adiantamento no vínculo errado.
   */
  adiantamentosDecimo(
    c: ContextoCalculoFolha,
    empresa: number,
    ano: number,
    origens: readonly OrigemAdiantamentoDecimo[] = ['decimo1', 'ferias'],
  ): Promise<Map<number, number>> {
    const parcelas = origens.map((o) => (o === 'decimo1' ? 'primeira' : 'adiantamento_ferias'));
    if (parcelas.length === 0) return Promise.resolve(new Map());
    return this.ler(c, async (l, est) => {
      // A empresa da folha é o estabelecimento: outro estabelecimento não é visto desta sessão.
      if (empresa !== est) return new Map();
      const rs = await l.consultar(
        `SELECT p.id, p.valor_bruto, f.vinculo_trabalho_id AS do_calculo,
                (SELECT MIN(v.id) FROM vinculo_trabalho v
                  WHERE v.colaborador_id = p.colaborador_id AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
                    AND YEAR(v.data_admissao) <= p.ano_referencia
                    AND (v.data_desligamento IS NULL OR YEAR(v.data_desligamento) >= p.ano_referencia)) AS unico,
                (SELECT COUNT(*) FROM vinculo_trabalho v
                  WHERE v.colaborador_id = p.colaborador_id AND v.estabelecimento_id = ? AND v.excluido_em IS NULL
                    AND YEAR(v.data_admissao) <= p.ano_referencia
                    AND (v.data_desligamento IS NULL OR YEAR(v.data_desligamento) >= p.ano_referencia)) AS vinculos
           FROM parcela_decimo_terceiro p
           LEFT JOIN calculo_folha f ON f.id = p.calculo_folha_id AND f.excluido_em IS NULL
          WHERE p.ano_referencia = ? AND p.excluido_em IS NULL AND p.situacao <> 'cancelada'
            AND p.parcela IN (${parcelas.map(() => '?').join(', ')})
            AND (f.estabelecimento_id = ? OR (f.id IS NULL AND EXISTS (
                  SELECT 1 FROM vinculo_trabalho v WHERE v.colaborador_id = p.colaborador_id AND v.estabelecimento_id = ?
                     AND v.excluido_em IS NULL)))`,
        [est, est, ano, ...parcelas, est, est],
      );
      const out = new Map<number, number>();
      for (const r of rs) {
        let vinculo = numOuNulo(r['do_calculo']);
        if (vinculo === null) {
          if (n(r['vinculos']) !== 1)
            throw recusa(
              'adiantamento-sem-vinculo',
              `A parcela do 13º ${n(r['id'])} não tem cálculo da folha e o colaborador tem ${n(r['vinculos'])} vínculos no ano: não dá para saber de qual vínculo abater.`,
            );
          vinculo = n(r['unico']);
        }
        out.set(vinculo, Math.round(((out.get(vinculo) ?? 0) + n(r['valor_bruto'])) * 100) / 100);
      }
      return out;
    });
  }

  tiposRescisao(c: ContextoCalculoFolha): Promise<TipoRescisaoDaFolha[]> {
    // Catálogo da rede inteira (tipo_rescisao não tem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          'SELECT id, descricao, codigo_saque_fgts, codigo_causa_afastamento FROM tipo_rescisao WHERE ativo = TRUE ORDER BY descricao, id',
        )
      ).map((r) => {
        const causa = texto(r['codigo_causa_afastamento']);
        return {
          id: n(r['id']),
          nome: texto(r['descricao']),
          saque: textoOuNulo(r['codigo_saque_fgts']),
          causa: /^\d+$/.test(causa) ? Number(causa) : null,
        };
      }),
    );
  }

  // ── Leituras do processamento, das férias, das rescisões e dos parâmetros (folha-porta-propria-calculo.ts) ─────

  private readonly leituras: LeiturasCalculoFolhaPropria;

  processos(c: ContextoCalculoFolha, f: Parameters<PortaCalculoFolha['processos']>[1]) {
    return this.leituras.processos(c, f);
  }
  processo(c: ContextoCalculoFolha, id: number) {
    return this.leituras.processo(c, id);
  }
  resumoVinculos(c: ContextoCalculoFolha, processo: number) {
    return this.leituras.resumoVinculos(c, processo);
  }
  linhasDoVinculo(...a: Parameters<PortaCalculoFolha['linhasDoVinculo']>) {
    return this.leituras.linhasDoVinculo(...a);
  }
  processosDoVinculo(...a: Parameters<PortaCalculoFolha['processosDoVinculo']>) {
    return this.leituras.processosDoVinculo(...a);
  }
  historico(...a: Parameters<PortaCalculoFolha['historico']>) {
    return this.leituras.historico(...a);
  }
  ferias(...a: Parameters<PortaCalculoFolha['ferias']>) {
    return this.leituras.ferias(...a);
  }
  feriasPorId(c: ContextoCalculoFolha, id: number) {
    return this.leituras.feriasPorId(c, id);
  }
  feriasNaCompetencia(c: ContextoCalculoFolha, inicio: string, fim: string) {
    return this.leituras.feriasNaCompetencia(c, inicio, fim);
  }
  rescisoes(...a: Parameters<PortaCalculoFolha['rescisoes']>) {
    return this.leituras.rescisoes(...a);
  }
  rescisaoPorId(c: ContextoCalculoFolha, id: number) {
    return this.leituras.rescisaoPorId(c, id);
  }
  itensRubricaDoProcesso(c: ContextoCalculoFolha, processo: number) {
    return this.leituras.itensRubricaDoProcesso(c, processo);
  }
  parametrosObrigacoes(...a: Parameters<PortaCalculoFolha['parametrosObrigacoes']>) {
    return this.leituras.parametrosObrigacoes(...a);
  }

  // ── Leituras que aguardam o modelo (recusa explícita, nunca lista vazia) ────────────────────────────────────

  obrigacoes = pendente('Listar as obrigações geradas', FALTA.obrigacoes);
  obrigacao = pendente('Ler a obrigação gerada', FALTA.obrigacoes);
  conteudoObrigacao = pendente('Baixar o arquivo da obrigação', FALTA.obrigacoes);
  catalogosObrigacoes = pendente('Ler os códigos dos catálogos oficiais das obrigações', FALTA.obrigacoes);
}

export function portaCalculoFolhaIndisponivel(): PortaCalculoFolha {
  return portaIndisponivel<PortaCalculoFolha>(METODOS_PORTA_CALCULO_FOLHA);
}
