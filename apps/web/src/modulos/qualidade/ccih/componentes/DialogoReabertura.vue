<script setup lang="ts">
// W0-04: reabrir a competência fechada da CCIH (operação crítica: motivo e senha). Aberto a partir da oferta do 409
// "competência fechada" (correção de dispositivo ou de ficha de IRAS) ou da lista de competências; lê a competência
// para levar a versão lida.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerCompetencias, novaChaveCorrecao, reabrirCompetencia } from '../../api-correcao.js';
import DialogoCorrecao, { type PedidoCorrecao } from '../../componentes/DialogoCorrecao.vue';

const visivel = defineModel<boolean>('visivel', { required: true });
const props = defineProps<{ competencia: string | null }>();
const emit = defineEmits<{ feito: [texto: string] }>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`qualidade.correcao.${k}`, p ?? {});
const cliente = useQueryClient();

const q = useQuery({
  queryKey: ['ccih', 'competencias'],
  queryFn: lerCompetencias,
  enabled: visivel,
});
const alvo = computed(() =>
  (q.data.value?.itens ?? []).find((c) => c.competencia === props.competencia && c.situacao === 'fechada'),
);

const pedido = computed<PedidoCorrecao | null>(() => {
  const c = alvo.value;
  if (!props.competencia) return null;
  return {
    titulo: T('competencias.reabrirTitulo', { c: props.competencia }),
    texto: T('competencias.reabrirTexto'),
    critica: true,
    confirmar: T('competencias.confirmarReabrir'),
    impedido: !c,
    gravar: async (m) => {
      if (!c) return null;
      return reabrirCompetencia(c.id, c.versao, m, novaChaveCorrecao('reabrir'));
    },
  };
});

async function feito(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['ccih'] });
  emit('feito', T('reaberta'));
}
</script>

<template>
  <DialogoCorrecao v-model:visivel="visivel" :pedido="pedido" @feito="feito" />
</template>
