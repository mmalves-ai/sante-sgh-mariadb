// Critério MON$ do `pnpm k6` (cap-10 §10.11; fichas dos marcos de carga): só as conexões do PROCESSO MEDIDO contam.
// A API e o worker que o runner sobe marcam as conexões com o processo `api-k6` e `worker-k6` (SGH_PROCESSO); as
// demais conexões marcadas como sistema novo (o `pnpm dev` de outra pessoa, os testes dos outros ramos na cópia
// compartilhada) ficam registradas à parte, como informação, e não reprovam a carga.
import type { Coleta } from '@sgh/legado';

/** Processos que o runner sobe (o valor de SGH_PROCESSO de cada um). */
export const PROCESSOS_DO_K6 = { api: 'api-k6', worker: 'worker-k6' } as const;

const DO_K6 = new RegExp(`:(${Object.values(PROCESSOS_DO_K6).join('|')})$`);

export function conexaoDoK6(marca: string): boolean {
  return DO_K6.test(marca.trim());
}

export interface MonDoK6 {
  amostras: number;
  /** Processo medido (API e worker do k6). */
  maisLongaMs: number;
  /** O processo (api-k6 ou worker-k6) da transação mais longa. */
  maisLongaProcesso: string | null;
  escritaMax: number;
  acimaDoLimite: number;
  conexoesMax: number;
  /** Outros processos marcados como sistema novo na mesma cópia (informação; não reprovam). */
  outrosMaisLongaMs: number;
  outrosEscritaMax: number;
  outrosAcimaDoLimite: number;
  outrosConexoesMax: number;
}

export function monVazio(): MonDoK6 {
  return {
    amostras: 0,
    maisLongaMs: 0,
    maisLongaProcesso: null,
    escritaMax: 0,
    acimaDoLimite: 0,
    conexoesMax: 0,
    outrosMaisLongaMs: 0,
    outrosEscritaMax: 0,
    outrosAcimaDoLimite: 0,
    outrosConexoesMax: 0,
  };
}

/** Soma uma amostra do coletor, separando o processo medido dos outros processos do novo. */
export function somarAmostra(
  m: MonDoK6,
  c: Pick<Coleta, 'conexoesDoNovo' | 'alertas'>,
  limiteMs: number,
): void {
  m.amostras++;
  const proprias = c.conexoesDoNovo.filter((x) => conexaoDoK6(x.marca));
  const outras = c.conexoesDoNovo.filter((x) => !conexaoDoK6(x.marca));
  const longa = (xs: typeof proprias) => Math.max(0, ...xs.map((x) => x.transacaoMaisLongaMs));
  const escrita = (xs: typeof proprias) => xs.reduce((s, x) => s + x.transacoesEscrita, 0);
  const daAmostra = longa(proprias);
  if (daAmostra > m.maisLongaMs) {
    const x = proprias.find((y) => y.transacaoMaisLongaMs === daAmostra);
    m.maisLongaProcesso = x ? (/:([^:]+)$/.exec(x.marca.trim())?.[1] ?? null) : null;
  }
  m.maisLongaMs = Math.max(m.maisLongaMs, daAmostra);
  m.escritaMax = Math.max(m.escritaMax, escrita(proprias));
  m.acimaDoLimite += proprias.filter((x) => x.transacaoMaisLongaMs > limiteMs).length;
  m.conexoesMax = Math.max(m.conexoesMax, proprias.length);
  m.outrosMaisLongaMs = Math.max(m.outrosMaisLongaMs, longa(outras));
  m.outrosEscritaMax = Math.max(m.outrosEscritaMax, escrita(outras));
  m.outrosAcimaDoLimite += outras.filter((x) => x.transacaoMaisLongaMs > limiteMs).length;
  m.outrosConexoesMax = Math.max(m.outrosConexoesMax, outras.length);
}

/** Reprovas do critério MON$: só o processo medido. */
export function reprovasMon(m: MonDoK6, limiteMs: number): string[] {
  const r: string[] = [];
  if (m.amostras === 0) r.push('coletor MON$ sem amostra durante o k6');
  if (m.conexoesMax === 0 && m.amostras > 0)
    r.push('nenhuma conexão do processo medido vista no MON$ (marca api-k6/worker-k6)');
  if (m.escritaMax > 0) r.push(`${m.escritaMax} transação(ões) de escrita do processo medido`);
  if (m.acimaDoLimite > 0 || m.maisLongaMs > limiteMs)
    r.push(`transação do processo medido acima de ${limiteMs} ms (${m.maisLongaMs} ms)`);
  return r;
}
