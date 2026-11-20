// Fila de dispensação por horário (ficha do M29, regras 1, 2 e 3): nasce dos horários dos itens prescritos numa janela
// por unidade (as próximas 12 h por padrão), separada por paciente e horário; a dose já dispensada por qualquer dos dois
// sistemas some; a ocupada (travada por outro terminal, deste ou do outro sistema) passa à seguinte; a política
// "dispensar só depois de validar" é por classe de medicamento, com exceção para "agora" e urgente.
import { recusa, type RecusaSuprimentos } from './recusa.js';

/** Janela padrão da fila (horas à frente) e os limites aceitos no parâmetro por unidade. */
export const JANELA_PADRAO_HORAS = 12;
export const JANELA_MINIMA_HORAS = 1;
export const JANELA_MAXIMA_HORAS = 48;
/** Teto da fila (ficha, seção 4: 500 doses). */
export const TETO_FILA_DOSES = 500;

export type ClasseMedicamento = 'alto-risco' | 'antimicrobiano' | 'controlado' | 'comum' | 'material';

export interface DoseNaFila {
  /** O horário prescrito (PRCHKGERAL.ID). */
  readonly horario: number;
  readonly atendimento: number;
  readonly paciente: number;
  readonly leito: string;
  readonly item: number;
  readonly descricao: string;
  /** ISO local AAAA-MM-DDTHH:MM. */
  readonly previsto: string;
  readonly quantidade: number | null;
  readonly classe: ClasseMedicamento;
  readonly urgente: boolean;
  readonly agora: boolean;
  /** Já dispensada por qualquer dos dois sistemas (GEDISPHOR ou PRINTEGRACAOESTOQUE ligados ao horário). */
  readonly dispensada: boolean;
  /** Suspensa (situação 6 ou item suspenso na prescrição) ou excluída no estoque (10). */
  readonly suspensa: boolean;
  /** A avaliação farmacêutica do item (no novo, SGH_; ou o 5 automático do outro sistema). */
  readonly validada: boolean;
}

export interface GrupoHorario {
  readonly previsto: string;
  readonly doses: readonly DoseNaFila[];
}
export interface PacienteNaFila {
  readonly atendimento: number;
  readonly paciente: number;
  readonly leito: string;
  readonly horarios: readonly GrupoHorario[];
}

const somaHoras = (iso: string, horas: number): string => {
  const d = new Date(`${iso}:00Z`);
  d.setUTCHours(d.getUTCHours() + horas);
  return d.toISOString().slice(0, 16);
};

/** A janela [agora, agora + horas) de uma unidade; parâmetro fora dos limites cai no padrão. */
export function janelaDaFila(
  agora: string,
  horas: number | null | undefined,
): { inicio: string; fim: string } {
  const h =
    typeof horas === 'number' && horas >= JANELA_MINIMA_HORAS && horas <= JANELA_MAXIMA_HORAS
      ? Math.floor(horas)
      : JANELA_PADRAO_HORAS;
  return { inicio: agora.slice(0, 16), fim: somaHoras(agora.slice(0, 16), h) };
}

/**
 * Regra 1 e 2: monta a fila na janela, por paciente (ordem do leito) e por horário; a dose dispensada (por qualquer
 * dos dois sistemas) e a suspensa somem; urgente e "agora" vêm primeiro dentro do horário. Corta no teto.
 */
export function montarFila(
  doses: readonly DoseNaFila[],
  janela: { inicio: string; fim: string },
  teto = TETO_FILA_DOSES,
): { pacientes: PacienteNaFila[]; total: number; cortada: boolean } {
  const vivas = doses
    .filter((d) => !d.dispensada && !d.suspensa && d.previsto >= janela.inicio && d.previsto < janela.fim)
    .sort(
      (a, b) =>
        a.previsto.localeCompare(b.previsto) ||
        Number(b.urgente || b.agora) - Number(a.urgente || a.agora) ||
        a.horario - b.horario,
    );
  const cortada = vivas.length > teto;
  const usadas = vivas.slice(0, teto);
  const porAtendimento = new Map<number, DoseNaFila[]>();
  for (const d of usadas)
    porAtendimento.set(d.atendimento, [...(porAtendimento.get(d.atendimento) ?? []), d]);
  const pacientes = [...porAtendimento.values()]
    .map((ds) => {
      const porHorario = new Map<string, DoseNaFila[]>();
      for (const d of ds) porHorario.set(d.previsto, [...(porHorario.get(d.previsto) ?? []), d]);
      const p = ds[0]!;
      return {
        atendimento: p.atendimento,
        paciente: p.paciente,
        leito: p.leito,
        horarios: [...porHorario.entries()].map(([previsto, doses]) => ({ previsto, doses })),
      };
    })
    .sort(
      (a, b) => a.leito.localeCompare(b.leito, 'pt-BR', { numeric: true }) || a.atendimento - b.atendimento,
    );
  return { pacientes, total: usadas.length, cortada };
}

/**
 * Regra 2: das candidatas (na ordem da fila), a primeira não ocupada; a ocupada (trava de outro terminal) passa à
 * seguinte, sem esperar. Null quando todas estão ocupadas.
 */
export function proximaLivre<T>(candidatas: readonly T[], ocupada: (c: T) => boolean): T | null {
  for (const c of candidatas) if (!ocupada(c)) return c;
  return null;
}

/** Política "dispensar só depois de validar", por classe (parâmetro SGH_; nada em PRPARAM). */
export type PoliticaDispensacao = Readonly<Partial<Record<ClasseMedicamento, 'validar-antes' | 'livre'>>>;

/** A política padrão: alto risco e antimicrobiano só depois da validação (escopo inicial da DP-25, POL-1). */
export const POLITICA_PADRAO: PoliticaDispensacao = {
  'alto-risco': 'validar-antes',
  antimicrobiano: 'validar-antes',
  controlado: 'livre',
  comum: 'livre',
  material: 'livre',
};

/** Regra 3: a dose pode ser dispensada já? "Agora" e urgente passam mesmo sem a validação. */
export function conferirPoliticaDispensacao(
  d: Pick<DoseNaFila, 'classe' | 'validada' | 'urgente' | 'agora'>,
  politica: PoliticaDispensacao = POLITICA_PADRAO,
): RecusaSuprimentos | null {
  const regra = politica[d.classe] ?? POLITICA_PADRAO[d.classe] ?? 'livre';
  if (regra === 'livre' || d.validada || d.urgente || d.agora) return null;
  return recusa(
    'aguarda-validacao',
    'Este medicamento só sai depois da avaliação farmacêutica (política da farmácia); urgente e "agora" são exceção.',
    ['horario'],
  );
}

/** Lê o parâmetro da política (texto "classe=regra;…"); entrada inválida cai no padrão, item por item. */
export function lerPolitica(texto: string | null | undefined): PoliticaDispensacao {
  const r: Partial<Record<ClasseMedicamento, 'validar-antes' | 'livre'>> = { ...POLITICA_PADRAO };
  for (const par of (texto ?? '').split(';')) {
    const [k, v] = par.split('=').map((x) => x.trim());
    if (
      (k === 'alto-risco' ||
        k === 'antimicrobiano' ||
        k === 'controlado' ||
        k === 'comum' ||
        k === 'material') &&
      (v === 'validar-antes' || v === 'livre')
    )
      r[k] = v;
  }
  return r;
}

/** A classe do item para a política e a fila humana (o cadastro do item e a prescrição). */
export function classeDoItem(i: {
  tipo: 'medicamento' | 'material' | 'solucao' | string;
  altaVigilancia: boolean;
  antimicrobiano: boolean;
  controlado: boolean;
}): ClasseMedicamento {
  if (i.tipo === 'material') return 'material';
  if (i.altaVigilancia) return 'alto-risco';
  if (i.antimicrobiano) return 'antimicrobiano';
  if (i.controlado) return 'controlado';
  return 'comum';
}
