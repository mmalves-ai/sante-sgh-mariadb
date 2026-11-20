<script setup lang="ts">
// Chave liga/desliga (switch), implementação única (X-01; antes havia uma cópia em administração e outra em cadastro,
// D-PROF-39): um <button role="switch"> com aria-checked, rótulo associado,
// foco visível e Espaço/Enter nativos do botão. Não muda sozinha: emite `alternar` com o valor pedido e quem usa
// decide (pede a senha, confirma, grava) e devolve o novo estado pela prop. Desligada, mostra o motivo em texto
// (nunca só no title) e o liga ao botão por aria-describedby. A cor nunca é a única informação: o texto de estado
// ao lado diz "Sim"/"Não" (ou o texto passado em `textoLigada`/`textoDesligada`).
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    ligada: boolean;
    rotulo: string;
    descricao?: string;
    desabilitada?: boolean;
    motivo?: string;
    textoLigada?: string;
    textoDesligada?: string;
    /** Só o rótulo para o leitor de tela (a linha já mostra o nome ao lado, como nas permissões). */
    ocultarRotulo?: boolean;
    compacta?: boolean;
  }>(),
  {
    descricao: '',
    desabilitada: false,
    motivo: '',
    textoLigada: '',
    textoDesligada: '',
    ocultarRotulo: false,
    compacta: false,
  },
);
defineOptions({ inheritAttrs: false });
const emit = defineEmits<{ alternar: [valor: boolean] }>();
const { t } = useI18n();
const id = `chave-${useId()}`;
const descritos = computed(
  () =>
    [props.descricao ? `${id}-descricao` : '', props.desabilitada && props.motivo ? `${id}-motivo` : '']
      .filter(Boolean)
      .join(' ') || undefined,
);
const estado = computed(() =>
  props.ligada ? props.textoLigada || t('ui.chave.sim') : props.textoDesligada || t('ui.chave.nao'),
);
function clicar(): void {
  if (!props.desabilitada) emit('alternar', !props.ligada);
}
</script>

<template>
  <div :class="['chave', { 'chave--compacta': compacta, 'chave--desabilitada': desabilitada }]">
    <div v-if="!ocultarRotulo || descricao" class="chave__textos">
      <span :id="`${id}-rotulo`" :class="['chave__rotulo', { 'sgh-visualmente-oculto': ocultarRotulo }]">{{
        rotulo
      }}</span>
      <span v-if="descricao" :id="`${id}-descricao`" class="chave__descricao">{{ descricao }}</span>
    </div>
    <span v-else :id="`${id}-rotulo`" class="sgh-visualmente-oculto">{{ rotulo }}</span>
    <div class="chave__controle">
      <span class="chave__estado" aria-hidden="true">{{ estado }}</span>
      <button
        type="button"
        role="switch"
        class="chave__botao"
        :aria-checked="ligada ? 'true' : 'false'"
        :aria-labelledby="`${id}-rotulo`"
        :aria-describedby="descritos"
        :disabled="desabilitada"
        :data-ligada="ligada ? 'sim' : 'nao'"
        v-bind="$attrs"
        @click="clicar"
      >
        <span class="chave__trilho" aria-hidden="true"><span class="chave__botao-dedo" /></span>
      </button>
    </div>
    <span v-if="desabilitada && motivo" :id="`${id}-motivo`" class="chave__motivo">{{ motivo }}</span>
  </div>
</template>

<style scoped>
.chave {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
  align-items: center;
}
.chave__textos {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.chave__rotulo {
  font-weight: 600;
}
.chave__descricao,
.chave__motivo {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.chave__motivo {
  grid-column: 1 / -1;
}
.chave__controle {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.chave__estado {
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
  min-width: 2.5em;
  text-align: right;
}
.chave__botao {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--sgh-alvo-minimo);
  min-height: var(--sgh-alvo-minimo);
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  border-radius: 999px;
}
.chave__botao:focus-visible {
  outline: 3px solid var(--sgh-foco);
  outline-offset: 2px;
}
.chave__botao:disabled {
  cursor: not-allowed;
}
.chave__trilho {
  position: relative;
  display: inline-block;
  width: 2.75rem;
  height: 1.5rem;
  border-radius: 999px;
  background: var(--sgh-borda-forte);
  transition: background-color 0.15s ease;
}
.chave__botao-dedo {
  position: absolute;
  top: 0.1875rem;
  left: 0.1875rem;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 50%;
  background: var(--sgh-fundo-elevado);
  transition: transform 0.15s ease;
}
.chave__botao[aria-checked='true'] .chave__trilho {
  background: var(--sgh-sucesso);
}
.chave__botao[aria-checked='true'] .chave__botao-dedo {
  transform: translateX(1.25rem);
}
.chave--desabilitada .chave__trilho {
  opacity: 0.55;
}
.chave--compacta {
  grid-template-columns: auto;
}
.chave--compacta .chave__trilho {
  width: 2.25rem;
  height: 1.25rem;
}
.chave--compacta .chave__botao-dedo {
  width: 0.875rem;
  height: 0.875rem;
}
.chave--compacta .chave__botao[aria-checked='true'] .chave__botao-dedo {
  transform: translateX(1rem);
}
@media (prefers-reduced-motion: reduce) {
  .chave__trilho,
  .chave__botao-dedo {
    transition: none;
  }
}
</style>
