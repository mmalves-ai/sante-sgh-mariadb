// Módulo config (M02: coexistência com o legado). Outros módulos falam com este só por aqui.
export { CoexistenciaController } from './coexistencia.controller.js';
export { FONTE_COEXISTENCIA, type FonteCoexistencia } from './fonte.js';
export { AssinaturasController } from './assinaturas.controller.js';
export {
  caminhosPadrao,
  FONTE_ASSINATURAS,
  fonteArquivosAssinatura,
  type FonteAssinaturas,
} from './assinaturas.js';
// M04: conferência de gravação e saúde das conexões; contagens do executor do processo.
export { GravacaoController } from './gravacao.controller.js';
export {
  criarFonteGravacao,
  FONTE_GRAVACAO,
  METRICAS_EXECUTOR,
  type FonteGravacao,
  type NucleoLeitura,
} from './gravacao.js';
// M08: CRUD genérico, parâmetros hierárquicos e funcionalidades por estabelecimento (POL-3).
export { DominiosController, problemaDaGravacao } from './dominios.controller.js';
// Revisão do W0-02: o despertar da vigia de reconciliação dos cadastros.
export {
  INTERVALO_VIGIA_RECONCILIACAO_MS,
  VIGIA_RECONCILIACAO,
  VigiaReconciliacaoCrud,
} from './vigia-reconciliacao.js';
export {
  FONTE_DOMINIOS,
  type FonteDominios,
  fonteDominiosIndisponivel,
  fonteDominiosLegado,
  fonteDominiosMemoria,
} from './dominios-fonte.js';
export { ParametrosController } from './parametros.controller.js';
export { CAMINHO_CATALOGO_LIBERACAO, LiberacaoController } from './liberacao.controller.js';
export {
  type AvaliadorLigarSetor,
  CRITERIO_LIGAR_SETOR,
  type CriterioLigarSetor,
  criterioLigarSetor,
  type MapaRegra1,
} from './criterio-ligar.js';
export {
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  fonteConfiguracaoIndisponivel,
  fonteConfiguracaoLegado,
  chavesIniciaisSinteticas,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
  fonteConfiguracaoMemoria,
} from './configuracao-fonte.js';
export {
  CACHE_CONFIG,
  CacheConfig,
  TTL_BUSCA_PRESCRICAO_S,
  TTL_CONFIG_NOVO_S,
  TTL_CONVENIOS_S,
} from './cache-config.js';
// M38: onda 0 (situação das telas, vigilância diária e sondas da implantação).
export { Onda0Controller } from './onda0.controller.js';
export { PORTA_ONDA0, type PortaOnda0, portaOnda0Legado, portaOnda0Memoria } from './onda0.js';
// M36: painel da homologação sobre a cópia (gerado por `pnpm homologacao:roteiro`).
export { HomologacaoController } from './homologacao.controller.js';
export {
  caminhoHomologacao,
  FONTE_HOMOLOGACAO,
  fonteArquivoHomologacao,
  type FonteHomologacao,
} from './homologacao.js';
// M35: prontidão por setor e a carga somada (relatório gerado por `pnpm prontidao:relatorio`).
export { ProntidaoController } from './prontidao.controller.js';
export {
  caminhoProntidao,
  FONTE_PRONTIDAO,
  fonteArquivoProntidao,
  type FonteProntidao,
} from './prontidao.js';
export { chaveDeRecursoNaSessao } from './chave-recurso.js';
