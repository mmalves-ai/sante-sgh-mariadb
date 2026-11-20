// Domínios do CRUD genérico do módulo `pep` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import { CIE, GERAL_M_Z, inferida, propria } from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_PEP: readonly DominioPublico[] = [
  // Clínicos, prescrição e PEP (PEP 3)
  propria(
    {
      modulo: 'pep',
      recurso: 'tipoAlergia',
      rotulo: { singular: 'Tipo de alergia', plural: 'Tipos de alergia' },
      subitem: 'clinicos',
      natureza: 'editavel',
      acoes: CIE,
    },
    { ler: [6333, 6337], criar: [6335], editar: [6334], exportar: [6338] },
  ),
  inferida(
    {
      modulo: 'pep',
      recurso: 'viaAdministracaoDieta',
      rotulo: { singular: 'Via de administração de dieta', plural: 'Vias de administração de dieta' },
      subitem: 'clinicos',
      natureza: 'editavel',
      acoes: CIE,
    },
    GERAL_M_Z,
  ),
  inferida(
    {
      modulo: 'pep',
      recurso: 'modoVentilatorio',
      rotulo: { singular: 'Modo ventilatório', plural: 'Modos ventilatórios' },
      subitem: 'clinicos',
      natureza: 'editavel',
      acoes: CIE,
    },
    GERAL_M_Z,
  ),
];
