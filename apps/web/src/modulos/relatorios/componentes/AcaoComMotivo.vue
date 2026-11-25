<script setup lang="ts">
// W0-09: a ação de gestão do pedido ou do envio que pede o motivo (cancelar, desativar, excluir): o motivo é
// obrigatório (5 caracteres ou mais; o servidor confere de novo) e a exclusão confirma de novo antes de enviar.
import { SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{ titulo: string; rotulo: string; destrutivo?: boolean; ocupado?: boolean; dica?: string }>(),
  { destrutivo: false, ocupado: false, dica: '' },
);
const emit = defineEmits<{ confirmar: [motivo: string]; desistir: [] }>();
const { t } = useI18n();
const motivo = ref('');
const curto = ref(false);
function confirmar(): void {
  if (motivo.value.trim().length < 5) {
    curto.value = true;
    return;
  }
  curto.value = false;
  emit('confirmar', motivo.value.trim());
}
</script>

<template>
  <form class="painel formulario" novalidate data-testid="acao-motivo" @submit.prevent="confirmar">
    <h2>{{ props.titulo }}</h2>
    <p v-if="props.dica" class="secundario">{{ props.dica }}</p>
    <SanteCampoTexto
      v-model="motivo"
      :rotulo="t('relatorios.gestao.motivo')"
      :max-bytes="200"
      obrigatorio
      data-testid="acao-motivo-texto"
    />
    <p v-if="curto" class="erro" role="alert" data-testid="acao-motivo-curto">
      {{ t('relatorios.gestao.motivoCurto') }}
    </p>
    <div class="acoes">
      <SanteBotao
        v-if="props.destrutivo"
        variante="destrutivo"
        :confirmacao="t('relatorios.gestao.confirmarExclusao')"
        :rotulo="props.rotulo"
        :desabilitado="props.ocupado"
        data-testid="acao-motivo-confirmar"
        @acionar="confirmar"
      />
      <SanteBotao
        v-else
        tipo="submit"
        :rotulo="props.rotulo"
        :desabilitado="props.ocupado"
        data-testid="acao-motivo-confirmar"
      />
      <SanteBotao
        variante="texto"
        :rotulo="t('relatorios.gestao.desistir')"
        data-testid="acao-motivo-desistir"
        @acionar="emit('desistir')"
      />
    </div>
  </form>
</template>

<style scoped>
.erro {
  color: var(--sgh-alerta);
  font-weight: 600;
  margin: 0;
}
</style>
