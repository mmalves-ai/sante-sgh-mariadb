<script setup lang="ts">
// "Permissões, menus e papéis SBIS" (M06, ficha seção 7): a árvore de opções do legado (TBOPCOES) de um
// módulo, reconstruída por INDICE e NIVEL, com a permissão do Sante SGH de cada opção (ou o motivo de ficar
// fora do catálogo: opção inativa, sistema SGO/SGS). Só leitura (acesso.permissao.ler).
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarMapa } from '../api-acesso.js';

const { t } = useI18n();
const modulo = ref('');
const consulta = useQuery({
  queryKey: computed(() => ['acesso', 'mapa', modulo.value]),
  queryFn: () => buscarMapa(modulo.value === '' ? null : Number(modulo.value)),
});
const opcoesModulo = computed(() => [
  { valor: '', rotulo: t('acesso.mapa.escolha') },
  ...(consulta.data.value?.modulos ?? [])
    .filter((m) => m.opcoes > 0)
    .map((m) => ({ valor: String(m.id), rotulo: `${m.nome} (${m.sistema}, ${m.opcoes})` })),
]);
const nos = computed(() => consulta.data.value?.nos ?? []);
</script>

<template>
  <section class="tela" aria-labelledby="mapa-titulo">
    <h1 id="mapa-titulo">{{ t('acesso.mapa.titulo') }}</h1>
    <p>{{ t('acesso.mapa.texto') }}</p>
    <SanteSelecao v-model="modulo" :rotulo="t('acesso.mapa.modulo')" :opcoes="opcoesModulo" />
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <ul
      v-else-if="nos.length > 0"
      class="arvore"
      data-testid="arvore-mapa"
      :aria-label="t('acesso.mapa.arvore')"
    >
      <li v-for="n in nos" :key="n.opcao" :style="{ paddingLeft: `${n.nivel * 1.25}rem` }">
        <span>{{ n.titulo }}</span>
        <code v-if="n.permissao">{{ n.permissao }}</code>
        <em v-else>{{ t(`acesso.mapa.exclusoes.${n.exclusao ?? 'sem-permissao'}`) }}</em>
      </li>
    </ul>
    <p v-else-if="modulo !== '' && !consulta.isPending.value">{{ t('acesso.mapa.vazio') }}</p>
  </section>
</template>

<style scoped>
.arvore {
  list-style: none;
  padding: 0;
}
.arvore li {
  display: flex;
  gap: var(--sgh-espaco-2);
  padding-block: 2px;
}
.arvore code {
  color: var(--sgh-texto-secundario);
}
</style>
