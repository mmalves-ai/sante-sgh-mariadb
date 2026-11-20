// Vocabulário da operadora própria (M56; ficha, seções 3, 6 e 8; cap-07 §7.4). Os códigos são os dos domínios que o
// outro sistema já tem (levantados na cópia pc em 24/10/2026, só domínio de configuração, sem dado de pessoa): os dados
// novos da operadora (produto, contrato, beneficiário, cobrança, prestador, guia, conta, envio) gravam o código e a tela
// mostra o rótulo, nunca o código cru nem o nome da tabela. Os rótulos vêm normalizados para a tela (a tabela tem
// alguns em maiúsculas e com erro de grafia, como "CONJUGÊ").

/** Tipo de cobrança ao beneficiário (TBTIPOCOBRANCASGO; ref 02; regra 6). */
export const TIPOS_COBRANCA_OPERADORA = {
  1: 'Mensalidade',
  2: 'Coparticipação avulsa',
  3: 'Cobrança avulsa',
  4: 'Acordos e parcelamentos',
} as const;
export type TipoCobrancaOperadora = keyof typeof TIPOS_COBRANCA_OPERADORA;

/** Vínculo com o titular (SPVINCULOTITULAR; 1 é o próprio titular). */
export const VINCULOS_TITULAR = {
  1: 'Titular',
  2: 'Responsável legal',
  3: 'Cônjuge',
  4: 'Irmão ou irmã',
  5: 'Filho ou filha',
  6: 'Pai',
  7: 'Mãe',
  8: 'Outros',
} as const;
export type VinculoTitular = keyof typeof VINCULOS_TITULAR;
/** Código do vínculo do próprio titular (o beneficiário sem titular acima dele). */
export const VINCULO_TITULAR = 1 as const satisfies VinculoTitular;

/** Tipo de contratação do plano (CDPLANOCLASSIF; os três da regulação da ANS). */
export const TIPOS_CONTRATACAO = {
  1: 'Individual ou familiar',
  2: 'Coletivo empresarial',
  3: 'Coletivo por adesão',
} as const;
export type TipoContratacao = keyof typeof TIPOS_CONTRATACAO;

/** Tipo de contrato (CDTPCONTRATO): pessoa física (individual ou familiar) ou pessoa jurídica (coletivo). */
export const TIPOS_CONTRATO_OPERADORA = { 1: 'Individual ou familiar', 2: 'Coletivo' } as const;
export type TipoContratoOperadora = keyof typeof TIPOS_CONTRATO_OPERADORA;

/** Forma de reajuste do contrato (TBTPFORMAREAJ; carga de referência). */
export const FORMAS_REAJUSTE = {
  1: 'IPCA',
  2: 'IGP-M',
  3: 'INPC',
  4: 'Outro índice',
  5: 'Livre negociação',
  6: 'Fórmula específica',
  7: 'Livre negociação com índice previsto em contrato',
  8: 'Variação do valor da tabela de referência',
} as const;
export type FormaReajuste = keyof typeof FORMAS_REAJUSTE;

/** Tipo de vigência do contrato (TBTPVIGCONTRATO). */
export const TIPOS_VIGENCIA_CONTRATO = { 1: 'Prazo determinado', 2: 'Prazo indeterminado' } as const;
export type TipoVigenciaContrato = keyof typeof TIPOS_VIGENCIA_CONTRATO;

/** Acomodação do plano (CDACOMODTIPO). */
export const ACOMODACOES_PLANO_OPERADORA = { 1: 'Apartamento', 2: 'Enfermaria', 3: 'Ambulatório' } as const;
export type AcomodacaoPlanoOperadora = keyof typeof ACOMODACOES_PLANO_OPERADORA;

/** Tipo de coparticipação do plano (CDTPCOPART). */
export const TIPOS_COPARTICIPACAO = { 1: 'Nenhum', 2: 'Percentual', 3: 'Valor fixo' } as const;
export type TipoCoparticipacao = keyof typeof TIPOS_COPARTICIPACAO;

/** Movimento cadastral do beneficiário (CDSTATUSCAD; é o que vai ao SIB). */
export const MOVIMENTOS_CADASTRAIS = {
  1: 'Inclusão',
  2: 'Alteração',
  3: 'Exclusão',
  4: 'Reativação',
} as const;
export type MovimentoCadastral = keyof typeof MOVIMENTOS_CADASTRAIS;

/** Situação da guia na operadora (CDGUIASTATUS). */
export const SITUACOES_GUIA_OPERADORA = {
  1: 'Autorizada',
  2: 'Liberada',
  3: 'Importada',
  4: 'Realizada',
  5: 'Cancelada',
  6: 'Glosada',
  7: 'Fechada',
  8: 'Apresentada',
  9: 'Orçamento',
} as const;
export type SituacaoGuiaOperadora = keyof typeof SITUACOES_GUIA_OPERADORA;

/** Tipo de guia na operadora (CDTPGUIA). */
export const TIPOS_GUIA_OPERADORA = {
  1: 'Ambulatório',
  2: 'Consulta',
  3: 'Internação',
  4: 'SP/SADT',
} as const;
export type TipoGuiaOperadora = keyof typeof TIPOS_GUIA_OPERADORA;

/** Tipo de prestador da rede (TBTPPRESTADOR). */
export const TIPOS_PRESTADOR_REDE = {
  1: 'Consultório médico',
  2: 'Centro clínico',
  3: 'Hospital geral',
  4: 'Laboratório',
  5: 'Consultório dentário',
  6: 'Clínica odontológica',
  7: 'Serviço de imagem',
  8: 'Prestador de reembolso',
} as const;
export type TipoPrestadorRede = keyof typeof TIPOS_PRESTADOR_REDE;

/** Movimento da rede credenciada (TBSTATUSCREPLS; é o que vai ao RPS da ANS). */
export const MOVIMENTOS_REDE = { 1: 'Inclusão', 2: 'Alteração', 3: 'Exclusão', 4: 'Reinclusão' } as const;
export type MovimentoRede = keyof typeof MOVIMENTOS_REDE;

/** Tipo de contratação do prestador (TBTPCONTRATOCREPLS). */
export const CONTRATACOES_PRESTADOR = { 1: 'Direta', 2: 'Indireta' } as const;
export type ContratacaoPrestador = keyof typeof CONTRATACOES_PRESTADOR;

/** Modelo de remuneração do prestador (TBTISSREMUNERAOPERPS; vigência desde 01/08/2021). */
export const MODELOS_REMUNERACAO = {
  1: 'Por procedimento',
  2: 'Pacote',
  3: 'Orçamentação',
  4: 'Capitação',
  5: 'DRG',
  6: 'Bundle baseado em episódio',
  7: 'Bundle por condição clínica',
} as const;
export type ModeloRemuneracao = keyof typeof MODELOS_REMUNERACAO;

/** Regime de atendimento do contrato com o prestador (TBREGIMEATEND). */
export const REGIMES_ATENDIMENTO_OPERADORA = {
  1: 'Ambulatorial',
  2: 'Hospitalar',
  3: 'Ambulatorial e hospitalar',
} as const;
export type RegimeAtendimentoOperadora = keyof typeof REGIMES_ATENDIMENTO_OPERADORA;

/** Origem do atendimento ao beneficiário (SPORIGEM_ATEND; só leitura). */
export const ORIGENS_ATENDIMENTO_OPERADORA = {
  1: 'Liberação de guias',
  2: 'Recepção externa',
  3: 'Serviços de diagnóstico',
  4: 'Portal autorizador',
  5: 'Sistemas de terceiros',
  6: 'Serviço de atendimento ao cliente',
} as const;
export type OrigemAtendimentoOperadora = keyof typeof ORIGENS_ATENDIMENTO_OPERADORA;

/** Funções do portal do prestador (PFPORTALOPCAO; o perfil Prestador recebe as que o contrato der). */
export const FUNCOES_PORTAL_PRESTADOR = {
  1: 'Solicitar autorização',
  2: 'Cancelar autorização',
  3: 'Consultar autorização',
  4: 'Gerar faturamento',
  5: 'Configurar autorização',
  6: 'Gerenciar acesso',
  7: 'Consultar protocolo',
  8: 'Configurar parâmetros',
} as const;
export type FuncaoPortalPrestador = keyof typeof FUNCOES_PORTAL_PRESTADOR;

/** Tipo de atendimento no portal do prestador (PFTPATEND). */
export const TIPOS_ATENDIMENTO_PORTAL = {
  1: 'Todos',
  2: 'Ambulatório',
  3: 'Consultório',
  4: 'Clínica',
  5: 'Hospital',
} as const;
export type TipoAtendimentoPortal = keyof typeof TIPOS_ATENDIMENTO_PORTAL;

/**
 * Segmentação assistencial do produto (Lei 9.656/1998, art. 12; o produto registrado na ANS tem uma). Não há domínio
 * no outro sistema: o código é do novo e grava em `SGH_OPE_PRODUTO`.
 */
export const SEGMENTACOES_PRODUTO = {
  ambulatorial: 'Ambulatorial',
  hospitalarSemObstetricia: 'Hospitalar sem obstetrícia',
  hospitalarComObstetricia: 'Hospitalar com obstetrícia',
  ambulatorialHospitalar: 'Ambulatorial e hospitalar',
  odontologico: 'Odontológico',
  referencia: 'Plano-referência',
} as const;
export type SegmentacaoProduto = keyof typeof SEGMENTACOES_PRODUTO;

/** Abrangência geográfica do produto (código do novo, em `SGH_OPE_PRODUTO`). */
export const ABRANGENCIAS_PRODUTO = {
  municipal: 'Municipal',
  grupoMunicipios: 'Grupo de municípios',
  estadual: 'Estadual',
  grupoEstados: 'Grupo de estados',
  nacional: 'Nacional',
} as const;
export type AbrangenciaProduto = keyof typeof ABRANGENCIAS_PRODUTO;

/**
 * Natureza do produto (regra 2): plano de saúde (com registro na ANS) ou cartão de desconto, que não é plano e reduz o
 * escopo a cadastro, cobrança e regras de desconto no faturamento particular.
 */
export const NATUREZAS_PRODUTO = {
  plano: 'Plano de saúde',
  cartaoDesconto: 'Cartão de desconto',
} as const;
export type NaturezaProduto = keyof typeof NATUREZAS_PRODUTO;

/**
 * Obrigações com a ANS (ficha, seção 1 e regra 7). A periodicidade orienta a competência do envio; o envio real só em
 * `producao`, com arquivo, hash e recibo guardados em `SGH_OPE_ENVIO_ANS`.
 */
export const OBRIGACOES_ANS = {
  SIB: { rotulo: 'Cadastro de beneficiários (SIB)', periodicidade: 'mensal' },
  SIP: { rotulo: 'Informações de produtos (SIP)', periodicidade: 'trimestral' },
  DIOPS: { rotulo: 'Informações econômico-financeiras (DIOPS)', periodicidade: 'trimestral' },
  TPS: { rotulo: 'Taxa de saúde suplementar (TPS)', periodicidade: 'trimestral' },
  MONITORAMENTO_TISS: { rotulo: 'Monitoramento TISS', periodicidade: 'mensal' },
  RESSARCIMENTO_SUS: { rotulo: 'Ressarcimento ao SUS', periodicidade: 'sob demanda' },
} as const;
export type ObrigacaoAns = keyof typeof OBRIGACOES_ANS;
export const CODIGOS_OBRIGACAO_ANS = Object.keys(OBRIGACOES_ANS) as ObrigacaoAns[];
