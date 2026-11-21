// Módulo config (configuração por estabelecimento, CRUD genérico e saúde da implantação). Outros módulos falam com
// este só por aqui.
// M04: saúde das conexões; contagens do executor do processo.
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
export {
  FONTE_DOMINIOS,
  type FonteDominios,
  FonteDominiosPropria,
  fonteDominiosIndisponivel,
  fonteDominiosMemoria,
} from './dominios-fonte.js';
export { ParametrosController } from './parametros.controller.js';
export { LiberacaoController } from './liberacao.controller.js';
export {
  CATALOGO_OPERACOES,
  type CatalogoOperacoesLiberacao,
  catalogoOperacoesProprio,
} from './catalogo-operacoes.js';
export {
  type AvaliadorLigarSetor,
  CRITERIO_LIGAR_SETOR,
  type CriterioLigarSetor,
  criterioLigarSetor,
  type MapaRegra1,
} from './criterio-ligar.js';
export {
  type ChaveLiberacao,
  destinoNoContrato,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  fonteConfiguracaoIndisponivel,
  type PrerequisitoRecurso,
  type TrilhaConfig,
  chavesIniciaisSinteticas,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
  fonteConfiguracaoMemoria,
} from './configuracao-fonte.js';
export { FonteConfiguracaoPropria } from './configuracao-propria.js';
export {
  CACHE_CONFIG,
  CacheConfig,
  TTL_BUSCA_PRESCRICAO_S,
  TTL_CONFIG_NOVO_S,
  TTL_CONVENIOS_S,
} from './cache-config.js';
// M38: onda 0 (situação das telas e sondas da implantação).
export { Onda0Controller } from './onda0.controller.js';
export { PORTA_ONDA0, type PortaOnda0, portaOnda0Memoria, portaOnda0Propria } from './onda0.js';
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
