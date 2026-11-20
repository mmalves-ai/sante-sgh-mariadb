// Domínios do CRUD genérico do módulo `enfermagem` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import {
  CIE,
  CIEI,
  KITS_PROCEDIMENTO,
  M25,
  PROCEDIMENTOS_ENF,
  inferida,
  propria,
  todas,
} from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_ENFERMAGEM: readonly DominioPublico[] = [
  M25(
    propria(
      {
        modulo: 'enfermagem',
        recurso: 'procedimento',
        rotulo: {
          singular: 'Procedimento ou cuidado de enfermagem',
          plural: 'Procedimentos e cuidados de enfermagem',
        },
        subitem: 'enfermagemProcedimentos',
        natureza: 'editavel',
        acoes: CIEI,
      },
      todas(PROCEDIMENTOS_ENF, CIEI),
    ),
  ),
  M25({
    ...inferida(
      {
        modulo: 'enfermagem',
        recurso: 'kitProcedimento',
        rotulo: {
          singular: 'Kit do procedimento de enfermagem',
          plural: 'Kits dos procedimentos de enfermagem',
        },
        subitem: 'enfermagemProcedimentos',
        natureza: 'editavel',
        acoes: CIE,
      },
      KITS_PROCEDIMENTO,
    ),
  }),
];
