<script setup lang="ts">
// Cadastro pendente na abertura do atendimento (F3.1, 02-CAD linha 2): escolhidos o paciente, o tipo e o convênio, a
// tela já diz quais campos do cadastro faltam no escopo dela e leva à ficha do paciente com o mesmo escopo na rota
// (a ficha aplica a regra mais específica ao gravar). O servidor recusa a abertura com os mesmos campos; aqui a pessoa
// fica sabendo antes de preencher a ficha do atendimento. A ficha abre em outra aba (a abertura fica montada, com o
// que já foi preenchido, a senha e a marcação). Sem acesso à leitura do cadastro, ou se a consulta falhar, a
// abertura segue e a conferência fica com o servidor: a recusa da gravação aparece em RecusaCadastroIncompleto.vue,
// com os campos e o mesmo atalho.
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { type CamposPendentes, lerCamposPendentes } from '../api-campos-pendentes.js';
import { consultaDeRotaDoEscopo, consultaDoEscopo, escopoDaAbertura } from '../escopo-regra-campo.js';

const props = defineProps<{
  idPaciente: number;
  /** Código do tipo com que a tela abre (consulta, pa, exame, requisicaoLab, internacao). */
  tipo?: string | null;
  convenio?: string | number | null;
  modulo?: string | number | null;
  /** Local de atendimento em que a recepção abre (senha do guichê): o servidor resolve o módulo de recepção dele. */
  local?: number | null;
}>();

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      faltam: 'Faltam no cadastro do paciente para este atendimento: {campos}.',
      completar: 'Completar o cadastro',
    },
  },
});

const escopo = computed(() =>
  escopoDaAbertura({ tipo: props.tipo, convenio: props.convenio, modulo: props.modulo }),
);
const consulta = useQuery({
  queryKey: computed(() => [
    'cadastro',
    'campos-pendentes',
    props.idPaciente,
    consultaDoEscopo(escopo.value),
    props.local ?? 0,
  ]),
  queryFn: (): Promise<CamposPendentes> =>
    lerCamposPendentes(props.idPaciente, escopo.value, props.local ?? null),
  enabled: computed(() => props.idPaciente > 0 && pode('cadastro.paciente.ler')),
  retry: false,
  // O cadastro é completado na ficha, em outra aba: ao voltar, a tela relê e o aviso some sozinho.
  staleTime: 0,
  gcTime: 0,
  refetchOnWindowFocus: 'always',
});
const pendentes = computed(() => (consulta.isError.value ? [] : (consulta.data.value?.pendentes ?? [])));
// O atalho leva à ficha com o módulo que o servidor aplicou (o do local de atendimento, quando há).
const escopoDaFicha = computed(() => ({
  ...escopo.value,
  modulo: (consulta.isError.value ? null : consulta.data.value?.modulo) ?? escopo.value.modulo,
}));
</script>

<template>
  <p v-if="pendentes.length > 0" class="acoes" data-testid="abrir-atd-cadastro-pendente">
    <SanteAlerta
      variante="aviso"
      anunciar
      :texto="t('faltam', { campos: pendentes.map((p) => p.rotulo).join(', ') })"
    />
    <RouterLink
      :to="{ path: `/cadastros/pacientes/${idPaciente}`, query: consultaDeRotaDoEscopo(escopoDaFicha) }"
      target="_blank"
      rel="noopener"
      data-testid="abrir-atd-completar-cadastro"
      >{{ t('completar') }}</RouterLink
    >
  </p>
</template>
