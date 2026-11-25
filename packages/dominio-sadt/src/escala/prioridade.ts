// Prioridade legal do paciente na fila do setor e a grade da semana da escala (05-SADT linha 19). Regras puras, sem
// banco. O grupo prioritário vem do cadastro (idoso, maior de 80, gestante, pessoa com deficiência...): o de idade vale
// sozinho pela data de nascimento, sem ninguém marcar; os demais valem pela condição registrada e vigente do paciente.
// A grade responde à pergunta do coordenador do setor: quem cobre cada dia desta semana, e onde não há ninguém.
import { diaDaSemana, type EscalaExecucao, type PlantaoEscala } from './execucao.js';

/** Um grupo de prioridade legal: o de peso menor é chamado antes; idade mínima em anos, quando o grupo é por idade. */
export interface GrupoPrioridade {
  readonly id: number;
  readonly peso: number;
  readonly idadeMinima: number | null;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Idade em anos completos numa data (as duas AAAA-MM-DD); nulo sem nascimento válido ou com nascimento no futuro. */
export function idadeEm(nascimento: string | null, data: string): number | null {
  if (nascimento === null || !DATA.test(nascimento) || !DATA.test(data) || nascimento > data) return null;
  const anos = Number(data.slice(0, 4)) - Number(nascimento.slice(0, 4));
  return data.slice(5) < nascimento.slice(5) ? anos - 1 : anos;
}

/**
 * O grupo prioritário que vale para o paciente: entre os de idade que ele alcança e os de condição registrada e
 * vigente (`comprovados`), o de menor peso (empate: o de menor id). Nulo: sem prioridade legal.
 */
export function prioridadeDoPaciente(
  grupos: readonly GrupoPrioridade[],
  idade: number | null,
  comprovados: readonly number[],
): GrupoPrioridade | null {
  const valem = grupos.filter((g) =>
    g.idadeMinima !== null ? idade !== null && idade >= g.idadeMinima : comprovados.includes(g.id),
  );
  // O grupo de idade também pode ter sido registrado à mão (a idade não bate com o documento): vale o registro.
  const registrados = grupos.filter((g) => g.idadeMinima !== null && comprovados.includes(g.id));
  const todos = [...valem, ...registrados];
  if (!todos.length) return null;
  return todos.reduce((a, b) => (b.peso < a.peso || (b.peso === a.peso && b.id < a.id) ? b : a));
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somarDias(data: string, dias: number): string {
  return new Date(Date.parse(`${data}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

/** O domingo da semana de uma data (a grade vai de domingo a sábado, como o dia da semana da escala). */
export function inicioDaSemana(data: string): string {
  return somarDias(data, 1 - diaDaSemana(data));
}

/** Uma casa da grade: o dia e os plantões da escala que COMEÇAM nele (o noturno aparece no dia em que começa). */
export interface DiaDaGrade {
  readonly data: string;
  readonly diaSemana: number;
  /** Índices dos plantões na escala (os mesmos de `plantoes.N` da conferência) e o plantão. */
  readonly plantoes: readonly { readonly indice: number; readonly plantao: PlantaoEscala }[];
}

/**
 * Os sete dias da semana de `referencia` para uma escala: em cada dia, os plantões que valem (o semanal dentro da
 * vigência; o de data avulsa na própria data). Escala inativa não tem plantão em dia nenhum.
 */
export function gradeDaSemana(e: EscalaExecucao, referencia: string): DiaDaGrade[] {
  const domingo = inicioDaSemana(referencia);
  return Array.from({ length: 7 }, (_, k) => {
    const data = somarDias(domingo, k);
    const vigente =
      e.ativa !== false && e.vigenciaInicio <= data && (e.vigenciaFim === null || data <= e.vigenciaFim);
    const plantoes = vigente
      ? e.plantoes
          .map((plantao, indice) => ({ indice, plantao }))
          .filter(({ plantao: p }) => (p.data !== null ? p.data === data : p.diaSemana === k + 1))
          .sort((a, b) => (a.plantao.inicio < b.plantao.inicio ? -1 : 1))
      : [];
    return { data, diaSemana: k + 1, plantoes };
  });
}

/** Os dias da semana (1 = domingo a 7 = sábado) em que nenhuma das escalas tem plantão: o furo de cobertura do setor. */
export function diasSemCobertura(escalas: readonly EscalaExecucao[], referencia: string): number[] {
  const grades = escalas.map((e) => gradeDaSemana(e, referencia));
  return [1, 2, 3, 4, 5, 6, 7].filter((d) => grades.every((g) => g[d - 1]!.plantoes.length === 0));
}

/**
 * Quantos dias civis para trás o pedido sem horário marcado ainda espera na fila do dia: o pedido da véspera (o da
 * noite, o do paciente internado) continua na fila; o mais antigo sai dela e é contado à parte, como pendência.
 */
export const DIAS_DE_ESPERA_NA_FILA = 1;

/** As datas civis (AAAA-MM-DD, no fuso do estabelecimento) que dizem em que dia o exame pedido espera a execução. */
export interface EsperaDoExame {
  /** O dia em que o exame foi pedido. */
  readonly pedidoEm: string;
  /** O dia previsto para a coleta ou a execução, quando o pedido já saiu com data. */
  readonly previstoPara: string | null;
  /** O dia do horário marcado na agenda, quando o exame é agendado. */
  readonly agendadoPara: string | null;
}

/**
 * Em que fila o exame pedido está num dia: na de `hoje`, entre as pendências `antigo` (ficou para trás sem execução)
 * ou no `futuro` (marcado ou previsto para outro dia). O exame com horário marcado espera só no dia do horário; o
 * pedido sem horário espera no dia previsto (ou no do pedido) e nos `dias` seguintes.
 */
export function esperaNoDia(
  e: EsperaDoExame,
  hoje: string,
  dias: number = DIAS_DE_ESPERA_NA_FILA,
): 'hoje' | 'antigo' | 'futuro' {
  if (e.agendadoPara !== null)
    return e.agendadoPara === hoje ? 'hoje' : e.agendadoPara < hoje ? 'antigo' : 'futuro';
  const referencia = e.previstoPara ?? e.pedidoEm;
  if (referencia > hoje) return 'futuro';
  return referencia >= somarDias(hoje, -dias) ? 'hoje' : 'antigo';
}
