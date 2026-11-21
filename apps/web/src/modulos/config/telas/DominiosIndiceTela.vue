<script setup lang="ts">
// Índice do CRUD genérico (M08; `Cadastros > Domínios e tabelas auxiliares`): só os domínios que a pessoa
// lê (o servidor filtra pelas mesmas regras CASL), agrupados pelo subitem da árvore. Com `subitem`, só o
// grupo do item de menu escolhido. M14 (catálogo de domínios): busca pelo nome, filtro pela natureza e o
// marcador de cada domínio (editável, travado, oficial, enumeração, de sistema).
import { ARVORE_MENU, SUBITENS_DOMINIOS, type SubitemDominio } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarIndiceDominios } from '../api-m08.js';

// `embutido`: dentro de outra tela (M10), sem o título de página e com os grupos um nível abaixo (h3).
const props = defineProps<{ subitem?: string; embutido?: boolean }>();
const { t, te } = useI18n();
const consulta = useQuery({ queryKey: ['dominios', 'indice'], queryFn: () => buscarIndiceDominios() });
const busca = ref('');
const natureza = ref('');
const MARCADORES = ['editavel', 'travado', 'oficial', 'enumeracao', 'sistema'] as const;
const opcoesNatureza = computed(() => [
  { valor: '', rotulo: t('consultas.catalogo.todas') },
  ...MARCADORES.map((m) => ({ valor: m, rotulo: t(`consultas.catalogo.marcadores.${m}`) })),
]);
const sem = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Rótulo do subitem: o do i18n ou o título do item no menu (subitens gerados do lote do M14). */
function rotuloDoSubitem(chave: string, id: string): string {
  const k = `dominios.subitens.${chave}`;
  return te(k) ? t(k) : (ARVORE_MENU.find((i) => i.id === id)?.titulo ?? chave);
}
const marcador = (n: string) =>
  n === 'carga-referencia'
    ? 'oficial'
    : n === 'editavel' || n === 'travado' || n === 'enumeracao'
      ? n
      : 'sistema';
const grupos = computed(() => {
  const todos = Object.entries(SUBITENS_DOMINIOS) as [SubitemDominio, string][];
  const termo = sem(busca.value.trim());
  return todos
    .filter(([k]) => !props.subitem || props.subitem === k)
    .map(([k, id]) => ({
      chave: k,
      rotulo: rotuloDoSubitem(k, id),
      itens: (consulta.data.value?.dominios ?? []).filter(
        (d) =>
          d.subitem === id &&
          (!termo || sem(d.rotulo.plural).includes(termo) || sem(d.rotulo.singular).includes(termo)) &&
          (!natureza.value || marcador(d.natureza) === natureza.value),
      ),
    }))
    .filter((g) => props.subitem || !(termo || natureza.value) || g.itens.length > 0);
});
</script>

<template>
  <section :class="{ tela: !embutido }" :aria-labelledby="embutido ? undefined : 'dominios-titulo'">
    <template v-if="!embutido">
      <h1 id="dominios-titulo">{{ t('dominios.titulo') }}</h1>
      <p>{{ t('dominios.texto') }}</p>
    </template>
    <div v-if="!props.subitem" class="filtros">
      <div class="campo">
        <label for="dominios-busca">{{ t('consultas.catalogo.buscar') }}</label>
        <input
          id="dominios-busca"
          v-model="busca"
          type="search"
          maxlength="60"
          data-testid="busca-catalogo"
        />
      </div>
      <div class="campo">
        <SanteSelecao
          id="dominios-natureza"
          v-model="natureza"
          :rotulo="t('consultas.catalogo.filtroNatureza')"
          :opcoes="opcoesNatureza"
          data-testid="filtro-natureza"
        />
      </div>
    </div>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('dominios.carregando') }}</p>
    <template v-else>
      <section
        v-for="g in grupos"
        :key="g.chave"
        :aria-labelledby="`grupo-${g.chave}`"
        :data-testid="`grupo-${g.chave}`"
      >
        <component :is="embutido ? 'h3' : 'h2'" :id="`grupo-${g.chave}`">{{ g.rotulo }}</component>
        <p v-if="g.itens.length === 0">{{ t('dominios.nenhum') }}</p>
        <ul v-else class="lista">
          <li v-for="d in g.itens" :key="`${d.modulo}.${d.recurso}`">
            <router-link :to="d.rota" :data-testid="`dominio-${d.modulo}.${d.recurso}`">{{
              d.rotulo.plural
            }}</router-link>
            <span class="natureza" :data-testid="`marcador-${d.modulo}.${d.recurso}`">{{
              t(`consultas.catalogo.marcadores.${marcador(d.natureza)}`)
            }}</span>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.lista {
  display: grid;
  gap: var(--sgh-espaco-1);
  padding-left: var(--sgh-espaco-3);
}
.lista a {
  display: inline-block;
  min-height: 24px;
  padding: 2px 0;
}
.natureza {
  margin-left: var(--sgh-espaco-2);
  color: var(--sgh-texto-secundario);
}
input {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
