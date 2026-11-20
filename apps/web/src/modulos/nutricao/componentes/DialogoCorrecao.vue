<script setup lang="ts">
// W0-05: o diálogo de toda correção, estorno, encerramento, cancelamento, revogação e alteração da nutrição, do serviço
// social, da oncologia e do lactário, no padrão da ficha de Usuários e Acessos e da ficha do profissional: o motivo
// obrigatório (5 a 500 letras; fica no histórico com o login e a hora), os campos próprios da ação no slot e, nas
// críticas, a senha de novo (reautenticação, SBIS-07). Fica aberto até a resposta: senha que não confere aparece dentro
// dele; a recusa do servidor também (o aviso único da tela continua com a mensagem de sucesso). A senha nunca fica
// guardada.
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo } from '@sgh/ui';
import { nextTick, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';

const visivel = defineModel<boolean>('visivel', { required: true });
const props = defineProps<{
  titulo: string;
  texto?: string | undefined;
  confirmar: string;
  /** Rótulo do motivo (padrão: "Motivo"). */
  rotuloMotivo?: string | undefined;
  /** Operação crítica: pede a senha de novo. */
  critica?: boolean;
  alerta?: string | undefined;
  /** Bloqueia o confirmar (os campos próprios ainda incompletos). */
  incompleto?: boolean;
  gravar: (x: { motivo: string; senha: string }) => Promise<unknown>;
}>();
const emit = defineEmits<{ feito: [resultado: unknown] }>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`nutricao.correcao.${k}`, p ?? {});
const id = `correcao-${useId()}`;
const motivo = ref('');
const senha = ref('');
const erro = ref('');
const ocupado = ref(false);
const form = ref<HTMLFormElement | null>(null);

watch(visivel, (aberto) => {
  senha.value = '';
  erro.value = '';
  if (aberto) motivo.value = '';
});

function mensagemDoErro(e: unknown): string {
  if (e instanceof ErroApi) {
    const tipo = e.problema ? tipoDoProblema(e.problema) : null;
    if (tipo === 'reautenticacao-necessaria' || (tipo === null && e.status === 401)) return T('senhaErrada');
    const lista = (e.problema as { bloqueios?: string[] } | undefined)?.bloqueios ?? [];
    const base = e.problema?.detail || e.problema?.title || T('falhou');
    return lista.length ? `${base} ${lista.join('; ')}.` : base;
  }
  return T('falhou');
}

const curto = () => motivo.value.trim().length < 5;

async function confirmarAcao(): Promise<void> {
  if (ocupado.value || curto() || props.incompleto || (props.critica && !senha.value)) return;
  ocupado.value = true;
  erro.value = '';
  try {
    const r = await props.gravar({ motivo: motivo.value.trim(), senha: senha.value });
    visivel.value = false;
    emit('feito', r);
  } catch (e) {
    erro.value = mensagemDoErro(e);
    senha.value = '';
    void nextTick(() =>
      form.value?.querySelector<HTMLElement>(props.critica ? `#${id}-senha` : `#${id}-motivo`)?.focus(),
    );
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="titulo">
    <form
      ref="form"
      class="dialogo-correcao"
      data-testid="form-correcao"
      :aria-busy="ocupado ? 'true' : undefined"
      @submit.prevent="confirmarAcao"
    >
      <p v-if="texto">{{ texto }}</p>
      <SanteAlerta v-if="alerta" :texto="alerta" variante="aviso" data-testid="correcao-alerta" />
      <SanteAlerta v-if="erro" :texto="erro" variante="aviso" anunciar data-testid="correcao-erro" />
      <slot />
      <div class="campo">
        <label :for="`${id}-motivo`">{{ rotuloMotivo ?? T('motivo') }}</label>
        <textarea
          :id="`${id}-motivo`"
          v-model="motivo"
          rows="3"
          maxlength="500"
          required
          :aria-describedby="`${id}-motivo-ajuda`"
          data-testid="correcao-motivo"
        />
        <small :id="`${id}-motivo-ajuda`">{{ T('motivoAjuda') }}</small>
      </div>
      <div v-if="critica" class="campo">
        <label :for="`${id}-senha`">{{ T('senha') }}</label>
        <input
          :id="`${id}-senha`"
          v-model="senha"
          type="password"
          autocomplete="current-password"
          required
          :aria-describedby="`${id}-senha-ajuda`"
          data-testid="correcao-senha"
        />
        <small :id="`${id}-senha-ajuda`">{{ T('senhaAjuda') }}</small>
      </div>
      <div class="botoes">
        <SanteBotao :rotulo="T('voltar')" variante="texto" @acionar="visivel = false" />
        <SanteBotao
          :rotulo="ocupado ? T('gravando') : confirmar"
          tipo="submit"
          :desabilitado="ocupado || curto() || !!incompleto || (!!critica && !senha)"
          data-testid="correcao-confirmar"
        />
      </div>
    </form>
  </SanteDialogo>
</template>

<style scoped>
.dialogo-correcao {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: min(28rem, 80vw);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.campo label {
  font-weight: 600;
}
.campo textarea,
.campo input {
  font: inherit;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 6px;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
}
.botoes {
  display: flex;
  justify-content: flex-end;
  gap: var(--sgh-espaco-2);
}
/*
 * Revisão: os campos próprios da ação vêm pelo slot e o diálogo é montado no body (fora de .tela-agenda): sem estas
 * regras, os inputs crus (número, data e hora, marcação) das telas ficam com o visual do navegador e sem o tema escuro.
 */
:slotted(.campo) {
  display: grid;
  gap: var(--sgh-espaco-1);
}
:slotted(.campo label) {
  font-weight: 600;
}
:slotted(.campo input:not([type='checkbox']):not([type='radio'])),
:slotted(.campo select),
:slotted(.campo textarea) {
  font: inherit;
  min-height: var(--sgh-alvo-minimo);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 6px;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
}
:slotted(.campo input:focus-visible),
:slotted(.campo textarea:focus-visible) {
  outline: 3px solid var(--sgh-foco);
  outline-offset: 1px;
}
:slotted(.grade) {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: var(--sgh-espaco-2);
  align-items: end;
}
:slotted(.marca),
:slotted(.opcao) {
  display: flex;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
:slotted(input[type='checkbox']) {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--sgh-primaria);
}
</style>
