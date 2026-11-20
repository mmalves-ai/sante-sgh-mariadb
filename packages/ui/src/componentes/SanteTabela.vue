<script setup lang="ts" generic="T extends Record<string, unknown>">
// Tabela paginada no servidor (regra 10; cap-09 §9.7): paginação, filtro e ordenação sempre no servidor,
// com teto de página. AG Grid só nas ~6 telas tipo planilha (não aqui).
import Column from 'openvue/column';
import DataTable, { type DataTablePageEvent, type DataTableSortEvent } from 'openvue/datatable';
import InputText from 'openvue/inputtext';
import { onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { registrarBuscaDaLista } from '../atalhos/busca-da-lista.js';
import SanteAlerta from './SanteAlerta.vue';
import { type ColunaTabela, type ConsultaTabela, type PaginaTabela, TETO_PAGINA_PADRAO } from './tabela.js';

const props = withDefaults(
  defineProps<{
    colunas: readonly ColunaTabela[];
    carregar: (consulta: ConsultaTabela) => Promise<PaginaTabela<T>>;
    rotulo: string;
    chave: string;
    tamanhoPagina?: number;
    teto?: number;
    esperaFiltroMs?: number;
  }>(),
  { tamanhoPagina: 25, teto: TETO_PAGINA_PADRAO, esperaFiltroMs: 300 },
);
const emit = defineEmits<{ erro: [erro: unknown] }>();
const { t } = useI18n();
const idBusca = `sgh-tabela-busca-${useId()}`;
const linhas = shallowRef<T[]>([]);
const total = ref(0);
const carregando = ref(false);
/** Falha da última carga: a tabela some com os dados antigos e mostra a mensagem (regra 15). */
const falhou = ref(false);
const pagina = ref(0);
const tamanho = ref(Math.min(props.tamanhoPagina, props.teto));
const ordem = ref<ConsultaTabela['ordem']>(null);
const filtro = ref('');
const busca = ref<{ $el: HTMLElement } | null>(null);
let pedido = 0;
let espera: ReturnType<typeof setTimeout> | undefined;
let soltarBusca: (() => void) | undefined;

async function recarregar(): Promise<void> {
  const meu = ++pedido;
  carregando.value = true;
  try {
    const r = await props.carregar({
      pagina: pagina.value,
      tamanho: Math.min(tamanho.value, props.teto),
      ordem: ordem.value,
      filtro: filtro.value.trim(),
    });
    if (meu !== pedido) return; // resposta atrasada de um pedido antigo
    linhas.value = [...r.itens];
    total.value = r.total;
    falhou.value = false;
  } catch (e) {
    if (meu !== pedido) return;
    // Nada de dado antigo na tela como se fosse a resposta do pedido novo.
    linhas.value = [];
    total.value = 0;
    falhou.value = true;
    emit('erro', e); // a tela pode mostrar o Problem Details (correlação) com MensagemErro
  } finally {
    if (meu === pedido) carregando.value = false;
  }
}

function aoPaginar(e: DataTablePageEvent): void {
  pagina.value = e.page;
  tamanho.value = Math.min(e.rows, props.teto);
  void recarregar();
}
function aoOrdenar(e: DataTableSortEvent): void {
  const campo = typeof e.sortField === 'string' ? e.sortField : null;
  ordem.value = campo ? { campo, direcao: e.sortOrder === -1 ? 'desc' : 'asc' } : null;
  pagina.value = 0;
  void recarregar();
}
watch(filtro, () => {
  clearTimeout(espera);
  espera = setTimeout(() => {
    pagina.value = 0;
    void recarregar();
  }, props.esperaFiltroMs);
});

onMounted(() => {
  void recarregar();
  const el = busca.value?.$el;
  if (el instanceof HTMLElement) soltarBusca = registrarBuscaDaLista(el);
});
onBeforeUnmount(() => {
  clearTimeout(espera);
  soltarBusca?.();
});
defineExpose({ recarregar });
</script>

<template>
  <div class="sgh-tabela">
    <div class="sgh-tabela__barra">
      <label :for="idBusca" class="sgh-tabela__rotulo-busca">{{ rotulo }}</label>
      <InputText :id="idBusca" ref="busca" v-model="filtro" type="search" class="sgh-tabela__busca" />
      <span class="sgh-tabela__total" aria-live="polite">{{ t('ui.tabela.total', { total }) }}</span>
    </div>
    <div v-if="falhou" class="sgh-tabela__erro" role="alert" data-testid="tabela-erro">
      <slot name="erro">
        <SanteAlerta variante="alerta" :texto="t('ui.tabela.erro')" />
      </slot>
      <button type="button" class="sgh-tabela__repetir" @click="recarregar">
        {{ t('ui.tabela.tentarDeNovo') }}
      </button>
    </div>
    <DataTable
      :value="linhas"
      lazy
      paginator
      :rows="tamanho"
      :first="pagina * tamanho"
      :total-records="total"
      :loading="carregando"
      :data-key="chave"
      :rows-per-page-options="[10, 25, 50, 100].filter((n) => n <= teto)"
      :aria-label="rotulo"
      striped-rows
      @page="aoPaginar"
      @sort="aoOrdenar"
    >
      <template #empty>{{ t('ui.tabela.vazia') }}</template>
      <Column
        v-for="c in colunas"
        :key="c.campo"
        :field="c.campo"
        :header="c.rotulo"
        :sortable="c.ordenavel ?? false"
      />
    </DataTable>
    <p class="sgh-tabela__teto">{{ t('ui.tabela.teto', { teto }) }}</p>
  </div>
</template>

<style scoped>
.sgh-tabela__barra {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
  margin-bottom: var(--sgh-espaco-2);
}
.sgh-tabela__rotulo-busca {
  font-weight: 600;
}
.sgh-tabela__busca {
  min-height: var(--sgh-alvo-minimo);
  min-width: 16em;
}
.sgh-tabela__total,
.sgh-tabela__erro {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.sgh-tabela__repetir {
  min-height: var(--sgh-alvo-minimo);
  font: inherit;
}
.sgh-tabela__teto {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
</style>
