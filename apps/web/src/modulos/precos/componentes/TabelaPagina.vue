<script setup lang="ts">
// Tabela de uma página vinda do servidor (colunas e itens já paginados e com teto), com a navegação entre
// páginas. Usada pelas consultas do motor de preços e da importação.
import type { PaginaGenerica } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ pagina: PaginaGenerica | null; rotulo: string; testid: string }>();
const emit = defineEmits<{ pagina: [n: number] }>();
const { t } = useI18n();
const totalPaginas = computed(() =>
  props.pagina ? Math.max(1, Math.ceil(props.pagina.total / Math.max(1, props.pagina.porPagina))) : 1,
);
const fmt = (v: string | number | null) =>
  v === null ? '' : typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 4 }) : v;
</script>

<template>
  <div>
    <p v-for="a in pagina?.avisos ?? []" :key="a" class="aviso">{{ a }}</p>
    <p v-if="pagina && pagina.itens.length === 0">{{ t('precos.comum.nenhum') }}</p>
    <div v-else-if="pagina" class="rolagem">
      <table :data-testid="testid">
        <caption>
          {{
            rotulo
          }}
        </caption>
        <thead>
          <tr>
            <th v-for="c in pagina.colunas" :key="c.campo" scope="col">{{ c.rotulo }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in pagina.itens" :key="i">
            <td v-for="c in pagina.colunas" :key="c.campo">{{ fmt(l[c.campo] ?? null) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="pagina && totalPaginas > 1" class="paginas">
      <SanteBotao
        :rotulo="t('precos.comum.anterior')"
        variante="texto"
        :desabilitado="pagina.pagina === 0"
        @acionar="emit('pagina', pagina.pagina - 1)"
      />
      <span>{{
        t('precos.comum.pagina', { pagina: pagina.pagina + 1, total: totalPaginas, n: pagina.total })
      }}</span>
      <SanteBotao
        :rotulo="t('precos.comum.proxima')"
        variante="texto"
        :desabilitado="pagina.pagina + 1 >= totalPaginas"
        @acionar="emit('pagina', pagina.pagina + 1)"
      />
    </div>
  </div>
</template>

<style scoped>
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
.paginas {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
  margin-top: var(--sgh-espaco-2);
}
.aviso {
  color: var(--sgh-texto-secundario);
}
</style>
