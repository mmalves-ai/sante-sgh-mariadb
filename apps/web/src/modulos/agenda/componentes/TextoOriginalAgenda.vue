<script setup lang="ts">
// ADR 0009 (decisão 27): o texto original da agenda, inteiro e sem corte, ao lado das regras. O trecho que não foi
// interpretado fica destacado (<mark>) e continua valendo pelo texto; o trecho que virou regra leva o tipo da regra no
// título. O texto é mostrado como texto (interpolação), nunca como HTML.
import type { TextoOrigemAgenda } from '@sgh/contratos';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { fatiarTexto, naoInterpretados } from '../estruturada-tela.js';

const props = defineProps<{ texto: TextoOrigemAgenda; nomeConvenio?: string; destacado?: boolean }>();
const { t } = useI18n();
const pedacos = computed(() => fatiarTexto(props.texto.texto, props.texto.trechos));
const faltam = computed(() => naoInterpretados(props.texto));
const rotulo = computed(() =>
  t(`estruturada.textoOriginal.campos.${props.texto.campo}`, {
    convenio: props.nomeConvenio ?? String(props.texto.fontePagadoraId ?? ''),
  }),
);
</script>

<template>
  <figure
    :id="`texto-origem-${texto.id}`"
    class="texto-origem"
    :class="{ 'texto-origem--destacado': destacado }"
    :data-testid="`texto-origem-${texto.id}`"
  >
    <figcaption>
      <strong>{{ rotulo }}</strong>
      <span class="etiqueta">{{ t(`estruturada.textoOriginal.situacoes.${texto.situacao}`) }}</span>
    </figcaption>
    <p v-if="faltam > 0" class="aviso" data-testid="texto-nao-interpretados">
      {{ t('estruturada.textoOriginal.naoInterpretados', { n: faltam }) }}
    </p>
    <blockquote class="corpo" data-testid="texto-corpo">
      <template v-for="(p, i) in pedacos" :key="i">
        <mark
          v-if="p.interpretado === false"
          class="nao-interpretado"
          :title="p.motivo ?? t('estruturada.textoOriginal.naoInterpretado')"
          data-testid="trecho-nao-interpretado"
          >{{ p.texto }}</mark
        ><span
          v-else-if="p.interpretado"
          class="interpretado"
          :title="p.tipoRegra ? t(`estruturada.textoOriginal.tipos.${p.tipoRegra}`) : undefined"
          data-testid="trecho-interpretado"
          >{{ p.texto }}</span
        ><template v-else>{{ p.texto }}</template>
      </template>
    </blockquote>
  </figure>
</template>

<style scoped>
.texto-origem {
  margin: 0 0 var(--sgh-espaco-2);
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.texto-origem--destacado {
  border-color: var(--sgh-borda-forte);
  border-width: 2px;
}
figcaption {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  align-items: baseline;
}
.corpo {
  margin: var(--sgh-espaco-1) 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.nao-interpretado {
  text-decoration: underline wavy;
  font-weight: 600;
}
.interpretado {
  text-decoration: underline dotted;
}
.aviso {
  font-weight: 600;
  margin: var(--sgh-espaco-1) 0 0;
}
.etiqueta {
  font-size: 0.875em;
  padding: 0 var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda);
}
</style>
