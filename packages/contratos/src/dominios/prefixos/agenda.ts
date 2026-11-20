// Domínios do CRUD genérico do módulo `agenda` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import { CIE, CIEI, M18, propria } from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_AGENDA: readonly DominioPublico[] = [
  M18(
    propria(
      {
        modulo: 'agenda',
        recurso: 'agendaExame',
        rotulo: { singular: 'Agenda de exames', plural: 'Agendas de exames' },
        subitem: 'agenda',
        natureza: 'editavel',
        acoes: CIEI,
      },
      { ler: [2759, 2760], criar: [2760], editar: [2760], inativar: [2760], exportar: [2759, 2760] },
    ),
  ),
  M18(
    propria(
      {
        modulo: 'agenda',
        recurso: 'escalaExame',
        rotulo: { singular: 'Escala da agenda de exames', plural: 'Escalas das agendas de exames' },
        subitem: 'agenda',
        natureza: 'editavel',
        acoes: CIE,
      },
      { ler: [2759, 2760], criar: [2760], editar: [2760], exportar: [2759, 2760] },
    ),
  ),
];
