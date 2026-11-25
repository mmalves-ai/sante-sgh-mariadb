<script setup lang="ts">
// Tela da TV dos painéis operacionais (01-REL L116). Duas entradas: /relatorios/paineis-tv/:id/tela (ver como a TV
// mostra) e /tv/operacional (o televisor: digita o código de pareamento uma vez; o painel e o televisor ficam guardados
// neste aparelho e a TV avisa que está no ar a cada 5 minutos). Os blocos alternam pelo tempo de cada um e os dados
// se renovam pela atualização do painel. Nenhum nome de paciente: só iniciais, números e tempos (LGPD).
import { useMutation, useQuery } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { avisarContato, lerTelaTv, parearTelevisor } from '../api-paineis-tv.js';
import { mensagensPaineisTv } from '../i18n-paineis-tv.js';

const props = defineProps<{ id?: string }>();
const { t } = useI18n({ useScope: 'local', messages: mensagensPaineisTv });
const CHAVE = 'sgh.tv-operacional';

function lerGuardado(): { painel: number; tv: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? 'null') as { painel?: number; tv?: number } | null;
    return v && v.painel && v.tv ? { painel: v.painel, tv: v.tv } : null;
  } catch {
    return null;
  }
}
const guardado = ref(props.id ? null : lerGuardado());
const painelId = computed(() => (props.id ? Number(props.id) : (guardado.value?.painel ?? null)));

const intervalo = ref(60_000);
const tela = useQuery({
  queryKey: computed(() => ['paineis-tv', 'tela', painelId.value]),
  queryFn: () => lerTelaTv(painelId.value as number),
  enabled: computed(() => painelId.value !== null),
  refetchInterval: intervalo,
  retry: 1,
});
watch(
  () => tela.data.value?.atualizacaoSegundos,
  (s) => {
    if (s) intervalo.value = s * 1000;
  },
);

// Rotação dos blocos pelo tempo de cada um.
const atual = ref(0);
let relogio: ReturnType<typeof setTimeout> | undefined;
function agendar() {
  clearTimeout(relogio);
  const blocos = tela.data.value?.blocos ?? [];
  if (blocos.length < 2) return;
  const b = blocos[atual.value % blocos.length]!;
  relogio = setTimeout(() => {
    atual.value = (atual.value + 1) % blocos.length;
    agendar();
  }, b.tempoEmTelaSegundos * 1000);
}
watch(() => tela.data.value?.blocos.length, agendar, { immediate: true });
const bloco = computed(() => {
  const bs = tela.data.value?.blocos ?? [];
  return bs.length ? bs[atual.value % bs.length]! : null;
});

// Contato do televisor pareado (a cada 5 minutos).
let contato: ReturnType<typeof setInterval> | undefined;
function avisar() {
  if (guardado.value) void avisarContato(guardado.value.tv).catch(() => undefined);
}
watch(
  guardado,
  (g) => {
    clearInterval(contato);
    if (g) contato = setInterval(avisar, 300_000);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  clearTimeout(relogio);
  clearInterval(contato);
});

const codigo = ref('');
const parear = useMutation({
  mutationFn: () => parearTelevisor(codigo.value),
  onSuccess: (r) => {
    const g = { painel: r.painelId, tv: r.id };
    try {
      localStorage.setItem(CHAVE, JSON.stringify(g));
    } catch {
      // Sem armazenamento: a TV segue pareada só nesta sessão.
    }
    guardado.value = g;
    codigo.value = '';
  },
});
function trocar() {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // nada a limpar
  }
  guardado.value = null;
}
const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const telaCheia = () => void document.documentElement.requestFullscreen?.().catch(() => undefined);
</script>

<template>
  <main class="tvo" data-testid="tela-tv-operacional">
    <form
      v-if="painelId === null"
      class="tvo-parear"
      data-testid="tvo-parear"
      @submit.prevent="parear.mutate()"
    >
      <h1>{{ t('tv.parearTitulo') }}</h1>
      <p>{{ t('tv.parearTexto') }}</p>
      <input
        v-model="codigo"
        class="tvo-codigo"
        maxlength="8"
        autocomplete="off"
        :aria-label="t('codigo')"
        data-testid="tvo-codigo"
      />
      <button
        type="submit"
        :disabled="codigo.trim().length < 6 || parear.isPending.value"
        data-testid="tvo-parear-enviar"
      >
        {{ t('tv.parear') }}
      </button>
      <MensagemErro v-if="parear.isError.value" :erro="parear.error.value" />
    </form>
    <template v-else>
      <MensagemErro v-if="tela.isError.value && !tela.data.value" :erro="tela.error.value" />
      <p v-else-if="!tela.data.value" role="status">{{ t('tv.carregando') }}</p>
      <template v-else>
        <header class="tvo-topo">
          <h1>{{ tela.data.value.nome }}</h1>
          <span v-if="tela.isError.value" role="alert">{{
            t('tv.semConexao', { hora: hora(tela.data.value.atualizadoEm) })
          }}</span>
          <span v-else>{{ t('tv.atualizado', { hora: hora(tela.data.value.atualizadoEm) }) }}</span>
          <button type="button" @click="telaCheia">{{ t('tv.telaCheia') }}</button>
          <button v-if="guardado" type="button" @click="trocar">{{ t('tv.trocar') }}</button>
        </header>
        <p v-if="tela.data.value.situacao !== 'ativo'" class="tvo-grande" role="status">
          {{ t('tv.inativo') }}
        </p>
        <p v-else-if="!bloco" class="tvo-grande" role="status">{{ t('tv.semBlocos') }}</p>
        <section v-else :aria-label="bloco.titulo" :data-testid="`tvo-bloco-${bloco.fonte}`">
          <h2>
            {{ bloco.titulo }}
            <small>{{
              t('tv.bloco', {
                n: (atual % tela.data.value.blocos.length) + 1,
                total: tela.data.value.blocos.length,
              })
            }}</small>
          </h2>
          <ul class="tvo-resumo">
            <li v-for="r in bloco.resumo" :key="r.rotulo">
              <strong>{{ r.valor }}</strong> {{ r.rotulo }}
            </li>
          </ul>
          <p v-if="bloco.linhas.length === 0" class="tvo-grande">{{ t('tv.semLinhas') }}</p>
          <table v-else>
            <caption class="visualmente-oculto">
              {{
                bloco.titulo
              }}
            </caption>
            <thead>
              <tr>
                <th v-for="c in bloco.colunas" :key="c.campo" scope="col">{{ c.rotulo }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in bloco.linhas" :key="i">
                <td v-for="c in bloco.colunas" :key="c.campo">{{ l[c.campo] ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </template>
  </main>
</template>

<style scoped>
.tvo {
  min-height: 100vh;
  padding: var(--sgh-espaco-4);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  font-size: 1.5rem;
}
.tvo-topo {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: baseline;
}
.tvo-resumo {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-4);
  list-style: none;
  padding: 0;
}
.tvo-resumo strong {
  font-size: 2.5rem;
  color: var(--sgh-primaria);
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: start;
  padding: var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.tvo-grande {
  font-size: 2rem;
  color: var(--sgh-texto-secundario);
}
.tvo-parear {
  display: grid;
  gap: var(--sgh-espaco-3);
  max-width: 30rem;
  margin: 10vh auto;
}
.tvo-codigo {
  font-size: 3rem;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  text-align: center;
}
</style>
