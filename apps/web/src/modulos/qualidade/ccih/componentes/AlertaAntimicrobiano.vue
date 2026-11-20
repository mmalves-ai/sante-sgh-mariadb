<script setup lang="ts">
// O alerta ao prescritor (regra 6) na tela da prescrição: os antimicrobianos restritos do atendimento sem liberação da
// CCIH no prazo da política. Só informa: a prescrição segue valendo e o sistema nunca suspende sozinho. Sem alerta, ou
// com a CCIH desligada, ou sem acesso à leitura, não aparece nada.
import { rotuloSituacaoLiberacaoAntimicrobiano } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import { lerAlertasDoAtendimento } from '../api-ccih.js';

const props = defineProps<{ atendimento: number }>();
const { t } = useI18n();
const q = useQuery({
  queryKey: computed(() => ['ccih', 'alertas', props.atendimento]),
  queryFn: () => lerAlertasDoAtendimento(props.atendimento),
  refetchInterval: 300_000,
  retry: false,
});
const itens = computed(() => (q.isError.value ? [] : (q.data.value?.itens ?? [])));
</script>

<template>
  <div v-if="itens.length" role="alert" class="alerta-ccih" data-testid="alerta-antimicrobiano-ccih">
    <strong>{{ t('ccih.alerta.titulo') }}</strong>
    <ul>
      <li v-for="i in itens" :key="i.itemPrescricao">
        {{
          t('ccih.alerta.item', {
            nome: i.nome,
            situacao: rotuloSituacaoLiberacaoAntimicrobiano(i.situacao as never),
            em: dataHora(i.venceEm),
          })
        }}
      </li>
    </ul>
    <span>{{ t('ccih.alerta.explicacao') }}</span>
  </div>
</template>

<style scoped>
.alerta-ccih {
  padding: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-aviso);
  border-radius: var(--sgh-raio, 6px);
  background: var(--sgh-aviso-suave);
}
.alerta-ccih ul {
  margin: var(--sgh-espaco-1) 0;
}
</style>
