// Equipe cirúrgica (ficha do M18, regra 6; cap-05a §5.5). O agendamento tem sete funções (cada uma com o id do registro
// profissional e o número do registro) mais o pediatra (só o id); o domínio confere cada par contra o cadastro de
// profissionais e recusa o que não casa. Profissional ausente = par (0, 1), o registro "não informado"; o par (0, 488)
// é o da trilha. O "não informado" nunca aparece na tela. O registro do ato tem oito funções: cirurgião, três
// auxiliares, instrumentador, anestesista, pediatra e circulante, mais o quarto auxiliar só por id.

export const SENTINELA_PROFISSIONAL = 1;
export const SENTINELA_TRILHA = 488;
/** Ids do registro profissional que significam "não informado" (número 0). */
export const SENTINELAS = new Set([SENTINELA_PROFISSIONAL, SENTINELA_TRILHA]);

export const FUNCOES_AGENDA = [
  { funcao: 'cirurgiao', rotulo: 'Cirurgião', cod: 'CRM', id: 'ID_CRM' },
  { funcao: 'auxiliar1', rotulo: '1º auxiliar', cod: 'AUX1', id: 'ID_AUX1' },
  { funcao: 'auxiliar2', rotulo: '2º auxiliar', cod: 'AUX2', id: 'ID_AUX2' },
  { funcao: 'auxiliar3', rotulo: '3º auxiliar', cod: 'AUX3', id: 'ID_AUX3' },
  { funcao: 'instrumentador', rotulo: 'Instrumentador', cod: 'INSTR', id: 'ID_INSTR' },
  { funcao: 'anestesista', rotulo: 'Anestesista', cod: 'ANEST', id: 'ID_ANEST' },
  { funcao: 'circulante', rotulo: 'Circulante', cod: 'CIRCUL', id: 'ID_CIRCUL' },
] as const;
export type FuncaoAgenda = (typeof FUNCOES_AGENDA)[number]['funcao'];

export const FUNCOES_REGISTRO = [
  { funcao: 'cirurgiao', rotulo: 'Cirurgião', cod: 'CIRUR', id: 'ID_CIRUR' },
  { funcao: 'auxiliar1', rotulo: '1º auxiliar', cod: 'AUX1', id: 'ID_AUX1' },
  { funcao: 'auxiliar2', rotulo: '2º auxiliar', cod: 'AUX2', id: 'ID_AUX2' },
  { funcao: 'auxiliar3', rotulo: '3º auxiliar', cod: 'AUX3', id: 'ID_AUX3' },
  { funcao: 'instrumentador', rotulo: 'Instrumentador', cod: 'INSTR', id: 'ID_INSTR' },
  { funcao: 'anestesista', rotulo: 'Anestesista', cod: 'ANEST', id: 'ID_ANEST' },
  { funcao: 'pediatra', rotulo: 'Pediatra', cod: 'PED', id: 'ID_PED' },
  { funcao: 'circulante', rotulo: 'Circulante', cod: 'CIRC', id: 'ID_CIRC' },
] as const;
export type FuncaoRegistro = (typeof FUNCOES_REGISTRO)[number]['funcao'];

/** Profissional escolhido na tela: o id do registro profissional e o número do registro que o par exige. */
export interface Profissional {
  readonly id: number;
  readonly cod: number;
}

export function ehSentinela(id: number | null | undefined): boolean {
  return id === null || id === undefined || SENTINELAS.has(id);
}

/** Pares (coluna → valor) da agenda: ausente vira (0, 1). Recusa o mesmo profissional em duas funções principais. */
export function paresDaAgenda(
  equipe: Partial<Record<FuncaoAgenda, Profissional | null>>,
): Record<string, number> {
  const pares: Record<string, number> = {};
  for (const f of FUNCOES_AGENDA) {
    const p = equipe[f.funcao] ?? null;
    pares[f.cod] = p ? p.cod : 0;
    pares[f.id] = p ? p.id : SENTINELA_PROFISSIONAL;
  }
  return pares;
}

/** Pares do registro do ato; o quarto auxiliar só por id (1 = ausente). */
export function paresDoRegistro(
  equipe: Partial<Record<FuncaoRegistro, Profissional | null>>,
  auxiliar4: number | null = null,
): Record<string, number> {
  const pares: Record<string, number> = {};
  for (const f of FUNCOES_REGISTRO) {
    const p = equipe[f.funcao] ?? null;
    pares[f.cod] = p ? p.cod : 0;
    pares[f.id] = p ? p.id : SENTINELA_PROFISSIONAL;
  }
  pares['ID_TBCBOPRO_AUX4'] = auxiliar4 ?? SENTINELA_PROFISSIONAL;
  return pares;
}

/** Equipe lida de uma linha (coluna → valor), sem os sentinelas: o que a tela mostra. */
export function equipeDaLinha(
  linha: Readonly<Record<string, unknown>>,
  funcoes: readonly { funcao: string; cod: string; id: string }[] = FUNCOES_AGENDA,
): { funcao: string; id: number; cod: number }[] {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return funcoes
    .map((f) => ({ funcao: f.funcao, id: n(linha[f.id]), cod: n(linha[f.cod]) ?? 0 }))
    .filter((x): x is { funcao: string; id: number; cod: number } => !ehSentinela(x.id));
}

export function rotuloFuncao(funcao: string): string {
  return (
    [...FUNCOES_AGENDA, ...FUNCOES_REGISTRO].find((f) => f.funcao === funcao)?.rotulo ??
    (funcao === 'pediatra' ? 'Pediatra' : funcao)
  );
}

/** A mesma pessoa não ocupa duas funções na mesma cirurgia (exceto auxiliares entre si não se repetem também). */
export function repetidosNaEquipe(equipe: Partial<Record<string, Profissional | null>>): string[] {
  const vistos = new Map<number, string>();
  const repetidos: string[] = [];
  for (const [funcao, p] of Object.entries(equipe)) {
    if (!p || ehSentinela(p.id)) continue;
    if (vistos.has(p.id)) repetidos.push(funcao);
    else vistos.set(p.id, funcao);
  }
  return repetidos;
}
