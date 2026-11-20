// Fixture de teste: nome provisório do produto (DP-49), passado à API pelo ambiente do webServer.
export const PRODUTO_NOME_E2E = 'Sante SGH (E2E)';

/** Estabelecimento sintético fora do ar (código:nome), só na fonte sintética de dev/ci (ARQ-1). */
export const ESTABELECIMENTO_FORA_E2E = 'zz:Estabelecimento sintético fora do ar';

/** M57 (etapa 1): o segundo estabelecimento SINTÉTICO da rede (código:nome), só no MPI da Rede em memória (dev/ci). */
export const ESTABELECIMENTO_REDE_E2E = 'sx:Estabelecimento sintético da rede';

/** M58 (etapa 4): a chave principal sintética da fachada da API de integração no servidor do E2E. */
export const FACHADA_TOKEN_E2E = 'e2e-fachada-chave-sintetica';
