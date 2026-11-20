// Registro das consultas somente leitura (parte pública; M14: o lote gerado). Daqui saem as permissões de
// consulta por módulo, as rotas e o índice; a parte física fica em @sgh/legado (`<grupo>/consultas/`).
import { CONSULTAS_M14, ITENS_CONSULTA_M14, MODULOS_CONSULTA_M14 } from './lote-m14.gerado.js';
import { CONSULTAS_M34 } from './m34.js';
import type { ConsultaPublica } from './tipos.js';

export const CONSULTAS_DECLARADAS: readonly ConsultaPublica[] = [...CONSULTAS_M14, ...CONSULTAS_M34];

export function consultaPublica(modulo: string, recurso: string): ConsultaPublica | undefined {
  return CONSULTAS_DECLARADAS.find((c) => c.modulo === modulo && c.recurso === recurso);
}

/** Itens da árvore das Fases 5 e 6 com consulta provisória (aviso "tela completa na Fase N"). */
export const ITENS_CONSULTA_PROVISORIA = ITENS_CONSULTA_M14;

/** Opções do legado que concedem `<modulo>.consulta.ler` (a área "Tabelas" do módulo de cada código). */
export const OPCOES_CONSULTA_POR_MODULO = MODULOS_CONSULTA_M14;

/** Consultas de um item da árvore (a tela do item lista as tabelas que ele atende). */
export function consultasDoItem(item: string): ConsultaPublica[] {
  return CONSULTAS_DECLARADAS.filter((c) => c.item === item);
}
