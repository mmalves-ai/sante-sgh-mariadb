<script setup lang="ts">
// Volta do provedor de identidade (01-ADM L61): o navegador chega com o código e o estado na consulta; o servidor
// confere o token e abre a sessão da conta ligada. A entrada externa não dispensa o segundo fator da conta: quando a
// política pede, a tela pede o código aqui mesmo (a identidade conferida fica guardada pelo estado por 5 minutos).
// A recusa (identidade sem conta ligada, vínculo desligado, token recusado) aparece com o caminho de volta à entrada.
import type { Sessao } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { CHAVE_SESSAO } from '../../../casca/sessao/sessao.js';
import { mensagemDoErro } from '../../../casca/erros/problem-details.js';
import { codigoDoErro } from '../api-identidade.js';
import { concluirEntradaProvedor } from '../api-provedor-identidade.js';
import { codigoLimpo, destinoDepoisDoLogin, textoRecusaSegundoFator } from '../identidade-tela.js';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Entrada pelo provedor de identidade',
      conferindo: 'Conferindo a sua identidade…',
      codigo: 'Código do segundo fator',
      ajudaCodigo: 'A sua conta exige o segundo fator também na entrada pelo provedor.',
      confirmar: 'Confirmar',
      voltar: 'Voltar à entrada',
      recusada: 'A entrada pelo provedor foi recusada.',
      provedorRecusou: 'O provedor não autorizou a entrada.',
    },
  },
});

const rota = useRoute();
const roteador = useRouter();
const cliente = useQueryClient();
const estado = typeof rota.query['state'] === 'string' ? rota.query['state'] : '';
const codigo = typeof rota.query['code'] === 'string' ? rota.query['code'] : undefined;
const recusaDoProvedor = typeof rota.query['error'] === 'string';
const conferindo = ref(true);
const pedeCodigo = ref(false);
const segundoFator = ref('');
const erro = ref('');

async function seguir(sessao: Sessao): Promise<void> {
  cliente.setQueryData(CHAVE_SESSAO, sessao);
  await roteador.replace(destinoDepoisDoLogin(sessao));
}

async function concluir(codigoSegundoFator?: string): Promise<void> {
  conferindo.value = true;
  erro.value = '';
  try {
    await seguir(await concluirEntradaProvedor(estado, codigo, codigoSegundoFator));
  } catch (e) {
    const c = codigoDoErro(e);
    if (c?.startsWith('segundo-fator')) {
      pedeCodigo.value = true;
      erro.value = codigoSegundoFator ? (textoRecusaSegundoFator(c) ?? '') : '';
    } else erro.value = mensagemDoErro(e).motivo || t('recusada');
  } finally {
    conferindo.value = false;
    segundoFator.value = '';
  }
}

onMounted(() => {
  if (recusaDoProvedor || !estado) {
    conferindo.value = false;
    erro.value = t('provedorRecusou');
    return;
  }
  void concluir();
});
</script>

<template>
  <main class="provedor" aria-labelledby="provedor-titulo">
    <h1 id="provedor-titulo">{{ t('titulo') }}</h1>
    <p v-if="conferindo" role="status" data-testid="provedor-conferindo">{{ t('conferindo') }}</p>
    <form
      v-if="pedeCodigo"
      class="provedor__form"
      data-testid="provedor-segundo-fator"
      @submit.prevent="concluir(codigoLimpo(segundoFator))"
    >
      <p>{{ t('ajudaCodigo') }}</p>
      <SanteCampoTexto
        v-model="segundoFator"
        :max-bytes="10"
        :rotulo="t('codigo')"
        obrigatorio
        autocomplete="one-time-code"
        data-testid="provedor-codigo"
      />
      <SanteBotao
        :rotulo="t('confirmar')"
        tipo="submit"
        :desabilitado="conferindo || !segundoFator.trim()"
        data-testid="provedor-confirmar"
      />
    </form>
    <template v-if="erro">
      <p role="alert" class="provedor__erro" data-testid="provedor-erro">{{ erro }}</p>
      <RouterLink :to="{ name: 'entrar' }" data-testid="provedor-voltar">{{ t('voltar') }}</RouterLink>
    </template>
  </main>
</template>

<style scoped>
.provedor {
  display: grid;
  gap: var(--sgh-espaco-3);
  max-width: 28rem;
  margin: var(--sgh-espaco-4) auto;
  padding: 0 var(--sgh-espaco-3);
}
.provedor__form {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.provedor__erro {
  margin: 0;
  color: var(--sgh-alerta);
}
</style>
