// Voz do painel de chamada (M19; ficha, seções 7 e 10): cada chamada nova é falada uma vez, mesmo quando duas
// chegam na mesma leitura (dois guichês em sequência rápida, ou a releitura depois de o canal reconectar). As chaves
// já faladas ficam guardadas; a cada leitura, as chamadas novas entram na fila da voz na ordem em que aconteceram
// (a mais antiga primeiro), e a fila fala uma de cada vez (a seguinte começa no fim da anterior).

/** Teto das chaves lembradas (o painel guarda poucas dezenas de chamadas). */
export const TETO_CHAVES_FALADAS = 200;

/** As chamadas da leitura (a mais nova primeiro) que ainda não foram faladas, da mais antiga para a mais nova. */
export function chamadasNovas<T extends { readonly chave: string }>(
  faladas: Set<string>,
  lista: readonly T[],
): T[] {
  const novas = lista.filter((c) => !faladas.has(c.chave)).reverse();
  for (const c of novas) faladas.add(c.chave);
  while (faladas.size > TETO_CHAVES_FALADAS) {
    const primeira = faladas.values().next().value as string;
    faladas.delete(primeira);
  }
  return novas;
}

export interface Sintetizador {
  /** Fala o texto e chama `fim` quando terminar (ou falhar). */
  falar(texto: string, fim: () => void): void;
}

/** Fila sequencial da voz: um texto por vez; o próximo começa quando o anterior termina. */
export class FilaDeVoz {
  private readonly textos: string[] = [];
  private falando = false;

  constructor(private readonly sintetizador: Sintetizador) {}

  enfileirar(...textos: string[]): void {
    this.textos.push(...textos);
    this.proximo();
  }

  get pendentes(): number {
    return this.textos.length + (this.falando ? 1 : 0);
  }

  private proximo(): void {
    if (this.falando) return;
    const texto = this.textos.shift();
    if (texto === undefined) return;
    this.falando = true;
    let terminou = false;
    const fim = () => {
      if (terminou) return;
      terminou = true;
      this.falando = false;
      this.proximo();
    };
    try {
      this.sintetizador.falar(texto, fim);
    } catch {
      fim();
    }
  }
}

/** O sintetizador do navegador (pt-BR); sem voz no aparelho, só passa ao próximo. */
export function sintetizadorDoNavegador(): Sintetizador {
  return {
    falar(texto, fim) {
      const voz = globalThis.speechSynthesis;
      if (!voz || typeof SpeechSynthesisUtterance === 'undefined') {
        fim();
        return;
      }
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = 'pt-BR';
      u.onend = fim;
      u.onerror = fim;
      voz.speak(u);
    },
  };
}
