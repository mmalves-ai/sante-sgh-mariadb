// Cadastros da agência transfusional no CRUD genérico (M47, etapa 2; ficha, seção 5, "Receita genérica do CRUD para os
// 14 SH* do marco"; tela "Cadastros e parâmetros da agência"). Pelo catálogo RDB$ e pelo levantamento da cópia `pc`
// (cada um com a linha 0 "NAO INFORMADO", código gerado pelo gatilho BI do próprio cadastro): as condutas, os estados
// finais, as intercorrências, os locais de armazenagem, os motivos de devolução ou perda, as reações transfusionais e os
// clientes (serviços atendidos pela agência) passam a ser editáveis, só com a agência própria (chave
// `agencia.completa`, DP-21). Ficam só em consulta (D-CAD-47.2): os tipos de movimentação (o gatilho de exclusão protege
// os códigos 0 a 99 que o estoque usa), os tipos de transfusão (os 4 da RDC 34 que a requisição grava pelo ID), os
// parâmetros do outro sistema (impressão e lançamento; a senha mestra nunca é lida), os técnicos (dado de pessoa: CPF e
// endereço) e os cadastros da triagem de doador (exames, perguntas e respostas: a coleta é do hemocentro).
// Opções do outro sistema (TBOPCOES, módulo Hemoterapia, nenhuma concedida no pc): Tabelas 3048 › Cadastro 3050 e o item
// de cada cadastro; a consulta dos resultados do laboratório e o registro do laboratório (D-PERM-47.2).
import type { DominioPublico } from './tipos.js';

const TABELAS = 3048;
const CADASTRO = 3050;
const LAB_REGISTRO_ALTERAR = 6206;
const LAB_REGISTRO_CONSULTAR = 6209;
/** A chave de recurso que liga a gravação destes cadastros (POL-3; DP-21). */
export const CHAVE_CADASTROS_AGENCIA = 'agencia.completa';

const m47 = (recurso: string, singular: string, plural: string, opcao: number): DominioPublico => ({
  modulo: 'sadt',
  recurso,
  rotulo: { singular, plural },
  subitem: 'agenciaCadastros',
  natureza: 'editavel',
  acoes: ['ler', 'criar', 'editar', 'exportar'],
  opcoesLegado: {
    ler: [TABELAS, CADASTRO, opcao, LAB_REGISTRO_CONSULTAR],
    exportar: [TABELAS, CADASTRO, opcao, LAB_REGISTRO_CONSULTAR],
    criar: [CADASTRO, opcao, LAB_REGISTRO_ALTERAR],
    editar: [CADASTRO, opcao, LAB_REGISTRO_ALTERAR],
  },
  origemOpcoes: 'inferida',
  chaveRecurso: CHAVE_CADASTROS_AGENCIA,
  // A permissão da tela "Cadastros e parâmetros da agência" (ficha, §7) também é exigida para gravar.
  permissaoGravacaoGrupo: 'sadt.agenciaCadastro.editar',
  marco: 'M47',
});

export const DOMINIOS_M47: readonly DominioPublico[] = [
  m47('agenciaCliente', 'Cliente da agência', 'Clientes da agência', 3054),
  m47('agenciaConduta', 'Conduta na reação', 'Condutas na reação', 3060),
  m47('agenciaEstadoFinal', 'Estado final', 'Estados finais', 3057),
  m47('agenciaIntercorrencia', 'Intercorrência', 'Intercorrências', 3062),
  m47('agenciaLocal', 'Local de armazenagem', 'Locais de armazenagem', 3061),
  m47('agenciaMotivoDevolucao', 'Motivo de devolução ou perda', 'Motivos de devolução ou perda', 3063),
  m47('agenciaReacao', 'Reação transfusional (cadastro)', 'Reações transfusionais (cadastro)', 3053),
];
