<script setup lang="ts">
// Tela da TV dos painéis operacionais (01-REL L116). Duas entradas: /relatorios/paineis-tv/:id/tela (prévia de quem
// edita o painel) e /tv/operacional (o televisor: digita o código de pareamento uma vez e recebe o segredo do
// aparelho, guardado aqui; a tela e o aviso de "no ar" a cada 5 minutos vão pelo televisor com esse segredo). Televisor
// desligado no cadastro é recusado pelo servidor (404) e a TV volta ao pareamento, sem mostrar mais nada. Os blocos
// alternam pelo tempo de cada um e se desenham na forma escolhida no cadastro: tabela, lista compacta ou mapa (grade de
// leitos ou salas com o estado em cor). Nenhum nome de paciente: só iniciais, números e tempos (LGPD).
import { useMutation, useQuery } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { avisarContato, lerTelaTelevisor, lerTelaTv, parearTelevisor } from '../api-paineis-tv.js';
import { mensagensPaineisTv } from '../i18n-paineis-tv.js';

const props = defineProps<{ id?: string }>();
const { t } = useI18n({ useScope: 'local', messages: mensagensPaineisTv });
const CHAVE = 'sgh.tv-operacional';

interface Guardado {
  painel: number;
  tv: number;
  segredo: string;
}
function lerGuardado(): Guardado | null {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? 'null') as Partial<Guardado> | null;
    return v && v.painel && v.tv && v.segredo ? { painel: v.painel, tv: v.tv, segredo: v.segredo } : null;
  } catch {
    return null;
  }
}
const guardado = ref<Guardado | null>(props.id ? null : lerGuardado());
const painelId = computed(() => (props.id ? Number(props.id) : (guardado.value?.painel ?? null)));
/** O servidor recusou o televisor (desligado no cadastro ou segredo que não vale mais). */
const desligado = ref(false);
const recusado = (e: unknown) => e instanceof ErroApi && (e.status === 404 || e.status === 403);

const intervalo = ref(60_000);
const tela = useQuery({
  queryKey: computed(() => ['paineis-tv', 'tela', props.id ?? null, guardado.value?.tv ?? null]),
  queryFn: () =>
    props.id ? lerTelaTv(Number(props.id)) : lerTelaTelevisor(guardado.value!.tv, guardado.value!.segredo),
  enabled: computed(() => painelId.value !== null),
  refetchInterval: intervalo,
  retry: (n, e) => !recusado(e) && n < 1,
});
watch(
  () => tela.error.value,
  (e) => {
    if (guardado.value && recusado(e)) esquecer(true);
  },
);
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
  const g = guardado.value;
  if (!g) return;
  avisarContato(g.tv, g.segredo).catch((e: unknown) => {
    // Recusa: o televisor foi desligado; falha de rede: tenta de novo no próximo aviso.
    if (recusado(e)) esquecer(true);
  });
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
    const g = { painel: r.painelId, tv: r.id, segredo: r.segredo };
    try {
      localStorage.setItem(CHAVE, JSON.stringify(g));
    } catch {
      // Sem armazenamento: a TV segue pareada só nesta sessão.
    }
    guardado.value = g;
    desligado.value = false;
    codigo.value = '';
  },
});
function esquecer(porRecusa = false) {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // nada a limpar
  }
  guardado.value = null;
  desligado.value = porRecusa;
}
const trocar = () => esquecer();

/** Linhas do mapa: o primeiro campo é o rótulo do quadro (leito ou sala), os demais vão abaixo. */
const detalhesDoQuadro = (
  colunas: readonly { campo: string; rotulo: string }[],
  l: Record<string, string | number | null>,
) =>
  colunas
    .slice(1)
    .map((c) => l[c.campo])
    .filter((v) => v !== null && v !== undefined && v !== '');
const ESTADOS = ['livre', 'ocupado', 'prevista', 'atrasada', 'em_sala', 'realizada', 'no_prazo', 'atrasado'];
const estadoDe = (l: Record<string, string | number | null>) =>
  typeof l['estado'] === 'string' && ESTADOS.includes(l['estado']) ? l['estado'] : null;
const legenda = computed(() => {
  const b = bloco.value;
  if (!b) return [];
  return ESTADOS.filter((e) => b.linhas.some((l) => l['estado'] === e));
});
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
      <p v-if="desligado" role="alert" data-testid="tvo-desligado">{{ t('tv.desligado') }}</p>
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
        <section
          v-else
          :aria-label="bloco.titulo"
          :data-testid="`tvo-bloco-${bloco.fonte}`"
          :data-forma="bloco.forma"
        >
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
          <template v-else-if="bloco.forma === 'mapa'">
            <ul class="tvo-mapa" data-testid="tvo-mapa">
              <li
                v-for="(l, i) in bloco.linhas"
                :key="i"
                class="tvo-quadro"
                :class="estadoDe(l) ? `tvo-estado-${estadoDe(l)}` : ''"
                :data-estado="estadoDe(l) ?? undefined"
                data-testid="tvo-quadro"
              >
                <strong>{{ l[bloco.colunas[0]?.campo ?? ''] ?? '—' }}</strong>
                <span v-for="(v, j) in detalhesDoQuadro(bloco.colunas, l)" :key="j">{{ v }}</span>
                <span v-if="estadoDe(l)" class="tvo-estado-rotulo">{{ t(`tv.estados.${estadoDe(l)}`) }}</span>
              </li>
            </ul>
            <ul v-if="legenda.length" class="tvo-legenda" :aria-label="t('tv.legenda')">
              <li v-for="e in legenda" :key="e" :class="`tvo-estado-${e}`">{{ t(`tv.estados.${e}`) }}</li>
            </ul>
          </template>
          <ol v-else-if="bloco.forma === 'lista'" class="tvo-lista" data-testid="tvo-lista">
            <li
              v-for="(l, i) in bloco.linhas"
              :key="i"
              :class="estadoDe(l) ? `tvo-estado-${estadoDe(l)}` : ''"
              :data-estado="estadoDe(l) ?? undefined"
            >
              <template v-for="(c, j) in bloco.colunas" :key="c.campo">
                <span v-if="j > 0" aria-hidden="true"> · </span>
                <span :class="j === 0 ? 'tvo-lista-chave' : ''">{{ l[c.campo] ?? '—' }}</span>
              </template>
            </li>
          </ol>
          <table v-else data-testid="tvo-tabela">
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
              <tr
                v-for="(l, i) in bloco.linhas"
                :key="i"
                :class="estadoDe(l) === 'atrasada' || estadoDe(l) === 'atrasado' ? 'tvo-linha-atraso' : ''"
              >
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
.tvo-mapa {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  gap: var(--sgh-espaco-3);
  list-style: none;
  padding: 0;
}
.tvo-quadro {
  display: grid;
  gap: var(--sgh-espaco-1);
  padding: var(--sgh-espaco-3);
  border: 2px solid var(--sgh-borda);
  border-radius: 0.5rem;
  background: var(--sgh-fundo-sutil);
}
.tvo-quadro strong {
  font-size: 2rem;
}
.tvo-estado-rotulo {
  font-weight: 600;
}
.tvo-estado-livre,
.tvo-estado-realizada,
.tvo-estado-no_prazo {
  border-color: var(--sgh-sucesso);
}
.tvo-estado-ocupado,
.tvo-estado-em_sala,
.tvo-estado-prevista {
  border-color: var(--sgh-primaria);
}
.tvo-estado-atrasada,
.tvo-estado-atrasado {
  border-color: var(--sgh-alerta);
  background: var(--sgh-alerta-suave);
}
.tvo-legenda {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  list-style: none;
  padding: 0;
  font-size: 1.1rem;
}
.tvo-legenda li {
  border-inline-start: 0.6rem solid var(--sgh-borda);
  padding-inline-start: var(--sgh-espaco-2);
}
.tvo-lista {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-1);
}
.tvo-lista li {
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-inline-start: 0.4rem solid var(--sgh-borda);
}
.tvo-lista-chave {
  font-weight: 700;
}
.tvo-linha-atraso td {
  background: var(--sgh-alerta-suave);
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
