<script setup lang="ts">
// Indicadores da agenda (ficha do M17, seção 4): funil do período, ocupação, absenteísmo pela antecedência e por
// agenda e marcações por canal. Só contagens (nenhum paciente aparece).
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerIndicadores } from '../api-agenda.js';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr, pctBr } from '../formato.js';

const { t } = useI18n();
const de = ref('');
const ate = ref('');
const filtro = ref({ de: '', ate: '' });
const ind = useQuery({
  queryKey: computed(() => ['agenda', 'indicadores', filtro.value]),
  queryFn: () => lerIndicadores(filtro.value.de || null, filtro.value.ate || null),
});
const funil = computed(() => {
  const f = ind.data.value?.funil;
  if (!f) return [];
  return [
    { rotulo: t('agenda.indicadores.ofertados'), valor: String(f.horariosOfertados) },
    { rotulo: t('agenda.indicadores.nuncaPreenchidos'), valor: String(f.nuncaPreenchidos) },
    { rotulo: t('agenda.indicadores.marcados'), valor: String(f.marcados) },
    { rotulo: t('agenda.indicadores.cancelados'), valor: String(f.cancelados) },
    { rotulo: t('agenda.indicadores.compareceu'), valor: String(f.compareceu) },
    { rotulo: t('agenda.indicadores.faltou'), valor: String(f.faltou) },
    { rotulo: t('agenda.indicadores.encaixes'), valor: String(f.encaixes) },
    {
      rotulo: t('agenda.indicadores.ocupacao'),
      valor: t('agenda.indicadores.pct', { v: pctBr(f.ocupacao) }),
    },
    {
      rotulo: t('agenda.indicadores.taxaCancelamento'),
      valor: t('agenda.indicadores.pct', { v: pctBr(f.taxaCancelamento) }),
    },
    {
      rotulo: t('agenda.indicadores.absenteismo'),
      valor: t('agenda.indicadores.pct', { v: pctBr(f.absenteismo) }),
    },
  ];
});
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ind-titulo" data-testid="tela-indicadores">
    <h1 id="ind-titulo">{{ t('agenda.indicadores.titulo') }}</h1>
    <p>{{ t('agenda.indicadores.texto') }}</p>
    <form class="filtros" @submit.prevent="filtro = { de, ate }">
      <div class="campo">
        <label for="ind-de">{{ t('agenda.de') }}</label>
        <input id="ind-de" v-model="de" type="date" />
      </div>
      <div class="campo">
        <label for="ind-ate">{{ t('agenda.ate') }}</label>
        <input id="ind-ate" v-model="ate" type="date" />
      </div>
      <SanteBotao tipo="submit" :rotulo="t('agenda.cancelamentos.filtrar')" />
    </form>
    <ErroAgenda v-if="ind.isError.value" :erro="ind.error.value" />
    <p v-else-if="!ind.data.value" role="status">{{ t('agenda.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="ind.data.value.recortada"
        variante="info"
        :texto="t('agenda.recortada', { dias: 366 })"
      />
      <section class="painel" aria-labelledby="ind-funil">
        <h2 id="ind-funil">
          {{ t('agenda.indicadores.funil') }}
          ({{ t('agenda.intervalo', { de: dataBr(ind.data.value.de), ate: dataBr(ind.data.value.ate) }) }})
        </h2>
        <ul class="cartoes">
          <li v-for="c in funil" :key="c.rotulo">
            <span>{{ c.rotulo }}</span>
            <strong>{{ c.valor }}</strong>
          </li>
        </ul>
      </section>
      <section
        v-for="bloco in [
          {
            id: 'ant',
            titulo: t('agenda.indicadores.porAntecedencia'),
            linhas: ind.data.value.absenteismoPorAntecedencia,
          },
          {
            id: 'esp',
            titulo: t('agenda.indicadores.porEspecialidade'),
            linhas: ind.data.value.absenteismoPorEspecialidade,
          },
        ]"
        :key="bloco.id"
        class="painel"
        :aria-labelledby="`ind-${bloco.id}`"
      >
        <h2 :id="`ind-${bloco.id}`">{{ bloco.titulo }}</h2>
        <table class="tabela">
          <caption class="sgh-visualmente-oculto">
            {{
              bloco.titulo
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('agenda.indicadores.chave') }}</th>
              <th scope="col">{{ t('agenda.indicadores.marcados') }}</th>
              <th scope="col">{{ t('agenda.indicadores.compareceu') }}</th>
              <th scope="col">{{ t('agenda.indicadores.faltou') }}</th>
              <th scope="col">{{ t('agenda.indicadores.absenteismo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in bloco.linhas" :key="l.chave">
              <td>{{ l.chave }}</td>
              <td>{{ l.marcados }}</td>
              <td>{{ l.compareceu }}</td>
              <td>{{ l.faltou }}</td>
              <td>{{ t('agenda.indicadores.pct', { v: pctBr(l.absenteismo) }) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section class="painel" aria-labelledby="ind-canal">
        <h2 id="ind-canal">{{ t('agenda.indicadores.porCanal') }}</h2>
        <ul>
          <li v-for="c in ind.data.value.porCanal" :key="c.canal">{{ c.canal }}: {{ c.marcados }}</li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
