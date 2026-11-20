// Textos do painel de estado da fachada da API de integração da Hal-AI (M58, etapa 4; ficha, seções 7 e 8, regra 9).
// Sem nome de sistema antigo (ADR 0023) e sem chave técnica de parâmetro: cada parâmetro tem rótulo próprio. Todo
// modo, superfície, escopo, necessidade e parâmetro do contrato tem texto (conferido no teste).
import type { EscopoTokenFachada, ModoFachada, NecessidadeFachada, SuperficieFachada } from '@sgh/contratos';

const superficies: Record<SuperficieFachada, string> = {
  atendimento: 'Atendimento',
  gestao: 'Gestão',
  acoes: 'Ações',
  auditoria: 'Auditoria clínica',
  saude: 'Saúde do serviço',
};

const escopos: Record<EscopoTokenFachada, string> = {
  principal: 'Chave principal',
  gestao: 'Chave da gestão',
  auditoria: 'Chave da auditoria clínica',
};

const modos: Record<ModoFachada, string> = {
  servida: 'Servida pelo Sante SGH',
  repassada: 'Repassada à API da Hal-AI',
  desligada: 'Desligada',
};

const necessidades: Record<NecessidadeFachada, string> = {
  'nao-necessaria': 'Não necessária agora',
  necessaria: 'Necessária',
};

export const mensagensFachada = {
  titulo: 'Fachada da API de integração da Hal-AI',
  texto:
    'A fachada atende os Squads da Hal-AI no mesmo contrato da API de integração dela quando o banco passar para UTF-8 e essa API não acompanhar a tempo. Cada operação é servida aqui, repassada à API da Hal-AI ou fica desligada. A escrita fica desligada por padrão; as ações passam por proposta e confirmação.',
  carregando: 'Carregando…',
  medidoDesde: 'Uso medido desde {quando}',
  versaoContrato: 'Contrato da API: versão {versao}',
  hospital: 'Estabelecimento: {hospital}',
  necessidade: 'Necessidade',
  necessidades,
  situacao: 'Situação',
  ligada: 'Ligada',
  desligada: 'Desligada',
  sim: 'Sim',
  nao: 'Não',
  estado: {
    titulo: 'Estado da fachada',
    fachada: 'Fachada',
    escrita: 'Escrita (ações e gravações)',
    destino: 'Repasse à API da Hal-AI',
    destinoConfigurado: 'configurado',
    destinoAusente: 'não configurado (o que não é servido aqui fica desligado)',
  },
  prontidao: {
    titulo: 'Prontidão para o UTF-8',
    pronta: 'Pronta',
    naoPronta: 'Ainda não pronta',
    usadas: 'Operações usadas pelos Squads e ainda não servidas aqui',
  },
  motor: {
    titulo: 'Ações em dois tempos',
    texto:
      'Cada ação começa por uma proposta, que não grava nada, válida por {minutos} minutos e de uso único; a confirmação relê o estado antes de gravar.',
    pendentes: 'Propostas pendentes: {n} (no máximo {max})',
  },
  totais: {
    titulo: 'Operações do contrato',
    operacoes: 'Operações',
    servidas: 'Servidas',
    repassadas: 'Repassadas',
    desligadas: 'Desligadas',
  },
  superficie: 'Superfície',
  superficies,
  escopo: 'Chave de acesso',
  escopos,
  token: 'Chave definida no servidor',
  tokenSim: 'definida',
  tokenNao: 'ausente',
  modo: 'Modo',
  modos,
  filtros: {
    titulo: 'Filtrar operações',
    superficie: 'Superfície',
    modo: 'Modo',
    todas: 'Todas',
    busca: 'Caminho contém',
    nenhuma: 'Nenhuma operação com esse filtro.',
    mostrando: 'Mostrando {n} de {total} operações',
  },
  operacao: {
    caminho: 'Operação',
    escreve: 'Grava',
    motivo: 'Motivo',
    equivalentes: 'Operações equivalentes no Sante SGH',
    semEquivalente: 'sem equivalente',
    chamadas: 'Chamadas',
    erros: 'Erros',
    estadoEquivalente: '{nome} ({estado})',
    semEstado: 'fora do catálogo',
  },
  configurar: {
    titulo: 'Configurar a fachada',
    texto:
      'Cada mudança vale para este estabelecimento, fica registrada na trilha com a justificativa e pede a sua senha de novo. As chaves de acesso dos Squads ficam no servidor, nunca nesta tela.',
    semPermissao: 'Você pode ver o painel, mas não configurar a fachada.',
    parametro: 'O que mudar',
    parametros: {
      ligada: 'Fachada ligada',
      escrita: 'Escrita ligada (ações e gravações)',
      superficies: 'Superfícies atendidas',
      destino: 'Endereço da API da Hal-AI para o repasse',
    },
    valorSimNao: 'Novo valor',
    valorSuperficies: 'Superfícies atendidas',
    valorDestino: 'Endereço (http ou https; vazio desliga o repasse)',
    avisoEscrita:
      'Ligar a escrita deixa os Squads proporem e confirmarem ações neste estabelecimento. Só ligue com a equipe da Hal-AI de acordo.',
    justificativa: 'Justificativa (10 caracteres ou mais)',
    senha: 'Sua senha',
    gravar: 'Gravar a configuração',
    gravado: 'Configuração gravada: {rotulo}.',
  },
} as const;

export type MensagensFachada = typeof mensagensFachada;
