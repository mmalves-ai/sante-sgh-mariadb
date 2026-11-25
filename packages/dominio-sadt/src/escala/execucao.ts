// Escala de execução do setor do diagnóstico (05-SADT linha 19): quem executa os exames em cada plantão (dia da semana
// ou data avulsa, faixa de hora, capacidade), quais exames o plantão atende (com limite por turno e vagas reservadas a
// um grupo prioritário) e a ordem da fila do setor pela prioridade do paciente. Regras puras, sem banco.
// Melhorias sobre a prática comum: a conferência inteira devolve todos os problemas de uma vez (a tela marca cada campo
// na hora, sem ir e voltar); o choque de horário do mesmo executante em dois setores é recusado na gravação, com o
// plantão que conflita; a resposta "quem executa este exame agora" sai da própria escala, para a fila e o pedido.

/**
 * Um plantão da escala: dia da semana (1 = domingo a 7 = sábado) ou data avulsa, nunca os dois. O dia é o do INÍCIO do
 * plantão: fim menor ou igual ao início quer dizer que o plantão passa da meia-noite e acaba no dia seguinte (19:00 às
 * 07:00, o noturno do setor 24 horas); fim igual ao início é o plantão de 24 horas.
 */
export interface PlantaoEscala {
  readonly diaSemana: number | null;
  /** AAAA-MM-DD. */
  readonly data: string | null;
  /** HH:MM, hora local do estabelecimento. */
  readonly inicio: string;
  readonly fim: string;
  readonly capacidade: number;
}

/** Um exame atendido pela escala. */
export interface ExameDaEscala {
  readonly exame: number;
  readonly limitePorTurno: number | null;
  readonly grupoPrioridade: number | null;
  readonly vagasReservadas: number;
}

export interface EscalaExecucao {
  readonly id?: number;
  readonly setor: number;
  readonly profissional: number | null;
  readonly recurso: number | null;
  /** O papel do profissional na escala: executa o exame ou lauda (o laudo pede o profissional; padrão: executa). */
  readonly papel?: PapelNaEscala;
  readonly descricao: string;
  /** AAAA-MM-DD. */
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly plantoes: readonly PlantaoEscala[];
  readonly exames: readonly ExameDaEscala[];
  readonly ativa?: boolean;
}

/** Quem executa o exame (profissional ou sala) ou quem o lauda (sempre um profissional). */
export type PapelNaEscala = 'executa' | 'lauda';
export const PAPEIS_NA_ESCALA: readonly PapelNaEscala[] = ['executa', 'lauda'];

export interface ProblemaEscala {
  readonly campo: string;
  readonly mensagem: string;
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const minutos = (h: string): number => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const dataValida = (d: string): boolean => DATA.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

/** Dia da semana de uma data AAAA-MM-DD, no padrão da escala (1 = domingo a 7 = sábado). */
export function diaDaSemana(data: string): number {
  return new Date(`${data}T12:00:00Z`).getUTCDay() + 1;
}

/** Confere a escala inteira e devolve todos os problemas (lista vazia: pode gravar). */
export function conferirEscala(e: EscalaExecucao): ProblemaEscala[] {
  const p: ProblemaEscala[] = [];
  if (e.profissional === null && e.recurso === null)
    p.push({
      campo: 'executante',
      mensagem: 'Informe o profissional que executa ou a sala/equipamento da escala.',
    });
  if (e.papel !== undefined && !PAPEIS_NA_ESCALA.includes(e.papel))
    p.push({ campo: 'papel', mensagem: 'O papel na escala é executar ou laudar.' });
  if (e.papel === 'lauda' && e.profissional === null)
    p.push({
      campo: 'profissional',
      mensagem: 'A escala de laudo é de um profissional, não de sala ou equipamento.',
    });
  if (e.descricao.trim().length < 3)
    p.push({ campo: 'descricao', mensagem: 'Descreva a escala (ao menos 3 letras).' });
  if (e.descricao.length > 150)
    p.push({ campo: 'descricao', mensagem: 'A descrição passa de 150 caracteres.' });
  if (!dataValida(e.vigenciaInicio))
    p.push({ campo: 'vigenciaInicio', mensagem: 'Data de início inválida.' });
  if (e.vigenciaFim !== null && (!dataValida(e.vigenciaFim) || e.vigenciaFim < e.vigenciaInicio))
    p.push({ campo: 'vigenciaFim', mensagem: 'O fim da vigência não pode ser antes do início.' });
  if (e.plantoes.length === 0) p.push({ campo: 'plantoes', mensagem: 'Inclua ao menos um plantão.' });
  e.plantoes.forEach((x, i) => {
    const c = `plantoes.${i}`;
    if ((x.diaSemana === null) === (x.data === null))
      p.push({ campo: c, mensagem: 'O plantão é num dia da semana ou numa data avulsa, nunca os dois.' });
    if (x.diaSemana !== null && !(Number.isInteger(x.diaSemana) && x.diaSemana >= 1 && x.diaSemana <= 7))
      p.push({ campo: c, mensagem: 'Dia da semana entre domingo (1) e sábado (7).' });
    if (x.data !== null && !dataValida(x.data)) p.push({ campo: c, mensagem: 'Data do plantão inválida.' });
    if (
      x.data !== null &&
      dataValida(x.data) &&
      (x.data < e.vigenciaInicio || (e.vigenciaFim && x.data > e.vigenciaFim))
    )
      p.push({ campo: c, mensagem: 'A data do plantão fica fora da vigência da escala.' });
    if (!HORA.test(x.inicio) || !HORA.test(x.fim))
      p.push({
        campo: c,
        mensagem:
          'Informe as horas de início e de fim (HH:MM); fim antes do início é o plantão que vira a noite.',
      });
    if (!Number.isInteger(x.capacidade) || x.capacidade < 1 || x.capacidade > 65535)
      p.push({ campo: c, mensagem: 'A capacidade do plantão é de ao menos 1 atendimento.' });
  });
  e.plantoes.forEach((a, i) =>
    e.plantoes.forEach((b, j) => {
      if (j > i && plantoesSeCruzam(a, b, e, e))
        p.push({
          campo: `plantoes.${j}`,
          mensagem: `O plantão se sobrepõe ao plantão ${i + 1} da mesma escala.`,
        });
    }),
  );
  if (e.exames.length === 0) p.push({ campo: 'exames', mensagem: 'Inclua ao menos um exame atendido.' });
  const vistos = new Set<number>();
  e.exames.forEach((x, i) => {
    const c = `exames.${i}`;
    if (vistos.has(x.exame)) p.push({ campo: c, mensagem: 'O exame aparece duas vezes na escala.' });
    vistos.add(x.exame);
    if (x.limitePorTurno !== null && !(Number.isInteger(x.limitePorTurno) && x.limitePorTurno >= 1))
      p.push({ campo: c, mensagem: 'O limite por turno é de ao menos 1 (vazio: sem limite próprio).' });
    if (!Number.isInteger(x.vagasReservadas) || x.vagasReservadas < 0)
      p.push({ campo: c, mensagem: 'Vagas reservadas não podem ser negativas.' });
    if (x.vagasReservadas > 0 && x.grupoPrioridade === null)
      p.push({ campo: c, mensagem: 'Vagas reservadas pedem o grupo prioritário que as usa.' });
    if (x.limitePorTurno !== null && x.vagasReservadas > x.limitePorTurno)
      p.push({ campo: c, mensagem: 'As vagas reservadas passam do limite do exame no turno.' });
  });
  return p;
}

/** A vigência de uma escala (AAAA-MM-DD; fim nulo: sem fim). */
export interface Vigencia {
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

const MIN_DIA = 1440;
const MIN_SEMANA = 7 * MIN_DIA;
/** Quantos minutos o plantão dura (fim <= início: até o dia seguinte; fim = início: 24 horas). */
export function duracaoDoPlantao(x: Pick<PlantaoEscala, 'inicio' | 'fim'>): number {
  const d = minutos(x.fim) - minutos(x.inicio);
  return d > 0 ? d : d + MIN_DIA;
}
/** O dia (contado desde 1970-01-01) de uma data AAAA-MM-DD. */
const diaAbsoluto = (d: string): number => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
const dataDoDia = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);
const dentro = (data: string, v: Vigencia | undefined): boolean =>
  !v || (v.vigenciaInicio <= data && (v.vigenciaFim === null || data <= v.vigenciaFim));
const cruzam = (a0: number, a1: number, b0: number, b1: number): boolean => a0 < b1 && b0 < a1;

/**
 * As ocorrências do plantão semanal que podem encostar num intervalo absoluto [ini, fim) em minutos desde 1970, só
 * nos dias dentro da vigência da escala dele.
 */
function ocorrenciasPerto(
  p: PlantaoEscala,
  ini: number,
  fim: number,
  v: Vigencia | undefined,
): [number, number][] {
  const r: [number, number][] = [];
  const dur = duracaoDoPlantao(p);
  for (let dia = Math.floor(ini / MIN_DIA) - 1; dia <= Math.floor(fim / MIN_DIA) + 1; dia++) {
    const data = dataDoDia(dia);
    if (diaDaSemana(data) !== p.diaSemana || !dentro(data, v)) continue;
    const i = dia * MIN_DIA + minutos(p.inicio);
    r.push([i, i + dur]);
  }
  return r;
}

/**
 * Dois plantões se cruzam no tempo, contando a virada da meia-noite. A vigência de cada escala, quando dada, limita
 * os dias do plantão semanal (a data avulsa de outra escala fora da vigência não conflita).
 */
export function plantoesSeCruzam(
  a: PlantaoEscala,
  b: PlantaoEscala,
  vigA?: Vigencia,
  vigB?: Vigencia,
): boolean {
  const avulso = (x: PlantaoEscala): [number, number] => {
    const i = diaAbsoluto(x.data!) * MIN_DIA + minutos(x.inicio);
    return [i, i + duracaoDoPlantao(x)];
  };
  if (a.data && b.data) {
    const [a0, a1] = avulso(a);
    const [b0, b1] = avulso(b);
    return cruzam(a0, a1, b0, b1);
  }
  if (a.data || b.data) {
    const [x, y, vy] = a.data ? [a, b, vigB] : [b, a, vigA];
    const [x0, x1] = avulso(x);
    return ocorrenciasPerto(y, x0, x1, vy).some(([y0, y1]) => cruzam(x0, x1, y0, y1));
  }
  if (a.diaSemana === null || b.diaSemana === null) return false;
  // Os dois semanais: na semana circular (o noturno de sábado chega ao domingo).
  const a0 = (a.diaSemana - 1) * MIN_DIA + minutos(a.inicio);
  const b0 = (b.diaSemana - 1) * MIN_DIA + minutos(b.inicio);
  const a1 = a0 + duracaoDoPlantao(a);
  const b1 = b0 + duracaoDoPlantao(b);
  return [-MIN_SEMANA, 0, MIN_SEMANA].some((k) => cruzam(a0, a1, b0 + k, b1 + k));
}

const vigenciasSeCruzam = (a: EscalaExecucao, b: EscalaExecucao): boolean =>
  a.vigenciaInicio <= (b.vigenciaFim ?? '9999-12-31') && b.vigenciaInicio <= (a.vigenciaFim ?? '9999-12-31');

/** O conflito do mesmo executante (profissional ou sala) com outra escala ativa, em qualquer setor. */
export interface ConflitoEscala {
  readonly escala: number | null;
  readonly descricao: string;
  readonly plantao: number;
}

export function conflitosDoExecutante(
  nova: EscalaExecucao,
  outras: readonly EscalaExecucao[],
): ConflitoEscala[] {
  const r: ConflitoEscala[] = [];
  for (const o of outras) {
    if (o.ativa === false || (nova.id !== undefined && o.id === nova.id) || !vigenciasSeCruzam(nova, o))
      continue;
    const mesmo =
      (nova.profissional !== null && nova.profissional === o.profissional) ||
      (nova.recurso !== null && nova.recurso === o.recurso);
    if (!mesmo) continue;
    nova.plantoes.forEach((p, i) => {
      if (o.plantoes.some((q) => plantoesSeCruzam(p, q, nova, o)))
        r.push({ escala: o.id ?? null, descricao: o.descricao, plantao: i });
    });
  }
  return r;
}

/** Quem executa o exame no setor numa data e hora (as escalas ativas, vigentes, com plantão cobrindo a hora). */
export function executantesDoExame(
  escalas: readonly EscalaExecucao[],
  setor: number,
  exame: number,
  data: string,
  hora: string,
  papel: PapelNaEscala = 'executa',
): EscalaExecucao[] {
  // O momento em minutos desde 1970; o plantão começa no dia da data ou na véspera (o noturno que vira a noite), e a
  // vigência que vale é a do dia em que o plantão começou.
  const hoje = diaAbsoluto(data);
  const agora = hoje * MIN_DIA + minutos(hora);
  const cobre = (e: EscalaExecucao, p: PlantaoEscala): boolean =>
    [hoje - 1, hoje].some((dia) => {
      const inicioDia = dataDoDia(dia);
      if (!dentro(inicioDia, e)) return false;
      if (p.data ? p.data !== inicioDia : p.diaSemana !== diaDaSemana(inicioDia)) return false;
      const i = dia * MIN_DIA + minutos(p.inicio);
      return i <= agora && agora < i + duracaoDoPlantao(p);
    });
  return escalas.filter(
    (e) =>
      e.ativa !== false &&
      (e.papel ?? 'executa') === papel &&
      e.setor === setor &&
      e.exames.some((x) => x.exame === exame) &&
      e.plantoes.some((p) => cobre(e, p)),
  );
}

/** O paciente na fila do setor (sem dado pessoal: só o que ordena). */
export interface NaFila {
  readonly id: number;
  readonly urgente: boolean;
  /** Ordem do grupo prioritário legal (1 é o mais alto: maiores de 80; nulo: sem prioridade legal). */
  readonly ordemPrioridade: number | null;
  /** Data e hora ISO da chegada ao setor. */
  readonly chegada: string;
}

/**
 * A ordem da fila do setor: urgência primeiro; depois a prioridade legal (a de ordem menor antes: maiores de 80 antes
 * dos demais idosos, gestantes e pessoas com deficiência); dentro do mesmo nível, quem chegou antes.
 */
export function ordenarFilaDoSetor<T extends NaFila>(fila: readonly T[]): T[] {
  return [...fila].sort((a, b) => {
    if (a.urgente !== b.urgente) return a.urgente ? -1 : 1;
    const pa = a.ordemPrioridade ?? Number.MAX_SAFE_INTEGER;
    const pb = b.ordemPrioridade ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.chegada < b.chegada ? -1 : a.chegada > b.chegada ? 1 : a.id - b.id;
  });
}
