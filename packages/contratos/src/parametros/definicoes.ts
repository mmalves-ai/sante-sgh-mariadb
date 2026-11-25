// Parâmetros do sistema NOVO (M08, regra 8; cap-09 §9.5; mina parte-b-f0b M06: herança em seis níveis e
// "explicar valor"). A definição é código versionado; no banco (SGH_CFG_PARAMETRO, por estabelecimento)
// ficam só os valores, com vigência, justificativa e autor. Vale o nível mais específico vigente: usuário,
// perfil, unidade, estabelecimento, empresa, rede e, por fim, o padrão do registro. Os parâmetros do
// sistema de origem (parâmetros gerais, da recepção e do prontuário) são só lidos (declarações em @sgh/legado, config/parametros); a edição
// no formato do legado é operação do M10.
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { HORA_FECHAMENTO_PADRAO, TIPOS_INTENSIVA_PADRAO } from '../internacao/leitos.js';
import { CODIGOS_INDICADOR, FORMATO_META_INDICADOR, NOME_INDICADOR } from '../relatorio/indicadores.js';
import { RELATORIOS_CATALOGO } from '../relatorio/catalogo.js';
import { PARAMETROS_REPASSE } from './repasse.js';
import { PARAMETROS_MANUTENCAO } from './manutencao.js';
import { PARAMETROS_PACS } from './pacs.js';
import { PARAMETROS_SADT_SETOR } from './sadt-setor.js';
import { PARAMETROS_PESSOAS } from './pessoas.js';
import { PARAMETROS_PORTAL } from './portal.js';
import { PARAMETROS_DOCUMENTO_ASSINATURA } from './documento-assinatura.js';
import {
  FORMULAS_PERDA_INSENSIVEL,
  PARAMETRO_BALANCO_FORMULA,
  PARAMETRO_BALANCO_HORA_CORTE,
} from '../enfermagem/balanco.js';
import { PARAMETRO_PORTARIA_RETENCAO, RETENCAO_PADRAO_DIAS } from '../internacao/portaria.js';
import { PARAMETROS_NUTRICAO } from './nutricao.js';
import { PARAMETROS_QUALIDADE } from './qualidade.js';
import { PARAMETROS_ESPECIALIDADES } from './especialidades.js';
import { PARAMETROS_ROUPARIA } from './rouparia.js';
import { PARAMETROS_CONTRATUALIZACAO } from './contratualizacao.js';
import { PARAMETROS_LICITACAO } from './licitacao.js';
import { PARAMETROS_COEX_REGISTRO } from './coexistencia-registro.js';
import { PARAMETROS_HORA_CONFIAVEL } from './hora-confiavel.js';
import { PARAMETROS_CRUD } from './crud.js';
import { PARAMETROS_PA_LEITOS } from './pa-leitos.js';
import {
  PARAMETRO_ANEXO_II_ENFERMEIRO,
  PARAMETRO_PROTOCOLOS_ENFERMEIRO,
} from '../enfermagem/prescricao-enfermeiro.js';
import { PARAMETRO_IMUNOBIOLOGICOS } from '../enfermagem/vacina.js';

/** Níveis, do mais específico ao mais amplo (ordem da resolução). */
export const NIVEIS_PARAMETRO = [
  'usuario',
  'perfil',
  'unidade',
  'estabelecimento',
  'empresa',
  'rede',
] as const;
export type NivelParametro = (typeof NIVEIS_PARAMETRO)[number];

export type TipoParametro = 'inteiro' | 'booleano' | 'texto' | 'lista';

export interface DefinicaoParametro {
  /** `<modulo>.<nome>` (camelCase). */
  readonly chave: string;
  readonly modulo: string;
  readonly descricao: string;
  readonly tipo: TipoParametro;
  readonly padrao: string;
  /** Níveis em que o valor pode ser definido (outro nível: 422). */
  readonly niveis: readonly NivelParametro[];
  /** Crítico: definir pede reautenticação (SBIS-07). */
  readonly critico: boolean;
  readonly minimo?: number;
  readonly maximo?: number;
  readonly opcoes?: readonly string[];
  /**
   * Texto: formato aceito (expressão regular, sem diferenciar maiúsculas) e a mensagem da recusa. Valor fora do
   * formato é recusado na definição (422), em vez de virar outra coisa em silêncio no cálculo.
   */
  readonly formato?: { readonly expressao: string; readonly mensagem: string };
  /** Área dona do parâmetro (quem aprova a mudança). */
  readonly dono: string;
  /** Pendência ou padrão de mercado que o originou (POL-1). */
  readonly origem: string;
}

/**
 * Registro dos parâmetros do sistema novo. Os primeiros saem dos padrões provisórios já em uso como
 * variáveis de ambiente (POL-1): o M10 liga cada consumidor ao resolvedor; até lá, a variável vale como o
 * padrão do registro.
 */
/** Lista de e-mails separados por vírgula (vazio permitido: o papel cai na auditoria do cliente). */
const FORMATO_LISTA_EMAIL =
  '^([^\\s@,;]+@[^\\s@,;]+\\.[^\\s@,;]{2,}(\\s*,\\s*[^\\s@,;]+@[^\\s@,;]+\\.[^\\s@,;]{2,})*)?$';

/** Destinatários dos alertas por e-mail, por papel (lidos pelo worker em parametro_valor, nível rede, vigente). */
const PARAMETROS_ALERTA_EMAIL: readonly DefinicaoParametro[] = [
  {
    chave: 'alerta.email.auditoria',
    modulo: 'alerta',
    descricao:
      'E-mails do papel auditoria (quebra de vidro, sessão em nome de outro, leitura do prontuário e o papel sem endereço próprio) que recebem os alertas do sistema (separados por vírgula)',
    tipo: 'texto',
    padrao: '',
    niveis: ['rede'],
    critico: true,
    formato: { expressao: FORMATO_LISTA_EMAIL, mensagem: 'Informe e-mails válidos separados por vírgula.' },
    dono: 'auditoria',
    origem: 'F2.2 lote 05-15: o destinatário dos alertas é configuração do cliente, não variável do servidor',
  },
  {
    chave: 'alerta.email.encarregado',
    modulo: 'alerta',
    descricao:
      'E-mails do papel encarregado de dados (LGPD) que recebem os alertas do sistema (separados por vírgula)',
    tipo: 'texto',
    padrao: '',
    niveis: ['rede'],
    critico: true,
    formato: { expressao: FORMATO_LISTA_EMAIL, mensagem: 'Informe e-mails válidos separados por vírgula.' },
    dono: 'encarregado de dados',
    origem: 'F2.2 lote 05-15: o destinatário dos alertas é configuração do cliente, não variável do servidor',
  },
  {
    chave: 'alerta.email.plantao',
    modulo: 'alerta',
    descricao:
      'E-mails do papel plantão técnico (chamados graves) que recebem os alertas do sistema (separados por vírgula)',
    tipo: 'texto',
    padrao: '',
    niveis: ['rede'],
    critico: true,
    formato: { expressao: FORMATO_LISTA_EMAIL, mensagem: 'Informe e-mails válidos separados por vírgula.' },
    dono: 'TI',
    origem: 'F2.2 lote 05-15: o destinatário dos alertas é configuração do cliente, não variável do servidor',
  },
  {
    chave: 'alerta.email.ti',
    modulo: 'alerta',
    descricao:
      'E-mails do papel TI do hospital (avisos técnicos) que recebem os alertas do sistema (separados por vírgula)',
    tipo: 'texto',
    padrao: '',
    niveis: ['rede'],
    critico: true,
    formato: { expressao: FORMATO_LISTA_EMAIL, mensagem: 'Informe e-mails válidos separados por vírgula.' },
    dono: 'TI',
    origem: 'F2.2 lote 05-15: o destinatário dos alertas é configuração do cliente, não variável do servidor',
  },
  {
    chave: 'alerta.email.responsavelTecnico',
    modulo: 'alerta',
    descricao:
      'E-mails do papel responsável técnico que recebem os alertas do sistema (separados por vírgula)',
    tipo: 'texto',
    padrao: '',
    niveis: ['rede'],
    critico: true,
    formato: { expressao: FORMATO_LISTA_EMAIL, mensagem: 'Informe e-mails válidos separados por vírgula.' },
    dono: 'direção técnica',
    origem: 'F2.2 lote 05-15: o destinatário dos alertas é configuração do cliente, não variável do servidor',
  },
];

export const PARAMETROS_NOVOS: readonly DefinicaoParametro[] = [
  {
    chave: 'acesso.bloqueioInatividadeSegundos',
    modulo: 'acesso',
    descricao: 'Bloqueio da sessão por inatividade, em segundos (0 = desligado)',
    tipo: 'inteiro',
    padrao: '900',
    niveis: ['perfil', 'unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 3600,
    dono: 'segurança da informação',
    origem: 'POL-1: SESSAO_BLOQUEIO_SEGUNDOS (M07)',
  },
  {
    chave: 'acesso.emergenciaMinutos',
    modulo: 'acesso',
    descricao: 'Prazo do acesso de emergência (quebra de vidro), em minutos',
    tipo: 'inteiro',
    padrao: '60',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 5,
    maximo: 720,
    dono: 'diretoria clínica e DPO',
    origem: 'POL-1: ACESSO_EMERGENCIA_MINUTOS (M06)',
  },
  // ADR 0021: suporte técnico e "login como".
  {
    chave: 'suporte.sessaoMinutos',
    modulo: 'suporte',
    descricao: 'Prazo absoluto da sessão "como" do suporte técnico, em minutos (renovar = abrir outra)',
    tipo: 'inteiro',
    padrao: '60',
    niveis: ['rede'],
    critico: true,
    minimo: 5,
    maximo: 480,
    dono: 'dono do projeto e segurança da informação',
    origem: 'R5 (20/10/2026): SUPORTE_SESSAO_MINUTOS',
  },
  {
    chave: 'suporte.avisoAuditor',
    modulo: 'suporte',
    descricao: 'Avisar o Auditor da rede (fila de e-mail) quando o suporte técnico abre uma sessão "como"',
    tipo: 'booleano',
    padrao: 'sim',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'DPO e auditoria',
    origem: 'R2 (20/10/2026): SUPORTE_AVISO_AUDITOR (padrão ligado)',
  },
  {
    chave: 'cadastro.itensPorPagina',
    modulo: 'cadastro',
    descricao: 'Itens por página nas listas dos domínios (CRUD genérico)',
    tipo: 'inteiro',
    padrao: '25',
    niveis: ['usuario', 'perfil', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 10,
    maximo: 100,
    dono: 'administração do sistema',
    origem: 'padrão de mercado (M08)',
  },
  {
    chave: 'cadastro.exportacaoFormato',
    modulo: 'cadastro',
    descricao: 'Formato da exportação das listas dos domínios',
    tipo: 'lista',
    padrao: 'csv',
    opcoes: ['csv'],
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'administração do sistema',
    origem: 'padrão de mercado (M08)',
  },
  // M15 (regra 12): limites dos alertas ao Auditor sobre as leituras do prontuário (POL-1: padrão de mercado,
  // confirmado com o Auditor e a comissão de prontuário na validação).
  {
    chave: 'pep.alertaJanelaMinutos',
    modulo: 'pep',
    descricao:
      'Janela, em minutos, da contagem de prontuários diferentes abertos por um usuário (alerta ao Auditor)',
    tipo: 'inteiro',
    padrao: '60',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 5,
    maximo: 1440,
    dono: 'auditoria',
    origem: 'regra 12 do M15 (padrão de mercado)',
  },
  {
    chave: 'pep.alertaMaxPacientes',
    modulo: 'pep',
    descricao: 'Mais prontuários diferentes que isto na janela gera alerta ao Auditor',
    tipo: 'inteiro',
    padrao: '30',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 2,
    maximo: 1000,
    dono: 'auditoria',
    origem: 'regra 12 do M15 (padrão de mercado)',
  },
  {
    chave: 'pep.horarioHabitualInicio',
    modulo: 'pep',
    descricao:
      'Início do horário habitual de acesso ao prontuário (hora local; fora dele, alerta ao Auditor)',
    tipo: 'inteiro',
    padrao: '6',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 23,
    dono: 'auditoria',
    origem: 'regra 12 do M15 (padrão de mercado)',
  },
  {
    chave: 'pep.horarioHabitualFim',
    modulo: 'pep',
    descricao: 'Fim do horário habitual de acesso ao prontuário (hora local, exclusiva)',
    tipo: 'inteiro',
    padrao: '22',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 24,
    dono: 'auditoria',
    origem: 'regra 12 do M15 (padrão de mercado)',
  },
  // M22 (ficha, seções 5 e 12): horário clínico retroativo e modelos liberados para registro (POL-1).
  {
    chave: 'pep.evolucao.toleranciaRetroativoMinutos',
    modulo: 'pep',
    descricao:
      'Minutos entre o horário clínico e a gravação aceitos sem justificativa (acima disso, o registro retroativo pede justificativa)',
    tipo: 'inteiro',
    padrao: '15',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 1440,
    dono: 'comissão de prontuário',
    origem:
      'regra 10 do M22: perfil de 2026-06 a 2026-07 (97% dos registros sem justificativa gravados até 15 minutos depois do horário clínico)',
  },
  {
    chave: 'pep.evolucao.modelosLiberados',
    modulo: 'pep',
    descricao:
      'Modelos de formulário liberados para registro (códigos separados por vírgula; os demais ficam só em consulta)',
    tipo: 'texto',
    // Corretor do M22: só os do escopo mínimo com a conferência cruzada na meta e sem componente de alergia; os
    // demais ficam fora da liberação com o motivo (MODELOS_FORA_DA_LIBERACAO, contratos/pep/registro-clinico.ts).
    padrao: 'EVAM,M9,M10',
    niveis: ['usuario', 'unidade', 'estabelecimento', 'rede'],
    critico: true,
    dono: 'comissão de prontuário e responsável técnico',
    origem:
      'ficha do M22, seções 11 e 12: liberação modelo a modelo; dos 10 de maior uso, os 3 com a conferência cruzada na meta de 99,5% e sem componente de alergia (docs/marcos/M22/conferencia-pc.md); a funcionalidade inteira depende da chave pep.evolucao.registro',
  },
  // M24 (ficha, seções 6 e 8): políticas só do novo para a prescrição (POL-1: padrão de mercado como parâmetro;
  // os parâmetros da prescrição do legado continuam só lidos).
  {
    chave: 'pep.prescricao.duplicidadeCriterio',
    modulo: 'pep',
    descricao:
      'Critério do alerta de duplicidade quando o cadastro do legado não diz: por medicamento, por princípio ativo ou pelos dois',
    tipo: 'lista',
    padrao: 'ambos',
    opcoes: ['medicamento', 'principio-ativo', 'ambos'],
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: true,
    dono: 'comissão de farmácia e terapêutica',
    origem:
      'regra 4 do M24: o cadastro de validação de duplicidade do legado tem os dois critérios ativos (medicamento e princípio ativo); padrão igual',
  },
  {
    chave: 'pep.prescricao.altaVigilancia',
    modulo: 'pep',
    descricao:
      'Itens de alta vigilância além dos marcados no cadastro do item (códigos de produto separados por vírgula; lista ISMP do hospital)',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'comissão de farmácia e terapêutica',
    origem:
      'regra 7 do M24: o cadastro do item marca o potencialmente perigoso; a lista do hospital complementa (validação humana, ficha seção 13)',
  },
  {
    chave: 'pep.prescricao.duplaChecagem',
    modulo: 'pep',
    descricao: 'Item de alta vigilância exige dupla checagem na administração (marca para a beira do leito)',
    tipo: 'booleano',
    padrao: 'true',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    dono: 'gerência de enfermagem',
    origem: 'regra 7 do M24 e ficha do M25 (dupla checagem): padrão de mercado ligado',
  },
  {
    chave: 'pep.prescricao.dispensarAposValidar',
    modulo: 'pep',
    descricao: 'A farmácia só dispensa depois da validação farmacêutica (política do novo; a fila é do M29)',
    tipo: 'booleano',
    padrao: 'false',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: true,
    dono: 'farmácia clínica',
    origem:
      'ficha do M24, seção 6 (políticas só do novo) e DP-25; desligado até o M29 (o parâmetro do legado não é ligado pelo novo)',
  },
  {
    chave: 'pep.prescricao.baseInteracoes',
    modulo: 'pep',
    descricao:
      'Base de interações e faixas de dose de terceiros contratada (sem ela, o alerta de interação fica desligado com aviso)',
    tipo: 'booleano',
    padrao: 'false',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'farmácia clínica',
    origem: 'regra 8 do M24 e DP-24: o legado tem os domínios e nenhum par; nenhum alerta é inventado',
  },
  {
    chave: 'pep.prescricao.toleranciaRetroativoMinutos',
    modulo: 'pep',
    descricao: 'Minutos entre o horário da prescrição e a gravação aceitos sem justificativa de retroativo',
    tipo: 'inteiro',
    padrao: '15',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 1440,
    dono: 'comissão de prontuário',
    origem:
      'perfil de 2025-10 a 2026-07: 1 de 20.289 prescrições com lançamento retroativo; a gravação sai em até 15 minutos do horário em 98% (mesmo padrão do registro clínico)',
  },
  // M16 (ficha, seção 5): hora de fechamento do censo, tipos de terapia intensiva e as metas dos indicadores
  // (diretoria e qualidade definem na validação; sem meta, o indicador mostra "sem meta").
  {
    chave: 'internacao.censo.horaFechamento',
    modulo: 'internacao',
    descricao:
      'Hora de fechamento do censo diário, a mesma para todas as unidades (1 a 24; 24 = meia-noite, fim do dia)',
    tipo: 'inteiro',
    padrao: String(HORA_FECHAMENTO_PADRAO),
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 1,
    maximo: 24,
    dono: 'coordenação de leitos',
    origem:
      'ficha do M16, regra 7 (Portaria SAS 312/2002: hora única de fechamento); definida pela coordenação de leitos na validação',
  },
  {
    chave: 'internacao.acomodacao.intensiva',
    modulo: 'internacao',
    descricao:
      'Tipos de acomodação de terapia intensiva (códigos separados por vírgula; a ocupação de terapia intensiva conta pelo tipo do trecho)',
    tipo: 'texto',
    padrao: TIPOS_INTENSIVA_PADRAO.join(','),
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'coordenação de leitos',
    origem: 'ficha do M16, regra 4 (tipos 3, 7, 8, 9 e 17)',
  },
  ...CODIGOS_INDICADOR.map((codigo): DefinicaoParametro => ({
    chave: `relatorio.meta.${codigo}`,
    modulo: 'relatorio',
    descricao: `Meta do indicador ${NOME_INDICADOR[codigo]} (um número, como 85 ou 85,5, na unidade do indicador; "sem meta" quando não houver)`,
    tipo: 'texto',
    padrao: 'sem meta',
    formato: {
      expressao: FORMATO_META_INDICADOR,
      mensagem: 'Informe só o número da meta (por exemplo, 85 ou 85,5, sem o símbolo %) ou "sem meta".',
    },
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'diretoria e qualidade',
    origem: 'ficha do M16, regra 11 (ficha técnica com meta e polaridade)',
  })),
  // M17 (ficha, seção 6): parâmetros só do novo da agenda de consultas (POL-1: padrão de mercado; ajustar com a
  // resposta do call center sobre limite de encaixe e antecedência).
  {
    chave: 'agenda.encaixesPorTurno',
    modulo: 'agenda',
    descricao: 'Encaixes por turno (manhã, tarde) em cada agenda; 0 = sem limite',
    tipo: 'inteiro',
    padrao: '0',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 50,
    dono: 'coordenação da agenda',
    origem: 'ficha do M17, seção 6 (limite de encaixe por turno, regra do novo)',
  },
  {
    chave: 'agenda.antecedenciaMinimaMinutos',
    modulo: 'agenda',
    descricao: 'Antecedência mínima para marcar, em minutos (0 = a partir do minuto seguinte)',
    tipo: 'inteiro',
    padrao: '0',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 10080,
    dono: 'coordenação da agenda',
    origem: 'ficha do M17, seção 6 (antecedência, regra do novo; o legado só recusa o horário que já passou)',
  },
  {
    chave: 'agenda.toleranciaFaltaMinutos',
    modulo: 'agenda',
    descricao: 'Minutos depois do horário marcado para a marcação sem chegada virar candidata a falta',
    tipo: 'inteiro',
    padrao: '30',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 720,
    dono: 'coordenação da agenda',
    origem: 'ficha do M17, `agenda.registrarFalta` (fechamento do dia, POL-1)',
  },
  {
    chave: 'pep.sumarioAlta.exigidoNaAlta',
    modulo: 'pep',
    descricao:
      'Tipos de atendimento em que a alta médica dada neste sistema exige o sumário de alta finalizado (internacao, externo; separados por vírgula)',
    tipo: 'texto',
    // Regra 13 do M23: a alta médica do novo (M21) consulta este parâmetro pelo tipo do atendimento
    // (altaExigeSumario, @sgh/dominio-pep); a alta dada no outro sistema segue as regras dele.
    padrao: 'internacao',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: true,
    dono: 'comissão de prontuário e diretoria clínica',
    origem:
      'ficha do M23, regra 13 (CIT 33/2017; Portaria GM/MS 8.026/2025): sumário montado do episódio; a internação é o padrão de mercado (POL-1)',
  },
  // M19 (ficha, seções 4 e 8): parâmetros só do novo da recepção (POL-1: padrão de mercado; ajustar com o supervisor
  // da recepção no turno simulado).
  {
    chave: 'recepcao.tempoAlvoEsperaMinutos',
    modulo: 'recepcao',
    descricao:
      'Tempo-alvo de espera da emissão à chamada, em minutos, quando a fila não tem o seu (0 = sem meta)',
    tipo: 'inteiro',
    padrao: '20',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 600,
    dono: 'supervisão da recepção',
    origem: 'ficha do M19, seção 4 (painel do supervisor: senhas esperando há mais tempo)',
  },
  {
    chave: 'recepcao.painelMostraIniciais',
    modulo: 'recepcao',
    descricao:
      'O painel de chamada em área comum mostra as iniciais do paciente junto da senha (nunca o nome)',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'encarregado de dados (DPO)',
    origem: 'ficha do M19, regra 6 (LGPD: iniciais no máximo)',
  },
  // W1-04 (mercado): termo de consentimento exigido ausente dá bloqueio suave no balcão (aviso com confirmação). Fica
  // desligado até o dono aprovar os textos jurídicos dos termos por tipo de atendimento; o cadastro e a assinatura
  // funcionam com ele desligado.
  {
    chave: 'recepcao.termos.exigir',
    modulo: 'recepcao',
    descricao:
      'Avisar no balcão quando faltar termo de consentimento exigido no tipo de atendimento (bloqueio suave)',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'encarregado de dados (DPO), com o jurídico',
    origem: 'programa CRUD completo, W1-04 (termos de consentimento e LGPD no balcão)',
  },
  // M18 (ficha, regra 5): intervalo mínimo de preparo da sala entre duas cirurgias, somado ao intervalo do próprio
  // agendamento na recusa de sobreposição. Padrão 0: o legado agenda encostado (INTERVALO 0 em 830 de 830 desde
  // 10/2025); a coordenação do bloco ajusta por estabelecimento (POL-1).
  {
    chave: 'cirurgia.intervaloPreparoMinutos',
    modulo: 'cirurgia',
    descricao: 'Intervalo mínimo de preparo da sala entre duas cirurgias, em minutos (0 = encostado)',
    tipo: 'inteiro',
    padrao: '0',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 240,
    dono: 'coordenação do centro cirúrgico',
    origem: 'ficha do M18, regra 5 (sala travada e mapa relido com intervalo de preparo)',
  },
  // M20 (ficha, seções 4 e 8): parâmetros só do novo do atendimento externo (POL-1: padrão de mercado; ajustar com a
  // coordenação do PA no turno simulado).
  {
    chave: 'atendimento.paAlvoPortaMedicoMinutos',
    modulo: 'atendimento',
    descricao: 'Tempo-alvo da chegada ao primeiro atendimento médico no pronto atendimento, em minutos',
    tipo: 'inteiro',
    padrao: '60',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 5,
    maximo: 600,
    dono: 'coordenação do pronto atendimento',
    origem: 'ficha do M20, seção 4 (indicadores porta → médico)',
  },
  {
    chave: 'atendimento.observacaoAvisoHoras',
    modulo: 'atendimento',
    descricao:
      'Horas de observação a partir das quais o quadro avisa (o limite é 24 horas, Portaria SAS 312/2002)',
    tipo: 'inteiro',
    padrao: '20',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 23,
    dono: 'coordenação do pronto atendimento',
    origem: 'ficha do M20, regra 7',
  },
  {
    chave: 'atendimento.pulseiraTamanho',
    modulo: 'atendimento',
    descricao: 'Pulseira de identificação: adulto (25 mm x 279 mm) ou infantil (19 mm x 178 mm) por padrão',
    tipo: 'lista',
    padrao: 'adulto',
    opcoes: ['adulto', 'infantil'],
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    dono: 'coordenação de enfermagem',
    origem: 'ficha do M20, regra 10 (dois identificadores e código de barras)',
  }, // M26 (ficha, seções 8 e 12): parâmetros só do novo do SADT (POL-1: padrão de mercado; a lista de valores críticos
  // e o prazo são do laboratório e da diretoria clínica, na tela própria; aqui, o escalonamento e o portal).
  {
    chave: 'sadt.criticoEscalonarMinutos',
    modulo: 'sadt',
    descricao:
      'Minutos sem ciência do valor crítico até subir do responsável ao plantonista (e o mesmo prazo de novo até o supervisor), quando a faixa do elemento não define o prazo',
    tipo: 'inteiro',
    padrao: '30',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 5,
    maximo: 240,
    dono: 'diretoria clínica',
    origem: 'ficha do M26, regra 7 (sem ciência no prazo, sobe ao plantonista ou supervisor)',
  },
  {
    chave: 'sadt.repeticaoMinimaHoras',
    modulo: 'sadt',
    descricao:
      'Intervalo mínimo em horas entre dois pedidos do mesmo exame para o mesmo paciente (o repetido antes pede confirmação)',
    tipo: 'inteiro',
    padrao: '24',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 720,
    dono: 'laboratório',
    origem: 'ficha do M26, regra 6 (exame repetido no intervalo mínimo)',
  },
  {
    chave: 'sadt.portalTentativas',
    modulo: 'sadt',
    descricao: 'Tentativas erradas de acesso ao portal de resultados antes do bloqueio temporário',
    tipo: 'inteiro',
    padrao: '5',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 3,
    maximo: 10,
    dono: 'encarregado de dados (DPO)',
    origem: 'ficha do M26, regra 9 (limite de tentativas e de taxa)',
  },
  {
    chave: 'sadt.portalBloqueioMinutos',
    modulo: 'sadt',
    descricao: 'Minutos de bloqueio do acesso ao portal depois de esgotar as tentativas',
    tipo: 'inteiro',
    padrao: '15',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 5,
    maximo: 1440,
    dono: 'encarregado de dados (DPO)',
    origem: 'ficha do M26, regra 9',
  },
  {
    chave: 'sadt.portalSessaoMinutos',
    modulo: 'sadt',
    descricao: 'Minutos de validade da sessão do portal de resultados (a sessão sai sozinha)',
    tipo: 'inteiro',
    padrao: '20',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 5,
    maximo: 120,
    dono: 'encarregado de dados (DPO)',
    origem: 'ficha do M26, regra 9',
  },
  {
    chave: 'sadt.validadeOrcamentoDias',
    modulo: 'sadt',
    descricao: 'Validade padrão do orçamento particular de exames, em dias',
    tipo: 'inteiro',
    padrao: '30',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 180,
    dono: 'recepção do diagnóstico',
    origem: 'ficha do M26, regra 13',
  },
  // M25: enfermagem beira-leito (ficha, seção 6). Só do novo: o banco do estabelecimento tem a tolerância (lida) e o
  // lote e validade obrigatórios por tipo (nunca ligados pelo novo); aqui valem os do novo, por unidade.
  {
    chave: 'enfermagem.toleranciaMinutos',
    modulo: 'enfermagem',
    descricao:
      'Tolerância da dose, em minutos, antes e depois do horário previsto (fora dela a dose fica atrasada; regra 3)',
    tipo: 'inteiro',
    padrao: '60',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 5,
    maximo: 240,
    dono: 'gerência de enfermagem',
    origem: 'ficha do M25, regra 3: padrão do parâmetro de tolerância do estabelecimento (01:00, lido)',
  },
  {
    chave: 'enfermagem.toleranciaTempoCriticoMinutos',
    modulo: 'enfermagem',
    descricao:
      'Tolerância, em minutos, das doses de tempo crítico (alta vigilância e antimicrobianos): a classe com tolerância menor',
    tipo: 'inteiro',
    padrao: '30',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 5,
    maximo: 240,
    dono: 'gerência de enfermagem',
    origem:
      'ficha do M25, regra 3 (tolerância por classe): padrão de mercado (ISMP, medicamento de tempo crítico)',
  },
  {
    chave: 'enfermagem.pulseiraObrigatoria',
    modulo: 'enfermagem',
    descricao: 'Checar exige a leitura da pulseira (sem ler, o motivo é obrigatório e vai para o indicador)',
    tipo: 'booleano',
    padrao: 'sim',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    dono: 'gerência de enfermagem',
    origem: 'ficha do M25, regra 5 e seção 6 (meta 1 de segurança do paciente)',
  },
  {
    chave: 'enfermagem.doseObrigatoria',
    modulo: 'enfermagem',
    descricao:
      'Checar exige a leitura do código da dose (nasce desligada: depende da etiqueta de dose da farmácia)',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    dono: 'gerência de enfermagem e farmácia',
    origem: 'ficha do M25, seção 6 e DP-26 (leitura obrigatória da dose nasce desligada)',
  },
  {
    chave: 'enfermagem.loteValidadeObrigatorio',
    modulo: 'enfermagem',
    descricao: 'Tipos de item cuja checagem exige o lote e a validade (medicamento, solução, hemocomponente)',
    tipo: 'texto',
    padrao: 'hemocomponente',
    formato: {
      expressao: '^((medicamento|solucao|hemocomponente)(,(medicamento|solucao|hemocomponente))*)?$',
      mensagem: 'Use medicamento, solucao e hemocomponente, separados por vírgula (ou vazio).',
    },
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    dono: 'gerência de enfermagem e farmácia',
    origem: 'ficha do M25, seção 6: regra só do novo (a do banco do estabelecimento é lida, nunca ligada)',
  },
  {
    chave: 'enfermagem.alterarVelocidadeInfusao',
    modulo: 'enfermagem',
    descricao:
      'A enfermagem da unidade pode mudar a velocidade da infusão contínua (só nos itens que a prescrição permite)',
    tipo: 'booleano',
    padrao: 'sim',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    dono: 'gerência de enfermagem',
    origem: 'ficha do M25, regra 11 (mudar velocidade só se a unidade e o item permitem)',
  },
  {
    chave: 'enfermagem.cacheTabletHoras',
    modulo: 'enfermagem',
    descricao:
      'Prazo, em horas, do que o tablet guarda cifrado para trabalhar sem rede (apagado no logout ou no prazo)',
    tipo: 'inteiro',
    padrao: '12',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 24,
    dono: 'segurança da informação e gerência de enfermagem',
    origem: 'ficha do M25, seção 6 e cap-09 §9.7 (PWA e offline restrito)',
  },
  {
    chave: 'enfermagem.inicioTurnoDiurno',
    modulo: 'enfermagem',
    descricao: 'Início do turno diurno de 12 horas da enfermagem (HH:MM; o noturno começa 12 horas depois)',
    tipo: 'texto',
    padrao: '07:00',
    formato: { expressao: '^([01][0-9]|2[0-3]):[0-5][0-9]$', mensagem: 'Hora no formato HH:MM.' },
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    dono: 'gerência de enfermagem',
    origem: 'padrão de mercado (plantão de 12 horas), conferido com a enfermagem na validação (M25)',
  },
  {
    chave: 'enfermagem.intervaloSinaisHoras',
    modulo: 'enfermagem',
    descricao:
      'Intervalo, em horas, dos sinais vitais de rotina (sem registro além dele, o sinal fica devido)',
    tipo: 'inteiro',
    padrao: '6',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 24,
    dono: 'gerência de enfermagem',
    origem: 'padrão de mercado (rotina de 6 em 6 horas), conferido com a enfermagem na validação (M25)',
  },
  // M45 (etapa 2; regras 1 e 4): a reavaliação de Braden e Morse e o aviso do NEWS2 na central de avisos.
  {
    chave: 'enfermagem.reavaliacao.intervaloHoras',
    modulo: 'enfermagem',
    descricao:
      'Intervalo, em horas, da reavaliação de Braden e Morse (a diária vence depois dele; a da admissão, no mesmo prazo contado da internação)',
    tipo: 'inteiro',
    padrao: '24',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 4,
    maximo: 72,
    dono: 'gerência de enfermagem',
    origem: 'ficha do M45, regra 4 (admissão, diária e mudança de quadro); padrão de mercado de 24 horas',
  },
  {
    chave: 'enfermagem.news2.loginsMedico',
    modulo: 'enfermagem',
    descricao:
      'Usuários que recebem na central de avisos o NEWS2 de 5 a 6, ou 3 num parâmetro isolado (médico plantonista da unidade; separados por vírgula). Vazio: o aviso fica só na tela da enfermagem',
    tipo: 'texto',
    padrao: '',
    niveis: ['unidade', 'estabelecimento'],
    critico: false,
    dono: 'coordenação médica da unidade',
    origem: 'ficha do M45, regra 1 (avisa o médico)',
  },
  {
    chave: 'enfermagem.news2.loginsTrr',
    modulo: 'enfermagem',
    descricao:
      'Usuários do Time de Resposta Rápida que recebem na central de avisos o NEWS2 de 7 ou mais (separados por vírgula). Vazio: o aviso fica só na tela da enfermagem',
    tipo: 'texto',
    padrao: '',
    niveis: ['unidade', 'estabelecimento'],
    critico: false,
    dono: 'coordenação do Time de Resposta Rápida',
    origem: 'ficha do M45, regra 1 (aciona o Time de Resposta Rápida)',
  },
  // W0-03, mercado M1: a escala de risco de TEV de cada perfil (os dois cálculos existem; a escolha institucional é aqui).
  {
    chave: 'enfermagem.tev.escalaClinico',
    modulo: 'enfermagem',
    descricao:
      'Escala de risco de tromboembolismo venoso do paciente clínico (o escore em risco gera a pendência de profilaxia ao prescritor)',
    tipo: 'lista',
    padrao: 'padua',
    opcoes: ['padua', 'caprini'],
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    dono: 'comissão de TEV ou coordenação médica',
    origem:
      'padrão de mercado (Padua no clínico; Barbar et al., 2010), escolha institucional do dono (plano W0-03)',
  },
  {
    chave: 'enfermagem.tev.escalaCirurgico',
    modulo: 'enfermagem',
    descricao:
      'Escala de risco de tromboembolismo venoso do paciente cirúrgico (o escore em risco gera a pendência de profilaxia ao prescritor)',
    tipo: 'lista',
    padrao: 'caprini',
    opcoes: ['caprini', 'padua'],
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    dono: 'comissão de TEV ou coordenação médica',
    origem:
      'padrão de mercado (Caprini no cirúrgico; Gould et al., ACCP 2012), escolha institucional do dono (plano W0-03)',
  },
  // W0-03, mercado M5: a contenção mecânica (COFEN 427/2012): o prazo máximo da ordem (depois dele, renovação com nova
  // avaliação), o intervalo padrão da checagem periódica e a tolerância para a checagem contar como no prazo.
  {
    chave: 'enfermagem.contencao.prazoMaximoHoras',
    modulo: 'enfermagem',
    descricao:
      'Prazo máximo, em horas, da ordem de contenção mecânica (vencida, gera o alerta; a continuidade é uma renovação com nova avaliação)',
    tipo: 'inteiro',
    padrao: '24',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 24,
    dono: 'gerência de enfermagem e diretoria técnica',
    origem:
      'Resolução COFEN 427/2012 (monitoramento e registro); padrão de mercado de 24 horas (plano W0-03, M5)',
  },
  {
    chave: 'enfermagem.contencao.intervaloMinutos',
    modulo: 'enfermagem',
    descricao:
      'Intervalo padrão, em minutos, da checagem periódica do paciente contido (perfusão, pele, posição e necessidades)',
    tipo: 'inteiro',
    padrao: '60',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 15,
    maximo: 120,
    dono: 'gerência de enfermagem',
    origem:
      'Resolução COFEN 427/2012 (monitoramento clínico do contido); padrão de mercado de 1 hora (plano W0-03, M5)',
  },
  {
    chave: 'enfermagem.contencao.toleranciaMinutos',
    modulo: 'enfermagem',
    descricao:
      'Tolerância, em minutos, para a checagem da contenção contar como feita no prazo (depois dela, o horário aparece atrasado)',
    tipo: 'inteiro',
    padrao: '15',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 60,
    dono: 'gerência de enfermagem',
    origem: 'plano W0-03, M5 (indicador de checagens no prazo)',
  },
  // W0-03, mercado M3: o limiar do NEWS2 que sugere o protocolo de sepse no internado.
  {
    chave: 'enfermagem.protocolos.limiarNews2',
    modulo: 'enfermagem',
    descricao:
      'NEWS2 a partir do qual o relógio do internado sugere o protocolo de sepse (o alerta vira a inclusão, com a hora dele como tempo zero)',
    tipo: 'inteiro',
    padrao: '5',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 3,
    maximo: 12,
    dono: 'comissão de controle de infecção hospitalar e diretoria clínica',
    origem:
      'Royal College of Physicians, NEWS2 (2017): 5 ou mais pede resposta urgente; RDC 36/2013 (protocolos de segurança); plano W0-03, M3',
  },
  // W0-03, mercado M2: o TRR e a PCR — as unidades que são UTI (a PCR delas fica fora do indicador "fora da UTI") e a
  // meta da chegada do time.
  {
    chave: 'enfermagem.trr.unidadesUti',
    modulo: 'enfermagem',
    descricao:
      'Códigos das unidades de terapia intensiva, separados por vírgula (a parada nelas não entra no indicador de PCR fora da UTI)',
    tipo: 'texto',
    padrao: 'UTI',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'coordenação do Time de Resposta Rápida',
    origem: 'plano W0-03, M2 (PCR por 1.000 pacientes-dia fora da UTI)',
  },
  {
    chave: 'enfermagem.trr.metaRespostaMinutos',
    modulo: 'enfermagem',
    descricao:
      'Meta, em minutos, da chegada do Time de Resposta Rápida depois do acionamento (indicador de tempo de resposta)',
    tipo: 'inteiro',
    padrao: '5',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 30,
    dono: 'coordenação do Time de Resposta Rápida',
    origem: 'plano W0-03, M2 (tempo de resposta com numerador e denominador); padrão de mercado de 5 minutos',
  },
  // M40 (regra 6): o relatório de contingência por posto, gerado a cada hora nos postos listados.
  {
    chave: 'enfermagem.contingenciaPostos',
    modulo: 'enfermagem',
    descricao:
      'Unidades de internação (postos), separadas por vírgula, com o relatório de contingência gerado a cada hora; vazio, só sob pedido na tela',
    tipo: 'texto',
    padrao: '',
    formato: {
      expressao: '^$|^[A-Za-z0-9._-]{1,5}(,[A-Za-z0-9._-]{1,5})*$',
      mensagem: 'Códigos das unidades separados por vírgula (ex.: UTI,CTI).',
    },
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'gerência de enfermagem e TI',
    origem: 'ficha do M40, regra 6 (relatório de contingência por posto, PDF por hora; cap-14 §14.8.1)',
  },
  {
    chave: 'enfermagem.contingenciaHoras',
    modulo: 'enfermagem',
    descricao: 'Horizonte, em horas, dos horários aprazados no relatório de contingência do posto',
    tipo: 'inteiro',
    padrao: '6',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 2,
    maximo: 12,
    dono: 'gerência de enfermagem',
    origem:
      'ficha do M40, regra 6 (as próximas horas do posto; padrão de mercado de 6 horas, conferido na validação)',
  },
  // M45 (etapa 3; regra 6): o balanço hídrico fecha às 7 h por padrão, configurável por unidade; a fórmula das perdas
  // insensíveis é versionada (o fechamento grava a versão usada).
  {
    chave: PARAMETRO_BALANCO_HORA_CORTE,
    modulo: 'enfermagem',
    descricao:
      'Hora de corte do balanço hídrico de 24 horas (HH:MM): a janela vai da hora de corte de um dia à do dia seguinte',
    tipo: 'texto',
    padrao: '07:00',
    formato: { expressao: '^([01][0-9]|2[0-3]):[0-5][0-9]$', mensagem: 'Hora no formato HH:MM.' },
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    dono: 'gerência de enfermagem',
    origem: 'ficha do M45, regra 6 (fechamento padrão às 7 h, configurável por unidade)',
  },
  {
    chave: PARAMETRO_BALANCO_FORMULA,
    modulo: 'enfermagem',
    descricao:
      'Versão da fórmula das perdas insensíveis do balanço hídrico (PI-2026.1: 0,5 mL/kg/h, mais 10% por grau acima de 37 °C); "nenhuma" não estima',
    tipo: 'lista',
    padrao: 'PI-2026.1',
    opcoes: FORMULAS_PERDA_INSENSIVEL,
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    dono: 'gerência de enfermagem e coordenação da UTI',
    origem:
      'ficha do M45, regra 6 (perdas insensíveis por fórmula versionada; padrão de mercado, conferido na validação)',
  },
  // M50 (etapa 5; regra 9): o cadastro mínimo do visitante fica guardado até o prazo do encarregado de dados, contado da
  // última visita; vencido, é anonimizado (o registro da visita fica, sem o nome e o documento).
  {
    chave: PARAMETRO_PORTARIA_RETENCAO,
    modulo: 'hotelaria',
    descricao:
      'Prazo de retenção do cadastro do visitante, em dias depois da última visita (vencido, o nome, o documento, o telefone e a foto são apagados)',
    tipo: 'inteiro',
    padrao: String(RETENCAO_PADRAO_DIAS),
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 30,
    maximo: 1825,
    dono: 'encarregado de dados (DPO)',
    origem:
      'ficha do M50, regra 9 (cadastro mínimo com o prazo de retenção do DPO; padrão de mercado de 1 ano)',
  },
  // M45 (etapa 4; regras 17 e 18): os protocolos publicados e a lista do anexo II da prescrição de medicamento pelo
  // enfermeiro (Res. COFEN 801/2026; versionados pela vigência do parâmetro) e os imunobiológicos que o estabelecimento
  // aplica. Vazios por padrão: a funcionalidade fica com o pré-requisito pendente.
  {
    chave: PARAMETRO_PROTOCOLOS_ENFERMEIRO,
    modulo: 'enfermagem',
    descricao:
      'Protocolos institucionais ou de programa de saúde publicados para a prescrição de medicamento pelo enfermeiro: CODIGO/ANO:tipo:genérico,genérico (tipo institucional ou programa), separados por ponto e vírgula',
    tipo: 'texto',
    padrao: '',
    formato: {
      expressao:
        '^$|^[A-Za-z0-9._-]{1,20}/[0-9]{4}:(institucional|programa):[a-zà-ú0-9 ,.+()-]+(;[A-Za-z0-9._-]{1,20}/[0-9]{4}:(institucional|programa):[a-zà-ú0-9 ,.+()-]+)*$',
      mensagem: 'Use CODIGO/ANO:tipo:genérico,genérico; o tipo é institucional ou programa.',
    },
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'gerência de enfermagem e responsável técnico',
    origem:
      'ficha do M45, regra 17 (Res. COFEN 801/2026: só com protocolo institucional ou de programa de saúde)',
  },
  {
    chave: PARAMETRO_ANEXO_II_ENFERMEIRO,
    modulo: 'enfermagem',
    descricao:
      'Lista de medicamentos do anexo II da Res. COFEN 801/2026 que o enfermeiro pode prescrever: VERSAO=genérico,genérico (a versão vai gravada em cada receita)',
    tipo: 'texto',
    padrao: '',
    formato: {
      expressao: '^$|^[A-Za-z0-9._-]{1,20}=[a-zà-ú0-9 ,.+()-]+$',
      mensagem: 'Use VERSAO=genérico,genérico.',
    },
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'gerência de enfermagem e farmácia',
    origem: 'ficha do M45, regra 17 (lista de medicamentos do anexo II como parâmetro versionado)',
  },
  {
    chave: PARAMETRO_IMUNOBIOLOGICOS,
    modulo: 'enfermagem',
    descricao:
      'Imunobiológicos que o estabelecimento aplica, com o código do catálogo do modelo de informação da RNDS: codigo:nome, separados por ponto e vírgula',
    tipo: 'texto',
    padrao: '',
    formato: {
      expressao: '^$|^[A-Za-z0-9]{1,10}:[^;:]{2,120}(;[A-Za-z0-9]{1,10}:[^;:]{2,120})*$',
      mensagem: 'Use codigo:nome; separados por ponto e vírgula.',
    },
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'enfermagem e serviço de vacinação',
    origem:
      'ficha do M45, regra 18 (registro da vacina aplicada; os códigos conferidos no credenciamento na RNDS)',
  },
  // M21: higienização (SLA por tipo de limpeza × criticidade da área) e SAME.
  {
    chave: 'hotelaria.slaTerminalMinutos',
    modulo: 'hotelaria',
    descricao: 'Prazo da limpeza terminal (alta), em minutos, da solicitação à liberação do leito',
    tipo: 'inteiro',
    padrao: '120',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 15,
    maximo: 1440,
    dono: 'supervisão da higienização',
    origem: 'ficha do M21, seção 6 (SLA por tipo × criticidade em SGH_CFG_PARAMETRO)',
  },
  {
    chave: 'hotelaria.slaConcorrenteMinutos',
    modulo: 'hotelaria',
    descricao: 'Prazo da limpeza concorrente ou imediata, em minutos, da solicitação à liberação',
    tipo: 'inteiro',
    padrao: '60',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 10,
    maximo: 1440,
    dono: 'supervisão da higienização',
    origem: 'ficha do M21, seção 6',
  },
  {
    chave: 'hotelaria.slaCriticaFator',
    modulo: 'hotelaria',
    descricao:
      'Fator do prazo nas áreas críticas (porcentagem do prazo do tipo: 100 = o mesmo; 75 = um quarto menor)',
    tipo: 'inteiro',
    padrao: '75',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 25,
    maximo: 200,
    dono: 'supervisão da higienização',
    origem: 'ficha do M21, seção 6 (criticidade da área)',
  },
  {
    chave: 'hotelaria.janelaOutroSistemaHoras',
    modulo: 'hotelaria',
    descricao:
      'Horas para trás em que a limpeza pedida pela alta dada no outro sistema (ainda sem etapa aqui) entra na fila e põe o leito em higienização no mapa; 0 desliga',
    tipo: 'inteiro',
    padrao: '24',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 720,
    dono: 'supervisão da higienização',
    origem:
      'ficha do M21, seção 5 (coexistência: a solicitação nasce na alta, em qualquer dos dois sistemas)',
  },
  {
    chave: 'same.prazoDevolucaoDias',
    modulo: 'same',
    descricao: 'Prazo padrão de devolução do prontuário ou da conta em papel ao SAME, em dias',
    tipo: 'inteiro',
    padrao: '7',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 90,
    dono: 'SAME',
    origem: 'ficha do M21, seção 6 (cobrança de devolução)',
  },
  {
    chave: 'same.setorRegistro',
    modulo: 'same',
    descricao: 'Setor do arquivo em que o prontuário da internação é registrado na admissão',
    tipo: 'inteiro',
    padrao: '1',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 32767,
    dono: 'SAME',
    origem: 'ficha do M21, seção 5 (o setor 1 em 99,4% dos registros da admissão)',
  },
  // M34 (ficha, seção 4 e regra 3): teto de linhas e tempo máximo de cada relatório do catálogo (a consulta acima
  // é cancelada pelo driver com mensagem em português); o padrão é o da definição do relatório.
  ...RELATORIOS_CATALOGO.flatMap((r): DefinicaoParametro[] => {
    const sufixo = r.codigo.charAt(0).toUpperCase() + r.codigo.slice(1);
    return [
      {
        chave: `relatorio.tetoLinhas${sufixo}`,
        modulo: 'relatorio',
        descricao: `Teto de linhas do relatório "${r.titulo}" (acima dele a consulta é cancelada)`,
        tipo: 'inteiro',
        padrao: String(r.tetoLinhas),
        niveis: ['estabelecimento', 'rede'],
        critico: false,
        minimo: 10,
        maximo: 50_000,
        dono: 'curador do catálogo (TI)',
        origem: 'ficha do M34, seção 4 (teto por relatório em SGH_CFG_PARAMETRO)',
      },
      {
        chave: `relatorio.tempoMaximoSegundos${sufixo}`,
        modulo: 'relatorio',
        descricao: `Tempo máximo, em segundos, da consulta do relatório "${r.titulo}"`,
        tipo: 'inteiro',
        padrao: String(Math.round(r.tempoMaximoMs / 1000)),
        niveis: ['estabelecimento', 'rede'],
        critico: false,
        minimo: 1,
        maximo: 600,
        dono: 'curador do catálogo (TI)',
        origem: 'ficha do M34, seção 4 e regra 3 (consulta pesada cancelada pelo adaptador)',
      },
    ];
  }),
  {
    chave: 'integracao.alertaMortoMinutos',
    modulo: 'integracao',
    descricao: 'Minutos de uma mensagem na fila de mortos sem tratamento até o alerta',
    tipo: 'inteiro',
    padrao: '240',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 15,
    maximo: 1440,
    dono: 'TI do hospital',
    origem: 'ficha do M34, regra 10 (cap-14 §14.5: mais de 4 h)',
  },
  {
    chave: 'integracao.halaiEndereco',
    modulo: 'integracao',
    descricao:
      'Endereço da API da Hal-AI para a comunicação com o paciente (o token fica no cofre; fora de produção, só endereço local)',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    formato: {
      expressao: '^(?:|https?://[a-z0-9.-]+(?::\\d{2,5})?(?:/[a-z0-9._/-]*)?)$',
      mensagem: 'Use um endereço http(s) sem usuário nem senha (ou deixe em branco).',
    },
    dono: 'TI do hospital',
    origem: 'ficha do M34, regra 15a (DP-44 b: toda comunicação com o paciente pela Hal-AI)',
  },
  {
    chave: 'integracao.lotesVigiaFatos',
    modulo: 'integracao',
    descricao: 'Linhas lidas por ciclo da leitura incremental dos fatos do legado para as integrações novas',
    tipo: 'inteiro',
    padrao: '200',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 10,
    maximo: 5_000,
    dono: 'TI do hospital',
    origem: 'ficha do M34, regra 11 e seção 4 (lote; medir no marco)',
  },
  // M30: conta do paciente (faixa do preço manual, prazo da fila, validade do orçamento, janela da fila tardia). As
  // regras de mercado da DP-33 (POL-1) também são parâmetros: o valor gravado é sempre o do outro sistema.
  // ADR 0009: o "particular" padrão do hospital (há mais de uma fonte de tipo particular), usado pela API de
  // compatibilidade e pelo cálculo da regra de preço particular. Vazio: a única fonte ativa de tipo particular.
  {
    chave: 'faturamento.fontePagadoraParticularCodigo',
    modulo: 'faturamento',
    descricao:
      'Código da fonte pagadora particular padrão do hospital (vazio: a única fonte ativa de tipo particular)',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    formato: {
      expressao: '^[A-Za-z0-9._-]{0,30}$',
      mensagem: 'Informe o código da fonte pagadora (até 30 caracteres).',
    },
    dono: 'faturamento',
    origem: 'ADR 0009 e levantamento preco-profissional seção 5.4 (particular padrão)',
  },
  {
    chave: 'faturamento.precoManualFaixaAbaixoPct',
    modulo: 'faturamento',
    descricao: 'Faixa do preço manual abaixo da tabela sem aprovação, em %',
    tipo: 'inteiro',
    padrao: '10',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 100,
    dono: 'faturamento',
    origem: 'ficha do M30, regra 12 (preço manual com faixa e aprovação)',
  },
  {
    chave: 'faturamento.precoManualFaixaAcimaPct',
    modulo: 'faturamento',
    descricao: 'Faixa do preço manual acima da tabela sem aprovação, em %',
    tipo: 'inteiro',
    padrao: '20',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 500,
    dono: 'faturamento',
    origem: 'ficha do M30, regra 12',
  },
  {
    chave: 'faturamento.contaPrazoAltaDias',
    modulo: 'faturamento',
    descricao: 'Dias desde a alta para a conta entrar como atrasada na fila de trabalho',
    tipo: 'inteiro',
    padrao: '10',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 180,
    dono: 'faturamento',
    origem: 'ficha do M30, seção 4 (idade desde a alta)',
  },
  {
    chave: 'faturamento.orcamentoValidadeDias',
    modulo: 'faturamento',
    descricao: 'Validade padrão do orçamento de particular, em dias',
    tipo: 'inteiro',
    padrao: '30',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 180,
    dono: 'faturamento',
    origem: 'ficha do M30, campo 5 (particular)',
  },
  {
    chave: 'faturamento.tardioJanelaDias',
    modulo: 'faturamento',
    descricao: 'Dias olhados para trás na fila de lançamento após o fechamento',
    tipo: 'inteiro',
    padrao: '180',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 7,
    maximo: 3650,
    dono: 'faturamento',
    origem: 'ficha do M30, regra 5 (fila ATU_FAT=F)',
  },
  // M31: TISS, competência, glosa e recurso (prazo de recurso por operadora sem valor padrão: DP-33.9; lote parado).
  {
    chave: 'faturamento.recursoPrazoPorOperadora',
    modulo: 'faturamento',
    descricao:
      'Prazo de recurso de glosa por operadora, em dias contados da baixa ("convênio:dias;convênio:dias"); sem valor, o alerta "prazo não cadastrado"',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    formato: {
      expressao: '^$|^\\d{1,5}:\\d{1,3}(;\\d{1,5}:\\d{1,3})*$',
      mensagem: 'Use convênio:dias separados por ponto e vírgula (ex.: 301:30;305:60).',
    },
    dono: 'faturamento',
    origem: 'ficha do M31, DP-33.9 (POL-1: prazo por operadora como parâmetro, sem padrão)',
  },
  {
    chave: 'faturamento.loteParadoDias',
    modulo: 'faturamento',
    descricao: 'Dias sem protocolo a partir dos quais o lote aparece como parado nos prazos de envio',
    tipo: 'inteiro',
    padrao: '15',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 365,
    dono: 'faturamento',
    origem: 'ficha do M31, seção 4 (prazos de envio e lotes parados)',
  },
  {
    chave: 'faturamento.painelGlosaCacheHoras',
    modulo: 'faturamento',
    descricao: 'Horas de validade do painel de glosas em cache (agregação no banco; ref 01 §4.6)',
    tipo: 'inteiro',
    padrao: '6',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 48,
    dono: 'faturamento',
    origem: 'ficha do M31, seção 4 (painel com cache de horas)',
  },
  // M51 (etapa 1): faturamento SUS próprio, CIHA. O CNES vem do parâmetro (no dev, o CNES da empresa de origem está zerado; ele fica
  // só como reserva); os convênios SUS e particular e a fonte de remuneração por convênio são do estabelecimento.
  {
    chave: 'faturamento.sus.cnes',
    modulo: 'faturamento',
    descricao:
      'CNES do estabelecimento nos arquivos SUS (CIHA); vazio usa o cadastro do estabelecimento e, sem ele, a crítica "sem CNES"',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento'],
    critico: true,
    formato: { expressao: '^$|^\\d{7}$', mensagem: 'Use os 7 dígitos do CNES.' },
    dono: 'faturamento',
    origem: 'ficha do M51, regra 5 (CNES 3132471 no ProntoCardio; o do Serrano no banco dele)',
  },
  {
    chave: 'faturamento.sus.conveniosSus',
    modulo: 'faturamento',
    descricao:
      'Convênios do SUS (códigos separados por vírgula): ficam fora da CIHA e vão para BPA, APAC ou AIH',
    tipo: 'texto',
    padrao: '1',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    formato: {
      expressao: '^\\d{1,5}(,\\d{1,5})*$',
      mensagem: 'Use códigos de convênio separados por vírgula (ex.: 1).',
    },
    dono: 'faturamento',
    origem: 'ficha do M51, regra 1 (convênio SUS de código 1 nos dois hospitais)',
  },
  {
    chave: 'faturamento.sus.conveniosParticular',
    modulo: 'faturamento',
    descricao: 'Convênios do particular (códigos separados por vírgula), como no caixa do particular',
    tipo: 'texto',
    padrao: '10',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    formato: {
      expressao: '^\\d{1,5}(,\\d{1,5})*$',
      mensagem: 'Use códigos de convênio separados por vírgula (ex.: 10).',
    },
    dono: 'faturamento',
    origem: 'ficha do M51, regra 1 (particular = 10, o mesmo do M30)',
  },
  {
    chave: 'faturamento.sus.ciha.fontePadrao',
    modulo: 'faturamento',
    descricao:
      'Fonte de remuneração da CIHA dos convênios que não estão no mapa (o convênio comum é plano privado)',
    tipo: 'lista',
    padrao: 'plano-privado',
    opcoes: [
      'plano-privado',
      'plano-publico',
      'particular-pf',
      'particular-pj',
      'programa-federal',
      'recurso-proprio-gestor',
      'dpvat',
      'gratuidade',
      'consorcio-publico',
    ],
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'faturamento',
    origem: 'ficha do M51, regra 3; leiaute do CIHA01 1.0.4.0 (TP_FREMU)',
  },
  {
    chave: 'faturamento.sus.ciha.fontePorConvenio',
    modulo: 'faturamento',
    descricao:
      'Fonte de remuneração da CIHA por convênio ("convênio:fonte" separados por ponto e vírgula; ex.: 10:particular-pf)',
    tipo: 'texto',
    padrao: '10:particular-pf',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    formato: {
      expressao:
        '^$|^\\d{1,5}:(plano-privado|plano-publico|particular-pf|particular-pj|programa-federal|recurso-proprio-gestor|dpvat|gratuidade|consorcio-publico)(;\\d{1,5}:(plano-privado|plano-publico|particular-pf|particular-pj|programa-federal|recurso-proprio-gestor|dpvat|gratuidade|consorcio-publico))*$',
      mensagem: 'Use convênio:fonte separados por ponto e vírgula (ex.: 10:particular-pf;55:dpvat).',
    },
    dono: 'faturamento',
    origem: 'ficha do M51, regra 3; leiaute do CIHA01 1.0.4.0 (TP_FREMU)',
  },
  // M51 (etapa 2): BPA e validador de compatibilidade. As habilitações do CNES (o outro sistema não as guarda) e os dados
  // do cabeçalho do BPA-Mag (órgão de origem e de destino, CNPJ do prestador). Desligado por estabelecimento (DP-35).
  {
    chave: 'faturamento.sus.habilitacoes',
    modulo: 'faturamento',
    descricao:
      'Habilitações SUS do estabelecimento no CNES (códigos da SIGTAP separados por vírgula): o procedimento que exige habilitação só passa com uma delas',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento'],
    critico: true,
    formato: {
      expressao: '^$|^\\d{1,4}(,\\d{1,4})*$',
      mensagem: 'Use códigos de habilitação separados por vírgula (ex.: 801,802).',
    },
    dono: 'faturamento',
    origem: 'ficha do M51, seção 5 (faturamento.criticarSus: habilitação) e DP-47.4',
  },
  {
    chave: 'faturamento.sus.bpa.orgaoOrigem',
    modulo: 'faturamento',
    descricao: 'Nome do órgão de origem (o estabelecimento) no cabeçalho do BPA-Mag, até 30 letras',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento'],
    critico: false,
    formato: { expressao: '^.{0,30}$', mensagem: 'Até 30 caracteres.' },
    dono: 'faturamento',
    origem: 'ficha do M51, seção 5 (faturamento.gerarBpa); leiaute do BPA-Mag (cabeçalho)',
  },
  {
    chave: 'faturamento.sus.bpa.siglaOrigem',
    modulo: 'faturamento',
    descricao: 'Sigla do órgão de origem no cabeçalho do BPA-Mag, até 6 letras',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento'],
    critico: false,
    formato: { expressao: '^[A-Za-z0-9]{0,6}$', mensagem: 'Até 6 letras ou números.' },
    dono: 'faturamento',
    origem: 'leiaute do BPA-Mag (cabeçalho)',
  },
  {
    chave: 'faturamento.sus.bpa.cnpjPrestador',
    modulo: 'faturamento',
    descricao: 'CNPJ do prestador no cabeçalho do BPA-Mag (14 dígitos)',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento'],
    critico: true,
    formato: { expressao: '^$|^\\d{14}$', mensagem: 'Use os 14 dígitos do CNPJ.' },
    dono: 'faturamento',
    origem: 'leiaute do BPA-Mag (cabeçalho)',
  },
  {
    chave: 'faturamento.sus.bpa.orgaoDestino',
    modulo: 'faturamento',
    descricao: 'Nome do gestor de destino (secretaria de saúde) no cabeçalho do BPA-Mag, até 40 letras',
    tipo: 'texto',
    padrao: 'SECRETARIA MUNICIPAL DE SAUDE',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    formato: { expressao: '^.{1,40}$', mensagem: 'De 1 a 40 caracteres.' },
    dono: 'faturamento',
    origem: 'leiaute do BPA-Mag (cabeçalho)',
  },
  {
    chave: 'faturamento.sus.bpa.indicadorDestino',
    modulo: 'faturamento',
    descricao: 'Gestor de destino do BPA: municipal (M) ou estadual (E)',
    tipo: 'lista',
    padrao: 'M',
    opcoes: ['M', 'E'],
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'faturamento',
    origem: 'leiaute do BPA-Mag (cabeçalho)',
  },
  // M51 (etapa 4): AIH. O tipo de UTI do SIH e o procedimento da diária por tipo de acomodação da
  // trajetória (o outro sistema não liga a acomodação ao tipo de UTI do SIH) e o diretor clínico do SISAIH01.
  // Desligado por estabelecimento (DP-35).
  {
    chave: 'faturamento.sus.aih.utiPorAcomodacao',
    modulo: 'faturamento',
    descricao:
      'Diárias de UTI da AIH: acomodação da trajetória, tipo de UTI do SIH e procedimento SIGTAP da diária (acomodação:tipo:procedimento, separados por ponto e vírgula)',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento'],
    critico: true,
    formato: {
      expressao: '^$|^\\d{1,3}:\\d{1,3}:\\d{10}(;\\d{1,3}:\\d{1,3}:\\d{10})*$',
      mensagem: 'Use acomodação:tipo:procedimento separados por ponto e vírgula (ex.: 3:2:0802010083).',
    },
    dono: 'faturamento',
    origem: 'ficha do M51, regra 6 (diárias de UTI pela trajetória); tabela de tipos de UTI do SIH',
  },
  {
    chave: 'faturamento.sus.aih.diretorClinicoCns',
    modulo: 'faturamento',
    descricao: 'CNS do diretor clínico do estabelecimento (campo obrigatório da AIH no SISAIH01)',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento'],
    critico: true,
    formato: { expressao: '^$|^\\d{15}$', mensagem: 'Use os 15 dígitos do CNS.' },
    dono: 'faturamento',
    origem: 'ficha do M51, seção 5 (faturamento.registrarAih: SISAIH01)',
  },
  {
    chave: 'faturamento.sus.apac.uf',
    modulo: 'faturamento',
    descricao:
      'Código IBGE da UF do gestor no registro da APAC (2 dígitos, ex.: 33). O cabeçalho do APAC-Mag usa os mesmos órgão, sigla, CNPJ e destino do BPA',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento'],
    critico: false,
    formato: { expressao: '^(\\d{2})?$', mensagem: 'Dois dígitos (código IBGE da UF).' },
    dono: 'faturamento',
    origem: 'ficha do M51, seção 5 (faturamento.registrarApac, APAC-Mag); leiaute da APAC (registro 14)',
  },
  // M28: estoque e compras (tolerâncias da nota, limite do inventário, alçadas, alerta de validade, ponto de pedido).
  {
    chave: 'suprimentos.alertaValidadeDias',
    modulo: 'suprimentos',
    descricao: 'Dias de antecedência do alerta de validade do lote nos saldos e na saída',
    tipo: 'inteiro',
    padrao: '60',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 365,
    dono: 'farmácia',
    origem: 'ficha do M28, seção 6 (antecedência do alerta de validade)',
  },
  {
    chave: 'suprimentos.notaToleranciaQuantidadePct',
    modulo: 'suprimentos',
    descricao: 'Tolerância da quantidade da nota sobre o saldo do pedido, em %',
    tipo: 'inteiro',
    padrao: '5',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 100,
    dono: 'compras',
    origem: 'ficha do M28, regra 12 (tolerâncias da nota)',
  },
  {
    chave: 'suprimentos.notaToleranciaPrecoPct',
    modulo: 'suprimentos',
    descricao: 'Tolerância do preço unitário da nota sobre o do pedido, em %',
    tipo: 'inteiro',
    padrao: '2',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 100,
    dono: 'compras',
    origem: 'ficha do M28, regra 12',
  },
  {
    chave: 'suprimentos.notaToleranciaPrazoDias',
    modulo: 'suprimentos',
    descricao: 'Dias de atraso tolerados na entrega sobre o prazo do pedido',
    tipo: 'inteiro',
    padrao: '3',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 180,
    dono: 'compras',
    origem: 'ficha do M28, regra 12',
  },
  {
    chave: 'suprimentos.inventarioLimiteDivergenciaPct',
    modulo: 'suprimentos',
    descricao: 'Divergência da contagem sobre o saldo, em %, acima da qual a recontagem é obrigatória',
    tipo: 'inteiro',
    padrao: '2',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 100,
    dono: 'almoxarifado',
    origem: 'ficha do M28, regra 14 (limite de divergência)',
  },
  {
    chave: 'suprimentos.alcadaNivel1Ate',
    modulo: 'suprimentos',
    descricao: 'Valor máximo do pedido aprovado pela alçada de nível 1 (reais)',
    tipo: 'inteiro',
    padrao: '5000',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 0,
    maximo: 100000000,
    dono: 'diretoria administrativa',
    origem: 'ficha do M28, aprovarPedido (faixas de alçada)',
  },
  {
    chave: 'suprimentos.alcadaNivel2Ate',
    modulo: 'suprimentos',
    descricao: 'Valor máximo do pedido aprovado pela alçada de nível 2 (acima: nível 3)',
    tipo: 'inteiro',
    padrao: '50000',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 0,
    maximo: 100000000,
    dono: 'diretoria administrativa',
    origem: 'ficha do M28, aprovarPedido',
  },
  {
    chave: 'suprimentos.pontoPedidoMeses',
    modulo: 'suprimentos',
    descricao: 'Meses de consumo usados na média do ponto de pedido',
    tipo: 'inteiro',
    padrao: '6',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 24,
    dono: 'compras',
    origem: 'ficha do M28, regra 15',
  },
  {
    chave: 'suprimentos.pontoPedidoNivelServicoPct',
    modulo: 'suprimentos',
    descricao: 'Nível de serviço do estoque de segurança, em % (90, 95 ou 99)',
    tipo: 'inteiro',
    padrao: '95',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 50,
    maximo: 99,
    dono: 'compras',
    origem: 'ficha do M28, regra 15',
  },
  // M29: farmácia hospitalar e clínica (janela da fila por unidade, política "dispensar só depois de validar", classes
  // da fila humana, regras automáticas, local da dispensação e a decisão da DP-25). Nada nos parâmetros do prontuário de origem (compartilhados).
  {
    chave: 'suprimentos.farmaciaJanelaHoras',
    modulo: 'suprimentos',
    descricao: 'Janela da fila de dispensação por unidade, em horas à frente do relógio',
    tipo: 'inteiro',
    padrao: '12',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 48,
    dono: 'farmácia',
    origem: 'ficha do M29, regra 1 (por exemplo, as próximas 12 h); dúvida do campo 13 (janela por unidade)',
  },
  {
    chave: 'suprimentos.farmaciaPoliticaDispensacao',
    modulo: 'suprimentos',
    descricao:
      'Política "dispensar só depois de validar" por classe (classe=validar-antes ou livre; separadas por ;); urgente e "agora" são exceção',
    tipo: 'texto',
    padrao:
      'alto-risco=validar-antes;antimicrobiano=validar-antes;controlado=livre;comum=livre;material=livre',
    formato: {
      expressao:
        '^((alto-risco|antimicrobiano|controlado|comum|material)=(validar-antes|livre))(;(alto-risco|antimicrobiano|controlado|comum|material)=(validar-antes|livre))*$',
      mensagem: 'Use classe=validar-antes ou classe=livre, separadas por ponto e vírgula.',
    },
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: true,
    dono: 'farmácia clínica',
    origem: 'ficha do M29, regra 3; cap-11 §11.2; DP-25 (escopo inicial: alto risco e antimicrobiano)',
  },
  {
    chave: 'suprimentos.farmaciaClassesFilaHumana',
    modulo: 'suprimentos',
    descricao:
      'Classes de medicamento que vão à fila humana da avaliação farmacêutica (separadas por vírgula)',
    tipo: 'texto',
    padrao: 'alto-risco,antimicrobiano',
    formato: {
      expressao:
        '^(alto-risco|antimicrobiano|controlado|comum)(,(alto-risco|antimicrobiano|controlado|comum))*$',
      mensagem: 'Use as classes alto-risco, antimicrobiano, controlado ou comum, separadas por vírgula.',
    },
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: true,
    dono: 'farmácia clínica',
    origem: 'ficha do M29, regra 7; DP-25 (recomendação: alto risco e antimicrobiano)',
  },
  {
    chave: 'suprimentos.farmaciaRegrasAutomaticas',
    modulo: 'suprimentos',
    descricao:
      'Regras automáticas aprovam o baixo risco sem achado (o equivalente ao "válido automaticamente")',
    tipo: 'booleano',
    padrao: 'sim',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: true,
    dono: 'farmácia clínica',
    origem: 'ficha do M29, regra 7',
  },
  {
    chave: 'suprimentos.farmaciaLocalDispensacao',
    modulo: 'suprimentos',
    descricao: 'Local de estoque da farmácia que dispensa para a unidade (o da farmácia central por padrão)',
    tipo: 'inteiro',
    padrao: '10',
    niveis: ['usuario', 'unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 99,
    dono: 'farmácia',
    origem: 'ficha do M29, seção 12 (farmácia central e satélites); perfil: o local 10 é a farmácia central',
  },
  {
    chave: 'suprimentos.farmaciaAvaliacaoNoLegado',
    modulo: 'suprimentos',
    descricao:
      'A avaliação do farmacêutico vai também à situação da prescrição no outro sistema (2, 3 e 4): só com a decisão da DP-25 e a conferência no outro sistema',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'farmácia clínica',
    origem: 'ficha do M29, regra 8; DP-25',
  }, // M37: prazos de severidade dos chamados (regra 7; cap-14 §14.9.2: propostos, aprovados pela diretoria antes da
  // primeira liberação) e a proposta de setor migrado (regra 10; cap-14 §14.9.4).
  {
    chave: 'coexistencia.chamadoS1RespostaMin',
    modulo: 'coexistencia',
    descricao: 'Chamado S1 (crítica): primeira resposta, em minutos corridos (24 × 7)',
    tipo: 'inteiro',
    padrao: '15',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 5,
    maximo: 240,
    dono: 'diretoria',
    origem: 'ficha do M37, regra 7; cap-14 §14.9.2 (proposto, a aprovar pela diretoria)',
  },
  {
    chave: 'coexistencia.chamadoS1ContornoMin',
    modulo: 'coexistencia',
    descricao:
      'Chamado S1 (crítica): contorno, em minutos corridos (imediato pelo outro sistema; 1 h nos demais casos)',
    tipo: 'inteiro',
    padrao: '60',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 5,
    maximo: 1440,
    dono: 'diretoria',
    origem: 'ficha do M37, regra 7; cap-14 §14.9.2 (proposto, a aprovar pela diretoria)',
  },
  {
    chave: 'coexistencia.chamadoS2RespostaMin',
    modulo: 'coexistencia',
    descricao: 'Chamado S2 (alta): primeira resposta, em minutos corridos',
    tipo: 'inteiro',
    padrao: '60',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 15,
    maximo: 1440,
    dono: 'diretoria',
    origem: 'ficha do M37, regra 7; cap-14 §14.9.2 (proposto, a aprovar pela diretoria)',
  },
  {
    chave: 'coexistencia.chamadoS2ContornoMin',
    modulo: 'coexistencia',
    descricao: 'Chamado S2 (alta): contorno, em minutos corridos',
    tipo: 'inteiro',
    padrao: '480',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 60,
    maximo: 4320,
    dono: 'diretoria',
    origem: 'ficha do M37, regra 7; cap-14 §14.9.2 (proposto, a aprovar pela diretoria)',
  },
  {
    chave: 'coexistencia.chamadoS3RespostaDiasUteis',
    modulo: 'coexistencia',
    descricao: 'Chamado S3 (média): primeira resposta, em dias úteis',
    tipo: 'inteiro',
    padrao: '1',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 1,
    maximo: 10,
    dono: 'diretoria',
    origem: 'ficha do M37, regra 7; cap-14 §14.9.2 (proposto, a aprovar pela diretoria)',
  },
  {
    chave: 'coexistencia.chamadoS3ContornoDiasUteis',
    modulo: 'coexistencia',
    descricao: 'Chamado S3 (média): correção (próxima versão), em dias úteis',
    tipo: 'inteiro',
    padrao: '10',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 1,
    maximo: 60,
    dono: 'diretoria',
    origem: 'ficha do M37, regra 7; cap-14 §14.9.2 (proposto, a aprovar pela diretoria)',
  },
  {
    chave: 'coexistencia.chamadoS4RespostaDiasUteis',
    modulo: 'coexistencia',
    descricao: 'Chamado S4 (baixa): primeira resposta, em dias úteis',
    tipo: 'inteiro',
    padrao: '2',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 1,
    maximo: 20,
    dono: 'diretoria',
    origem: 'ficha do M37, regra 7; cap-14 §14.9.2 (proposto, a aprovar pela diretoria)',
  },
  {
    chave: 'coexistencia.chamadoS4ContornoDiasUteis',
    modulo: 'coexistencia',
    descricao: 'Chamado S4 (baixa): tratamento (fila de melhorias), em dias úteis',
    tipo: 'inteiro',
    padrao: '30',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 1,
    maximo: 120,
    dono: 'diretoria',
    origem: 'ficha do M37, regra 7; cap-14 §14.9.2 (proposto, a aprovar pela diretoria)',
  },
  {
    chave: 'coexistencia.prazosAprovados',
    modulo: 'coexistencia',
    descricao:
      'Os prazos de severidade foram aprovados pela diretoria (enquanto não, a tela mostra "a aprovar")',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'diretoria',
    origem: 'ficha do M37, regra 7 e seção 14 (fora do cap-16: prazos de severidade)',
  },
  {
    chave: 'coexistencia.migradoDiasSemS1',
    modulo: 'coexistencia',
    descricao: 'Setor migrado (proposta): dias seguidos sem chamado S1 do setor',
    tipo: 'inteiro',
    padrao: '14',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 1,
    maximo: 90,
    dono: 'comitê de coexistência',
    origem: 'ficha do M37, regra 10; cap-14 §14.9.4 (proposta)',
  },
  {
    chave: 'coexistencia.migradoDiasConexoes',
    modulo: 'coexistencia',
    descricao:
      'Setor migrado (proposta): janela, em dias, da queda contínua das conexões das pessoas do setor no outro sistema',
    tipo: 'inteiro',
    padrao: '14',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 3,
    maximo: 90,
    dono: 'comitê de coexistência',
    origem: 'ficha do M37, regra 10; cap-14 §14.9.4 (proposta)',
  },
  // M44 (etapa 2): o NIR (prazo por prioridade, validade da reserva e os limites padrão do quadro de permanência).
  {
    chave: 'internacao.nirPrazoEmergenciaMin',
    modulo: 'internacao',
    descricao: 'Prazo da fila do NIR para a prioridade emergência, em minutos (estouro alerta o NIR)',
    tipo: 'inteiro',
    padrao: '60',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 10,
    maximo: 1440,
    dono: 'NIR e coordenação de leitos',
    origem: 'ficha do M44, regra 11 e mina M41, regra 13 (padrão de mercado; meta a propor)',
  },
  {
    chave: 'internacao.nirPrazoUrgenteMin',
    modulo: 'internacao',
    descricao: 'Prazo da fila do NIR para a prioridade urgente, em minutos',
    tipo: 'inteiro',
    padrao: '240',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 30,
    maximo: 2880,
    dono: 'NIR e coordenação de leitos',
    origem: 'ficha do M44, regra 11 e mina M41, regra 13 (padrão de mercado; meta a propor)',
  },
  {
    chave: 'internacao.nirPrazoPrioritarioMin',
    modulo: 'internacao',
    descricao: 'Prazo da fila do NIR para a prioridade prioritário, em minutos',
    tipo: 'inteiro',
    padrao: '720',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 60,
    maximo: 4320,
    dono: 'NIR e coordenação de leitos',
    origem: 'ficha do M44, regra 11 e mina M41, regra 13 (padrão de mercado; meta a propor)',
  },
  {
    chave: 'internacao.nirPrazoEletivoMin',
    modulo: 'internacao',
    descricao: 'Prazo da fila do NIR para a prioridade eletivo, em minutos',
    tipo: 'inteiro',
    padrao: '2880',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 120,
    maximo: 20160,
    dono: 'NIR e coordenação de leitos',
    origem: 'ficha do M44, regra 11 e mina M41, regra 13 (padrão de mercado; meta a propor)',
  },
  {
    chave: 'internacao.nirValidadeReservaMin',
    modulo: 'internacao',
    descricao: 'Validade padrão da reserva de leito, em minutos (expirada, o leito volta a livre)',
    tipo: 'inteiro',
    padrao: '120',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 15,
    maximo: 1440,
    dono: 'NIR e coordenação de leitos',
    origem: 'ficha do M44, regra 11 e mina M41, regra 13 (padrão de mercado; meta a propor)',
  },
  {
    chave: 'internacao.permanenciaAmareloDias',
    modulo: 'internacao',
    descricao:
      'Limite amarelo padrão do quadro de permanência, em dias da Portaria 312 (sem limite da clínica, CID ou procedimento)',
    tipo: 'inteiro',
    padrao: '7',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 365,
    dono: 'NIR e coordenação de leitos',
    origem: 'ficha do M44, regra 11 e mina M41, regra 13 (padrão de mercado; meta a propor)',
  },
  {
    chave: 'internacao.permanenciaVermelhoDias',
    modulo: 'internacao',
    descricao: 'Limite vermelho padrão do quadro de permanência, em dias da Portaria 312',
    tipo: 'inteiro',
    padrao: '10',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 2,
    maximo: 365,
    dono: 'NIR e coordenação de leitos',
    origem: 'ficha do M44, regra 11 e mina M41, regra 13 (padrão de mercado; meta a propor)',
  },
  // M48 (etapa 3; regra 6): o prazo da política de antimicrobiano restrito para a liberação da CCIH (24 a 48 h); sem
  // liberação no prazo, alerta ao prescritor e à CCIH (o sistema não suspende).
  {
    chave: 'qualidade.prazoLiberacaoAntimicrobianoHoras',
    modulo: 'qualidade',
    descricao: 'Prazo, em horas, para a CCIH liberar o antimicrobiano restrito prescrito',
    tipo: 'inteiro',
    padrao: '48',
    niveis: ['estabelecimento'],
    critico: false,
    minimo: 24,
    maximo: 48,
    dono: 'CCIH',
    origem: 'ficha do M48, regra 6 (cap-05b §5.11, Antimicrobiano)',
  },
  // M58 (ficha, seção 6; regras 6 e 7): o charset efetivo do banco do estabelecimento, lido pelo codec do adaptador na
  // partida e conferido contra o catálogo do banco (NONE com texto CP1252 hoje; UTF8 só depois da conversão ensaiada
  // na M58-F3 e da janela). Só a TI muda, na janela, com autorização do dono.
  {
    chave: 'legado.charset',
    modulo: 'legado',
    descricao: 'Codificação do texto no banco do estabelecimento (muda só na janela da conversão para UTF-8)',
    tipo: 'lista',
    padrao: 'CP1252',
    niveis: ['estabelecimento'],
    critico: true,
    opcoes: ['CP1252', 'UTF8'],
    dono: 'TI do hospital e responsável técnico',
    origem: 'ficha do M58, seção 6 (cap-10 §10.13; BRIEF §4.2)',
  },
  // M58-F4 (ficha do M58, regras 8 e 9; cap-12, Decisão): a fachada de compatibilidade da API de integração da Hal-AI,
  // desligada por padrão e com a escrita desligada por padrão; superfícies atendidas e o endereço da API original para
  // o repasse das operações que o Sante SGH ainda não serve. Os tokens vêm do ambiente do servidor, nunca daqui.
  {
    chave: 'integracao.fachada.ligada',
    modulo: 'integracao',
    descricao: 'Fachada da API de integração da Hal-AI ligada no estabelecimento',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['estabelecimento'],
    critico: true,
    dono: 'TI do hospital, com o aceite da equipe da Hal-AI',
    origem: 'ficha do M58, seção 2 (M58-F4) e regra 8; DP-8',
  },
  {
    chave: 'integracao.fachada.escrita',
    modulo: 'integracao',
    descricao:
      'Escrita pela fachada (superfície de ações e escritas diretas do atendimento): desligada por padrão',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['estabelecimento'],
    critico: true,
    dono: 'dono do projeto e TI do hospital',
    origem: 'ficha do M58, regra 9 (cap-12: a desativação de escrita por padrão)',
  },
  {
    chave: 'integracao.fachada.superficies',
    modulo: 'integracao',
    descricao:
      'Superfícies atendidas pela fachada (separadas por vírgula: atendimento, gestao, acoes, auditoria, saude)',
    tipo: 'texto',
    padrao: 'atendimento,gestao,acoes,auditoria,saude',
    niveis: ['estabelecimento'],
    critico: true,
    dono: 'TI do hospital, com o aceite da equipe da Hal-AI',
    origem: 'ficha do M58, regra 9 (os escopos de token por superfície)',
  },
  {
    chave: 'integracao.fachada.destino',
    modulo: 'integracao',
    descricao:
      'Endereço-base da API de integração original para o repasse das operações que a fachada ainda não serve (vazio: sem repasse)',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento'],
    critico: true,
    dono: 'TI do hospital',
    origem:
      'ficha do M58, seção 7 (serviço com o contrato da API de integração; troca gradual, D-REPASSE-F4-58)',
  },
  // M59-F1 (ficha, regra 1; DP-6): enquanto o período de contingência do estabelecimento estiver aberto, o sistema
  // anterior ainda pode ser religado e nada do que ele usa (contas, privilégios, senhas, segredos) é retirado. Padrão
  // ligado (falha fechada): só o dono desliga, depois de registrar o fim da contingência. M59.2: ligado, as operações
  // acesso.retirarSenhaLegado, acesso.retirarSenhaSecundaria e integracao.cifrarSegredoLegado recusam.
  {
    chave: 'legado.contingencia',
    modulo: 'legado',
    descricao:
      'Período de contingência aberto: o sistema anterior ainda pode ser religado e nada do que ele usa é retirado',
    tipo: 'booleano',
    padrao: 'sim',
    niveis: ['estabelecimento'],
    critico: true,
    dono: 'Dono do projeto',
    origem: 'ficha do M59, regra 1 (DP-6; cap-08 §8.16; cap-10 §10.13)',
  },
  // M59-F4 (ficha, seção 1: "administradores limitados ao configurado"; cap-08 §8.15): quantos usuários ativos ficam
  // no grupo de administradores depois do saneamento dos grupos de acesso amplo (o achado: 30 administradores).
  {
    chave: 'acesso.saneamento.administradoresMaximo',
    modulo: 'acesso',
    descricao:
      'Quantos administradores (usuários ativos do grupo de acesso total) ficam depois do saneamento dos grupos',
    tipo: 'inteiro',
    padrao: '3',
    niveis: ['estabelecimento'],
    critico: true,
    minimo: 1,
    maximo: 10,
    dono: 'Gestor de acessos',
    origem: 'ficha do M59, seção 1 e regra 8 (M59-F4; cap-08 §8.7, §8.15)',
  },
  // W1-01 (parte 9a; D-W101-29): contas dormentes. A rotina bloqueia (acesso.bloquearUsuario) a conta ativa que não
  // entra há mais de N dias, respeitando as exceções justificadas e o último gestor de acessos ativo.
  {
    chave: 'acesso.contasDormentes.ligada',
    modulo: 'acesso',
    descricao: 'Bloquear sozinho as contas que não entram há mais dos dias configurados (contas dormentes)',
    tipo: 'booleano',
    padrao: 'sim',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'Gestor de acessos',
    origem: 'W1-01 (mercado: bloqueio de contas dormentes; SBIS NGS1.03.08); D-W101-29',
  },
  {
    chave: 'acesso.contasDormentes.diasPessoal',
    modulo: 'acesso',
    descricao: 'Dias sem entrar para bloquear a conta pessoal',
    tipo: 'inteiro',
    padrao: '90',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 30,
    maximo: 730,
    dono: 'Gestor de acessos',
    origem: 'W1-01 (mercado: bloqueio de contas dormentes); D-W101-29',
  },
  {
    chave: 'acesso.contasDormentes.diasDispositivo',
    modulo: 'acesso',
    descricao: 'Dias sem entrar para bloquear a conta de dispositivo ou integração (sem pessoa por trás)',
    tipo: 'inteiro',
    padrao: '180',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 30,
    maximo: 730,
    dono: 'Gestor de acessos',
    origem: 'W1-01 (mercado: bloqueio de contas dormentes); D-W101-29',
  },
  // W1-01 (parte 11a; D-W101-35): provisionamento pelo RH. Férias e afastamentos em curso podem gerar a tarefa de
  // suspender o acesso (bloqueio pelo executor acesso.bloquearUsuario); padrão desligado.
  {
    chave: 'acesso.provisionamentoRh.suspenderAfastamento',
    modulo: 'acesso',
    descricao: 'Gerar a tarefa de suspender o acesso nas férias e afastamentos em curso',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'Gestor de acessos',
    origem: 'W1-01 (mercado: provisionamento ligado ao RH); D-W101-35',
  },
  {
    chave: 'acesso.provisionamentoRh.diasMinimosAfastamento',
    modulo: 'acesso',
    descricao:
      'Duração mínima, em dias, das férias ou do afastamento que gera a tarefa de suspender o acesso',
    tipo: 'inteiro',
    padrao: '15',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 365,
    dono: 'Gestor de acessos',
    origem: 'W1-01 (mercado: provisionamento ligado ao RH); D-W101-35',
  },
  // W1-01 (parte 11b; D-W101-36): troca rápida de usuário por PIN curto, só depois do login forte do mesmo dia na mesma
  // estação. O PIN liga sozinho; o crachá pelo agente local depende do dono (leitor) e fica desligado.
  {
    chave: 'acesso.trocaRapida.ligada',
    modulo: 'acesso',
    descricao:
      'Permitir a troca rápida de usuário por PIN na estação em que a pessoa entrou com a senha hoje',
    tipo: 'booleano',
    padrao: 'sim',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'Gestor de acessos',
    origem: 'W1-01 (mercado: troca rápida em estação compartilhada); D-W101-36',
  },
  {
    chave: 'acesso.trocaRapida.cracha',
    modulo: 'acesso',
    descricao: 'Permitir a troca rápida pelo crachá de proximidade (leitor no agente local)',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'Gestor de acessos',
    origem: 'W1-01 (mercado: troca rápida por crachá; depende do leitor no agente local); D-W101-36',
  },
  {
    chave: 'acesso.trocaRapida.digitosPin',
    modulo: 'acesso',
    descricao: 'Quantidade mínima de dígitos do PIN da troca rápida',
    tipo: 'inteiro',
    padrao: '6',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 4,
    maximo: 8,
    dono: 'Gestor de acessos',
    origem: 'W1-01 (mercado: troca rápida em estação compartilhada); D-W101-36',
  },
  {
    chave: 'acesso.trocaRapida.tentativasPin',
    modulo: 'acesso',
    descricao:
      'Erros seguidos que bloqueiam o PIN da troca rápida (só um PIN novo, depois de entrar com a senha, libera)',
    tipo: 'inteiro',
    padrao: '3',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 1,
    maximo: 10,
    dono: 'Gestor de acessos',
    origem: 'W1-01 (mercado: troca rápida em estação compartilhada); D-W101-36',
  },
  // W1-01 (parte 11d; D-W101-46): conferência do conselho no vínculo usuário–profissional. O bloqueio dos atos
  // privativos é parametrizado; a consulta automática ao conselho fica desligada (convênio/credencial externa do dono).
  {
    chave: 'acesso.conselho.bloqueioAtosPrivativos',
    modulo: 'acesso',
    descricao:
      'Quando bloquear os atos privativos pela conferência do conselho: desligado, só com o registro irregular (inativo, suspenso, cancelado, não localizado) ou também sem conferência válida',
    tipo: 'lista',
    padrao: 'irregular',
    opcoes: ['desligado', 'irregular', 'irregular-ou-nao-conferido'],
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'Diretoria técnica',
    origem: 'W1-01 (mercado: situação do registro no conselho amarra os atos privativos); D-W101-46',
  },
  {
    chave: 'acesso.conselho.validadeConferenciaDias',
    modulo: 'acesso',
    descricao: 'Dias de validade da conferência do registro no conselho (depois, conta como não conferido)',
    tipo: 'inteiro',
    padrao: '365',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    minimo: 30,
    maximo: 1095,
    dono: 'Diretoria técnica',
    origem: 'W1-01 (mercado: conferência periódica do conselho); D-W101-46',
  },
  {
    chave: 'acesso.conselho.consultaAutomatica',
    modulo: 'acesso',
    descricao:
      'Consultar o conselho sozinho (depende do convênio ou credencial de consulta com cada conselho; sem ela, a conferência é manual)',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'Diretoria técnica',
    origem: 'W1-01 (mercado: consulta automática ao conselho, dependência externa do dono); D-W101-46',
  },
  // M33: repasse médico (meta do teste dourado, base, estorno, adicionais e as tabelas do RPA; ver parametros/repasse.ts).
  ...PARAMETROS_REPASSE,
  // M55-F1: manutenção e engenharia clínica (SLA por prioridade, antecedência do plano e aceite; ver parametros/manutencao.ts).
  ...PARAMETROS_MANUTENCAO,
  // M52-F1: gestão de pessoas (alerta de vencimento do conselho; ver parametros/pessoas.ts).
  ...PARAMETROS_PESSOAS,
  ...PARAMETROS_PORTAL,
  // M49: assinatura ICP-Brasil (autoridades por mídia, reprocessamento, autorização do provedor, verificador e o
  // conector do conselho de medicina, desligado; ver parametros/documento-assinatura.ts).
  ...PARAMETROS_DOCUMENTO_ASSINATURA,
  // M45 (etapa 5): nutrição (prazos da triagem, adequação da meta da EMTN, cortes das refeições e o jejum agendado).
  ...PARAMETROS_NUTRICAO,
  // M48 (etapa 5): as metas dos indicadores da qualidade.
  ...PARAMETROS_QUALIDADE,
  // M45 (etapa 6): especialidades sob demanda e o lactário (PIO, teto da superfície corporal, dupla checagem, fase
  // ativa do partograma e validade da fórmula).
  ...PARAMETROS_ESPECIALIDADES,
  // M47 (etapa 3): a lista de trabalho DICOM (modalidade por setor, janela da geração automática e o visualizador).
  ...PARAMETROS_PACS,
  // F3.5 (05-SADT linha 25): parâmetros do diagnóstico por setor (numeração, impressão, obrigatoriedades do pedido).
  ...PARAMETROS_SADT_SETOR,
  // M55 (fatia F2): rouparia e lavanderia (tolerância do retorno, prazo do retorno, preço do kg e prazo do cancelamento).
  ...PARAMETROS_ROUPARIA,
  ...PARAMETROS_CONTRATUALIZACAO,
  ...PARAMETROS_LICITACAO,
  // W0-02: a vigia de reconciliação do motor do CRUD genérico (D-CRUD-SEM-GATILHO).
  ...PARAMETROS_CRUD,
  // W0-09: como se grava o registro do fim e da retrocompatibilidade (D-RETRO-REGISTRO-F6).
  ...PARAMETROS_COEX_REGISTRO,
  // W0-09: hora confiável (servidor NTP, limiar do alerta e fuso da instituição).
  ...PARAMETROS_HORA_CONFIAVEL,
  // W0-07: limiares da sugestão de sepse no PA e a OS em leito (ver parametros/pa-leitos.ts).
  ...PARAMETROS_PA_LEITOS,
  // F2.2 onda 5d (pedido do lote 05-15): destinatários dos alertas por papel, no nível da rede.
  ...PARAMETROS_ALERTA_EMAIL,
];

export function definicaoParametro(chave: string): DefinicaoParametro | undefined {
  return PARAMETROS_NOVOS.find((p) => p.chave === chave);
}

/** Valor por nível como gravado (SGH_CFG_PARAMETRO): o resolvedor puro recebe a lista vigente. */
export interface ValorParametro {
  readonly id: string;
  readonly chave: string;
  readonly nivel: NivelParametro;
  /** Alvo do nível: código da rede, empresa (código da empresa), estabelecimento, unidade, perfil ou login. */
  readonly alvo: string;
  readonly valor: string;
  readonly vigenteDesde: string;
  readonly vigenteAte: string | null;
  readonly justificativa: string;
  readonly autor: string;
  /** W0-09: a sobreposição retirada (o nível e o alvo voltaram a herdar): quem retirou e o motivo. */
  readonly retiradaPor?: string | null;
  readonly retiradaMotivo?: string | null;
}

// ── API ──────────────────────────────────────────────────────────────────────────────────────────

export const esquemaExplicacao = z.object({
  chave: z.string(),
  valor: z.string(),
  /** De onde veio: o nível vencedor, ou `padrao`. */
  origem: z.enum([...NIVEIS_PARAMETRO, 'padrao']),
  alvo: z.string().nullable(),
  /** Passos da resolução, do mais específico ao padrão (o que valeu e o que foi ignorado e por quê). */
  passos: z.array(
    z.object({
      nivel: z.enum([...NIVEIS_PARAMETRO, 'padrao']),
      alvo: z.string().nullable(),
      valor: z.string().nullable(),
      situacao: z.enum(['vale', 'sobreposto', 'sem-valor', 'conflito', 'nao-permitido']),
    }),
  ),
  vigenteDesde: z.string().nullable(),
  autor: z.string().nullable(),
  justificativa: z.string().nullable(),
});
export type Explicacao = z.infer<typeof esquemaExplicacao>;

export const esquemaParametroNovoDescrito = z.object({
  chave: z.string(),
  modulo: z.string(),
  descricao: z.string(),
  tipo: z.enum(['inteiro', 'booleano', 'texto', 'lista']),
  padrao: z.string(),
  niveis: z.array(z.enum(NIVEIS_PARAMETRO)),
  critico: z.boolean(),
  opcoes: z.array(z.string()).optional(),
  minimo: z.number().optional(),
  maximo: z.number().optional(),
  dono: z.string(),
  explicacao: esquemaExplicacao,
});
export type ParametroNovoDescrito = z.infer<typeof esquemaParametroNovoDescrito>;

/** Parâmetro do legado como o legado o vê (só leitura; nunca adivinhado). */
export const esquemaParametroLegadoDescrito = z.object({
  /** Grupo de exibição: tabela de origem pelo nome funcional (recepção, PEP, estoque). */
  grupo: z.enum(['recepcao', 'pep', 'estoque']),
  campo: z.string(),
  rotulo: z.string().nullable(),
  /** Valor para exibir (letra traduzida, hora HH:MM, sentinela traduzida); null: vazio no legado. */
  valor: z.string().nullable(),
  /** Valor bruto como o legado guarda (letra, número, data), só nas colunas declaradas. */
  bruto: z.string().nullable(),
  situacao: z.enum(['interpretada', 'nao-interpretada', 'oculta', 'fora-do-declarado']),
});
export type ParametroLegadoDescrito = z.infer<typeof esquemaParametroLegadoDescrito>;

export const esquemaPainelParametros = z.object({
  estabelecimento: z.string(),
  novos: z.array(esquemaParametroNovoDescrito),
  legado: z.array(esquemaParametroLegadoDescrito),
  /** Contagem de colunas do legado por situação (declaradas × não interpretadas). */
  resumoLegado: z.object({
    interpretadas: z.number().int(),
    naoInterpretadas: z.number().int(),
    ocultas: z.number().int(),
  }),
});
export type PainelParametros = z.infer<typeof esquemaPainelParametros>;

export const esquemaDefinirParametro = z.object({
  nivel: z.enum(NIVEIS_PARAMETRO),
  alvo: z.string().min(1).max(40),
  valor: textoCp1252(400),
  justificativa: textoCp1252(400).pipe(z.string().min(10, 'Justifique com pelo menos 10 caracteres.')),
  /** Senha para reautenticação (parâmetro crítico). */
  senha: z.string().max(200).optional(),
});
export type DefinirParametro = z.infer<typeof esquemaDefinirParametro>;

/**
 * POST /api/administracao/parametros/:chave/retirada (W0-09): retirar a sobreposição do nível e do alvo; a versão
 * vigente é fechada (nunca apagada) e o nível volta a herdar. Crítico pede a senha.
 */
export const esquemaRetirarParametro = z
  .object({
    nivel: z.enum(NIVEIS_PARAMETRO),
    alvo: z.string().min(1).max(40),
    justificativa: textoCp1252(400).pipe(z.string().min(10, 'Justifique com pelo menos 10 caracteres.')),
    senha: z.string().max(200).optional(),
  })
  .strict();
export type RetirarParametro = z.infer<typeof esquemaRetirarParametro>;
