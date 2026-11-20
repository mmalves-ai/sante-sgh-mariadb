<script setup lang="ts">
// Aba DRE (M54.3): a demonstração do resultado de um intervalo de competências do mesmo exercício: receita bruta,
// deduções, receita líquida, custos, resultado bruto, despesas e o resultado (superávit ou déficit), cada linha com as
// parcelas (as contas de nível 2) e a conferência impressa. O lançamento de apuração não entra (senão o resultado
// seria zero).
import type { ApoioDemonstracoes } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import BotoesExportar from './BotoesExportar.vue';
import { type FiltroDreTela, lerDre } from './api-demonstracoes.js';
import { reais, rotuloCompetencia } from './comum-contabil.js';
import { intervaloDoAno, problemaDoIntervalo } from './comum-demonstracoes.js';
import { competenciasAte } from '../folha/comum-folha.js';

const props = defineProps<{ apoio: ApoioDemonstracoes; empresa: number; hoje: string }>();
const { t } = useI18n();

const padrao = intervaloDoAno(props.hoje);
const de = ref<string | null>(padrao.de);
const ate = ref<string | null>(padrao.ate);
const competencias = computed(() =>
  competenciasAte(props.hoje, 36).map((c) => ({ valor: c as string | null, rotulo: rotuloCompetencia(c) })),
);
const problema = computed(() => problemaDoIntervalo(de.value, ate.value, true));
const pedido = ref<FiltroDreTela | null>(null);
function consultar() {
  if (!problema.value) pedido.value = { empresa: props.empresa, de: de.value!, ate: ate.value! };
}
const dre = useQuery({
  queryKey: computed(() => ['contabil', 'dre', pedido.value]),
  queryFn: () => lerDre(pedido.value!),
  enabled: computed(() => pedido.value !== null),
});
const d = computed(() => (pedido.value ? (dre.data.value ?? null) : null));
</script>

<template>
  <section class="bloco" aria-labelledby="dre-titulo" data-testid="aba-dre">
    <h2 id="dre-titulo">{{ t('contabil.demonstracoes.dre.titulo') }}</h2>
    <p class="secundario">{{ t('contabil.demonstracoes.dre.ajuda') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="de"
        :rotulo="t('contabil.demonstracoes.de')"
        :opcoes="competencias"
        busca
        data-testid="dre-de"
      />
      <SanteSelecao
        v-model="ate"
        :rotulo="t('contabil.demonstracoes.ate')"
        :opcoes="competencias"
        busca
        data-testid="dre-ate"
      />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('contabil.demonstracoes.consultar')"
          :desabilitado="problema !== null"
          data-testid="dre-consultar"
          @acionar="consultar"
        />
      </div>
    </div>
    <p v-if="problema && problema !== 'intervaloIncompleto'" class="erro" data-testid="dre-problema">
      {{ t(`contabil.demonstracoes.problemas.${problema}`) }}
    </p>
    <p v-if="!pedido" data-testid="dre-escolha">{{ t('contabil.demonstracoes.escolhaPeriodo') }}</p>
    <MensagemErro v-else-if="dre.isError.value" :erro="dre.error.value" />
    <p v-else-if="!d" role="status">{{ t('contabil.carregando') }}</p>
    <template v-else>
      <div class="rolagem">
        <table class="tabela" data-testid="tabela-dre">
          <thead>
            <tr>
              <th scope="col">{{ t('contabil.demonstracoes.descricaoCol') }}</th>
              <th scope="col">{{ t('contabil.valor') }}</th>
            </tr>
          </thead>
          <tbody v-for="l in d.linhas" :key="l.chave" :data-testid="`dre-linha-${l.chave}`">
            <tr :class="{ total: l.total }">
              <th scope="row">{{ l.rotulo }}</th>
              <td>{{ reais(l.valorCentavos) }}</td>
            </tr>
            <tr v-for="p in l.parcelas" :key="p.codigo" class="parcela">
              <td>{{ p.codigo }} {{ p.nome }}</td>
              <td>{{ reais(p.valorCentavos) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p data-testid="dre-resultado">
        <strong>{{ d.rotuloResultado }}: {{ reais(Math.abs(d.resultadoCentavos)) }}</strong>
      </p>
      <p class="secundario" data-testid="dre-conferencia">{{ d.conferencia }}</p>
      <BotoesExportar :filtro="{ tipo: 'dre', ...pedido! }" />
    </template>
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
<style scoped>
.total th,
.total td {
  font-weight: 700;
}
.parcela td:first-child {
  padding-inline-start: 1.5rem;
}
</style>
