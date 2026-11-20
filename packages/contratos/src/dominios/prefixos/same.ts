// Domínios do CRUD genérico do módulo `same` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import { CIE, LER, M21, SAME_SETORES, propria, todas } from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_SAME: readonly DominioPublico[] = [
  M21(
    propria(
      {
        modulo: 'same',
        recurso: 'setor',
        rotulo: { singular: 'Setor do arquivo', plural: 'Setores do arquivo' },
        subitem: 'hotelaria',
        natureza: 'editavel',
        acoes: CIE,
      },
      todas(SAME_SETORES, CIE),
    ),
  ),
  M21(
    propria(
      {
        modulo: 'same',
        recurso: 'operacao',
        rotulo: { singular: 'Operação do arquivo', plural: 'Operações do arquivo' },
        subitem: 'hotelaria',
        natureza: 'sistema',
        acoes: LER,
        motivoSomenteLeitura:
          'dado de sistema: o gatilho da tabela recusa inclusão, alteração e exclusão (as 6 operações do arquivo são fixas)',
      },
      todas(SAME_SETORES, LER),
    ),
  ),
];
