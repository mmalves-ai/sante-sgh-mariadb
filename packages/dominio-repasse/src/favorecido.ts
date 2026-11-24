// Para quem vai o repasse do profissional e o cadastro do prestador terceiro (F3.7, 06-FAT linha 46). Regras puras:
//   - o favorecido aponta exatamente o alvo do seu tipo (o próprio profissional, a empresa dele, a cooperativa ou outro
//     profissional), com a parte do repasse (0 < % ≤ 100) e a vigência; o terceiro profissional não é o titular;
//   - um favorecido novo do mesmo tipo e da mesma fonte pagadora não sobrescreve o anterior: a vigência do anterior
//     aberto termina no dia de antes (o histórico fica, nada é apagado);
//   - a soma das partes dos favorecidos que valem num mesmo dia (para a mesma fonte, ou para todas) não passa de 100%;
//   - o prestador terceiro tem o documento do tipo de pessoa com dígito válido, o CNES com 7 dígitos, o percentual de
//     repasse entre 0 e 100 e a base de cálculo conhecida.
import { cnpjValido, cpfValido } from '@sgh/contratos';

export type TipoFavorecido =
  'proprio_profissional' | 'pessoa_juridica' | 'cooperativa' | 'terceiro_profissional';
export const TIPOS_FAVORECIDO: readonly TipoFavorecido[] = [
  'proprio_profissional',
  'pessoa_juridica',
  'cooperativa',
  'terceiro_profissional',
];

export interface ProblemaCampo {
  readonly campo: string;
  readonly mensagem: string;
}

export interface FavorecidoNovo {
  readonly profissional: number;
  readonly fontePagadora: number | null;
  readonly tipo: TipoFavorecido;
  readonly pessoaJuridica: number | null;
  readonly cooperativa: number | null;
  readonly terceiroProfissional: number | null;
  readonly contaBancaria: number | null;
  readonly percentual: number;
  /** AAAA-MM-DD */
  readonly inicio: string;
  readonly fim: string | null;
}

/** Um favorecido já gravado do mesmo profissional, como a vigência e a parte o veem. */
export interface FavorecidoVigente {
  readonly id: number;
  readonly fontePagadora: number | null;
  readonly tipo: TipoFavorecido;
  readonly percentual: number;
  readonly inicio: string;
  readonly fim: string | null;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** O dia anterior a uma data AAAA-MM-DD (fuso neutro). */
export function diaAnterior(data: string): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function validarFavorecido(f: FavorecidoNovo): ProblemaCampo[] {
  const p: ProblemaCampo[] = [];
  const alvo = {
    pessoaJuridica: f.pessoaJuridica !== null,
    cooperativa: f.cooperativa !== null,
    terceiroProfissional: f.terceiroProfissional !== null,
  };
  const esperado: Record<TipoFavorecido, keyof typeof alvo | null> = {
    proprio_profissional: null,
    pessoa_juridica: 'pessoaJuridica',
    cooperativa: 'cooperativa',
    terceiro_profissional: 'terceiroProfissional',
  };
  const quer = esperado[f.tipo];
  for (const k of Object.keys(alvo) as (keyof typeof alvo)[]) {
    if (k === quer && !alvo[k]) p.push({ campo: k, mensagem: 'Informe o favorecido do tipo escolhido.' });
    if (k !== quer && alvo[k])
      p.push({ campo: k, mensagem: 'Este campo não vale para o tipo de favorecido escolhido.' });
  }
  if (f.tipo === 'terceiro_profissional' && f.terceiroProfissional === f.profissional)
    p.push({
      campo: 'terceiroProfissional',
      mensagem: 'O terceiro não pode ser o próprio profissional (use o tipo próprio).',
    });
  if (!(f.percentual > 0 && f.percentual <= 100))
    p.push({ campo: 'percentual', mensagem: 'A parte do repasse fica entre 0 (exclusive) e 100%.' });
  if (!DATA.test(f.inicio)) p.push({ campo: 'inicio', mensagem: 'Informe o início da vigência.' });
  if (f.fim !== null && (!DATA.test(f.fim) || f.fim < f.inicio))
    p.push({ campo: 'fim', mensagem: 'O fim da vigência não pode ser antes do início.' });
  return p;
}

const valeNoDia = (v: { inicio: string; fim: string | null }, dia: string) =>
  v.inicio <= dia && (v.fim === null || v.fim >= dia);

const mesmaFonteOuGeral = (a: number | null, b: number | null) => a === null || b === null || a === b;

export interface PlanoFavorecido {
  /** Os anteriores abertos do mesmo tipo e fonte que terminam no dia de antes do novo início. */
  readonly encerrar: readonly { id: number; fim: string }[];
  readonly problemas: readonly ProblemaCampo[];
}

/**
 * O que gravar ao incluir um favorecido: os anteriores do mesmo tipo e fonte, abertos ou que alcançam o novo início,
 * terminam no dia de antes (o que começa no mesmo dia ou depois é conflito); a soma das partes que valem em cada dia de
 * início do período não passa de 100%.
 */
export function planejarFavorecido(
  novo: FavorecidoNovo,
  existentes: readonly FavorecidoVigente[],
): PlanoFavorecido {
  const problemas = [...validarFavorecido(novo)];
  if (problemas.length) return { encerrar: [], problemas };
  const encerrar: { id: number; fim: string }[] = [];
  const depois = new Map<number, string | null>();
  for (const e of existentes) {
    if (e.tipo !== novo.tipo || e.fontePagadora !== novo.fontePagadora) continue;
    if (e.fim !== null && e.fim < novo.inicio) continue;
    if (e.inicio >= novo.inicio) {
      problemas.push({
        campo: 'inicio',
        mensagem: 'Já existe favorecido deste tipo começando nesta data ou depois; encerre-o antes.',
      });
      continue;
    }
    const fim = diaAnterior(novo.inicio);
    encerrar.push({ id: e.id, fim });
    depois.set(e.id, fim);
  }
  if (problemas.length) return { encerrar: [], problemas };
  const vigencias = existentes.map((e) => ({ ...e, fim: depois.has(e.id) ? depois.get(e.id)! : e.fim }));
  const dias = new Set([novo.inicio, ...vigencias.map((v) => v.inicio).filter((d) => d > novo.inicio)]);
  for (const dia of [...dias].sort()) {
    if (!valeNoDia(novo, dia)) continue;
    const soma =
      novo.percentual +
      vigencias
        .filter((v) => valeNoDia(v, dia) && mesmaFonteOuGeral(v.fontePagadora, novo.fontePagadora))
        .reduce((t, v) => t + v.percentual, 0);
    if (soma > 100 + 1e-9) {
      problemas.push({
        campo: 'percentual',
        mensagem: `A soma das partes dos favorecidos em ${dia} passaria de 100% (${soma.toFixed(2)}%).`,
      });
      break;
    }
  }
  return problemas.length ? { encerrar: [], problemas } : { encerrar, problemas: [] };
}

// ── Prestador terceiro ─────────────────────────────────────────────────────────────────────────────────────────

export type BaseRepassePrestador = 'cobrado' | 'recebido' | 'misto';

export interface PrestadorTerceiroNovo {
  readonly codigo: string;
  readonly nome: string;
  readonly tipoPessoa: 'fisica' | 'juridica';
  readonly cpf: string | null;
  readonly cnpj: string | null;
  readonly cnes: string | null;
  readonly percentualRepasse: number | null;
  readonly baseRepasse: BaseRepassePrestador;
  readonly email: string | null;
}

export function validarPrestadorTerceiro(e: PrestadorTerceiroNovo): ProblemaCampo[] {
  const p: ProblemaCampo[] = [];
  if (!e.codigo.trim()) p.push({ campo: 'codigo', mensagem: 'Informe o código do prestador.' });
  if (e.nome.trim().length < 3) p.push({ campo: 'nome', mensagem: 'Informe o nome do prestador.' });
  if (e.tipoPessoa === 'fisica') {
    if (!e.cpf || !cpfValido(e.cpf)) p.push({ campo: 'cpf', mensagem: 'CPF inválido.' });
    if (e.cnpj) p.push({ campo: 'cnpj', mensagem: 'Pessoa física não tem CNPJ.' });
  } else {
    if (!e.cnpj || !cnpjValido(e.cnpj)) p.push({ campo: 'cnpj', mensagem: 'CNPJ inválido.' });
    if (e.cpf) p.push({ campo: 'cpf', mensagem: 'Pessoa jurídica não tem CPF.' });
  }
  if (e.cnes !== null && !/^\d{7}$/.test(e.cnes))
    p.push({ campo: 'cnes', mensagem: 'O CNES tem 7 dígitos.' });
  if (e.percentualRepasse !== null && !(e.percentualRepasse >= 0 && e.percentualRepasse <= 100))
    p.push({ campo: 'percentualRepasse', mensagem: 'O percentual de repasse fica entre 0 e 100.' });
  if (!['cobrado', 'recebido', 'misto'].includes(e.baseRepasse))
    p.push({ campo: 'baseRepasse', mensagem: 'Base de repasse desconhecida.' });
  if (e.email !== null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.email))
    p.push({ campo: 'email', mensagem: 'E-mail inválido.' });
  return p;
}
