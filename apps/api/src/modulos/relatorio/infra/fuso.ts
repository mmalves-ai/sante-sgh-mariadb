// O relógio dos relatórios (M34; F2.2 lote 04-04). O banco guarda todo DATETIME em UTC (ADR 0002); o fuso do
// estabelecimento só serve para achar o dia e a hora local (o "hoje" dos parâmetros, o próximo envio a partir da hora
// do envio, os limites do dia de um relatório) e para mostrar a hora na tela.
// Convenção da porta: a "hora de parede" local é um Date com os campos UTC iguais aos do relógio local (a mesma da
// porta de memória e do domínio, que calcula o próximo envio sem fuso). A conversão para o instante real (UTC) só
// acontece aqui, na entrada e na saída do banco.

/** Data e hora locais do fuso, como texto ISO sem fuso (AAAA-MM-DDTHH:MM:SS). */
export function relogioNoFuso(fuso: string, agora: Date = new Date()): { hoje: string; agora: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(agora)
      .map((x) => [x.type, x.value]),
  );
  const hoje = `${p['year']}-${p['month']}-${p['day']}`;
  return { hoje, agora: `${hoje}T${p['hour']}:${p['minute']}:${p['second']}` };
}

/** Quanto o relógio local está à frente do UTC no instante (em ms, minutos inteiros). */
function deslocamentoMs(fuso: string, instante: number): number {
  const parede = Date.parse(`${relogioNoFuso(fuso, new Date(instante)).agora}Z`);
  return Math.round((parede - instante) / 60_000) * 60_000;
}

/** Instante real (UTC) → hora de parede local. */
export function utcParaLocal(d: Date, fuso: string): Date {
  return new Date(d.getTime() + deslocamentoMs(fuso, d.getTime()));
}

/** Hora de parede local → instante real (UTC); na virada de horário de verão, o deslocamento do instante achado. */
export function localParaUtc(parede: Date, fuso: string): Date {
  const w = parede.getTime();
  const primeiro = w - deslocamentoMs(fuso, w);
  return new Date(w - deslocamentoMs(fuso, primeiro));
}

/** Date (instante) → DATETIME(3) do banco, em UTC. */
export const paraBanco = (d: Date) => d.toISOString().slice(0, 23).replace('T', ' ');

/** Início do dia local (AAAA-MM-DD) como DATETIME do banco em UTC. */
export const inicioDoDiaEmUtc = (dia: string, fuso: string) =>
  paraBanco(localParaUtc(new Date(`${dia}T00:00:00Z`), fuso));

/** O DATETIME lido do banco (UTC, texto ISO sem fuso) → hora de parede local, como Date. */
export const lidoNoFuso = (v: unknown, fuso: string): Date | null =>
  v ? utcParaLocal(new Date(`${String(v)}Z`), fuso) : null;

/** O DATETIME lido do banco (UTC) → texto ISO local sem fuso (AAAA-MM-DDTHH:MM:SS). */
export const textoNoFuso = (v: unknown, fuso: string): string | null => {
  const d = lidoNoFuso(v, fuso);
  return d ? d.toISOString().slice(0, 19) : null;
};

/** O deslocamento do fuso no instante como texto do CONVERT_TZ ('-03:00'). */
export function deslocamentoTexto(fuso: string, instante: Date = new Date()): string {
  const m = deslocamentoMs(fuso, instante.getTime()) / 60_000;
  const a = Math.abs(m);
  return `${m < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
