// Liberação full na instalação (decisão do dono de 30/10/2026; ADR 0034, que substitui o 0019 e o 0028 no padrão
// desligado): na instalação, TODAS as chaves de liberação (os recursos de RECURSOS_DESLIGADOS e as operações do
// catálogo) são ligadas no estabelecimento inteiro pelo comando de terminal `pnpm liberacao:ligar-tudo`; a liberação
// gradual passa a ser operacional (os encarregados orientam o endereço e autorizam o login). Os níveis de acesso por
// login (permissões do M06) não mudam. Estas listas são as exceções versionadas, cada uma com o motivo; o comando e
// os testes pós-implantação (item `chaves`) leem daqui.
import { CATALOGOS, chaveResponsavelCatalogo } from '../catalogo/definicoes.js';
import { CHAVE_ENTRADA_UTF8 } from '../coexistencia/desligamento.js';
import { CHAVE_CLASSIFICACAO_EXTERNA } from '../recepcao/classificacao.js';

/** Marca do lote do comando (início da justificativa): a reversão desfaz só os lotes com ela. */
export const MARCA_LIBERACAO_FULL = 'LIBERACAO-FULL';

/** Quem grava pelo terminal (ALTERADO_POR e usuário da trilha): sem sessão, sem senha. */
export const ATOR_TERMINAL_LIBERACAO = 'TERMINAL';

/** Teto de linhas de SGH_CFG_LIBERACAO por estabelecimento para o comando gravar (a leitura corta em 5000). */
export const TETO_LINHAS_LIBERACAO_FULL = 4500;

export interface ExcecaoLiberacaoFull {
  readonly chave: string;
  readonly motivo: string;
}

/** Nunca ligadas em massa, em ambiente nenhum (a tela de chaves liga quando a condição existir). */
export const NUNCA_LIGAR_EM_MASSA: readonly ExcecaoLiberacaoFull[] = [
  {
    chave: CHAVE_ENTRADA_UTF8,
    motivo:
      'só depois da conversão do banco para UTF-8 verificada; ligada antes, grava fora do CP1252 no banco que o sistema anterior lê',
  },
  {
    chave: CHAVE_CLASSIFICACAO_EXTERNA,
    motivo:
      'uma fonte de cor no pronto atendimento: a classificação de risco própria (pa.classificacao) é a que liga; as duas juntas dariam duas fontes',
  },
];

/**
 * Não ligadas em dev/ci: o banco de dev tem contatos reais (cópia da produção). São as chaves que mandam mensagem ou
 * e-mail a pessoa (paciente, beneficiário ou grupo de destinatários).
 */
export const SEM_ENVIO_NO_DEV: readonly ExcecaoLiberacaoFull[] = [
  {
    chave: 'operadora.mensagens',
    motivo: 'envia mensagem ao beneficiário pela Hal-AI (a própria chave é a base legal aprovada, DP-44a)',
  },
  {
    chave: 'integracao.mensagensPaciente',
    motivo: 'mensagens ao paciente pela Hal-AI',
  },
  {
    chave: 'relatorio.envioAgendado',
    motivo: 'envia relatórios por e-mail aos grupos de destinatários cadastrados',
  },
];

const RESPONSAVEIS_CATALOGO: readonly ExcecaoLiberacaoFull[] = CATALOGOS.map((c) => ({
  chave: chaveResponsavelCatalogo(c.codigo),
  motivo:
    'este sistema passa a publicar a carga do catálogo (um responsável por vez; carga em dobro com o importador atual) e a chave não confere pré-requisito',
}));

/**
 * Em produção (e fora de dev/ci), não ligadas sem `--incluir=<chave>` com a referência da autorização do dono: têm
 * efeito externo real (mensagem, e-mail, arquivo oficial, interface em dobro, dado de paciente para fora, superfície
 * de acesso nova).
 */
export const DECISAO_DO_DONO_EM_PRODUCAO: readonly ExcecaoLiberacaoFull[] = [
  ...SEM_ENVIO_NO_DEV,
  {
    chave: 'financeiro.fiscal',
    motivo: 'a NFS-e vai sempre ao simulador: em produção gravaria nota "simulada" com número fictício',
  },
  {
    chave: 'faturamento.susAih',
    motivo: 'gera AIH para o SUS: arquivo oficial e risco de faturar em dobro com o sistema atual',
  },
  {
    chave: 'faturamento.susBpa',
    motivo: 'gera BPA para o SUS: arquivo oficial e risco de faturar em dobro com o sistema atual',
  },
  {
    chave: 'faturamento.susApac',
    motivo: 'gera APAC para o SUS: arquivo oficial e risco de faturar em dobro com o sistema atual',
  },
  {
    chave: 'faturamento.susCiha',
    motivo: 'o arquivo daqui passa a ser a fonte do envio da CIHA ao Ministério',
  },
  {
    chave: 'suprimentos.ambulatorial',
    motivo: 'escritura o SNGPC sem transmitir à Anvisa (registro regulatório não enviado)',
  },
  {
    chave: 'integracao.apoio',
    motivo: 'com parceiro configurado, ficam duas interfaces ativas para o mesmo laboratório de apoio',
  },
  {
    chave: 'imagem.worklist',
    motivo: 'com parceiro configurado, dado de paciente (nome, nascimento) vai ao PACS',
  },
  ...RESPONSAVEIS_CATALOGO,
  {
    chave: 'contabil.sped',
    motivo: 'gera a escrituração contábil oficial (SPED)',
  },
  {
    chave: 'rede.acessoCruzado',
    motivo: 'quem tem a leitura da Rede passa a ler outro estabelecimento (DP-42, LGPD)',
  },
  {
    chave: 'acesso.loginCertificado',
    motivo: 'entrada nova por certificado, com o teste de invasão pendente',
  },
  {
    chave: 'acesso.recuperacaoSenha',
    motivo:
      'envia e-mail ao usuário e abre uma entrada nova (o link de recuperação), com o servidor de e-mail pendente',
  },
  {
    chave: 'portal.medicoExterno',
    motivo: 'acesso de usuários de fora (médico externo)',
  },
  // Superfície pública e integrações cuja aprovação (do tipo `aprovacao`, que o comando dispensa em todo ambiente) é a
  // autorização do dono, o teste de invasão ou o aval do encarregado de dados: sem a lista, ligariam em produção sem
  // decisão (revisão do M61).
  {
    chave: 'portal.conta',
    motivo:
      'superfície pública para pacientes na internet (conta, documentos, responsável legal): termo e privacidade aprovados pelo DPO e teste de invasão sem achado crítico pendentes',
  },
  {
    chave: 'portal.agenda',
    motivo:
      'agendamento online e pré-check-in pela internet (superfície pública): teste de invasão e conferência dos chave-usuários pendentes',
  },
  {
    chave: 'portal.pagamento',
    motivo:
      'cobra o paciente pelo gateway de pagamento: pede a autorização do dono para o gateway em produção',
  },
  {
    chave: 'telemedicina',
    motivo:
      'teleconsulta com provedor externo: pede a autorização do dono para o provedor e a resposta do jurídico e do consultor SBIS',
  },
  {
    chave: 'sadt.portal',
    motivo:
      'portal de resultados na internet para paciente e médico externo: escopo do acesso aprovado pelo DPO (DP-43)',
  },
  {
    chave: 'operadora.portalPrestador',
    motivo: 'portal externo para os prestadores credenciados (usuários de fora, com perfil próprio)',
  },
  {
    chave: 'assinatura.icp',
    motivo:
      'integração da assinatura ICP-Brasil em produção: pede a autorização do dono e a política de assinatura (DP-22)',
  },
  {
    chave: 'integracao.parceiros',
    motivo:
      'entrega os eventos aos parceiros novos: pede a autorização do dono para a integração em produção',
  },
  {
    chave: 'faturamento.lote',
    motivo:
      'lote TISS à operadora: o envio real pede a autorização do dono registrada (e o risco de faturar em dobro com o sistema atual)',
  },
  // W0-03 (programa CRUD completo; dono único deste arquivo na onda 0): a agência transfusional completa liga na
  // liberação full do dev (a imuno-hematologia, a prova cruzada, o estoque de bolsas e as correções da bolsa ficam
  // exercitáveis na cópia); em produção é a DP-21 (agência própria ou do hemocentro), só com `--incluir`.
  {
    chave: 'agencia.completa',
    motivo:
      'DP-21: só com agência transfusional própria (imuno-hematologia, prova cruzada e estoque de bolsas); com a do hemocentro, fica desligada',
  },
  {
    chave: 'portaria.catraca',
    motivo:
      'integração com as catracas em produção: pede a autorização do dono e o integrador local do fabricante instalado',
  },
];

/** Ambientes da obra (sem contato real fora do loopback; o banco de dev é cópia da produção). */
export const ehAmbienteDaObra = (ambiente: string): boolean => ambiente === 'dev' || ambiente === 'ci';

/**
 * O valor padrão de IMPLANTACAO_CHAVES_ESPERADAS na instalação (liberação full): todas as chaves podem estar ligadas,
 * exceto as que o comando não liga no ambiente. Fora de dev/ci: as que nunca ligam em massa e as da decisão do dono;
 * em dev/ci: as que nunca ligam em massa e as que mandam mensagem ou e-mail (as da decisão do dono o comando liga).
 */
export function chavesEsperadasLiberacaoFull(ambiente: string): string {
  const fora = ehAmbienteDaObra(ambiente) ? SEM_ENVIO_NO_DEV : DECISAO_DO_DONO_EM_PRODUCAO;
  return `todas-exceto:${[...new Set([...NUNCA_LIGAR_EM_MASSA, ...fora].map((e) => e.chave))].join(',')}`;
}

/** O padrão da instalação em produção (o de `chavesEsperadasLiberacaoFull` fora de dev/ci). */
export const CHAVES_ESPERADAS_LIBERACAO_FULL = chavesEsperadasLiberacaoFull('producao');
