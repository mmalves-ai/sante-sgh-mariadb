// Cadastro único de feriados e dias não úteis (F3.1, 02-CAD linha 28): o que a gravação confere antes de ir ao banco e
// o que a tela mostra na hora. A leitura de quais dias a agenda pula continua em `diasSemExpediente`.
//
// Regras:
//   - descrição de 3 a 150 letras;
//   - abrangência com o alvo certo: nacional sem alvo, estadual com a UF, municipal com o município (a UF fica
//     vazia), estabelecimento com o estabelecimento;
//   - recorrência anual guarda dia e mês (o dia tem de existir no mês; 29/02 vale e só cai nos anos bissextos); data
//     única e móvel guardam a data;
//   - período do dia (meio expediente): início e fim juntos, fim depois do início; vazio = o dia inteiro;
//   - o mesmo dia não se cadastra duas vezes para o mesmo alvo (anual contra anual pelo dia e mês; data contra data;
//     data contra anual quando o dia e o mês coincidem), a não ser que um seja só uma faixa de horas e o outro também
//     e as faixas não se cruzem;
//   - móvel: a data sai da Páscoa do ano (Carnaval, Sexta-feira Santa, Páscoa, Corpus Christi), gravada uma linha por
//     ano; gerar de novo um ano que já tem a linha não duplica.
import { pascoa } from './grade.js';
import type { Abrangencia } from './dias-sem-expediente.js';

export type RecorrenciaDiaNaoUtil = 'anual' | 'data_unica' | 'movel';
export type BaseMovel = 'carnaval' | 'sexta_santa' | 'pascoa' | 'corpus_christi';

export interface EntradaDiaNaoUtil {
  readonly descricao: string;
  readonly abrangencia: Abrangencia;
  readonly ufId: number | null;
  readonly municipio: number | null;
  readonly estabelecimento: number | null;
  readonly recorrencia: RecorrenciaDiaNaoUtil;
  readonly dia: number | null;
  readonly mes: number | null;
  readonly data: string | null;
  readonly facultativo: boolean;
  readonly horaInicio: string | null;
  readonly horaFim: string | null;
}

export interface DiaNaoUtilExistente extends EntradaDiaNaoUtil {
  readonly id: number;
}

export type ErroDiaNaoUtil =
  | 'descricao-curta'
  | 'descricao-longa'
  | 'abrangencia-invalida'
  | 'uf-ausente'
  | 'municipio-ausente'
  | 'estabelecimento-ausente'
  | 'alvo-a-mais'
  | 'recorrencia-invalida'
  | 'dia-mes-invalido'
  | 'data-invalida'
  | 'data-com-dia-mes'
  | 'hora-incompleta'
  | 'hora-invalida'
  | 'hora-invertida';

const ABRANGENCIAS: readonly Abrangencia[] = ['nacional', 'estadual', 'municipal', 'estabelecimento'];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DIAS_DO_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** AAAA-MM-DD que existe no calendário. */
export function dataValida(d: string | null): boolean {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [a, m, dd] = d.split('-').map(Number) as [number, number, number];
  const x = new Date(Date.UTC(a, m - 1, dd));
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === dd;
}

/** Todos os erros da entrada de uma vez (a tela marca cada campo). */
export function errosDiaNaoUtil(e: EntradaDiaNaoUtil): ErroDiaNaoUtil[] {
  const erros: ErroDiaNaoUtil[] = [];
  const d = e.descricao.trim();
  if (d.length < 3) erros.push('descricao-curta');
  if (d.length > 150) erros.push('descricao-longa');
  if (!ABRANGENCIAS.includes(e.abrangencia)) erros.push('abrangencia-invalida');
  else {
    if (e.abrangencia === 'estadual' && e.ufId == null) erros.push('uf-ausente');
    if (e.abrangencia === 'municipal' && e.municipio == null) erros.push('municipio-ausente');
    if (e.abrangencia === 'estabelecimento' && e.estabelecimento == null)
      erros.push('estabelecimento-ausente');
    const sobra =
      (e.abrangencia === 'nacional' &&
        (e.ufId != null || e.municipio != null || e.estabelecimento != null)) ||
      (e.abrangencia === 'estadual' && (e.municipio != null || e.estabelecimento != null)) ||
      (e.abrangencia === 'municipal' && (e.ufId != null || e.estabelecimento != null)) ||
      (e.abrangencia === 'estabelecimento' && (e.ufId != null || e.municipio != null));
    if (sobra) erros.push('alvo-a-mais');
  }
  if (e.recorrencia === 'anual') {
    if (
      e.dia == null ||
      e.mes == null ||
      !Number.isInteger(e.mes) ||
      e.mes < 1 ||
      e.mes > 12 ||
      !Number.isInteger(e.dia) ||
      e.dia < 1 ||
      e.dia > DIAS_DO_MES[e.mes - 1]!
    )
      erros.push('dia-mes-invalido');
    if (e.data != null) erros.push('data-com-dia-mes');
  } else if (e.recorrencia === 'data_unica' || e.recorrencia === 'movel') {
    if (!dataValida(e.data)) erros.push('data-invalida');
    if (e.dia != null || e.mes != null) erros.push('data-com-dia-mes');
  } else erros.push('recorrencia-invalida');
  if ((e.horaInicio == null) !== (e.horaFim == null)) erros.push('hora-incompleta');
  else if (e.horaInicio != null && e.horaFim != null) {
    if (!HORA.test(e.horaInicio) || !HORA.test(e.horaFim)) erros.push('hora-invalida');
    else if (e.horaFim <= e.horaInicio) erros.push('hora-invertida');
  }
  return erros;
}

const mesmoAlvo = (a: EntradaDiaNaoUtil, b: EntradaDiaNaoUtil): boolean =>
  a.abrangencia === b.abrangencia &&
  a.ufId === b.ufId &&
  a.municipio === b.municipio &&
  a.estabelecimento === b.estabelecimento;

/** Dia e mês (MM-DD) da entrada: o da recorrência anual ou o da data. */
const diaMes = (e: EntradaDiaNaoUtil): string | null =>
  e.recorrencia === 'anual'
    ? e.mes != null && e.dia != null
      ? `${String(e.mes).padStart(2, '0')}-${String(e.dia).padStart(2, '0')}`
      : null
    : (e.data?.slice(5) ?? null);

function mesmoDia(a: EntradaDiaNaoUtil, b: EntradaDiaNaoUtil): boolean {
  if (a.recorrencia !== 'anual' && b.recorrencia !== 'anual') return a.data != null && a.data === b.data;
  const x = diaMes(a);
  return x != null && x === diaMes(b);
}

function faixasSeCruzam(a: EntradaDiaNaoUtil, b: EntradaDiaNaoUtil): boolean {
  // Dia inteiro cruza com tudo.
  if (a.horaInicio == null || b.horaInicio == null) return true;
  return a.horaInicio < (b.horaFim ?? '24:00') && b.horaInicio < (a.horaFim ?? '24:00');
}

/** O cadastro ativo que já cobre o mesmo dia, para o mesmo alvo (a gravação recusa); `ignorar` é o próprio, na alteração. */
export function duplicadoDe(
  existentes: readonly DiaNaoUtilExistente[],
  novo: EntradaDiaNaoUtil,
  ignorar: number | null = null,
): DiaNaoUtilExistente | null {
  return (
    existentes.find(
      (x) => x.id !== ignorar && mesmoAlvo(x, novo) && mesmoDia(x, novo) && faixasSeCruzam(x, novo),
    ) ?? null
  );
}

function somar(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Data da base móvel no ano, pela Páscoa. */
export function dataMovel(base: BaseMovel, ano: number): string {
  const p = pascoa(ano);
  switch (base) {
    case 'carnaval':
      return somar(p, -47);
    case 'sexta_santa':
      return somar(p, -2);
    case 'pascoa':
      return p;
    case 'corpus_christi':
      return somar(p, 60);
  }
}

export const NOME_BASE_MOVEL: Readonly<Record<BaseMovel, string>> = {
  carnaval: 'Carnaval',
  sexta_santa: 'Sexta-feira Santa',
  pascoa: 'Páscoa',
  corpus_christi: 'Corpus Christi',
};

/** Datas móveis de `de` a `ate` (inclusive, no máximo 20 anos), uma por ano. */
export function datasMoveis(base: BaseMovel, de: number, ate: number): string[] {
  if (!Number.isInteger(de) || !Number.isInteger(ate) || ate < de || ate - de > 19) return [];
  const r: string[] = [];
  for (let a = de; a <= ate; a++) r.push(dataMovel(base, a));
  return r;
}

/** Ocorrências do cadastro entre `de` e `ate` (AAAA-MM-DD), para a visão do ano na tela; 29/02 só em ano bissexto. */
export function ocorrencias(e: EntradaDiaNaoUtil, de: string, ate: string): string[] {
  if (e.recorrencia !== 'anual') return e.data && e.data >= de && e.data <= ate ? [e.data] : [];
  const r: string[] = [];
  for (let a = Number(de.slice(0, 4)); a <= Number(ate.slice(0, 4)); a++) {
    const d = `${a}-${diaMes(e)}`;
    if (dataValida(d) && d >= de && d <= ate) r.push(d);
  }
  return r;
}
