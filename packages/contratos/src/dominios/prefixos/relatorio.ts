// Domínios do CRUD genérico do módulo `relatorio` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import { M19, propria } from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_RELATORIO: readonly DominioPublico[] = [
  M19(
    propria(
      {
        modulo: 'relatorio',
        recurso: 'painel',
        rotulo: { singular: 'Painel de TV de setor', plural: 'Painéis de TV de setores' },
        subitem: 'relatorioPaineisTv',
        natureza: 'editavel',
        // W1-04 (parte 4): inclusão com o leiaute do painel vazio, inativar só no novo e exclusão física do painel sem
        // dispositivo de TV ligado (mapa de dependências).
        acoes: ['ler', 'criar', 'editar', 'inativar', 'excluir', 'exportar'],
        categoria: 'dominio',
      },
      {
        ler: [3972, 3973],
        criar: [3973],
        editar: [3973],
        inativar: [3973],
        excluir: [3973],
        exportar: [3972],
      },
    ),
  ),
];
