<script setup lang="ts">
// Histórico da alergia (03-PEP L100): a linha do tempo (registrada, retirada, reativada...) com quem e o motivo, e as
// manifestações. Lido só ao abrir: a lista de alergias não paga a leitura de cada histórico.
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../../casca/MensagemErro.vue';
import { lerHistoricoAlergia } from '../../api-documentos.js';
import { dataHoraBr } from '../../formato.js';

const props = defineProps<{ paciente: number; alergia: number }>();
const { t } = useI18n();
const aberto = ref(false);
const dados = useQuery({
  queryKey: computed(() => ['pep', 'doc', 'alergia-historico', props.paciente, props.alergia]),
  queryFn: () => lerHistoricoAlergia(props.paciente, props.alergia),
  enabled: aberto,
});
</script>

<template>
  <details
    :data-testid="`historico-alergia-${alergia}`"
    @toggle="aberto = ($event.target as HTMLDetailsElement).open"
  >
    <summary>{{ t('pep.doc.alergias.verHistorico') }}</summary>
    <MensagemErro v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="!dados.data.value" role="status">{{ t('pep.doc.carregando') }}</p>
    <template v-else>
      <p v-if="dados.data.value.manifestacoes.length">
        {{ t('pep.doc.alergias.manifestacoes') }}:
        {{ dados.data.value.manifestacoes.map((m) => m.nome).join(', ') }}
      </p>
      <p v-if="dados.data.value.passos.length === 0">{{ t('pep.doc.alergias.semHistorico') }}</p>
      <ol v-else :aria-label="t('pep.doc.alergias.historicoDaAlergia')">
        <li v-for="p in dados.data.value.passos" :key="p.id">
          <strong>{{ p.titulo }}</strong> · {{ dataHoraBr(p.quando)
          }}<span v-if="p.quem"> · {{ p.quem }}</span
          ><span v-if="p.motivo"> · {{ p.motivo }}</span>
        </li>
      </ol>
    </template>
  </details>
</template>
