// O que as telas de coexistência leem do núcleo do legado (NucleoLegado implementa; os testes usam dublê).
import type { EstadoPool, ImpressaoDigital, MarcaSchema, SaudeEstabelecimento } from '@sgh/legado';

export interface FonteCoexistencia {
  readonly rede: string;
  saude(): SaudeEstabelecimento[];
  estadosDosPools(): EstadoPool[];
  verificarSchema(codigo: string): Promise<MarcaSchema>;
  ultimaImpressao(codigo: string): ImpressaoDigital | undefined;
  readonly estabelecimentos: readonly { readonly codigo: string }[];
  /** Fecha os pools ao encerrar a API (SIGTERM/SIGINT pelo enableShutdownHooks). */
  encerrar?(): Promise<void>;
}

export const FONTE_COEXISTENCIA = Symbol('FONTE_COEXISTENCIA');
