import { criarI18n, instalarUi, resolverMarca } from '@sgh/ui';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { buscarMarca } from './api.js';
import CascaApp from './casca/CascaApp.vue';
import { CHAVE_SESSAO } from './casca/sessao/sessao.js';
import { usarPreferencias } from './casca/preferencias/preferencias.js';
import { CHAVE_MARCA } from './configuracao.js';
import { buscarSessao } from './api.js';
import { mensagensWeb } from './i18n/pt-BR.js';
import { diretivaPode } from './casca/sessao/pode.js';
import { criarRoteador } from './roteador.js';

// Nome do produto e marca vêm da configuração da rede (GET /api/marca; DP-49). Sem resposta ou com um
// pacote não registrado, a casca abre com o nome técnico e a marca NEUTRA (selo "marca não configurada"),
// nunca com a marca de outra rede, e avisa no console.
// "Sem resposta" tem prazo: a montagem da casca espera esta leitura, e um pedido parado deixava a página em branco
// (nem a tela de entrada aparecia).
const PRAZO_MARCA_MS = 5_000;
const marca = await buscarMarca((url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(PRAZO_MARCA_MS) }),
).catch(() => null);
const { pacote, conhecida } = resolverMarca(marca?.marca);
if (!conhecida) console.warn('[sgh] pacote de marca não registrado; usando a marca neutra');
const produto = marca?.produto ?? 'SGH';

// Cache curto e releitura ao voltar ao foco: o legado grava nos mesmos dados (roteiro, seção 3.2).
const cliente = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
});
const app = createApp(CascaApp, { pacote, produto, treino: marca?.treino === true });
app.use(criarI18n(mensagensWeb as unknown as Record<string, unknown>));
app.use(createPinia());
app.use(VueQueryPlugin, { queryClient: cliente });
app.use(
  criarRoteador(() => cliente.ensureQueryData({ queryKey: CHAVE_SESSAO, queryFn: () => buscarSessao() })),
);
app.provide(CHAVE_MARCA, { produto, pacote });
app.directive('pode', diretivaPode);
instalarUi(app, pacote);
usarPreferencias();
app.mount('#app');
