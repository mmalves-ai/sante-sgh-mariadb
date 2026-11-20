<script setup lang="ts">
// W0-09 (regra 4, nenhum dado órfão): a exclusão recusada pelo servidor (409) com quantos e quais registros dependem
// e a oferta do caminho que preserva (cancelar o pedido, desativar o envio). W0-09 revisão: a oferta só aparece com
// `podeInativar === true` do servidor (o pedido já cancelado e o envio já desativado não têm o que oferecer: a tela
// explica que ele fica no histórico, com `semOferta`).
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';

const props = defineProps<{ erro: unknown; oferta: string; semOferta?: string }>();
const emit = defineEmits<{ aceitar: [] }>();
const { t } = useI18n();
const p = computed(() => (props.erro instanceof ErroApi ? props.erro.problema : null));
</script>

<template>
  <div v-if="p" class="painel" role="alert" data-testid="recusa-vinculos">
    <SanteAlerta variante="alerta" :texto="p.detail ?? p.title ?? ''" />
    <p v-if="p.total !== undefined">{{ t('relatorios.gestao.vinculos', { n: p.total }) }}</p>
    <ul v-if="p.dependentes && p.dependentes.length > 0">
      <li v-for="d in p.dependentes" :key="d.rotulo">{{ d.rotulo }}: {{ d.quantidade }}</li>
    </ul>
    <SanteBotao
      v-if="p.podeInativar === true"
      variante="secundario"
      :rotulo="props.oferta"
      data-testid="recusa-vinculos-oferta"
      @acionar="emit('aceitar')"
    />
    <p v-else-if="props.semOferta" data-testid="recusa-vinculos-sem-oferta">{{ props.semOferta }}</p>
  </div>
</template>
