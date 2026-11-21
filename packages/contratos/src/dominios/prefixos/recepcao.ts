// Domínios do CRUD genérico do módulo `recepcao` (W0-01: um arquivo por prefixo; o agregador DOMINIOS_DECLARADOS, em
// ../catalogo.ts, já importa todos, inclusive os vazios). Domínio novo do módulo entra aqui; auxiliares em
// ../ajudantes.ts. Regras da obra: docs/operacoes/README.md.
import { LER, M19, propria, todas } from '../ajudantes.js';
import type { DominioPublico } from '../tipos.js';

export const DOMINIOS_RECEPCAO: readonly DominioPublico[] = [
  // Agenda, recepção e atendimento (REC 1)
  propria(
    {
      modulo: 'recepcao',
      recurso: 'motivoExclusao',
      rotulo: { singular: 'Motivo de exclusão de atendimento', plural: 'Motivos de exclusão de atendimento' },
      subitem: 'agenda',
      natureza: 'editavel',
      // W1-04: inativar só no novo (o motivo de exclusão da origem não tem coluna de situação) e excluir o motivo nunca usado, com o mapa de
      // dependências (recibos e notas cancelados, cópias de recibo, atendimentos excluídos pelo nome do motivo).
      acoes: ['ler', 'criar', 'editar', 'inativar', 'excluir', 'exportar'],
      categoria: 'dominio',
    },
    todas([3590], ['ler', 'criar', 'editar', 'inativar', 'excluir', 'exportar']),
  ),
  // W1-04: a procedência sai do lote gerado do M14 e ganha a alteração (todas as colunas; o gatilho do
  // banco só recusa trocar o nome da procedência já usada no atendimento, com a mensagem dele) e a exclusão física do
  // item nunca usado, com o mapa de dependências (8 FKs e 5 referências por código). Opções inferidas (POL-1b): a
  // opção "Tabelas" do módulo da recepção.
  {
    modulo: 'recepcao',
    recurso: 'procedencia',
    rotulo: { singular: 'Procedência', plural: 'Procedências' },
    subitem: 'agenda',
    natureza: 'editavel',
    acoes: ['ler', 'criar', 'editar', 'inativar', 'excluir', 'exportar'],
    categoria: 'dominio',
    opcoesLegado: {
      ler: [3220],
      criar: [3220],
      editar: [3220],
      inativar: [3220],
      excluir: [3220],
      exportar: [3220],
    },
    origemOpcoes: 'inferida',
    marco: 'M19',
  },
  M19(
    propria(
      {
        modulo: 'recepcao',
        recurso: 'recepcao',
        rotulo: { singular: 'Recepção ou setor de senha', plural: 'Recepções e setores de senha' },
        subitem: 'recepcaoRecepcoes',
        natureza: 'editavel',
        // W1-04 (parte 3): inclusão com o texto impresso na senha (TEXTOIMP), inativar só no novo e exclusão física
        // da recepção sem gerador nem senha (mapa de dependências).
        acoes: ['ler', 'criar', 'editar', 'inativar', 'excluir', 'exportar'],
        categoria: 'dominio',
      },
      {
        ler: [3725, 3724],
        criar: [3725],
        editar: [3725],
        inativar: [3725],
        excluir: [3725],
        exportar: [3725],
      },
    ),
  ),
  M19(
    propria(
      {
        modulo: 'recepcao',
        recurso: 'gerador',
        rotulo: { singular: 'Gerador de senha', plural: 'Geradores de senha' },
        subitem: 'recepcaoGeradores',
        natureza: 'editavel',
        acoes: ['ler', 'criar', 'editar', 'inativar', 'exportar'],
      },
      {
        ler: [3726, 3308, 3724],
        criar: [3726],
        editar: [3726],
        inativar: [3726],
        exportar: [3726, 3308],
      },
    ),
  ),
  M19(
    propria(
      {
        modulo: 'recepcao',
        recurso: 'painel',
        rotulo: { singular: 'Painel de chamada', plural: 'Painéis de chamada' },
        subitem: 'recepcaoPaineis',
        natureza: 'editavel',
        // W1-04 (parte 4): inclusão com o tipo travado e o leiaute do painel modelo, inativar só no novo e exclusão
        // física do painel sem painel de TV nem dispositivo ligado (mapa de dependências).
        acoes: ['ler', 'criar', 'editar', 'inativar', 'excluir', 'exportar'],
        categoria: 'dominio',
      },
      {
        ler: [3724, 3970],
        criar: [3724],
        editar: [3971],
        inativar: [3724],
        excluir: [3724],
        exportar: [3724],
      },
    ),
  ),
  M19(
    propria(
      {
        modulo: 'recepcao',
        recurso: 'tipoPainel',
        rotulo: { singular: 'Tipo de painel', plural: 'Tipos de painel' },
        subitem: 'recepcaoPaineis',
        natureza: 'travado',
        motivoSomenteLeitura: 'os códigos 1 (senha), 2 (atendimento) e 3 (portal) são fixos: só consulta',
        acoes: LER,
      },
      { ler: [3724, 3970], exportar: [3724] },
    ),
  ),
];
