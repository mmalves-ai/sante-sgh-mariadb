import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_OPME_CODIGOS = {
  ler: 'suprimentos.opme.ler',
  solicitar: 'suprimentos.opme.solicitar',
  autorizar: 'suprimentos.opme.autorizar',
  avancar: 'suprimentos.opme.avancar',
  consumir: 'suprimentos.opme.consumir',
  conciliar: 'suprimentos.opme.conciliar',
} as const;
const C = PERMISSOES_OPME_CODIGOS;

export const PERMISSOES_OPME_M46: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.ler,
    descricao: 'Consultar as solicitações de OPME, as etapas e os consumos em sala',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.solicitar,
    descricao: 'Solicitar OPME para a cirurgia agendada (TUSS, quantidade, fornecedor e justificativa)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.autorizar,
    descricao:
      'Registrar a autorização ou a negativa da operadora para o OPME (senha, guia e validade) e o consumo sem autorização como supervisor',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'critica',
  },
  {
    codigo: C.avancar,
    descricao:
      'Registrar as etapas do OPME (cotação, pedido, consignação, esterilização, nota fiscal e cancelamento)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: C.consumir,
    descricao:
      'Registrar o consumo de OPME em sala com o rastreio por lote ou série e imprimir a etiqueta (circulante)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.conciliar,
    descricao: 'Conciliar o OPME consumido com a conta do paciente (o indicador de OPME usado sem cobrança)',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
];
