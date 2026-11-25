<script setup lang="ts">
// Recusa da abertura do atendimento por cadastro incompleto (F3.1, 02-CAD linha 2): o servidor recusou a gravação com
// o código `cadastro-incompleto` e os campos do cadastro que faltam no escopo. A tela diz quais são, pelo rótulo, e
// leva à ficha do paciente com o escopo na rota, em outra aba (a abertura fica montada, com o que já foi preenchido);
// completado o cadastro, a pessoa grava de novo. É o que a pessoa vê quando o aviso prévio não apareceu (sem acesso à
// leitura do cadastro, consulta em erro, cadastro alterado depois do aviso). Outro erro não é mostrado aqui.
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { camposDaRecusaDeCadastro, consultaDeRotaDoEscopo, escopoDaAbertura } from '../escopo-regra-campo.js';

const props = defineProps<{
  erro: unknown;
  idPaciente: number;
  /** Código do tipo com que a tela abre (consulta, pa, exame, requisicaoLab, internacao). */
  tipo?: string | null;
  convenio?: string | number | null;
  modulo?: string | number | null;
}>();

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      recusado: 'O atendimento não foi gravado. Faltam no cadastro do paciente: {campos}.',
      recusadoSemLista:
        'O atendimento não foi gravado: o cadastro do paciente está incompleto para este atendimento.',
      completar: 'Completar o cadastro',
      depois: 'Depois de completar o cadastro, grave de novo.',
    },
  },
});

const campos = computed(() => camposDaRecusaDeCadastro(props.erro));
const escopo = computed(() =>
  escopoDaAbertura({ tipo: props.tipo, convenio: props.convenio, modulo: props.modulo }),
);
</script>

<template>
  <p v-if="campos" class="acoes" data-testid="abrir-atd-cadastro-recusado">
    <SanteAlerta
      variante="alerta"
      anunciar
      :texto="campos.length ? t('recusado', { campos: campos.join(', ') }) : t('recusadoSemLista')"
    />
    <RouterLink
      :to="{ path: `/cadastros/pacientes/${idPaciente}`, query: consultaDeRotaDoEscopo(escopo) }"
      target="_blank"
      rel="noopener"
      data-testid="abrir-atd-completar-recusado"
      >{{ t('completar') }}</RouterLink
    >
    <span class="secundario">{{ t('depois') }}</span>
  </p>
</template>
