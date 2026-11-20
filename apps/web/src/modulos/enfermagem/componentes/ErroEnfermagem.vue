<script setup lang="ts">
// Erro das telas da enfermagem (M25): a recusa conhecida (código do Problem Details) com o texto da aplicação e, na
// recusa dos nove certos, os bloqueios e avisos que o servidor conferiu; o resto, a mensagem geral com o código de
// correlação.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa, noveCertosDaRecusa } from '../api-enfermagem.js';

const props = defineProps<{ erro: unknown }>();
const { t, te } = useI18n();
const chave = computed(() => {
  const c = codigoDaRecusa(props.erro);
  return c && te(`enfermagem.recusas.${c}`) ? `enfermagem.recusas.${c}` : null;
});
const nove = computed(() => noveCertosDaRecusa(props.erro));
</script>

<template>
  <div v-if="chave" role="alert" data-testid="recusa-enfermagem">
    <SanteAlerta variante="alerta" :texto="t(chave)" />
    <ul v-if="nove.bloqueios.length || nove.avisos.length" class="nove">
      <li v-for="b in nove.bloqueios" :key="b" data-testid="bloqueio-nove-certos">{{ b }}</li>
      <li v-for="a in nove.avisos" :key="a" class="aviso">{{ a }}</li>
    </ul>
  </div>
  <MensagemErro v-else :erro="erro" />
</template>

<style scoped>
.nove {
  margin: var(--sgh-espaco-1) 0 0;
  padding-left: var(--sgh-espaco-3);
}
.aviso {
  color: var(--sgh-texto-secundario);
}
</style>
