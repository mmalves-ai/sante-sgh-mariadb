<script setup lang="ts">
// FormRenderer (ficha do M22, seção 7): o formulário do modelo de origem em grade fluida de 12 colunas (a largura
// do componente de origem decide quantas colunas ocupa; no tablet e no celular, uma por linha), nos modos de
// edição, visualização e impressão (o mesmo componente; a impressão esconde o que não foi respondido e as ações).
// Navegação total por teclado: a ordem é a da árvore do formulário; cada campo é um controle nativo ou do @sgh/ui.
import type { CampoRegistro, RespostaRegistro, ValorResposta } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';
import CampoRegistroVue from './CampoRegistro.vue';

type Valor = string | number | boolean | null;

withDefaults(
  defineProps<{
    campos: readonly CampoRegistro[];
    respostas: Readonly<Record<number, RespostaRegistro>>;
    modo: 'edicao' | 'visualizacao' | 'impressao';
    desabilitados?: ReadonlySet<number>;
    calculados?: ReadonlyMap<number, Valor>;
    bloqueado?: boolean;
    titulo: string;
  }>(),
  { desabilitados: () => new Set<number>(), calculados: () => new Map<number, Valor>(), bloqueado: false },
);
const emit = defineEmits<{
  atualizar: [vinculo: number, valor: ValorResposta | null];
  confirmar: [vinculo: number];
  historico: [vinculo: number];
}>();
const { t } = useI18n();
</script>

<template>
  <form
    class="form-renderer"
    :class="`modo-${modo}`"
    :aria-label="t('pep.reg.renderer.rotulo', { modelo: titulo })"
    data-testid="form-renderer"
    novalidate
    @submit.prevent
  >
    <div class="grade-campos">
      <CampoRegistroVue
        v-for="c in campos"
        :key="c.vinculo"
        :campo="c"
        :respostas="respostas"
        :modo="modo"
        :desabilitados="desabilitados"
        :calculados="calculados"
        :bloqueado="bloqueado"
        @atualizar="(a, b) => emit('atualizar', a, b)"
        @confirmar="(a) => emit('confirmar', a)"
        @historico="(a) => emit('historico', a)"
      />
    </div>
  </form>
</template>

<style scoped>
.form-renderer {
  width: 100%;
}
.grade-campos {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--sgh-espaco-3);
}
@media print {
  .form-renderer :deep(.acoes-campo),
  .form-renderer :deep(.editor__barra) {
    display: none;
  }
}
</style>
