<script setup lang="ts">
// Campos do formulário na ordem do próprio registro, em grade de 12 colunas (largura do formulário de origem);
// as seções viram títulos. Campo de tipo que o leitor não conhece aparece como texto, marcado.
import type { CampoFormulario } from '@sgh/contratos';
import { useI18n } from 'vue-i18n';
import ValorCampo from './ValorCampo.vue';

defineProps<{ campos: readonly CampoFormulario[]; rotulo: string }>();
const { t } = useI18n();
</script>

<template>
  <div class="campos" role="group" :aria-label="rotulo" data-testid="campos-formulario">
    <template v-for="(c, i) in campos" :key="`${c.nome}-${i}`">
      <h3 v-if="c.secao" class="secao">{{ c.titulo || t('pep.campo.semTitulo') }}</h3>
      <div v-else class="campo" :style="{ gridColumn: `span ${c.colunas}` }">
        <span class="titulo">{{ c.titulo || t('pep.campo.semTitulo') }}</span>
        <ValorCampo :valor="c.valor" />
        <span v-if="c.autopreenchido" class="marca">{{ t('pep.campo.autopreenchido') }}</span>
        <span v-if="c.naoMapeado" class="marca">{{ t('pep.campo.naoMapeado') }}</span>
      </div>
    </template>
    <p v-if="campos.length === 0" class="vazio">{{ t('pep.campo.nenhum') }}</p>
  </div>
</template>

<style scoped>
.campos {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--sgh-espaco-2);
}
.secao {
  grid-column: 1 / -1;
  margin: var(--sgh-espaco-2) 0 0;
  font-size: 1rem;
  border-bottom: 1px solid var(--sgh-borda);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
  align-content: start;
}
.titulo {
  font-weight: 600;
}
.marca {
  font-size: var(--sgh-fonte-pequena);
  outline: 1px solid var(--sgh-borda-forte);
  padding: 0 var(--sgh-espaco-1);
  justify-self: start;
}
.vazio {
  grid-column: 1 / -1;
}
@media (max-width: 48rem) {
  .campo {
    grid-column: 1 / -1 !important;
  }
}
</style>
