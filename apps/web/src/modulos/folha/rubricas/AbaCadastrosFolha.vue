<script setup lang="ts">
// Aba Cadastros da folha (M53.2; ficha, seção 5: receita genérica): os cadastros do CRUD genérico que a API lista no
// apoio (rubricas, os quatro vínculos de incidência do eSocial, a tabela legal, o lançamento automático por empresa e as
// rotinas de integração), escolhidos com busca e embutidos pela tela gerada do M08 (versão lida, colisão, trilha; as
// ações só com a permissão e a chave da folha; o servidor confere de novo).
import { type ApoioRubricas, DOMINIOS_DECLARADOS } from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DominioTela from '../../config/telas/DominioTela.vue';

// M53.2: `abrir` (vindo do detalhe da rubrica) abre o cadastro já filtrado pelo item e na alteração dele.
const props = defineProps<{
  apoio: ApoioRubricas;
  abrir?: { recurso: string; codigo: string; busca: string } | null;
}>();
const escolhido = defineModel<string | null>({ required: true });
const { t } = useI18n();

const opcoes = computed(() =>
  props.apoio.cadastros.map((c) => {
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
const abrirAqui = computed(() =>
  props.abrir && props.abrir.recurso === escolhido.value
    ? { codigo: props.abrir.codigo, busca: props.abrir.busca }
    : null,
);
</script>

<template>
  <section class="bloco" aria-labelledby="aba-cadastros-titulo" data-testid="aba-cadastros-folha">
    <h2 id="aba-cadastros-titulo">{{ t('rubricasFolha.abas.cadastros') }}</h2>
    <p class="secundario">{{ t('rubricasFolha.cadastros.ajuda') }}</p>
    <div class="campos">
      <SanteSelecao
        v-model="escolhido"
        :rotulo="t('rubricasFolha.cadastros.escolher')"
        :opcoes="opcoes"
        busca
        data-testid="rubricas-cadastro"
      />
    </div>
    <DominioTela
      v-if="atual"
      :key="`${atual.modulo}.${atual.recurso}.${abrirAqui?.codigo ?? ''}`"
      :modulo="atual.modulo"
      :recurso="atual.recurso"
      :abrir="abrirAqui"
      secundaria
    />
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
