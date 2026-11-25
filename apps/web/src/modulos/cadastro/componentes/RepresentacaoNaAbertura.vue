<script setup lang="ts">
// Representação do paciente na abertura do atendimento e na admissão (F3.1, 02-CAD linha 4): escolhido o paciente, a
// tela já avisa o menor de idade sem representante e o incapaz sem curador no cadastro, e leva aos responsáveis do
// paciente em outra aba (a abertura fica montada, com o que já foi preenchido). O aviso não bloqueia: o paciente é
// atendido e a recepção regulariza o cadastro; o servidor devolve o mesmo aviso no resultado da abertura. Sem acesso
// à leitura do cadastro, ou se a consulta falhar, a abertura segue sem o aviso.
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { lerIncapacidades } from '../api-representacao.js';

const props = defineProps<{ idPaciente: number }>();

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      regularizar: 'Ver os responsáveis do paciente',
    },
  },
});

const consulta = useQuery({
  queryKey: computed(() => ['cadastro', 'incapacidades', props.idPaciente, 'abertura']),
  queryFn: () => lerIncapacidades(props.idPaciente),
  enabled: computed(() => props.idPaciente > 0 && pode('cadastro.paciente.ler')),
  retry: false,
  // O cadastro é regularizado na ficha, em outra aba: ao voltar, a tela relê e o aviso some sozinho.
  staleTime: 0,
  gcTime: 0,
  refetchOnWindowFocus: 'always',
});
const alertas = computed(() => (consulta.isError.value ? [] : (consulta.data.value?.alertas ?? [])));
</script>

<template>
  <p v-if="alertas.length > 0" class="acoes" data-testid="abrir-atd-representacao">
    <SanteAlerta v-for="a in alertas" :key="a.alerta" variante="aviso" anunciar :texto="a.mensagem" />
    <RouterLink
      :to="`/cadastros/pacientes/${idPaciente}/contatos`"
      target="_blank"
      rel="noopener"
      data-testid="abrir-atd-ver-responsaveis"
      >{{ t('regularizar') }}</RouterLink
    >
  </p>
</template>
