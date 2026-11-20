<script setup lang="ts">
// Migração gradual: indicadores (M37, ficha seção 7; cap-15 §15.3.4): os cinco indicadores por dia e setor — a parcela
// das operações feitas no novo e no outro sistema (impressa com a conta), o tempo das tarefas-chave (p50 e p95), os
// avisos de colisão e as esperas por trava, a carga do banco (conexões por sistema e transações longas) e os chamados
// por severidade com o tempo de correção — e o atalho ao Grafana; M39: a disputa da onda 1 por dia e setor, com a
// conta impressa. Só leitura.
import { INDICADORES_DISPUTA } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { lerIndicadores, textoParcela } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';

const { t } = useI18n();
const dias = ref('14');
const consulta = useQuery({
  queryKey: computed(() => ['coexistencia', 'indicadores', dias.value]),
  queryFn: () => lerIndicadores(Number(dias.value)),
});
const opcoesDias = ['7', '14', '28'].map((d) => ({
  valor: d,
  rotulo: t('coexistencia.indicadores.dias', { n: d }),
}));
const tarefas = ['abrir-prontuario', 'prescrever', 'chamar-senha', 'dispensar'];
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-indicadores" data-testid="tela-migracao-indicadores">
    <h1 id="titulo-indicadores">{{ t('coexistencia.indicadores.titulo') }}</h1>
    <AbasMigracao atual="indicadores" />
    <p>{{ t('coexistencia.indicadores.texto') }}</p>
    <form class="filtros" :aria-label="t('coexistencia.filtros')" @submit.prevent>
      <SanteSelecao
        id="indicadores-dias"
        v-model="dias"
        :rotulo="t('coexistencia.indicadores.periodo')"
        :opcoes="opcoesDias"
      />
    </form>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!consulta.data.value" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <p v-if="consulta.data.value.grafana">
        <a :href="consulta.data.value.grafana" target="_blank" rel="noopener" data-testid="atalho-grafana">{{
          t('coexistencia.indicadores.grafana')
        }}</a>
      </p>
      <section aria-labelledby="ind-parcela" data-testid="ind-parcela">
        <h2 id="ind-parcela">{{ t('coexistencia.indicadores.parcela') }}</h2>
        <p v-if="consulta.data.value.parcela.length === 0">{{ t('coexistencia.nenhum') }}</p>
        <table v-else class="tabela">
          <caption>
            {{
              t('coexistencia.indicadores.parcela')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.indicadores.dia') }}</th>
              <th scope="col">{{ t('coexistencia.setor') }}</th>
              <th scope="col">{{ t('coexistencia.indicadores.operacao') }}</th>
              <th scope="col">{{ t('coexistencia.indicadores.conta') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="x in consulta.data.value.parcela"
              :key="`${x.dia}-${x.setor}-${x.operacao}`"
              :data-testid="`parcela-${x.operacao}`"
            >
              <td>{{ x.dia }}</td>
              <td>{{ x.setor }}</td>
              <td>{{ x.operacao }}</td>
              <td>{{ textoParcela(x.parcela) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section aria-labelledby="ind-tempo" data-testid="ind-tempo">
        <h2 id="ind-tempo">{{ t('coexistencia.indicadores.tempo') }}</h2>
        <table class="tabela">
          <caption>
            {{
              t('coexistencia.indicadores.tempo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.indicadores.dia') }}</th>
              <th scope="col">{{ t('coexistencia.indicadores.tarefa') }}</th>
              <th scope="col">{{ t('coexistencia.indicadores.p50') }}</th>
              <th scope="col">{{ t('coexistencia.indicadores.p95') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="x in consulta.data.value.tempo.filter((y) => tarefas.includes(y.tarefa))"
              :key="`${x.dia}-${x.tarefa}`"
            >
              <td>{{ x.dia }}</td>
              <td>{{ t(`coexistencia.tarefas.${x.tarefa}`) }}</td>
              <td>{{ x.p50Ms === null ? '—' : `${x.p50Ms} ms` }}</td>
              <td>{{ x.p95Ms === null ? '—' : `${x.p95Ms} ms` }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section aria-labelledby="ind-colisoes" data-testid="ind-colisoes">
        <h2 id="ind-colisoes">{{ t('coexistencia.indicadores.colisoes') }}</h2>
        <p v-if="consulta.data.value.colisoes.length === 0">{{ t('coexistencia.indicadores.semColisao') }}</p>
        <ul v-else>
          <li v-for="x in consulta.data.value.colisoes" :key="x.dia">
            {{ t('coexistencia.indicadores.colisoesDia', { dia: x.dia, c: x.colisoes, e: x.esperasTrava }) }}
          </li>
        </ul>
      </section>
      <section aria-labelledby="ind-disputa" data-testid="ind-disputa">
        <h2 id="ind-disputa">{{ t('coexistencia.indicadores.disputa') }}</h2>
        <p>{{ t('coexistencia.indicadores.disputaTexto') }}</p>
        <table class="tabela">
          <caption>
            {{
              t('coexistencia.indicadores.disputa')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.indicadores.dia') }}</th>
              <th scope="col">{{ t('coexistencia.setor') }}</th>
              <th v-for="i in INDICADORES_DISPUTA" :key="i" scope="col">
                {{ t(`coexistencia.onda1.indicadores.${i}`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="d in consulta.data.value.disputa" :key="d.dia">
              <tr
                v-for="s in d.setores"
                :key="`${d.dia}-${s.setor}`"
                :data-testid="`ind-disputa-${d.dia}-${s.setor}`"
              >
                <td>{{ d.dia }}</td>
                <th scope="row">{{ s.setor }}</th>
                <td v-for="i in INDICADORES_DISPUTA" :key="i" :data-testid="`ind-disputa-${s.setor}-${i}`">
                  {{ s.parcelas[i] }}
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>
      <section aria-labelledby="ind-carga" data-testid="ind-carga">
        <h2 id="ind-carga">{{ t('coexistencia.indicadores.carga') }}</h2>
        <p>
          {{
            t('coexistencia.indicadores.cargaTexto', {
              conexoes:
                consulta.data.value.carga.conexoesPorSistema
                  .map((c) => `${t(`coexistencia.sistemas.${c.sistema}`)} ${c.conexoes}`)
                  .join('; ') || '—',
              longas: consulta.data.value.carga.transacoesLongas,
            })
          }}
        </p>
      </section>
      <section aria-labelledby="ind-chamados" data-testid="ind-chamados">
        <h2 id="ind-chamados">{{ t('coexistencia.indicadores.chamados') }}</h2>
        <table class="tabela">
          <caption>
            {{
              t('coexistencia.indicadores.chamados')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.chamados.severidade') }}</th>
              <th scope="col">{{ t('coexistencia.chamados.abertos') }}</th>
              <th scope="col">{{ t('coexistencia.chamados.resolvidos') }}</th>
              <th scope="col">{{ t('coexistencia.chamados.correcao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in consulta.data.value.chamados" :key="x.severidade">
              <th scope="row">{{ x.severidade }}</th>
              <td>{{ x.abertos }}</td>
              <td>{{ x.resolvidos }}</td>
              <td>
                {{
                  x.horasCorrecaoMedia === null
                    ? '—'
                    : t('coexistencia.chamados.horas', { n: x.horasCorrecaoMedia })
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
