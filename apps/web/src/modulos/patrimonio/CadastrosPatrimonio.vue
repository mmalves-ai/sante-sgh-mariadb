<script setup lang="ts">
// Cadastros genéricos do patrimônio (CRUD do M08, declarados no M54.1) embutidos nas telas: os que o apoio lista (os
// que o perfil consulta), escolhidos com busca; a tela gerada cuida da versão lida, da colisão, da trilha e das ações
// conforme a permissão de cada cadastro (o servidor confere de novo).
import { DOMINIOS_DECLARADOS } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DominioTela from '../config/telas/DominioTela.vue';

const props = defineProps<{ cadastros: readonly string[]; titulo: string; ajuda: string; testid: string }>();
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
  <section class="bloco" :aria-labelledby="`${testid}-titulo`" :data-testid="testid">
    <h2 :id="`${testid}-titulo`">{{ titulo }}</h2>
    <p class="secundario">{{ ajuda }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="escolhido"
        :rotulo="t('patrimonio.bens.cadastrosEscolher')"
        :opcoes="opcoes"
        busca
        :data-testid="`${testid}-escolha`"
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

<style scoped src="./estilo-patrimonio.css"></style>
