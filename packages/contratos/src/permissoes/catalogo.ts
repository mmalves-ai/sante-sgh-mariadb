// Catálogo das permissões DECLARADAS à mão pelos módulos (recursos novos e as que as fichas nomeiam). O
// catálogo-base do produto fica em catalogo-base.ts (`@sgh/contratos/catalogo-base`, fora do índice para não entrar
// no pacote da tela).
import { CATALOGO_ACESSO } from './acesso.js';
import { PERMISSOES_CONFIG_COEXISTENCIA } from './config.js';
import { PERMISSOES_M09 } from './sistema.js';
import { PERMISSOES_CONFIG_M08, PERMISSOES_DOMINIOS } from './dominios.js';
import { PERMISSOES_CADASTRO_M11 } from './cadastro.js';
import { PERMISSOES_M12 } from './precos.js';
import { PERMISSOES_M10 } from './administracao.js';
import { PERMISSOES_M13 } from './catalogos.js';
import { PERMISSOES_CONSULTAS_M14 } from './consultas.js';
import {
  PERMISSOES_PEP_M15,
  PERMISSOES_PEP_M22,
  PERMISSOES_PEP_M23,
  PERMISSOES_PEP_M24,
  PERMISSOES_PEP_M45_FORMULARIO_NOVO,
} from './pep.js';
import { PERMISSOES_M16 } from './internacao.js';
import { PERMISSOES_AGENDA_M17 } from './agenda.js';
import { PERMISSOES_RECEPCAO_M19 } from './recepcao.js';
import { PERMISSOES_AGENDA_EXAME_M18, PERMISSOES_CIRURGIA_M18 } from './cirurgia.js';
import { PERMISSOES_ATENDIMENTO_M20 } from './atendimento.js';
import { PERMISSOES_PACS_M47, PERMISSOES_SADT_M26 } from './sadt.js';
import { PERMISSOES_TRANSFUSAO_M47 } from './transfusao.js';
import { PERMISSOES_M27 } from './inicio.js';
import { PERMISSOES_INTERNACAO_M21 } from './internacao-adt.js';
import { PERMISSOES_ENFERMAGEM_M25 } from './enfermagem.js';
import { PERMISSOES_M34 } from './relatorio-integracao.js';
import { PERMISSOES_SUPRIMENTOS_M28 } from './suprimentos.js';
import { PERMISSOES_FARMACIA_M29 } from './farmacia.js';
import { PERMISSOES_FATURAMENTO_M30 } from './faturamento.js';
import { PERMISSOES_FATURAMENTO_M31 } from './faturamento-tiss.js';
import { PERMISSOES_FATURAMENTO_M51 } from './faturamento-sus.js';
import { PERMISSOES_FINANCEIRO_M32 } from './financeiro.js';
import { PERMISSOES_ESCRITURACAO_F38 } from './financeiro-escrituracao.js';
import { PERMISSOES_REPASSE_M33 } from './repasse.js';
import { PERMISSOES_MANUTENCAO_M55_F1 } from './manutencao.js';
import {
  PERMISSOES_CONTABIL_M54_F1,
  PERMISSOES_CONTABIL_M54_F2,
  PERMISSOES_CONTABIL_M54_F3,
} from './contabil.js';
import { PERMISSOES_QUALIDADE_M48 } from './qualidade.js';
import { PERMISSOES_QUALIDADE_CCIH_M48 } from './qualidade-ccih.js';
import { PERMISSOES_QUALIDADE_AGRAVO_M48 } from './qualidade-agravo.js';
import { PERMISSOES_CIRURGIA_CME } from './cirurgia-cme.js';
import { PERMISSOES_PESQUISA_CLINICA } from './pesquisa-clinica.js';
import { PERMISSOES_QUALIDADE_GESTAO_M48 } from './qualidade-gestao.js';
import { PERMISSOES_FOLHA_M53 } from './pessoas-folha.js';
import {
  PERMISSOES_PESSOAS_M52_F1,
  PERMISSOES_PESSOAS_M52_F2,
  PERMISSOES_PESSOAS_M52_F3,
} from './pessoas.js';
import { PERMISSOES_PESSOAS_M52_F5 } from './pessoas-sesmt.js';
import { PERMISSOES_PESSOAS_M52_F4 } from './pessoas-ponto.js';
import { PERMISSOES_PESSOAS_M52_F6 } from './pessoas-f6.js';
import { PERMISSOES_OPERADORA_M56 } from './operadora.js';
import { PERMISSOES_REDE_M57 } from './rede.js';
import { PERMISSOES_REDE_BI_M57 } from './rede-bi.js';
import { PERMISSOES_CUSTOS_M54_F4, PERMISSOES_CUSTOS_M54_F5 } from './custos.js';
import { PERMISSOES_ORCAMENTO_M54_F7 } from './orcamento.js';
import { PERMISSOES_PATRIMONIO_M54_F6 } from './patrimonio.js';
import { PERMISSOES_PORTAL_MEDICO_M50 } from './portal-medico.js';
import { PERMISSOES_PORTAL_M50, PERMISSOES_PORTAL_M50_E2 } from './portal.js';
import { PERMISSOES_TELEMEDICINA_M50 } from './telemedicina.js';
import { PERMISSOES_DOCUMENTO_M49 } from './documento-assinatura.js';
import { PERMISSOES_CLASSIFICACAO_M44 } from './classificacao.js';
import { PERMISSOES_NIR_M44 } from './nir.js';
import { PERMISSOES_PROTOCOLO_GERENCIADO_M44 } from './protocolo-gerenciado.js';
import { PERMISSOES_BALANCO_M45 } from './balanco.js';
import { PERMISSOES_PORTARIA_M50 } from './portaria.js';
import { PERMISSOES_SESSOES_DIGITALIZACAO_M50 } from './sessoes-digitalizacao.js';
import { PERMISSOES_ESCORES_M45 } from './escores.js';
import { PERMISSOES_NUTRICAO_M45 } from './nutricao.js';
import { PERMISSOES_ESPECIALIDADES_M45 } from './especialidades.js';
import { PERMISSOES_SAE_M45 } from './sae.js';
import { PERMISSOES_ANESTESIA_M46 } from './anestesia.js';
import { PERMISSOES_BLOCO_SEGURO_M46 } from './bloco-seguro.js';
import { PERMISSOES_OPME_M46 } from './opme.js';
import { PERMISSOES_CONSIGNADO_MANIPULACAO_M46 } from './consignado-manipulacao.js';
import { PERMISSOES_M58 } from './desligamento.js';
import { PERMISSOES_ROUPARIA_M55 } from './rouparia.js';
import { PERMISSOES_CONTRATO_M55_F3 } from './contrato-fornecedor.js';
import { PERMISSOES_M59 } from './endurecimento.js';
import { PERMISSOES_M59_F2 } from './endurecimento-identidade.js';
import { PERMISSOES_CONTRATUALIZACAO_M55_F5 } from './contratualizacao.js';
import { PERMISSOES_LICITACAO_M55_F4 } from './licitacao.js';
import { PERMISSOES_M59_F4 } from './endurecimento-saneamento.js';
import { PERMISSOES_M59_F5 } from './endurecimento-sbis.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const CATALOGO_DECLARADO: readonly DeclaracaoPermissao[] = [
  ...CATALOGO_ACESSO,
  ...PERMISSOES_CONFIG_COEXISTENCIA,
  ...PERMISSOES_M09,
  ...PERMISSOES_CONFIG_M08,
  ...PERMISSOES_DOMINIOS,
  ...PERMISSOES_CADASTRO_M11,
  ...PERMISSOES_M12,
  ...PERMISSOES_M10,
  ...PERMISSOES_M13,
  ...PERMISSOES_PEP_M15,
  ...PERMISSOES_CONSULTAS_M14,
  ...PERMISSOES_PEP_M22,
  ...PERMISSOES_PEP_M24,
  ...PERMISSOES_M16,
  ...PERMISSOES_AGENDA_M17,
  ...PERMISSOES_PEP_M23,
  ...PERMISSOES_RECEPCAO_M19,
  ...PERMISSOES_AGENDA_EXAME_M18,
  ...PERMISSOES_CIRURGIA_M18,
  ...PERMISSOES_ATENDIMENTO_M20,
  ...PERMISSOES_SADT_M26,
  ...PERMISSOES_PACS_M47,
  ...PERMISSOES_TRANSFUSAO_M47,
  ...PERMISSOES_M27,
  ...PERMISSOES_INTERNACAO_M21,
  ...PERMISSOES_ENFERMAGEM_M25,
  ...PERMISSOES_M34,
  ...PERMISSOES_SUPRIMENTOS_M28,
  ...PERMISSOES_FARMACIA_M29,
  ...PERMISSOES_FATURAMENTO_M30,
  ...PERMISSOES_FATURAMENTO_M31,
  ...PERMISSOES_FINANCEIRO_M32,
  ...PERMISSOES_ESCRITURACAO_F38,
  ...PERMISSOES_REPASSE_M33,
  ...PERMISSOES_MANUTENCAO_M55_F1,
  ...PERMISSOES_CONTABIL_M54_F1,
  ...PERMISSOES_CONTABIL_M54_F2,
  ...PERMISSOES_CONTABIL_M54_F3,
  ...PERMISSOES_QUALIDADE_M48,
  ...PERMISSOES_QUALIDADE_CCIH_M48,
  ...PERMISSOES_QUALIDADE_AGRAVO_M48,
  // F7 (05-SUP linha 29): central de material esterilizado.
  ...PERMISSOES_CIRURGIA_CME,
  // 03-PEP L144: pesquisa clínica.
  ...PERMISSOES_PESQUISA_CLINICA,
  ...PERMISSOES_QUALIDADE_GESTAO_M48,
  ...PERMISSOES_FOLHA_M53,
  ...PERMISSOES_PESSOAS_M52_F1,
  ...PERMISSOES_OPERADORA_M56,
  ...PERMISSOES_REDE_M57,
  ...PERMISSOES_PORTAL_M50,
  ...PERMISSOES_REDE_BI_M57,
  ...PERMISSOES_CUSTOS_M54_F4,
  ...PERMISSOES_ORCAMENTO_M54_F7,
  ...PERMISSOES_CUSTOS_M54_F5,
  ...PERMISSOES_PATRIMONIO_M54_F6,
  ...PERMISSOES_PORTAL_MEDICO_M50,
  ...PERMISSOES_PORTAL_M50_E2,
  ...PERMISSOES_TELEMEDICINA_M50,
  ...PERMISSOES_DOCUMENTO_M49,
  ...PERMISSOES_CLASSIFICACAO_M44,
  ...PERMISSOES_NIR_M44,
  ...PERMISSOES_PROTOCOLO_GERENCIADO_M44,
  ...PERMISSOES_PEP_M45_FORMULARIO_NOVO,
  ...PERMISSOES_BALANCO_M45,
  ...PERMISSOES_PORTARIA_M50,
  ...PERMISSOES_SESSOES_DIGITALIZACAO_M50,
  ...PERMISSOES_ESCORES_M45,
  ...PERMISSOES_NUTRICAO_M45,
  ...PERMISSOES_ESPECIALIDADES_M45,
  ...PERMISSOES_SAE_M45,
  ...PERMISSOES_ANESTESIA_M46,
  ...PERMISSOES_FATURAMENTO_M51,
  ...PERMISSOES_BLOCO_SEGURO_M46,
  ...PERMISSOES_PESSOAS_M52_F2,
  ...PERMISSOES_PESSOAS_M52_F5,
  ...PERMISSOES_PESSOAS_M52_F3,
  ...PERMISSOES_OPME_M46,
  ...PERMISSOES_PESSOAS_M52_F4,
  ...PERMISSOES_CONSIGNADO_MANIPULACAO_M46,
  ...PERMISSOES_CONTRATO_M55_F3,
  ...PERMISSOES_CONTRATUALIZACAO_M55_F5,
  ...PERMISSOES_LICITACAO_M55_F4,
  ...PERMISSOES_M58,
  ...PERMISSOES_ROUPARIA_M55,
  ...PERMISSOES_M59_F2,
  ...PERMISSOES_PESSOAS_M52_F6,
  ...PERMISSOES_M59,
  ...PERMISSOES_M59_F4,
  ...PERMISSOES_M59_F5,
];

/** Perfis complementares do Sante SGH que concedem recursos novos (ficha do M06, regra 3). */
export const PERFIS_COMPLEMENTARES = [
  'administrador-sistema',
  'gestor-acessos',
  'auditor',
  'operador-backup',
  'assistencial-com-conselho',
  // M48: Núcleo de Segurança do Paciente (RDC 36/2013): triagem, Notivisa e o conteúdo das notificações.
  'nucleo-seguranca-paciente',
  // M48 (etapa 3): Comissão de Controle de Infecção Hospitalar (Portaria 2.616/1998): vigilância, IRAS, liberação de
  // antimicrobiano restrito e precauções. Só por concessão nominal ou pelo mapa aprovado.
  'controle-infeccao',
  // M48 (etapa 4): núcleo de vigilância epidemiológica hospitalar (Portaria de consolidação, anexo V): fila de
  // agravos, ficha SINAN e registro da notificação. Quem tem as opções de notificação compulsória do prontuário no
  // outro sistema também recebe (regra do M06).
  'vigilancia-epidemiologica',
  // M48 (etapa 5): escritório da qualidade (gestão documental, indicadores, auditorias, comissões, riscos, não
  // conformidades e envios regulatórios) e ouvidoria (manifestações e NPS). Recursos só do novo (o outro sistema não
  // tem módulo de qualidade nem de ouvidoria): concessão nominal ou pelo mapa aprovado.
  'gestao-qualidade',
  'ouvidoria',
  // F7 (05-SUP linha 29): equipe da central de material esterilizado (RDC 15/2012); concessão nominal ou pelo mapa.
  'central-material-esteril',
  // 03-PEP L144: equipe do centro de pesquisa clínica (Res. CNS 466/2012); concessão nominal ou pelo mapa.
  'pesquisa-clinica',
  /**
   * M44: diretoria clínica (responsável técnico e diretor clínico): publica o protocolo de classificação de risco.
   * Só por concessão nominal da gestão de acessos (SGH_ACESSO_PERFIL_USUARIO) ou pelo mapa aprovado; nenhum grupo
   * nem categoria recebe este perfil sozinho.
   */
  'diretoria-clinica',
  /**
   * M57 (etapa 3): diretoria da Rede: o BI consolidado e o registro dos serviços compartilhados, sem nenhuma permissão
   * do prontuário (regra 10). Só por concessão nominal ou pelo mapa aprovado.
   */
  'diretoria-rede',
  /**
   * M52 (etapa 2): gestor de escala (coordenação de enfermagem ou médica do setor): monta e publica a escala de
   * plantão. Só por concessão nominal da gestão de acessos ou pelo mapa aprovado (a publicação é recurso só do novo).
   */
  'gestor-escala',
  /**
   * M55 (fatia F2): rouparia e lavanderia (encarregado da lavanderia, costureira, auxiliar da rouparia): o enxoval, as
   * cotas e os movimentos, sem a higienização. Só por concessão nominal da gestão de acessos ou pelo mapa aprovado.
   */
  'rouparia',
  /**
   * C1-026 (07-FIN linha 66): cadastro de credores do financeiro: mantém os dados bancários e a chave Pix do credor,
   * separado de quem gera a remessa e de quem paga (segregação de funções). Só por concessão nominal ou pelo mapa aprovado.
   */
  'cadastro-credor',
  /**
   * C2-059 (07-FIN linha 114): emissor da NF-e de saída de mercadoria (devolução ao fornecedor, consignado, remessa para
   * conserto e avulsa): emite, cancela e corrige a nota, separado de quem registra a devolução. Só por concessão nominal
   * ou pelo mapa aprovado.
   */
  'emissor-nota-fiscal',
  /**
   * C1-040 (06-FAT linha 9): de-para do faturamento: inclui e encerra o de-para do item do hospital para o código da
   * fonte pagadora, sem editar o contrato do convênio (segregação de funções). Só por concessão nominal ou pelo mapa
   * aprovado.
   */
  'faturamento-de-para',
  /**
   * C1-092 (05-SADT linha 14): laboratório de apoio: monta, fecha, envia e cancela a remessa de amostras, imprime as
   * etiquetas do apoio e mantém o de-para de analito e de material, sem conferir o resultado que volta (privativo do
   * responsável técnico habilitado). Só por concessão nominal da gestão de acessos ou pelo mapa aprovado.
   */
  'laboratorio-apoio',
  /**
   * C1-114 (06-FAT linha 22): protocolo de documentos entre setores (faturamento, arquivo e prontuário, recepção e
   * demais setores que emitem ou recebem): emite, envia, confere item a item e cancela o protocolo do setor, sem o
   * protocolo do lote da operadora. Só por concessão nominal da gestão de acessos ou pelo mapa aprovado.
   */
  'protocolo-documentos',
  /**
   * C1-084 (07-FIN linha 92): aprovador da devolução do adiantamento ao paciente (tesouraria ou supervisão do caixa):
   * aprova o pedido feito no caixa por outra pessoa e registra o identificador da transação, separado de quem aprova
   * adiantamento a fornecedor ou médico (segregação de funções). Só por concessão nominal ou pelo mapa aprovado.
   */
  'aprovador-devolucao-paciente',
] as const;
export type PerfilComplementar = (typeof PERFIS_COMPLEMENTARES)[number];
