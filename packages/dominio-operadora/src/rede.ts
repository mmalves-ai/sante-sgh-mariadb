// Regras puras da rede credenciada da operadora própria (M56, etapa 4, fatia F3; ficha, seções 6 a 8; cap-07 §7.4):
//   - documento do prestador: CPF (pessoa física) ou CNPJ (pessoa jurídica; o CNPJ alfanumérico da Receita Federal, em
//     vigor desde julho de 2026, também: o dígito verificador usa o valor do caractere menos 48);
//   - CNES de 7 dígitos (obrigatório para pessoa jurídica) e o município do IBGE dentro da UF informada;
//   - tipo de prestador compatível com a pessoa (hospital, laboratório, clínica, imagem e centro clínico só como pessoa
//     jurídica);
//   - contratação indireta só com o registro na ANS da operadora intermediária (6 dígitos), e só nela;
//   - contrato escrito (Lei 13.003/2014): número, início, fim depois do início, forma e mês do reajuste anual;
//   - o próprio hospital da Rede como prestador: pessoa jurídica e com o estabelecimento;
//   - os códigos dos domínios conferidos contra o domínio lido do banco do estabelecimento;
//   - o movimento do RPS: inclusão no credenciamento, alteração só quando muda um campo que o RPS leva, exclusão no
//     descredenciamento e reinclusão;
//   - descredenciamento (Lei 9.656/1998, art. 17; RN ANS 585/2023): motivo, aviso aos beneficiários pelo menos 30 dias
//     antes, data efetiva de hoje em diante; o prestador hospitalar só sai com um substituto hospitalar credenciado na
//     mesma UF ou com a autorização da ANS para reduzir a rede; o substituto em outro município vira aviso.
import {
  CAMPOS_RPS,
  CLASSIFICACAO_HOSPITALAR,
  CONTRATACAO_INDIRETA,
  type CampoRps,
  type CodigoMovimentoRps,
  type ContratoPrestador,
  cpfValido,
  DIAS_AVISO_DESCREDENCIAMENTO,
  MOVIMENTO_RPS,
  type PessoaPrestador,
  type SituacaoPrestador,
  TIPO_PRESTADOR_HOSPITAL,
  TIPOS_PRESTADOR_PESSOA_FISICA,
} from '@sgh/contratos';

/** Só os caracteres que contam no documento (sem pontuação), em maiúsculas. */
export function normalizarDocumento(v: string): string {
  return v.replace(/[.\-/\s]/g, '').toUpperCase();
}

/**
 * CNPJ com dígitos verificadores válidos: o numérico de sempre e o alfanumérico (12 posições com letras ou números e
 * os 2 dígitos verificadores numéricos), pelo módulo 11 sobre o valor de cada caractere menos 48.
 */
export function cnpjValidoAlfanumerico(valor: string): boolean {
  const c = normalizarDocumento(valor);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    let soma = 0;
    let peso = 2;
    for (let i = base.length - 1; i >= 0; i--) {
      soma += (base.charCodeAt(i) - 48) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
}

export function documentoPrestadorValido(pessoa: PessoaPrestador, documento: string): boolean {
  const d = normalizarDocumento(documento);
  return pessoa === 'F' ? /^\d{11}$/.test(d) && cpfValido(d) : cnpjValidoAlfanumerico(d);
}

/** Documento para a lista: o CPF mascarado (só os 5 últimos dígitos); o CNPJ por inteiro, com a pontuação. */
export function documentoExibido(pessoa: PessoaPrestador, documento: string, mascarar: boolean): string {
  const d = normalizarDocumento(documento);
  if (pessoa === 'F') {
    const f = d.padStart(11, '0');
    return mascarar
      ? `***.***.${f.slice(6, 9)}-${f.slice(9)}`
      : `${f.slice(0, 3)}.${f.slice(3, 6)}.${f.slice(6, 9)}-${f.slice(9)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Código IBGE da UF (os dois primeiros dígitos do código do município). */
export const CODIGO_IBGE_UF: Readonly<Record<string, number>> = {
  RO: 11,
  AC: 12,
  AM: 13,
  RR: 14,
  PA: 15,
  AP: 16,
  TO: 17,
  MA: 21,
  PI: 22,
  CE: 23,
  RN: 24,
  PB: 25,
  PE: 26,
  AL: 27,
  SE: 28,
  BA: 29,
  MG: 31,
  ES: 32,
  RJ: 33,
  SP: 35,
  PR: 41,
  SC: 42,
  RS: 43,
  MS: 50,
  MT: 51,
  GO: 52,
  DF: 53,
};

export function municipioNaUf(uf: string, municipioIbge: number): boolean {
  const cod = CODIGO_IBGE_UF[uf];
  return cod !== undefined && Number.isInteger(municipioIbge) && Math.trunc(municipioIbge / 100_000) === cod;
}

/** Prestador hospitalar: o tipo "hospital geral" ou a classificação "assistência hospitalar". */
export function prestadorHospitalar(p: { readonly tipo: number; readonly classificacao: number }): boolean {
  return p.tipo === TIPO_PRESTADOR_HOSPITAL || p.classificacao === CLASSIFICACAO_HOSPITALAR;
}

/** Os códigos válidos de cada domínio, lidos do banco do estabelecimento. */
export interface DominiosRede {
  readonly tipo: ReadonlySet<number>;
  readonly natureza: ReadonlySet<number>;
  readonly classificacao: ReadonlySet<number>;
  readonly contratacao: ReadonlySet<number>;
  readonly disponibilidade: ReadonlySet<number>;
  readonly isencaoOnus: ReadonlySet<number>;
  readonly regime: ReadonlySet<number>;
  readonly remuneracao: ReadonlySet<number>;
  readonly formaReajuste: ReadonlySet<number>;
}

export interface DadosPrestador {
  readonly pessoa: PessoaPrestador;
  readonly documento: string;
  readonly nome: string;
  readonly cnes: string | null;
  readonly uf: string;
  readonly municipioIbge: number;
  readonly tipo: number;
  readonly natureza: number;
  readonly classificacao: number;
  readonly contratacao: number;
  readonly operadoraIntermediaria: string | null;
  readonly disponibilidade: number;
  readonly isencaoOnus: number;
  readonly urgencia: boolean;
  readonly regime: number;
  readonly remuneracao: number;
  readonly contrato: ContratoPrestador;
  readonly ehOHospital: boolean;
  readonly estabelecimento: string | null;
}

export type CodigoProblemaPrestador =
  | 'documento-invalido'
  | 'pessoa-incompativel-com-tipo'
  | 'cnes-obrigatorio'
  | 'cnes-invalido'
  | 'municipio-fora-da-uf'
  | 'dominio-invalido'
  | 'intermediaria-obrigatoria'
  | 'intermediaria-invalida'
  | 'intermediaria-so-na-indireta'
  | 'contrato-fim-antes-do-inicio'
  | 'hospital-sem-estabelecimento'
  | 'estabelecimento-so-do-hospital'
  | 'hospital-pessoa-juridica'
  | 'estabelecimento-fora-da-rede';

export interface ProblemaPrestador {
  readonly codigo: CodigoProblemaPrestador;
  readonly campo: string;
}

const CAMPOS_DOMINIO: readonly Exclude<keyof DominiosRede, 'formaReajuste'>[] = [
  'tipo',
  'natureza',
  'classificacao',
  'contratacao',
  'disponibilidade',
  'isencaoOnus',
  'regime',
  'remuneracao',
];

/** Conferência do credenciamento antes de gravar (a mensagem da tela vem do código; o campo, para o foco). */
export function problemasDoPrestador(
  p: DadosPrestador,
  dominios: DominiosRede,
  estabelecimentosDaRede: ReadonlySet<string>,
): ProblemaPrestador[] {
  const r: ProblemaPrestador[] = [];
  const add = (codigo: CodigoProblemaPrestador, campo: string) => r.push({ codigo, campo });
  if (!documentoPrestadorValido(p.pessoa, p.documento)) add('documento-invalido', 'documento');
  if (p.pessoa === 'F' && !TIPOS_PRESTADOR_PESSOA_FISICA.includes(p.tipo))
    add('pessoa-incompativel-com-tipo', 'tipo');
  const cnes = p.cnes?.trim() ?? '';
  if (!cnes && p.pessoa === 'J') add('cnes-obrigatorio', 'cnes');
  else if (cnes && !/^\d{7}$/.test(cnes)) add('cnes-invalido', 'cnes');
  if (!municipioNaUf(p.uf, p.municipioIbge)) add('municipio-fora-da-uf', 'municipioIbge');
  for (const campo of CAMPOS_DOMINIO) if (!dominios[campo].has(p[campo])) add('dominio-invalido', campo);
  if (!dominios.formaReajuste.has(p.contrato.formaReajuste))
    add('dominio-invalido', 'contrato.formaReajuste');
  const inter = p.operadoraIntermediaria?.trim() ?? '';
  if (p.contratacao === CONTRATACAO_INDIRETA) {
    if (!inter) add('intermediaria-obrigatoria', 'operadoraIntermediaria');
    else if (!/^\d{6}$/.test(inter)) add('intermediaria-invalida', 'operadoraIntermediaria');
  } else if (inter) add('intermediaria-so-na-indireta', 'operadoraIntermediaria');
  const { inicio, fim } = p.contrato;
  if (fim !== null && fim < inicio) add('contrato-fim-antes-do-inicio', 'contrato.fim');
  if (p.ehOHospital) {
    if (!p.estabelecimento) add('hospital-sem-estabelecimento', 'estabelecimento');
    else if (!estabelecimentosDaRede.has(p.estabelecimento))
      add('estabelecimento-fora-da-rede', 'estabelecimento');
    if (p.pessoa !== 'J') add('hospital-pessoa-juridica', 'pessoa');
  } else if (p.estabelecimento) add('estabelecimento-so-do-hospital', 'estabelecimento');
  return r;
}

/** Os campos que o RPS leva, como a regra os compara (texto sem espaços nas pontas, maiúsculas no nome). */
type ValoresRps = Readonly<Record<CampoRps, string | number | boolean | null>>;

export function valoresRps(p: {
  readonly nome: string;
  readonly cnes: string | null;
  readonly uf: string;
  readonly municipioIbge: number;
  readonly tipo: number;
  readonly natureza: number;
  readonly classificacao: number;
  readonly contratacao: number;
  readonly operadoraIntermediaria: string | null;
  readonly disponibilidade: number;
  readonly urgencia: boolean;
}): ValoresRps {
  return {
    nome: p.nome.trim().toUpperCase(),
    cnes: p.cnes?.trim() || null,
    uf: p.uf,
    municipioIbge: p.municipioIbge,
    tipo: p.tipo,
    natureza: p.natureza,
    classificacao: p.classificacao,
    contratacao: p.contratacao,
    operadoraIntermediaria: p.operadoraIntermediaria?.trim() || null,
    disponibilidade: p.disponibilidade,
    urgencia: p.urgencia,
  };
}

/** Os campos do RPS mudados pela alteração (vazio: nenhum movimento do RPS, só a trilha). */
export function camposRpsMudados(antes: ValoresRps, depois: ValoresRps): CampoRps[] {
  return CAMPOS_RPS.filter((c) => antes[c] !== depois[c]);
}

/** O movimento do RPS que a ação gera (null: a alteração não muda o que vai ao RPS). */
export function movimentoDaAcao(
  acao: 'credenciar' | 'alterar' | 'descredenciar' | 'reincluir',
  camposMudados: readonly CampoRps[] = [],
): CodigoMovimentoRps | null {
  if (acao === 'credenciar') return MOVIMENTO_RPS.inclusao;
  if (acao === 'descredenciar') return MOVIMENTO_RPS.exclusao;
  if (acao === 'reincluir') return MOVIMENTO_RPS.reinclusao;
  return camposMudados.length > 0 ? MOVIMENTO_RPS.alteracao : null;
}

const somaDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface PrestadorParaDescredenciar {
  readonly id: number;
  readonly situacao: SituacaoPrestador;
  /** A saída da rede já agendada (descredenciamento com data futura); null sem saída agendada. */
  readonly saidaEm: string | null;
  readonly tipo: number;
  readonly classificacao: number;
  readonly uf: string;
  readonly municipioIbge: number;
}

export interface PedidoDescredenciamento {
  readonly efetivoEm: string;
  readonly avisoBeneficiariosEm: string;
  readonly substituto: number | null;
  readonly autorizacaoAns: string | null;
}

export type CodigoProblemaDescredenciamento =
  | 'ja-descredenciado'
  | 'saida-ja-agendada'
  | 'efetivo-no-passado'
  | 'aviso-no-futuro'
  | 'prazo-do-aviso'
  | 'substituto-obrigatorio'
  | 'substituto-ele-mesmo'
  | 'substituto-inexistente'
  | 'substituto-descredenciado'
  | 'substituto-com-saida-agendada'
  | 'substituto-nao-hospitalar'
  | 'substituto-outra-uf';

export type CodigoAvisoDescredenciamento = 'substituto-outro-municipio' | 'reducao-autorizada';

/** A data mínima do descredenciamento para um aviso dado (o aviso + 30 dias). */
export function efetivoMinimo(avisoEm: string): string {
  return somaDias(avisoEm, DIAS_AVISO_DESCREDENCIAMENTO);
}

/**
 * Conferência do descredenciamento: as recusas (nada é gravado) e os avisos (gravado, a tela mostra). `substituto` é o
 * prestador lido pelo ID pedido (null: não existe na empresa).
 */
export function conferirDescredenciamento(
  p: PrestadorParaDescredenciar,
  pedido: PedidoDescredenciamento,
  substituto: PrestadorParaDescredenciar | null,
  hoje: string,
): { problemas: CodigoProblemaDescredenciamento[]; avisos: CodigoAvisoDescredenciamento[] } {
  const problemas: CodigoProblemaDescredenciamento[] = [];
  const avisos: CodigoAvisoDescredenciamento[] = [];
  if (p.situacao === 'descredenciado') problemas.push('ja-descredenciado');
  else if (p.saidaEm !== null) problemas.push('saida-ja-agendada');
  if (pedido.efetivoEm < hoje) problemas.push('efetivo-no-passado');
  if (pedido.avisoBeneficiariosEm > hoje) problemas.push('aviso-no-futuro');
  if (pedido.efetivoEm < efetivoMinimo(pedido.avisoBeneficiariosEm)) problemas.push('prazo-do-aviso');
  const hospitalar = prestadorHospitalar(p);
  const autorizacao = pedido.autorizacaoAns?.trim() ?? '';
  if (pedido.substituto === null) {
    if (hospitalar && !autorizacao) problemas.push('substituto-obrigatorio');
    else if (hospitalar) avisos.push('reducao-autorizada');
  } else if (pedido.substituto === p.id) problemas.push('substituto-ele-mesmo');
  else if (!substituto) problemas.push('substituto-inexistente');
  else {
    if (substituto.situacao !== 'credenciado') problemas.push('substituto-descredenciado');
    // Quem já tem a saída agendada não garante o atendimento depois dela: não substitui ninguém.
    else if (substituto.saidaEm !== null) problemas.push('substituto-com-saida-agendada');
    if (hospitalar && !prestadorHospitalar(substituto)) problemas.push('substituto-nao-hospitalar');
    if (substituto.uf !== p.uf) problemas.push('substituto-outra-uf');
    else if (substituto.municipioIbge !== p.municipioIbge) avisos.push('substituto-outro-municipio');
  }
  return { problemas, avisos };
}

/**
 * A situação vigente do prestador a partir do que está gravado: o descredenciamento grava a saída com a data efetiva
 * (pelo menos 30 dias depois do aviso, Lei 9.656/1998, art. 17), e até ela o prestador segue credenciado, com a saída
 * agendada. `hoje` e as datas em AAAA-MM-DD.
 */
export function situacaoVigente(
  gravada: SituacaoPrestador,
  situacaoEm: string,
  hoje: string,
): { situacao: SituacaoPrestador; saidaEm: string | null } {
  if (gravada === 'descredenciado' && situacaoEm > hoje)
    return { situacao: 'credenciado', saidaEm: situacaoEm };
  return { situacao: gravada, saidaEm: null };
}

/** A reinclusão vale para o descredenciado e, antes da data, para o de saída agendada (cancela a saída). */
export function podeReincluir(p: {
  readonly situacao: SituacaoPrestador;
  readonly saidaEm: string | null;
}): boolean {
  return p.situacao === 'descredenciado' || p.saidaEm !== null;
}

/** A alteração só vale para o credenciado sem saída agendada (o RPS já tem a exclusão a enviar). */
export function podeAlterar(p: {
  readonly situacao: SituacaoPrestador;
  readonly saidaEm: string | null;
}): boolean {
  return p.situacao === 'credenciado' && p.saidaEm === null;
}
