// Porta do cálculo da folha sobre o MariaDB do cliente (M53.3 a M53.8), pelo @sgh/nucleo. Leituras numa transação curta
// somente leitura, filtradas pelo estabelecimento da sessão.
// Tabelas lidas: vinculo_trabalho, categoria_trabalhador, colaborador, cargo, dependente, historico_salarial, risco_funcao,
// usuario, tipo_rescisao, desligamento, rescisao, competencia_folha, calculo_folha e parcela_decimo_terceiro.
// O processamento da folha (totais, tabela legal e parâmetros usados, linhas por papel do cálculo) não tem registro no
// modelo: competencia_folha e calculo_folha guardam o resultado por rubrica, sem o processamento nem o papel da linha. As
// leituras que devolvem o processamento, ou registros que o exigem (férias, rescisão e obrigação ligadas a ele, o
// fechamento do período), recusam com `modelo-pendente`, e a gravação fica desligada (`podeGravar` diz o motivo) até o
// DDL pedido em docs/obra/fatias/f22/saida/03-06.json, que lista só as colunas e tabelas que faltam.
// Melhoria: o tipo do vínculo sai da categoria do trabalhador (901 estagiário, 902 residente) e do regime, pela regra pura
// `tipoVinculoDaFolha`; categoria fora da folha de empregados não entra (antes, todo vínculo saía como CLT).
// Melhoria: o FGTS depositado só é somado das folhas de competência fechada quando todo mês do contrato tem folha; se
// falta algum (por exemplo, os meses antes da virada), recusa e pede o saldo do extrato da conta vinculada. A soma não
// inclui a correção (JAM) da conta: o saldo do extrato é sempre a base preferível da multa.
// Melhoria: o adicional de insalubridade e de periculosidade da vigência do salário vem do risco da função (risco_funcao,
// laudo do SESMT) em vigor no início da vigência, em vez de digitado à parte.
// Melhoria: a carga semanal vem do cargo; sem ela, null (antes, um valor fixo).
import { type ContextoNucleo, ErroOperacao, type Leitor, type NucleoProprio, recusa } from '@sgh/nucleo';
import {
  type ContextoPortaM18,
  type GravacaoFeita,
  type LiberacaoGravacao,
  portaIndisponivel,
} from '../../exames/public-api.js';
import {
  type ContextoCalculoFolha,
  METODOS_PORTA_CALCULO_FOLHA,
  type PortaCalculoFolha,
} from './porta-calculo.js';
import {
  competenciasDescobertas,
  type DependentesDoVinculo,
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

export type NucleoCalculoFolha = Pick<NucleoProprio, 'lerSomente'>;

const FALTA = {
  processo:
    'o processamento da folha (totais, tabela legal e parâmetros usados) e as linhas por papel do cálculo',
  parametros: 'os parâmetros da folha por vigência',
  ferias:
    'o vínculo, a dobra e o pagamento previsto na programação de férias e o processamento da folha no recibo (programacao_ferias e recibo_ferias existem sem eles)',
  feriasCompetencia: 'o processamento da folha e a base do INSS no recibo de férias',
  rescisao:
    'o processamento da folha, a modalidade, os dias indenizados e a origem do saldo do FGTS na rescisão (rescisao e desligamento existem sem eles)',
  fechamento: 'o fechamento do período da folha',
  obrigacoes:
    'o leiaute, os totais, os fechamentos usados, o nome e o conteúdo cifrado do arquivo e os acréscimos da guia na obrigação (obrigacao_trabalhista e arquivo_obrigacao existem sem eles), os parâmetros das obrigações e os códigos SEFIP, CAGED e RAIS dos catálogos',
} as const;

const pendente = (operacao: string, falta: string) => () =>
  Promise.reject(erroModeloPendente(operacao, falta));

export class PortaCalculoFolhaPropria implements PortaCalculoFolha {
  readonly destino = 'banco' as const;

  constructor(private readonly nucleo: NucleoCalculoFolha) {}

  private ler<T>(c: ContextoCalculoFolha, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  // ── Gravação: desligada até o modelo ter o processamento da folha ─────────────────────────────────────────

  async podeGravar(): Promise<LiberacaoGravacao> {
    return {
      pode: false,
      codigo: 'modelo-pendente',
      motivo: `O cálculo da folha não grava: o modelo do banco ainda não tem ${FALTA.processo}.`,
    };
  }

  async executar(): Promise<GravacaoFeita> {
    throw erroModeloPendente('Gravar o cálculo da folha', FALTA.processo);
  }

  async gravarSgh<T>(): Promise<T> {
    throw erroModeloPendente('Gravar o cálculo da folha', FALTA.processo);
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

  /**
   * Vigências do salário do vínculo (historico_salarial: a última operação de cada data de vigência, sem as excluídas).
   * O adicional é o do risco da função do vínculo (risco_funcao) em vigor no início da vigência: o maior grau de
   * insalubridade dos ambientes da função e a periculosidade. Vínculo sem função ou função sem risco: sem adicional.
   */
  salarios(c: ContextoCalculoFolha, vinculos: readonly number[]): Promise<SalarioDoVinculo[]> {
    if (vinculos.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) => {
      const rs = await l.consultar(
        `SELECT h.id, h.vinculo_trabalho_id, h.data_vigencia, h.valor_salario, h.motivo, h.operacao, h.ocorrido_em,
                u.login,
                (SELECT MAX(CASE rf.grau_insalubridade WHEN 'maximo' THEN 3 WHEN 'medio' THEN 2 WHEN 'minimo' THEN 1 ELSE 0 END)
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
      const GRAUS = ['nenhum', 'minimo', 'medio', 'maximo'] as const;
      return rs
        .filter((r) => r['operacao'] !== 'exclusao')
        .map((r) => {
          const periculosidade = n(r['periculosidade']) === 1;
          return {
            id: n(r['id']),
            vinculo: n(r['vinculo_trabalho_id']),
            inicio: diaObrigatorio(r['data_vigencia']),
            salario: n(r['valor_salario']),
            // Os adicionais não se acumulam (CLT art. 193, § 2º): com periculosidade, a insalubridade sai zerada.
            insalubridade: periculosidade ? 0 : insalubridadeDoGrau(GRAUS[n(r['grau'])] ?? null),
            periculosidade,
            motivo: texto(r['motivo']),
            registradoPor: texto(r['login']),
            registradoEm: instante(r['ocorrido_em']),
          };
        });
    });
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

  // ── Leituras que aguardam o modelo (recusa explícita, nunca lista vazia) ────────────────────────────────────

  parametros = pendente('Ler os parâmetros da folha', FALTA.parametros);
  processos = pendente('Listar os processamentos da folha', FALTA.processo);
  processo = pendente('Ler o processamento da folha', FALTA.processo);
  resumoVinculos = pendente('Ler o resumo por vínculo do processamento', FALTA.processo);
  linhasDoVinculo = pendente('Ler as linhas do cálculo do vínculo', FALTA.processo);
  processosDoVinculo = pendente('Listar os processamentos que pagaram o vínculo', FALTA.processo);
  historico = pendente('Ler o histórico das folhas do vínculo', FALTA.processo);
  ferias = pendente('Listar as férias', FALTA.ferias);
  feriasPorId = pendente('Ler as férias', FALTA.ferias);
  feriasNaCompetencia = pendente('Ler as férias com recibo na competência', FALTA.feriasCompetencia);
  rescisoes = pendente('Listar as rescisões', FALTA.rescisao);
  rescisaoPorId = pendente('Ler a rescisão', FALTA.rescisao);
  fechamentos = pendente('Listar os fechamentos do período', FALTA.fechamento);
  fechamento = pendente('Ler o fechamento do período', FALTA.fechamento);
  itensRubricaDoProcesso = pendente('Ler os itens por rubrica do processamento', FALTA.processo);
  parametrosObrigacoes = pendente('Ler os parâmetros das obrigações', FALTA.obrigacoes);
  obrigacoes = pendente('Listar as obrigações geradas', FALTA.obrigacoes);
  obrigacao = pendente('Ler a obrigação gerada', FALTA.obrigacoes);
  conteudoObrigacao = pendente('Baixar o arquivo da obrigação', FALTA.obrigacoes);
  catalogosObrigacoes = pendente('Ler os códigos dos catálogos oficiais das obrigações', FALTA.obrigacoes);
}

export function portaCalculoFolhaIndisponivel(): PortaCalculoFolha {
  return portaIndisponivel<PortaCalculoFolha>(METODOS_PORTA_CALCULO_FOLHA);
}
