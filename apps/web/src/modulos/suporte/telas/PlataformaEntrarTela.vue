<script setup lang="ts">
// Login PRÓPRIO da conta da plataforma (ADR 0021): separado da porta de entrada dos usuários do SPDATA.
// E-mail, senha e, quando exigido (fora de dev/ci, ou já cadastrado), o código TOTP; no primeiro login fora
// de dev/ci, o cadastro do segundo fator pelo QR. A sessão volta num cookie HttpOnly próprio.
import { SanteBotao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { mensagemDoErro } from '../../../casca/erros/problem-details.js';
import { entrarPlataforma } from '../api-suporte.js';
import { desenharQr } from '../qr.js';

const { t } = useI18n();
const roteador = useRouter();
const email = ref('');
const senha = ref('');
const codigo = ref('');
const pedirCodigo = ref(false);
const otpauth = ref('');
const entrando = ref(false);
const erro = ref('');
const qr = computed(() => (otpauth.value ? desenharQr(otpauth.value) : null));

async function enviar(): Promise<void> {
  if (entrando.value) return;
  entrando.value = true;
  erro.value = '';
  try {
    const r = await entrarPlataforma({
      email: email.value,
      senha: senha.value,
      ...(codigo.value ? { codigo: codigo.value } : {}),
    });
    if ('segundoFator' in r) {
      pedirCodigo.value = true;
      otpauth.value = r.otpauth ?? '';
      return;
    }
    senha.value = '';
    await roteador.replace('/plataforma');
  } catch (e) {
    const tipo = mensagemDoErro(e).tipo;
    erro.value =
      tipo === 'muitas-tentativas'
        ? t('suporte.muitasTentativas')
        : tipo === 'indisponivel' || tipo === 'rede'
          ? t('suporte.indisponivel')
          : t('suporte.erroEntrar');
  } finally {
    entrando.value = false;
  }
}
</script>

<template>
  <main class="plataforma-entrar" aria-labelledby="plataforma-entrar-titulo">
    <div class="plataforma-entrar__caixa">
      <h1 id="plataforma-entrar-titulo">{{ t('suporte.entrarTitulo') }}</h1>
      <p class="plataforma-entrar__texto">{{ t('suporte.entrarTexto') }}</p>
      <form class="plataforma-entrar__form" @submit.prevent="enviar">
        <label class="plataforma-entrar__campo">
          <span>{{ t('suporte.email') }}</span>
          <input
            v-model="email"
            type="email"
            autocomplete="username"
            required
            data-testid="plataforma-email"
          />
        </label>
        <label class="plataforma-entrar__campo">
          <span>{{ t('suporte.senha') }}</span>
          <input
            v-model="senha"
            type="password"
            autocomplete="current-password"
            required
            data-testid="plataforma-senha"
          />
        </label>
        <template v-if="pedirCodigo">
          <p v-if="qr" data-testid="plataforma-cadastro-totp">{{ t('suporte.cadastrarTotp') }}</p>
          <svg
            v-if="qr"
            :width="qr.lado"
            :height="qr.lado"
            :viewBox="`0 0 ${qr.lado} ${qr.lado}`"
            role="img"
            :aria-label="t('suporte.cadastrarTotp')"
          >
            <rect class="plataforma-entrar__qr-fundo" :width="qr.lado" :height="qr.lado" />
            <path class="plataforma-entrar__qr" :d="qr.caminho" />
          </svg>
          <label class="plataforma-entrar__campo">
            <span>{{ t('suporte.codigo') }}</span>
            <input
              v-model="codigo"
              inputmode="numeric"
              autocomplete="one-time-code"
              required
              data-testid="plataforma-codigo"
            />
            <small>{{ t('suporte.codigoAjuda') }}</small>
          </label>
        </template>
        <p v-if="erro" role="alert" class="plataforma-entrar__erro" data-testid="plataforma-erro">
          {{ erro }}
        </p>
        <SanteBotao
          :rotulo="entrando ? t('suporte.entrando') : t('suporte.acessar')"
          tipo="submit"
          :desabilitado="entrando"
          data-testid="plataforma-acessar"
        />
      </form>
    </div>
  </main>
</template>

<style scoped>
.plataforma-entrar {
  min-height: 80vh;
  display: grid;
  place-items: center;
  padding: var(--sgh-espaco-4);
}
.plataforma-entrar__caixa {
  width: 100%;
  max-width: 26rem;
  padding: var(--sgh-espaco-4);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 8px;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
}
.plataforma-entrar__texto {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.plataforma-entrar__form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.plataforma-entrar__campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.plataforma-entrar__campo input {
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-2);
  font: inherit;
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.plataforma-entrar__qr-fundo {
  fill: var(--sgh-fundo);
}
.plataforma-entrar__qr {
  fill: var(--sgh-texto);
}
.plataforma-entrar__erro {
  color: var(--sgh-alerta);
}
</style>
