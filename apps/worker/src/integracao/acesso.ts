// Acesso do worker às gravações e leituras das integrações novas (M34): o núcleo do legado (leitura READ ONLY e a
// transação SGH_ com a trilha), abstraído para os testes unitários (banco falso) e de integração (a cópia, desfeita).
import type { Escritor, Leitor, NucleoLegado } from '@sgh/legado';

export interface AcessoIntegracao {
  ler<T>(hospital: string, fn: (l: Leitor) => Promise<T>): Promise<T>;
  /** Transação SGH_ confirmada (só tabelas SGH_). */
  gravar<T>(hospital: string, fn: (e: Escritor) => Promise<T>): Promise<T>;
}

export function acessoDoNucleo(nucleo: NucleoLegado, rotulo: string): AcessoIntegracao {
  const ctx = (hospital: string) => ({ rede: nucleo.rede, hospital, traceId: rotulo });
  return {
    ler: (h, fn) => nucleo.lerSomente(ctx(h), fn),
    gravar: (h, fn) => nucleo.gravarSgh(ctx(h), fn),
  };
}
