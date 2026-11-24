// Para quem vai o repasse do profissional e o cadastro do prestador terceiro (F3.7, 06-FAT linha 46). Regras puras:
//   - o favorecido aponta exatamente o alvo do seu tipo (o próprio profissional, a empresa dele, a cooperativa ou outro
//     profissional), com a parte do repasse (0 < % ≤ 100) e a vigência; o terceiro profissional não é o titular;
//   - um favorecido novo do mesmo tipo e da mesma fonte pagadora não sobrescreve o anterior: a vigência do anterior
//     aberto termina no dia de antes (o histórico fica, nada é apagado);
//   - o favorecido de uma fonte pagadora SUBSTITUI os gerais (fonte nula) naquela fonte: numa fonte com favorecido
//     próprio valem só os dela; nas demais, os gerais. Assim a cessão de crédito por convênio (100% à empresa naquela
//     fonte) convive com o geral (100% ao médico). A soma das partes não passa de 100% em cada fonte efetiva, por dia;
//   - o lançamento divide o valor pelas partes vigentes na data (centavo que sobra da divisão vai à maior parte); a
//     parte que falta para 100% vai ao próprio profissional quando ele é favorecido, senão o lançamento é recusado;
//   - encerrar só antecipa o fim (nunca estende nem reabre: prorrogar é incluir favorecido novo);
//   - a conta de crédito é do credor do tipo: própria e terceiro profissional pelo profissional; empresa e cooperativa
//     pelo fornecedor da pessoa jurídica (o mesmo cadastro que guarda o enquadramento e as retenções);
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

/** As partes que valem numa fonte efetiva (a fonte com favorecido próprio substitui os gerais) num dia. */
export function partesDaFonte<T extends { fontePagadora: number | null; inicio: string; fim: string | null }>(
  vigencias: readonly T[],
  fonte: number | null,
  dia: string,
): T[] {
  const doDia = vigencias.filter((v) => valeNoDia(v, dia));
  const daFonte = fonte === null ? [] : doDia.filter((v) => v.fontePagadora === fonte);
  return daFonte.length ? daFonte : doDia.filter((v) => v.fontePagadora === null);
}

export interface PlanoFavorecido {
  /** Os anteriores abertos do mesmo tipo e fonte que terminam no dia de antes do novo início. */
  readonly encerrar: readonly { id: number; fim: string }[];
  readonly problemas: readonly ProblemaCampo[];
}

/**
 * O que gravar ao incluir um favorecido: os anteriores do mesmo tipo e fonte, abertos ou que alcançam o novo início,
 * terminam no dia de antes (o que começa no mesmo dia ou depois é conflito); a soma das partes da fonte efetiva do novo
 * (a dele, ou a dos gerais) em cada dia de início do período não passa de 100%.
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
  const vigencias = existentes
    .map((e) => ({ ...e, fim: depois.has(e.id) ? depois.get(e.id)! : e.fim }))
    .filter((v) => v.fontePagadora === novo.fontePagadora);
  const dias = new Set([novo.inicio, ...vigencias.map((v) => v.inicio).filter((d) => d > novo.inicio)]);
  for (const dia of [...dias].sort()) {
    if (!valeNoDia(novo, dia)) continue;
    const soma =
      novo.percentual + vigencias.filter((v) => valeNoDia(v, dia)).reduce((t, v) => t + v.percentual, 0);
    if (soma > 100 + 1e-9) {
      problemas.push({
        campo: 'percentual',
        mensagem: `A soma das partes dos favorecidos ${
          novo.fontePagadora === null ? 'gerais' : 'desta fonte pagadora'
        } em ${dia} passaria de 100% (${soma.toFixed(2)}%).`,
      });
      break;
    }
  }
  return problemas.length ? { encerrar: [], problemas } : { encerrar, problemas: [] };
}

/** Encerrar só antecipa o fim: o novo fim fica entre o início e o fim atual (ou qualquer data, se aberto). */
export function validarEncerramento(
  atual: { inicio: string; fim: string | null },
  fim: string,
): ProblemaCampo[] {
  if (!DATA.test(fim)) return [{ campo: 'fim', mensagem: 'Informe a data do encerramento.' }];
  if (fim < atual.inicio)
    return [{ campo: 'fim', mensagem: 'O fim da vigência não pode ser antes do início.' }];
  if (atual.fim !== null && fim > atual.fim)
    return [
      {
        campo: 'fim',
        mensagem: `Encerrar só antecipa o fim (hoje ${atual.fim}); para estender, inclua um favorecido novo.`,
      },
    ];
  return [];
}

/** O credor que precisa ser o dono da conta de crédito do favorecido. */
export function donoDaConta(
  tipo: TipoFavorecido,
): 'profissional' | 'terceiro_profissional' | 'fornecedor_da_empresa' | 'fornecedor_da_cooperativa' {
  return {
    proprio_profissional: 'profissional',
    terceiro_profissional: 'terceiro_profissional',
    pessoa_juridica: 'fornecedor_da_empresa',
    cooperativa: 'fornecedor_da_cooperativa',
  }[tipo] as ReturnType<typeof donoDaConta>;
}

// ── Divisão do lançamento ──────────────────────────────────────────────────────────────────────────────────

export interface FavorecidoDaDivisao extends FavorecidoVigente {
  readonly contaBancaria: number | null;
}

export interface ParteDoRepasse {
  readonly favorecido: number;
  readonly tipo: TipoFavorecido;
  readonly percentual: number;
  /** Valor da parte em centavos (com o sinal do valor dividido). */
  readonly centavos: number;
}

export type DivisaoRepasse =
  | { readonly ok: true; readonly partes: readonly ParteDoRepasse[] }
  | {
      readonly ok: false;
      readonly codigo: 'sem-favorecido' | 'favorecidos-incompletos';
      readonly mensagem: string;
    };

/**
 * Divide o valor (centavos) pelos favorecidos da fonte efetiva vigentes no dia. A parte que falta para 100% vai ao
 * próprio profissional quando ele é favorecido; sem ele, recusa (o resto não teria destino). O centavo que sobra da
 * divisão vai à maior parte (a primeira: maior percentual, menor id).
 */
export function dividirRepasse(
  valorCentavos: number,
  favorecidos: readonly FavorecidoDaDivisao[],
  fonte: number | null,
  dia: string,
): DivisaoRepasse {
  const usar = partesDaFonte(favorecidos, fonte, dia)
    .map((f) => ({ ...f }))
    .sort((a, b) => b.percentual - a.percentual || a.id - b.id);
  if (!usar.length)
    return {
      ok: false,
      codigo: 'sem-favorecido',
      mensagem: 'O profissional não tem favorecido de repasse vigente.',
    };
  const soma = usar.reduce((t, f) => t + f.percentual, 0);
  if (soma < 100 - 1e-9) {
    const proprio = usar.find((f) => f.tipo === 'proprio_profissional');
    if (!proprio)
      return {
        ok: false,
        codigo: 'favorecidos-incompletos',
        mensagem: `As partes dos favorecidos vigentes somam ${soma.toFixed(2)}% e o próprio profissional não é favorecido para receber o resto.`,
      };
    (proprio as { percentual: number }).percentual += 100 - soma;
    usar.sort((a, b) => b.percentual - a.percentual || a.id - b.id);
  }
  const sinal = valorCentavos < 0 ? -1 : 1;
  const total = Math.abs(Math.round(valorCentavos));
  const brutas = usar.map((f) => Math.floor((total * f.percentual) / 100 + 1e-9));
  const sobra = total - brutas.reduce((t, v) => t + v, 0);
  brutas[0]! += sobra;
  return {
    ok: true,
    partes: usar.map((f, i) => ({
      favorecido: f.id,
      tipo: f.tipo,
      percentual: Math.round(f.percentual * 10000) / 10000,
      centavos: sinal * brutas[i]!,
    })),
  };
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

// ── Retenções do favorecido pessoa jurídica ────────────────────────────────────────────────────────────────

/** Um enquadramento tributário do fornecedor (o cadastro fiscal do contas a pagar), como a retenção o vê. */
export interface EnquadramentoDoFornecedor {
  readonly tributo: number | null;
  readonly regime: string;
  readonly retem: boolean;
  readonly aliquotaIss: number | null;
  readonly inicio: string;
  readonly fim: string | null;
}

export type SituacaoFiscalFavorecido =
  /** Pessoa física: as retenções saem das tabelas do autônomo (RPA). */
  | 'pessoa_fisica'
  /** A empresa não está no cadastro de fornecedores: não há como reter nem pagar pelo contas a pagar. */
  | 'sem_fornecedor'
  /** Fornecedor sem enquadramento vigente: a retenção usa a regra geral do tributo. */
  | 'sem_enquadramento'
  | 'enquadrado';

/**
 * As alíquotas e retenções do favorecido vêm do cadastro fiscal do fornecedor (um só lugar para o contas a pagar e o
 * repasse): a empresa do médico e a cooperativa pelo fornecedor da pessoa jurídica, o prestador terceiro pelo seu
 * fornecedor. Devolve a situação e os enquadramentos vigentes no dia.
 */
export function retencoesDoFavorecido(
  tipo: TipoFavorecido | 'prestador_terceiro',
  fornecedor: number | null,
  enquadramentos: readonly EnquadramentoDoFornecedor[],
  dia: string,
): { situacao: SituacaoFiscalFavorecido; vigentes: EnquadramentoDoFornecedor[] } {
  if (tipo === 'proprio_profissional' || tipo === 'terceiro_profissional')
    return { situacao: 'pessoa_fisica', vigentes: [] };
  if (fornecedor === null) return { situacao: 'sem_fornecedor', vigentes: [] };
  const vigentes = enquadramentos.filter((e) => valeNoDia(e, dia));
  return { situacao: vigentes.length ? 'enquadrado' : 'sem_enquadramento', vigentes };
}
