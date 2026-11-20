<script setup lang="ts">
// Faixa fixa da sessão "como" (ADR 0021): quem está como quem, até quando, e "Voltar à minha conta". A volta
// encerra a sessão "como" no servidor (pela conta da plataforma ou, vencida esta, pela própria sessão do
// SPDATA) e recarrega a página inteira na conta da plataforma; se nada a encerrou, a faixa continua e avisa.
import { type ComoSessao, faixaAcessoTotal } from '@sgh/contratos';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { voltarDoComo } from '../modulos/suporte/api-suporte.js';

const props = defineProps<{ como: ComoSessao }>();
const { t } = useI18n();
const hora = computed(() =>
  new Date(props.como.expiraEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
);

const falhou = ref(false);

async function voltar(): Promise<void> {
  falhou.value = false;
  try {
    await voltarDoComo();
  } catch {
    // Não diz que voltou se a sessão "como" continua aberta no servidor.
    falhou.value = true;
    return;
  }
  window.location.assign('/plataforma');
}
</script>

<template>
  <div class="faixa-como" role="status" data-testid="faixa-como">
    <span v-if="como.modo === 'acesso-total'" data-testid="faixa-acesso-total">
      {{ faixaAcessoTotal(como.estabelecimentoNome ?? '') }}.
      {{ t('suporte.faixaAcessoTotalResto', { alvo: como.alvo.login, hora }) }}
    </span>
    <span v-else>{{
      t('suporte.faixa', { alvo: como.alvo.nome, ator: t(`suporte.faixaAtor${como.ator.tipo}`), hora })
    }}</span>
    <button type="button" class="faixa-como__voltar" data-testid="voltar-conta" @click="voltar">
      {{ t('suporte.voltar') }}
    </button>
    <span v-if="falhou" role="alert" data-testid="voltar-falhou">{{ t('suporte.voltarFalhou') }}</span>
  </div>
</template>

<style scoped>
.faixa-como {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--sgh-espaco-3);
  padding: var(--sgh-espaco-1) var(--sgh-espaco-3);
  /* Faixa invertida (texto sobre fundo trocados): destoa da casca em qualquer marca e tema. */
  background: var(--sgh-texto);
  color: var(--sgh-fundo);
  font-weight: 600;
}
.faixa-como__voltar {
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-3);
  font: inherit;
  color: var(--sgh-texto);
  background: var(--sgh-fundo);
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}
.faixa-como__voltar:focus-visible {
  outline: 2px solid var(--sgh-foco);
  outline-offset: 2px;
}
</style>
