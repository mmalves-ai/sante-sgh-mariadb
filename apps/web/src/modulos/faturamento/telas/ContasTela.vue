<script setup lang="ts">
// Contas do paciente (ficha do M30, seção 7): `/faturamento/contas` (e as entradas do menu de lançamentos, auditoria e
// contas SUS, que abrem a mesma lista e levam à aba certa). Lista por situação derivada, convênio, competência, tipo e
// idade desde a alta (filtrados no banco); a régua é a competência (regra 11); o escopo por convênio vem do servidor
// (regra 13): o combo de convênios só traz os do escopo.
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { listarContas } from '../api-faturamento.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import { competenciaTexto, data, reais, usarFaturamento } from '../usar-faturamento.js';

const props = defineProps<{ destino: 'conta' | 'lancamentos' | 'auditoria' | 'sigtap' }>();
const { t } = useI18n();
const { apoio } = usarFaturamento();
const situacao = ref('');
const competencia = ref('');
const tipo = ref('');
const convenio = ref('');
const altaDias = ref('');
const termo = ref('');
const pagina = ref(0);
const filtro = ref({ situacao: '', competencia: '', tipo: '', convenio: '', altaDias: '', termo: '' });
const opcoesSituacao = computed(() => [
  { valor: '', rotulo: t('faturamento.todas') },
  ...(apoio.data.value?.situacoes ?? []).map((s) => ({ valor: s, rotulo: t(`faturamento.situacoes.${s}`) })),
]);
const opcoesTipo = computed(() => [
  { valor: '', rotulo: t('faturamento.todos') },
  { valor: 'E', rotulo: t('faturamento.externa') },
  { valor: 'I', rotulo: t('faturamento.internacao') },
]);
const opcoesConvenio = computed(() => [
  { valor: '', rotulo: t('faturamento.todos') },
  ...(apoio.data.value?.convenios ?? []).map((x) => ({
    valor: String(x.codigo),
    rotulo: `${x.codigo} — ${x.nome}`,
  })),
]);
const c = useQuery({
  queryKey: computed(() => ['faturamento', 'contas', props.destino, filtro.value, pagina.value]),
  queryFn: () => listarContas({ ...filtro.value, pagina: pagina.value, sus: props.destino === 'sigtap' }),
});
const titulo = computed(
  () =>
    ({
      conta: t('faturamento.contas.titulo'),
      lancamentos: t('faturamento.contas.tituloLancamentos'),
      auditoria: t('faturamento.contas.tituloAuditoria'),
      sigtap: t('faturamento.contas.tituloSigtap'),
    })[props.destino],
);
const rota = (id: number) =>
  props.destino === 'conta' ? `/faturamento/contas/${id}` : `/faturamento/contas/${id}/${props.destino}`;
function buscar() {
  pagina.value = 0;
  filtro.value = {
    situacao: situacao.value,
    competencia: competencia.value,
    tipo: tipo.value,
    convenio: convenio.value,
    altaDias: altaDias.value === '' ? '' : String(Math.max(0, Math.trunc(Number(altaDias.value)))),
    termo: termo.value.trim(),
  };
}
</script>

<template>
  <section
    class="tela-agenda"
    aria-labelledby="ctas-titulo"
    :data-testid="`tela-faturamento-contas-${destino}`"
  >
    <h1 id="ctas-titulo">{{ titulo }}</h1>
    <RouterLink to="/faturamento/protocolos" data-testid="ctas-protocolos">{{
      t('auditoriaTramite.atalhos.protocolos')
    }}</RouterLink>
    <p>{{ t('faturamento.contas.texto') }}</p>
    <p class="secundario">{{ t('faturamento.regua') }}</p>
    <form class="filtros" @submit.prevent="buscar">
      <span class="campo">
        <SanteSelecao
          v-model="situacao"
          :rotulo="t('faturamento.situacao')"
          :opcoes="opcoesSituacao"
          data-testid="ctas-situacao"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="convenio"
          :rotulo="t('faturamento.convenio')"
          :opcoes="opcoesConvenio"
          data-testid="ctas-convenio"
        />
      </span>
      <span class="campo">
        <label for="ctas-competencia">{{ t('faturamento.competencia') }}</label>
        <input id="ctas-competencia" v-model="competencia" type="month" data-testid="ctas-competencia" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="tipo"
          :rotulo="t('faturamento.tipoConta')"
          :opcoes="opcoesTipo"
          data-testid="ctas-tipo"
        />
      </span>
      <span class="campo">
        <label for="ctas-alta">{{ t('faturamento.contas.altaDias') }}</label>
        <input
          id="ctas-alta"
          v-model="altaDias"
          type="number"
          min="0"
          max="3650"
          inputmode="numeric"
          data-testid="ctas-alta-dias"
        />
      </span>
      <span class="campo">
        <label for="ctas-termo">{{ t('faturamento.contas.termo') }}</label>
        <input id="ctas-termo" v-model="termo" maxlength="60" data-testid="ctas-termo" />
      </span>
      <button type="submit" data-testid="ctas-buscar">{{ t('faturamento.buscar') }}</button>
    </form>
    <ErroFaturamento v-if="c.error.value" :erro="c.error.value" />
    <p v-else-if="!c.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <template v-else>
      <p v-if="c.data.value.contas.length === 0">{{ t('faturamento.nenhum') }}</p>
      <table v-else class="tabela" data-testid="ctas-lista">
        <caption class="secundario">
          {{
            c.data.value.total
          }}
          ·
          {{
            t('faturamento.pagina')
          }}
          {{
            c.data.value.pagina + 1
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('faturamento.contaRotulo') }}</th>
            <th scope="col">{{ t('faturamento.competencia') }}</th>
            <th scope="col">{{ t('faturamento.paciente') }}</th>
            <th scope="col">{{ t('faturamento.convenio') }}</th>
            <th scope="col">{{ t('faturamento.situacao') }}</th>
            <th scope="col">{{ t('faturamento.alta') }}</th>
            <th scope="col">{{ t('faturamento.total') }}</th>
            <th scope="col">{{ t('faturamento.pendencias') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in c.data.value.contas" :key="x.id" :data-testid="`ctas-${x.id}`">
            <td>
              <RouterLink :to="rota(x.id)" :data-testid="`ctas-abrir-${x.id}`">{{ x.id }}</RouterLink>
              <span class="secundario">
                · {{ x.tipoConta === 'I' ? t('faturamento.internacao') : t('faturamento.externa') }}</span
              >
            </td>
            <td>{{ competenciaTexto(x.ano, x.mes) }}</td>
            <td>{{ x.paciente }}</td>
            <td>{{ x.convenioNome || x.convenio }}</td>
            <td :data-testid="`ctas-situacao-${x.id}`">
              {{ x.situacaoRotulo }}
            </td>
            <td>
              {{ data(x.alta)
              }}<span v-if="x.diasDesdeAlta !== null" class="secundario"> ({{ x.diasDesdeAlta }})</span>
            </td>
            <td>{{ reais(x.total) }}</td>
            <td>{{ x.pendencias || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div class="filtros">
        <button type="button" :disabled="pagina === 0" @click="pagina -= 1">
          {{ t('faturamento.anterior') }}
        </button>
        <button
          type="button"
          :disabled="(pagina + 1) * c.data.value.porPagina >= c.data.value.total"
          @click="pagina += 1"
        >
          {{ t('faturamento.proxima') }}
        </button>
      </div>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
