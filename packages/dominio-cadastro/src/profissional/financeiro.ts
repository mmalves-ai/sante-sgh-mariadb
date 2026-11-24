// F3.1, 02-CAD linha 16: as regras puras do complemento do cadastro do profissional: dados fiscais do repasse (com
// vigência por estabelecimento, sem sobreposição), conta bancária ou chave de pagamento instantâneo com o favorecido,
// registro de qualificação de especialista (RQE) e assinatura (imagem ou certificado digital, uma vigente por tipo).
// Sem banco e sem HTTP: a porta própria aplica estas regras antes de gravar, e o teste as prova à parte.
import { cnpjValido, cpfValido } from '@sgh/contratos';

export const TIPOS_RECEBEDOR = ['pessoa_fisica', 'pessoa_juridica'] as const;
export type TipoRecebedor = (typeof TIPOS_RECEBEDOR)[number];
export const REGIMES_TRIBUTARIOS = [
  'autonomo',
  'simples_nacional',
  'mei',
  'lucro_presumido',
  'lucro_real',
  'isento',
  'outro',
] as const;
export type RegimeTributario = (typeof REGIMES_TRIBUTARIOS)[number];
/** Regimes de quem recebe como pessoa física e como pessoa jurídica ('isento' e 'outro' valem para os dois). */
export const REGIMES_PESSOA_FISICA: readonly RegimeTributario[] = ['autonomo', 'isento', 'outro'];
export const REGIMES_PESSOA_JURIDICA: readonly RegimeTributario[] = [
  'simples_nacional',
  'mei',
  'lucro_presumido',
  'lucro_real',
  'isento',
  'outro',
];
/** Alíquota do ISS: de 2% a 5% (lei complementar 116/2003, art. 8º e 8º-A); o regime isento não tem alíquota. */
export const ISS_MINIMO = 2;
export const ISS_MAXIMO = 5;
export const INCIDENCIAS_IMPOSTO = ['producao', 'pagamento'] as const;
export const TIPOS_CHAVE_PIX = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'] as const;
export type TipoChavePix = (typeof TIPOS_CHAVE_PIX)[number];
export const TIPOS_ASSINATURA = ['imagem', 'certificado_digital'] as const;
export type TipoAssinatura = (typeof TIPOS_ASSINATURA)[number];

/** PIS/PASEP/NIT: 11 dígitos com o dígito verificador (pesos 3,2,9,8,7,6,5,4,3,2). */
export function pisValido(valor: string): boolean {
  if (!/^\d{11}$/.test(valor) || /^(\d)\1{10}$/.test(valor)) return false;
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = pesos.reduce((s, p, i) => s + p * Number(valor[i]), 0);
  const resto = 11 - (soma % 11);
  return (resto >= 10 ? 0 : resto) === Number(valor[10]);
}

export interface DadoFiscal {
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly tipoRecebedor: TipoRecebedor;
  readonly pessoaJuridica: number | null;
  readonly regime: RegimeTributario | null;
  readonly pisPasep: string | null;
  readonly aliquotaIss: number | null;
  readonly percentualInss: number | null;
  readonly retemIss: boolean;
  readonly retemInss: boolean;
  readonly dependentesIrrf: number;
}

/** Erros do dado fiscal (códigos estáveis; a tela marca o campo pelo código). */
export function errosDadoFiscal(d: DadoFiscal): string[] {
  const e: string[] = [];
  if (d.vigenciaFim !== null && d.vigenciaFim < d.vigenciaInicio) e.push('vigencia-invertida');
  if (d.tipoRecebedor === 'pessoa_juridica' && d.pessoaJuridica === null) e.push('recebedor-sem-empresa');
  if (d.tipoRecebedor === 'pessoa_fisica' && d.pessoaJuridica !== null) e.push('empresa-sem-recebedor-pj');
  if (d.pisPasep !== null && !pisValido(d.pisPasep)) e.push('pis-invalido');
  if (d.aliquotaIss !== null) {
    if (d.regime === 'isento') {
      if (d.aliquotaIss !== 0) e.push('aliquota-iss-isento');
    } else if (!(d.aliquotaIss >= ISS_MINIMO && d.aliquotaIss <= ISS_MAXIMO)) e.push('aliquota-iss-fora');
  }
  if (d.regime === 'isento' && d.retemIss) e.push('retencao-iss-isento');
  if (d.percentualInss !== null && !(d.percentualInss >= 0 && d.percentualInss <= 100))
    e.push('percentual-inss-fora');
  // Reter sem a alíquota deixa o repasse sem base de cálculo: a retenção exige o percentual.
  if (d.retemIss && d.aliquotaIss === null) e.push('retencao-iss-sem-aliquota');
  if (d.retemInss && d.percentualInss === null) e.push('retencao-inss-sem-percentual');
  // Dependente de IRRF é dedução da pessoa física: a pessoa jurídica não o tem (a retenção de INSS da PJ, na cessão de
  // mão de obra, continua possível).
  if (d.tipoRecebedor === 'pessoa_juridica' && d.dependentesIrrf > 0) e.push('dependentes-em-pj');
  // O regime acompanha o recebedor: autônomo é pessoa física; Simples, MEI e lucro presumido ou real são de empresa.
  if (d.regime === 'mei' && d.tipoRecebedor !== 'pessoa_juridica') e.push('mei-sem-empresa');
  else if (
    d.regime !== null &&
    !(d.tipoRecebedor === 'pessoa_juridica' ? REGIMES_PESSOA_JURIDICA : REGIMES_PESSOA_FISICA).includes(
      d.regime,
    )
  )
    e.push('regime-incompativel');
  // O contribuinte individual com INSS retido é informado no eSocial pelo PIS/PASEP/NIT.
  if (d.tipoRecebedor === 'pessoa_fisica' && d.retemInss && d.pisPasep === null) e.push('pis-obrigatorio');
  if (!Number.isInteger(d.dependentesIrrf) || d.dependentesIrrf < 0 || d.dependentesIrrf > 99)
    e.push('dependentes-fora');
  return e;
}

export interface Vigencia {
  readonly id: number;
  readonly estabelecimento: number | null;
  readonly inicio: string;
  readonly fim: string | null;
}

export interface Periodo {
  readonly id: number;
  readonly inicio: string;
  readonly fim: string | null;
}
export interface Sobreposicao {
  encerrar: { id: number; fim: string }[];
  conflitos: number[];
}

/**
 * Os períodos que se sobrepõem ao novo: quem começa antes e está aberto é encerrado na véspera do novo (devolvido em
 * `encerrar`); qualquer outra sobreposição (com fim informado, ou que começa no mesmo dia ou depois) recusa
 * (devolvida em `conflitos`). Vale para o dado fiscal (por escopo) e para a assinatura (por tipo).
 */
export function sobreposicaoVigencia(
  existentes: readonly Periodo[],
  novo: Omit<Periodo, 'id'>,
): Sobreposicao {
  const encerrar: { id: number; fim: string }[] = [];
  const conflitos: number[] = [];
  const fimNovo = novo.fim ?? '9999-12-31';
  for (const v of existentes) {
    const fimV = v.fim ?? '9999-12-31';
    if (fimV < novo.inicio || v.inicio > fimNovo) continue;
    if (v.inicio < novo.inicio && v.fim === null) encerrar.push({ id: v.id, fim: vespera(novo.inicio) });
    else conflitos.push(v.id);
  }
  return { encerrar, conflitos };
}

/**
 * Um só dado fiscal por dia em cada escopo (o mesmo estabelecimento, ou o geral, de estabelecimento nulo). O geral e o
 * de um estabelecimento podem conviver: no dia, o do estabelecimento vale sobre o geral (`dadoFiscalVigente`).
 */
export function sobreposicaoFiscal(
  existentes: readonly Vigencia[],
  novo: Omit<Vigencia, 'id'>,
): Sobreposicao {
  return sobreposicaoVigencia(
    existentes.filter((v) => v.estabelecimento === novo.estabelecimento),
    novo,
  );
}

/** O dado fiscal que vale no dia e no estabelecimento: o do estabelecimento, senão o geral; nenhum, null. */
export function dadoFiscalVigente<T extends Omit<Vigencia, 'id'>>(
  lista: readonly T[],
  dia: string,
  estabelecimento: number | null,
): T | null {
  const noDia = lista.filter((v) => v.inicio <= dia && (v.fim === null || v.fim >= dia));
  return (
    (estabelecimento !== null ? noDia.find((v) => v.estabelecimento === estabelecimento) : undefined) ??
    noDia.find((v) => v.estabelecimento === null) ??
    null
  );
}

/** O dia anterior (AAAA-MM-DD), em UTC. */
export function vespera(data: string): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface ContaBancaria {
  readonly banco: number | null;
  readonly agencia: string | null;
  readonly numeroConta: string | null;
  readonly tipoChavePix: TipoChavePix | null;
  readonly chavePix: string | null;
  readonly favorecidoNome: string;
  readonly favorecidoTipo: 'fisica' | 'juridica';
  readonly favorecidoDocumento: string;
}

/** A chave de pagamento instantâneo na forma do tipo (CPF e CNPJ com dígito, e-mail, celular +55 e chave aleatória). */
export function chavePixValida(tipo: TipoChavePix, chave: string): boolean {
  switch (tipo) {
    case 'cpf':
      return /^\d{11}$/.test(chave) && cpfValido(chave);
    case 'cnpj':
      return /^\d{14}$/.test(chave) && cnpjValido(chave);
    case 'email':
      return chave.length <= 77 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chave);
    case 'telefone':
      return /^\+55[1-9][1-9]9?\d{8}$/.test(chave);
    case 'aleatoria':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chave);
  }
}

export function errosContaBancaria(c: ContaBancaria): string[] {
  const e: string[] = [];
  const temConta = c.banco !== null && !!c.agencia && !!c.numeroConta;
  const parcialConta = c.banco !== null || !!c.agencia || !!c.numeroConta;
  if (!temConta && !c.chavePix) e.push('sem-meio-pagamento');
  if (parcialConta && !temConta) e.push('conta-incompleta');
  if (c.agencia && !/^\d{1,10}$/.test(c.agencia)) e.push('agencia-invalida');
  if (c.numeroConta && !/^\d{1,20}$/.test(c.numeroConta)) e.push('conta-invalida');
  if ((c.tipoChavePix === null) !== (c.chavePix === null)) e.push('chave-sem-tipo');
  else if (c.tipoChavePix && c.chavePix && !chavePixValida(c.tipoChavePix, c.chavePix))
    e.push('chave-invalida');
  if (!c.favorecidoNome.trim()) e.push('favorecido-sem-nome');
  const doc = c.favorecidoDocumento;
  if (
    c.favorecidoTipo === 'fisica'
      ? !cpfValido(doc) || doc.length !== 11
      : !cnpjValido(doc) || doc.length !== 14
  )
    e.push('favorecido-documento-invalido');
  // A chave de CPF ou CNPJ é a do próprio favorecido: o pagamento não cai em conta de terceiro por engano.
  if (
    (c.tipoChavePix === 'cpf' || c.tipoChavePix === 'cnpj') &&
    c.chavePix !== null &&
    c.chavePix !== c.favorecidoDocumento
  )
    e.push('chave-de-outro-favorecido');
  return e;
}

/** O favorecido é terceiro quando o documento não é o CPF do profissional nem o CNPJ da empresa dele no dado fiscal. */
export function favorecidoTerceiro(
  documento: string,
  cpfProfissional: string | null,
  cnpjsDoProfissional: readonly string[],
): boolean {
  return documento !== cpfProfissional && !cnpjsDoProfissional.includes(documento);
}

export interface Rqe {
  readonly numero: string;
  readonly dataRegistro: string | null;
}

export function errosRqe(r: Rqe, hoje: string): string[] {
  const e: string[] = [];
  if (!/^\d{1,10}$/.test(r.numero)) e.push('rqe-invalido');
  if (r.dataRegistro !== null && r.dataRegistro > hoje) e.push('rqe-data-futura');
  return e;
}

export interface Assinatura {
  readonly tipo: TipoAssinatura;
  readonly arquivo: number | null;
  readonly titular: string | null;
  readonly numeroSerie: string | null;
  readonly impressaoDigital: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export function errosAssinatura(a: Assinatura): string[] {
  const e: string[] = [];
  if (a.vigenciaFim !== null && a.vigenciaFim < a.vigenciaInicio) e.push('vigencia-invertida');
  if (a.tipo === 'imagem') {
    if (a.arquivo === null) e.push('imagem-sem-arquivo');
    if (a.numeroSerie !== null || a.impressaoDigital !== null) e.push('imagem-com-certificado');
  } else {
    if (!a.numeroSerie || !/^[0-9A-Fa-f]{1,64}$/.test(a.numeroSerie)) e.push('serie-invalida');
    if (a.impressaoDigital !== null && !/^[0-9a-f]{64}$/i.test(a.impressaoDigital))
      e.push('impressao-digital-invalida');
    if (!a.titular?.trim()) e.push('certificado-sem-titular');
    if (a.arquivo !== null) e.push('certificado-com-imagem');
  }
  return e;
}

/** A assinatura que vale no dia para o tipo: a vigente mais recente (uma só por tipo). */
export function assinaturaVigente<
  T extends { tipo: TipoAssinatura; inicio: string; fim: string | null; ativo: boolean },
>(lista: readonly T[], tipo: TipoAssinatura, dia: string): T | null {
  return (
    lista
      .filter((a) => a.tipo === tipo && a.ativo && a.inicio <= dia && (a.fim === null || a.fim >= dia))
      .sort((x, y) => (x.inicio < y.inicio ? 1 : -1))[0] ?? null
  );
}
