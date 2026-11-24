<script setup lang="ts">
// 02-CAD linha 12: indicador da origem dos pacientes no período (por canal e por tipo de indicação), na tela da central
// de marcação. Abre recolhido e só consulta ao abrir; o período vem do início do mês até hoje e muda na hora.
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { type IndicadorOrigem, lerIndicadorOrigem } from '../api-vinculos.js';

const { t } = useI18n();
const hoje = new Date().toISOString().slice(0, 10);
const de = ref(`${hoje.slice(0, 8)}01`);
const ate = ref(hoje);
const dados = ref<IndicadorOrigem | null>(null);
const erro = ref<unknown>(null);
const aberto = ref(false);
const periodoValido = computed(() => Boolean(de.value && ate.value && de.value <= ate.value));
const pct = (n: number) =>
  dados.value && dados.value.total > 0 ? Math.round((n * 100) / dados.value.total) : 0;

async function carregar(): Promise<void> {
  if (!periodoValido.value) return;
  erro.value = null;
  try {
    dados.value = await lerIndicadorOrigem(de.value, ate.value);
  } catch (e) {
    erro.value = e;
  }
}
function alternar(ev: Event): void {
  aberto.value = (ev.target as HTMLDetailsElement).open;
  if (aberto.value && !dados.value) void carregar();
}
</script>

<template>
  <details data-testid="indicador-captacao" @toggle="alternar">
    <summary>{{ t('vinculos.indicador.titulo') }}</summary>
    <form class="periodo" @submit.prevent="carregar">
      <label
        >{{ t('vinculos.indicador.de') }}
        <input v-model="de" name="de" type="date" :max="ate || hoje" required @change="carregar"
      /></label>
      <label
        >{{ t('vinculos.indicador.ate') }}
        <input v-model="ate" name="ate" type="date" :min="de" :max="hoje" required @change="carregar"
      /></label>
      <p v-if="!periodoValido" role="alert">{{ t('vinculos.indicador.periodoInvalido') }}</p>
    </form>
    <MensagemErro v-if="erro" :erro="erro" />
    <template v-if="dados">
      <p data-testid="indicador-total">{{ t('vinculos.indicador.total', { n: dados.total }) }}</p>
      <div v-if="dados.total > 0" class="tabelas">
        <table data-testid="indicador-canal">
          <caption>
            {{
              t('vinculos.indicador.porCanal')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('vinculos.captacao.canal') }}</th>
              <th scope="col">{{ t('vinculos.indicador.pacientes') }}</th>
              <th scope="col">%</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in dados.porCanal" :key="c.canal">
              <td>{{ t(`vinculos.captacao.canais.${c.canal}`) }}</td>
              <td>{{ c.total }}</td>
              <td>{{ pct(c.total) }}</td>
            </tr>
          </tbody>
        </table>
        <table data-testid="indicador-tipo">
          <caption>
            {{
              t('vinculos.indicador.porTipo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('vinculos.captacao.tipo') }}</th>
              <th scope="col">{{ t('vinculos.indicador.pacientes') }}</th>
              <th scope="col">%</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in dados.porTipo" :key="x.id">
              <td>{{ x.descricao }}</td>
              <td>{{ x.total }}</td>
              <td>{{ pct(x.total) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </details>
</template>

<style scoped>
.periodo {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
.tabelas {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
}
</style>
