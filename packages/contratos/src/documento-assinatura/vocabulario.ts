// Vocabulário da assinatura ICP-Brasil (M49; ficha, seções 5 a 8; cap-13 §13.3.3): níveis, políticas, formatos,
// mídias do certificado, estados da assinatura, resultados da validação e os motivos de recusa. A tela mostra o rótulo,
// nunca o código cru nem nome de tabela. Os níveis são os mesmos da coluna de nível de assinatura do documento do M22
// e do M23 (eletronica-simples, eletronica-avancada, icp-brasil).

/** Nível da assinatura, em ordem crescente (Lei 14.063/2020, art. 4º: simples, avançada e qualificada). */
export const NIVEIS_ASSINATURA = ['eletronica-simples', 'eletronica-avancada', 'icp-brasil'] as const;
export type NivelAssinatura = (typeof NIVEIS_ASSINATURA)[number];

export const ROTULOS_NIVEL_ASSINATURA: Readonly<Record<NivelAssinatura, string>> = {
  'eletronica-simples': 'Simples',
  'eletronica-avancada': 'Avançada',
  'icp-brasil': 'Qualificada (ICP-Brasil)',
};

/**
 * Política de assinatura ICP-Brasil (DOC-ICP-15.03): referência básica (AD-RB) e com carimbo do tempo (AD-RT). São as
 * duas formas que o cadastro de formas de assinatura traz (2 linhas no pc); a mínima é AD-RB (regra 3).
 */
export const POLITICAS_ASSINATURA_ICP = ['AD-RB', 'AD-RT'] as const;
export type PoliticaAssinaturaIcp = (typeof POLITICAS_ASSINATURA_ICP)[number];

export const ROTULOS_POLITICA_ICP: Readonly<Record<PoliticaAssinaturaIcp, string>> = {
  'AD-RB': 'Referência básica (AD-RB)',
  'AD-RT': 'Com carimbo do tempo (AD-RT)',
};

/** Formato do envelope: PAdES no PDF/A (padrão), CAdES destacada e XAdES para XML. */
export const FORMATOS_ASSINATURA = ['pades', 'cades', 'xades'] as const;
export type FormatoAssinatura = (typeof FORMATOS_ASSINATURA)[number];

export const ROTULOS_FORMATO_ASSINATURA: Readonly<Record<FormatoAssinatura, string>> = {
  pades: 'PDF assinado (PAdES)',
  cades: 'Assinatura destacada (CAdES)',
  xades: 'XML assinado (XAdES)',
};

/** Onde está a chave privada: em nuvem no provedor (PSC, OAuth 2.0) ou A1/A3 no computador, pelo agente local. */
export const MIDIAS_CERTIFICADO = ['nuvem', 'a1', 'a3'] as const;
export type MidiaCertificado = (typeof MIDIAS_CERTIFICADO)[number];

export const ROTULOS_MIDIA_CERTIFICADO: Readonly<Record<MidiaCertificado, string>> = {
  nuvem: 'Certificado em nuvem',
  a1: 'Certificado A1 (arquivo, pelo agente local)',
  a3: 'Certificado A3 (token ou cartão, pelo agente local)',
};

/** Estado da assinatura de um documento (ficha, seção 6; regra 5). */
export const ESTADOS_ASSINATURA = ['pendente', 'assinada', 'falha'] as const;
export type EstadoAssinatura = (typeof ESTADOS_ASSINATURA)[number];

/** Resultado da validação (DOC-ICP-15; SBIS-32 a SBIS-34). */
export const RESULTADOS_VALIDACAO = ['valida', 'invalida', 'indeterminada'] as const;
export type ResultadoValidacao = (typeof RESULTADOS_VALIDACAO)[number];

export const ROTULOS_RESULTADO_VALIDACAO: Readonly<Record<ResultadoValidacao, string>> = {
  valida: 'Válida',
  invalida: 'Inválida',
  indeterminada: 'Indeterminada',
};

/** Momentos em que o documento é validado (ficha, seção 5: incluir, assinar, imprimir, importar e exportar). */
export const MOMENTOS_VALIDACAO = ['incluir', 'assinar', 'imprimir', 'importar', 'exportar'] as const;
export type MomentoValidacao = (typeof MOMENTOS_VALIDACAO)[number];

/**
 * Tipos de documento que a política cobre: os do documento do M23 (receita, atestado e os demais), o registro clínico
 * do M22 (evolução), a prescrição do M24 e o laudo do M26.
 */
export const TIPOS_DOCUMENTO_POLITICA = [
  'receita',
  'receita-controlada',
  'receita-antimicrobiano',
  'atestado',
  'declaracao',
  'requerimento',
  'sumario-alta',
  'tcle',
  'rel-transferencia',
  'declaracao-obito',
  'anexo',
  'exame-externo',
  'pedido-exame',
  'alergia',
  'registro-clinico',
  'prescricao',
  'laudo',
] as const;
export type TipoDocumentoPolitica = (typeof TIPOS_DOCUMENTO_POLITICA)[number];

/**
 * Ponte de cada tipo da política com o tipo de ato da trilha documental do legado (id do tipo de ato, lido na cópia do
 * pc em 24/10/2026): é por ela que a etapa 2 resolve a exigência de um documento emitido (documento →
 * assinatura do documento → cabeçalho da assinatura → tipo do ato → tipo da política). O primeiro ID de cada lista é o que o
 * novo grava (M22 a M26: 36 registro clínico, 37 prescrição, 40 atestado, 41 receita, 54 resultado lançado, 79 pedido
 * de exame); os demais são os do mesmo tipo vindos de outra origem (Mevo, laudos por setor). Um ID pode servir a mais
 * de um tipo (41: receita comum, de controle especial e de antimicrobiano): a etapa 2 desempata pelo documento do
 * novo, e o tipo de exigência mais alta vale quando não houver como desempatar (D-PRTP-49).
 */
export const TIPOS_ATO_LEGADO_POR_TIPO_POLITICA: Readonly<Record<TipoDocumentoPolitica, readonly number[]>> =
  {
    receita: [41, 62],
    'receita-controlada': [41],
    'receita-antimicrobiano': [41],
    atestado: [40, 61],
    declaracao: [40],
    requerimento: [40],
    'sumario-alta': [65],
    tcle: [39],
    'rel-transferencia': [74],
    'declaracao-obito': [74],
    anexo: [55],
    'exame-externo': [54],
    'pedido-exame': [79, 52, 64],
    alergia: [36],
    'registro-clinico': [36],
    prescricao: [37],
    laudo: [67, 68, 69, 70, 71, 72, 73],
  };

/** O documento sai do hospital (vai ao paciente, à farmácia, ao empregador) ou fica no prontuário. */
export const DESTINOS_DOCUMENTO = ['interno', 'externo'] as const;
export type DestinoDocumento = (typeof DESTINOS_DOCUMENTO)[number];

/** Recusas do motor de assinatura: o código vai à trilha e à resposta; o texto, só à tela. */
export const MOTIVOS_RECUSA_ASSINATURA = {
  'certificado-sem-cpf': 'O certificado não traz o CPF do titular.',
  'usuario-sem-cpf': 'Seu cadastro não tem CPF; peça ao administrador para completar antes de assinar.',
  'cpf-divergente': 'O CPF do certificado não é o seu. Use o seu próprio certificado.',
  'certificado-fora-da-vigencia': 'O certificado está fora da validade.',
  'certificado-fora-da-icp': 'O certificado não é da ICP-Brasil.',
  'uso-da-chave': 'O certificado não permite assinatura digital com não repúdio.',
  'certificado-revogado': 'O certificado foi revogado pela autoridade certificadora.',
  'cadeia-invalida': 'A cadeia do certificado não chega a uma raiz ICP-Brasil válida.',
  'hash-divergente': 'O documento mudou desde a prévia. Abra a prévia de novo antes de assinar.',
  'documento-sem-prova': 'Este documento não foi emitido por aqui e não recebe assinatura ICP.',
  'nivel-insuficiente': 'O nível desta assinatura é menor que o exigido para o documento.',
  'politica-insuficiente': 'Este documento exige assinatura com carimbo do tempo.',
  'nao-e-o-autor': 'Só o autor do documento pode assiná-lo.',
  'ja-assinado': 'Este documento já está assinado.',
  'autorizacao-expirada': 'A autorização do provedor expirou. Autorize de novo.',
  'provedor-desligado': 'O provedor de certificado não está disponível neste estabelecimento.',
  // M49, etapa 1: as recusas do fluxo (volta do provedor e resposta do agente local).
  'autorizacao-negada': 'A autorização foi negada no provedor. Nada foi assinado.',
  'certificado-divergente': 'O certificado usado não é o vinculado à sua conta.',
  'resposta-invalida': 'O provedor devolveu uma resposta que não confere. Nada foi gravado como assinado.',
  'psc-indisponivel': 'O provedor de certificado não respondeu. Tente de novo em instantes.',
  'certificado-invalido': 'O arquivo não é um certificado digital válido.',
  'servico-desligado': 'A assinatura com certificado ICP-Brasil não está ligada neste ambiente.',
  'ja-vinculado': 'Este certificado já está vinculado à sua conta.',
  // M49, etapa 2: documentos emitidos (prévia, lote, reprocessamento).
  'tipo-sem-icp': 'Este tipo de documento não recebe assinatura com certificado ICP-Brasil.',
  'documento-suspenso': 'O documento foi suspenso e não pode mais ser assinado.',
  'sem-previa': 'Abra a prévia do documento antes de assinar.',
  'emissao-indisponivel': 'Não foi possível gerar o PDF do documento agora. Tente de novo em instantes.',
  'conteudo-indisponivel':
    'Não foi possível ler o conteúdo deste documento agora. Nada foi preparado para assinar; tente de novo em instantes.',
  'nao-reprocessavel': 'Esta assinatura não está pendente nem em falha: não há o que reprocessar.',
  'sncr-desligada': 'A numeração SNCR da receita ainda não está ligada neste estabelecimento.',
  'sncr-nao-aplicavel': 'A numeração SNCR vale só para a receita de controle especial e a de antimicrobiano.',
  'sessao-como': 'Na sessão de suporte não se assina com certificado: a assinatura ICP-Brasil é pessoal.',
} as const;
export type MotivoRecusaAssinatura = keyof typeof MOTIVOS_RECUSA_ASSINATURA;

/**
 * Falhas que deixam a assinatura PENDENTE e reprocessável (regra 5; SBIS-37): a lista de revogação, o OCSP, a
 * autoridade de carimbo do tempo ou o provedor fora do ar. Não são recusa: o documento não fica sem assinatura.
 */
export const FALHAS_TRANSITORIAS_ASSINATURA = [
  'lcr-indisponivel',
  'ocsp-indisponivel',
  'act-indisponivel',
  'psc-indisponivel',
] as const;
export type FalhaTransitoriaAssinatura = (typeof FALHAS_TRANSITORIAS_ASSINATURA)[number];

export const ROTULOS_FALHA_TRANSITORIA: Readonly<Record<FalhaTransitoriaAssinatura, string>> = {
  'lcr-indisponivel': 'Lista de revogação indisponível',
  'ocsp-indisponivel': 'Consulta de revogação (OCSP) indisponível',
  'act-indisponivel': 'Carimbo do tempo indisponível',
  'psc-indisponivel': 'Provedor de certificado indisponível',
};

/** Escopos do PSC (DOC-ICP-17.01 v3.0, item 6.4). */
export const ESCOPOS_PSC = ['single_signature', 'multi_signature', 'signature_session'] as const;
export type EscopoPsc = (typeof ESCOPOS_PSC)[number];

/** Teto de documentos numa autorização do provedor (assinatura em lote; igual ao teto das pendências). */
export const TETO_LOTE_ASSINATURA = 200;

/** Código do QR do verificador público: opaco, sem identificador sequencial (contra varredura; regra 9). */
export const FORMATO_CODIGO_VERIFICACAO = /^[A-Za-z0-9_-]{16,64}$/;

/** Rótulos dos tipos de documento na tela da política (nenhum código cru na tela). */
export const ROTULOS_TIPO_DOCUMENTO_POLITICA: Readonly<Record<TipoDocumentoPolitica, string>> = {
  receita: 'Receita',
  'receita-controlada': 'Receita de controle especial',
  'receita-antimicrobiano': 'Receita de antimicrobiano',
  atestado: 'Atestado',
  declaracao: 'Declaração',
  requerimento: 'Requerimento',
  'sumario-alta': 'Sumário de alta',
  tcle: 'Termo de consentimento',
  'rel-transferencia': 'Relatório de transferência',
  'declaracao-obito': 'Declaração de óbito',
  anexo: 'Anexo',
  'exame-externo': 'Exame externo',
  'pedido-exame': 'Pedido de exame',
  alergia: 'Registro de alergia',
  'registro-clinico': 'Evolução e registro clínico',
  prescricao: 'Prescrição',
  laudo: 'Laudo',
};

export const ROTULOS_DESTINO_DOCUMENTO: Readonly<Record<DestinoDocumento, string>> = {
  interno: 'Fica no prontuário',
  externo: 'Sai do hospital',
};

/** Como o serviço de assinatura está ligado neste ambiente (a tela diz; nunca liga sozinho em produção). */
export const MODOS_ASSINATURA_ICP = ['simulador', 'producao', 'desligado'] as const;
export type ModoAssinaturaIcp = (typeof MODOS_ASSINATURA_ICP)[number];

/** Recusas da validação no servidor além das do certificado (a tela mostra o texto, nunca o código). */
export const MOTIVOS_VALIDACAO_ICP = {
  'cadeia-invalida': 'A cadeia do certificado não chega a uma raiz confiável.',
  'cadeia-indisponivel': 'Não foi possível conferir a cadeia agora.',
  'fora-da-vigencia': 'Certificado fora da validade.',
  revogado: 'Certificado revogado.',
  'revogacao-indisponivel': 'A lista de revogação não respondeu; a conferência será refeita.',
  'fora-da-icp': 'Certificado fora da ICP-Brasil.',
  'uso-da-chave': 'O certificado não permite assinatura com não repúdio.',
  'sem-politica': 'Sem política de assinatura.',
  'cpf-divergente': 'O CPF do certificado não é o do usuário.',
  'cpf-ausente': 'CPF ausente no certificado ou no cadastro.',
  'assinatura-nao-confere': 'A assinatura devolvida não confere com o documento.',
  'carimbo-invalido': 'O carimbo do tempo não confere.',
  'carimbo-indisponivel': 'O carimbo do tempo não respondeu; a conferência será refeita.',
} as const;
export type MotivoValidacaoIcp = keyof typeof MOTIVOS_VALIDACAO_ICP;
