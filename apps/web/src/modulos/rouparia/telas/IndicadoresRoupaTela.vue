<script setup lang="ts">
// Estatística e indicadores da rouparia (M55, fatia F2; regra 4): `/hotelaria/rouparia/indicadores`. Os quilos
// coletados por setor no período com as parcelas por dia (a estatística que o custeio consome) e o total com a conta;
// kg por paciente-dia, índice de perda e custo da lavanderia por paciente-dia, cada um com a conta impressa; os retornos
// com ocorrência para o fornecedor.
import { SanteBotao, SanteData } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerEstatisticaRouparia, lerIndicadoresRouparia } from '../api-rouparia.js';
import ErroRouparia from '../componentes/ErroRouparia.vue';
import NavRouparia from '../componentes/NavRouparia.vue';
import { dataCurta, fmtKg, fmtNumero, fmtReais, menosDias } from '../regras-rouparia.js';
import { usarPainelRouparia } from '../usar-rouparia.js';

const { t } = useI18n();
const { painel, d, nomeSetor } = usarPainelRouparia();
const de = ref<string | null>(null);
const ate = ref<string | null>(null);
const periodo = ref<{ de: string; ate: string } | null>(null);
watch(
  () => d.value?.hoje,
  (hoje) => {
    if (hoje && !periodo.value) {
      de.value = menosDias(hoje, 29);
      ate.value = hoje;
      periodo.value = { de: de.value, ate: hoje };
    }
  },
  { immediate: true },
);
function consultar(): void {
  if (de.value && ate.value) periodo.value = { de: de.value, ate: ate.value };
}
const ativo = computed(() => periodo.value !== null);
const estatistica = useQuery({
  queryKey: computed(() => ['rouparia', 'estatistica', periodo.value]),
  queryFn: () => lerEstatisticaRouparia(periodo.value!.de, periodo.value!.ate),
  enabled: ativo,
});
const indicadores = useQuery({
  queryKey: computed(() => ['rouparia', 'indicadores', periodo.value]),
  queryFn: () => lerIndicadoresRouparia(periodo.value!.de, periodo.value!.ate),
  enabled: ativo,
});
const setorTexto = (cc: number) => nomeSetor(cc) ?? String(cc);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ind-titulo" data-testid="tela-rouparia-indicadores">
    <h1 id="ind-titulo">{{ t('rouparia.indicadores.titulo') }}</h1>
    <NavRouparia />
    <ErroRouparia v-if="painel.isError.value" :erro="painel.error.value" />
    <form class="filtros" data-testid="ind-filtros" @submit.prevent="consultar">
      <SanteData v-model="de" :rotulo="t('rouparia.indicadores.de')" editavel />
      <SanteData v-model="ate" :rotulo="t('rouparia.indicadores.ate')" editavel />
      <SanteBotao tipo="submit" :rotulo="t('rouparia.indicadores.consultar')" data-testid="ind-consultar" />
    </form>

    <section class="painel" aria-labelledby="ind-indicadores">
      <h2 id="ind-indicadores">{{ t('rouparia.indicadores.titulo') }}</h2>
      <ErroRouparia v-if="indicadores.isError.value" :erro="indicadores.error.value" />
      <p v-else-if="!indicadores.data.value" role="status">{{ t('rouparia.carregando') }}</p>
      <template v-else>
        <p class="secundario">
          {{
            t('rouparia.indicadores.totais', {
              c: fmtKg(indicadores.data.value.kgColetados),
              e: fmtKg(indicadores.data.value.kgEnviados),
              r: fmtKg(indicadores.data.value.kgRetornados),
              p: indicadores.data.value.pacientesDia,
            })
          }}
        </p>
        <dl class="indicadores" data-testid="ind-lista">
          <div data-testid="ind-kg-paciente-dia">
            <dt>{{ t('rouparia.indicadores.kgPorPacienteDia') }}</dt>
            <dd>
              <strong>{{
                indicadores.data.value.kgPorPacienteDia.valor === null
                  ? t('rouparia.indicadores.semDado')
                  : fmtNumero(indicadores.data.value.kgPorPacienteDia.valor, 3)
              }}</strong>
              <div class="secundario">{{ indicadores.data.value.kgPorPacienteDia.conta }}</div>
            </dd>
          </div>
          <div data-testid="ind-perda">
            <dt>{{ t('rouparia.indicadores.indicePerda') }}</dt>
            <dd>
              <strong>{{
                indicadores.data.value.indicePerda.valor === null
                  ? t('rouparia.indicadores.semDado')
                  : fmtNumero(indicadores.data.value.indicePerda.valor)
              }}</strong>
              <div class="secundario">{{ indicadores.data.value.indicePerda.conta }}</div>
            </dd>
          </div>
          <div data-testid="ind-custo">
            <dt>{{ t('rouparia.indicadores.custoPorPacienteDia') }}</dt>
            <dd>
              <strong>{{
                indicadores.data.value.custoPorPacienteDia.valor === null
                  ? t('rouparia.indicadores.semDado')
                  : fmtNumero(indicadores.data.value.custoPorPacienteDia.valor)
              }}</strong>
              <div class="secundario">
                {{ indicadores.data.value.custoPorPacienteDia.conta }} ·
                {{
                  t('rouparia.indicadores.precoKg', {
                    preco: fmtReais(indicadores.data.value.custoPorPacienteDia.precoKgCentavos),
                  })
                }}
              </div>
            </dd>
          </div>
          <div data-testid="ind-ocorrencias">
            <dt>{{ t('rouparia.indicadores.ocorrencias') }}</dt>
            <dd>
              <strong>{{ indicadores.data.value.ocorrencias }}</strong>
              <div class="secundario">
                {{
                  t('rouparia.indicadores.ocorrenciasConta', {
                    o: indicadores.data.value.ocorrencias,
                    r: indicadores.data.value.retornos,
                  })
                }}
              </div>
            </dd>
          </div>
        </dl>
      </template>
    </section>

    <section class="painel" aria-labelledby="ind-estatistica">
      <h2 id="ind-estatistica">{{ t('rouparia.indicadores.estatistica') }}</h2>
      <ErroRouparia v-if="estatistica.isError.value" :erro="estatistica.error.value" />
      <p v-else-if="!estatistica.data.value" role="status">{{ t('rouparia.carregando') }}</p>
      <template v-else>
        <p data-testid="ind-conta">{{ estatistica.data.value.conta }}</p>
        <p v-if="estatistica.data.value.porSetor.length === 0">
          {{ t('rouparia.indicadores.nenhumaColeta') }}
        </p>
        <table v-else class="tabela" data-testid="ind-por-setor">
          <caption>
            {{
              t('rouparia.indicadores.total')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('rouparia.campos.setor') }}</th>
              <th scope="col">{{ t('rouparia.indicadores.kg') }}</th>
              <th scope="col">{{ t('rouparia.indicadores.coletas') }}</th>
              <th scope="col">{{ t('rouparia.indicadores.porDia') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="x in estatistica.data.value.porSetor"
              :key="x.centroCusto"
              :data-testid="`ind-setor-${x.centroCusto}`"
            >
              <td>{{ setorTexto(x.centroCusto) }}</td>
              <td>{{ fmtKg(x.kg) }}</td>
              <td>{{ x.coletas }}</td>
              <td class="secundario">
                {{ x.dias.map((y) => `${dataCurta(y.data)}: ${fmtKg(y.kg)}`).join(' + ') }}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{{ t('rouparia.indicadores.total') }}</th>
              <td>
                <strong>{{ fmtKg(estatistica.data.value.totalKg) }}</strong>
              </td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </template>
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="./estilo-rouparia.css"></style>
<style scoped>
.indicadores {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-3);
  margin: 0;
}
.indicadores dt {
  font-weight: 600;
}
.indicadores dd {
  margin: 0;
}
</style>
