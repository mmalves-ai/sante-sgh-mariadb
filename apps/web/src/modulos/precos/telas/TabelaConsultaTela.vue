<script setup lang="ts">
// "Diárias, taxas e gases" e "Materiais e medicamentos (Brasíndice, Simpro, TUSS)" (M12, ficha seção 7): a
// tabela escolhida com o valor que vale na data-base, paginada no servidor. Consulta neste marco (a carga
// oficial de mat/med é do importador de catálogos). Cada item abre a linha do tempo das suas vigências
// (TBVLRDTH ou TBVLRMEM).
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarDiarias,
  buscarEdicoes,
  buscarMatmed,
  buscarVigenciasValor,
  listarTabelas,
} from '../api-precos.js';

const props = defineProps<{ tipo: 'diarias' | 'matmed' }>();
const { t } = useI18n();
const tabelas = useQuery({
  queryKey: computed(() => ['tabelas', props.tipo]),
  queryFn: () => listarTabelas(props.tipo),
});
const tab = ref<number | null>(null);
const opcoesTabela = computed(() =>
  (tabelas.data.value ?? []).map((x) => ({
    valor: x.codigo as number | null,
    rotulo: `${x.codigo} — ${x.nome}`,
  })),
);
watch(
  () => tabelas.data.value,
  (l) => {
    if (tab.value === null && l && l.length > 0) tab.value = l[0]?.codigo ?? null;
  },
  { immediate: true },
);
const busca = ref('');
const termo = ref('');
const data = ref('');
const pagina = ref(0);
watch([tab, termo, data], () => (pagina.value = 0));
const diarias = useQuery({
  queryKey: computed(() => ['diarias', tab.value, termo.value, data.value, pagina.value]),
  queryFn: () =>
    buscarDiarias(tab.value as number, {
      busca: termo.value,
      pagina: pagina.value,
      data: data.value || null,
    }),
  enabled: computed(() => props.tipo === 'diarias' && tab.value !== null),
});
const matmed = useQuery({
  queryKey: computed(() => ['matmed', tab.value, termo.value, data.value, pagina.value]),
  queryFn: () =>
    buscarMatmed(tab.value as number, { busca: termo.value, pagina: pagina.value, data: data.value || null }),
  enabled: computed(() => props.tipo === 'matmed' && tab.value !== null),
});
const edicoes = useQuery({
  queryKey: ['edicoes'],
  queryFn: () => buscarEdicoes(),
  enabled: computed(() => props.tipo === 'matmed'),
});
const total = computed(
  () => (props.tipo === 'diarias' ? diarias.data.value?.total : matmed.data.value?.total) ?? 0,
);
const totalPaginas = computed(() => Math.max(1, Math.ceil(total.value / 50)));
// Linha do tempo do item escolhido (a operação na diária; o código no mat/med).
const itemAberto = ref<number | null>(null);
watch([tab, () => props.tipo], () => (itemAberto.value = null));
const vigencias = useQuery({
  queryKey: computed(() => ['vigencias-valor', props.tipo, tab.value, itemAberto.value]),
  queryFn: () => buscarVigenciasValor(props.tipo, tab.value as number, itemAberto.value as number),
  enabled: computed(() => tab.value !== null && itemAberto.value !== null),
});
const dinheiro = (v: number | null) =>
  v === null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
</script>

<template>
  <section class="tela" aria-labelledby="tabela-titulo">
    <h1 id="tabela-titulo">{{ t(`precos.${tipo}.titulo`) }}</h1>
    <p>{{ t(`precos.${tipo}.texto`) }}</p>
    <nav
      v-if="tipo === 'matmed' && pode('catalogo.carga.criar')"
      :aria-label="t('precos.matmed.cargaEdicao')"
      data-testid="matmed-carga"
    >
      <!-- Brasíndice e Simpro entram pelo mesmo motor de carga dos catálogos (M13), já com o catálogo escolhido. -->
      <RouterLink
        :to="{ name: 'catalogos.painel', query: { catalogo: 'brasindice' } }"
        data-testid="matmed-carga-brasindice"
        >{{ t('precos.matmed.enviarBrasindice') }}</RouterLink
      >
      ·
      <RouterLink
        :to="{ name: 'catalogos.painel', query: { catalogo: 'simpro' } }"
        data-testid="matmed-carga-simpro"
        >{{ t('precos.matmed.enviarSimpro') }}</RouterLink
      >
    </nav>
    <p v-if="tipo === 'matmed' && edicoes.data.value">
      {{
        t('precos.matmed.edicoes', {
          n: edicoes.data.value.total,
          versao: edicoes.data.value.edicoes[0]?.versao ?? '',
        })
      }}
    </p>
    <form class="filtros" @submit.prevent="termo = busca">
      <div class="campo">
        <SanteSelecao
          id="consulta-tabela"
          v-model="tab"
          :rotulo="t('precos.comum.tabela')"
          :opcoes="opcoesTabela"
          data-testid="consulta-tabela"
        />
      </div>
      <div class="campo">
        <label for="consulta-busca">{{ t('precos.comum.busca') }}</label>
        <input id="consulta-busca" v-model="busca" type="search" />
      </div>
      <div class="campo">
        <label for="consulta-data">{{ t('precos.comum.data') }}</label>
        <input
          id="consulta-data"
          v-model="data"
          pattern="\d{4}-\d{2}-\d{2}"
          :placeholder="t('precos.comum.dataAjuda')"
        />
      </div>
      <SanteBotao :rotulo="t('precos.comum.buscar')" tipo="submit" variante="secundario" />
    </form>
    <MensagemErro v-if="tabelas.isError.value" :erro="tabelas.error.value" />
    <div class="rolagem">
      <table v-if="tipo === 'diarias' && diarias.data.value" data-testid="tabela-diarias">
        <caption>
          {{
            t('precos.diarias.titulo')
          }}
          —
          {{
            diarias.data.value.dataBase
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('precos.diarias.operacao') }}</th>
            <th scope="col">{{ t('precos.comum.codigo') }}</th>
            <th scope="col">{{ t('precos.comum.nome') }}</th>
            <th scope="col">{{ t('precos.diarias.tipo') }}</th>
            <th scope="col">{{ t('precos.comum.vigencia') }}</th>
            <th scope="col">{{ t('precos.comum.valor') }}</th>
            <th scope="col">{{ t('precos.comum.verVigencias') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in diarias.data.value.itens" :key="d.id">
            <td>{{ d.operacao }}</td>
            <td>{{ d.codigo ?? '' }}</td>
            <th scope="row">{{ d.nome }}</th>
            <td>{{ d.tipo ?? '' }} / {{ d.subtipo ?? '' }}</td>
            <td>{{ d.vigencia ?? '' }}</td>
            <td>{{ dinheiro(d.valor) }}</td>
            <td>
              <SanteBotao
                :rotulo="t('precos.comum.verVigencias')"
                variante="texto"
                :data-testid="`vigencias-${d.operacao}`"
                @acionar="itemAberto = d.operacao"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <table v-if="tipo === 'matmed' && matmed.data.value" data-testid="tabela-matmed">
        <caption>
          {{
            t('precos.matmed.titulo')
          }}
          —
          {{
            matmed.data.value.dataBase
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('precos.comum.codigo') }}</th>
            <th scope="col">{{ t('precos.comum.nome') }}</th>
            <th scope="col">{{ t('precos.matmed.classe') }}</th>
            <th scope="col">{{ t('precos.matmed.referencia') }}</th>
            <th scope="col">{{ t('precos.comum.vigencia') }}</th>
            <th scope="col">{{ t('precos.comum.valor') }}</th>
            <th scope="col">{{ t('precos.matmed.pmcPf') }}</th>
            <th scope="col">{{ t('precos.comum.verVigencias') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in matmed.data.value.itens" :key="m.id">
            <td>{{ m.codigo }}</td>
            <th scope="row">{{ m.nome }}</th>
            <td>{{ m.classificacao ?? '' }}</td>
            <td>{{ m.referencia ?? '' }}</td>
            <td>{{ m.vigencia ?? '' }}</td>
            <td>{{ dinheiro(m.valor) }}</td>
            <td>{{ dinheiro(m.pmc) }} / {{ dinheiro(m.pf) }}</td>
            <td>
              <SanteBotao
                :rotulo="t('precos.comum.verVigencias')"
                variante="texto"
                :data-testid="`vigencias-${m.codigo}`"
                @acionar="itemAberto = m.codigo"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <section
      v-if="itemAberto !== null && vigencias.data.value"
      aria-labelledby="vigencias-valor-titulo"
      data-testid="painel-vigencias-valor"
    >
      <h2 id="vigencias-valor-titulo">
        {{
          t('precos.comum.vigenciasDe', {
            codigo: vigencias.data.value.codigo,
            nome: vigencias.data.value.nome,
          })
        }}
      </h2>
      <p v-if="vigencias.data.value.vigencias.length === 0">{{ t('precos.comum.semVigencias') }}</p>
      <ol v-else>
        <li v-for="v in vigencias.data.value.vigencias" :key="v.data">
          {{ v.data }} — {{ dinheiro(v.valor) }}
          <template v-if="tipo === 'matmed'"> ({{ dinheiro(v.pmc) }} / {{ dinheiro(v.pf) }})</template>
          <strong v-if="v.vigente">{{ t('precos.comum.vigenteAgora') }}</strong>
          <em v-if="v.futura">{{ t('precos.comum.futuraAgora') }}</em>
        </li>
      </ol>
      <SanteBotao :rotulo="t('precos.comum.fechar')" variante="texto" @acionar="itemAberto = null" />
    </section>
    <MensagemErro v-if="vigencias.isError.value" :erro="vigencias.error.value" />
    <div v-if="totalPaginas > 1" class="botoes">
      <SanteBotao
        :rotulo="t('precos.comum.anterior')"
        variante="texto"
        :desabilitado="pagina === 0"
        @acionar="pagina--"
      />
      <span>{{ t('precos.comum.pagina', { pagina: pagina + 1, total: totalPaginas, n: total }) }}</span>
      <SanteBotao
        :rotulo="t('precos.comum.proxima')"
        variante="texto"
        :desabilitado="pagina + 1 >= totalPaginas"
        @acionar="pagina++"
      />
    </div>
  </section>
</template>

<style scoped>
.filtros {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.botoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
input,
select {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
