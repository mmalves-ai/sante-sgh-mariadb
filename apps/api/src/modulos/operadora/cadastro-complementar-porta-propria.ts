// Porta própria do cadastro complementar da operadora (F7, 08-SGO linhas 93 a 95; F78.08-1) sobre o banco do cliente:
// responsáveis perante a ANS, setores internos, parâmetros por operadora (com vigência), aditivo e cancelamento do
// contrato, área de abrangência do produto, carências aplicadas ao beneficiário e o pedido de cartão.
// Cada gravação é uma operação do Executor do núcleo (trilha na mesma transação); a regra vem do domínio
// (cadastro-complementar.ts) e o banco só guarda. Nada é apagado: a troca encerra o período anterior, a área retirada
// recebe excluido_em e o cancelamento muda a situação. O escopo é o do estabelecimento da sessão (operadora ligada a
// ele, contrato e produto dele); fora dele, 404 sem dizer se existe.
import {
  ADITIVOS_COM_EFEITO,
  carenciasAplicadas,
  lerParametro,
  PARAMETROS_OPERADORA,
  type ChaveParametroOperadora,
  passoDoPedidoCartao,
  planoCancelamento,
  planoResponsavel,
  podeDesistirCancelamento,
  podeEfetivarCancelamento,
  problemasDaAssinatura,
  type ProblemaCadastro,
  problemasDaAbrangencia,
  problemasDoAditivo,
  problemasDoDepartamento,
  problemasDoPedidoCartao,
  somarDias,
  somarMeses,
  type TipoContratacao,
  type TipoResponsavelOperadora,
  valorDoParametro,
} from '@sgh/dominio-operadora';
import {
  definirOperacao,
  ErroOperacao,
  type Executor,
  garantirSequencia,
  type Leitor,
  recusa,
  type TxOperacao,
} from '@sgh/nucleo';
import { z } from 'zod';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import {
  booleano,
  contextoDireto,
  dataIso,
  estabelecimentoDaSessao,
  instanteIso,
  inteiro,
  type MapaRestricoes,
  type ContextoSessao,
  type NucleoOperadora,
  numero,
  semEstabelecimento,
  texto,
  textoObrigatorio,
  traduzirRestricao,
} from './apoio-banco.js';

export const PORTA_CADASTRO_COMPLEMENTAR = Symbol('PORTA_CADASTRO_COMPLEMENTAR_OPERADORA');

export const TABELAS_CADASTRO_COMPLEMENTAR = [
  'responsavel_operadora',
  'departamento_operadora',
  'parametro_operadora',
  'aditivo_contrato_plano',
  'cancelamento_contrato_plano',
  'contrato_plano',
  'beneficiario_plano',
  'area_abrangencia_produto',
  'carencia_aplicada',
  'solicitacao_cartao_beneficiario',
  'cartao_beneficiario',
  'sequencia_negocio',
] as const;

const RESTRICOES: MapaRestricoes = {
  uq_departamento_operadora_codigo: ['codigo-em-uso', 'Já existe setor com este código.', 'codigo'],
  fk_responsavel_operadora_pessoa_fisica_id: ['pessoa-inexistente', 'Pessoa não cadastrada.', 'pessoa'],
  fk_responsavel_operadora_pessoa_juridica_id: ['pessoa-inexistente', 'Empresa não cadastrada.', 'pessoa'],
  fk_aditivo_contrato_plano_anterior_plano_comercializado_id: [
    'plano-inexistente',
    'Plano não cadastrado.',
    'planoAnterior',
  ],
  fk_aditivo_contrato_plano_novo_plano_comercializado_id: [
    'plano-inexistente',
    'Plano não cadastrado.',
    'planoNovo',
  ],
  fk_cancelamento_contrato_plano_motivo_cancelamento_contrato_id: [
    'motivo-inexistente',
    'Motivo não cadastrado.',
    'motivo',
  ],
  fk_solicitacao_cartao_beneficiario_motivo_solicitacao_cartao_id: [
    'motivo-inexistente',
    'Motivo não cadastrado.',
    'motivo',
  ],
};

const naoEncontrado = (): ErroOperacao =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    'O registro não existe neste estabelecimento.',
  );
const desatualizado = (): ErroOperacao =>
  new ErroOperacao(409, 'versao-desatualizada', 'Registro alterado por outra pessoa', 'Recarregue e repita.');
function exigir(problemas: readonly ProblemaCadastro[]): void {
  const p = problemas[0];
  if (p) throw recusa(p.codigo, p.detalhe, { campos: [...new Set(problemas.map((x) => x.campo))] });
}

// ---- tipos de leitura ----
export interface Responsavel {
  id: number;
  sequencia: number;
  tipo: string;
  natureza: string;
  pessoa: number;
  numeroRegistro: string | null;
  inicio: string;
  fim: string | null;
  vigente: boolean;
}
export interface Departamento {
  id: number;
  versao: number;
  codigo: string;
  descricao: string;
  tipo: string;
  email: string | null;
  emailsCopia: string[];
  superior: number | null;
  ativo: boolean;
}
export interface ParametroVigente {
  chave: string;
  descricao: string;
  valor: number | boolean;
  padrao: boolean;
  desde: string | null;
}
export interface Aditivo {
  id: number;
  sequencia: number;
  tipo: string;
  efeito: string;
  assinatura: string | null;
  situacao: string;
  descricao: string;
}
export interface Cancelamento {
  id: number;
  protocolo: string;
  solicitante: string;
  dataEfeito: string;
  situacao: string;
}
export interface Area {
  id: number;
  tipo: 'municipio' | 'estado';
  codigoIbge: string;
  nome: string;
}
export interface Carencia {
  categoria: string;
  dias: number;
  aproveitados: number;
  cumpridaEm: string;
  cumprida: boolean;
}
export interface PedidoCartao {
  id: number;
  numero: string;
  primeiraVia: boolean;
  situacao: string;
  solicitadoEm: string | null;
  valorTaxa: number | null;
}

// ---- entradas ----
export interface EntradaResponsavel {
  tipo: string;
  natureza: 'fisica' | 'juridica';
  pessoa: number;
  numeroRegistro: string | null;
  inicio: string;
  fim: string | null;
}
export interface EntradaDepartamento {
  codigo: string;
  descricao: string;
  tipo: string;
  email: string | null;
  emailsCopia: string[];
  superior: number | null;
  visivelPortal: boolean;
  ativo: boolean;
}
export interface EntradaAditivo {
  tipo: string;
  assinatura: string | null;
  efeito: string;
  planoAnterior: number | null;
  planoNovo: number | null;
  valorAnterior: number | null;
  valorNovo: number | null;
  novaVigenciaFim: string | null;
  descricao: string;
}
export interface EntradaCancelamento {
  motivo: number;
  solicitante: string;
  dataEfeito: string | null;
  diasAtraso: number | null;
  avisoRecebimento: string | null;
  avisoEntregueEm: string | null;
  observacao: string | null;
}

export type Gravado = { id: number };
type Trilha = (r: Gravado) => RegistroTrilhaTela;

const esquemaEntrada = z.record(z.string(), z.unknown());

/** Uma linha lida com trava (SELECT ... FOR UPDATE pelo Escritor). */
async function umaTravada(tx: TxOperacao, sql: string, p: readonly unknown[]) {
  return (await tx.consultarParaAtualizar(sql, p, { teto: 1 }))[0] ?? null;
}

export class PortaCadastroComplementarPropria {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoOperadora,
    private readonly cliente: string,
    executor?: Executor,
  ) {
    this.executor = executor ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoSessao, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-complementar' },
      async (l) => {
        const est = await estabelecimentoDaSessao(c, l);
        if (est === null) throw semEstabelecimento();
        return fn(l, est);
      },
    );
  }

  private async gravar(
    c: ContextoSessao,
    nome: string,
    tabela: string,
    trilha: Trilha,
    fn: (tx: TxOperacao, est: number, hoje: string) => Promise<Gravado>,
  ): Promise<Gravado> {
    const est = await this.nucleo.lerSomente(
      { cliente: this.cliente, correlacao: c.correlacao || 'operadora-complementar' },
      (l) => estabelecimentoDaSessao(c, l),
    );
    if (est === null) throw semEstabelecimento();
    const operacao = definirOperacao<Record<string, unknown>, Gravado>({
      nome,
      tabelas: TABELAS_CADASTRO_COMPLEMENTAR,
      entrada: esquemaEntrada,
      acao: 'operacao',
      gravar: async (tx) => {
        try {
          const h = await tx.uma<{ hoje: unknown }>('SELECT CURRENT_DATE AS hoje');
          return await fn(tx, est, dataIso(h?.['hoje']) ?? new Date().toISOString().slice(0, 10));
        } catch (e) {
          throw traduzirRestricao(e, RESTRICOES);
        }
      },
      alvo: (_e, r) => ({ tabela, id: r.id }),
      trilha: (_e, r) => {
        const l = trilha(r);
        return { dados: l.dadosDepois, motivo: l.motivo ?? null };
      },
    });
    const r = await this.executor.executar(
      operacao,
      this.cliente,
      {},
      contextoDireto(this.cliente, est, c, null),
    );
    return r.resultado;
  }

  // ---- escopo ----
  private static async operadoraDoEst(l: Leitor, est: number, op: number): Promise<void> {
    const r = await l.uma(
      'SELECT 1 AS ok FROM operadora_saude_estabelecimento WHERE operadora_saude_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [op, est],
    );
    if (!r) throw naoEncontrado();
  }
  private static async contratoDoEst(l: Leitor, est: number, id: number) {
    const r = await l.uma(
      `SELECT cp.id, cp.versao, cp.operadora_saude_id, cp.inicio_vigencia, cp.fim_vigencia, cp.tipo_vigencia, cp.situacao,
              cl.tipo_contratacao
         FROM contrato_plano cp JOIN classificacao_plano cl ON cl.id = cp.classificacao_plano_id
        WHERE cp.id = ? AND cp.estabelecimento_id = ? AND cp.excluido_em IS NULL`,
      [id, est],
    );
    if (!r) throw naoEncontrado();
    return r;
  }
  /** O plano citado no aditivo é do mesmo estabelecimento do contrato (a FK só confere que existe). */
  private static async planoDoEst(l: Leitor, est: number, id: number | null, campo: string): Promise<void> {
    if (id === null) return;
    const r = await l.uma(
      `SELECT 1 AS ok FROM plano_comercializado pc JOIN produto_plano pp ON pp.id = pc.produto_plano_id
        WHERE pc.id = ? AND pc.estabelecimento_id = ? AND pp.estabelecimento_id = ? AND pc.excluido_em IS NULL`,
      [id, est, est],
    );
    if (!r)
      throw recusa('plano-fora-do-contrato', 'O plano não é do estabelecimento deste contrato.', {
        campos: [campo],
      });
  }
  /** O aditivo vigente de prorrogação ou renovação estende a vigência do contrato (prazo determinado). */
  private static async aplicarAditivo(
    tx: TxOperacao,
    est: number,
    contrato: number,
    tipo: string,
    novaVigenciaFim: string | null,
  ): Promise<void> {
    if (!ADITIVOS_COM_EFEITO.includes(tipo) || !novaVigenciaFim) return;
    const ctr = await PortaCadastroComplementarPropria.contratoDoEst(tx, est, contrato);
    const fim = dataIso(ctr['fim_vigencia']);
    if (fim !== null && novaVigenciaFim <= fim)
      throw recusa('vigencia-invalida', 'O novo fim precisa ser depois do fim atual do contrato.', {
        campos: ['novaVigenciaFim'],
      });
    await tx.alterar('contrato_plano', contrato, Number(ctr['versao']), {
      fim_vigencia: novaVigenciaFim,
      tipo_vigencia: 'determinada',
    });
  }
  /** Encerra o contrato na data de efeito e fecha a vigência dos beneficiários abertos. */
  private static async encerrarContrato(tx: TxOperacao, est: number, contrato: number, efeito: string) {
    const ctr = await PortaCadastroComplementarPropria.contratoDoEst(tx, est, contrato);
    const inicio = dataIso(ctr['inicio_vigencia']) ?? efeito;
    await tx.alterar('contrato_plano', contrato, Number(ctr['versao']), {
      situacao: 'encerrado',
      fim_vigencia: efeito < inicio ? inicio : efeito,
      tipo_vigencia: 'determinada',
    });
    // A vigência dos beneficiários termina com o contrato (a baixa cadastral de cada um segue pela rotina de baixa).
    const bens = await tx.consultarParaAtualizar(
      'SELECT id, versao, inicio_vigencia FROM beneficiario_plano WHERE contrato_plano_id = ? AND excluido_em IS NULL AND fim_vigencia IS NULL',
      [contrato],
      { teto: 100_000 },
    );
    for (const b of bens) {
      const ini = dataIso(b['inicio_vigencia']) ?? efeito;
      await tx.alterar('beneficiario_plano', Number(b['id']), Number(b['versao']), {
        fim_vigencia: efeito < ini ? ini : efeito,
      });
    }
  }
  private static async beneficiarioDoEst(l: Leitor, est: number, id: number) {
    const r = await l.uma(
      `SELECT b.id, b.versao, b.data_adesao, b.contrato_plano_id, cp.produto_plano_id, cp.operadora_saude_id FROM beneficiario_plano b
         JOIN contrato_plano cp ON cp.id = b.contrato_plano_id WHERE b.id = ? AND cp.estabelecimento_id = ? AND b.excluido_em IS NULL`,
      [id, est],
    );
    if (!r) throw naoEncontrado();
    return r;
  }
  private static async parametro(l: Leitor, op: number, chave: ChaveParametroOperadora, data: string) {
    const r = await l.uma<{ valor: unknown }>(
      `SELECT valor FROM parametro_operadora WHERE operadora_saude_id = ? AND chave = ? AND excluido_em IS NULL
          AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?) ORDER BY vigencia_inicio DESC, id DESC LIMIT 1`,
      [op, chave, data, data],
    );
    return lerParametro(chave, texto(r?.['valor']));
  }
  private static async sequencia(l: Leitor, tabela: string, coluna: string, pai: number): Promise<number> {
    const r = await l.uma<{ s: unknown }>(
      `SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM ${tabela} WHERE ${coluna} = ?`,
      [pai],
    );
    return inteiro(r?.['s']) ?? 1;
  }

  // ---- responsáveis ----
  responsaveis(c: ContextoSessao, op: number): Promise<Responsavel[]> {
    return this.ler(c, async (l, est) => {
      await PortaCadastroComplementarPropria.operadoraDoEst(l, est, op);
      const rs = await l.consultar(
        `SELECT id, sequencia, tipo_responsavel, natureza_pessoa, pessoa_fisica_id, pessoa_juridica_id, numero_registro,
                inicio_exercicio, fim_exercicio, (fim_exercicio IS NULL OR fim_exercicio >= CURRENT_DATE) AS vigente
           FROM responsavel_operadora WHERE operadora_saude_id = ? AND excluido_em IS NULL ORDER BY tipo_responsavel, inicio_exercicio`,
        [op],
        { teto: 500 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        sequencia: Number(r['sequencia']),
        tipo: textoObrigatorio(r['tipo_responsavel']),
        natureza: textoObrigatorio(r['natureza_pessoa']),
        pessoa: Number(r['pessoa_fisica_id'] ?? r['pessoa_juridica_id']),
        numeroRegistro: texto(r['numero_registro']),
        inicio: dataIso(r['inicio_exercicio']) ?? '',
        fim: dataIso(r['fim_exercicio']),
        vigente: booleano(r['vigente']),
      }));
    });
  }

  incluirResponsavel(c: ContextoSessao, op: number, x: EntradaResponsavel, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.responsavel.incluir',
      'responsavel_operadora',
      trilha,
      async (tx, est) => {
        await PortaCadastroComplementarPropria.operadoraDoEst(tx, est, op);
        const atuais = await tx.consultarParaAtualizar(
          'SELECT id, versao, tipo_responsavel, inicio_exercicio, fim_exercicio FROM responsavel_operadora WHERE operadora_saude_id = ? AND excluido_em IS NULL',
          [op],
          { teto: 500 },
        );
        const plano = planoResponsavel(
          x,
          atuais.map((a) => ({
            id: Number(a['id']),
            tipo: textoObrigatorio(a['tipo_responsavel']) as TipoResponsavelOperadora,
            inicio: dataIso(a['inicio_exercicio']) ?? '',
            fim: dataIso(a['fim_exercicio']),
          })),
        );
        exigir(plano.problemas);
        for (const e of plano.encerrar) {
          const v = atuais.find((a) => Number(a['id']) === e.id);
          await tx.alterar('responsavel_operadora', e.id, Number(v?.['versao']), { fim_exercicio: e.fim });
        }
        const id = await tx.incluir('responsavel_operadora', {
          operadora_saude_id: op,
          sequencia: await PortaCadastroComplementarPropria.sequencia(
            tx,
            'responsavel_operadora',
            'operadora_saude_id',
            op,
          ),
          tipo_responsavel: x.tipo,
          natureza_pessoa: x.natureza,
          pessoa_fisica_id: x.natureza === 'fisica' ? x.pessoa : null,
          pessoa_juridica_id: x.natureza === 'juridica' ? x.pessoa : null,
          numero_registro: x.numeroRegistro,
          inicio_exercicio: x.inicio,
          fim_exercicio: x.fim,
        });
        return { id };
      },
    );
  }

  // ---- setores ----
  departamentos(c: ContextoSessao, op: number): Promise<Departamento[]> {
    return this.ler(c, async (l, est) => {
      await PortaCadastroComplementarPropria.operadoraDoEst(l, est, op);
      const rs = await l.consultar(
        `SELECT id, versao, codigo, descricao, tipo, email, emails_copia, superior_departamento_operadora_id, ativo
           FROM departamento_operadora WHERE operadora_saude_id = ? ORDER BY descricao`,
        [op],
        { teto: 500 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        versao: Number(r['versao']),
        codigo: textoObrigatorio(r['codigo']),
        descricao: textoObrigatorio(r['descricao']),
        tipo: textoObrigatorio(r['tipo']),
        email: texto(r['email']),
        emailsCopia: r['emails_copia'] ? (JSON.parse(String(r['emails_copia'])) as string[]) : [],
        superior: inteiro(r['superior_departamento_operadora_id']),
        ativo: booleano(r['ativo']),
      }));
    });
  }

  gravarDepartamento(
    c: ContextoSessao,
    op: number,
    id: number | null,
    versao: number | null,
    x: EntradaDepartamento,
    trilha: Trilha,
  ) {
    return this.gravar(
      c,
      'operadora.departamento.gravar',
      'departamento_operadora',
      trilha,
      async (tx, est) => {
        await PortaCadastroComplementarPropria.operadoraDoEst(tx, est, op);
        const hierarquia = await tx.consultar(
          'SELECT id, superior_departamento_operadora_id AS s FROM departamento_operadora WHERE operadora_saude_id = ?',
          [op],
          { teto: 1000 },
        );
        const mapa = new Map(hierarquia.map((h) => [Number(h['id']), inteiro(h['s'])]));
        if (x.superior !== null && !mapa.has(x.superior))
          throw recusa('superior-inexistente', 'O setor superior não é desta operadora.', {
            campos: ['superior'],
          });
        if (id !== null && !mapa.has(id)) throw naoEncontrado();
        exigir(problemasDoDepartamento({ ...x, id }, mapa));
        const valores = {
          codigo: x.codigo,
          descricao: x.descricao,
          tipo: x.tipo,
          email: x.email,
          emails_copia: x.emailsCopia.length ? JSON.stringify(x.emailsCopia) : null,
          superior_departamento_operadora_id: x.superior,
          visivel_portal: x.visivelPortal,
          ativo: x.ativo,
        };
        if (id === null)
          return { id: await tx.incluir('departamento_operadora', { ...valores, operadora_saude_id: op }) };
        if (versao === null) throw desatualizado();
        await tx.alterar('departamento_operadora', id, versao, valores);
        return { id };
      },
    );
  }

  // ---- parâmetros ----
  parametros(c: ContextoSessao, op: number): Promise<ParametroVigente[]> {
    return this.ler(c, async (l, est) => {
      await PortaCadastroComplementarPropria.operadoraDoEst(l, est, op);
      const rs = await l.consultar(
        `SELECT chave, valor, vigencia_inicio FROM parametro_operadora WHERE operadora_saude_id = ? AND excluido_em IS NULL
            AND vigencia_inicio <= CURRENT_DATE AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE) ORDER BY vigencia_inicio, id`,
        [op],
        { teto: 500 },
      );
      const vig = new Map(rs.map((r) => [textoObrigatorio(r['chave']), r]));
      return (Object.keys(PARAMETROS_OPERADORA) as ChaveParametroOperadora[]).map((k) => {
        const r = vig.get(k);
        return {
          chave: k,
          descricao: PARAMETROS_OPERADORA[k].descricao,
          valor: lerParametro(k, r ? texto(r['valor']) : null),
          padrao: !r,
          desde: r ? dataIso(r['vigencia_inicio']) : null,
        };
      });
    });
  }

  definirParametro(
    c: ContextoSessao,
    op: number,
    x: { chave: string; valor: unknown; inicio: string | null; justificativa: string | null },
    trilha: Trilha,
  ) {
    return this.gravar(
      c,
      'operadora.parametro.definir',
      'parametro_operadora',
      trilha,
      async (tx, est, hoje) => {
        await PortaCadastroComplementarPropria.operadoraDoEst(tx, est, op);
        const v = valorDoParametro(x.chave, x.valor);
        if ('problema' in v)
          throw recusa(v.problema.codigo, v.problema.detalhe, { campos: [v.problema.campo] });
        const inicio = x.inicio ?? hoje;
        if (inicio < hoje)
          throw recusa('vigencia-retroativa', 'O parâmetro novo vale de hoje em diante.', {
            campos: ['inicio'],
          });
        const abertos = await tx.consultarParaAtualizar(
          `SELECT id, versao, vigencia_inicio FROM parametro_operadora WHERE operadora_saude_id = ? AND chave = ? AND excluido_em IS NULL
            AND (vigencia_fim IS NULL OR vigencia_fim >= ?)`,
          [op, x.chave, inicio],
          { teto: 50 },
        );
        for (const a of abertos) {
          // O que começaria depois do novo é substituído (fim na véspera do próprio início: período vazio, mas guardado).
          const ini = dataIso(a['vigencia_inicio']) ?? inicio;
          const fim = ini >= inicio ? somarDias(ini, -1) : somarDias(inicio, -1);
          await tx.alterar('parametro_operadora', Number(a['id']), Number(a['versao']), {
            vigencia_fim: fim,
          });
        }
        const id = await tx.incluir('parametro_operadora', {
          operadora_saude_id: op,
          chave: x.chave,
          valor: v.valor,
          vigencia_inicio: inicio,
          justificativa: x.justificativa,
        });
        return { id };
      },
    );
  }

  // ---- aditivo ----
  aditivos(c: ContextoSessao, contrato: number): Promise<Aditivo[]> {
    return this.ler(c, async (l, est) => {
      await PortaCadastroComplementarPropria.contratoDoEst(l, est, contrato);
      const rs = await l.consultar(
        'SELECT id, sequencia, tipo_aditivo, data_efeito, data_assinatura, situacao, descricao FROM aditivo_contrato_plano WHERE contrato_plano_id = ? AND excluido_em IS NULL ORDER BY sequencia',
        [contrato],
        { teto: 500 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        sequencia: Number(r['sequencia']),
        tipo: textoObrigatorio(r['tipo_aditivo']),
        efeito: dataIso(r['data_efeito']) ?? '',
        assinatura: dataIso(r['data_assinatura']),
        situacao: textoObrigatorio(r['situacao']),
        descricao: textoObrigatorio(r['descricao']),
      }));
    });
  }

  registrarAditivo(c: ContextoSessao, contrato: number, x: EntradaAditivo, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.aditivo.registrar',
      'aditivo_contrato_plano',
      trilha,
      async (tx, est) => {
        const ctr = await PortaCadastroComplementarPropria.contratoDoEst(tx, est, contrato);
        exigir(
          problemasDoAditivo(x, {
            inicio: dataIso(ctr['inicio_vigencia']) ?? '',
            fim: dataIso(ctr['fim_vigencia']),
            situacao: textoObrigatorio(ctr['situacao']),
          }),
        );
        await PortaCadastroComplementarPropria.planoDoEst(tx, est, x.planoAnterior, 'planoAnterior');
        await PortaCadastroComplementarPropria.planoDoEst(tx, est, x.planoNovo, 'planoNovo');
        const vigente = x.assinatura !== null;
        const id = await tx.incluir('aditivo_contrato_plano', {
          contrato_plano_id: contrato,
          sequencia: await PortaCadastroComplementarPropria.sequencia(
            tx,
            'aditivo_contrato_plano',
            'contrato_plano_id',
            contrato,
          ),
          tipo_aditivo: x.tipo,
          data_assinatura: x.assinatura,
          data_efeito: x.efeito,
          anterior_plano_comercializado_id: x.planoAnterior,
          novo_plano_comercializado_id: x.planoNovo,
          valor_anterior: x.valorAnterior,
          valor_novo: x.valorNovo,
          nova_vigencia_fim: x.novaVigenciaFim,
          descricao: x.descricao,
          situacao: vigente ? 'vigente' : 'rascunho',
        });
        if (vigente)
          await PortaCadastroComplementarPropria.aplicarAditivo(tx, est, contrato, x.tipo, x.novaVigenciaFim);
        return { id };
      },
    );
  }

  /** Assina o aditivo em rascunho: passa a vigente e aplica o efeito (prorrogação ou renovação). */
  assinarAditivo(c: ContextoSessao, id: number, assinatura: string, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.aditivo.assinar',
      'aditivo_contrato_plano',
      trilha,
      async (tx, est, hoje) => {
        const r = await umaTravada(
          tx,
          `SELECT a.id, a.versao, a.situacao, a.tipo_aditivo, a.data_efeito, a.nova_vigencia_fim, a.contrato_plano_id
             FROM aditivo_contrato_plano a JOIN contrato_plano cp ON cp.id = a.contrato_plano_id
            WHERE a.id = ? AND cp.estabelecimento_id = ? AND a.excluido_em IS NULL`,
          [id, est],
        );
        if (!r) throw naoEncontrado();
        exigir(
          problemasDaAssinatura(
            textoObrigatorio(r['situacao']),
            assinatura,
            dataIso(r['data_efeito']) ?? '',
            hoje,
          ),
        );
        await tx.alterar('aditivo_contrato_plano', id, Number(r['versao']), {
          situacao: 'vigente',
          data_assinatura: assinatura,
        });
        await PortaCadastroComplementarPropria.aplicarAditivo(
          tx,
          est,
          Number(r['contrato_plano_id']),
          textoObrigatorio(r['tipo_aditivo']),
          dataIso(r['nova_vigencia_fim']),
        );
        return { id };
      },
    );
  }

  // ---- cancelamento ----
  cancelamentos(c: ContextoSessao, contrato: number): Promise<Cancelamento[]> {
    return this.ler(c, async (l, est) => {
      await PortaCadastroComplementarPropria.contratoDoEst(l, est, contrato);
      const rs = await l.consultar(
        'SELECT id, protocolo, solicitante, data_efeito, situacao FROM cancelamento_contrato_plano WHERE contrato_plano_id = ? AND excluido_em IS NULL ORDER BY id',
        [contrato],
        { teto: 100 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        protocolo: textoObrigatorio(r['protocolo']),
        solicitante: textoObrigatorio(r['solicitante']),
        dataEfeito: dataIso(r['data_efeito']) ?? '',
        situacao: textoObrigatorio(r['situacao']),
      }));
    });
  }

  solicitarCancelamento(c: ContextoSessao, contrato: number, x: EntradaCancelamento, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.cancelamento.solicitar',
      'cancelamento_contrato_plano',
      trilha,
      async (tx, est, hoje) => {
        const ctr = await PortaCadastroComplementarPropria.contratoDoEst(tx, est, contrato);
        if (!['ativo', 'suspenso'].includes(textoObrigatorio(ctr['situacao'])))
          throw recusa('contrato-sem-vigencia', 'O contrato já está em cancelamento ou encerrado.', {
            campos: ['contrato'],
          });
        const motivo = await tx.uma(
          'SELECT exige_notificacao_previa FROM motivo_cancelamento_contrato WHERE id = ? AND ativo = TRUE',
          [x.motivo],
        );
        if (!motivo) throw recusa('motivo-inexistente', 'Motivo não cadastrado.', { campos: ['motivo'] });
        const op = Number(ctr['operadora_saude_id']);
        const plano = planoCancelamento({
          ...x,
          hoje,
          exigeNotificacao: booleano(motivo['exige_notificacao_previa']),
          diasInadimplencia: Number(
            await PortaCadastroComplementarPropria.parametro(tx, op, 'dias_inadimplencia_cancelamento', hoje),
          ),
          diaLimiteNotificacao: Number(
            await PortaCadastroComplementarPropria.parametro(
              tx,
              op,
              'dia_limite_notificacao_inadimplencia',
              hoje,
            ),
          ),
          tipoContratacao: textoObrigatorio(ctr['tipo_contratacao']) as TipoContratacao,
          inicioContrato: dataIso(ctr['inicio_vigencia']) ?? hoje,
        });
        exigir(plano.problemas);
        await garantirSequencia(
          tx,
          { tipo: 'cancelamento_contrato_plano', estabelecimento: est },
          { usuario: tx.contexto.usuario, agora: new Date() },
        );
        const protocolo = await tx.proximoNumero('cancelamento_contrato_plano');
        const id = await tx.incluir('cancelamento_contrato_plano', {
          contrato_plano_id: contrato,
          motivo_cancelamento_contrato_id: x.motivo,
          protocolo: protocolo.formatado,
          solicitante: x.solicitante,
          solicitado_em: new Date(),
          data_efeito: plano.dataEfeito,
          situacao: plano.efetivarJa ? 'efetivado' : plano.situacao,
          efetivado_em: plano.efetivarJa ? new Date() : null,
          efetivado_por_usuario_id: plano.efetivarJa ? tx.contexto.usuario : null,
          dias_atraso: x.diasAtraso,
          aviso_recebimento: x.avisoRecebimento,
          aviso_entregue_em: x.avisoEntregueEm,
          observacao: x.observacao,
        });
        // Pedido do titular no contrato individual (RN 412): efeito na ciência, sem depender de outra pessoa.
        if (plano.efetivarJa)
          await PortaCadastroComplementarPropria.encerrarContrato(tx, est, contrato, plano.dataEfeito);
        else
          await tx.alterar('contrato_plano', contrato, Number(ctr['versao']), {
            situacao: 'em_cancelamento',
          });
        return { id };
      },
    );
  }

  efetivarCancelamento(c: ContextoSessao, id: number, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.cancelamento.efetivar',
      'cancelamento_contrato_plano',
      trilha,
      async (tx, est, hoje) => {
        const r = await umaTravada(
          tx,
          `SELECT k.id, k.versao, k.situacao, k.data_efeito, k.contrato_plano_id FROM cancelamento_contrato_plano k
           JOIN contrato_plano cp ON cp.id = k.contrato_plano_id WHERE k.id = ? AND cp.estabelecimento_id = ?`,
          [id, est],
        );
        if (!r) throw naoEncontrado();
        const efeito = dataIso(r['data_efeito']) ?? hoje;
        const p = podeEfetivarCancelamento(textoObrigatorio(r['situacao']), efeito, hoje);
        if (p) exigir([p]);
        await tx.alterar('cancelamento_contrato_plano', id, Number(r['versao']), {
          situacao: 'efetivado',
          efetivado_em: new Date(),
          efetivado_por_usuario_id: tx.contexto.usuario,
        });
        await PortaCadastroComplementarPropria.encerrarContrato(
          tx,
          est,
          Number(r['contrato_plano_id']),
          efeito,
        );
        return { id };
      },
    );
  }

  /** Desistência do pedido antes da efetivação: o pedido fica guardado como cancelado e o contrato volta a ativo. */
  desistirCancelamento(c: ContextoSessao, id: number, motivo: string | null, trilha: Trilha) {
    return this.gravar(
      c,
      'operadora.cancelamento.desistir',
      'cancelamento_contrato_plano',
      trilha,
      async (tx, est) => {
        const r = await umaTravada(
          tx,
          `SELECT k.id, k.versao, k.situacao, k.contrato_plano_id FROM cancelamento_contrato_plano k
           JOIN contrato_plano cp ON cp.id = k.contrato_plano_id WHERE k.id = ? AND cp.estabelecimento_id = ?`,
          [id, est],
        );
        if (!r) throw naoEncontrado();
        const p = podeDesistirCancelamento(textoObrigatorio(r['situacao']), motivo);
        if (p) exigir([p]);
        await tx.alterar('cancelamento_contrato_plano', id, Number(r['versao']), {
          situacao: 'cancelado',
          motivo_reversao: (motivo ?? '').trim().slice(0, 500),
        });
        const contrato = Number(r['contrato_plano_id']);
        const aberto = await tx.uma(
          "SELECT 1 AS ok FROM cancelamento_contrato_plano WHERE contrato_plano_id = ? AND id <> ? AND excluido_em IS NULL AND situacao IN ('solicitado','agendado') LIMIT 1",
          [contrato, id],
        );
        const ctr = await PortaCadastroComplementarPropria.contratoDoEst(tx, est, contrato);
        if (!aberto && textoObrigatorio(ctr['situacao']) === 'em_cancelamento')
          await tx.alterar('contrato_plano', contrato, Number(ctr['versao']), { situacao: 'ativo' });
        return { id };
      },
    );
  }

  /**
   * Efetiva os pedidos do estabelecimento com a data de efeito alcançada (rotina diária ou botão da tela). Cada pedido
   * é uma operação própria, com a sua trilha; o que falhar fica na lista de recusados, sem travar os demais.
   */
  async efetivarCancelamentosVencidos(
    c: ContextoSessao,
    trilha: Trilha,
  ): Promise<{ efetivados: number[]; recusados: { id: number; codigo: string }[] }> {
    const ids = await this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT k.id FROM cancelamento_contrato_plano k JOIN contrato_plano cp ON cp.id = k.contrato_plano_id
            WHERE cp.estabelecimento_id = ? AND k.excluido_em IS NULL AND k.situacao IN ('solicitado','agendado')
              AND k.data_efeito <= CURRENT_DATE ORDER BY k.data_efeito, k.id`,
          [est],
          { teto: 5000 },
        )
      ).map((r) => Number(r['id'])),
    );
    const efetivados: number[] = [];
    const recusados: { id: number; codigo: string }[] = [];
    for (const id of ids) {
      try {
        await this.efetivarCancelamento(c, id, trilha);
        efetivados.push(id);
      } catch (e) {
        recusados.push({
          id,
          codigo: e instanceof ErroOperacao ? String(e.problema.codigo ?? 'erro') : 'erro',
        });
      }
    }
    return { efetivados, recusados };
  }

  // ---- abrangência ----
  abrangencia(c: ContextoSessao, produto: number): Promise<{ abrangencia: string; areas: Area[] }> {
    return this.ler(c, async (l, est) => {
      const p = await l.uma(
        'SELECT abrangencia_geografica FROM produto_plano WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [produto, est],
      );
      if (!p) throw naoEncontrado();
      const rs = await l.consultar(
        `SELECT a.id, a.tipo_area, COALESCE(m.codigo_ibge, u.codigo_ibge) AS ibge, COALESCE(m.nome, u.descricao) AS nome
           FROM area_abrangencia_produto a LEFT JOIN municipio_ibge m ON m.id = a.municipio_ibge_id
           LEFT JOIN unidade_federativa u ON u.id = a.unidade_federativa_id
          WHERE a.produto_plano_id = ? AND a.excluido_em IS NULL ORDER BY a.sequencia`,
        [produto],
        { teto: 6000 },
      );
      return {
        abrangencia: textoObrigatorio(p['abrangencia_geografica']),
        areas: rs.map((r) => ({
          id: Number(r['id']),
          tipo: textoObrigatorio(r['tipo_area']) as 'municipio' | 'estado',
          codigoIbge: textoObrigatorio(r['ibge']),
          nome: textoObrigatorio(r['nome']),
        })),
      };
    });
  }

  definirAbrangencia(
    c: ContextoSessao,
    produto: number,
    areas: { tipo: 'municipio' | 'estado'; codigoIbge: string }[],
    trilha: Trilha,
  ) {
    return this.gravar(c, 'operadora.abrangencia.definir', 'produto_plano', trilha, async (tx, est) => {
      const p = await tx.uma(
        'SELECT abrangencia_geografica FROM produto_plano WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [produto, est],
      );
      if (!p) throw naoEncontrado();
      exigir(problemasDaAbrangencia(textoObrigatorio(p['abrangencia_geografica']), areas));
      const ids: { tipo: string; ref: number }[] = [];
      for (const a of areas) {
        const r =
          a.tipo === 'estado'
            ? await tx.uma('SELECT id FROM unidade_federativa WHERE codigo_ibge = ?', [a.codigoIbge])
            : await tx.uma('SELECT id FROM municipio_ibge WHERE codigo_ibge = ?', [a.codigoIbge]);
        if (!r)
          throw recusa('area-inexistente', 'Código do IBGE não encontrado no catálogo oficial.', {
            campos: ['areas'],
          });
        ids.push({ tipo: a.tipo, ref: Number(r['id']) });
      }
      const atuais = await tx.consultarParaAtualizar(
        'SELECT id, versao, tipo_area, COALESCE(municipio_ibge_id, unidade_federativa_id) AS ref, excluido_em FROM area_abrangencia_produto WHERE produto_plano_id = ?',
        [produto],
        { teto: 6000 },
      );
      const chave = (t: unknown, r: unknown) => `${String(t)}:${String(r)}`;
      const pedidas = new Set(ids.map((i) => chave(i.tipo, i.ref)));
      for (const a of atuais) {
        const k = chave(a['tipo_area'], a['ref']);
        const ativa = a['excluido_em'] === null;
        if (ativa && !pedidas.has(k)) {
          await tx.alterar('area_abrangencia_produto', Number(a['id']), Number(a['versao']), {
            excluido_em: new Date(),
            excluido_por: tx.contexto.usuario,
          });
        } else if (!ativa && pedidas.has(k)) {
          await tx.alterar('area_abrangencia_produto', Number(a['id']), Number(a['versao']), {
            excluido_em: null,
            excluido_por: null,
          });
        }
      }
      const existentes = new Set(atuais.map((a) => chave(a['tipo_area'], a['ref'])));
      let seq = await PortaCadastroComplementarPropria.sequencia(
        tx,
        'area_abrangencia_produto',
        'produto_plano_id',
        produto,
      );
      for (const i of ids) {
        if (existentes.has(chave(i.tipo, i.ref))) continue;
        await tx.incluir('area_abrangencia_produto', {
          produto_plano_id: produto,
          sequencia: seq++,
          tipo_area: i.tipo,
          municipio_ibge_id: i.tipo === 'municipio' ? i.ref : null,
          unidade_federativa_id: i.tipo === 'estado' ? i.ref : null,
        });
      }
      return { id: produto };
    });
  }

  // ---- carências aplicadas ----
  carencias(c: ContextoSessao, beneficiario: number): Promise<Carencia[]> {
    return this.ler(c, async (l, est) => {
      await PortaCadastroComplementarPropria.beneficiarioDoEst(l, est, beneficiario);
      const rs = await l.consultar(
        `SELECT categoria, dias_carencia, dias_aproveitados, cumprida_em, cumprida_em <= CURRENT_DATE AS cumprida
           FROM carencia_aplicada WHERE beneficiario_plano_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
        [beneficiario],
        { teto: 200 },
      );
      return rs.map((r) => ({
        categoria: textoObrigatorio(r['categoria']),
        dias: Number(r['dias_carencia']),
        aproveitados: Number(r['dias_aproveitados']),
        cumpridaEm: dataIso(r['cumprida_em']) ?? '',
        cumprida: booleano(r['cumprida']),
      }));
    });
  }

  gerarCarencias(c: ContextoSessao, beneficiario: number, aproveitamentoDias: number, trilha: Trilha) {
    return this.gravar(c, 'operadora.carencia.gerar', 'beneficiario_plano', trilha, async (tx, est) => {
      const b = await PortaCadastroComplementarPropria.beneficiarioDoEst(tx, est, beneficiario);
      const ja = await tx.uma(
        'SELECT 1 AS ok FROM carencia_aplicada WHERE beneficiario_plano_id = ? AND excluido_em IS NULL LIMIT 1',
        [beneficiario],
      );
      if (ja)
        throw recusa('carencias-ja-geradas', 'As carências deste beneficiário já foram geradas.', {
          campos: ['beneficiario'],
        });
      // A regra do contrato vale sobre a do produto, grupo a grupo.
      const regras = await tx.consultar(
        `SELECT c.grupo_prazo_carencia_id AS grupo, g.tipo_carencia, c.dias_carencia, c.isento, c.contrato_plano_id
           FROM carencia_produto_contrato c JOIN grupo_prazo_carencia g ON g.id = c.grupo_prazo_carencia_id
          WHERE c.ativo = TRUE AND (c.contrato_plano_id = ? OR (c.contrato_plano_id IS NULL AND c.produto_plano_id = ?))
          ORDER BY c.contrato_plano_id IS NULL, g.id`,
        [b['contrato_plano_id'], b['produto_plano_id']],
        { teto: 500 },
      );
      const porGrupo = new Map<
        number,
        { grupo: number; tipoCarencia: string; dias: number; isento: boolean }
      >();
      for (const r of regras) {
        const g = Number(r['grupo']);
        if (!porGrupo.has(g))
          porGrupo.set(g, {
            grupo: g,
            tipoCarencia: textoObrigatorio(r['tipo_carencia']),
            dias: Number(r['dias_carencia']),
            isento: booleano(r['isento']),
          });
      }
      const adesao = dataIso(b['data_adesao']) ?? '';
      const linhas = carenciasAplicadas(adesao, [...porGrupo.values()], aproveitamentoDias);
      let seq = 1;
      for (const l of linhas)
        await tx.incluir('carencia_aplicada', {
          beneficiario_plano_id: beneficiario,
          sequencia: seq++,
          categoria: l.categoria,
          grupo_prazo_carencia_id: l.grupo,
          produto_plano_id: b['produto_plano_id'],
          inicio_contagem: l.inicio,
          dias_carencia: l.dias,
          dias_aproveitados: l.aproveitados,
          cumprida_em: l.cumpridaEm,
        });
      await tx.alterar('beneficiario_plano', beneficiario, Number(b['versao']), {
        carencia_gerada: true,
        dias_aproveitamento_carencia: aproveitamentoDias,
      });
      return { id: beneficiario };
    });
  }

  // ---- pedido de cartão ----
  pedidosCartao(c: ContextoSessao, beneficiario: number): Promise<PedidoCartao[]> {
    return this.ler(c, async (l, est) => {
      await PortaCadastroComplementarPropria.beneficiarioDoEst(l, est, beneficiario);
      const rs = await l.consultar(
        `SELECT p.id, p.numero, p.primeira_via, s.codigo AS situacao, p.solicitado_em, p.valor_taxa
           FROM solicitacao_cartao_beneficiario p JOIN situacao_solicitacao_cartao s ON s.id = p.situacao_solicitacao_cartao_id
          WHERE p.beneficiario_plano_id = ? AND p.excluido_em IS NULL ORDER BY p.id DESC`,
        [beneficiario],
        { teto: 200 },
      );
      return rs.map((r) => ({
        id: Number(r['id']),
        numero: textoObrigatorio(r['numero']),
        primeiraVia: booleano(r['primeira_via']),
        situacao: textoObrigatorio(r['situacao']),
        solicitadoEm: instanteIso(r['solicitado_em']),
        valorTaxa: numero(r['valor_taxa']),
      }));
    });
  }

  private static async situacaoCartao(l: Leitor, codigo: string): Promise<number> {
    const r = await l.uma('SELECT id FROM situacao_solicitacao_cartao WHERE codigo = ? AND ativo = TRUE', [
      codigo,
    ]);
    if (!r)
      throw recusa('dominio-nao-cadastrado', 'A situação do pedido de cartão não está cadastrada.', {
        campos: ['situacao'],
      });
    return Number(r['id']);
  }

  solicitarCartao(
    c: ContextoSessao,
    beneficiario: number,
    x: {
      primeiraVia: boolean;
      motivo: number | null;
      canal: 'balcao' | 'portal' | 'contratante';
      observacao: string | null;
    },
    trilha: Trilha,
  ) {
    return this.gravar(
      c,
      'operadora.cartao.solicitar',
      'solicitacao_cartao_beneficiario',
      trilha,
      async (tx, est, hoje) => {
        const b = await PortaCadastroComplementarPropria.beneficiarioDoEst(tx, est, beneficiario);
        const op = Number(b['operadora_saude_id']);
        const cobra =
          !x.primeiraVia &&
          Boolean(await PortaCadastroComplementarPropria.parametro(tx, op, 'cobra_segunda_via_cartao', hoje));
        const valor = cobra
          ? Number(await PortaCadastroComplementarPropria.parametro(tx, op, 'valor_taxa_segunda_via', hoje))
          : null;
        exigir(
          problemasDoPedidoCartao({
            primeiraVia: x.primeiraVia,
            motivo: x.motivo,
            cobraTaxa: cobra,
            valorTaxa: valor,
          }),
        );
        const aberto = await tx.uma(
          `SELECT 1 AS ok FROM solicitacao_cartao_beneficiario p JOIN situacao_solicitacao_cartao s ON s.id = p.situacao_solicitacao_cartao_id
          WHERE p.beneficiario_plano_id = ? AND p.excluido_em IS NULL AND s.situacao_final = FALSE LIMIT 1`,
          [beneficiario],
        );
        if (aberto)
          throw recusa('pedido-em-aberto', 'Já há pedido de cartão em aberto para este beneficiário.', {
            campos: ['beneficiario'],
          });
        await garantirSequencia(
          tx,
          { tipo: 'solicitacao_cartao_beneficiario', estabelecimento: est },
          { usuario: tx.contexto.usuario, agora: new Date() },
        );
        const numeroPedido = await tx.proximoNumero('solicitacao_cartao_beneficiario');
        const id = await tx.incluir('solicitacao_cartao_beneficiario', {
          estabelecimento_id: est,
          numero: numeroPedido.formatado,
          beneficiario_plano_id: beneficiario,
          primeira_via: x.primeiraVia,
          motivo_solicitacao_cartao_id: x.motivo,
          situacao_solicitacao_cartao_id: await PortaCadastroComplementarPropria.situacaoCartao(
            tx,
            'solicitado',
          ),
          canal: x.canal,
          cobra_taxa: cobra,
          valor_taxa: valor,
          solicitado_em: new Date(),
          observacao: x.observacao,
        });
        return { id };
      },
    );
  }

  /**
   * A emissão do pedido gera a via de fato, pela mesma regra da segunda via do cadastro: via seguinte, as anteriores
   * canceladas (nunca apagadas), validade pelo parâmetro da operadora limitada ao fim do contrato de prazo determinado.
   */
  private static async novaVia(
    tx: TxOperacao,
    hoje: string,
    pedido: number,
    r: Record<string, unknown>,
  ): Promise<number> {
    const ben = Number(r['beneficiario_plano_id']);
    const b = await umaTravada(
      tx,
      `SELECT b.id, b.versao, b.situacao, b.matricula, b.via_cartao, cp.operadora_saude_id, cp.fim_vigencia
         FROM beneficiario_plano b JOIN contrato_plano cp ON cp.id = b.contrato_plano_id WHERE b.id = ?`,
      [ben],
    );
    if (!b || textoObrigatorio(b['situacao']) !== 'ativo')
      throw recusa('beneficiario-inativo', 'Só o beneficiário ativo recebe cartão.', {
        campos: ['beneficiario'],
      });
    const m = await tx.uma<{ v: unknown }>(
      'SELECT COALESCE(MAX(via), 0) AS v FROM cartao_beneficiario WHERE beneficiario_plano_id = ?',
      [ben],
    );
    const via = Math.max(inteiro(m?.['v']) ?? 0, inteiro(b['via_cartao']) ?? 0) + 1;
    const anteriores = await tx.consultarParaAtualizar(
      "SELECT id, versao FROM cartao_beneficiario WHERE beneficiario_plano_id = ? AND situacao <> 'cancelado' AND excluido_em IS NULL",
      [ben],
      { teto: 100 },
    );
    for (const a of anteriores)
      await tx.alterar('cartao_beneficiario', Number(a['id']), Number(a['versao']), {
        situacao: 'cancelado',
        cancelado_em: new Date(),
        cancelado_por_usuario_id: tx.contexto.usuario,
      });
    await tx.alterar('beneficiario_plano', ben, Number(b['versao']), { via_cartao: via });
    const meses = Number(
      await PortaCadastroComplementarPropria.parametro(
        tx,
        Number(b['operadora_saude_id']),
        'validade_cartao_meses',
        hoje,
      ),
    );
    const padrao = somarMeses(hoje, meses);
    const fim = dataIso(b['fim_vigencia']);
    return tx.incluir('cartao_beneficiario', {
      beneficiario_plano_id: ben,
      numero_cartao: textoObrigatorio(b['matricula']),
      via,
      formato: 'fisico',
      emitido_em: hoje,
      validade: fim !== null && fim >= hoje && fim < padrao ? fim : padrao,
      solicitacao_cartao_beneficiario_id: pedido,
      motivo_solicitacao_cartao_id: r['motivo_solicitacao_cartao_id'] ?? null,
      situacao: 'emitido',
      cobrar_emissao: booleano(r['cobra_taxa']),
    });
  }

  avancarPedidoCartao(
    c: ContextoSessao,
    id: number,
    para: 'emitido' | 'entregue' | 'cancelado',
    trilha: Trilha,
  ) {
    return this.gravar(
      c,
      'operadora.cartao.avancar',
      'solicitacao_cartao_beneficiario',
      trilha,
      async (tx, est, hoje) => {
        const r = await umaTravada(
          tx,
          `SELECT p.id, p.versao, p.beneficiario_plano_id, p.motivo_solicitacao_cartao_id, p.cobra_taxa, s.codigo
             FROM solicitacao_cartao_beneficiario p
           JOIN situacao_solicitacao_cartao s ON s.id = p.situacao_solicitacao_cartao_id
          WHERE p.id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL`,
          [id, est],
        );
        if (!r) throw naoEncontrado();
        const passo = passoDoPedidoCartao(textoObrigatorio(r['codigo']), para);
        if (passo) exigir([passo]);
        const valores: Record<string, unknown> = {
          situacao_solicitacao_cartao_id: await PortaCadastroComplementarPropria.situacaoCartao(tx, para),
        };
        if (para === 'emitido') {
          valores['emitido_em'] = new Date();
          valores['cartao_beneficiario_id'] = await PortaCadastroComplementarPropria.novaVia(tx, hoje, id, r);
        }
        if (para === 'entregue') valores['entregue_em'] = new Date();
        await tx.alterar('solicitacao_cartao_beneficiario', id, Number(r['versao']), valores);
        return { id };
      },
    );
  }
}

/** Os métodos da porta (a indisponível, sem núcleo, recusa cada um com 503). */
export const METODOS_CADASTRO_COMPLEMENTAR: ReadonlySet<string> = new Set([
  'responsaveis',
  'incluirResponsavel',
  'departamentos',
  'gravarDepartamento',
  'parametros',
  'definirParametro',
  'aditivos',
  'registrarAditivo',
  'cancelamentos',
  'solicitarCancelamento',
  'efetivarCancelamento',
  'desistirCancelamento',
  'efetivarCancelamentosVencidos',
  'assinarAditivo',
  'abrangencia',
  'definirAbrangencia',
  'carencias',
  'gerarCarencias',
  'pedidosCartao',
  'solicitarCartao',
  'avancarPedidoCartao',
]);
