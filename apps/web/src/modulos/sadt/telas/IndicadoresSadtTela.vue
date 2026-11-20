<script setup lang="ts">
// Indicadores e parâmetros do diagnóstico (ficha do M26, regras 10 e 12): `/sadt/indicadores`. O tempo do pedido à
// liberação por setor e prioridade (só os exames com as duas marcas, as parcelas impressas), os exames por dia, os
// pendentes há mais de 24 horas e os vistos no portal; e os parâmetros do setor da sessão sem os segredos guardados
// (os campos ocultos aparecem só pelo nome).
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import { lerIndicadoresSadt, lerParametrosSadt } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';
import { hojeLocal } from '../usar-sadt.js';

const { t } = useI18n();
const hoje = hojeLocal();
const inicio = ref(`${hoje.slice(0, 7)}-01`);
const fim = ref(hoje);
const setor = ref('');
const veParametros = podePermissao('sadt.parametro.ler');
const indicadores = useQuery({
  queryKey: computed(() => ['sadt', 'indicadores', inicio.value, fim.value, setor.value]),
  queryFn: () => lerIndicadoresSadt(inicio.value, fim.value, setor.value || null),
});
const parametros = useQuery({
  queryKey: computed(() => ['sadt', 'parametros', setor.value || 'laboratorio']),
  queryFn: () => lerParametrosSadt(setor.value || 'laboratorio'),
  enabled: veParametros,
});
const setores = computed(() => [
  { valor: '', rotulo: t('sadt.situacoes.todos') },
  ...(['laboratorio', 'imagem', 'metodosGraficos', 'endoscopia'] as const).map((s) => ({
    valor: s,
    rotulo: t(`sadt.setores.${s}`),
  })),
]);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ind-sadt-titulo" data-testid="tela-sadt-indicadores">
    <h1 id="ind-sadt-titulo">{{ t('sadt.parametros.titulo') }}</h1>
    <p>{{ t('sadt.parametros.texto') }}</p>
    <div class="filtros">
      <span class="campo">
        <label for="ind-inicio">{{ t('sadt.parametros.inicio') }}</label>
        <input id="ind-inicio" v-model="inicio" type="date" />
      </span>
      <span class="campo">
        <label for="ind-fim">{{ t('sadt.parametros.fim') }}</label>
        <input id="ind-fim" v-model="fim" type="date" />
      </span>
      <SanteSelecao v-model="setor" :rotulo="t('sadt.setor')" :opcoes="setores" />
    </div>
    <ErroSadt v-if="indicadores.isError.value" :erro="indicadores.error.value" />
    <p v-else-if="!indicadores.data.value" role="status">{{ t('sadt.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="tabela-tat">
        <caption>
          {{
            t('sadt.parametros.tat')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('sadt.setor') }}</th>
            <th scope="col">{{ t('sadt.rotina') }} / {{ t('sadt.urgente') }}</th>
            <th scope="col">{{ t('sadt.parametros.exames') }}</th>
            <th scope="col">{{ t('sadt.parametros.liberados') }}</th>
            <th scope="col">{{ t('sadt.parametros.comMarcas') }}</th>
            <th scope="col">{{ t('sadt.parametros.semMarcas') }}</th>
            <th scope="col">{{ t('sadt.parametros.media') }}</th>
            <th scope="col">{{ t('sadt.parametros.mediaPedidoColeta') }}</th>
            <th scope="col">{{ t('sadt.parametros.mediaColetaLiberacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in indicadores.data.value.linhas" :key="`${l.setor}-${l.prioridade}`">
            <td>{{ t(`sadt.setores.${l.setor}`) }}</td>
            <td>{{ l.prioridade === 'urgente' ? t('sadt.urgente') : t('sadt.rotina') }}</td>
            <td>{{ l.exames }}</td>
            <td>{{ l.liberados }}</td>
            <td>{{ l.comMarcas }}</td>
            <td>{{ l.semMarcas }}</td>
            <td>{{ l.mediaMinutosPedidoLiberacao ?? '—' }}</td>
            <td>
              {{ l.mediaMinutosPedidoColeta ?? '—' }}
              <span class="secundario">{{ t('sadt.parametros.parcela', { n: l.comColeta }) }}</span>
            </td>
            <td>
              {{ l.mediaMinutosColetaLiberacao ?? '—' }}
              <span class="secundario">{{ t('sadt.parametros.parcela', { n: l.comColetaLiberacao }) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p>{{ t('sadt.parametros.pendentes', { n: indicadores.data.value.pendentesMais24h }) }}</p>
      <p>{{ t('sadt.parametros.portal', indicadores.data.value.visualizadosPortal) }}</p>
      <details>
        <summary>{{ t('sadt.parametros.porDia') }}</summary>
        <ul>
          <li v-for="d in indicadores.data.value.porDia" :key="d.dia">
            {{ d.dia.split('-').reverse().join('/') }}: {{ d.exames }}
          </li>
        </ul>
      </details>
    </template>
    <section
      v-if="veParametros && parametros.data.value"
      class="painel"
      aria-labelledby="param-titulo"
      data-testid="sadt-parametros"
    >
      <h2 id="param-titulo">{{ t('sadt.parametros.campos') }}</h2>
      <dl>
        <template v-for="c in parametros.data.value.campos" :key="c.campo">
          <dt>{{ c.rotulo }}</dt>
          <dd>{{ c.valor }}</dd>
        </template>
      </dl>
      <p v-if="parametros.data.value.ocultos.length" class="secundario">
        {{ t('sadt.parametros.ocultos', { campos: parametros.data.value.ocultos.join(', ') }) }}
      </p>
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
