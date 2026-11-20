// O recorte versionado dos perfis BR Core na versão FIXADA (ADR 0016; ficha do M34, regra 14): carregado do JSON do
// pacote (conferido pelo SHA-256 em `pnpm` br-core-extrair e no teste dos mapeadores).
import pacote from './br-core-1.6.1.json' with { type: 'json' };
import type { PerfilRecortado } from './validador.js';

export interface PacoteBrCore {
  readonly pacote: string;
  readonly versao: string;
  readonly sha256: string;
  readonly perfis: Readonly<Record<string, PerfilRecortado>>;
}

export const PACOTE_BR_CORE = pacote as unknown as PacoteBrCore;

export function perfilBrCoreRecortado(tipo: string): PerfilRecortado | undefined {
  return PACOTE_BR_CORE.perfis[tipo];
}
