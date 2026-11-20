// Argumentos dos comandos da raiz: `--chave=valor` e `--bandeira`; o `--` que o pnpm repassa é ignorado.
export interface Argumentos {
  readonly posicionais: readonly string[];
  readonly opcoes: Readonly<Record<string, string>>;
  readonly bandeiras: ReadonlySet<string>;
}

export function lerArgumentos(argv: readonly string[]): Argumentos {
  const posicionais: string[] = [];
  const opcoes: Record<string, string> = {};
  const bandeiras = new Set<string>();
  for (const a of argv) {
    if (a === '--') continue;
    const m = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(a);
    if (!m?.[1]) {
      posicionais.push(a);
    } else if (m[2] === undefined) {
      bandeiras.add(m[1]);
    } else {
      opcoes[m[1]] = m[2];
    }
  }
  return { posicionais, opcoes, bandeiras };
}
