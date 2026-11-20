// Domínios do CRUD genérico do módulo `atendimento` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import { FICHAS, LEITOS, M20, propria, selecaoFicha, todas } from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_ATENDIMENTO: readonly DominioPublico[] = [
  M20(
    propria(
      {
        modulo: 'atendimento',
        recurso: 'modeloFicha',
        rotulo: { singular: 'Ficha a imprimir', plural: 'Fichas a imprimir' },
        subitem: 'agenda',
        natureza: 'editavel',
        // W1-05: inclusão e exclusão física do item nunca usado (o leiaute impresso não fica no banco: medido na cópia).
        acoes: ['ler', 'criar', 'editar', 'excluir', 'exportar'],
        categoria: 'dominio',
      },
      todas(FICHAS, ['ler', 'criar', 'editar', 'excluir', 'exportar']),
    ),
  ),
  M20(
    propria(
      {
        modulo: 'atendimento',
        recurso: 'tituloFicha',
        rotulo: { singular: 'Título da ficha', plural: 'Títulos das fichas' },
        subitem: 'agenda',
        natureza: 'editavel',
        // W1-05: inclusão e exclusão física do item nunca usado (o leiaute impresso não fica no banco: medido na cópia).
        acoes: ['ler', 'criar', 'editar', 'excluir', 'exportar'],
        categoria: 'dominio',
      },
      todas(FICHAS, ['ler', 'criar', 'editar', 'excluir', 'exportar']),
    ),
  ),
  selecaoFicha('fichaConvenio', 'Ficha por convênio', 'Fichas por convênio'),
  selecaoFicha('fichaEspecialidade', 'Ficha por especialidade', 'Fichas por especialidade'),
  selecaoFicha('fichaUnidade', 'Ficha por unidade', 'Fichas por unidade'),
  selecaoFicha('fichaGrupo', 'Ficha por grupo de procedimento', 'Fichas por grupo de procedimento'),
  M20(
    propria(
      {
        modulo: 'atendimento',
        recurso: 'localObservacao',
        rotulo: { singular: 'Local de observação', plural: 'Locais de observação' },
        subitem: 'estruturaLeitos',
        natureza: 'editavel',
        // W1-05: o local novo nasce com a acomodação do mapa de leitos pelo gatilho do banco; a exclusão física só do
        // local sem leito (o leito é a chave do mapa: inativa-se, nunca se altera).
        acoes: ['ler', 'criar', 'editar', 'excluir', 'exportar'],
        categoria: 'dominio',
      },
      todas(LEITOS, ['ler', 'criar', 'editar', 'excluir', 'exportar']),
    ),
  ),
  M20(
    propria(
      {
        modulo: 'atendimento',
        recurso: 'leitoObservacao',
        rotulo: { singular: 'Leito de observação', plural: 'Leitos de observação' },
        subitem: 'estruturaLeitos',
        natureza: 'editavel',
        // O local e o código do leito são a chave do mapa de leitos (o gatilho recusa mudar) e o tipo segue o local:
        // inclusão e inativação.
        acoes: ['ler', 'criar', 'inativar', 'exportar'],
      },
      todas(LEITOS, ['ler', 'criar', 'inativar', 'exportar']),
    ),
  ),
];
