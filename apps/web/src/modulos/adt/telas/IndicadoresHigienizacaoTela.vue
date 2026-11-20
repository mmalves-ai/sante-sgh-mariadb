<script setup lang="ts">
// Indicadores de higienização e giro de leito (W0-07, M3): `/higienizacao/indicadores`. Das limpezas liberadas no
// período, o tempo de giro do leito, o percentual no prazo e o tempo de execução sem as pausas, no total e por tipo,
// área e profissional; cada valor com o numerador e o denominador, e a exportação em CSV (as mesmas linhas).
import { csvIndicadoresGiro, RECORTES_GIRO, type RecorteGiro } from '@sgh/dominio-hotelaria';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../agenda/formato.js';
import { baixarTexto } from '../../internacao/formato.js';
import { lerIndicadoresGiro } from '../api-adt.js';
import ErroAdt from '../componentes/ErroAdt.vue';

const { t } = useI18n();
const iso = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const inicio = ref(iso(new Date(Date.now() - 29 * 86_400_000)));
const fim = ref(iso(new Date()));
const recorte = ref<RecorteGiro>('total');
const pedido = ref({ de: inicio.value, ate: fim.value });
const ind = useQuery({
  queryKey: computed(() => ['adt', 'hig', 'indicadores', pedido.value]),
  queryFn: () => lerIndicadoresGiro(pedido.value.de, pedido.value.ate),
});
const recortes = computed(() =>
  RECORTES_GIRO.map((r) => ({ valor: r, rotulo: t(`adt.hig.ind.recortes.${r}`) })),
);
const linhas = computed(() => (ind.data.value?.linhas ?? []).filter((l) => l.recorte === recorte.value));
const valor = (l: { valor: number | null; unidade: string }) =>
  l.valor === null
    ? t('adt.hig.ind.semDenominador')
    : l.unidade === 'percentual'
      ? `${String(l.valor).replace('.', ',')}%`
      : t('adt.hig.ind.minutos', { n: String(l.valor).replace('.', ',') });
const exportar = () => {
  const d = ind.data.value;
  if (d) baixarTexto(csvIndicadoresGiro(d, d.linhas), `indicadores-higienizacao-${d.de}-${d.ate}.csv`);
};
</script>

<template>
  <section class="tela-agenda" aria-labelledby="hig-ind-titulo" data-testid="tela-indicadores-higienizacao">
    <h1 id="hig-ind-titulo">{{ t('adt.hig.indicadores') }}</h1>
    <p>{{ t('adt.hig.indicadoresTexto') }}</p>
    <p class="acoes">
      <RouterLink to="/higienizacao/painel">{{ t('adt.hig.painel') }}</RouterLink>
    </p>
    <form
      class="filtros"
      data-testid="form-hig-indicadores"
      @submit.prevent="pedido = { de: inicio, ate: fim }"
    >
      <div class="campo">
        <label for="hig-ind-inicio">{{ t('adt.hig.ind.inicio') }}</label>
        <input id="hig-ind-inicio" v-model="inicio" type="date" data-testid="hig-ind-inicio" />
      </div>
      <div class="campo">
        <label for="hig-ind-fim">{{ t('adt.hig.ind.fim') }}</label>
        <input id="hig-ind-fim" v-model="fim" type="date" data-testid="hig-ind-fim" />
      </div>
      <SanteBotao tipo="submit" :rotulo="t('adt.hig.ind.calcular')" />
    </form>
    <ErroAdt v-if="ind.isError.value" :erro="ind.error.value" />
    <p v-else-if="!ind.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <p role="status" data-testid="hig-ind-periodo">
        {{
          t('adt.hig.ind.periodo', {
            inicio: dataBr(ind.data.value.de),
            fim: dataBr(ind.data.value.ate),
            n: ind.data.value.liberadas,
          })
        }}
      </p>
      <SanteSelecao
        v-model="recorte"
        :rotulo="t('adt.hig.ind.recorte')"
        :opcoes="recortes"
        data-testid="hig-ind-recorte"
      />
      <table class="tabela" data-testid="hig-ind-tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('adt.hig.indicadores') }}</th>
            <th scope="col">{{ t('adt.hig.ind.grupo') }}</th>
            <th scope="col">{{ t('adt.hig.ind.numerador') }}</th>
            <th scope="col">{{ t('adt.hig.ind.denominador') }}</th>
            <th scope="col">{{ t('adt.hig.ind.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in linhas" :key="`${l.codigo}-${l.recorte}-${l.chave}`">
            <td>{{ l.indicador }}</td>
            <td>{{ l.rotulo }}</td>
            <td>{{ l.numerador }}</td>
            <td>{{ l.denominador }}</td>
            <td>{{ valor(l) }}</td>
          </tr>
        </tbody>
      </table>
      <SanteBotao :rotulo="t('adt.hig.ind.exportar')" data-testid="hig-ind-exportar" @acionar="exportar" />
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
