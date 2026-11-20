// Domínios do CRUD genérico do módulo `cirurgia` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import { CIE, M18, propria, todas } from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_CIRURGIA: readonly DominioPublico[] = [
  propria(
    {
      modulo: 'cirurgia',
      recurso: 'tipoAnestesia',
      rotulo: { singular: 'Tipo de anestesia', plural: 'Tipos de anestesia' },
      subitem: 'internacao',
      natureza: 'editavel',
      acoes: CIE,
    },
    todas([5618], CIE),
  ),
  M18(
    propria(
      {
        modulo: 'cirurgia',
        recurso: 'sala',
        rotulo: { singular: 'Sala cirúrgica', plural: 'Salas cirúrgicas' },
        subitem: 'internacao',
        natureza: 'editavel',
        acoes: CIE,
      },
      todas([2233, 4506], CIE),
    ),
  ),
];
