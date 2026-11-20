<script setup lang="ts">
// Aba Cadastros do plano de contas (M54.1; ficha, seção 7: "específica + CRUD genérico dos domínios"; seção 5: a receita
// genérica nas migrar-crud do grupo `contabil`): os cadastros que o apoio lista (os que o perfil consulta), escolhidos
// com busca e embutidos pela tela gerada do M08 (versão lida, colisão, trilha; as ações só com a permissão de cada
// cadastro; o servidor confere de novo).
import { DOMINIOS_DECLARADOS } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DominioTela from '../config/telas/DominioTela.vue';

const props = defineProps<{ cadastros: readonly string[] }>();
const { t } = useI18n();
const escolhido = ref<string | null>(null);

const opcoes = computed(() =>
  props.cadastros.map((c) => {
    const [modulo, recurso] = c.split('.');
    const d = DOMINIOS_DECLARADOS.find((x) => x.modulo === modulo && x.recurso === recurso);
    return { valor: c as string | null, rotulo: d?.rotulo.plural ?? c };
  }),
);
watch(
  opcoes,
  (o) => {
    if (escolhido.value === null || !o.some((x) => x.valor === escolhido.value))
      escolhido.value = o[0]?.valor ?? null;
  },
  { immediate: true },
);
const atual = computed(() => {
  const [modulo, recurso] = (escolhido.value ?? '').split('.');
  return modulo && recurso ? { modulo, recurso } : null;
});
</script>

<template>
  <section class="bloco" aria-labelledby="aba-cadastros-contabil-titulo" data-testid="aba-cadastros-contabil">
    <h2 id="aba-cadastros-contabil-titulo">{{ t('contabil.abas.cadastros') }}</h2>
    <p class="secundario">{{ t('contabil.cadastros.ajuda') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="escolhido"
        :rotulo="t('contabil.cadastros.escolher')"
        :opcoes="opcoes"
        busca
        data-testid="contabil-cadastro"
      />
    </div>
    <DominioTela
      v-if="atual"
      :key="`${atual.modulo}.${atual.recurso}`"
      :modulo="atual.modulo"
      :recurso="atual.recurso"
      secundaria
    />
  </section>
</template>

<style scoped src="./estilo-contabil.css"></style>
