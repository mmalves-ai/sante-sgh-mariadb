<script setup lang="ts">
// A escolha do segundo fator da própria conta (família acesso-ligacao): o código do aplicativo autenticador ou o
// código enviado ao e-mail a cada entrada. O servidor exige a senha confirmada há pouco (reautenticação) e o CSRF.
import { SanteAlerta } from '@sgh/ui';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import {
  escolherMetodoSegundoFator,
  lerMetodoSegundoFator,
  type MetodoSegundoFatorTela,
} from '../api-acesso-email.js';

const { t } = useI18n();
const estado = ref<MetodoSegundoFatorTela | null>(null);
const aviso = ref('');
const erro = ref('');
const ocupado = ref(false);

onMounted(async () => {
  estado.value = await lerMetodoSegundoFator().catch(() => null);
});

async function escolher(metodo: MetodoSegundoFatorTela['metodo']): Promise<void> {
  if (ocupado.value || !estado.value || estado.value.metodo === metodo) return;
  ocupado.value = true;
  aviso.value = '';
  erro.value = '';
  try {
    estado.value = await escolherMetodoSegundoFator(metodo);
    aviso.value = t('acessoEmail.metodo.salvo');
  } catch (e) {
    erro.value =
      e instanceof ErroApi && e.status === 401
        ? t('acessoEmail.metodo.confirmeSenha')
        : (e instanceof ErroApi ? e.problema?.detail : null) || t('acessoEmail.metodo.erro');
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section v-if="estado" class="metodo" aria-labelledby="metodo-titulo" data-testid="metodo-segundo-fator">
    <h2 id="metodo-titulo">{{ t('acessoEmail.metodo.titulo') }}</h2>
    <fieldset :disabled="ocupado">
      <label>
        <input
          type="radio"
          name="metodo-segundo-fator"
          value="aplicativo"
          :checked="estado.metodo === 'aplicativo'"
          data-testid="metodo-aplicativo"
          @change="escolher('aplicativo')"
        />
        {{ t('acessoEmail.metodo.aplicativo') }}
      </label>
      <label>
        <input
          type="radio"
          name="metodo-segundo-fator"
          value="email"
          :checked="estado.metodo === 'email'"
          :disabled="!estado.emailDisponivel"
          data-testid="metodo-email"
          @change="escolher('email')"
        />
        {{ t('acessoEmail.metodo.email') }}
      </label>
    </fieldset>
    <small>{{
      estado.emailDisponivel ? t('acessoEmail.metodo.ajuda') : t('acessoEmail.metodo.emailIndisponivel')
    }}</small>
    <SanteAlerta v-if="aviso" variante="info" :texto="aviso" anunciar />
    <p v-if="erro" role="alert" data-testid="metodo-erro">{{ erro }}</p>
  </section>
</template>

<style scoped>
.metodo fieldset {
  display: grid;
  gap: var(--sgh-espaco-2);
  border: 0;
  padding: 0;
}
</style>
