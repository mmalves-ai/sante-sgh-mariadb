// Porta própria das regras de franquia do plano e do contrato (08-SGO L98, C2-116) sobre o banco do cliente
// (regra_franquia_plano): o limite da janela de acúmulo, o percentual ou o fator do evento, o teto por guia, os dias
// de internação e a guia ambulatorial na internação. A validação é do domínio (franquia.ts: problemasDaFranquia,
// janelaDeAcumulo); o banco só guarda. Nada é apagado: a regra é encerrada pelo fim da vigência e o histórico fica.
// Cada gravação é uma operação do Executor (trilha na mesma transação). O escopo é a operadora ligada ao
// estabelecimento da sessão; fora dele, 404 sem dizer se existe. O acumulado da janela soma só os lançamentos válidos
// de franquia do beneficiário (tipo de lançamento da regra, ou o "franquia"; fatura cancelada e item excluído não
// contam).
import {
  janelaDeAcumulo,
  type PeriodoAcumulo,
  problemasDaFranquia,
  type RegraFranquia,
} from '@sgh/dominio-operadora';
import {
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  inteiro,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
} from './apoio-banco.js';

export const PORTA_REGRAS_FRANQUIA = Symbol('PORTA_REGRAS_FRANQUIA_OPERADORA');
export const TABELAS_REGRAS_FRANQUIA = ['regra_franquia_plano'] as const;

export type Gravado = { readonly id: number; readonly versao: number };
type Trilha = (r: Gravado) => RegistroTrilhaTela;

export interface RegraFranquiaCadastro {
  codigo: string;
  descricao: string;
  tipoFranquia: number;
  plano: number | null;
  contrato: number | null;
  grupo: number | null;
  regime: number | null;
  valor: number | null;
  percentual: number | null;
  fator: number | null;
  tetoPorGuia: number | null;
  periodoAcumulo: PeriodoAcumulo;
  diasInternacao: number | null;
  cobraGuiaAmbulatorialNaInternacao: boolean;
  inicio: string;
  fim: string | null;
}

export interface RegraFranquiaLida extends RegraFranquiaCadastro {
  id: number;
  versao: number;
  tipoFranquiaDescricao: string | null;
  grupoDescricao: string | null;
  regimeDescricao: string | null;
  vigente: boolean;
}
export interface Opcao {
  id: number;
  rotulo: string;
}
export interface OpcoesRegraFranquia {
  planos: Opcao[];
  contratos: Opcao[];
  tiposFranquia: Opcao[];
  grupos: Opcao[];
  regimes: Opcao[];
}
export interface AcumuladoFranquia {
  regra: number;
  janela: { inicio: string; fim: string };
  acumulado: number;
  restante: number | null;
}

const naoEncontrado = () =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    'O registro não existe neste estabelecimento.',
  );
const DETALHE: Record<string, string> = {
  'franquia-sem-valor': 'Informe o limite, o percentual ou o fator da franquia.',
  'franquia-limite-invalido': 'O limite da franquia deve ser maior que zero.',
  'franquia-percentual-invalido': 'O percentual deve estar entre 0 e 100.',
  'franquia-fator-invalido': 'O fator deve estar entre 0 e 1.',
  'franquia-percentual-ou-fator': 'Informe o percentual ou o fator, não os dois.',
  'franquia-teto-invalido': 'O teto por guia deve ser maior que zero.',
  'franquia-teto-acima-do-limite': 'O teto por guia não pode passar do limite da janela.',
  'franquia-periodo-invalido': 'Período de acúmulo inválido.',
  'franquia-dias-internacao-invalido': 'Os dias de internação devem ser um inteiro a partir de 1.',
  'franquia-inicio-invalido': 'Início da vigência inválido.',
  'franquia-fim-antes-do-inicio': 'O fim da vigência não pode ser antes do início.',
};
const CAMPO: Record<string, string> = {
  'franquia-sem-valor': 'valor',
  'franquia-limite-invalido': 'valor',
  'franquia-percentual-invalido': 'percentual',
  'franquia-fator-invalido': 'fator',
  'franquia-percentual-ou-fator': 'fator',
  'franquia-teto-invalido': 'tetoPorGuia',
  'franquia-teto-acima-do-limite': 'tetoPorGuia',
  'franquia-periodo-invalido': 'periodoAcumulo',
  'franquia-dias-internacao-invalido': 'diasInternacao',
  'franquia-inicio-invalido': 'inicio',
  'franquia-fim-antes-do-inicio': 'fim',
};
const regraDoDominio = (e: RegraFranquiaCadastro): RegraFranquia => ({
  valor: e.valor,
  percentual: e.percentual,
  fator: e.fator,
  tetoPorGuia: e.tetoPorGuia,
  periodoAcumulo: e.periodoAcumulo,
  diasInternacao: e.diasInternacao,
  cobraGuiaAmbulatorialNaInternacao: e.cobraGuiaAmbulatorialNaInternacao,
  inicio: e.inicio,
  fim: e.fim,
});
function exigir(problemas: readonly string[]): void {
  const p = problemas[0];
  if (p)
    throw recusa(p, DETALHE[p] ?? 'Regra de franquia inválida.', {
      campos: [...new Set(problemas.map((x) => CAMPO[x] ?? 'regra'))],
    });
}
const esquemaEntrada = z.record(z.string(), z.unknown());

const SELECT_REGRA = `SELECT r.id, r.versao, r.codigo, r.descricao, r.tipo_franquia_id, tf.descricao AS tipo_franquia_descricao,
       r.plano_comercializado_id, r.contrato_plano_id,
       r.grupo_procedimento_operadora_id, g.descricao AS grupo_descricao,
       r.regime_atendimento_rede_id, rg.descricao AS regime_descricao,
       r.percentual, r.valor, r.fator, r.teto_por_guia, r.periodo_acumulo, r.dias_internacao,
       r.cobra_guia_ambulatorial_na_internacao, r.tipo_lancamento_fatura_id, r.vigencia_inicio, r.vigencia_fim,
       (r.ativo = TRUE AND r.vigencia_inicio <= CURRENT_DATE AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= CURRENT_DATE)) AS vigente
  FROM regra_franquia_plano r
  JOIN tipo_franquia tf ON tf.id = r.tipo_franquia_id
  LEFT JOIN grupo_procedimento_operadora g ON g.id = r.grupo_procedimento_operadora_id
  LEFT JOIN regime_atendimento_rede rg ON rg.id = r.regime_atendimento_rede_id`;
const DO_ESTABELECIMENTO = `(r.contrato_plano_id IN (SELECT k.id FROM contrato_plano k WHERE k.estabelecimento_id = ?)
       OR r.plano_comercializado_id IN (SELECT p.id FROM plano_comercializado p WHERE p.estabelecimento_id = ?))`;

function regraLida(r: Record<string, unknown>): RegraFranquiaLida {
  return {
    id: Number(r['id']),
    versao: Number(r['versao']),
    codigo: textoObrigatorio(r['codigo']),
    descricao: textoObrigatorio(r['descricao']),
    tipoFranquia: Number(r['tipo_franquia_id']),
    tipoFranquiaDescricao: texto(r['tipo_franquia_descricao']),
    plano: inteiro(r['plano_comercializado_id']),
    contrato: inteiro(r['contrato_plano_id']),
    grupo: inteiro(r['grupo_procedimento_operadora_id']),
    grupoDescricao: texto(r['grupo_descricao']),
    regime: inteiro(r['regime_atendimento_rede_id']),
    regimeDescricao: texto(r['regime_descricao']),
    valor: numero(r['valor']),
    percentual: numero(r['percentual']),
    fator: numero(r['fator']),
    tetoPorGuia: numero(r['teto_por_guia']),
    periodoAcumulo: textoObrigatorio(r['periodo_acumulo']) as PeriodoAcumulo,
    diasInternacao: inteiro(r['dias_internacao']),
    cobraGuiaAmbulatorialNaInternacao: Number(r['cobra_guia_ambulatorial_na_internacao']) === 1,
    inicio: dataIso(r['vigencia_inicio']) ?? '',
    fim: dataIso(r['vigencia_fim']),
    vigente: Number(r['vigente']) === 1,
  };
}

export class PortaRegrasFranquiaPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora & Pick<NucleoProprio, 'escrever'>,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoPorta, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-franquia' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        return fn(l, est);
      },
    );
  }

  private async gravar(
    c: ContextoPorta,
    nome: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number) => Promise<Gravado>,
  ): Promise<Gravado> {
    const est = await this.ler(c, async (_l, e) => e);
    const operacao = definirOperacao<Record<string, unknown>, Gravado>({
      nome,
      tabelas: TABELAS_REGRAS_FRANQUIA,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: (tx) => fn(tx, est),
      alvo: (_e, r) => ({ tabela: 'regra_franquia_plano', id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const ctx = contextoDireto(this.cliente, est, c, null);
    const r = await this.executor.executar(operacao, this.cliente, {}, ctx);
    return r.resultado;
  }

  private static async operadoraDoEst(l: Leitor, est: number, op: number): Promise<void> {
    const r = await l.uma(
      'SELECT 1 AS ok FROM operadora_saude_estabelecimento WHERE operadora_saude_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [op, est],
    );
    if (!r) throw naoEncontrado();
  }

  /** Os planos e contratos do estabelecimento, os tipos de franquia e os critérios do escopo. */
  opcoes(c: ContextoPorta, op: number): Promise<OpcoesRegraFranquia> {
    return this.ler(c, async (l, est) => {
      await PortaRegrasFranquiaPropria.operadoraDoEst(l, est, op);
      const op_ = (rs: Record<string, unknown>[]) =>
        rs.map((r) => ({ id: Number(r['id']), rotulo: textoObrigatorio(r['rotulo']) }));
      const [planos, contratos, tiposFranquia, grupos, regimes] = await Promise.all([
        l.consultar(
          `SELECT id, CONCAT(codigo, ' — ', nome_comercial) AS rotulo FROM plano_comercializado
            WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY codigo`,
          [est],
          { teto: 500 },
        ),
        l.consultar(
          `SELECT id, numero AS rotulo FROM contrato_plano
            WHERE estabelecimento_id = ? AND operadora_saude_id = ? AND excluido_em IS NULL ORDER BY numero`,
          [est, op],
          { teto: 2000 },
        ),
        l.consultar(
          'SELECT id, descricao AS rotulo FROM tipo_franquia WHERE ativo = TRUE ORDER BY descricao',
          [],
          {
            teto: 200,
          },
        ),
        l.consultar(
          `SELECT id, CONCAT(codigo, ' — ', descricao) AS rotulo FROM grupo_procedimento_operadora
            WHERE ativo = TRUE ORDER BY codigo`,
          [],
          { teto: 2000 },
        ),
        l.consultar(
          'SELECT id, descricao AS rotulo FROM regime_atendimento_rede WHERE ativo = TRUE ORDER BY descricao',
          [],
          { teto: 200 },
        ),
      ]);
      return {
        planos: op_(planos),
        contratos: op_(contratos),
        tiposFranquia: op_(tiposFranquia),
        grupos: op_(grupos),
        regimes: op_(regimes),
      };
    });
  }

  /** As regras do plano ou do contrato, vigentes e encerradas (o histórico fica à vista). */
  regras(
    c: ContextoPorta,
    op: number,
    alvo: { plano: number | null; contrato: number | null },
  ): Promise<RegraFranquiaLida[]> {
    return this.ler(c, async (l, est) => {
      await PortaRegrasFranquiaPropria.operadoraDoEst(l, est, op);
      const rs = await l.consultar(
        `${SELECT_REGRA}
          WHERE r.operadora_saude_id = ? AND ${DO_ESTABELECIMENTO}
            AND (? IS NULL OR r.plano_comercializado_id = ?) AND (? IS NULL OR r.contrato_plano_id = ?)
          ORDER BY r.vigencia_fim IS NOT NULL, r.vigencia_inicio DESC, r.id DESC`,
        [op, est, est, alvo.plano, alvo.plano, alvo.contrato, alvo.contrato],
        { teto: 500 },
      );
      return rs.map(regraLida);
    });
  }

  /** Inclui a regra: valores pelo domínio, escopo plano ou contrato (um só), referências e sobreposição conferidas. */
  async incluir(c: ContextoPorta, op: number, e: RegraFranquiaCadastro, trilha: Trilha): Promise<Gravado> {
    exigir(problemasDaFranquia(regraDoDominio(e)));
    if ((e.plano === null) === (e.contrato === null))
      throw recusa('escopo-invalido', 'A regra é do plano ou do contrato: escolha um dos dois.', {
        campos: ['plano', 'contrato'],
      });
    return this.gravar(c, 'operadora.franquia.regra.incluir', trilha, async (tx, est) => {
      await PortaRegrasFranquiaPropria.operadoraDoEst(tx, est, op);
      const existe = async (sql: string, id: number | null, campo: string, extra: unknown[] = []) => {
        if (id === null) return;
        if (!(await tx.uma(sql, [id, ...extra])))
          throw recusa('referencia-inexistente', 'O item escolhido não existe neste estabelecimento.', {
            campos: [campo],
          });
      };
      await existe(
        'SELECT 1 AS ok FROM tipo_franquia WHERE id = ? AND ativo = TRUE',
        e.tipoFranquia,
        'tipoFranquia',
      );
      await existe(
        'SELECT 1 AS ok FROM plano_comercializado WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        e.plano,
        'plano',
        [est],
      );
      await existe(
        'SELECT 1 AS ok FROM contrato_plano WHERE id = ? AND estabelecimento_id = ? AND operadora_saude_id = ? AND excluido_em IS NULL',
        e.contrato,
        'contrato',
        [est, op],
      );
      await existe('SELECT 1 AS ok FROM grupo_procedimento_operadora WHERE id = ?', e.grupo, 'grupo');
      await existe('SELECT 1 AS ok FROM regime_atendimento_rede WHERE id = ?', e.regime, 'regime');
      // Duas regras do mesmo escopo com vigência sobreposta deixariam a franquia ambígua: recusa.
      const sobreposta = await tx.consultarParaAtualizar(
        `SELECT id FROM regra_franquia_plano
          WHERE operadora_saude_id = ? AND ativo = TRUE
            AND plano_comercializado_id <=> ? AND contrato_plano_id <=> ?
            AND grupo_procedimento_operadora_id <=> ? AND regime_atendimento_rede_id <=> ?
            AND (vigencia_fim IS NULL OR vigencia_fim >= ?) AND (? IS NULL OR vigencia_inicio <= ?)`,
        [op, e.plano, e.contrato, e.grupo, e.regime, e.inicio, e.fim, e.fim],
        { teto: 1 },
      );
      if (sobreposta.length)
        throw recusa(
          'regra-sobreposta',
          'Já existe franquia deste escopo vigente no período; encerre a anterior antes do início da nova.',
          { campos: ['inicio'] },
        );
      const dupl = await tx.uma(
        'SELECT 1 AS ok FROM regra_franquia_plano WHERE operadora_saude_id = ? AND codigo = ?',
        [op, e.codigo.trim()],
      );
      if (dupl)
        throw recusa('codigo-em-uso', 'Já existe regra de franquia com este código na operadora.', {
          campos: ['codigo'],
        });
      const id = await tx.incluir('regra_franquia_plano', {
        operadora_saude_id: op,
        codigo: e.codigo.trim(),
        descricao: e.descricao.trim(),
        tipo_franquia_id: e.tipoFranquia,
        plano_comercializado_id: e.plano,
        contrato_plano_id: e.contrato,
        grupo_procedimento_operadora_id: e.grupo,
        regime_atendimento_rede_id: e.regime,
        percentual: e.percentual,
        valor: e.valor,
        fator: e.fator,
        teto_por_guia: e.tetoPorGuia,
        periodo_acumulo: e.periodoAcumulo,
        dias_internacao: e.diasInternacao,
        cobra_guia_ambulatorial_na_internacao: e.cobraGuiaAmbulatorialNaInternacao,
        vigencia_inicio: e.inicio,
        vigencia_fim: e.fim,
        ativo: true,
      });
      return { id, versao: 1 };
    });
  }

  /** Encerra a regra na data (fim da vigência); a linha fica para o histórico. */
  encerrar(
    c: ContextoPorta,
    id: number,
    x: { versao: number; fim: string },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(c, 'operadora.franquia.regra.encerrar', trilha, async (tx, est) => {
      const [r] = await tx.consultarParaAtualizar(
        `SELECT r.id, r.vigencia_inicio, r.vigencia_fim FROM regra_franquia_plano r
          WHERE r.id = ? AND ${DO_ESTABELECIMENTO}`,
        [id, est, est],
        { teto: 1 },
      );
      if (!r) throw naoEncontrado();
      const inicio = dataIso(r['vigencia_inicio']) ?? '';
      const fimAtual = dataIso(r['vigencia_fim']);
      if (x.fim < inicio)
        throw recusa('fim-antes-do-inicio', 'O fim da vigência não pode ser antes do início.', {
          campos: ['fim'],
        });
      if (fimAtual !== null && x.fim > fimAtual)
        throw recusa('fim-depois-do-atual', 'A regra já termina antes desta data.', { campos: ['fim'] });
      const versao = await tx.alterar('regra_franquia_plano', id, x.versao, { vigencia_fim: x.fim });
      return { id, versao };
    });
  }

  /**
   * O acumulado de franquia do beneficiário na janela da regra que contém a data (janelaDeAcumulo do domínio), só dos
   * lançamentos válidos, e o que resta até o limite. Na janela por evento o acumulado é sempre zero.
   */
  acumulado(
    c: ContextoPorta,
    regraId: number,
    beneficiario: number,
    dataEvento: string,
  ): Promise<AcumuladoFranquia> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SELECT_REGRA} WHERE r.id = ? AND ${DO_ESTABELECIMENTO}`, [regraId, est, est]);
      if (!r) throw naoEncontrado();
      const regra = regraLida(r);
      const b = await l.uma(
        `SELECT k.inicio_vigencia AS inicio, k.fim_vigencia AS fim FROM beneficiario_plano b
           JOIN contrato_plano k ON k.id = b.contrato_plano_id
          WHERE b.id = ? AND k.estabelecimento_id = ? AND b.excluido_em IS NULL`,
        [beneficiario, est],
      );
      if (!b) throw naoEncontrado();
      const janela = janelaDeAcumulo(regra.periodoAcumulo, dataEvento, {
        inicio: dataIso(b['inicio']) ?? dataEvento,
        fim: dataIso(b['fim']),
      });
      let acumulado = 0;
      if (regra.periodoAcumulo !== 'evento') {
        const porDia = regra.periodoAcumulo === 'dia';
        const s = await l.uma(
          `SELECT COALESCE(SUM(i.valor), 0) AS total
             FROM fatura_plano_item i
             JOIN fatura_plano f ON f.id = i.fatura_plano_id
            WHERE i.beneficiario_plano_id = ? AND f.estabelecimento_id = ?
              AND f.situacao <> 'cancelada' AND f.excluido_em IS NULL AND i.excluido_em IS NULL
              AND i.natureza = 'debito'
              AND (i.tipo_lancamento_fatura_id = ?
                   OR (? IS NULL AND i.tipo_lancamento_fatura_id IN (SELECT t.id FROM tipo_lancamento_fatura t WHERE t.codigo = 'franquia')))
              AND ${porDia ? 'DATE(i.criado_em)' : 'COALESCE(i.competencia_referencia, f.competencia)'} BETWEEN ? AND ?`,
          [
            beneficiario,
            est,
            inteiro(r['tipo_lancamento_fatura_id']),
            inteiro(r['tipo_lancamento_fatura_id']),
            porDia ? janela.inicio : `${janela.inicio.slice(0, 7)}-01`,
            janela.fim,
          ],
        );
        acumulado = numero(s?.['total']) ?? 0;
      }
      const restante =
        regra.valor === null ? null : Math.round(Math.max(0, regra.valor - acumulado) * 100) / 100;
      return { regra: regra.id, janela, acumulado, restante };
    });
  }
}

export const METODOS_REGRAS_FRANQUIA: ReadonlySet<string> = new Set([
  'opcoes',
  'regras',
  'incluir',
  'encerrar',
  'acumulado',
]);
