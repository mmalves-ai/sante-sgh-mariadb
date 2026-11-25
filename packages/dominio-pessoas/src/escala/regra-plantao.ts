// Remuneração do plantão pela regra de plantão do repasse (C2-100, 06-FAT linha 47): a regra cadastrada por
// profissional, escala, setor ou especialidade dá o valor do plantão realizado aprovado, no lugar da tarifa geral por
// hora. Desenho próprio:
//   - a regra que vale é a MAIS ESPECÍFICA entre as vigentes no dia do plantão (profissional > escala > setor >
//     especialidade; o dia da semana desempata como recorte a mais); empate: a de início de vigência mais recente,
//     depois a de maior id (a última cadastrada);
//   - o tipo de dia é feriado (pela agenda de feriados do estabelecimento), fim de semana (sábado ou domingo) ou útil;
//     o valor do feriado é o próprio, ou o padrão acrescido do percentual de feriado, ou o de fim de semana, ou o
//     padrão; o de fim de semana é o próprio ou o padrão; o fator multiplica o valor do dia;
//   - por plantão: o valor do dia vale pelas horas do plantão; trabalhar menos que o previsto além da tolerância
//     desconta na proporção; por hora: o valor do dia vezes as horas trabalhadas dentro do horário previsto;
//   - hora extra antes do início e depois do fim previstos (além da tolerância) paga pelo valor da hora extra, ou pela
//     hora do dia acrescida do percentual; sem valor nem percentual, o excedente não é pago;
//   - a conta sai escrita, parcela por parcela (toda soma com as parcelas impressas).
// Sem I/O: a porta lê as regras, os feriados e os horários e entrega aqui.
import { type RecusaSesmt, recusaSesmt } from '../sesmt/recusa.js';

export type FormaRegraPlantao = 'por_plantao' | 'por_hora';

export interface RegraPlantaoLida {
  readonly id: number;
  readonly descricao: string;
  readonly profissional: number | null;
  readonly escala: number | null;
  readonly setor: number | null;
  readonly especialidade: number | null;
  /** 1 domingo a 7 sábado; null: todos os dias. */
  readonly diaSemana: number | null;
  readonly forma: FormaRegraPlantao;
  readonly horasPlantao: number | null;
  readonly valorPadrao: number;
  readonly valorFimSemana: number | null;
  readonly valorFeriado: number | null;
  readonly percentualFeriado: number | null;
  readonly fator: number | null;
  readonly valorHoraExtraAntes: number | null;
  readonly percentualHoraExtraAntes: number | null;
  readonly valorHoraExtraDepois: number | null;
  readonly percentualHoraExtraDepois: number | null;
  readonly toleranciaMinutos: number;
  readonly inicio: string;
  readonly fim: string | null;
}

/** O plantão realizado para a regra: recortes, horário previsto e real (civis, no fuso do estabelecimento). */
export interface PlantaoParaRegra {
  readonly profissional: number | null;
  readonly escala: number;
  readonly setor: number;
  readonly especialidade: number | null;
  readonly previstoInicio: string;
  readonly previstoFim: string;
  readonly realInicio: string;
  readonly realFim: string;
}

export type TipoDiaPlantao = 'util' | 'fim_semana' | 'feriado';

export interface ValorRegraPlantao {
  readonly regra: number;
  readonly tipoDia: TipoDiaPlantao;
  readonly valor: number;
  /** A conta escrita, parcela por parcela. */
  readonly parcelas: string;
}

const minutoCivil = (s: string) => Math.round(Date.parse(`${s.slice(0, 16)}:00Z`) / 60000);
const diaDaSemana = (data: string) => new Date(`${data}T12:00:00Z`).getUTCDay() + 1;
const centavos = (v: number) => Math.round(v * 100);
const reais = (c: number) =>
  `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const horas = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
};
const numero = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });

function especificidade(r: RegraPlantaoLida): number {
  return (
    (r.profissional !== null ? 16 : 0) +
    (r.escala !== null ? 8 : 0) +
    (r.setor !== null ? 4 : 0) +
    (r.especialidade !== null ? 2 : 0) +
    (r.diaSemana !== null ? 1 : 0)
  );
}

/** A regra mais específica vigente no dia do plantão que alcança os recortes dele, ou null. */
export function regraPlantaoAplicavel<T extends RegraPlantaoLida>(
  regras: readonly T[],
  p: PlantaoParaRegra,
): T | null {
  const dia = p.previstoInicio.slice(0, 10);
  const semana = diaDaSemana(dia);
  const alcancam = regras.filter(
    (r) =>
      r.inicio <= dia &&
      (r.fim === null || dia <= r.fim) &&
      (r.diaSemana === null || r.diaSemana === semana) &&
      (r.profissional === null || r.profissional === p.profissional) &&
      (r.escala === null || r.escala === p.escala) &&
      (r.setor === null || r.setor === p.setor) &&
      (r.especialidade === null || r.especialidade === p.especialidade),
  );
  let melhor: T | null = null;
  for (const r of alcancam) {
    if (
      melhor === null ||
      especificidade(r) > especificidade(melhor) ||
      (especificidade(r) === especificidade(melhor) &&
        (r.inicio > melhor.inicio || (r.inicio === melhor.inicio && r.id > melhor.id)))
    )
      melhor = r;
  }
  return melhor;
}

export function tipoDiaPlantao(data: string, feriados: ReadonlySet<string>): TipoDiaPlantao {
  if (feriados.has(data)) return 'feriado';
  const s = diaDaSemana(data);
  return s === 1 || s === 7 ? 'fim_semana' : 'util';
}

const NOME_DIA: Record<TipoDiaPlantao, string> = {
  util: 'dia útil',
  fim_semana: 'fim de semana',
  feriado: 'feriado',
};

/** O valor do dia (em centavos) e a origem escrita dele, antes do fator. */
function valorDoDia(r: RegraPlantaoLida, tipo: TipoDiaPlantao): { c: number; texto: string } {
  const padrao = centavos(r.valorPadrao);
  if (tipo === 'feriado') {
    if (r.valorFeriado !== null)
      return { c: centavos(r.valorFeriado), texto: `valor de feriado ${reais(centavos(r.valorFeriado))}` };
    if (r.percentualFeriado !== null) {
      const c = Math.round(padrao * (1 + r.percentualFeriado / 100));
      return { c, texto: `${reais(padrao)} + ${numero(r.percentualFeriado)}% de feriado = ${reais(c)}` };
    }
  }
  if (tipo !== 'util' && r.valorFimSemana !== null)
    return {
      c: centavos(r.valorFimSemana),
      texto: `valor de fim de semana ${reais(centavos(r.valorFimSemana))}`,
    };
  return { c: padrao, texto: `valor padrão ${reais(padrao)}` };
}

/** O valor do plantão realizado pela regra, com a conta escrita. */
export function valorPelaRegraPlantao(
  r: RegraPlantaoLida,
  p: PlantaoParaRegra,
  feriados: ReadonlySet<string>,
): ValorRegraPlantao {
  const tipoDia = tipoDiaPlantao(p.previstoInicio.slice(0, 10), feriados);
  const dia = valorDoDia(r, tipoDia);
  const fatorado = r.fator !== null ? Math.round(dia.c * r.fator) : dia.c;
  const partes: string[] = [`${NOME_DIA[tipoDia]}: ${dia.texto}`];
  if (r.fator !== null) partes.push(`× fator ${numero(r.fator)} = ${reais(fatorado)}`);
  const pi = minutoCivil(p.previstoInicio);
  const pf = minutoCivil(p.previstoFim);
  const ri = minutoCivil(p.realInicio);
  const rf = minutoCivil(p.realFim);
  const dentro = Math.max(0, Math.min(pf, rf) - Math.max(pi, ri));
  const previsto = Math.max(0, pf - pi);
  const tol = r.toleranciaMinutos;
  let base: number;
  let horaDoDia: number;
  if (r.forma === 'por_hora') {
    const pago = previsto - dentro <= tol ? previsto : dentro;
    base = Math.round((pago * fatorado) / 60);
    horaDoDia = fatorado;
    partes.push(`${horas(pago)} × ${reais(fatorado)}/h = ${reais(base)}`);
  } else {
    const minPlantao = Math.round((r.horasPlantao ?? previsto / 60) * 60);
    horaDoDia = minPlantao > 0 ? fatorado / (minPlantao / 60) : 0;
    if (previsto - dentro > tol && minPlantao > 0) {
      const pago = Math.min(dentro, minPlantao);
      base = Math.round((fatorado * pago) / minPlantao);
      partes.push(
        `plantão de ${horas(minPlantao)} com ${horas(pago)} trabalhadas: ${reais(fatorado)} × ${horas(pago)} / ${horas(minPlantao)} = ${reais(base)}`,
      );
    } else {
      base = fatorado;
      partes.push(`plantão de ${horas(minPlantao)} = ${reais(base)}`);
    }
  }
  let total = base;
  const extra = (min: number, valor: number | null, pct: number | null, nome: string) => {
    if (min <= tol || (valor === null && pct === null)) return;
    const hora = valor !== null ? centavos(valor) : Math.round(horaDoDia * (1 + (pct ?? 0) / 100));
    const c = Math.round((min * hora) / 60);
    total += c;
    partes.push(`+ hora extra ${nome} ${horas(min)} × ${reais(hora)}/h = ${reais(c)}`);
  };
  extra(Math.max(0, pi - ri), r.valorHoraExtraAntes, r.percentualHoraExtraAntes, 'antes do início');
  extra(Math.max(0, rf - pf), r.valorHoraExtraDepois, r.percentualHoraExtraDepois, 'depois do fim');
  return {
    regra: r.id,
    tipoDia,
    valor: total / 100,
    parcelas: `Regra "${r.descricao}" — ${partes.join('; ')}; total ${reais(total)}`,
  };
}

/** A regra nova: um recorte ao menos, horas no plantão por plantão, valores e percentuais válidos, vigência em ordem. */
export function conferirRegraPlantao(e: Omit<RegraPlantaoLida, 'id'>): RecusaSesmt | null {
  if (!e.descricao.trim()) return recusaSesmt('descricao-obrigatoria', 'Dê um nome à regra.', 'descricao');
  if (e.profissional === null && e.escala === null && e.setor === null)
    return recusaSesmt(
      'recorte-obrigatorio',
      'Escolha o profissional, a escala ou o setor que a regra alcança.',
      'setor',
    );
  if (e.forma === 'por_plantao' && !(e.horasPlantao !== null && e.horasPlantao > 0))
    return recusaSesmt('horas-obrigatorias', 'Informe as horas do plantão.', 'horasPlantao');
  if (!(e.valorPadrao > 0))
    return recusaSesmt('valor-invalido', 'Informe o valor do dia útil.', 'valorPadrao');
  for (const [campo, v] of [
    ['valorFimSemana', e.valorFimSemana],
    ['valorFeriado', e.valorFeriado],
    ['valorHoraExtraAntes', e.valorHoraExtraAntes],
    ['valorHoraExtraDepois', e.valorHoraExtraDepois],
    ['percentualFeriado', e.percentualFeriado],
    ['percentualHoraExtraAntes', e.percentualHoraExtraAntes],
    ['percentualHoraExtraDepois', e.percentualHoraExtraDepois],
  ] as const)
    if (v !== null && v < 0) return recusaSesmt('valor-negativo', 'O valor não pode ser negativo.', campo);
  if (e.fator !== null && !(e.fator > 0))
    return recusaSesmt('fator-invalido', 'O fator é maior que zero.', 'fator');
  if (e.fim !== null && e.fim < e.inicio)
    return recusaSesmt('periodo-invalido', 'O fim da vigência vem antes do início.', 'fim');
  return null;
}
