// Chaves de liberação da operadora própria (M56, etapa F0; ficha, seções 8 (regra 1) e 12; POL-3). A chave do módulo
// é `operadora` (já no catálogo desde o M08, com o registro na ANS como pré-requisito); cada fatia tem a sua,
// `operadora.<recurso>`, todas DESLIGADAS por padrão em todo estabelecimento. A chave da fatia só vale com a do módulo
// ligada (regra pura em @sgh/dominio-operadora). As telas e as rotas de cada fatia conferem a chave da fatia.
import type { PrerequisitoDeclarado } from '../liberacao/recursos.js';

/** Chave do módulo (SGH_CFG_LIBERACAO, tipo `recurso`). */
export const CHAVE_MODULO_OPERADORA = 'operadora' as const;

export type FatiaOperadora = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8';

export interface ChaveFatiaOperadora {
  readonly recurso: string;
  readonly fatia: FatiaOperadora;
  readonly titulo: string;
  readonly descricao: string;
  readonly prerequisitos: readonly PrerequisitoDeclarado[];
}

export const CHAVES_FATIA_OPERADORA = [
  {
    recurso: 'beneficiarios',
    fatia: 'F1',
    titulo: 'Produtos, planos, contratos e beneficiários da operadora',
    descricao:
      'Produtos e planos com registro na ANS, contratos de pessoa física e jurídica, titulares, dependentes e carteirinha.',
    prerequisitos: [],
  },
  {
    recurso: 'cobranca',
    fatia: 'F2',
    titulo: 'Cobrança e mensalidades da operadora',
    descricao:
      'Mensalidade, coparticipação, cobrança avulsa, acordos, reajuste e inadimplência, com boleto e portal.',
    prerequisitos: [
      {
        tipo: 'contrato',
        descricao: 'Convênio de cobrança bancária (boleto) da operadora',
        responsavel: 'financeiro da operadora',
      },
    ],
  },
  {
    recurso: 'mensagens',
    fatia: 'F2',
    titulo: 'Mensagens ao beneficiário',
    descricao:
      'Aviso de cobrança, vencimento e protocolo ao beneficiário pelo canal de comunicação contratado; nunca fora de produção.',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Base legal das mensagens ao beneficiário aprovada pelo encarregado de dados (DP-44, parte a)',
        responsavel: 'encarregado de dados (DPO)',
      },
    ],
  },
  {
    recurso: 'rede',
    fatia: 'F3',
    titulo: 'Rede credenciada e prestadores da operadora',
    descricao:
      'Credenciamento, contrato e modelo de remuneração dos prestadores, com o próprio hospital como prestador.',
    prerequisitos: [],
  },
  {
    recurso: 'autorizacao',
    fatia: 'F4',
    titulo: 'Autorização de guias e auditoria médica da operadora',
    descricao:
      'Análise e decisão das guias pedidas pelos prestadores, com auditoria médica e protocolo de atendimento.',
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Médico e enfermeiro auditores da operadora designados pela diretoria técnica da operadora',
        responsavel: 'diretoria da operadora',
      },
    ],
  },
  {
    recurso: 'contas',
    fatia: 'F5',
    titulo: 'Contas médicas recebidas pela operadora',
    descricao:
      'Contas dos prestadores recebidas em XML TISS, validadas na versão vigente, com análise, glosa e pagamento.',
    // M56.6 (D-CHAVE-CONTAS-56): a análise é do auditor designado e o pagamento segue o prazo dos contratos da rede.
    prerequisitos: [
      {
        tipo: 'aprovacao',
        descricao:
          'Auditores de contas médicas designados e prazo de pagamento aos prestadores aprovado pela diretoria da operadora',
        responsavel: 'diretoria da operadora',
      },
    ],
  },
  {
    recurso: 'ans',
    fatia: 'F6',
    titulo: 'Envios à ANS',
    descricao:
      'SIB, SIP, DIOPS, TPS, monitoramento TISS e ressarcimento ao SUS, com arquivo, hash e recibo guardados; envio real só em produção.',
    prerequisitos: [
      {
        tipo: 'certificado',
        descricao: 'Certificado digital da operadora (e-CNPJ) e acesso aos sistemas de envio da ANS',
        responsavel: 'responsável pelos envios à ANS',
      },
      // M56.7 (D-LEIAUTE-ANS-567): os arquivos saem no leiaute do Sante; o envio real só depois de conferidos.
      {
        tipo: 'aprovacao',
        descricao:
          'Arquivos de teste do cadastro de beneficiários, dos produtos e do monitoramento aprovados no validador oficial da ANS',
        responsavel: 'responsável pelos envios à ANS',
      },
    ],
  },
  {
    recurso: 'atendimento',
    fatia: 'F7',
    titulo: 'Atendimento ao beneficiário com protocolo',
    descricao: 'Registro do contato do beneficiário com número de protocolo, prazos de resposta e histórico.',
    prerequisitos: [],
  },
  {
    recurso: 'portalPrestador',
    fatia: 'F7',
    titulo: 'Portal do prestador credenciado',
    descricao:
      'Portal externo para o prestador pedir autorização, consultar protocolo e enviar faturamento, com perfil próprio.',
    prerequisitos: [],
  },
  {
    recurso: 'interface',
    fatia: 'F8',
    titulo: 'Interface com sistema de operadora contratado',
    descricao:
      'Troca de beneficiários, elegibilidade, autorizações e retorno de contas com o sistema de operadora contratado.',
    prerequisitos: [
      {
        tipo: 'contrato',
        descricao: 'Contrato com o fornecedor do sistema de operadora e as credenciais no cofre',
        responsavel: 'diretoria e TI',
      },
    ],
  },
] as const satisfies readonly ChaveFatiaOperadora[];

export type RecursoOperadora = (typeof CHAVES_FATIA_OPERADORA)[number]['recurso'];
export type ChaveOperadora = typeof CHAVE_MODULO_OPERADORA | `operadora.${RecursoOperadora}`;

/** Todas as chaves do módulo: a do módulo e as das fatias. */
export const CHAVES_OPERADORA: readonly ChaveOperadora[] = [
  CHAVE_MODULO_OPERADORA,
  ...CHAVES_FATIA_OPERADORA.map((c): ChaveOperadora => `operadora.${c.recurso}`),
];
