<script setup lang="ts">
// Histórico de ocupação (ficha do M21, seção 7): `/leitos/historico`. Os períodos de leito (trechos) da trajetória no
// período escolhido (até 366 dias), por bloco, paginados no servidor, com as horas de cada trecho.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../agenda/formato.js';
import { lerHistorico, lerMapa } from '../api-adt.js';
import ErroAdt from '../componentes/ErroAdt.vue';
import { hhmm, leitoTexto } from '../regras-tela.js';

const { t } = useI18n();
const inicio = ref('');
const fim = ref('');
const bloco = ref('');
const pagina = ref(1);
const filtro = ref({ inicio: '', fim: '', bloco: '' });
const mapa = useQuery({ queryKey: ['adt', 'mapa'], queryFn: () => lerMapa() });
const historico = useQuery({
  queryKey: computed(() => ['adt', 'historico', filtro.value, pagina.value]),
  queryFn: () => lerHistorico({ ...filtro.value, pagina: pagina.value }),
});
const blocos = computed(() => [
  { valor: '', rotulo: t('adt.todos') },
  ...(mapa.data.value?.painel.blocos ?? []).map((b) => ({ valor: b.bloco, rotulo: b.nome })),
]);
const paginas = computed(() => {
  const h = historico.data.value;
  return h ? Math.max(1, Math.ceil(h.total / h.porPagina)) : 1;
});
function aplicar(): void {
  filtro.value = { inicio: inicio.value, fim: fim.value, bloco: bloco.value };
  pagina.value = 1;
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="hist-titulo" data-testid="tela-historico-ocupacao">
    <h1 id="hist-titulo">{{ t('adt.historico.titulo') }}</h1>
    <p>{{ t('adt.historico.texto') }}</p>
    <form class="filtros" @submit.prevent="aplicar">
      <div class="campo">
        <label for="hist-inicio">{{ t('adt.historico.inicio') }}</label>
        <input id="hist-inicio" v-model="inicio" type="date" />
      </div>
      <div class="campo">
        <label for="hist-fim">{{ t('adt.historico.fim') }}</label>
        <input id="hist-fim" v-model="fim" type="date" />
      </div>
      <SanteSelecao v-model="bloco" :rotulo="t('adt.bloco')" :opcoes="blocos" />
      <SanteBotao tipo="submit" :rotulo="t('adt.buscar')" data-testid="hist-buscar" />
    </form>
    <ErroAdt v-if="historico.isError.value" :erro="historico.error.value" />
    <p v-else-if="!historico.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <p class="secundario">{{ t('adt.historico.total', { n: historico.data.value.total }) }}</p>
      <table v-if="historico.data.value.itens.length" class="tabela" data-testid="tabela-historico">
        <caption class="secundario">
          {{
            t('adt.historico.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('adt.internacao') }}</th>
            <th scope="col">{{ t('adt.leito') }}</th>
            <th scope="col">{{ t('adt.historico.tipo') }}</th>
            <th scope="col">{{ t('adt.entrada') }}</th>
            <th scope="col">{{ t('adt.saida') }}</th>
            <th scope="col">{{ t('adt.historico.horas') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(x, i) in historico.data.value.itens" :key="`${x.internacao}-${i}`">
            <td>{{ x.internacao }}</td>
            <td>{{ leitoTexto(x.leito) }}</td>
            <td>{{ x.tipo.nome }}</td>
            <td>{{ dataBr(x.entrada) }} {{ hhmm(x.horaEntrada) }}</td>
            <td>{{ x.saida ? `${dataBr(x.saida)} ${hhmm(x.horaSaida)}` : t('adt.historico.emCurso') }}</td>
            <td>{{ x.horas }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('adt.nenhum') }}</p>
      <p class="acoes">
        <SanteBotao
          variante="secundario"
          :rotulo="t('adt.historico.anterior')"
          :desabilitado="pagina <= 1"
          @acionar="pagina--"
        />
        <span>{{ t('adt.historico.pagina', { p: pagina }) }}</span>
        <SanteBotao
          variante="secundario"
          :rotulo="t('adt.historico.proxima')"
          :desabilitado="pagina >= paginas"
          @acionar="pagina++"
        />
      </p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
