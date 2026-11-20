<script setup lang="ts">
// Aba Balanço (M54.3): o balanço patrimonial no último dia da competência: ativo; passivo; patrimônio líquido (com o
// resultado do exercício ainda não apurado e o de exercícios anteriores sem apuração, quando houver); as contas de
// compensação à parte; cada grupo com as parcelas (nível 2), os totais e a conferência (ativo = passivo + PL).
import type { ApoioDemonstracoes, SecaoBalanco } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import BotoesExportar from './BotoesExportar.vue';
import { type FiltroBalancoTela, lerBalanco } from './api-demonstracoes.js';
import { dataBr, reais, rotuloCompetencia } from './comum-contabil.js';
import { competenciasAte } from '../folha/comum-folha.js';

const props = defineProps<{ apoio: ApoioDemonstracoes; empresa: number; hoje: string }>();
const { t } = useI18n();

const competencia = ref<string | null>(props.hoje.slice(0, 7));
const competencias = computed(() =>
  competenciasAte(props.hoje, 36).map((c) => ({ valor: c as string | null, rotulo: rotuloCompetencia(c) })),
);
const pedido = ref<FiltroBalancoTela | null>(null);
function consultar() {
  if (competencia.value) pedido.value = { empresa: props.empresa, competencia: competencia.value };
}
const balanco = useQuery({
  queryKey: computed(() => ['contabil', 'balanco', pedido.value]),
  queryFn: () => lerBalanco(pedido.value!),
  enabled: computed(() => pedido.value !== null),
});
const b = computed(() => (pedido.value ? (balanco.data.value ?? null) : null));
const secoes = computed<{ chave: string; s: SecaoBalanco }[]>(() =>
  b.value
    ? [
        { chave: 'ativo', s: b.value.ativo },
        { chave: 'passivo', s: b.value.passivo },
        { chave: 'pl', s: b.value.patrimonioLiquido },
      ]
    : [],
);
</script>

<template>
  <section class="bloco" aria-labelledby="balanco-titulo" data-testid="aba-balanco">
    <h2 id="balanco-titulo">{{ t('contabil.demonstracoes.balanco.titulo') }}</h2>
    <p class="secundario">{{ t('contabil.demonstracoes.balanco.ajuda') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="competencia"
        :rotulo="t('contabil.competencia')"
        :opcoes="competencias"
        busca
        data-testid="balanco-competencia"
      />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('contabil.demonstracoes.consultar')"
          :desabilitado="!competencia"
          data-testid="balanco-consultar"
          @acionar="consultar"
        />
      </div>
    </div>
    <p v-if="!pedido" data-testid="balanco-escolha">{{ t('contabil.demonstracoes.escolhaPeriodo') }}</p>
    <MensagemErro v-else-if="balanco.isError.value" :erro="balanco.error.value" />
    <p v-else-if="!b" role="status">{{ t('contabil.carregando') }}</p>
    <template v-else>
      <p class="secundario">{{ t('contabil.demonstracoes.balanco.em', { data: dataBr(b.data) }) }}</p>
      <SanteAlerta
        v-if="!b.equilibrado"
        variante="alerta"
        :texto="t('contabil.demonstracoes.balanco.desequilibrado')"
        data-testid="balanco-desequilibrado"
      />
      <div class="rolagem">
        <table class="tabela" data-testid="tabela-balanco">
          <thead>
            <tr>
              <th scope="col">{{ t('contabil.demonstracoes.descricaoCol') }}</th>
              <th scope="col">{{ t('contabil.valor') }}</th>
            </tr>
          </thead>
          <tbody v-for="x in secoes" :key="x.chave" :data-testid="`balanco-secao-${x.chave}`">
            <tr class="total">
              <th scope="row">{{ x.s.rotulo }}</th>
              <td>{{ reais(x.s.totalCentavos) }}</td>
            </tr>
            <tr v-for="p in x.s.parcelas" :key="p.codigo" class="parcela">
              <td>{{ p.codigo }} {{ p.nome }}</td>
              <td>{{ reais(p.valorCentavos) }}</td>
            </tr>
            <template v-if="x.chave === 'pl'">
              <tr
                v-if="b.resultadoExercicioCentavos !== 0"
                class="parcela"
                data-testid="balanco-resultado-exercicio"
              >
                <td>{{ t('contabil.demonstracoes.balanco.resultadoExercicio') }}</td>
                <td>{{ reais(b.resultadoExercicioCentavos) }}</td>
              </tr>
              <tr
                v-if="b.resultadoAnterioresCentavos !== 0"
                class="parcela"
                data-testid="balanco-resultado-anteriores"
              >
                <td>{{ t('contabil.demonstracoes.balanco.resultadoAnteriores') }}</td>
                <td>{{ reais(b.resultadoAnterioresCentavos) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <dl class="dados" data-testid="balanco-totais">
        <dt>{{ t('contabil.demonstracoes.balanco.totalAtivo') }}</dt>
        <dd>{{ reais(b.totalAtivoCentavos) }}</dd>
        <dt>{{ t('contabil.demonstracoes.balanco.totalPassivoPl') }}</dt>
        <dd>{{ reais(b.totalPassivoPlCentavos) }}</dd>
        <dt>{{ t('contabil.razao.conferencia') }}</dt>
        <dd data-testid="balanco-conferencia">{{ b.conferencia }}</dd>
      </dl>
      <section v-if="b.compensacao" class="bloco" data-testid="balanco-compensacao">
        <h3>{{ b.compensacao.rotulo }}: {{ reais(b.compensacao.totalCentavos) }}</h3>
        <ul>
          <li v-for="p in b.compensacao.parcelas" :key="p.codigo">
            {{ p.codigo }} {{ p.nome }}: {{ reais(p.valorCentavos) }}
          </li>
        </ul>
      </section>
      <BotoesExportar :filtro="{ tipo: 'balanco', ...pedido! }" />
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
