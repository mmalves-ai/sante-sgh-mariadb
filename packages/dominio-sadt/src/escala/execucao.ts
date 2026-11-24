// Escala de execução do setor do diagnóstico (05-SADT linha 19): quem executa os exames em cada plantão (dia da semana
// ou data avulsa, faixa de hora, capacidade), quais exames o plantão atende (com limite por turno e vagas reservadas a
// um grupo prioritário) e a ordem da fila do setor pela prioridade do paciente. Regras puras, sem banco.
// Melhorias sobre a prática comum: a conferência inteira devolve todos os problemas de uma vez (a tela marca cada campo
// na hora, sem ir e voltar); o choque de horário do mesmo executante em dois setores é recusado na gravação, com o
// plantão que conflita; a resposta "quem executa este exame agora" sai da própria escala, para a fila e o pedido.

/** Um plantão da escala: dia da semana (1 = domingo a 7 = sábado) ou data avulsa, nunca os dois. */
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
  readonly descricao: string;
  /** AAAA-MM-DD. */
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly plantoes: readonly PlantaoEscala[];
  readonly exames: readonly ExameDaEscala[];
  readonly ativa?: boolean;
}

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
    if (!HORA.test(x.inicio) || !HORA.test(x.fim) || minutos(x.fim) <= minutos(x.inicio))
      p.push({ campo: c, mensagem: 'A hora de fim precisa ser depois da hora de início (HH:MM).' });
    if (!Number.isInteger(x.capacidade) || x.capacidade < 1 || x.capacidade > 65535)
      p.push({ campo: c, mensagem: 'A capacidade do plantão é de ao menos 1 atendimento.' });
  });
  e.plantoes.forEach((a, i) =>
    e.plantoes.forEach((b, j) => {
      if (j > i && plantoesSeCruzam(a, b))
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

/** Dois plantões podem cair no mesmo dia e as horas se cruzam (as vigências são conferidas por quem chama). */
export function plantoesSeCruzam(a: PlantaoEscala, b: PlantaoEscala): boolean {
  const diaA = a.diaSemana ?? (a.data ? diaDaSemana(a.data) : null);
  const diaB = b.diaSemana ?? (b.data ? diaDaSemana(b.data) : null);
  if (diaA === null || diaB === null || diaA !== diaB) return false;
  if (a.data && b.data && a.data !== b.data) return false;
  return minutos(a.inicio) < minutos(b.fim) && minutos(b.inicio) < minutos(a.fim);
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
      if (o.plantoes.some((q) => plantoesSeCruzam(p, q)))
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
): EscalaExecucao[] {
  const dia = diaDaSemana(data);
  const m = minutos(hora);
  return escalas.filter(
    (e) =>
      e.ativa !== false &&
      e.setor === setor &&
      e.vigenciaInicio <= data &&
      (e.vigenciaFim === null || data <= e.vigenciaFim) &&
      e.exames.some((x) => x.exame === exame) &&
      e.plantoes.some(
        (p) =>
          (p.data ? p.data === data : p.diaSemana === dia) && minutos(p.inicio) <= m && m < minutos(p.fim),
      ),
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
