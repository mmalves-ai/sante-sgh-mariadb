<script setup lang="ts">
// Tela bloqueada (ficha do M05 §7; regra 16 do M07): oculta tudo e volta à mesma tela com o digitado.
// Sessão REAL: só desbloqueia com a senha (POST /api/sessao/reautenticar), conferida no servidor; "Entrar
// com outro usuário" encerra a sessão e volta à entrada. Sessão sintética (só testes de dev/ci): desbloqueia
// sem senha, como no M07. W1-01 (parte 11b3b): "Trocar de usuário com PIN" (login + PIN; troca rápida no mesmo
// posto) abre a sessão de outra pessoa sem encerrar a bloqueada; recusa genérica; desligada no estabelecimento, some.
import { SanteBotao, SanteIcone } from '@sgh/ui';
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarBloqueio } from './bloqueio.js';
import { mensagemDoErro } from '../erros/problem-details.js';
import { usarDesbloqueio, usarSaida, usarTrocaPorPin } from '../sessao/sessao.js';

const props = defineProps<{ sintetica: boolean }>();
const { t } = useI18n();
const bloqueio = usarBloqueio();
const desbloqueio = usarDesbloqueio();
const sairDaSessao = usarSaida();
const camada = ref<HTMLElement | null>(null);
const senha = ref('');
const erro = ref('');
const trocaPin = usarTrocaPorPin();
const modoPin = ref(false);
const pinDesligado = ref(false);
const loginPin = ref('');
const pin = ref('');
const erroPin = ref('');
watch(
  () => bloqueio.bloqueada,
  async (v) => {
    if (v) {
      senha.value = '';
      erro.value = '';
      modoPin.value = false;
      loginPin.value = '';
      pin.value = '';
      erroPin.value = '';
      await nextTick();
      camada.value?.focus();
    }
  },
);

function desbloquear(): void {
  if (props.sintetica) {
    bloqueio.desbloquear();
    return;
  }
  if (!senha.value || desbloqueio.isPending.value) return;
  erro.value = '';
  desbloqueio.mutate(senha.value, {
    onSuccess: () => (senha.value = ''),
    onError: (e) => {
      senha.value = '';
      const tipo = mensagemDoErro(e).tipo;
      erro.value =
        tipo === 'muitas-tentativas'
          ? t('entrar.muitasTentativas')
          : tipo === 'indisponivel' || tipo === 'rede'
            ? t('entrar.indisponivelServico')
            : t('bloqueio.senhaInvalida');
    },
  });
}

function trocarComPin(): void {
  const login = loginPin.value.trim();
  if (!login || !/^\d{4,8}$/.test(pin.value) || trocaPin.isPending.value) {
    erroPin.value = t('bloqueio.pin.incompleto');
    return;
  }
  erroPin.value = '';
  trocaPin.mutate(
    { login, pin: pin.value },
    {
      onSuccess: () => {
        pin.value = '';
        loginPin.value = '';
        modoPin.value = false;
      },
      onError: (e) => {
        pin.value = '';
        const tipo = mensagemDoErro(e).tipo;
        if (tipo === 'operacao-bloqueada') {
          pinDesligado.value = true;
          modoPin.value = false;
          erro.value = t('bloqueio.pin.desligada');
          return;
        }
        erroPin.value =
          tipo === 'indisponivel' || tipo === 'rede'
            ? t('entrar.indisponivelServico')
            : t('bloqueio.pin.recusado');
      },
    },
  );
}
</script>

<template>
  <div
    v-if="bloqueio.bloqueada"
    ref="camada"
    class="bloqueio"
    role="dialog"
    aria-modal="true"
    aria-labelledby="bloqueio-titulo"
    tabindex="-1"
    data-testid="camada-bloqueio"
  >
    <div class="bloqueio__caixa">
      <h1 id="bloqueio-titulo"><SanteIcone nome="cadeado" /> {{ t('bloqueio.titulo') }}</h1>
      <p>{{ t('bloqueio.texto') }}</p>
      <p v-if="sintetica" class="bloqueio__nota">{{ t('bloqueio.sintetico') }}</p>
      <form class="bloqueio__form" @submit.prevent="desbloquear">
        <label v-if="!sintetica" class="bloqueio__campo">
          <span>{{ t('bloqueio.senha') }}</span>
          <input
            v-model="senha"
            type="password"
            name="senha"
            autocomplete="current-password"
            required
            data-testid="senha-desbloqueio"
          />
        </label>
        <p v-if="erro" role="alert" class="bloqueio__erro" data-testid="erro-desbloqueio">{{ erro }}</p>
        <SanteBotao
          :rotulo="t('bloqueio.desbloquear')"
          tipo="submit"
          :desabilitado="desbloqueio.isPending.value"
          data-testid="desbloquear"
        />
      </form>
      <form
        v-if="!sintetica && modoPin"
        class="bloqueio__form bloqueio__pin"
        data-testid="form-troca-pin"
        @submit.prevent="trocarComPin"
      >
        <h2 class="bloqueio__subtitulo">{{ t('bloqueio.pin.titulo') }}</h2>
        <p class="bloqueio__nota">{{ t('bloqueio.pin.texto') }}</p>
        <label class="bloqueio__campo">
          <span>{{ t('bloqueio.pin.login') }}</span>
          <input
            v-model="loginPin"
            type="text"
            name="login"
            autocomplete="username"
            maxlength="30"
            required
            data-testid="login-troca-pin"
          />
        </label>
        <label class="bloqueio__campo">
          <span>{{ t('bloqueio.pin.pin') }}</span>
          <input
            v-model="pin"
            type="password"
            name="pin"
            inputmode="numeric"
            autocomplete="off"
            maxlength="8"
            required
            data-testid="pin-troca"
          />
        </label>
        <p v-if="erroPin" role="alert" class="bloqueio__erro" data-testid="erro-troca-pin">{{ erroPin }}</p>
        <SanteBotao
          :rotulo="t('bloqueio.pin.entrar')"
          tipo="submit"
          :desabilitado="trocaPin.isPending.value"
          data-testid="confirmar-troca-pin"
        />
        <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="modoPin = false" />
      </form>
      <button
        v-if="!sintetica && !modoPin && !pinDesligado"
        type="button"
        class="bloqueio__outro"
        data-testid="abrir-troca-pin"
        @click="modoPin = true"
      >
        {{ t('bloqueio.pin.abrir') }}
      </button>
      <button
        v-if="!sintetica"
        type="button"
        class="bloqueio__outro"
        data-testid="trocar-usuario"
        @click="sairDaSessao()"
      >
        {{ t('bloqueio.trocarUsuario') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.bloqueio {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: grid;
  place-items: center;
  background: var(--sgh-fundo);
}
.bloqueio__caixa {
  max-width: 32rem;
  padding: var(--sgh-espaco-4);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 8px;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
}
.bloqueio__nota {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.bloqueio__form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.bloqueio__campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.bloqueio__campo input {
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-2);
  font: inherit;
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.bloqueio__pin {
  margin-top: var(--sgh-espaco-3);
  padding-top: var(--sgh-espaco-3);
  border-top: 1px solid var(--sgh-borda-forte);
}
.bloqueio__subtitulo {
  margin: 0;
  font-size: var(--sgh-fonte-media, 1.1rem);
}
.bloqueio__erro {
  color: var(--sgh-alerta);
}
.bloqueio__outro {
  margin-top: var(--sgh-espaco-3);
  min-height: var(--sgh-alvo-minimo);
  padding: 0;
  border: 0;
  background: none;
  color: var(--sgh-texto);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.bloqueio :focus-visible {
  outline: 2px solid var(--sgh-foco);
  outline-offset: 2px;
}
</style>
