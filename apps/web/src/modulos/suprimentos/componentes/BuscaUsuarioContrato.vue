<script setup lang="ts">
// A busca do gestor e do fiscal do contrato entre os usuários ativos (pelo login ou nome) e a escolha numa SanteSelecao
// com busca (ADR 0027): o login só chega ao formulário depois de achado; o servidor confere de novo.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarUsuariosContrato } from '../api-contrato.js';

const props = defineProps<{ rotulo: string; testid: string }>();
const valor = defineModel<string>({ required: true });
const { t } = useI18n();
const id = useId();
const termo = ref('');
const achados = ref<readonly { login: string; nome: string }[] | null>(null);
const erro = ref(false);

async function procurar(): Promise<void> {
  erro.value = false;
  try {
    achados.value = (await buscarUsuariosContrato(termo.value.trim())).itens;
  } catch {
    erro.value = true;
  }
}
const opcoes = computed(() => {
  const xs = achados.value ?? [];
  const atual =
    valor.value && !xs.some((u) => u.login === valor.value)
      ? [
          {
            valor: valor.value,
            rotulo: t('contratoFornecedor.formulario.usuarioAtual', { login: valor.value }),
          },
        ]
      : [];
  return [...atual, ...xs.map((u) => ({ valor: u.login, rotulo: `${u.login} · ${u.nome}` }))];
});
const tid = (s: string) => `${props.testid}-${s}`;
</script>

<template>
  <fieldset class="campo-usuario">
    <legend>{{ rotulo }}</legend>
    <span class="campo">
      <label :for="`usuario-${id}`">{{ t('contratoFornecedor.formulario.buscarUsuario') }}</label>
      <input
        :id="`usuario-${id}`"
        v-model="termo"
        type="search"
        maxlength="31"
        :data-testid="tid('termo')"
        @keyup.enter="procurar"
      />
    </span>
    <SanteBotao
      variante="secundario"
      :rotulo="t('contratoFornecedor.formulario.buscarUsuario')"
      :data-testid="tid('buscar')"
      @acionar="procurar"
    />
    <SanteSelecao
      v-if="opcoes.length > 0"
      v-model="valor"
      :rotulo="t('contratoFornecedor.formulario.usuarioEscolhido')"
      :opcoes="opcoes"
      :busca="true"
      :data-testid="testid"
    />
    <p v-if="achados && achados.length === 0" role="status">
      {{ t('contratoFornecedor.formulario.usuarioNenhum') }}
    </p>
    <p v-if="erro" role="alert">{{ t('contratoFornecedor.formulario.usuarioNenhum') }}</p>
  </fieldset>
</template>
