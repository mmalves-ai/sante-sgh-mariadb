// Porta própria das regras de coparticipação do plano e do contrato (08-SGO L98, C2-116) sobre o banco do cliente
// (regra_coparticipacao): a regra geral e as restritas a tipo de guia, grupo de procedimentos, procedimento e regime de
// atendimento, com os tetos por evento, mês e ano. A validação é do domínio (regra-coparticipacao.ts); o banco só
// guarda. Nada é apagado: a regra é encerrada pelo fim da vigência e o histórico fica para o lançamento de competência
// passada. Cada gravação é uma operação do Executor (trilha na mesma transação). O escopo é a operadora ligada ao
// estabelecimento da sessão; fora dele, 404 sem dizer se existe.
import {
  problemasDaRegraCoparticipacao,
  problemasDoEncerramento,
  type ProblemaRegraCoparticipacao,
  type RegraCoparticipacaoCadastro,
  type TipoCoparticipacao,
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
  inicioLike,
  inteiro,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
  trechoLike,
} from './apoio-banco.js';

export const PORTA_REGRAS_COPARTICIPACAO = Symbol('PORTA_REGRAS_COPARTICIPACAO_OPERADORA');
export const TABELAS_REGRAS_COPARTICIPACAO = ['regra_coparticipacao'] as const;

export type Gravado = { readonly id: number; readonly versao: number };
type Trilha = (r: Gravado) => RegistroTrilhaTela;

export interface RegraCoparticipacaoLida {
  id: number;
  versao: number;
  codigo: string;
  descricao: string;
  plano: number | null;
  contrato: number | null;
  tipo: TipoCoparticipacao;
  valor: number | null;
  tetoEvento: number | null;
  tetoMensal: number | null;
  tetoAnual: number | null;
  procedimento: number | null;
  procedimentoDescricao: string | null;
  grupo: number | null;
  grupoDescricao: string | null;
  tipoGuia: number | null;
  tipoGuiaDescricao: string | null;
  regime: number | null;
  regimeDescricao: string | null;
  inicio: string;
  fim: string | null;
  vigente: boolean;
}
export interface Opcao {
  id: number;
  rotulo: string;
}
export interface OpcoesRegraCoparticipacao {
  planos: Opcao[];
  contratos: Opcao[];
  tiposGuia: Opcao[];
  grupos: Opcao[];
  regimes: Opcao[];
}

const naoEncontrado = () =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    'O registro não existe neste estabelecimento.',
  );
function exigir(problemas: readonly ProblemaRegraCoparticipacao[]): void {
  const p = problemas[0];
  if (p) throw recusa(p.codigo, p.detalhe, { campos: [...new Set(problemas.map((x) => x.campo))] });
}
const esquemaEntrada = z.record(z.string(), z.unknown());

const SELECT_REGRA = `SELECT r.id, r.versao, r.codigo, r.descricao, r.plano_comercializado_id, r.contrato_plano_id,
       r.tipo_coparticipacao, r.percentual, r.valor, r.teto_por_evento, r.teto_mensal, r.teto_anual,
       r.item_faturavel_id, i.descricao AS procedimento_descricao,
       r.grupo_procedimento_operadora_id, g.descricao AS grupo_descricao,
       r.tipo_guia_plano_id, t.descricao AS tipo_guia_descricao,
       r.regime_atendimento_rede_id, rg.descricao AS regime_descricao,
       r.vigencia_inicio, r.vigencia_fim,
       (r.ativo = TRUE AND r.vigencia_inicio <= CURRENT_DATE AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= CURRENT_DATE)) AS vigente
  FROM regra_coparticipacao r
  LEFT JOIN item_faturavel i ON i.id = r.item_faturavel_id
  LEFT JOIN grupo_procedimento_operadora g ON g.id = r.grupo_procedimento_operadora_id
  LEFT JOIN tipo_guia_plano t ON t.id = r.tipo_guia_plano_id
  LEFT JOIN regime_atendimento_rede rg ON rg.id = r.regime_atendimento_rede_id`;

function regraLida(r: Record<string, unknown>): RegraCoparticipacaoLida {
  const tipo = textoObrigatorio(r['tipo_coparticipacao']) as TipoCoparticipacao;
  return {
    id: Number(r['id']),
    versao: Number(r['versao']),
    codigo: textoObrigatorio(r['codigo']),
    descricao: textoObrigatorio(r['descricao']),
    plano: inteiro(r['plano_comercializado_id']),
    contrato: inteiro(r['contrato_plano_id']),
    tipo,
    valor:
      tipo === 'percentual' ? numero(r['percentual']) : tipo === 'valor_fixo' ? numero(r['valor']) : null,
    tetoEvento: numero(r['teto_por_evento']),
    tetoMensal: numero(r['teto_mensal']),
    tetoAnual: numero(r['teto_anual']),
    procedimento: inteiro(r['item_faturavel_id']),
    procedimentoDescricao: texto(r['procedimento_descricao']),
    grupo: inteiro(r['grupo_procedimento_operadora_id']),
    grupoDescricao: texto(r['grupo_descricao']),
    tipoGuia: inteiro(r['tipo_guia_plano_id']),
    tipoGuiaDescricao: texto(r['tipo_guia_descricao']),
    regime: inteiro(r['regime_atendimento_rede_id']),
    regimeDescricao: texto(r['regime_descricao']),
    inicio: dataIso(r['vigencia_inicio']) ?? '',
    fim: dataIso(r['vigencia_fim']),
    vigente: Number(r['vigente']) === 1,
  };
}

export class PortaRegrasCoparticipacaoPropria {
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
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-coparticipacao' },
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
      tabelas: TABELAS_REGRAS_COPARTICIPACAO,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: (tx) => fn(tx, est),
      alvo: (_e, r) => ({ tabela: 'regra_coparticipacao', id: r.id }),
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

  /** Os planos e contratos do estabelecimento e os critérios do escopo (para a tela montar as listas). */
  opcoes(c: ContextoPorta, op: number): Promise<OpcoesRegraCoparticipacao> {
    return this.ler(c, async (l, est) => {
      await PortaRegrasCoparticipacaoPropria.operadoraDoEst(l, est, op);
      const op_ = (rs: Record<string, unknown>[]) =>
        rs.map((r) => ({ id: Number(r['id']), rotulo: textoObrigatorio(r['rotulo']) }));
      const [planos, contratos, tiposGuia, grupos, regimes] = await Promise.all([
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
          'SELECT id, descricao AS rotulo FROM tipo_guia_plano WHERE ativo = TRUE ORDER BY descricao',
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
        tiposGuia: op_(tiposGuia),
        grupos: op_(grupos),
        regimes: op_(regimes),
      };
    });
  }

  /** Procedimentos para a regra específica (código no começo ou trecho da descrição). */
  procedimentos(c: ContextoPorta, busca: string): Promise<Opcao[]> {
    const t = busca.trim();
    if (t.length < 2) return Promise.resolve([]);
    return this.ler(c, async (l) => {
      const rs = await l.consultar(
        `SELECT id, CONCAT(codigo, ' — ', descricao) AS rotulo FROM item_faturavel
          WHERE excluido_em IS NULL AND (codigo LIKE ? OR descricao LIKE ?) ORDER BY codigo LIMIT 20`,
        [inicioLike(t), trechoLike(t)],
        { teto: 20 },
      );
      return rs.map((r) => ({ id: Number(r['id']), rotulo: textoObrigatorio(r['rotulo']) }));
    });
  }

  /** As regras do plano ou do contrato, vigentes e encerradas (o histórico fica à vista). */
  regras(
    c: ContextoPorta,
    op: number,
    alvo: { plano: number | null; contrato: number | null },
  ): Promise<RegraCoparticipacaoLida[]> {
    return this.ler(c, async (l, est) => {
      await PortaRegrasCoparticipacaoPropria.operadoraDoEst(l, est, op);
      const rs = await l.consultar(
        `${SELECT_REGRA}
          WHERE r.operadora_saude_id = ?
            AND (r.contrato_plano_id IN (SELECT k.id FROM contrato_plano k WHERE k.estabelecimento_id = ?)
                 OR r.plano_comercializado_id IN (SELECT p.id FROM plano_comercializado p WHERE p.estabelecimento_id = ?))
            AND (? IS NULL OR r.plano_comercializado_id = ?) AND (? IS NULL OR r.contrato_plano_id = ?)
          ORDER BY r.vigencia_fim IS NOT NULL, r.vigencia_inicio DESC, r.id DESC`,
        [op, est, est, alvo.plano, alvo.plano, alvo.contrato, alvo.contrato],
        { teto: 500 },
      );
      return rs.map(regraLida);
    });
  }

  /** Inclui a regra; os tetos e o escopo validados pelo domínio, as referências conferidas no estabelecimento. */
  async incluir(
    c: ContextoPorta,
    op: number,
    e: RegraCoparticipacaoCadastro,
    trilha: Trilha,
  ): Promise<Gravado> {
    exigir(problemasDaRegraCoparticipacao(e));
    return this.gravar(c, 'operadora.coparticipacao.regra.incluir', trilha, async (tx, est) => {
      await PortaRegrasCoparticipacaoPropria.operadoraDoEst(tx, est, op);
      const existe = async (sql: string, id: number | null, campo: string, extra: unknown[] = []) => {
        if (id === null) return;
        if (!(await tx.uma(sql, [id, ...extra])))
          throw recusa('referencia-inexistente', 'O item escolhido não existe neste estabelecimento.', {
            campos: [campo],
          });
      };
      await existe(
        'SELECT 1 AS ok FROM plano_comercializado WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        e.plano,
        'plano',
        [est],
      );
      if (e.contrato !== null) {
        const k = await tx.uma(
          'SELECT 1 AS ok FROM contrato_plano WHERE id = ? AND estabelecimento_id = ? AND operadora_saude_id = ? AND excluido_em IS NULL',
          [e.contrato, est, op],
        );
        if (!k)
          throw recusa('referencia-inexistente', 'O contrato não é desta operadora.', {
            campos: ['contrato'],
          });
      }
      await existe('SELECT 1 AS ok FROM tipo_guia_plano WHERE id = ?', e.tipoGuia, 'tipoGuia');
      await existe('SELECT 1 AS ok FROM grupo_procedimento_operadora WHERE id = ?', e.grupo, 'grupo');
      await existe('SELECT 1 AS ok FROM regime_atendimento_rede WHERE id = ?', e.regime, 'regime');
      await existe(
        'SELECT 1 AS ok FROM item_faturavel WHERE id = ? AND excluido_em IS NULL',
        e.procedimento,
        'procedimento',
      );
      // Duas regras do mesmo escopo com vigência sobreposta deixariam a escolha ambígua: recusa (a anterior se encerra).
      const sobreposta = await tx.consultarParaAtualizar(
        `SELECT id FROM regra_coparticipacao
          WHERE operadora_saude_id = ? AND ativo = TRUE
            AND plano_comercializado_id <=> ? AND contrato_plano_id <=> ? AND item_faturavel_id <=> ?
            AND grupo_procedimento_operadora_id <=> ? AND tipo_guia_plano_id <=> ? AND regime_atendimento_rede_id <=> ?
            AND (vigencia_fim IS NULL OR vigencia_fim >= ?) AND (? IS NULL OR vigencia_inicio <= ?)`,
        [op, e.plano, e.contrato, e.procedimento, e.grupo, e.tipoGuia, e.regime, e.inicio, e.fim, e.fim],
        { teto: 1 },
      );
      if (sobreposta.length)
        throw recusa(
          'regra-sobreposta',
          'Já existe regra deste escopo vigente no período; encerre a anterior antes do início da nova.',
          { campos: ['inicio'] },
        );
      const dupl = await tx.uma(
        'SELECT 1 AS ok FROM regra_coparticipacao WHERE operadora_saude_id = ? AND codigo = ?',
        [op, e.codigo.trim()],
      );
      if (dupl)
        throw recusa('codigo-em-uso', 'Já existe regra com este código na operadora.', {
          campos: ['codigo'],
        });
      const id = await tx.incluir('regra_coparticipacao', {
        operadora_saude_id: op,
        codigo: e.codigo.trim(),
        descricao: e.descricao.trim(),
        plano_comercializado_id: e.plano,
        contrato_plano_id: e.contrato,
        grupo_procedimento_operadora_id: e.grupo,
        item_faturavel_id: e.procedimento,
        tipo_guia_plano_id: e.tipoGuia,
        regime_atendimento_rede_id: e.regime,
        tipo_coparticipacao: e.tipo,
        percentual: e.tipo === 'percentual' ? e.valor : null,
        valor: e.tipo === 'valor_fixo' ? e.valor : null,
        teto_por_evento: e.tetoEvento,
        teto_mensal: e.tetoMensal,
        teto_anual: e.tetoAnual,
        vigencia_inicio: e.inicio,
        vigencia_fim: e.fim,
        ativo: true,
      });
      return { id, versao: 1 };
    });
  }

  /** Encerra a regra na data (fim da vigência); a linha fica para o histórico e para competências passadas. */
  encerrar(
    c: ContextoPorta,
    id: number,
    x: { versao: number; fim: string },
    trilha: Trilha,
  ): Promise<Gravado> {
    return this.gravar(c, 'operadora.coparticipacao.regra.encerrar', trilha, async (tx, est) => {
      const [r] = await tx.consultarParaAtualizar(
        `SELECT r.id, r.versao, r.vigencia_inicio, r.vigencia_fim FROM regra_coparticipacao r
          WHERE r.id = ?
            AND (r.contrato_plano_id IN (SELECT k.id FROM contrato_plano k WHERE k.estabelecimento_id = ?)
                 OR r.plano_comercializado_id IN (SELECT p.id FROM plano_comercializado p WHERE p.estabelecimento_id = ?))`,
        [id, est, est],
        { teto: 1 },
      );
      if (!r) throw naoEncontrado();
      exigir(
        problemasDoEncerramento(
          { inicio: dataIso(r['vigencia_inicio']) ?? '', fim: dataIso(r['vigencia_fim']) },
          x.fim,
        ),
      );
      const versao = await tx.alterar('regra_coparticipacao', id, x.versao, { vigencia_fim: x.fim });
      return { id, versao };
    });
  }
}

export const METODOS_REGRAS_COPARTICIPACAO: ReadonlySet<string> = new Set([
  'opcoes',
  'procedimentos',
  'regras',
  'incluir',
  'encerrar',
]);
