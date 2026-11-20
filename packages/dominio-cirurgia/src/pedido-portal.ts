// Regras puras do portal do médico externo (M50, etapa 3; ficha, seções 4 e 5; regra 6; DP-43): de que registros do
// profissional saem a agenda (o registro de cirurgião) e o extrato (o código de prestador), a janela da agenda, a
// conferência do pedido de cirurgia antes de gravar e o limite de pedidos por conta. Sem banco e sem relógio próprio.

export interface RegistroDoProfissional {
  /** O registro (TBCBOPRO.ID): o cirurgião na agenda do bloco. */
  readonly id: number;
  /** O código do registro (TBCBOPRO.COD): o prestador no repasse e o número do conselho. */
  readonly codigo: number;
  readonly uf: string;
}

/** Os registros de cirurgião e os códigos de prestador do profissional (sem repetição; o "não informado" fica fora). */
export function codigosDoProfissional(registros: readonly RegistroDoProfissional[]): {
  cirurgioes: number[];
  prestadores: number[];
} {
  const validos = registros.filter((r) => r.id > 0 && r.codigo > 0);
  return {
    cirurgioes: [...new Set(validos.map((r) => r.id))],
    prestadores: [...new Set(validos.map((r) => r.codigo))],
  };
}

/**
 * O registro que vai como cirurgião no pedido: o do número e da UF do conselho da conta, se o profissional tiver; senão o
 * primeiro. Null sem registro (a conta não pode pedir).
 */
export function registroDoPedido(
  registros: readonly RegistroDoProfissional[],
  conta: { uf: string | null; numero: string | null },
): number | null {
  const validos = registros.filter((r) => r.id > 0 && r.codigo > 0);
  const n = Number(conta.numero ?? '');
  const igual = validos.find((r) => r.codigo === n && r.uf === (conta.uf ?? ''));
  return (igual ?? validos[0])?.id ?? null;
}

const somar = (dia: string, k: number): string => {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** A janela da agenda: o padrão é de hoje a 30 dias; o fim não vem antes do início e cabe no máximo de dias. */
export function janelaAgendaPortal(
  de: string | null,
  ate: string | null,
  hoje: string,
  diasMax: number,
): { de: string; ate: string } | { recusa: 'periodo-invalido' | 'periodo-longo' } {
  const d = de ?? hoje;
  if (!DIA.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return { recusa: 'periodo-invalido' };
  const a = ate ?? somar(d, 30);
  if (!DIA.test(a) || Number.isNaN(Date.parse(`${a}T00:00:00Z`)) || a < d)
    return { recusa: 'periodo-invalido' };
  if (a > somar(d, diasMax - 1)) return { recusa: 'periodo-longo' };
  return { de: d, ate: a };
}

export type RecusaPedidoPortal =
  | 'data-passada'
  | 'data-distante'
  | 'nascimento-invalido'
  | 'sala-inexistente'
  | 'convenio-inexistente'
  | 'procedimento-inexistente';

/**
 * Conferência do pedido do médico externo antes de gravar (a secretaria decide a sala e a hora na confirmação, mas o
 * pedido tem de fazer sentido): a data a partir de amanhã e até o máximo de dias; o nascimento no passado e depois de
 * 1900; a sala, o convênio (ativo) e o procedimento existentes.
 */
export function conferirPedidoPortal(
  p: { data: string; nascimento: string; sala: number; convenio: number; procedimento: number },
  ctx: {
    hoje: string;
    diasMax: number;
    salas: readonly number[];
    convenios: readonly number[];
    procedimentoExiste: boolean;
  },
): RecusaPedidoPortal | null {
  if (p.data <= ctx.hoje) return 'data-passada';
  if (p.data > somar(ctx.hoje, ctx.diasMax)) return 'data-distante';
  if (p.nascimento >= ctx.hoje || p.nascimento < '1900-01-01') return 'nascimento-invalido';
  if (!ctx.salas.includes(p.sala)) return 'sala-inexistente';
  if (!ctx.convenios.includes(p.convenio)) return 'convenio-inexistente';
  if (!ctx.procedimentoExiste) return 'procedimento-inexistente';
  return null;
}

/** Limite de pedidos por conta (os instantes, em ms, dos pedidos aceitos): no máximo `teto` por hora. */
export function dentroDoLimiteDePedidos(instantes: readonly number[], agora: number, teto: number): boolean {
  return instantes.filter((t) => agora - t < 3_600_000).length < teto;
}

/**
 * Os códigos de prestador que são só do profissional (o repasse é lançado pelo número do conselho, que se repete entre
 * cadastros do corpo clínico): o código que outro profissional, ou um registro sem profissional (0), também tem fica
 * retido. `donos`: os profissionais de cada código; o código sem dono lido conta como do próprio.
 */
export function codigosExclusivos(
  prestadores: readonly number[],
  donos: ReadonlyMap<number, ReadonlySet<number>>,
  profissional: number,
): { exclusivos: number[]; retidos: number[] } {
  const exclusivos: number[] = [];
  const retidos: number[] = [];
  for (const cod of prestadores) {
    const d = donos.get(cod);
    if (!d || [...d].every((x) => x === profissional)) exclusivos.push(cod);
    else retidos.push(cod);
  }
  return { exclusivos, retidos };
}

/**
 * Reserva síncrona da vaga de pedido da conta (antes de qualquer espera: pedidos simultâneos não leem a mesma lista).
 * Devolve a lista nova com o instante, ou null quando o teto da hora já foi atingido.
 */
export function reservarPedido(instantes: readonly number[], agora: number, teto: number): number[] | null {
  const recentes = instantes.filter((t) => agora - t < 3_600_000);
  return recentes.length < teto ? [...recentes, agora] : null;
}
