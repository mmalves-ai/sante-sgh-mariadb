// Unificação de solicitante externo duplicado (F3.1, 02-CAD linha 20). O cadastro absorvido NÃO é apagado e os
// registros clínicos (atendimentos, pedidos de exame, autorizações, receitas) NÃO são alterados: continuam a apontar
// para o cadastro que o pedido teve na época. O absorvido fica inativo e guarda o ponteiro para o cadastro que
// continua (o sucessor); quem consulta o histórico segue o ponteiro. Por isso desfazer é seguro: só o ponteiro volta.
// Os códigos do absorvido nas fontes pagadoras passam ao sucessor só onde ele não tem código; onde os dois têm
// códigos diferentes, vale o do sucessor e a diferença é devolvida para a tela mostrar.

export interface SolicitanteNaUnificacao {
  readonly id: number;
  readonly ativo: boolean;
  /** Cadastro em que este já foi unificado, ou null. */
  readonly sucessor: number | null;
}

export interface CodigoFonteSolicitante {
  readonly fonte: number;
  readonly codigo: string;
  readonly ativo: boolean;
}

const motivoCurto = (m: string) => m.replace(/\s+/g, ' ').trim().length < 10;

/** O que impede unificar o absorvido no cadastro que continua. */
export function errosUnificacao(e: {
  mantido: SolicitanteNaUnificacao;
  absorvido: SolicitanteNaUnificacao;
  motivo: string;
}): string[] {
  const erros: string[] = [];
  if (e.mantido.id === e.absorvido.id) return ['mesmo-cadastro'];
  if (e.absorvido.sucessor !== null) erros.push('absorvido-ja-unificado');
  // O cadastro que continua tem de estar vivo: nem inativo, nem ele próprio unificado em outro (sem cadeias).
  if (e.mantido.sucessor !== null) erros.push('mantido-unificado');
  else if (!e.mantido.ativo) erros.push('mantido-inativo');
  if (motivoCurto(e.motivo)) erros.push('motivo-curto');
  return erros;
}

/**
 * Códigos nas fontes pagadoras na unificação: `herdar` são os códigos ativos do absorvido em fontes onde o cadastro
 * que continua não tem linha nenhuma; `divergentes` são as fontes em que os dois têm código ativo diferente (fica o
 * do cadastro que continua).
 */
export function codigosNaUnificacao(
  mantido: readonly CodigoFonteSolicitante[],
  absorvido: readonly CodigoFonteSolicitante[],
): { herdar: CodigoFonteSolicitante[]; divergentes: number[] } {
  const doMantido = new Map(mantido.map((c) => [c.fonte, c]));
  const herdar: CodigoFonteSolicitante[] = [];
  const divergentes: number[] = [];
  for (const c of absorvido) {
    if (!c.ativo) continue;
    const m = doMantido.get(c.fonte);
    if (!m) herdar.push(c);
    else if (m.ativo && m.codigo.trim().toUpperCase() !== c.codigo.trim().toUpperCase())
      divergentes.push(c.fonte);
  }
  return { herdar, divergentes: [...new Set(divergentes)].sort((a, b) => a - b) };
}

/** O que impede desfazer a unificação do absorvido. */
export function errosDesfazerUnificacao(e: { absorvido: SolicitanteNaUnificacao; motivo: string }): string[] {
  const erros: string[] = [];
  if (e.absorvido.sucessor === null) erros.push('nao-unificado');
  if (motivoCurto(e.motivo)) erros.push('motivo-curto');
  return erros;
}

/**
 * Cadastro que responde hoje por um solicitante: segue o ponteiro até o fim. Um ciclo (que o banco não deveria ter)
 * devolve o próprio ponto de partida, em vez de girar.
 */
export function solicitanteVigente(id: number, sucessorDe: ReadonlyMap<number, number | null>): number {
  const vistos = new Set<number>([id]);
  let atual = id;
  for (;;) {
    const prox = sucessorDe.get(atual) ?? null;
    if (prox === null) return atual;
    if (vistos.has(prox)) return id;
    vistos.add(prox);
    atual = prox;
  }
}

/** Dados de identificação e contato que o cadastro que continua pode receber do duplicado. */
export interface DadosSolicitanteNaUnificacao {
  readonly cpf: string | null;
  readonly cns: string | null;
  readonly ocupacao: number | null;
  readonly especialidade: number | null;
  readonly instituicaoNome: string | null;
  readonly instituicaoCnpj: string | null;
  readonly instituicaoCnes: string | null;
  readonly telefone: string | null;
  readonly email: string | null;
}
export type CampoSolicitanteNaUnificacao = keyof DadosSolicitanteNaUnificacao;

const CAMPOS_SIMPLES = ['cpf', 'cns', 'ocupacao', 'especialidade', 'telefone', 'email'] as const;
const CAMPOS_INSTITUICAO = ['instituicaoNome', 'instituicaoCnpj', 'instituicaoCnes'] as const;
const vazio = (v: string | number | null) => v === null || String(v).trim() === '';
const mesmoValor = (a: string | number | null, b: string | number | null) =>
  String(a).trim().toUpperCase() === String(b).trim().toUpperCase();

/**
 * Dados de identificação na unificação: `herdar` é o que o cadastro que continua NÃO tem e o duplicado tem (CPF,
 * cartão nacional de saúde, ocupação, especialidade, telefone, e-mail); a instituição vem inteira (nome, CNPJ e
 * CNES juntos) só quando o que continua não tem nenhum dos três, para não misturar duas instituições. `divergentes`
 * são os campos que os dois têm com valor diferente: fica o do cadastro que continua e a tela mostra a diferença.
 * O registro no conselho não entra aqui: ele é a chave do cadastro (ver `registroNaAlteracao`).
 */
export function dadosNaUnificacao(
  mantido: DadosSolicitanteNaUnificacao,
  absorvido: DadosSolicitanteNaUnificacao,
): { herdar: Partial<DadosSolicitanteNaUnificacao>; divergentes: CampoSolicitanteNaUnificacao[] } {
  const herdar: Partial<Record<CampoSolicitanteNaUnificacao, string | number | null>> = {};
  const divergentes: CampoSolicitanteNaUnificacao[] = [];
  for (const c of CAMPOS_SIMPLES) {
    if (vazio(absorvido[c])) continue;
    if (vazio(mantido[c])) herdar[c] = absorvido[c];
    else if (!mesmoValor(mantido[c], absorvido[c])) divergentes.push(c);
  }
  const semInstituicao = CAMPOS_INSTITUICAO.every((c) => vazio(mantido[c]));
  for (const c of CAMPOS_INSTITUICAO) {
    if (vazio(absorvido[c])) continue;
    if (semInstituicao) herdar[c] = absorvido[c];
    else if (!vazio(mantido[c]) && !mesmoValor(mantido[c], absorvido[c])) divergentes.push(c);
  }
  return { herdar: herdar as Partial<DadosSolicitanteNaUnificacao>, divergentes };
}

/**
 * Situação do cadastro ao desfazer a unificação: volta exatamente a que ele tinha antes. Quem estava ativo volta
 * ativo (sem data de inativação); quem já estava inativo continua inativo, com a data de inativação que tinha.
 * `ativoAntes` nulo é a unificação gravada antes de a situação anterior ser guardada: vale o que o banco deduziu.
 */
export function situacaoAoDesfazerUnificacao(ativoAntes: boolean | null): { reativar: boolean } {
  return { reativar: ativoAntes !== false };
}

/** Registro no conselho como está gravado (texto), para a chave única do banco. */
export interface RegistroGravado {
  readonly conselho: string;
  readonly uf: string;
  readonly numero: string;
}
const mesmoRegistro = (a: RegistroGravado, b: RegistroGravado) =>
  a.conselho.toUpperCase() === b.conselho.toUpperCase() &&
  a.uf.toUpperCase() === b.uf.toUpperCase() &&
  a.numero === b.numero;

/**
 * Correção do registro do cadastro que continua quando o número certo era o do duplicado unificado NELE. Colisão
 * com um cadastro de fora é recusa (`recusar` traz os ids). Colisão só com os próprios unificados é aceita; se o
 * texto novo é exatamente o de um deles, os dois trocam de registro (`trocarCom`): o duplicado guarda o número que
 * este cadastro tinha, e a chave única do banco continua valendo.
 */
export function registroNaAlteracao(e: {
  id: number;
  anterior: RegistroGravado;
  novo: RegistroGravado;
  /** Cadastros com a mesma chave de registro (conselho, UF e número normalizados). */
  iguais: readonly { id: number; sucessor: number | null; registro: RegistroGravado }[];
}): { recusar: number[]; trocarCom: number | null } {
  const recusar = e.iguais.filter((o) => o.sucessor !== e.id).map((o) => o.id);
  if (recusar.length || mesmoRegistro(e.anterior, e.novo)) return { recusar, trocarCom: null };
  return { recusar, trocarCom: e.iguais.find((o) => mesmoRegistro(o.registro, e.novo))?.id ?? null };
}
