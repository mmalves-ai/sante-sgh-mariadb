// Erros do núcleo em Problem Details (RFC 9457): conflito de versão (409), registro em edição (trava ocupada),
// idempotência divergente, entrada inválida e a tradução dos erros do MariaDB. Nenhuma mensagem crua do banco e
// nenhum valor de coluna sai daqui: só nomes de coluna, de restrição e códigos. A mensagem do driver traz os
// parâmetros do comando (valores), por isso o log usa só errno, código e o nome da restrição.

const BASE = 'https://sgh.invalid/problemas/';

/** Um grupo de registros dependentes que impedem a exclusão (rótulo de produto, sem nome de tabela). */
export interface DependenteDoProblema {
  readonly rotulo: string;
  readonly quantidade: number;
  readonly amostra: readonly string[];
  readonly origem: 'fk' | 'logica';
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly codigo?: string;
  readonly colunas?: readonly string[];
  readonly campos?: readonly string[];
  readonly restricao?: string;
  readonly dependentes?: readonly DependenteDoProblema[];
  readonly podeInativar?: boolean;
}

export interface ExtrasProblema {
  readonly colunas?: readonly string[];
  readonly campos?: readonly string[];
  readonly restricao?: string;
  readonly dependentes?: readonly DependenteDoProblema[];
  readonly podeInativar?: boolean;
}

export class ErroOperacao extends Error {
  override readonly name = 'ErroOperacao';
  readonly problema: ProblemDetails;
  constructor(status: number, codigo: string, title: string, detail: string, extra: ExtrasProblema = {}) {
    super(`${codigo}: ${detail}`);
    this.problema = { type: BASE + codigo, title, status, detail, codigo, ...extra };
  }
}

/** Erro de leitura (caminho somente leitura, teto, tempo). */
export class ErroLeitura extends Error {
  override readonly name: string = 'ErroLeitura';
}
export class ErroTempoEsgotado extends ErroLeitura {
  override readonly name = 'ErroTempoEsgotado';
}
export class ErroTetoLinhas extends ErroLeitura {
  override readonly name = 'ErroTetoLinhas';
}
/** Configuração ausente ou inválida: a mensagem cita só nomes de chave, nunca valores. */
export class ErroConfiguracao extends Error {
  override readonly name = 'ErroConfiguracao';
}
/** Cliente sem registro na plataforma (ou encerrado). */
export class ErroClienteDesconhecido extends Error {
  override readonly name = 'ErroClienteDesconhecido';
}

/** Recusa de negócio da operação: 409 com código próprio e mensagem em português. */
export function recusa(codigo: string, detail: string, extra: ExtrasProblema = {}): ErroOperacao {
  return new ErroOperacao(409, codigo, 'Operação recusada', detail, extra);
}

export const erroEntradaInvalida = (campos: readonly string[]) =>
  new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', { campos });

export const erroConflitoVersao = (colunas: readonly string[]) =>
  new ErroOperacao(
    409,
    'conflito-versao',
    'Registro alterado por outra pessoa',
    'O registro foi alterado desde a leitura. Releia e confira antes de salvar.',
    { colunas },
  );

export const erroRegistroInexistente = () =>
  new ErroOperacao(404, 'registro-inexistente', 'Registro não encontrado', 'O registro não existe mais.');

export const erroRegistroEmEdicao = () =>
  new ErroOperacao(
    409,
    'registro-em-edicao',
    'Registro em edição em outro terminal',
    'O registro está em edição em outro terminal. Aguarde um instante e tente de novo. Nada foi gravado.',
  );

export const erroNaoLiberada = (motivo?: string | null) =>
  new ErroOperacao(
    403,
    'operacao-nao-liberada',
    'Operação não liberada',
    `Esta operação não está liberada para gravar.${motivo ? ` ${motivo}` : ''}`,
  );

export const erroIdempotenciaDivergente = () =>
  new ErroOperacao(
    422,
    'idempotencia-divergente',
    'Chave de idempotência reutilizada',
    'A mesma chave de idempotência foi usada com dados diferentes. Gere uma chave nova para este pedido.',
  );

export const erroRequisicaoEmAndamento = () =>
  new ErroOperacao(
    409,
    'requisicao-em-andamento',
    'Pedido repetido em andamento',
    'O mesmo pedido está sendo gravado agora. Aguarde e consulte o resultado.',
  );

export const erroReautenticacao = () =>
  new ErroOperacao(
    401,
    'reautenticacao-necessaria',
    'Confirme sua senha',
    'Esta operação exige confirmar a senha antes de gravar.',
  );

export const erroContextoEscrita = (campo: string) =>
  new ErroOperacao(400, 'contexto-invalido', 'Pedido incompleto', `Falta ${campo} no pedido de gravação.`);

// ---- Erros do MariaDB ----

/** Números de erro do servidor MariaDB usados pelo núcleo. */
export const ERRO_BANCO = Object.freeze({
  BAD_NULL: 1048,
  DUP_ENTRY: 1062,
  LOCK_WAIT_TIMEOUT: 1205,
  DEADLOCK: 1213,
  ROW_IS_REFERENCED_OLD: 1217,
  NO_REFERENCED_ROW_OLD: 1216,
  DATA_TOO_LONG: 1406,
  ROW_IS_REFERENCED: 1451,
  NO_REFERENCED_ROW: 1452,
  STATEMENT_TIMEOUT: 1969,
  CONSTRAINT_FAILED: 4025,
});

const CODIGOS_CONEXAO = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ER_SOCKET_UNEXPECTED_CLOSE',
  'ER_CONNECTION_TIMEOUT',
  'ER_GET_CONNECTION_TIMEOUT',
  'ER_CONNECTION_ALREADY_CLOSED',
  'ER_SOCKET_TIMEOUT',
  'ER_POOL_ALREADY_CLOSED',
  'ER_CMD_CONNECTION_CLOSED',
]);

interface ErroDoDriver {
  readonly errno?: unknown;
  readonly code?: unknown;
  readonly fatal?: unknown;
  readonly sqlMessage?: unknown;
}

function comoDriver(erro: unknown): ErroDoDriver | null {
  return erro && typeof erro === 'object' ? (erro as ErroDoDriver) : null;
}

/** errno do servidor, ou null. */
export function errnoDe(erro: unknown): number | null {
  const n = comoDriver(erro)?.errno;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

/** Código simbólico do driver (ER_DUP_ENTRY, ECONNREFUSED…), ou null. */
export function codigoDe(erro: unknown): string | null {
  const c = comoDriver(erro)?.code;
  return typeof c === 'string' ? c : null;
}

/** A conexão caiu ou não abriu: ela não volta ao pool. */
export function erroDeConexao(erro: unknown): boolean {
  const d = comoDriver(erro);
  if (!d) return false;
  if (d.fatal === true) return true;
  const c = codigoDe(erro);
  return c !== null && CODIGOS_CONEXAO.has(c);
}

/** Trava ocupada além da espera (lock wait timeout) ou impasse (deadlock). */
export function ehTravaOcupada(erro: unknown): boolean {
  const n = errnoDe(erro);
  return n === ERRO_BANCO.LOCK_WAIT_TIMEOUT || n === ERRO_BANCO.DEADLOCK;
}

export type TipoRestricao =
  'unica' | 'referencia_inexistente' | 'com_dependentes' | 'checagem' | 'nulo' | 'tamanho';

export interface RestricaoViolada {
  readonly tipo: TipoRestricao;
  /** Nome da restrição ou da coluna (nunca o valor). */
  readonly nome: string | null;
}

const NOME = '([A-Za-z0-9_$]+)';

/** Mensagem do servidor (sem o comando e os parâmetros que o driver anexa). */
function mensagemDoServidor(erro: unknown): string {
  const d = comoDriver(erro);
  if (typeof d?.sqlMessage === 'string') return d.sqlMessage;
  return erro instanceof Error ? erro.message : '';
}

/** Qual restrição o comando violou (só o nome), ou null. */
export function restricaoViolada(erro: unknown): RestricaoViolada | null {
  const n = errnoDe(erro);
  if (n === null) return null;
  const m = mensagemDoServidor(erro);
  const pegar = (re: RegExp) => re.exec(m)?.[1] ?? null;
  switch (n) {
    case ERRO_BANCO.DUP_ENTRY:
      return { tipo: 'unica', nome: pegar(new RegExp(`for key '(?:[A-Za-z0-9_$]+\\.)?${NOME}'`)) };
    case ERRO_BANCO.NO_REFERENCED_ROW:
    case ERRO_BANCO.NO_REFERENCED_ROW_OLD:
      return { tipo: 'referencia_inexistente', nome: pegar(new RegExp(`CONSTRAINT \`${NOME}\``)) };
    case ERRO_BANCO.ROW_IS_REFERENCED:
    case ERRO_BANCO.ROW_IS_REFERENCED_OLD:
      return { tipo: 'com_dependentes', nome: pegar(new RegExp(`CONSTRAINT \`${NOME}\``)) };
    case ERRO_BANCO.CONSTRAINT_FAILED:
      return { tipo: 'checagem', nome: pegar(new RegExp(`CONSTRAINT \`${NOME}\``)) };
    case ERRO_BANCO.BAD_NULL:
      return { tipo: 'nulo', nome: pegar(new RegExp(`Column '${NOME}'`)) };
    case ERRO_BANCO.DATA_TOO_LONG:
      return { tipo: 'tamanho', nome: pegar(new RegExp(`column '${NOME}'`, 'i')) };
    default:
      return null;
  }
}

/** Nome da restrição única violada, ou null. */
export function restricaoUnicaViolada(erro: unknown): string | null {
  const r = restricaoViolada(erro);
  return r?.tipo === 'unica' ? r.nome : null;
}

export interface ErroTraduzido {
  readonly problema: ProblemDetails;
  /** O que pode ir ao log: classe, errno, código e restrição. Nunca mensagem nem valor. */
  readonly log: Readonly<Record<string, string | number | null>>;
}

const problema = (
  status: number,
  codigo: string,
  title: string,
  detail: string,
  extra: ExtrasProblema = {},
) => new ErroOperacao(status, codigo, title, detail, extra).problema;

/** Erro qualquer do banco ou do código → Problem Details sem dado. */
export function problemaDoBanco(erro: unknown): ErroTraduzido {
  const log = {
    classe: erro instanceof Error ? erro.name : typeof erro,
    errno: errnoDe(erro),
    codigo: codigoDe(erro),
    restricao: restricaoViolada(erro)?.nome ?? null,
  };
  if (erro instanceof ErroOperacao) return { problema: erro.problema, log };
  if (ehTravaOcupada(erro)) return { problema: erroRegistroEmEdicao().problema, log };
  if (erro instanceof ErroTempoEsgotado || errnoDe(erro) === ERRO_BANCO.STATEMENT_TIMEOUT)
    return {
      problema: problema(
        503,
        'tempo-esgotado',
        'Consulta demorada',
        'A consulta passou do tempo máximo. Refine o filtro.',
      ),
      log,
    };
  if (erroDeConexao(erro))
    return {
      problema: problema(
        503,
        'banco-indisponivel',
        'Banco indisponível',
        'O banco de dados não respondeu. Nada foi gravado.',
      ),
      log,
    };
  const r = restricaoViolada(erro);
  const comRestricao = r?.nome ? { restricao: r.nome } : {};
  if (r?.tipo === 'unica')
    return {
      problema: problema(
        409,
        'registro-duplicado',
        'Registro duplicado',
        'Já existe um registro com estes dados.',
        comRestricao,
      ),
      log,
    };
  if (r?.tipo === 'com_dependentes')
    return {
      problema: problema(
        409,
        'registro-com-dependentes',
        'Registro em uso',
        'O registro é usado por outros registros e não pode ser excluído.',
        comRestricao,
      ),
      log,
    };
  if (r?.tipo === 'referencia_inexistente')
    return {
      problema: problema(
        422,
        'referencia-inexistente',
        'Referência inexistente',
        'Um registro referenciado não existe.',
        comRestricao,
      ),
      log,
    };
  if (r?.tipo === 'checagem')
    return {
      problema: problema(
        422,
        'regra-do-banco',
        'Dados recusados pelo banco',
        'Os dados não atendem a uma regra do cadastro.',
        comRestricao,
      ),
      log,
    };
  if (r?.tipo === 'nulo' || r?.tipo === 'tamanho')
    return {
      problema: problema(
        400,
        'entrada-invalida',
        'Dados inválidos',
        'Confira os campos indicados.',
        r.nome ? { campos: [r.nome] } : {},
      ),
      log,
    };
  return {
    problema: problema(500, 'erro-interno', 'Erro interno', 'Erro inesperado. Nada foi gravado.'),
    log,
  };
}

/** Erro qualquer → ErroOperacao (o executor responde sempre com Problem Details). */
export function traduzirErro(erro: unknown): ErroOperacao {
  if (erro instanceof ErroOperacao) return erro;
  const p = problemaDoBanco(erro).problema;
  const extra: ExtrasProblema = {
    ...(p.colunas ? { colunas: p.colunas } : {}),
    ...(p.campos ? { campos: p.campos } : {}),
    ...(p.restricao ? { restricao: p.restricao } : {}),
  };
  return new ErroOperacao(p.status, p.codigo ?? 'erro-interno', p.title, p.detail, extra);
}

export function problemaDaOperacao(erro: unknown): ProblemDetails {
  return traduzirErro(erro).problema;
}
