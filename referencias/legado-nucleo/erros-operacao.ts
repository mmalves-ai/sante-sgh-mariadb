// Erros do executor em Problem Details (RFC 9457; roteiro 4.6): conflito de versão (409 com as colunas que
// mudaram), registro em edição em outro terminal (trava além do LOCK TIMEOUT), ação sem efeito (prova
// pós-escrita), operação não liberada, idempotência divergente, entrada inválida. Nenhuma mensagem crua do
// banco e nenhum valor de coluna: só nomes de coluna e códigos.
import { problemaDoLegado, type ProblemDetails } from './erros.js';

const BASE = 'https://sgh.invalid/problemas/';

export class ErroOperacao extends Error {
  override readonly name = 'ErroOperacao';
  readonly problema: ProblemDetails & {
    readonly colunas?: readonly string[];
    readonly campos?: readonly string[];
    /** W0-02 (D-CRUD-ORFAOS): os registros dependentes que impedem a exclusão (rótulo, quantidade, amostra). */
    readonly dependentes?: readonly DependenteDoProblema[];
    /** W0-02: o domínio tem situação: a recusa oferece a inativação. */
    readonly podeInativar?: boolean;
  };
  constructor(
    status: number,
    codigo: string,
    title: string,
    detail: string,
    extra: {
      readonly colunas?: readonly string[];
      readonly campos?: readonly string[];
      readonly dependentes?: readonly DependenteDoProblema[];
      readonly podeInativar?: boolean;
    } = {},
  ) {
    super(`${codigo}: ${detail}`);
    this.problema = { type: BASE + codigo, title, status, detail, codigo, ...extra };
  }
}

/** W0-02: um grupo de dependentes na recusa (sem nome de tabela: o rótulo de produto). */
export interface DependenteDoProblema {
  readonly rotulo: string;
  readonly quantidade: number;
  readonly amostra: readonly string[];
  readonly origem: 'fk' | 'logica';
}

/** A prova pós-escrita não achou um efeito exigido: a transação é desfeita (409 acao_sem_efeito). */
export class ErroProva extends Error {
  override readonly name = 'ErroProva';
}

/** Recusa de negócio da operação (condição do passo 3): 409 com código próprio, mensagem em português. */
export function recusa(
  codigo: string,
  detail: string,
  extra: {
    campos?: readonly string[];
    dependentes?: readonly DependenteDoProblema[];
    podeInativar?: boolean;
  } = {},
): ErroOperacao {
  return new ErroOperacao(409, codigo, 'Operação recusada', detail, extra);
}

export function exigirEfeito(condicao: unknown, efeito: string): asserts condicao {
  if (!condicao) throw new ErroProva(efeito);
}

export const erroEntradaInvalida = (campos: readonly string[]) =>
  new ErroOperacao(400, 'entrada-invalida', 'Dados inválidos', 'Confira os campos indicados.', { campos });

export const erroConflitoVersao = (colunas: readonly string[]) =>
  new ErroOperacao(
    409,
    'conflito-versao',
    'Registro alterado no outro sistema',
    'O registro foi alterado no outro sistema desde a leitura. Releia e confira antes de salvar.',
    { colunas },
  );

export const erroRegistroEmEdicao = () =>
  new ErroOperacao(
    409,
    'registro-em-edicao',
    'Registro em edição em outro terminal',
    'O registro está em edição em outro terminal. Aguarde um instante e tente de novo. Nada foi gravado.',
  );

export const erroAcaoSemEfeito = () =>
  new ErroOperacao(
    409,
    'acao_sem_efeito',
    'Gravação sem o efeito esperado',
    'A gravação não produziu o efeito esperado no sistema legado e foi desfeita. Nada foi gravado.',
  );

export const erroNaoLiberada = (pendente?: string) =>
  new ErroOperacao(
    403,
    'operacao-nao-liberada',
    'Operação não liberada',
    `Esta operação ainda não está liberada para gravar neste estabelecimento. A tela fica só para consulta.${pendente ? ` Falta provar: ${pendente}.` : ''}`,
  );

export const erroOperacaoBloqueada = (motivo?: string | null) =>
  new ErroOperacao(
    423,
    'operacao-bloqueada',
    'Operação bloqueada',
    `Esta operação está bloqueada no catálogo (divergência ou defeito): nada foi gravado. Avise o suporte.${motivo ? ` Motivo: ${motivo}.` : ''}`,
  );

export const erroSchemaDivergente = () =>
  new ErroOperacao(
    503,
    'schema-divergente',
    'Gravação bloqueada pela verificação do banco',
    'A estrutura do banco deste estabelecimento difere da homologada. As gravações ficam bloqueadas.',
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

const TRAVA = /lock time-?out|deadlock|update conflicts with concurrent update|lock conflict/i;
// M19: o índice único do legado sem restrição declarada (ex.: TBGERASENHA0) responde "attempt to store duplicate value
// … in unique index".
const UNICA =
  /(?:violation of (?:PRIMARY or UNIQUE KEY|UNIQUE KEY) constraint|attempt to store duplicate value[^"]*?unique index) "?([A-Z0-9_$]+)"?/i;

/** Trava ocupada além do LOCK TIMEOUT (ou conflito de atualização concorrente)? */
export function ehTravaOcupada(erro: unknown): boolean {
  return erro instanceof Error && TRAVA.test(erro.message);
}

/** Nome da restrição única violada, ou null. */
export function restricaoUnicaViolada(erro: unknown): string | null {
  if (!(erro instanceof Error)) return null;
  return UNICA.exec(erro.message.replace(/\s+/g, ' '))?.[1]?.toUpperCase() ?? null;
}

/** Erro qualquer do passo → Problem Details (o executor loga só a forma sanitizada). */
export function problemaDaOperacao(erro: unknown): ErroOperacao['problema'] {
  if (erro instanceof ErroOperacao) return erro.problema;
  if (erro instanceof ErroProva) return erroAcaoSemEfeito().problema;
  if (ehTravaOcupada(erro)) return erroRegistroEmEdicao().problema;
  return problemaDoLegado(erro).problema;
}
