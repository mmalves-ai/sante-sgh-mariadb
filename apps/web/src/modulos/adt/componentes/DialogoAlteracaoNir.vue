<script setup lang="ts">
// W0-07 (programa CRUD completo): o diálogo único de correção, alteração e exclusão do NIR, do mapa de leitos e da
// observação do PA. Os campos próprios de cada ação entram pelo slot; o motivo é sempre obrigatório (ao menos 5
// caracteres: vai à trilha com quem e quando; o valor anterior fica na versão do registro). A operação crítica
// (excluir a solicitação) pede a senha aqui mesmo (reautenticação no diálogo). A recusa do servidor aparece num aviso
// único dentro do diálogo, com o texto da regra (ex.: quantos registros dependem).
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import ErroAdt from './ErroAdt.vue';

/**
 * As recusas do W0-07 cujo texto do servidor é a própria regra, em termos de produto (quantos e quais registros
 * dependem; por que a reserva não se altera): o diálogo mostra esse texto no aviso único.
 */
const RECUSAS_COM_TEXTO = new Set([
  'solicitacao-com-vinculo',
  'solicitacao-encerrada',
  'solicitacao-desatualizada',
  'nada-a-corrigir',
  'nada-a-alterar',
  'reserva-convertida',
  'reserva-com-desdobramento',
  'reserva-desatualizada',
  'leito-reservado',
  'leito-incompativel',
  'dpa-retirada',
  'dpa-desatualizada',
  'barreira-resolvida',
  'limite-inexistente',
  'estado-inexistente',
  'atributos-inexistentes',
  'leito-ocupado',
  'fora-de-observacao',
]);

const props = withDefaults(
  defineProps<{
    titulo: string;
    texto?: string;
    rotuloMotivo?: string;
    rotuloConfirmar: string;
    /** Exclusão e cancelamento: o botão em destaque de perigo (o próprio diálogo é a confirmação). */
    destrutivo?: boolean;
    /** Operação crítica: a senha de quem age (reautenticação). */
    pedeSenha?: boolean;
    /** O slot ainda não está completo (ex.: escolha o leito). */
    incompleto?: boolean;
    /** O tamanho do motivo (o cancelamento aceita de 3 a 500 caracteres; a alteração, de 5 a 300). */
    minMotivo?: number;
    maxMotivo?: number;
    testid: string;
  }>(),
  {
    texto: '',
    rotuloMotivo: '',
    destrutivo: false,
    pedeSenha: false,
    incompleto: false,
    minMotivo: 5,
    maxMotivo: 300,
  },
);
const emit = defineEmits<{ confirmar: [dados: { motivo: string; senha: string }] }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const { t } = useI18n();
const motivo = ref('');
const senha = ref('');
const erro = ref<unknown>(null);
const enviando = ref(false);
watch(visivel, (v) => {
  if (v) {
    motivo.value = '';
    senha.value = '';
    erro.value = null;
  }
});
const textoDaRecusa = computed(() => {
  const e = erro.value;
  if (!(e instanceof ErroApi) || !e.problema) return null;
  const p = e.problema as { codigo?: unknown; detail?: unknown };
  return typeof p.codigo === 'string' && RECUSAS_COM_TEXTO.has(p.codigo) && typeof p.detail === 'string'
    ? p.detail
    : null;
});
const pronto = computed(
  () =>
    !props.incompleto &&
    motivo.value.trim().length >= props.minMotivo &&
    (!props.pedeSenha || senha.value.length > 0) &&
    !enviando.value,
);

/** Quem abre passa a ação; o diálogo mostra a recusa e só fecha quando gravou. */
async function executar(acao: (d: { motivo: string; senha: string }) => Promise<unknown>): Promise<void> {
  erro.value = null;
  enviando.value = true;
  try {
    await acao({ motivo: motivo.value.trim(), senha: senha.value });
    visivel.value = false;
  } catch (x) {
    erro.value = x;
  } finally {
    enviando.value = false;
  }
}
defineExpose({ executar });
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="titulo">
    <form
      :data-testid="testid"
      class="dialogo-nir"
      @submit.prevent="pronto && emit('confirmar', { motivo, senha })"
    >
      <p v-if="texto">{{ texto }}</p>
      <slot />
      <SanteCampoTexto
        v-model="motivo"
        :rotulo="rotuloMotivo || t('crudNir.motivo')"
        :max-bytes="maxMotivo"
        multilinha
        obrigatorio
        :data-testid="`${testid}-motivo`"
      />
      <p v-if="motivo.trim().length > 0 && motivo.trim().length < minMotivo" class="secundario" role="status">
        {{ t('crudNir.motivoCurto', { n: minMotivo }) }}
      </p>
      <div v-if="pedeSenha" class="campo-senha">
        <label :for="`${testid}-senha`">{{ t('crudNir.senha') }}</label>
        <input
          :id="`${testid}-senha`"
          v-model="senha"
          type="password"
          autocomplete="current-password"
          :data-testid="`${testid}-senha`"
        />
        <small>{{ t('crudNir.senhaTexto') }}</small>
      </div>
      <div v-if="textoDaRecusa" role="alert" :data-testid="`${testid}-recusa`">
        <SanteAlerta variante="alerta" :texto="textoDaRecusa" />
      </div>
      <ErroAdt v-else-if="erro" :erro="erro" />
      <div class="acoes">
        <SanteBotao
          :rotulo="rotuloConfirmar"
          variante="primario"
          :class="{ 'confirmar-destrutivo': destrutivo }"
          :desabilitado="!pronto"
          :data-testid="`${testid}-confirmar`"
          @acionar="emit('confirmar', { motivo: motivo.trim(), senha })"
        />
        <SanteBotao :rotulo="t('crudNir.voltar')" variante="secundario" @acionar="visivel = false" />
      </div>
    </form>
  </SanteDialogo>
</template>

<style scoped>
.dialogo-nir {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.campo-senha {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.confirmar-destrutivo :deep(button),
.confirmar-destrutivo {
  --sgh-botao-fundo: var(--sgh-perigo, var(--sgh-alerta));
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
</style>
