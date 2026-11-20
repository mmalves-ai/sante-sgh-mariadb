<script setup lang="ts">
// Diálogo de gravação, implementação única (X-01; antes havia o do cadastro, D-PROF-39, e o de reautenticação da
// ficha do usuário): pede o motivo (inativar, reativar, excluir, justificativa) e, nas gravações críticas, a senha de
// novo (reautenticação, SBIS-07). Fica aberto até a resposta: senha que não confere aparece DENTRO dele (o campo
// limpa e recebe o foco), sem perder o motivo. Sucesso fecha e emite `feito`; recusa e erro fecham e emitem `falha`
// para o aviso da tela. A senha nunca fica guardada: limpa ao abrir e ao fechar por qualquer caminho.
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  problemaDeSenha,
  TESTIDS_GRAVACAO,
  type PedidoGravacao,
  type TestidsGravacao,
} from './dialogo-gravacao.js';
import SanteAlerta from './SanteAlerta.vue';
import SanteBotao from './SanteBotao.vue';
import SanteDialogo from './SanteDialogo.vue';

const visivel = defineModel<boolean>('visivel', { required: true });
/** Gravando agora (a tela pode usar para travar os outros controles). */
const ocupado = defineModel<boolean>('ocupado', { default: false });
const props = defineProps<{ pedido: PedidoGravacao | null; testids?: Partial<TestidsGravacao> }>();
const emit = defineEmits<{ feito: []; falha: [erro: unknown] }>();
const { t } = useI18n();
const id = `gravacao-${useId()}`;
const tid = computed<TestidsGravacao>(() => ({ ...TESTIDS_GRAVACAO, ...props.testids }));
const motivo = ref('');
const senha = ref('');
const erroSenha = ref('');
const form = ref<HTMLFormElement | null>(null);

watch(visivel, (aberto) => {
  senha.value = '';
  erroSenha.value = '';
  if (aberto) motivo.value = '';
});

const motivoCurto = () =>
  !!props.pedido?.motivo && (props.pedido.motivoObrigatorio ?? true) && motivo.value.trim().length < 10;

async function confirmar(): Promise<void> {
  const p = props.pedido;
  if (!p || ocupado.value || (p.senha && !senha.value) || motivoCurto()) return;
  ocupado.value = true;
  erroSenha.value = '';
  try {
    await p.gravar({ motivo: motivo.value.trim(), senha: senha.value });
    visivel.value = false;
    emit('feito');
  } catch (e) {
    const problema = p.senha ? problemaDeSenha(e) : null;
    if (problema) {
      erroSenha.value = problema === 'senha' ? t('ui.gravacao.senhaErrada') : problema.texto;
      senha.value = '';
      void nextTick(() => form.value?.querySelector<HTMLInputElement>(`#${id}-senha`)?.focus());
    } else {
      visivel.value = false;
      emit('falha', e);
    }
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="pedido?.titulo ?? t('ui.gravacao.titulo')">
    <form
      v-if="pedido"
      ref="form"
      class="gravacao"
      :data-testid="tid.form"
      :aria-busy="ocupado ? 'true' : undefined"
      @submit.prevent="confirmar"
    >
      <p v-if="pedido.texto">{{ pedido.texto }}</p>
      <SanteAlerta v-if="pedido.alerta" :texto="pedido.alerta" variante="aviso" :data-testid="tid.alerta" />
      <SanteAlerta v-if="erroSenha" :texto="erroSenha" variante="aviso" anunciar :data-testid="tid.erro" />
      <div v-if="pedido.motivo" class="gravacao__campo">
        <label :for="`${id}-motivo`">{{ pedido.motivo }}</label>
        <textarea
          :id="`${id}-motivo`"
          v-model="motivo"
          rows="3"
          maxlength="200"
          :required="pedido.motivoObrigatorio ?? true"
          :aria-describedby="`${id}-motivo-ajuda`"
          :data-testid="tid.motivo"
        />
        <small :id="`${id}-motivo-ajuda`">{{ t('ui.gravacao.motivoAjuda') }}</small>
      </div>
      <div v-if="pedido.senha" class="gravacao__campo">
        <label :for="`${id}-senha`">{{ t('ui.gravacao.senha') }}</label>
        <input
          :id="`${id}-senha`"
          v-model="senha"
          type="password"
          autocomplete="current-password"
          required
          :aria-describedby="`${id}-senha-ajuda`"
          :data-testid="tid.senha"
        />
        <small :id="`${id}-senha-ajuda`">{{ t('ui.gravacao.senhaAjuda') }}</small>
      </div>
      <div class="gravacao__botoes">
        <SanteBotao :rotulo="t('ui.gravacao.cancelar')" variante="texto" @acionar="visivel = false" />
        <SanteBotao
          :rotulo="ocupado ? t('ui.gravacao.gravando') : pedido.confirmar"
          tipo="submit"
          :desabilitado="ocupado || (pedido.senha && !senha) || motivoCurto()"
          :data-testid="tid.confirmar"
        />
      </div>
    </form>
  </SanteDialogo>
</template>

<style scoped>
.gravacao {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: min(28rem, 80vw);
}
.gravacao__campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
input,
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
input:focus-visible,
textarea:focus-visible {
  outline: 3px solid var(--sgh-foco);
  outline-offset: 1px;
}
small {
  color: var(--sgh-texto-secundario);
}
.gravacao__botoes {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--sgh-espaco-2);
}
</style>
