<script setup lang="ts">
// Painel de glosas e ciclo de receita (ficha do M31, seção 7; regras 10 e 11): `/relatorios/glosas`. Só agregados, pela
// competência (a régua declarada): as DUAS réguas de glosa (a líquida, em que o pago a maior abate, e a positiva), o
// contestado, o recuperado, o êxito ("não recorreu" quando não houve recurso), o que nunca foi recorrido, por motivo,
// convênio, faturador e faixa de valor (fechadas à esquerda), o ciclo do recurso (só de 0 a 3.650 dias) e a fila. M42:
// a seção "Acompanhamento da competência" (contas por sistema, lotes, glosas, títulos, repasse e a conferência).
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import AcompanhamentoCompetenciaPainel from '../componentes/AcompanhamentoCompetenciaPainel.vue';
import { lerPainel, urlExportacaoPainel } from '../api-tiss.js';
import { quando, reais, usarTiss } from '../usar-tiss.js';

const { t } = useI18n();
const { apoio } = usarTiss('glosa');
const de = ref('');
const ate = ref('');
const filtro = ref<{ de?: string; ate?: string }>({});
const p = useQuery({
  queryKey: computed(() => ['tiss', 'painel', filtro.value]),
  queryFn: () => lerPainel(filtro.value),
});
const pct = (v: number | null) => (v === null ? t('tiss.painel.semBase') : `${v.toLocaleString('pt-BR')}%`);
function aplicar() {
  filtro.value = { ...(de.value ? { de: de.value } : {}), ...(ate.value ? { ate: ate.value } : {}) };
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pg-titulo" data-testid="tela-tiss-painel">
    <h1 id="pg-titulo">{{ t('tiss.painel.titulo') }}</h1>
    <p>{{ t('tiss.painel.texto') }}</p>
    <form class="filtros" @submit.prevent="aplicar">
      <span class="campo">
        <label for="pg-de">{{ t('tiss.painel.de') }}</label>
        <input id="pg-de" v-model="de" type="month" data-testid="pg-de" />
      </span>
      <span class="campo">
        <label for="pg-ate">{{ t('tiss.painel.ate') }}</label>
        <input id="pg-ate" v-model="ate" type="month" data-testid="pg-ate" />
      </span>
      <button type="submit" data-testid="pg-aplicar">{{ t('tiss.consultar') }}</button>
      <a :href="urlExportacaoPainel(filtro)" data-testid="pg-exportar">{{ t('tiss.painel.exportar') }}</a>
    </form>
    <ErroFaturamento v-if="p.error.value" :erro="p.error.value" />
    <p v-else-if="!p.data.value" role="status">{{ t('tiss.carregando') }}</p>
    <template v-else>
      <p class="secundario" data-testid="pg-regua">
        {{ t('tiss.painel.regua', { de: p.data.value.de, ate: p.data.value.ate }) }} ·
        {{
          p.data.value.emCache
            ? t('tiss.painel.emCache', { em: quando(p.data.value.geradoEm) })
            : t('tiss.painel.agora')
        }}
      </p>
      <dl class="resumo" data-testid="pg-somas">
        <dt>{{ t('tiss.painel.emitido') }}</dt>
        <dd>
          {{ reais(p.data.value.somas.emitido) }} ({{ p.data.value.somas.itensEmitidos }}
          {{ t('tiss.itens') }})
        </dd>
        <dt>{{ t('tiss.painel.conciliado') }}</dt>
        <dd>
          {{ reais(p.data.value.somas.conciliado) }} ({{ p.data.value.somas.itensConciliados }}
          {{ t('tiss.itens') }})
        </dd>
        <dt>{{ t('tiss.pago') }}</dt>
        <dd>{{ reais(p.data.value.somas.pago) }}</dd>
        <dt>{{ t('tiss.painel.glosaLiquida') }}</dt>
        <dd data-testid="pg-liquida">
          {{ reais(p.data.value.somas.glosaLiquida) }} · {{ pct(p.data.value.indicadores.taxaLiquida) }}
        </dd>
        <dt>{{ t('tiss.painel.glosaPositiva') }}</dt>
        <dd data-testid="pg-positiva">
          {{ reais(p.data.value.somas.glosaPositiva) }} · {{ pct(p.data.value.indicadores.taxaPositiva) }}
          <span class="secundario"
            >({{ t('tiss.painel.pagosAMaior', { n: p.data.value.somas.itensPagosAMaior }) }})</span
          >
        </dd>
        <dt>{{ t('tiss.painel.contestado') }}</dt>
        <dd>{{ reais(p.data.value.somas.contestado) }}</dd>
        <dt>{{ t('tiss.painel.recuperado') }}</dt>
        <dd>{{ reais(p.data.value.somas.recuperado) }}</dd>
        <dt>{{ t('tiss.painel.exito') }}</dt>
        <dd data-testid="pg-exito">{{ p.data.value.indicadores.exitoRotulo }}</dd>
        <dt>{{ t('tiss.painel.nuncaRecorrido') }}</dt>
        <dd>{{ reais(p.data.value.somas.nuncaRecorrido) }}</dd>
        <dt>{{ t('tiss.painel.fila') }}</dt>
        <dd>{{ t('tiss.painel.filaTexto', p.data.value.fila) }}</dd>
        <dt>{{ t('tiss.painel.ciclo') }}</dt>
        <dd>
          {{
            p.data.value.ciclo.mediaDias === null
              ? '—'
              : t('tiss.prazos.dias', { n: p.data.value.ciclo.mediaDias })
          }}
        </dd>
      </dl>
      <h2>{{ t('tiss.painel.porMotivo') }}</h2>
      <table class="tabela" data-testid="pg-motivos">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.motivo') }}</th>
            <th scope="col">{{ t('tiss.itens') }}</th>
            <th scope="col">{{ t('tiss.glosa') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in p.data.value.porMotivo" :key="m.codigo">
            <td>{{ m.codigo }} {{ m.nome }}</td>
            <td>{{ m.itens }}</td>
            <td>{{ reais(m.glosa) }}</td>
          </tr>
        </tbody>
      </table>
      <h2>{{ t('tiss.painel.porConvenio') }}</h2>
      <table class="tabela" data-testid="pg-convenios">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.convenio') }}</th>
            <th scope="col">{{ t('tiss.painel.conciliado') }}</th>
            <th scope="col">{{ t('tiss.glosa') }}</th>
            <th scope="col">{{ t('tiss.painel.contestado') }}</th>
            <th scope="col">{{ t('tiss.painel.recuperado') }}</th>
            <th scope="col">{{ t('tiss.painel.exito') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in p.data.value.porConvenio" :key="c.convenio">
            <td>{{ c.nome || c.convenio }}</td>
            <td>{{ reais(c.conciliado) }}</td>
            <td>{{ reais(c.glosa) }}</td>
            <td>{{ reais(c.contestado) }}</td>
            <td>{{ reais(c.recuperado) }}</td>
            <td>{{ c.exitoRotulo }}</td>
          </tr>
        </tbody>
      </table>
      <h2>{{ t('tiss.painel.porFaturador') }}</h2>
      <table class="tabela" data-testid="pg-faturadores">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.painel.faturador') }}</th>
            <th scope="col">{{ t('tiss.itens') }}</th>
            <th scope="col">{{ t('tiss.glosa') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in p.data.value.porFaturador" :key="f.faturador">
            <td>{{ f.faturador }}</td>
            <td>{{ f.itens }}</td>
            <td>{{ reais(f.glosa) }}</td>
          </tr>
        </tbody>
      </table>
      <h2>{{ t('tiss.painel.porFaixa') }}</h2>
      <table class="tabela" data-testid="pg-faixas">
        <thead>
          <tr>
            <th scope="col">{{ t('tiss.painel.faixa') }}</th>
            <th scope="col">{{ t('tiss.itens') }}</th>
            <th scope="col">{{ t('tiss.glosa') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in p.data.value.porFaixa" :key="f.faixa">
            <td>{{ f.faixa }}</td>
            <td>{{ f.itens }}</td>
            <td>{{ reais(f.glosa) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="secundario">{{ t('tiss.painel.hoje', { hoje: apoio.data.value?.hoje ?? '' }) }}</p>
    </template>
    <!-- M42: acompanhamento da competência da onda 4 (campo 7), na mesma rota do painel. -->
    <AcompanhamentoCompetenciaPainel />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
