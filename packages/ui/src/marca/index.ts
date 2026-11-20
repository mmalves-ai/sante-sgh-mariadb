// Pacotes de marca por rede (DP-49, ARQ-2, DP-9). Nome do produto, logo, símbolo e cores vêm da
// configuração da rede (GET /api/marca → id do pacote); nenhum componente tem texto ou SVG de marca fixo.
// Uma rede nova = uma pasta com os SVGs e as duas cores, registrada aqui; nenhuma tela muda. (Desvio
// registrado no M07: registrar a pasta é mudança de código no @sgh/ui; servir SVGs e cores pela
// configuração fica para quando houver a segunda rede.) MARCA desconhecida NUNCA cai na marca de outra
// rede: a casca usa o PACOTE_NEUTRO, com o selo "marca não configurada" visível, e avisa no log.
import type { CoresDaMarca } from '../tokens/cores.js';
import logoRedeSante from './rede-sante/logo-sante-sgh.svg?url';
import logoBrancoRedeSante from './rede-sante/logo-sante-sgh-branco.svg?url';
import simboloRedeSante from './rede-sante/simbolo-rede-sante.svg?url';
import simboloBrancoRedeSante from './rede-sante/simbolo-rede-sante-branco.svg?url';
import { CORES_NEUTRAS, CORES_REDE_SANTE } from '../tokens/marcas.js';
import simboloNeutro from './neutra/simbolo-neutro.svg?url';
import simboloBrancoNeutro from './neutra/simbolo-neutro-branco.svg?url';

export interface PacoteMarca extends CoresDaMarca {
  readonly id: string;
  /** Logo e símbolo ainda não validados (DP-9): a casca mostra o selo "provisório". */
  readonly provisoria: boolean;
  /** Logotipo completo (traz o nome do produto desenhado: só onde o nome provisório for aceito). */
  readonly logo: string;
  readonly logoBranco: string;
  /** Só o símbolo: barra superior, favicon, menu recolhido. */
  readonly simbolo: string;
  readonly simboloBranco: string;
  /** Só no PACOTE_NEUTRO: a rede pediu um pacote que não existe; a casca mostra o aviso. */
  readonly naoConfigurada?: boolean;
}

export const PACOTES_DE_MARCA: Readonly<Record<string, PacoteMarca>> = {
  // Marca provisória da Rede Santé (planejamento/marca/; DP-9 provisório em 2026-10-19).
  'rede-sante': {
    id: 'rede-sante',
    ...CORES_REDE_SANTE,
    provisoria: true,
    logo: logoRedeSante,
    logoBranco: logoBrancoRedeSante,
    simbolo: simboloRedeSante,
    simboloBranco: simboloBrancoRedeSante,
  },
};

/** Marca neutra (sem nome nem logo de rede nenhuma) para MARCA desconhecida. */
export const PACOTE_NEUTRO: PacoteMarca = {
  id: 'neutra',
  ...CORES_NEUTRAS,
  provisoria: false,
  naoConfigurada: true,
  logo: simboloNeutro,
  logoBranco: simboloBrancoNeutro,
  simbolo: simboloNeutro,
  simboloBranco: simboloBrancoNeutro,
};

/** Pacote da rede ou, se `id` não estiver registrado (ou faltar), o neutro (`conhecida: false`). */
export function resolverMarca(id: string | null | undefined): { pacote: PacoteMarca; conhecida: boolean } {
  const p = id ? PACOTES_DE_MARCA[id] : undefined;
  return p ? { pacote: p, conhecida: true } : { pacote: PACOTE_NEUTRO, conhecida: false };
}

export class ErroMarca extends Error {
  override readonly name = 'ErroMarca';
}

export function pacoteDeMarca(id: string): PacoteMarca {
  const p = PACOTES_DE_MARCA[id];
  if (!p) throw new ErroMarca(`pacote de marca "${id}" não registrado em @sgh/ui (marca/index.ts)`);
  return p;
}
