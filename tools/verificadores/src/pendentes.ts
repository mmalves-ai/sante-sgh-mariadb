// Marcadores "PENDENTE: Mnn" (convencoes.md §13 e §15): nunca contam como verificação feita.
export interface Marcador {
  readonly script: string;
  readonly marco: string;
}

const MARCADOR = /tools\/verificadores\/src\/pendente\.ts\s+(M\d{2})\b/;

export function listarMarcadores(scripts: Readonly<Record<string, string>>): Marcador[] {
  return Object.entries(scripts)
    .flatMap(([script, comando]) => {
      const m = MARCADOR.exec(comando);
      return m?.[1] ? [{ script, marco: m[1] }] : [];
    })
    .sort((a, b) => a.marco.localeCompare(b.marco) || a.script.localeCompare(b.script));
}

export function resumoMarcadores(marcadores: readonly Marcador[]): string {
  if (marcadores.length === 0) return 'Marcadores PENDENTE: nenhum.';
  return [
    `Marcadores PENDENTE (${marcadores.length}; NÃO contam como verificação feita):`,
    ...marcadores.map((m) => `  PENDENTE: ${m.marco}  pnpm ${m.script}`),
  ].join('\n');
}
