// Permissões do M26 (ficha, seção 7; convencoes.md §12): SADT (laboratório, imagem, métodos gráficos, endoscopia),
// laudos e portal de resultados. Quem tem a opção no legado tem a permissão no novo (regra 1 do M06). Opções da árvore
// TBOPCOES do módulo S.A.D.T. (9) (retrato tools/verificadores/dados/acesso-legado.pc.json):
//   - Lançamentos › Atendimentos 2728 › Externo 2729 (Alterar 6103, Incluir 6104, Consultar 6106) e Interno 2730
//     (Alterar 6149, Incluir 6150, Consultar 6152); os exames por setor: externo Laboratório 6114 (6115 a 6118),
//     Radiologia 6129 (6130 a 6133), Tomografia 6134 (6135 a 6138), Ultrassonografia 6139 (6140 a 6143), Endoscopia
//     6124 (6125 a 6128), Outros 6144 (6145 a 6148); interno Laboratório 6159 (6160 a 6163), Radiologia 6174 (6175 a
//     6178), Tomografia 6179 (6180 a 6183), Ultrassonografia 6184 (6185 a 6188), Endoscopia 6169 (6170 a 6173), Outros
//     6189 (6190 a 6193); Ficha/Talão/Relat./Etiq. 2731; Etiqueta de triagem de laboratório 4754;
//   - Resultados 2738: Laboratório › Registro 2743 (6206 a 6209) e Especialidade 2744 (6210 a 6213); Radiologia 2745
//     (6214 a 6217), Tomografia 2746 (6218 a 6221), Ultrassonografia 2747 (6222 a 6225), Endoscopia 2740 (6198 a
//     6201), Outros 2748 (6226 a 6229);
//   - Solicitações do PEP 2758 (Alterar 6230, Incluir 6231, Consultar 6233, Cancelar 6234); Entrega resultado 4756
//     (Laboratório 4760: 6255 a 6258; Radiologia 4761; Tomografia 4762; Ultrassonografia 4763; Endoscopia 4758;
//     Outros 4764); Orçamento 2803; Rastreabilidade 6985 (Recoleta 6809, Registro de amostras 6810, Rastreabilidade
//     6811, Painel 6812) e Tabelas › Rastreabilidade 6984 (motivo de recoleta 6805, status 6806);
//   - Tabelas › Parâmetros 2678; Integração com PACs 4740 (Equipamento 4742); Integração Resultados web 4743 (Cadastro
//     de perfil 4744, Perfil por usuário 4745, Configurações gerais 4747, Acesso médico solicitante 4748); Utilitários
//     › Liberar resultados p/ Web 2972; Relatórios 2804 (Laudos emitidos 2845; Mapa de produção 2849).
// Perfil da trilha do legado (cópia pc, 2026-06-01 a 2026-07-05, só contagens): inclusão de resultado de laboratório
// na 6211 (tipo 2), recebimento do pedido do prontuário na 6230 (tipo 3), lançamento direto do laboratório na 6116
// (externo) e 6161 (internado), tipo 2. Liberar resultado de laboratório é do responsável técnico habilitado e laudar
// imagem, endoscopia e métodos gráficos é privativo de médico (regra 8): o servidor confere o vínculo da sessão.
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_SADT = {
  atendimentos: 2728,
  externo: 2729,
  externoAlterar: 6103,
  externoIncluir: 6104,
  externoConsultar: 6106,
  interno: 2730,
  internoAlterar: 6149,
  internoIncluir: 6150,
  internoConsultar: 6152,
  fichaEtiqueta: 2731,
  etiquetaTriagem: 4754,
  resultados: 2738,
  labRegistroAlterar: 6206,
  labRegistroIncluir: 6207,
  labRegistroConsultar: 6209,
  labEspecialidadeAlterar: 6210,
  labEspecialidadeIncluir: 6211,
  labEspecialidadeConsultar: 6213,
  rxAlterar: 6214,
  rxIncluir: 6215,
  rxConsultar: 6217,
  tcAlterar: 6218,
  tcIncluir: 6219,
  tcConsultar: 6221,
  usAlterar: 6222,
  usIncluir: 6223,
  usConsultar: 6225,
  endoAlterar: 6198,
  endoIncluir: 6199,
  endoConsultar: 6201,
  outrosAlterar: 6226,
  outrosIncluir: 6227,
  outrosConsultar: 6229,
  solicitacoesPep: 2758,
  solicitacoesPepAlterar: 6230,
  solicitacoesPepIncluir: 6231,
  solicitacoesPepConsultar: 6233,
  solicitacoesPepCancelar: 6234,
  entregaResultado: 4756,
  entregaLaboratorio: 4760,
  entregaLabAlterar: 6255,
  entregaLabIncluir: 6256,
  entregaLabConsultar: 6258,
  entregaRadiologia: 4761,
  entregaTomografia: 4762,
  entregaUltrassom: 4763,
  entregaEndoscopia: 4758,
  entregaOutros: 4764,
  orcamento: 2803,
  rastreabilidade: 6985,
  recoleta: 6809,
  registroAmostras: 6810,
  rastreabilidadeAmostras: 6811,
  painelExames: 6812,
  tabelasRastreabilidade: 6984,
  motivoRecoleta: 6805,
  statusAmostra: 6806,
  parametros: 2678,
  integracaoPacs: 4740,
  pacsEquipamento: 4742,
  resultadosWeb: 4743,
  webCadastroPerfil: 4744,
  webPerfilUsuario: 4745,
  webConfiguracoesGerais: 4747,
  webAcessoMedicoSolicitante: 4748,
  liberarResultadosWeb: 2972,
  relatorios: 2804,
  laudosEmitidos: 2845,
  mapaProducao: 2849,
  // Lançamento de exames por setor (Incluir): externo e internado.
  labExternoIncluir: 6116,
  labExternoConsultar: 6118,
  rxExternoIncluir: 6131,
  tcExternoIncluir: 6136,
  usExternoIncluir: 6141,
  endoExternoIncluir: 6126,
  outrosExternoIncluir: 6146,
  labInternoIncluir: 6161,
  labInternoConsultar: 6163,
  rxInternoIncluir: 6176,
  tcInternoIncluir: 6181,
  usInternoIncluir: 6186,
  endoInternoIncluir: 6171,
  outrosInternoIncluir: 6191,
} as const;

const O = OPCOES_SADT;

export const PERMISSOES_SADT_CODIGOS = {
  requisicaoLer: 'sadt.requisicao.ler',
  requisicaoCriar: 'sadt.requisicao.criar',
  lancamentoLer: 'sadt.lancamento.ler',
  lancamentoLancar: 'sadt.lancamento.lancar',
  lancamentoReceber: 'sadt.lancamento.receber',
  orcamentoLer: 'sadt.orcamento.ler',
  orcamentoCriar: 'sadt.orcamento.criar',
  orcamentoConverter: 'sadt.orcamento.converter',
  amostraLer: 'sadt.amostra.ler',
  amostraColetar: 'sadt.amostra.coletar',
  amostraReceber: 'sadt.amostra.receber',
  amostraRejeitar: 'sadt.amostra.rejeitar',
  resultadoLer: 'sadt.resultado.ler',
  resultadoDigitar: 'sadt.resultado.digitar',
  resultadoLiberar: 'sadt.resultado.liberar',
  resultadoRetificar: 'sadt.resultado.retificar',
  avisoCriticoComunicar: 'sadt.avisoCritico.comunicar',
  valorCriticoLer: 'sadt.valorCritico.ler',
  valorCriticoEditar: 'sadt.valorCritico.editar',
  laudoLer: 'sadt.laudo.ler',
  laudoImprimir: 'sadt.laudo.imprimir',
  laudoCriar: 'sadt.laudo.criar',
  laudoAssinar: 'sadt.laudo.assinar',
  portalLer: 'sadt.portal.ler',
  solicitanteWebLer: 'sadt.solicitanteWeb.ler',
  solicitanteWebAprovar: 'sadt.solicitanteWeb.aprovar',
  indicadorLer: 'sadt.indicador.ler',
  parametroLer: 'sadt.parametro.ler',
} as const;

const p = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado,
  concessaoPorPerfil: null,
  categoria: 'clinica',
  criticidade: 'normal',
  ...extra,
});

const LANCAR = [
  O.labExternoIncluir,
  O.rxExternoIncluir,
  O.tcExternoIncluir,
  O.usExternoIncluir,
  O.endoExternoIncluir,
  O.outrosExternoIncluir,
  O.labInternoIncluir,
  O.rxInternoIncluir,
  O.tcInternoIncluir,
  O.usInternoIncluir,
  O.endoInternoIncluir,
  O.outrosInternoIncluir,
];
const CONSULTAR_RESULTADO = [
  O.resultados,
  O.labRegistroConsultar,
  O.labEspecialidadeConsultar,
  O.rxConsultar,
  O.tcConsultar,
  O.usConsultar,
  O.endoConsultar,
  O.outrosConsultar,
];
const LAUDAR = [
  O.rxIncluir,
  O.rxAlterar,
  O.tcIncluir,
  O.tcAlterar,
  O.usIncluir,
  O.usAlterar,
  O.endoIncluir,
  O.endoAlterar,
  O.outrosIncluir,
  O.outrosAlterar,
];

export const PERMISSOES_SADT_M26: readonly DeclaracaoPermissao[] = [
  p(
    'sadt.requisicao.ler',
    'Consultar os atendimentos do diagnóstico do dia e a requisição de exames do atendimento',
    [O.atendimentos, O.externo, O.externoConsultar, O.interno, O.internoConsultar],
    { categoria: 'administrativa' },
  ),
  p(
    'sadt.requisicao.criar',
    'Abrir a requisição de exames do atendimento (convênio, médico solicitante, autorização e guia)',
    [O.externoIncluir, O.internoIncluir, O.labExternoIncluir],
    { categoria: 'administrativa' },
  ),
  p('sadt.lancamento.ler', 'Ver os pedidos do prontuário a receber e os exames lançados do dia por setor', [
    O.solicitacoesPep,
    O.solicitacoesPepConsultar,
    O.labExternoConsultar,
    O.labInternoConsultar,
    O.externoConsultar,
  ]),
  p(
    'sadt.lancamento.lancar',
    'Lançar exame direto no setor (laboratório, imagem, métodos gráficos, endoscopia)',
    LANCAR,
  ),
  p(
    'sadt.lancamento.receber',
    'Receber o pedido de exame do prontuário no setor (o pedido deixa de estar pendente)',
    [O.solicitacoesPepAlterar, O.solicitacoesPepIncluir],
  ),
  p('sadt.orcamento.ler', 'Consultar os orçamentos particulares de exames', [O.orcamento], {
    categoria: 'financeira',
  }),
  p('sadt.orcamento.criar', 'Fazer o orçamento particular de exames com validade', [O.orcamento], {
    categoria: 'financeira',
  }),
  p(
    'sadt.orcamento.converter',
    'Converter o orçamento aprovado em lançamento no atendimento, com os mesmos exames e valores',
    [O.orcamento, O.externoIncluir, O.labExternoIncluir],
    { categoria: 'financeira' },
  ),
  p('sadt.amostra.ler', 'Ver a lista de coleta, o mapa de trabalho e o rastreio das amostras', [
    O.rastreabilidade,
    O.rastreabilidadeAmostras,
    O.painelExames,
    O.registroAmostras,
    O.fichaEtiqueta,
  ]),
  p('sadt.amostra.coletar', 'Registrar a coleta com a leitura da pulseira e imprimir a etiqueta da amostra', [
    O.registroAmostras,
    O.etiquetaTriagem,
    O.fichaEtiqueta,
  ]),
  p('sadt.amostra.receber', 'Registrar o transporte, o recebimento e a análise da amostra no laboratório', [
    O.registroAmostras,
    O.rastreabilidadeAmostras,
  ]),
  p('sadt.amostra.rejeitar', 'Rejeitar a amostra com o motivo e pedir a recoleta', [
    O.recoleta,
    O.motivoRecoleta,
  ]),
  p(
    'sadt.resultado.ler',
    'Ver os resultados digitados, a referência e o mapa da digitação',
    CONSULTAR_RESULTADO,
  ),
  p(
    'sadt.resultado.digitar',
    'Digitar ou importar o resultado do exame (elementos, observações, variáveis de fórmula)',
    [O.labRegistroIncluir, O.labRegistroAlterar, O.labEspecialidadeIncluir, O.labEspecialidadeAlterar],
  ),
  p(
    'sadt.resultado.liberar',
    'Conferir e liberar o resultado de laboratório (responsável técnico habilitado)',
    [O.labRegistroAlterar, O.labEspecialidadeAlterar, O.liberarResultadosWeb],
    { criticidade: 'sensivel', exigeConselho: true },
  ),
  p(
    'sadt.resultado.retificar',
    'Retificar o resultado já liberado, com o motivo (a versão anterior fica guardada e quem viu é avisado)',
    [O.labRegistroAlterar, O.labEspecialidadeAlterar],
    { criticidade: 'critica', exigeConselho: true },
  ),
  p(
    'sadt.avisoCritico.comunicar',
    'Comunicar o valor crítico ao médico ou enfermeiro responsável e acompanhar o escalonamento',
    [O.labRegistroAlterar, O.labEspecialidadeAlterar, O.liberarResultadosWeb],
  ),
  p('sadt.valorCritico.ler', 'Consultar a lista de valores críticos por elemento e o prazo de comunicação', [
    O.parametros,
    O.resultados,
  ]),
  p(
    'sadt.valorCritico.editar',
    'Manter a lista de valores críticos aprovada pela diretoria clínica (faixa e prazo por elemento)',
    [O.parametros],
    { criticidade: 'sensivel' },
  ),
  p('sadt.laudo.ler', 'Consultar os laudos emitidos, a autenticação e as entregas', [
    O.entregaResultado,
    O.entregaLaboratorio,
    O.entregaLabConsultar,
    O.laudosEmitidos,
  ]),
  p('sadt.laudo.imprimir', 'Emitir e imprimir o laudo com código de autenticação e QR; reemitir a 2ª via', [
    O.entregaLabAlterar,
    O.entregaLabIncluir,
    O.entregaRadiologia,
    O.entregaTomografia,
    O.entregaUltrassom,
    O.entregaEndoscopia,
    O.entregaOutros,
  ]),
  p(
    'sadt.laudo.criar',
    'Escrever o laudo de imagem, endoscopia ou métodos gráficos no editor do setor',
    LAUDAR,
  ),
  p(
    'sadt.laudo.assinar',
    'Assinar e liberar o laudo de imagem, endoscopia ou métodos gráficos (privativo de médico)',
    LAUDAR,
    { criticidade: 'sensivel', exigeConselho: true },
  ),
  // A configuração do portal (perfis, modalidades visíveis, usuários, permissões, setores publicados) é CRUD genérico:
  // as permissões são as do recurso (`sadt.portalPerfil.*` e as demais do grupo `portalResultados`, com as mesmas
  // opções 4743, 4744, 4745 e 4747), sem uma `sadt.portalConfig.*` à parte que nada usaria (D-PERM-26).
  // O portal tem identidade própria (paciente pelo código do protocolo, médico externo pela conta com segundo fator;
  // cap-08 §8.3): a permissão nunca vem de usuário interno; o servidor do portal a dá à sessão do portal.
  p(
    'sadt.portal.ler',
    'Consultar no portal os laudos liberados (paciente: os seus; médico externo: os pedidos em que é o solicitante)',
    [],
    {
      concessaoPorPerfil: 'por-perfil',
      perfis: ['portal-paciente', 'portal-medico-externo'],
      categoria: 'clinica',
    },
  ),
  p(
    'sadt.solicitanteWeb.ler',
    'Ver os autocadastros de médico solicitante feitos no portal',
    [O.webAcessoMedicoSolicitante],
    { categoria: 'administrativa' },
  ),
  p(
    'sadt.solicitanteWeb.aprovar',
    'Aprovar ou recusar o autocadastro do médico solicitante (liga ao médico do cadastro)',
    [O.webAcessoMedicoSolicitante],
    { categoria: 'administrativa', criticidade: 'sensivel' },
  ),
  p(
    'sadt.indicador.ler',
    'Ver os indicadores do diagnóstico (tempo do pedido à liberação, produção, críticos no prazo)',
    [O.relatorios, O.mapaProducao],
    { categoria: 'administrativa' },
  ),
  p(
    'sadt.parametro.ler',
    'Ver os parâmetros do setor do diagnóstico (sem os segredos guardados no outro sistema)',
    [O.parametros],
    { categoria: 'administrativa' },
  ),
];

/**
 * M47 (etapa 3; ficha, seção 7): a lista de trabalho DICOM e a integração com o PACS/RIS (técnico de imagem e TI). As
 * opções do sistema anterior: Tabelas › Integração com PACs 4740 (Equipamento 4742), quem a configura; a consulta dos
 * resultados de radiologia, tomografia e ultrassonografia (6217, 6221, 6225) e o lançamento direto nesses setores
 * (externo 6131, 6136, 6141; interno 6176, 6181, 6186), quem opera a modalidade. Reenviar e simular o status também
 * exigem a chave `imagem.worklist`.
 */
const LER_PACS = [
  O.integracaoPacs,
  O.pacsEquipamento,
  O.rxConsultar,
  O.tcConsultar,
  O.usConsultar,
  O.rxExternoIncluir,
  O.tcExternoIncluir,
  O.usExternoIncluir,
  O.rxInternoIncluir,
  O.tcInternoIncluir,
  O.usInternoIncluir,
];
const OPERAR_PACS = [
  O.integracaoPacs,
  O.pacsEquipamento,
  O.rxExternoIncluir,
  O.tcExternoIncluir,
  O.usExternoIncluir,
  O.rxInternoIncluir,
  O.tcInternoIncluir,
  O.usInternoIncluir,
];

export const PERMISSOES_PACS_CODIGOS = {
  ler: 'sadt.pacs.ler',
  reenviar: 'sadt.pacs.reenviar',
} as const;

export const PERMISSOES_PACS_M47: readonly DeclaracaoPermissao[] = [
  p(
    PERMISSOES_PACS_CODIGOS.ler,
    'Ver a lista de trabalho DICOM: os exames de imagem lançados, o item enviado ao PACS, o estado da entrega e o status do exame na modalidade',
    LER_PACS,
  ),
  p(
    PERMISSOES_PACS_CODIGOS.reenviar,
    'Enviar à lista de trabalho DICOM os exames de imagem que ficaram de fora e reenviar um item com o mesmo número de acesso (técnico de imagem, TI)',
    OPERAR_PACS,
    { criticidade: 'sensivel' },
  ),
];
