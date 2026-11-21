// Fila da recepção na página inicial (ficha do M27, regra 5; cap-03 §3.5; Anexo A §A.1; Lei 13.466/2017): as senhas
// pela prioridade legal (grupos de prioridade legal: acima de 80 anos antes das demais prioridades, que vêm antes da normal; a
// mesma ordem do guichê, `ordenarFila`, com a ordem "prioridade"), dentro do grupo pela chegada; e as guias
// aguardando autorização do convênio, da mais antiga para a mais nova (quem espera há mais tempo primeiro).
import {
  type ConfigFila,
  GRUPOS_PRIORIDADE,
  type GuiaPendente,
  ordenarFila,
  type SenhaDaWorklist,
  type SenhaNaFila,
} from '@sgh/contratos';

/** A descrição do grupo legal (o grupo detalhado do novo, ou o da prioridade 0/1/2 gravada pelo outro sistema). */
export function descricaoDoGrupo(prioridade: string, grupo: number | null): string {
  const g =
    grupo !== null
      ? GRUPOS_PRIORIDADE.find((x) => x.grupo === grupo)
      : GRUPOS_PRIORIDADE.find((x) => x.grupo === Number(prioridade.trim() || '2'));
  return g?.rotulo ?? 'Normal';
}

/** Ordem das senhas na fila de trabalho: a legal (a página inicial não intercala; o guichê decide a chamada). */
export function ordenarSenhasDaWorklist<T extends SenhaDaWorklist>(senhas: readonly T[]): T[] {
  const cfg: ConfigFila = { ordem: 'prioridade', intercalar: 2 };
  const comoFila = senhas.map((s): SenhaNaFila & { readonly s: T } => ({
    id: s.id,
    numero: Number(s.senha.replace(/\D/g, '')) || 0,
    prioridade: s.prioridade,
    emitidaEm: s.emitidaEm,
    s,
  }));
  return ordenarFila(comoFila, cfg).map((x) => x.s);
}

/** Guias aguardando autorização: a que espera há mais tempo primeiro. */
export function ordenarGuiasPendentes<T extends GuiaPendente>(guias: readonly T[]): T[] {
  return [...guias].sort((a, b) => a.abertoEm.localeCompare(b.abertoEm) || a.reg - b.reg);
}

/** Minutos de espera desde a emissão (ISO local) até agora (ISO local), nunca negativo. */
export function esperaEmMinutos(desde: string, agora: string): number {
  const d = Date.parse(`${desde.slice(0, 19)}Z`);
  const a = Date.parse(`${agora.slice(0, 19)}Z`);
  return Number.isFinite(d) && Number.isFinite(a) ? Math.max(0, Math.floor((a - d) / 60_000)) : 0;
}
