<script setup lang="ts">
// Painel de chamada (TV; M19; ficha, seção 7, regras 6, 9 e 12): a senha chamada agora em destaque (senha, guichê
// ou local, nunca o nome — no máximo as iniciais, se a configuração pedir), as últimas chamadas e a hora. O
// servidor avisa cada chamada pelo canal de eventos (feitas aqui logo após a gravação; feitas em outro terminal
// pelo vigia) e a tela relê; sem canal, relê a cada 10 s. A voz (fala sintetizada do navegador) precisa de um
// toque para ser ativada (regra dos navegadores). Sem conexão, o aviso fica em destaque com a hora da última leitura.
import type { ChamadaPainel } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { canalDoPainel, lerPainel, tokenDoAparelho } from '../api-recepcao.js';
import { chamadasNovas, FilaDeVoz, sintetizadorDoNavegador } from '../fila-voz.js';
import { horaDe } from '../formato.js';

const props = defineProps<{ dispositivo: string }>();
const { t } = useI18n();
const token = tokenDoAparelho(props.dispositivo);
const conectado = ref(false);
const painel = useQuery({
  queryKey: ['painel', props.dispositivo],
  queryFn: () => lerPainel(token as string),
  enabled: token !== null,
  refetchInterval: computed(() => (conectado.value ? 30_000 : 10_000)),
  retry: false,
});
let canal: EventSource | null = null;
let reabrir: ReturnType<typeof setTimeout> | undefined;
function fecharCanal(): void {
  canal?.close();
  canal = null;
  conectado.value = false;
}
// O bilhete serve uma vez: cada leitura traz um novo, e o canal reabre com ele quando cai.
watch(
  () => painel.data.value?.bilhete,
  (b) => {
    if (!b || canal || typeof EventSource === 'undefined') return;
    const es = new EventSource(canalDoPainel(b));
    canal = es;
    es.onopen = () => (conectado.value = true);
    es.addEventListener('chamada', () => void painel.refetch());
    es.onerror = () => {
      fecharCanal();
      clearTimeout(reabrir);
      reabrir = setTimeout(() => void painel.refetch(), 3_000);
    };
  },
);

const agora = ref(Date.now());
let relogio: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  relogio = setInterval(() => (agora.value = Date.now()), 1_000);
});
onBeforeUnmount(() => {
  clearInterval(relogio);
  clearTimeout(reabrir);
  fecharCanal();
});
const hora = computed(() =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(agora.value),
);
/** Sem leitura boa há mais de 30 s: o painel avisa em destaque. */
const semConexao = computed(
  () =>
    painel.isError.value &&
    (painel.dataUpdatedAt.value === 0 || agora.value - painel.dataUpdatedAt.value > 30_000),
);
const ultimaLeitura = computed(() =>
  painel.dataUpdatedAt.value
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(painel.dataUpdatedAt.value)
    : '—',
);
const recusado = computed(() => {
  const e = painel.error.value;
  return e instanceof ErroApi && (e.status === 401 || e.status === 403);
});

// ── Voz ── (cada chamada nova falada uma vez, em fila: duas na mesma leitura saem as duas, na ordem)
const vozAtiva = ref(false);
const temVoz = typeof globalThis.speechSynthesis !== 'undefined';
const voz = new FilaDeVoz(sintetizadorDoNavegador());
function ativarVoz(): void {
  vozAtiva.value = true;
  voz.enfileirar(t('recepcao.painel.vozAtiva'));
}
const atual = computed<ChamadaPainel | null>(() => painel.data.value?.atual ?? null);
const faladas = new Set<string>();
let primeiraLeitura = true;
watch(
  () => painel.data.value?.ultimas,
  (lista) => {
    if (!lista) return;
    const novas = chamadasNovas(faladas, lista);
    // A primeira leitura só conhece as chamadas que já estavam no painel (nada é falado de novo ao abrir a tela).
    if (primeiraLeitura) {
      primeiraLeitura = false;
      return;
    }
    if (vozAtiva.value && painel.data.value?.voz && novas.length > 0)
      voz.enfileirar(...novas.map((c) => c.fala));
  },
);
const destino = (c: ChamadaPainel) => c.destino;
</script>

<template>
  <main class="painel-tv" data-testid="painel-chamada">
    <p v-if="!token" class="mensagem-grande" role="alert">{{ t('recepcao.painel.naoConfigurado') }}</p>
    <p v-else-if="recusado" class="mensagem-grande" role="alert" data-testid="painel-fora">
      {{ t('recepcao.painel.foraDeServico') }}
    </p>
    <template v-else>
      <header class="topo">
        <span>{{ painel.data.value?.nome ?? '' }}</span>
        <span :aria-label="t('recepcao.painel.relogio')" class="relogio">{{ hora }}</span>
      </header>
      <p v-if="semConexao" class="sem-conexao" role="alert" data-testid="painel-sem-conexao">
        {{ t('recepcao.painel.semConexao', { hora: ultimaLeitura }) }}
      </p>
      <section class="destaque" aria-live="assertive" aria-atomic="true" data-testid="painel-atual">
        <h1 class="visualmente-oculto">{{ t('recepcao.painel.chamando') }}</h1>
        <template v-if="atual">
          <p class="rotulo">{{ t('recepcao.painel.chamando') }}</p>
          <p class="senha-tv" data-testid="painel-senha">{{ atual.texto }}</p>
          <p class="destino" data-testid="painel-destino">{{ destino(atual) }}</p>
          <p v-if="atual.iniciais" class="iniciais">{{ atual.iniciais }}</p>
        </template>
        <p v-else class="rotulo">{{ t('recepcao.painel.semChamada') }}</p>
      </section>
      <section v-if="painel.data.value?.ultimas.length" class="ultimas" aria-labelledby="painel-ultimas">
        <h2 id="painel-ultimas">{{ t('recepcao.painel.ultimas') }}</h2>
        <ol>
          <li v-for="c in painel.data.value.ultimas" :key="c.chave">
            <strong>{{ c.texto }}</strong> · {{ destino(c) }} · {{ horaDe(c.em) }}
          </li>
        </ol>
      </section>
      <footer class="rodape">
        <span v-if="painel.data.value">{{ t('recepcao.painel.atualizado', { hora: ultimaLeitura }) }}</span>
        <button
          v-if="painel.data.value?.voz && temVoz && !vozAtiva"
          type="button"
          data-testid="ativar-voz"
          @click="ativarVoz"
        >
          {{ t('recepcao.painel.ativarVoz') }}
        </button>
        <span v-else-if="vozAtiva">{{ t('recepcao.painel.vozAtiva') }}</span>
      </footer>
    </template>
  </main>
</template>

<style scoped>
.painel-tv {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  padding: var(--sgh-espaco-3);
  font-size: 1.5rem;
}
.topo,
.rodape {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--sgh-espaco-3);
}
.relogio {
  font-size: 2.5rem;
  font-weight: 700;
}
.destaque {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  border: 4px solid var(--sgh-primaria);
  border-radius: 12px;
  margin: var(--sgh-espaco-3) 0;
  text-align: center;
}
.rotulo {
  font-size: 2rem;
  margin: 0;
}
.senha-tv {
  font-size: 9rem;
  font-weight: 700;
  margin: 0;
  line-height: 1.1;
}
.destino {
  font-size: 3.5rem;
  font-weight: 700;
  margin: 0;
}
.iniciais {
  font-size: 2rem;
}
.ultimas ol {
  list-style: none;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  font-size: 2rem;
}
.sem-conexao {
  background: var(--sgh-alerta);
  color: var(--sgh-fundo);
  font-weight: 700;
  font-size: 2rem;
  padding: var(--sgh-espaco-2);
  text-align: center;
  margin: 0;
}
.mensagem-grande {
  font-size: 2rem;
  font-weight: 700;
  text-align: center;
}
button {
  font: inherit;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  border: 2px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
  cursor: pointer;
}
.visualmente-oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
