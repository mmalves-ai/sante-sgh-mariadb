<script setup lang="ts">
// Um bloco da página inicial montada pelo hospital (01-ADM L114): o indicador com o gráfico das últimas competências
// (barras relativas ao maior valor ou à meta; o número vai escrito, o gráfico só reforça), o atalho (tela do sistema
// ou página https em outra aba) e o texto da gestão. A lista de trabalho é o cartão da fila, desenhado pela página.
import { barrasDoIndicadorInicio } from '@sgh/dominio-relatorio';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import type { MinhaPagina } from '../api-pagina-inicial.js';
import { mensagensPaginaInicial } from '../i18n-pagina-inicial.js';

const props = defineProps<{ bloco: MinhaPagina['blocos'][number] }>();
const { t } = useI18n({ useScope: 'local', messages: mensagensPaginaInicial });

const ind = computed(() => props.bloco.indicador);
const rotaIndicador = computed(() =>
  ind.value && /^[a-zA-Z0-9]+$/.test(ind.value.codigo)
    ? `/relatorios/indicadores/${ind.value.codigo}`
    : '/relatorios/indicadores',
);
const barras = computed(() => (ind.value ? barrasDoIndicadorInicio(ind.value.serie) : []));
const ultimo = computed(() => {
  const s = ind.value?.serie ?? [];
  return [...s].reverse().find((p) => p.valor !== null) ?? null;
});
const numero = (v: number | null) =>
  v === null ? '' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${ind.value?.simbolo ?? ''}`;
const mes = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
const interno = computed(() => (props.bloco.endereco ?? '').startsWith('/'));
const tituloBloco = computed(() => props.bloco.titulo ?? ind.value?.nome ?? '');
</script>

<template>
  <article
    class="painel bloco-pagina"
    :class="`largura-${bloco.largura}`"
    :data-testid="`bloco-${bloco.tipo}`"
    :aria-label="tituloBloco || undefined"
  >
    <template v-if="bloco.tipo === 'indicador' && ind">
      <h3>
        <RouterLink :to="rotaIndicador" :aria-label="t('abrirIndicador', { nome: ind.nome })">{{
          tituloBloco
        }}</RouterLink>
      </h3>
      <p v-if="!ultimo" class="secundario">{{ t('semApuracao') }}</p>
      <p v-else data-testid="bloco-indicador-ultimo">
        <strong>{{
          t('ultimo', { valor: numero(ultimo.valor), competencia: mes(ultimo.competencia) })
        }}</strong>
        <span v-if="ultimo.meta !== null" class="secundario">
          · {{ t('meta', { valor: numero(ultimo.meta) }) }}</span
        >
      </p>
      <ul v-if="barras.length > 0" class="grafico" role="list" :aria-label="t('grafico', { nome: ind.nome })">
        <li
          v-for="(b, i) in barras"
          :key="b.competencia"
          :aria-label="t('barra', { competencia: mes(b.competencia), valor: numero(ind.serie[i]!.valor) })"
        >
          <span class="barra" :style="{ height: `${b.altura}%` }" />
          <span class="secundario rotulo">{{ mes(b.competencia).slice(0, 2) }}</span>
        </li>
      </ul>
    </template>
    <template v-else-if="bloco.tipo === 'link'">
      <h3>
        <RouterLink v-if="interno" :to="bloco.endereco!">{{ tituloBloco }}</RouterLink>
        <a v-else :href="bloco.endereco!" target="_blank" rel="noopener noreferrer">{{ tituloBloco }}</a>
      </h3>
    </template>
    <template v-else-if="bloco.tipo === 'texto'">
      <h3 v-if="bloco.titulo">{{ bloco.titulo }}</h3>
      <p class="texto">{{ bloco.texto }}</p>
    </template>
  </article>
</template>

<style scoped>
.bloco-pagina h3 {
  margin: 0;
  font-size: 1.05rem;
}
.bloco-pagina a {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}
.texto {
  white-space: pre-line;
}
.grafico {
  list-style: none;
  margin: var(--sgh-espaco-2) 0 0;
  padding: 0;
  display: flex;
  align-items: flex-end;
  gap: var(--sgh-espaco-1);
  height: 5rem;
}
.grafico li {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  height: 100%;
}
.barra {
  display: block;
  width: 100%;
  min-height: 2px;
  background: var(--sgh-primaria);
  border-radius: 2px 2px 0 0;
}
.rotulo {
  font-size: var(--sgh-fonte-pequena);
}
</style>
