// Escopo pela DP-21 (ficha do M47, regras 6 e 7; cap-05b §5.11 "Atenção"): o módulo inteiro é construído e as duas
// respostas só mudam o estado da chave `agencia.completa` (agência própria = ligada; hemocentro = desligada, só a
// requisição, a amostra, o ato à beira do leito e a hemovigilância). A chave `agencia.transfusao` liga a etapa 1.
// E o volume transfundido entra no balanço hídrico do M45 uma vez só (chave de idempotência pelo ato).

export const CHAVE_AGENCIA_TRANSFUSAO = 'agencia.transfusao';
export const CHAVE_AGENCIA_COMPLETA = 'agencia.completa';

export type PassoTransfusao =
  | 'requisicao'
  | 'amostra'
  | 'imunoHematologia'
  | 'provaCruzada'
  | 'liberacaoDaBolsa'
  | 'recebimentoDoHemocentro'
  | 'ato'
  | 'reacao';

/** Os passos do fluxo com cada estado das chaves (a tela mostra só os ligados; o servidor recusa os outros). */
export function passosDoFluxo(c: {
  readonly transfusaoLigada: boolean;
  readonly agenciaCompleta: boolean;
}): readonly PassoTransfusao[] {
  if (!c.transfusaoLigada) return [];
  return c.agenciaCompleta
    ? ['requisicao', 'amostra', 'imunoHematologia', 'provaCruzada', 'liberacaoDaBolsa', 'ato', 'reacao']
    : ['requisicao', 'amostra', 'recebimentoDoHemocentro', 'ato', 'reacao'];
}

export function passoPermitido(
  passo: PassoTransfusao,
  c: { readonly transfusaoLigada: boolean; readonly agenciaCompleta: boolean },
): boolean {
  return passosDoFluxo(c).includes(passo);
}

/** O ganho do balanço hídrico (M45) que o ato gera: uma vez por ato, pela chave de idempotência. */
export interface GanhoDoAto {
  readonly chave: string;
  readonly volumeMl: number;
  readonly origem: 'hemocomponente';
  readonly em: string;
}

/** Regra 7: só o ato concluído ou interrompido com volume > 0 entra; o reenvio usa a mesma chave. */
export function ganhoDoAto(a: {
  readonly id: number;
  readonly estado: 'emCurso' | 'concluido' | 'interrompido';
  readonly volumeTransfundidoMl: number | null;
  readonly terminoEm: string | null;
}): GanhoDoAto | null {
  if (a.estado === 'emCurso' || a.terminoEm === null) return null;
  const v = a.volumeTransfundidoMl ?? 0;
  if (v <= 0) return null;
  return { chave: `hemo-ato:${a.id}`, volumeMl: v, origem: 'hemocomponente', em: a.terminoEm };
}

/** Os ganhos de uma lista de atos, sem repetir a chave (quem já entrou no balanço não entra de novo). */
export function ganhosNovos(
  atos: readonly Parameters<typeof ganhoDoAto>[0][],
  jaLancadas: ReadonlySet<string>,
): readonly GanhoDoAto[] {
  const vistos = new Set(jaLancadas);
  const r: GanhoDoAto[] = [];
  for (const a of atos) {
    const g = ganhoDoAto(a);
    if (!g || vistos.has(g.chave)) continue;
    vistos.add(g.chave);
    r.push(g);
  }
  return r;
}
