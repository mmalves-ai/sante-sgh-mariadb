<script setup lang="ts">
// Campo de texto restrito ao CP1252 (ADR 0008; regra 6). O MESMO validador de @sgh/contratos roda aqui e
// no servidor: recusa emoji e caractere fora do CP1252 com mensagem clara, propõe troca antes de salvar,
// troca espaço especial colado por espaço comum e limita pelo tamanho da coluna legada em bytes.
import { analisarCp1252, esquemaTextoCp1252, normalizarEntrada } from '@sgh/contratos';
import InputText from 'openvue/inputtext';
import Textarea from 'openvue/textarea';
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { falhaDoIssue, traduzirFalha } from '../validacao/traduzir.js';

const props = withDefaults(
  defineProps<{
    rotulo: string;
    maxBytes: number;
    multilinha?: boolean;
    obrigatorio?: boolean;
    id?: string;
  }>(),
  { multilinha: false, obrigatorio: false, id: '' },
);
const valor = defineModel<string>({ required: true });
const { t } = useI18n();
const idGerado = useId();
const idCampo = computed(() => props.id || `sgh-texto-${idGerado}`);
const idMensagem = computed(() => `${idCampo.value}-mensagem`);
const analise = computed(() => analisarCp1252(valor.value));
// O MESMO schema Zod do servidor decide se o texto é aceito; a mensagem vem traduzida pelo código.
const esquema = computed(() => esquemaTextoCp1252({ maxBytes: props.maxBytes }));
const erro = computed(() => {
  const r = esquema.value.safeParse(valor.value);
  if (r.success) return null;
  const falha = falhaDoIssue(r.error.issues[0] as { params?: Record<string, unknown> } | undefined);
  return falha ? traduzirFalha(t, falha) : t('ui.validacao.desconhecida');
});
const valido = computed(() => erro.value === null);

function aoDigitar(novo: string | undefined): void {
  const normalizado = normalizarEntrada(novo ?? '');
  valor.value = normalizado;
}
function aplicarTroca(): void {
  if (analise.value.proposta !== null) valor.value = analise.value.proposta;
}
defineExpose({ valido });
</script>

<template>
  <div class="sgh-campo">
    <label :for="idCampo" class="sgh-campo__rotulo">{{ rotulo }}</label>
    <Textarea
      v-if="multilinha"
      :id="idCampo"
      :model-value="valor"
      :invalid="!valido"
      :required="obrigatorio"
      :aria-invalid="!valido"
      :aria-describedby="idMensagem"
      auto-resize
      class="sgh-campo__entrada"
      @update:model-value="aoDigitar"
    />
    <InputText
      v-else
      :id="idCampo"
      :model-value="valor"
      :invalid="!valido"
      :required="obrigatorio"
      :aria-invalid="!valido"
      :aria-describedby="idMensagem"
      class="sgh-campo__entrada"
      @update:model-value="aoDigitar"
    />
    <div :id="idMensagem" class="sgh-campo__rodape" aria-live="polite">
      <span v-if="erro" class="sgh-campo__erro" data-testid="erro-cp1252">{{ erro }}</span>
      <span class="sgh-campo__contador">{{
        t('ui.texto.contador', { usados: analise.bytes, limite: maxBytes })
      }}</span>
    </div>
    <div v-if="analise.proposta !== null" class="sgh-campo__troca">
      <span>{{ t('ui.texto.trocaProposta', { proposta: analise.proposta }) }}</span>
      <button type="button" class="sgh-campo__aplicar" data-testid="aplicar-troca" @click="aplicarTroca">
        {{ t('ui.texto.aplicarTroca') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.sgh-campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.sgh-campo__rotulo {
  font-weight: 600;
}
.sgh-campo__entrada {
  min-height: var(--sgh-alvo-minimo);
  /* Altura de linha fixa: um emoji colado (fonte de reserva do sistema) não muda a altura do campo. */
  line-height: 1.4;
}
.sgh-campo__rodape {
  display: flex;
  justify-content: space-between;
  gap: var(--sgh-espaco-2);
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
}
.sgh-campo__erro {
  color: var(--sgh-alerta);
  font-weight: 600;
}
.sgh-campo__troca {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  background: var(--sgh-aviso-suave);
  color: var(--sgh-texto);
}
.sgh-campo__aplicar {
  min-height: var(--sgh-alvo-minimo);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-primaria);
  border-radius: 4px;
  cursor: pointer;
}
.sgh-campo__aplicar:focus-visible {
  outline: 2px solid var(--sgh-foco);
  outline-offset: 2px;
}
</style>
