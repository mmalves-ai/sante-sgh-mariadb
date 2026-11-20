<script setup lang="ts">
// Indicadores de manutenção (M55, etapa 1; regra 3): disponibilidade, MTBF e MTTR do período (até 366 dias), com o
// recorte por setor e criticidade, cada número com a conta impressa e as parcelas, e a tabela por equipamento.
import type { CriticidadeEquipamento } from '@sgh/contratos';
import { SanteBotao, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerIndicadores } from '../api-manutencao.js';
import { comTodos, contasDosIndicadores, inicioDoMes, numero2, OPCOES } from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';
import type { ApoioManutencao } from '@sgh/contratos';

const props = defineProps<{ apoio: ApoioManutencao }>();
const { t } = useI18n();
const inicio = ref<string | null>(inicioDoMes(props.apoio.hoje));
const fim = ref<string | null>(props.apoio.hoje);
const centroCusto = ref<number | null>(null);
const criticidade = ref<CriticidadeEquipamento | null>(null);
const pedido = ref({
  inicio: inicio.value ?? '',
  fim: fim.value ?? '',
  centroCusto: null as number | null,
  criticidade: null as CriticidadeEquipamento | null,
});
function calcular() {
  if (!inicio.value || !fim.value) return;
  pedido.value = {
    inicio: inicio.value,
    fim: fim.value,
    centroCusto: centroCusto.value,
    criticidade: criticidade.value,
  };
}
const consulta = useQuery({
  queryKey: computed(() => ['manutencao', 'indicadores', pedido.value]),
  queryFn: () => lerIndicadores(pedido.value),
});
const i = computed(() => consulta.data.value ?? null);
const contas = computed(() => (i.value ? contasDosIndicadores(i.value) : null));
const opcoesSetor = computed(() =>
  comTodos(
    t('manutencao.todos'),
    props.apoio.setores.map((s) => ({ valor: s.codigo, rotulo: `${s.nome} (${s.codigo})` })),
  ),
);
const opcoesCriticidade = computed(() => comTodos(t('manutencao.todos'), OPCOES.criticidade));
const n2 = (v: number | null) => (v === null ? '' : numero2(v));
</script>

<template>
  <section class="tela-manutencao" aria-labelledby="indicadores-titulo" data-testid="indicadores-manutencao">
    <h2 id="indicadores-titulo">{{ t('manutencao.indicadores.titulo') }}</h2>
    <form class="campos" data-testid="indicadores-filtros" @submit.prevent="calcular">
      <SanteData
        v-model="inicio"
        editavel
        :rotulo="t('manutencao.indicadores.inicio')"
        :maximo="apoio.hoje"
        data-testid="indicadores-inicio"
      />
      <SanteData
        v-model="fim"
        editavel
        :rotulo="t('manutencao.indicadores.fim')"
        :maximo="apoio.hoje"
        data-testid="indicadores-fim"
      />
      <SanteSelecao
        v-model="centroCusto"
        :rotulo="t('manutencao.equipamentos.filtro.setor')"
        :opcoes="opcoesSetor"
        busca
        data-testid="indicadores-setor"
      />
      <SanteSelecao
        v-model="criticidade"
        :rotulo="t('manutencao.equipamentos.filtro.criticidade')"
        :opcoes="opcoesCriticidade"
        data-testid="indicadores-criticidade"
      />
      <SanteBotao
        tipo="submit"
        variante="secundario"
        :rotulo="t('manutencao.indicadores.calcular')"
        data-testid="indicadores-calcular"
      />
    </form>
    <ErroManutencao v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="!i || !contas" role="status">{{ t('manutencao.carregando') }}</p>
    <template v-else>
      <p class="secundario">{{ t('manutencao.indicadores.equipamentos', { n: i.equipamentos }) }}</p>
      <div class="numeros" data-testid="indicadores-numeros">
        <div class="numero" data-testid="indicador-disponibilidade">
          <span>{{ t('manutencao.indicadores.disponibilidade') }}</span>
          <strong>{{ i.disponibilidade === null ? '' : `${numero2(i.disponibilidade)}%` }}</strong>
          <span v-if="contas.disponibilidade" class="secundario">{{
            t('manutencao.indicadores.contas.disponibilidade', contas.disponibilidade)
          }}</span>
        </div>
        <div class="numero" data-testid="indicador-mtbf">
          <span>{{ t('manutencao.indicadores.mtbf') }}</span>
          <strong>{{
            i.mtbf === null
              ? t('manutencao.indicadores.semFalha')
              : t('manutencao.indicadores.horas', { h: numero2(i.mtbf) })
          }}</strong>
          <span v-if="contas.mtbf" class="secundario">{{
            t('manutencao.indicadores.contas.mtbf', contas.mtbf)
          }}</span>
        </div>
        <div class="numero" data-testid="indicador-mttr">
          <span>{{ t('manutencao.indicadores.mttr') }}</span>
          <strong>{{
            i.mttr === null
              ? t('manutencao.indicadores.semReparo')
              : t('manutencao.indicadores.horas', { h: numero2(i.mttr) })
          }}</strong>
          <span v-if="contas.mttr" class="secundario">{{
            t('manutencao.indicadores.contas.mttr', contas.mttr)
          }}</span>
        </div>
      </div>
      <dl class="ficha" data-testid="indicadores-parcelas">
        <dt>{{ t('manutencao.indicadores.parcelas.horasPeriodo') }}</dt>
        <dd>{{ numero2(i.parcelas.horasPeriodo) }}</dd>
        <dt>{{ t('manutencao.indicadores.parcelas.horasParadas') }}</dt>
        <dd>{{ numero2(i.parcelas.horasParadas) }}</dd>
        <dt>{{ t('manutencao.indicadores.parcelas.horasOperacao') }}</dt>
        <dd>{{ numero2(i.parcelas.horasOperacao) }}</dd>
        <dt>{{ t('manutencao.indicadores.parcelas.falhas') }}</dt>
        <dd>{{ i.parcelas.falhas }}</dd>
        <dt>{{ t('manutencao.indicadores.parcelas.reparos') }}</dt>
        <dd>{{ i.parcelas.reparos }}</dd>
        <dt>{{ t('manutencao.indicadores.parcelas.horasReparo') }}</dt>
        <dd>{{ numero2(i.parcelas.horasReparo) }}</dd>
      </dl>
      <h3>{{ t('manutencao.indicadores.porEquipamento') }}</h3>
      <p v-if="i.porEquipamento.length === 0">{{ t('manutencao.nenhum') }}</p>
      <div v-else class="rolagem">
        <table class="tabela" data-testid="indicadores-por-equipamento">
          <thead>
            <tr>
              <th scope="col">{{ t('manutencao.os.colunas.equipamento') }}</th>
              <th scope="col">{{ t('manutencao.indicadores.disponibilidade') }}</th>
              <th scope="col">{{ t('manutencao.indicadores.parcelas.horasParadas') }}</th>
              <th scope="col">{{ t('manutencao.indicadores.parcelas.falhas') }}</th>
              <th scope="col">{{ t('manutencao.indicadores.mtbf') }}</th>
              <th scope="col">{{ t('manutencao.indicadores.parcelas.reparos') }}</th>
              <th scope="col">{{ t('manutencao.indicadores.parcelas.horasReparo') }}</th>
              <th scope="col">{{ t('manutencao.indicadores.mttr') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in i.porEquipamento" :key="x.equipamento.id">
              <td>{{ x.equipamento.codigo }} - {{ x.equipamento.nome }}</td>
              <td>{{ x.disponibilidade === null ? '' : `${numero2(x.disponibilidade)}%` }}</td>
              <td>{{ numero2(x.horasParadas) }}</td>
              <td>{{ x.falhas }}</td>
              <td>{{ n2(x.mtbf) }}</td>
              <td>{{ x.reparos }}</td>
              <td>{{ numero2(x.horasReparo) }}</td>
              <td>{{ n2(x.mttr) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped src="./estilo-manutencao.css"></style>
