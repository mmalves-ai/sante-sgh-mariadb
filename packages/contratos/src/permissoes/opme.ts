// Permissões do M46, etapa 3 (ficha, seção 7; convencoes.md §12): OPME (solicitação ligada à agenda, autorização da
// operadora e consignação, consumo em sala com o rastreio, conciliação com a conta). Quem tem a opção no sistema anterior
// tem a permissão no novo (regra 1 do M06). Opções da árvore do menu de origem (retrato tools/verificadores/dados/acesso-legado.pc.json):
//   - Gestão de estoque: Saídas 1840 (paciente interno 5733, Listagem 1845), Requisições de saída 1895 (paciente interno
//     1896), Lançamentos 1929 (paciente interno 5736), Pedidos 2123 (Manutenção 2124, Autorização dos pedidos 4491),
//     Entrada de nota fiscal 5722 e Rastreabilidade 2055;
//   - Bloco Cirúrgico: o módulo 2227, o mapa 2293, o agendamento 2263 e a manutenção 2264 (quem agenda a cirurgia pede o
//     material dela);
//   - Faturamento: lançamentos 1121 e as contas internas 1123 (o faturista concilia o OPME com a conta).
// O rastreio reverso (lote ou série → pacientes) usa a permissão do rastreio de lote do M28 (`suprimentos.lote.rastrear`,
// leitura auditada). O consumo sem a autorização da operadora exige o supervisor (`suprimentos.opme.autorizar` ou a
// exceção do bloco `cirurgia.checklist.excecao`, D-SUP-463).
import { OPCOES_BLOCO } from './cirurgia.js';
import { OPCOES_FATURAMENTO } from './faturamento.js';
import { OPCOES_SUPRIMENTOS } from './suprimentos.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_OPME_CODIGOS = {
  ler: 'suprimentos.opme.ler',
  solicitar: 'suprimentos.opme.solicitar',
  autorizar: 'suprimentos.opme.autorizar',
  avancar: 'suprimentos.opme.avancar',
  consumir: 'suprimentos.opme.consumir',
  conciliar: 'suprimentos.opme.conciliar',
} as const;

const O = OPCOES_SUPRIMENTOS;
const B = OPCOES_BLOCO;
const F = OPCOES_FATURAMENTO;
const C = PERMISSOES_OPME_CODIGOS;

export const PERMISSOES_OPME_M46: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.ler,
    descricao: 'Consultar as solicitações de OPME, as etapas e os consumos em sala',
    opcoesLegado: [O.saidas, O.saidaListagem, O.pedidos, B.modulo, B.mapa],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.solicitar,
    descricao: 'Solicitar OPME para a cirurgia agendada (TUSS, quantidade, fornecedor e justificativa)',
    opcoesLegado: [O.requisicaoInterno, B.agendamento, B.manutencao],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.autorizar,
    descricao:
      'Registrar a autorização ou a negativa da operadora para o OPME (senha, guia e validade) e o consumo sem autorização como supervisor',
    opcoesLegado: [O.autorizacaoPedidos],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'critica',
  },
  {
    codigo: C.avancar,
    descricao:
      'Registrar as etapas do OPME (cotação, pedido, consignação, esterilização, nota fiscal e cancelamento)',
    opcoesLegado: [O.pedidoManutencao, O.entradaNota],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: C.consumir,
    descricao:
      'Registrar o consumo de OPME em sala com o rastreio por lote ou série e imprimir a etiqueta (circulante)',
    opcoesLegado: [O.saidaInterno, O.lancamentoInterno],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.conciliar,
    descricao: 'Conciliar o OPME consumido com a conta do paciente (o indicador de OPME usado sem cobrança)',
    opcoesLegado: [F.lancamentos, F.internas, O.saidaListagem],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
];
