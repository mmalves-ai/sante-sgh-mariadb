// Permissões do M26 (ficha, seção 7; convencoes.md §12): SADT (laboratório, imagem, métodos gráficos, endoscopia),
// laudos e portal de resultados. Quem tem a opção no menu de origem tem a permissão (regra 1 do M06); a
// correspondência está em conector/mapa/permissoes.tsv.
// Liberar resultado de laboratório é do responsável técnico habilitado e laudar imagem, endoscopia e métodos gráficos
// é privativo de médico (regra 8): o servidor confere o vínculo da sessão.
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_SADT_CODIGOS = {
  requisicaoLer: 'sadt.requisicao.ler',
  requisicaoCriar: 'sadt.requisicao.criar',
  requisicaoAutorizarExcecao: 'sadt.requisicao.autorizarExcecao',
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
  catalogoLer: 'sadt.catalogo.ler',
  catalogoEditar: 'sadt.catalogo.editar',
} as const;

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'clinica',
  criticidade: 'normal',
  ...extra,
});

export const PERMISSOES_SADT_M26: readonly DeclaracaoPermissao[] = [
  p(
    'sadt.requisicao.ler',
    'Consultar os atendimentos do diagnóstico do dia e a requisição de exames do atendimento',

    { categoria: 'administrativa' },
  ),
  p(
    'sadt.requisicao.criar',
    'Abrir a requisição de exames do atendimento (convênio, médico solicitante, autorização e guia)',

    { categoria: 'administrativa' },
  ),
  p(
    'sadt.requisicao.autorizarExcecao',
    'Autorizar a exceção a uma restrição clínica do exame (sexo, idade, material, horário, repetição) com justificativa; quem só pede não libera a própria exceção',
    // Recurso novo, sem opção de origem: concedido ao administrador do sistema, que repassa por cargo.
    { criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  p('sadt.lancamento.ler', 'Ver os pedidos do prontuário a receber e os exames lançados do dia por setor'),
  p(
    'sadt.lancamento.lancar',
    'Lançar exame direto no setor (laboratório, imagem, métodos gráficos, endoscopia)',
  ),
  p(
    'sadt.lancamento.receber',
    'Receber o pedido de exame do prontuário no setor (o pedido deixa de estar pendente)',
  ),
  p('sadt.orcamento.ler', 'Consultar os orçamentos particulares de exames', {
    categoria: 'financeira',
  }),
  p('sadt.orcamento.criar', 'Fazer o orçamento particular de exames com validade', {
    categoria: 'financeira',
  }),
  p(
    'sadt.orcamento.converter',
    'Converter o orçamento aprovado em lançamento no atendimento, com os mesmos exames e valores',

    { categoria: 'financeira' },
  ),
  p('sadt.amostra.ler', 'Ver a lista de coleta, o mapa de trabalho e o rastreio das amostras'),
  p('sadt.amostra.coletar', 'Registrar a coleta com a leitura da pulseira e imprimir a etiqueta da amostra'),
  p('sadt.amostra.receber', 'Registrar o transporte, o recebimento e a análise da amostra no laboratório'),
  p('sadt.amostra.rejeitar', 'Rejeitar a amostra com o motivo e pedir a recoleta'),
  p('sadt.resultado.ler', 'Ver os resultados digitados, a referência e o mapa da digitação'),
  p(
    'sadt.resultado.digitar',
    'Digitar ou importar o resultado do exame (elementos, observações, variáveis de fórmula)',
  ),
  p(
    'sadt.resultado.liberar',
    'Conferir e liberar o resultado de laboratório (responsável técnico habilitado)',

    { criticidade: 'sensivel', exigeConselho: true },
  ),
  p(
    'sadt.resultado.retificar',
    'Retificar o resultado já liberado, com o motivo (a versão anterior fica guardada e quem viu é avisado)',

    { criticidade: 'critica', exigeConselho: true },
  ),
  p(
    'sadt.avisoCritico.comunicar',
    'Comunicar o valor crítico ao médico ou enfermeiro responsável e acompanhar o escalonamento',
  ),
  p('sadt.valorCritico.ler', 'Consultar a lista de valores críticos por elemento e o prazo de comunicação'),
  p(
    'sadt.valorCritico.editar',
    'Manter a lista de valores críticos aprovada pela diretoria clínica (faixa e prazo por elemento)',

    { criticidade: 'sensivel' },
  ),
  p(
    'sadt.catalogo.ler',
    'Consultar o catálogo de exames: setores, materiais, preparo, analitos, faixas e fórmulas',
  ),
  p(
    'sadt.catalogo.editar',
    'Manter o catálogo de exames (exame, setor, material, preparo, lateralidade, exames ligados, analitos, faixa de referência com versão e fórmula)',
    { criticidade: 'sensivel' },
  ),
  p('sadt.laudo.ler', 'Consultar os laudos emitidos, a autenticação e as entregas'),
  p('sadt.laudo.imprimir', 'Emitir e imprimir o laudo com código de autenticação e QR; reemitir a 2ª via'),
  p('sadt.laudo.criar', 'Escrever o laudo de imagem, endoscopia ou métodos gráficos no editor do setor'),
  p(
    'sadt.laudo.assinar',
    'Assinar e liberar o laudo de imagem, endoscopia ou métodos gráficos (privativo de médico)',

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

    {
      concessaoPorPerfil: 'por-perfil',
      perfis: ['portal-paciente', 'portal-medico-externo'],
      categoria: 'clinica',
    },
  ),
  p(
    'sadt.solicitanteWeb.ler',
    'Ver os autocadastros de médico solicitante feitos no portal',

    { categoria: 'administrativa' },
  ),
  p(
    'sadt.solicitanteWeb.aprovar',
    'Aprovar ou recusar o autocadastro do médico solicitante (liga ao médico do cadastro)',

    { categoria: 'administrativa', criticidade: 'sensivel' },
  ),
  p(
    'sadt.indicador.ler',
    'Ver os indicadores do diagnóstico (tempo do pedido à liberação, produção, críticos no prazo)',

    { categoria: 'administrativa' },
  ),
  p(
    'sadt.parametro.ler',
    'Ver os parâmetros do setor do diagnóstico (sem os segredos guardados no outro sistema)',

    { categoria: 'administrativa' },
  ),
];

export const PERMISSOES_PACS_CODIGOS = {
  ler: 'sadt.pacs.ler',
  reenviar: 'sadt.pacs.reenviar',
} as const;

export const PERMISSOES_PACS_M47: readonly DeclaracaoPermissao[] = [
  p(
    PERMISSOES_PACS_CODIGOS.ler,
    'Ver a lista de trabalho DICOM: os exames de imagem lançados, o item enviado ao PACS, o estado da entrega e o status do exame na modalidade',
  ),
  p(
    PERMISSOES_PACS_CODIGOS.reenviar,
    'Enviar à lista de trabalho DICOM os exames de imagem que ficaram de fora e reenviar um item com o mesmo número de acesso (técnico de imagem, TI)',

    { criticidade: 'sensivel' },
  ),
];
