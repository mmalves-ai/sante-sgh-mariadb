// Equipes médicas e cooperativas do profissional (F8, 02-CAD linha 22). Regras puras do cadastro da equipe (código,
// nome, tipo e vigência), dos membros da equipe (papel e vigência dentro da vigência da equipe, sem dois períodos
// sobrepostos para o mesmo profissional e um só responsável por vez), da cooperativa médica (CNPJ válido, percentuais de
// 0 a 100, dados bancários completos ou ausentes, alíquota de IR só quando retém) e dos cooperados (vigência sem
// sobreposição na mesma cooperativa; o profissional pode ser cooperado de mais de uma, e o repasse escolhe o favorecido).
// Desenho próprio:
// - a saída de um membro ou cooperado é o fim da vigência: nada é apagado, o histórico de quem estava na equipe na data
//   do ato fica (o credenciamento por equipe e o repasse leem pela data);
// - o encerramento só antecipa (nunca reabre nem estende um vínculo já encerrado; reabrir é um novo período);
// - a vigência é por data civil AAAA-MM-DD; fim nulo = em vigor.
import { cnpjValido, somenteDigitos } from '@sgh/contratos';

export const TIPOS_EQUIPE = [
  'medica',
  'cirurgica',
  'multiprofissional',
  'enfermagem',
  'assistencial',
  'plantao',
  'outra',
] as const;
export type TipoEquipe = (typeof TIPOS_EQUIPE)[number];

export const PAPEIS_MEMBRO_EQUIPE = [
  'responsavel',
  'membro',
  'cirurgiao',
  'auxiliar',
  'anestesista',
  'instrumentador',
  'residente',
  'enfermeiro',
  'tecnico',
  'outro',
] as const;
export type PapelMembroEquipe = (typeof PAPEIS_MEMBRO_EQUIPE)[number];

export const TIPOS_CONTA_COOPERATIVA = ['corrente', 'poupanca', 'pagamento'] as const;
export type TipoContaCooperativa = (typeof TIPOS_CONTA_COOPERATIVA)[number];

/** Período de vigência: início obrigatório, fim nulo = em vigor. */
export interface VigenciaVinculo {
  readonly inicio: string;
  readonly fim: string | null;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** Data civil AAAA-MM-DD que existe no calendário. */
export function dataCivilValida(d: string | null | undefined): d is string {
  if (!d || !DATA.test(d)) return false;
  const x = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d;
}

/** A vigência vale na data (início inclusive, fim inclusive). */
export function vinculoVigenteEm(v: VigenciaVinculo, data: string): boolean {
  return v.inicio <= data && (v.fim === null || v.fim >= data);
}

/** Dois períodos têm ao menos um dia em comum. */
export function vigenciasSobrepostas(a: VigenciaVinculo, b: VigenciaVinculo): boolean {
  return a.inicio <= (b.fim ?? '9999-12-31') && b.inicio <= (a.fim ?? '9999-12-31');
}

/** `dentro` cabe inteira em `fora`. */
export function vigenciaDentro(dentro: VigenciaVinculo, fora: VigenciaVinculo): boolean {
  if (dentro.inicio < fora.inicio) return false;
  if (fora.fim === null) return true;
  return dentro.fim !== null && dentro.fim <= fora.fim;
}

function errosVigencia(v: VigenciaVinculo, erros: string[]): void {
  if (!dataCivilValida(v.inicio)) erros.push('inicio-invalido');
  if (v.fim !== null && !dataCivilValida(v.fim)) erros.push('fim-invalido');
  else if (v.fim !== null && dataCivilValida(v.inicio) && v.fim < v.inicio) erros.push('fim-antes-do-inicio');
}

export interface EntradaEquipe {
  readonly codigo: string;
  readonly nome: string;
  readonly tipo: string;
  readonly vigencia: VigenciaVinculo;
}

/** Normaliza o código da equipe: maiúsculas, sem espaço nas pontas e espaços internos trocados por hífen. */
export function normalizarCodigoEquipe(codigo: string): string {
  return codigo.trim().toUpperCase().replace(/\s+/g, '-');
}

/** Erros do cadastro da equipe (códigos estáveis, para a tela e o servidor). */
export function errosEquipe(e: EntradaEquipe): string[] {
  const erros: string[] = [];
  const codigo = normalizarCodigoEquipe(e.codigo);
  if (!codigo) erros.push('codigo-ausente');
  else if (codigo.length > 30) erros.push('codigo-longo');
  const nome = e.nome.trim();
  if (nome.length < 3) erros.push('nome-curto');
  else if (nome.length > 150) erros.push('nome-longo');
  if (!(TIPOS_EQUIPE as readonly string[]).includes(e.tipo)) erros.push('tipo-invalido');
  errosVigencia(e.vigencia, erros);
  return erros;
}

/** Vínculo já gravado de um profissional (na equipe ou na cooperativa), para conferir a sobreposição. */
export interface VinculoExistente extends VigenciaVinculo {
  readonly id: number;
  readonly profissionalId: number;
  readonly papel?: string;
}

export interface EntradaMembroEquipe {
  readonly profissionalId: number;
  readonly papel: string;
  readonly vigencia: VigenciaVinculo;
}

/**
 * Erros da inclusão de um membro: papel válido, vigência dentro da vigência da equipe, nenhum outro período do mesmo
 * profissional sobreposto na equipe e, para o papel de responsável, nenhum outro responsável no mesmo período.
 */
export function errosMembroEquipe(
  m: EntradaMembroEquipe,
  equipe: VigenciaVinculo,
  existentes: readonly VinculoExistente[],
): string[] {
  const erros: string[] = [];
  if (!(PAPEIS_MEMBRO_EQUIPE as readonly string[]).includes(m.papel)) erros.push('papel-invalido');
  errosVigencia(m.vigencia, erros);
  if (erros.some((x) => x.startsWith('inicio') || x.startsWith('fim'))) return erros;
  if (!vigenciaDentro(m.vigencia, equipe)) erros.push('fora-da-vigencia-equipe');
  if (existentes.some((x) => x.profissionalId === m.profissionalId && vigenciasSobrepostas(x, m.vigencia)))
    erros.push('vigencia-sobreposta');
  if (
    m.papel === 'responsavel' &&
    existentes.some(
      (x) =>
        x.papel === 'responsavel' &&
        x.profissionalId !== m.profissionalId &&
        vigenciasSobrepostas(x, m.vigencia),
    )
  )
    erros.push('responsavel-duplicado');
  return erros;
}

/** Erros do encerramento de um vínculo (membro ou cooperado): o fim só antecipa e não vem antes do início. */
export function errosEncerramento(v: VigenciaVinculo, fimNovo: string): string[] {
  if (!dataCivilValida(fimNovo)) return ['fim-invalido'];
  if (fimNovo < v.inicio) return ['fim-antes-do-inicio'];
  if (v.fim !== null && fimNovo >= v.fim) return ['encerramento-nao-antecipa'];
  return [];
}

/** Erros da mudança da vigência da equipe: os membros em vigor precisam caber no novo fim. */
export function errosFimEquipe(equipe: VigenciaVinculo, membros: readonly VigenciaVinculo[]): string[] {
  if (equipe.fim === null) return [];
  return membros.some((m) => m.fim === null || m.fim > equipe.fim!) ? ['membros-apos-fim-equipe'] : [];
}

export interface EntradaCooperativa {
  readonly cnpj: string;
  readonly razaoSocial: string;
  readonly nome: string;
  readonly percentualRepasse: number | null;
  readonly bancoId: number | null;
  readonly agencia: string | null;
  readonly conta: string | null;
  readonly tipoConta: string | null;
  readonly retemIr: boolean;
  readonly aliquotas: Readonly<Record<string, number | null>>;
}

/** Erros do cadastro da cooperativa médica. */
export function errosCooperativa(c: EntradaCooperativa): string[] {
  const erros: string[] = [];
  if (!cnpjValido(somenteDigitos(c.cnpj))) erros.push('cnpj-invalido');
  if (c.razaoSocial.trim().length < 3) erros.push('razao-curta');
  else if (c.razaoSocial.trim().length > 250) erros.push('razao-longa');
  if (c.nome.trim().length < 3) erros.push('nome-curto');
  else if (c.nome.trim().length > 150) erros.push('nome-longo');
  const pct = [c.percentualRepasse, ...Object.values(c.aliquotas)];
  if (pct.some((x) => x !== null && (!Number.isFinite(x) || x < 0 || x > 100)))
    erros.push('percentual-invalido');
  const banco = [c.bancoId, c.agencia?.trim() || null, c.conta?.trim() || null];
  if (banco.some((x) => x !== null) && banco.some((x) => x === null)) erros.push('conta-incompleta');
  if (c.tipoConta !== null && !(TIPOS_CONTA_COOPERATIVA as readonly string[]).includes(c.tipoConta))
    erros.push('tipo-conta-invalido');
  if (!c.retemIr && (c.aliquotas['ir'] ?? null) !== null && c.aliquotas['ir']! > 0)
    erros.push('ir-sem-retencao');
  return erros;
}

export interface EntradaCooperado {
  readonly profissionalId: number;
  readonly vigencia: VigenciaVinculo;
}

/** Erros da inclusão de um cooperado: vigência válida e sem sobreposição na mesma cooperativa. */
export function errosCooperado(c: EntradaCooperado, existentes: readonly VinculoExistente[]): string[] {
  const erros: string[] = [];
  errosVigencia(c.vigencia, erros);
  if (erros.length) return erros;
  if (existentes.some((x) => x.profissionalId === c.profissionalId && vigenciasSobrepostas(x, c.vigencia)))
    erros.push('vigencia-sobreposta');
  return erros;
}

/**
 * Responsável da equipe em vigor na data, derivado dos membros: o membro com papel de responsável cuja vigência vale na
 * data. Sem nenhum período de responsável registrado entre os membros, vale o responsável informado na própria equipe
 * (`legado`, como o que chega pela importação); havendo períodos e nenhum em vigor na data, a equipe está sem
 * responsável. Assim o responsável com início futuro passa a valer quando a data chega, e o encerrado deixa de valer no
 * dia seguinte ao fim, sem depender de uma gravação no dia.
 */
export function responsavelVigenteEm(
  membros: readonly VinculoExistente[],
  data: string,
  legado: number | null,
): number | null {
  const resp = membros.filter((m) => m.papel === 'responsavel');
  if (!resp.length) return legado;
  return resp.find((m) => vinculoVigenteEm(m, data))?.profissionalId ?? null;
}

/**
 * Erros do responsável informado na equipe sem período de responsável entre os membros (o que vem da importação): outro
 * profissional só assume como responsável depois de o atual ser registrado como membro responsável, com a vigência, e
 * encerrado. O próprio responsável pode ser registrado.
 */
export function errosResponsavelSemVinculo(
  m: EntradaMembroEquipe,
  membros: readonly VinculoExistente[],
  legado: number | null,
): string[] {
  if (m.papel !== 'responsavel' || legado === null || legado === m.profissionalId) return [];
  const registrado = membros.some((x) => x.papel === 'responsavel' && x.profissionalId === legado);
  return registrado ? [] : ['responsavel-sem-vinculo'];
}
