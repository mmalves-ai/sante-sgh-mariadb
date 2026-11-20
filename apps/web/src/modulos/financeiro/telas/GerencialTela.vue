<script setup lang="ts">
// Classificação gerencial e DRE gerencial (ficha do M32, seção 7): `/financeiro/gerencial`. A DRE nas duas réguas
// (competência e caixa) mês a mês, com a divergência da receita entre elas e a abertura das despesas por grupo; os
// indicadores com as parcelas de cada um impressas (toda conta agregada mostra de onde veio); a apropriação gerencial
// (grupo, subgrupo e item) dos documentos a pagar do período, paginada no servidor e filtrada pelo grupo, com o rateio
// por centro de custo. A edição da classificação depois do lançamento fica para a receita própria (D-CLASSIF-32).
import { SanteSelecao } from '@sgh/ui';
import { RouterLink } from 'vue-router';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import { lerDre, lerIndicadores, listarApropriacoes } from '../api-financeiro.js';
import { data, num, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const { tem, apoio } = usarFinanceiro();
const filtroAp = reactive({ de: '', ate: '', grupo: '' });
const pedidoAp = ref({ ...filtroAp });
const paginaAp = ref(0);
const apropriacoes = useQuery({
  queryKey: computed(() => ['financeiro', 'apropriacoes', pedidoAp.value, paginaAp.value]),
  queryFn: () => listarApropriacoes({ ...pedidoAp.value, pagina: paginaAp.value }),
});
const grupos = computed(() => [
  { valor: '', rotulo: t('financeiro.gerencial.todosGrupos') },
  ...[...new Map((apoio.data.value?.classificacoes ?? []).map((c) => [c.grupo, c])).values()].map((c) => ({
    valor: String(c.grupo),
    rotulo: `${c.grupo} — ${c.nome}`,
  })),
]);
const consultarAp = () => {
  paginaAp.value = 0;
  pedidoAp.value = { ...filtroAp };
};
const filtro = reactive({ de: '', ate: '', regua: 'competencia' });
const pedido = ref({ ...filtro });
const dre = useQuery({
  queryKey: computed(() => ['financeiro', 'dre', pedido.value]),
  queryFn: () => lerDre(pedido.value),
});
const indicadores = useQuery({
  queryKey: ['financeiro', 'indicadores'],
  queryFn: () => lerIndicadores({}),
  enabled: computed(() => tem('financeiro.indicador.ler')),
});
const reguas = computed(() =>
  (['competencia', 'caixa'] as const).map((r) => ({
    valor: r,
    rotulo: t(`financeiro.gerencial.reguas.${r}`),
  })),
);
const valorIndicador = (v: number, u: string) => (u === '%' ? `${num(v)}%` : num(v));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="gr-titulo" data-testid="tela-fin-gerencial">
    <h1 id="gr-titulo">{{ t('financeiro.gerencial.titulo') }}</h1>
    <p>{{ t('financeiro.gerencial.texto') }}</p>
    <form class="filtros" @submit.prevent="pedido = { ...filtro }">
      <span class="campo">
        <label for="gr-de">{{ t('financeiro.de') }}</label>
        <input id="gr-de" v-model="filtro.de" type="month" data-testid="gr-de" />
      </span>
      <span class="campo">
        <label for="gr-ate">{{ t('financeiro.ate') }}</label>
        <input id="gr-ate" v-model="filtro.ate" type="month" data-testid="gr-ate" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="filtro.regua"
          :rotulo="t('financeiro.gerencial.regua')"
          :opcoes="reguas"
          data-testid="gr-regua"
        />
      </span>
      <button type="submit" data-testid="gr-consultar">{{ t('financeiro.consultar') }}</button>
    </form>
    <ErroFaturamento v-if="dre.error.value" :erro="dre.error.value" />
    <p v-else-if="dre.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <template v-else-if="dre.data.value">
      <table class="tabela" data-testid="gr-dre">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.gerencial.mes') }}</th>
            <th scope="col">{{ t('financeiro.gerencial.receitaCompetencia') }}</th>
            <th scope="col">{{ t('financeiro.gerencial.glosaAceita') }}</th>
            <th scope="col">{{ t('financeiro.gerencial.receitaLiquida') }}</th>
            <th scope="col">{{ t('financeiro.gerencial.receitaCaixa') }}</th>
            <th scope="col">{{ t('financeiro.gerencial.despesaCompetencia') }}</th>
            <th scope="col">{{ t('financeiro.gerencial.despesaCaixa') }}</th>
            <th scope="col">{{ t('financeiro.gerencial.resultadoCompetencia') }}</th>
            <th scope="col">{{ t('financeiro.gerencial.resultadoCaixa') }}</th>
            <th scope="col">{{ t('financeiro.gerencial.divergencia') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in dre.data.value.linhas" :key="l.mes">
            <td>{{ l.mes }}</td>
            <td>{{ reais(l.receitaCompetencia) }}</td>
            <td>{{ reais(l.glosaAceita) }}</td>
            <td>{{ reais(l.receitaLiquidaCompetencia) }}</td>
            <td>{{ reais(l.receitaCaixa) }}</td>
            <td>{{ reais(l.despesaCompetencia) }}</td>
            <td>{{ reais(l.despesaCaixa) }}</td>
            <td>{{ reais(l.resultadoCompetencia) }}</td>
            <td>{{ reais(l.resultadoCaixa) }}</td>
            <td>{{ l.divergenciaReceita === null ? '—' : reais(l.divergenciaReceita) }}</td>
          </tr>
        </tbody>
      </table>
      <h2>{{ t('financeiro.gerencial.aberturaDespesas') }}</h2>
      <table v-if="dre.data.value.aberturaDespesas.length" class="tabela" data-testid="gr-despesas">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.gerencial.grupo') }}</th>
            <th scope="col">{{ t('financeiro.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in dre.data.value.aberturaDespesas" :key="d.grupo">
            <td>{{ d.grupo }}</td>
            <td>{{ reais(d.valor) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('financeiro.nenhum') }}</p>
    </template>
    <h2>{{ t('financeiro.gerencial.apropriacoes') }}</h2>
    <p>{{ t('financeiro.gerencial.apropriacoesTexto') }}</p>
    <form class="filtros" @submit.prevent="consultarAp">
      <span class="campo">
        <label for="ap-de">{{ t('financeiro.de') }}</label>
        <input id="ap-de" v-model="filtroAp.de" type="date" data-testid="ap-de" />
      </span>
      <span class="campo">
        <label for="ap-ate">{{ t('financeiro.ate') }}</label>
        <input id="ap-ate" v-model="filtroAp.ate" type="date" data-testid="ap-ate" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="filtroAp.grupo"
          :rotulo="t('financeiro.gerencial.grupo')"
          :opcoes="grupos"
          data-testid="ap-grupo"
        />
      </span>
      <button type="submit" data-testid="ap-consultar">{{ t('financeiro.consultar') }}</button>
    </form>
    <ErroFaturamento v-if="apropriacoes.error.value" :erro="apropriacoes.error.value" />
    <p v-else-if="apropriacoes.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <template v-else-if="apropriacoes.data.value">
      <table v-if="apropriacoes.data.value.itens.length" class="tabela" data-testid="gr-apropriacoes">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.data') }}</th>
            <th scope="col">{{ t('financeiro.credor') }}</th>
            <th scope="col">{{ t('financeiro.documento') }}</th>
            <th scope="col">{{ t('financeiro.gerencial.item') }}</th>
            <th scope="col">{{ t('financeiro.valor') }}</th>
            <th scope="col">{{ t('financeiro.gerencial.centrosCusto') }}</th>
            <th scope="col">{{ t('financeiro.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="x in apropriacoes.data.value.itens"
            :key="`${x.credor}-${x.documento}-${x.tipo}-${x.serie}`"
          >
            <td>{{ data(x.data) }}</td>
            <td>{{ x.credor }}</td>
            <td>{{ x.documento }}</td>
            <td>{{ x.grupo }}.{{ x.subgrupo }}.{{ x.item }}{{ x.nome ? ` — ${x.nome}` : '' }}</td>
            <td>{{ reais(x.valor) }}</td>
            <td>{{ x.centrosCusto || t('financeiro.gerencial.semRateio') }}</td>
            <td>
              <RouterLink
                v-if="x.titulo && tem('financeiro.tituloPagar.ler')"
                :to="`/financeiro/pagar/titulos/${x.titulo}`"
              >
                {{ t('financeiro.abrir') }}
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('financeiro.nenhum') }}</p>
      <nav class="paginacao">
        <button type="button" :disabled="paginaAp <= 0" @click="paginaAp--">
          {{ t('financeiro.anterior') }}
        </button>
        <span>{{ paginaAp + 1 }}</span>
        <button type="button" :disabled="!apropriacoes.data.value.mais" @click="paginaAp++">
          {{ t('financeiro.proxima') }}
        </button>
      </nav>
    </template>
    <template v-if="tem('financeiro.indicador.ler')">
      <h2>{{ t('financeiro.gerencial.indicadores') }}</h2>
      <ErroFaturamento v-if="indicadores.error.value" :erro="indicadores.error.value" />
      <ul v-else-if="indicadores.data.value" class="cartoes" data-testid="gr-indicadores">
        <li v-for="i in indicadores.data.value" :key="i.codigo" :data-testid="`gr-indicador-${i.codigo}`">
          <strong>{{ i.titulo }}: {{ valorIndicador(i.valor, i.unidade) }}</strong>
          <ul :aria-label="t('financeiro.gerencial.parcelasDoIndicador')">
            <li v-for="p in i.parcelas" :key="p.rotulo">{{ p.rotulo }}: {{ num(p.valor) }}</li>
          </ul>
        </li>
      </ul>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
