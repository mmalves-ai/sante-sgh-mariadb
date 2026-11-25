<script setup lang="ts">
// Lista de coleta, etiquetas e mapa de trabalho (ficha do M26, seção 7): `/sadt/coleta` e `/sadt/mapa-trabalho`. Os
// pedidos do laboratório a coletar por paciente e tubo; a coleta exige os dois identificadores conferidos e, no
// internado, a leitura da pulseira (meta 1 de segurança; regra 3): a amostra nasce com o código único e a etiqueta vai à
// impressora da estação. A lista se filtra por unidade (as do dia com pedido a coletar) e pela janela de coleta (a
// previsão), com o teto de 500 linhas. O mapa de trabalho mostra os recebidos a digitar por bancada, os urgentes primeiro.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { reterExame, soltarExame } from '../api-mapa-trabalho.js';
import { coletarAmostra, lerColeta, lerMapaTrabalho, novaChave } from '../api-sadt.js';
import AvisoSadt from '../componentes/AvisoSadt.vue';
import ErroSadt from '../componentes/ErroSadt.vue';
import LotesTrabalhoPainel from '../componentes/LotesTrabalhoPainel.vue';
import PacienteSadt from '../componentes/PacienteSadt.vue';
import { hojeLocal, quando, usarSadt } from '../usar-sadt.js';

const { t } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const mapa = computed(() => rota.path.endsWith('mapa-trabalho'));
const data = ref(hojeLocal());
const { gravacao, pode } = usarSadt();
const unidade = ref('');
const deHora = ref('');
const ateHora = ref('');
const coleta = useQuery({
  queryKey: computed(() => ['sadt', 'coleta', data.value, unidade.value, deHora.value, ateHora.value]),
  queryFn: () =>
    lerColeta(data.value, {
      unidade: unidade.value ? Number(unidade.value) : null,
      de: deHora.value || null,
      ate: ateHora.value || null,
    }),
  enabled: computed(() => !mapa.value),
});
const unidades = computed(() => [
  { valor: '', rotulo: t('sadt.coleta.todasUnidades') },
  ...(coleta.data.value?.unidades ?? []).map((u) => ({
    valor: String(u.codigo),
    rotulo: t('sadt.coleta.unidade', { codigo: u.codigo, n: u.exames }),
  })),
]);
const trabalho = useQuery({
  queryKey: computed(() => ['sadt', 'mapa', data.value]),
  queryFn: () => lerMapaTrabalho('laboratorio', data.value),
  enabled: mapa,
});
// Retenção na bancada: o motivo na própria linha do exame, sem sair do mapa (um clique para devolver à fila).
const motivoReter = ref<Record<number, string>>({});
// Os retidos vêm à parte (fora da fila e do lote): aparecem depois dos exames a processar, sem o link da digitação.
const retidoDe = (b: { retidos?: { id: number; motivo: string }[] | undefined }, id: number) =>
  b.retidos?.find((r) => r.id === id)?.motivo ?? null;
async function alternarRetencao(id: number, retido: boolean): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    if (retido) {
      await soltarExame(id, novaChave('soltar'));
      mensagem.value = t('sadt.coleta.soltoOk');
    } else {
      const r = await reterExame(id, (motivoReter.value[id] ?? '').trim(), novaChave('reter'));
      mensagem.value = t('sadt.coleta.retidoOk', { lote: r.lote });
      motivoReter.value[id] = '';
    }
    await cliente.invalidateQueries({ queryKey: ['sadt', 'mapa'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const motivoRastreio = computed(() =>
  gravacao.data.value && !gravacao.data.value.rastreio.ligada ? gravacao.data.value.rastreio.motivo : null,
);
const podeColetar = computed(() => pode('rastreio', 'coletar'));
const pulseira = ref<Record<number, string>>({});
const conferido = ref<Record<number, boolean>>({});
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function coletar(indice: number): Promise<void> {
  const g = coleta.data.value?.grupos[indice];
  if (!g) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await coletarAmostra(
      {
        exames: g.exames.filter((e) => !e.coletado).map((e) => e.id),
        ...(pulseira.value[indice]?.trim() ? { pulseira: pulseira.value[indice]?.trim() } : {}),
        identificadoresConferidos: conferido.value[indice] === true,
        ...(g.recipiente ? { recipiente: g.recipiente.codigo } : {}),
      },
      novaChave('coletar'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['sadt'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="coleta-titulo" data-testid="tela-sadt-coleta">
    <h1 id="coleta-titulo">{{ mapa ? t('sadt.coleta.mapa') : t('sadt.coleta.titulo') }}</h1>
    <p>{{ t('sadt.coleta.texto') }}</p>
    <AvisoSadt :motivo="motivoRastreio" />
    <nav class="acoes" :aria-label="t('sadt.coleta.titulo')">
      <RouterLink to="/sadt/coleta">{{ t('sadt.coleta.titulo') }}</RouterLink>
      <RouterLink to="/sadt/mapa-trabalho" data-testid="link-mapa">{{ t('sadt.coleta.mapa') }}</RouterLink>
      <RouterLink to="/sadt/amostras">{{ t('sadt.amostras.titulo') }}</RouterLink>
    </nav>
    <div class="filtros">
      <span class="campo">
        <label for="coleta-data">{{ t('sadt.data') }}</label>
        <input id="coleta-data" v-model="data" type="date" />
      </span>
      <template v-if="!mapa">
        <SanteSelecao
          v-model="unidade"
          :rotulo="t('sadt.coleta.unidadeRotulo')"
          :opcoes="unidades"
          data-testid="coleta-unidade"
        />
        <span class="campo">
          <label for="coleta-de">{{ t('sadt.coleta.deHora') }}</label>
          <input id="coleta-de" v-model="deHora" type="time" data-testid="coleta-de" />
        </span>
        <span class="campo">
          <label for="coleta-ate">{{ t('sadt.coleta.ateHora') }}</label>
          <input id="coleta-ate" v-model="ateHora" type="time" data-testid="coleta-ate" />
        </span>
      </template>
    </div>
    <p v-if="!mapa && coleta.data.value?.cortada" role="status">{{ t('sadt.coleta.cortada') }}</p>
    <template v-if="!mapa">
      <ErroSadt v-if="coleta.isError.value" :erro="coleta.error.value" />
      <p v-else-if="!coleta.data.value" role="status">{{ t('sadt.carregando') }}</p>
      <p v-else-if="coleta.data.value.grupos.length === 0">{{ t('sadt.nenhum') }}</p>
      <div
        v-for="(g, i) in coleta.data.value?.grupos ?? []"
        :key="i"
        class="painel"
        :data-testid="`coleta-grupo-${i}`"
      >
        <h2><PacienteSadt :paciente="g.paciente" /></h2>
        <p>
          {{ t('sadt.coleta.tubo') }}: {{ g.recipiente?.nome ?? '—' }} · {{ g.material ?? '—' }} ·
          {{ quando(g.previsao) }}
          <strong v-if="g.urgente"> · {{ t('sadt.urgente') }}</strong>
        </p>
        <ul>
          <li v-for="e in g.exames" :key="e.id">
            {{ e.nome }}<span v-if="e.coletado" class="secundario"> · {{ t('sadt.coleta.coletado') }}</span>
          </li>
        </ul>
        <div v-if="podeColetar && g.exames.some((e) => !e.coletado)" class="filtros">
          <span v-if="g.exigePulseira" class="campo">
            <label :for="`pulseira-${i}`"
              >{{ t('sadt.coleta.pulseira') }} ({{ t('sadt.coleta.exigePulseira') }})</label
            >
            <input :id="`pulseira-${i}`" v-model="pulseira[i]" :data-testid="`coleta-pulseira-${i}`" />
          </span>
          <label>
            <input v-model="conferido[i]" type="checkbox" :data-testid="`coleta-conferido-${i}`" />
            {{ t('sadt.coleta.identificadores') }}
          </label>
          <SanteBotao
            :rotulo="t('sadt.coleta.coletar')"
            :desabilitado="ocupado || !conferido[i]"
            :data-testid="`coleta-coletar-${i}`"
            @acionar="coletar(i)"
          />
        </div>
      </div>
    </template>
    <template v-else>
      <ErroSadt v-if="trabalho.isError.value" :erro="trabalho.error.value" />
      <p v-else-if="!trabalho.data.value" role="status">{{ t('sadt.carregando') }}</p>
      <p v-else-if="trabalho.data.value.bancadas.length === 0">{{ t('sadt.nenhum') }}</p>
      <div
        v-for="b in trabalho.data.value?.bancadas ?? []"
        :key="b.nome"
        class="painel"
        data-testid="mapa-bancada"
      >
        <h2>
          {{ t('sadt.coleta.bancada') }}: {{ b.nome }}
          <span class="secundario">· {{ t('sadt.coleta.urgentes', { n: b.urgentes }) }}</span>
          <span v-if="b.lotes !== undefined" class="secundario" data-testid="mapa-lotes">
            ·
            {{
              b.limite ? t('sadt.coleta.lotes', { n: b.lotes, limite: b.limite }) : t('sadt.coleta.loteUnico')
            }}
          </span>
          <span v-if="b.retidos?.length" class="secundario">
            · {{ t('sadt.coleta.retidos', { n: b.retidos.length }) }}</span
          >
        </h2>
        <ul>
          <li v-for="e in [...b.exames, ...(b.retidos ?? [])]" :key="e.id" data-testid="mapa-exame">
            <span v-if="retidoDe(b, e.id) !== null">{{ e.exame.nome }}</span>
            <RouterLink v-else :to="`/sadt/resultados/digitacao?exame=${e.id}`">{{
              e.exame.nome
            }}</RouterLink>
            · {{ e.paciente.nome }}<strong v-if="e.urgente"> · {{ t('sadt.urgente') }}</strong>
            <span v-if="e.amostra" class="secundario">
              · {{ e.amostra.codigo }} ({{ e.amostra.rotulo }})</span
            >
            <template v-if="b.codigo !== null">
              <strong v-if="retidoDe(b, e.id) !== null" data-testid="mapa-retido">
                · {{ t('sadt.coleta.retido', { motivo: retidoDe(b, e.id) }) }}
              </strong>
              <input
                v-else
                v-model="motivoReter[e.id]"
                :aria-label="t('sadt.coleta.motivoRetencao')"
                :placeholder="t('sadt.coleta.motivoRetencao')"
                maxlength="500"
                data-testid="mapa-motivo"
              />
              <SanteBotao
                :rotulo="retidoDe(b, e.id) !== null ? t('sadt.coleta.soltar') : t('sadt.coleta.reter')"
                :desabilitado="
                  ocupado || (retidoDe(b, e.id) === null && (motivoReter[e.id] ?? '').trim().length < 5)
                "
                data-testid="mapa-reter"
                @acionar="alternarRetencao(e.id, retidoDe(b, e.id) !== null)"
              />
            </template>
          </li>
        </ul>
        <LotesTrabalhoPainel
          v-if="b.codigo !== null"
          :bancada="b.codigo"
          :data="data"
          :tem-fila="b.exames.length > 0"
        />
      </div>
    </template>
    <p v-if="mensagem" role="status" data-testid="coleta-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
