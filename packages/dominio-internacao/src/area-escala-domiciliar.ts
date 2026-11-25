// Áreas e escala da atenção domiciliar (C2-105, 03-PEP linha 143). Regras puras, sem banco. Referências públicas:
// RDC ANVISA 11/2006 (o serviço de atenção domiciliar define a área de abrangência e mantém a equipe responsável por
// ela, com escala que garanta a continuidade do cuidado) e Portaria GM/MS 825/2016 (equipes por território, com a
// população adscrita e a carga horária de cada profissional).
//   - área: código e descrição; as faixas de CEP têm 8 dígitos, início até o fim, não se sobrepõem dentro da área nem
//     com a de outra área ativa do estabelecimento (um endereço cai numa área só); o CEP do paciente acha a área pela
//     faixa mais estreita que o contém;
//   - profissional da área: vigência com o fim depois do início, prioridade de 1 a 99 e sem dois vínculos do mesmo
//     profissional na mesma área com vigências sobrepostas;
//   - escala: dia da semana (1 = domingo a 7 = sábado), turno com o fim depois do início, de 1 a 200 atendimentos,
//     vigência válida; o profissional não tem dois turnos sobrepostos no mesmo dia com vigências que se cruzam; na
//     escala de uma área, o profissional precisa estar vinculado à área na data de início;
//   - visita na escala: o horário da visita acha o turno do profissional (dia, hora, vigência, tipo de chamado);
//     com o turno lotado, a visita só entra como atendimento extra quando o turno o permite; fora de qualquer turno
//     a visita entra sem escala (o chamado urgente não espera a grade).

export interface ProblemaEscalaDomiciliar {
  readonly campo: string;
  readonly mensagem: string;
}

export const DIAS_SEMANA_ESCALA = [1, 2, 3, 4, 5, 6, 7] as const;
export const MAXIMO_ATENDIMENTOS_TURNO = 200;

const CEP = /^\d{8}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** CEP só com os 8 dígitos (aceita "01000-000"); null quando não forma um CEP. */
export function normalizarCep(cep: string | null | undefined): string | null {
  const d = (cep ?? '').replace(/\D/g, '');
  return CEP.test(d) ? d : null;
}

/** Hora "HH:MM" (os segundos, se vierem, caem). */
const hhmm = (h: string): string => h.slice(0, 5);
const minutos = (h: string): number => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/** Duas vigências [inicio, fim] (fim nulo = sem fim) se cruzam. */
export function vigenciasSeCruzam(
  a: { inicio: string; fim: string | null },
  b: { inicio: string; fim: string | null },
): boolean {
  return (a.fim === null || a.fim >= b.inicio) && (b.fim === null || b.fim >= a.inicio);
}

const conferirVigencia = (inicio: string, fim: string | null, p: ProblemaEscalaDomiciliar[]) => {
  if (!DATA.test(inicio)) p.push({ campo: 'vigenciaInicio', mensagem: 'Informe o início da vigência.' });
  else if (fim !== null && (!DATA.test(fim) || fim < inicio))
    p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência não pode ser antes do início.' });
};

// ---------------------------------------------------------------- área
export interface FaixaCepArea {
  readonly cepInicial: string;
  readonly cepFinal: string;
}

export function conferirAreaDomiciliar(a: {
  codigo: string;
  descricao: string;
  faixas: readonly FaixaCepArea[];
  /** Faixas das outras áreas ativas do mesmo estabelecimento. */
  faixasOutrasAreas: readonly (FaixaCepArea & { area: string })[];
}): ProblemaEscalaDomiciliar[] {
  const p: ProblemaEscalaDomiciliar[] = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,29}$/.test(a.codigo.trim()))
    p.push({
      campo: 'codigo',
      mensagem: 'O código tem de 1 a 30 letras, números, ponto, hífen ou sublinhado.',
    });
  if (a.descricao.trim().length < 3)
    p.push({ campo: 'descricao', mensagem: 'Descreva a área (pelo menos 3 letras).' });
  const validas: { i: number; ini: string; fim: string }[] = [];
  a.faixas.forEach((f, i) => {
    const ini = normalizarCep(f.cepInicial);
    const fim = normalizarCep(f.cepFinal);
    if (!ini || !fim) p.push({ campo: `faixas.${i}`, mensagem: `Faixa ${i + 1}: o CEP tem 8 dígitos.` });
    else if (ini > fim)
      p.push({ campo: `faixas.${i}`, mensagem: `Faixa ${i + 1}: o CEP inicial vem antes do final.` });
    else validas.push({ i, ini, fim });
  });
  for (let x = 0; x < validas.length; x++)
    for (let y = x + 1; y < validas.length; y++) {
      const [f, g] = [validas[x]!, validas[y]!];
      if (f.ini <= g.fim && g.ini <= f.fim)
        p.push({
          campo: `faixas.${g.i}`,
          mensagem: `Faixa ${g.i + 1}: sobrepõe a faixa ${f.i + 1} desta área.`,
        });
    }
  for (const f of validas)
    for (const o of a.faixasOutrasAreas) {
      const oi = normalizarCep(o.cepInicial);
      const of = normalizarCep(o.cepFinal);
      if (oi && of && f.ini <= of && oi <= f.fim) {
        p.push({
          campo: `faixas.${f.i}`,
          mensagem: `Faixa ${f.i + 1}: o CEP já pertence à área ${o.area}; um endereço cai numa área só.`,
        });
        break;
      }
    }
  return p;
}

/** A área do CEP: a faixa mais estreita que o contém (null quando nenhuma). */
export function areaDoCep<T extends FaixaCepArea & { area: number }>(
  cep: string | null | undefined,
  faixas: readonly T[],
): number | null {
  const c = normalizarCep(cep);
  if (!c) return null;
  let melhor: { area: number; largura: number } | null = null;
  for (const f of faixas) {
    const ini = normalizarCep(f.cepInicial);
    const fim = normalizarCep(f.cepFinal);
    if (!ini || !fim || c < ini || c > fim) continue;
    const largura = Number(fim) - Number(ini);
    if (!melhor || largura < melhor.largura) melhor = { area: f.area, largura };
  }
  return melhor?.area ?? null;
}

// ---------------------------------------------------------------- profissional da área
export function conferirProfissionalArea(v: {
  prioridade: number;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  /** Os outros vínculos (não excluídos) do mesmo profissional na mesma área. */
  outrosVinculos: readonly { inicio: string; fim: string | null }[];
}): ProblemaEscalaDomiciliar[] {
  const p: ProblemaEscalaDomiciliar[] = [];
  if (!Number.isInteger(v.prioridade) || v.prioridade < 1 || v.prioridade > 99)
    p.push({ campo: 'prioridade', mensagem: 'A prioridade vai de 1 (primeiro chamado) a 99.' });
  conferirVigencia(v.vigenciaInicio, v.vigenciaFim, p);
  if (
    !p.length &&
    v.outrosVinculos.some((o) => vigenciasSeCruzam(o, { inicio: v.vigenciaInicio, fim: v.vigenciaFim }))
  )
    p.push({
      campo: 'vigenciaInicio',
      mensagem: 'O profissional já está nesta área nesse período; encerre o vínculo anterior antes.',
    });
  return p;
}

// ---------------------------------------------------------------- escala
export interface TurnoEscala {
  readonly diaSemana: number;
  readonly horaInicio: string;
  readonly horaFim: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export function conferirEscalaDomiciliar(
  e: TurnoEscala & {
    quantidade: number;
    /** Na escala de uma área: o profissional está vinculado à área no início da vigência (null = escala sem área). */
    profissionalNaArea: boolean | null;
    /** Os outros turnos ativos (não excluídos) do mesmo profissional. */
    outrosTurnos: readonly TurnoEscala[];
  },
): ProblemaEscalaDomiciliar[] {
  const p: ProblemaEscalaDomiciliar[] = [];
  if (!(DIAS_SEMANA_ESCALA as readonly number[]).includes(e.diaSemana))
    p.push({ campo: 'diaSemana', mensagem: 'Escolha o dia da semana.' });
  const horasOk = HORA.test(e.horaInicio) && HORA.test(e.horaFim);
  if (!horasOk) p.push({ campo: 'horaInicio', mensagem: 'Informe o início e o fim do turno (HH:MM).' });
  else if (minutos(e.horaFim) <= minutos(e.horaInicio))
    p.push({ campo: 'horaFim', mensagem: 'O turno termina depois de começar.' });
  if (!Number.isInteger(e.quantidade) || e.quantidade < 1 || e.quantidade > MAXIMO_ATENDIMENTOS_TURNO)
    p.push({
      campo: 'quantidade',
      mensagem: `O turno atende de 1 a ${MAXIMO_ATENDIMENTOS_TURNO} visitas.`,
    });
  conferirVigencia(e.vigenciaInicio, e.vigenciaFim, p);
  if (e.profissionalNaArea === false)
    p.push({
      campo: 'profissional',
      mensagem: 'O profissional não está vinculado a esta área no início da vigência; vincule-o antes.',
    });
  if (horasOk && !p.some((x) => x.campo === 'horaFim')) {
    const choque = e.outrosTurnos.find(
      (o) =>
        o.diaSemana === e.diaSemana &&
        minutos(o.horaInicio) < minutos(e.horaFim) &&
        minutos(e.horaInicio) < minutos(o.horaFim) &&
        vigenciasSeCruzam(
          { inicio: o.vigenciaInicio, fim: o.vigenciaFim },
          { inicio: e.vigenciaInicio, fim: e.vigenciaFim },
        ),
    );
    if (choque)
      p.push({
        campo: 'horaInicio',
        mensagem: `O profissional já tem turno das ${hhmm(choque.horaInicio)} às ${hhmm(choque.horaFim)} nesse dia.`,
      });
  }
  return p;
}

/** Dia da semana da escala para a data "AAAA-MM-DD" (1 = domingo a 7 = sábado). */
export function diaSemanaEscala(dataIso: string): number {
  const [a, m, d] = dataIso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(a!, m! - 1, d!)).getUTCDay() + 1;
}

export interface EscalaVigente extends TurnoEscala {
  readonly id: number;
  readonly profissional: number;
  readonly tipoChamado: number | null;
  readonly quantidade: number;
  readonly permiteExtra: boolean;
  readonly ativo: boolean;
}

/**
 * O turno da escala em que cai a visita do profissional (data e hora locais do estabelecimento), e se ela entra
 * como extra. `ocupadas` diz quantas visitas não canceladas o turno já tem naquela data.
 */
export function escalaDaVisita(v: {
  escalas: readonly EscalaVigente[];
  profissional: number;
  tipoChamado: number;
  dataLocal: string;
  horaLocal: string;
  ocupadas: (escala: number) => number;
}): { escala: number | null; extra: boolean; problemas: ProblemaEscalaDomiciliar[] } {
  const dia = diaSemanaEscala(v.dataLocal);
  const m = minutos(v.horaLocal);
  const turno = v.escalas
    .filter(
      (e) =>
        e.ativo &&
        e.profissional === v.profissional &&
        e.diaSemana === dia &&
        (e.tipoChamado === null || e.tipoChamado === v.tipoChamado) &&
        e.vigenciaInicio <= v.dataLocal &&
        (e.vigenciaFim === null || e.vigenciaFim >= v.dataLocal) &&
        minutos(e.horaInicio) <= m &&
        m < minutos(e.horaFim),
    )
    // O turno do tipo de chamado vence o turno geral.
    .sort((a, b) => Number(a.tipoChamado === null) - Number(b.tipoChamado === null))[0];
  if (!turno) return { escala: null, extra: false, problemas: [] };
  if (v.ocupadas(turno.id) < turno.quantidade) return { escala: turno.id, extra: false, problemas: [] };
  if (turno.permiteExtra) return { escala: turno.id, extra: true, problemas: [] };
  return {
    escala: turno.id,
    extra: false,
    problemas: [
      {
        campo: 'quando',
        mensagem: `O turno das ${hhmm(turno.horaInicio)} às ${hhmm(turno.horaFim)} já tem as ${turno.quantidade} visitas e não aceita extra; escolha outro horário ou profissional.`,
      },
    ],
  };
}

/** Grade de um dia: os turnos vigentes na data com as vagas livres (nunca negativas). */
export function gradeDoDia<T extends EscalaVigente>(
  escalas: readonly T[],
  dataLocal: string,
  ocupadas: (escala: number) => number,
): (T & { ocupadas: number; livres: number })[] {
  const dia = diaSemanaEscala(dataLocal);
  return escalas
    .filter(
      (e) =>
        e.ativo &&
        e.diaSemana === dia &&
        e.vigenciaInicio <= dataLocal &&
        (e.vigenciaFim === null || e.vigenciaFim >= dataLocal),
    )
    .map((e) => {
      const o = ocupadas(e.id);
      return { ...e, ocupadas: o, livres: Math.max(0, e.quantidade - o) };
    })
    .sort((a, b) => a.horaInicio.localeCompare(b.horaInicio) || a.profissional - b.profissional);
}
