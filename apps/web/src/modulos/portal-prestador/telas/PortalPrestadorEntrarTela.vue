<script setup lang="ts">
// Entrada no portal do prestador credenciado (M56, etapa 8, F7): `/prestador/entrar`. Fora da casca e da sessão interna.
// O responsável no prestador entra com o e-mail, a senha e o código do aplicativo autenticador; no primeiro acesso, ativa
// a conta com o código de uso único do credenciamento e a senha nova, e lê o QR do segundo fator (a URI só aparece
// agora, à própria pessoa). Depois de entrar, vai aos pedidos (ou à consulta de protocolo, se for a única função).
import { FUNCAO_PORTAL } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { estabelecimentoPadrao } from '../../sadt/api-portal.js';
import { desenharQr } from '../../suporte/qr.js';
import { ativarPortalPrestador, entrarPortalPrestador } from '../api-portal-prestador.js';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const hospital = ref(typeof rota.query['estabelecimento'] === 'string' ? rota.query['estabelecimento'] : '');
const modo = ref<'entrar' | 'ativar'>('entrar');
const login = ref('');
const senha = ref('');
const senha2 = ref('');
const codigo = ref('');
const ativacao = ref('');
const otpauth = ref('');
const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const qr = computed(() => (otpauth.value ? desenharQr(otpauth.value) : null));
const chave = computed(() => {
  try {
    return otpauth.value ? (new URL(otpauth.value).searchParams.get('secret') ?? '') : '';
  } catch {
    return '';
  }
});

onMounted(async () => {
  if (!hospital.value)
    hospital.value =
      (await estabelecimentoPadrao().catch(() => ({ estabelecimento: null }))).estabelecimento ?? '';
});

function falhou(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && [400, 401, 403, 404, 409, 429].includes(e.status))
    recusa.value = e.problema.detail;
  else erro.value = e;
}

// O estabelecimento vem da URL ou do padrão do servidor (assíncrono): sem ele, o pedido iria a uma rota inexistente.
const podeEntrar = computed(
  () =>
    !!hospital.value &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login.value.trim()) &&
    !!senha.value &&
    /^\d{6}$/.test(codigo.value.trim()),
);
async function entrar(): Promise<void> {
  if (!podeEntrar.value || ocupado.value) return;
  recusa.value = null;
  erro.value = null;
  ocupado.value = true;
  try {
    const s = await entrarPortalPrestador(hospital.value, {
      login: login.value.trim(),
      senha: senha.value,
      codigo: codigo.value.trim(),
    });
    senha.value = '';
    codigo.value = '';
    const soProtocolo =
      !s.funcoes.includes(FUNCAO_PORTAL.consultar) && !s.funcoes.includes(FUNCAO_PORTAL.solicitar);
    await roteador.push({ name: soProtocolo ? 'portal.prestador.protocolo' : 'portal.prestador.pedidos' });
  } catch (e) {
    senha.value = '';
    codigo.value = '';
    falhou(e);
  } finally {
    ocupado.value = false;
  }
}

const senhasDiferentes = computed(() => !!senha2.value && senha.value !== senha2.value);
const podeAtivar = computed(
  () =>
    !!hospital.value &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login.value.trim()) &&
    /^[A-Za-z0-9]{12}$/.test(ativacao.value.trim()) &&
    senha.value.length >= 12 &&
    senha.value === senha2.value,
);
async function ativar(): Promise<void> {
  if (!podeAtivar.value || ocupado.value) return;
  recusa.value = null;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await ativarPortalPrestador(hospital.value, {
      login: login.value.trim(),
      codigo: ativacao.value.trim().toUpperCase(),
      senha: senha.value,
    });
    otpauth.value = r.otpauth;
    mensagem.value = r.mensagem;
    ativacao.value = '';
    senha2.value = '';
    modo.value = 'entrar';
  } catch (e) {
    falhou(e);
  } finally {
    ocupado.value = false;
  }
}
function trocar(m: 'entrar' | 'ativar'): void {
  modo.value = m;
  recusa.value = null;
  erro.value = null;
  senha.value = '';
  senha2.value = '';
  codigo.value = '';
}
</script>

<template>
  <main
    class="portal-prestador"
    aria-labelledby="portal-prestador-entrar-titulo"
    data-testid="portal-prestador-entrar"
  >
    <p class="marca">{{ t('portalPrestador.titulo') }}</p>
    <h1 id="portal-prestador-entrar-titulo">
      {{ modo === 'entrar' ? t('portalPrestador.entrar.titulo') : t('portalPrestador.ativar.titulo') }}
    </h1>
    <p v-if="mensagem" role="status" data-testid="portal-prestador-mensagem">{{ mensagem }}</p>
    <template v-if="qr">
      <p data-testid="portal-prestador-qr">{{ t('portalPrestador.ativar.qr') }}</p>
      <svg
        :width="qr.lado"
        :height="qr.lado"
        :viewBox="`0 0 ${qr.lado} ${qr.lado}`"
        role="img"
        :aria-label="t('portalPrestador.ativar.qr')"
      >
        <rect class="qr-fundo" :width="qr.lado" :height="qr.lado" />
        <path class="qr" :d="qr.caminho" />
      </svg>
      <p v-if="chave" class="secundario">{{ t('portalPrestador.ativar.chave', { chave }) }}</p>
    </template>

    <form
      class="formulario"
      :data-testid="`portal-prestador-form-${modo}`"
      @submit.prevent="modo === 'entrar' ? entrar() : ativar()"
    >
      <label class="campo">
        <span>{{ t('portalPrestador.entrar.login') }}</span>
        <input v-model="login" type="email" autocomplete="username" required data-testid="pp-login" />
      </label>
      <label v-if="modo === 'ativar'" class="campo">
        <span>{{ t('portalPrestador.ativar.codigo') }}</span>
        <input v-model="ativacao" autocomplete="off" maxlength="12" required data-testid="pp-ativacao" />
      </label>
      <label class="campo">
        <span>{{
          modo === 'entrar' ? t('portalPrestador.entrar.senha') : t('portalPrestador.ativar.senha')
        }}</span>
        <input
          v-model="senha"
          type="password"
          :autocomplete="modo === 'entrar' ? 'current-password' : 'new-password'"
          required
          data-testid="pp-senha"
        />
      </label>
      <label v-if="modo === 'ativar'" class="campo">
        <span>{{ t('portalPrestador.ativar.confirmar') }}</span>
        <input
          v-model="senha2"
          type="password"
          autocomplete="new-password"
          required
          data-testid="pp-senha2"
        />
      </label>
      <p v-if="modo === 'ativar' && senhasDiferentes" role="alert">
        {{ t('portalPrestador.ativar.diferentes') }}
      </p>
      <label v-if="modo === 'entrar'" class="campo">
        <span>{{ t('portalPrestador.entrar.codigo') }}</span>
        <input
          v-model="codigo"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          required
          data-testid="pp-codigo"
        />
      </label>
      <div v-if="recusa" role="alert" data-testid="pp-recusa">
        <SanteAlerta :texto="recusa" variante="alerta" />
      </div>
      <MensagemErro v-if="erro" :erro="erro" />
      <SanteBotao
        tipo="submit"
        :rotulo="modo === 'entrar' ? t('portalPrestador.entrar.entrar') : t('portalPrestador.ativar.ativar')"
        :desabilitado="(modo === 'entrar' ? !podeEntrar : !podeAtivar) || ocupado"
        :data-testid="`pp-${modo}`"
      />
    </form>
    <SanteBotao
      variante="texto"
      :rotulo="
        modo === 'entrar' ? t('portalPrestador.entrar.primeiroAcesso') : t('portalPrestador.entrar.jaAtivei')
      "
      data-testid="pp-trocar"
      @acionar="trocar(modo === 'entrar' ? 'ativar' : 'entrar')"
    />
  </main>
</template>

<style scoped>
.portal-prestador {
  margin: var(--sgh-espaco-4) auto;
  padding: var(--sgh-espaco-3);
  max-width: 32rem;
  display: grid;
  gap: var(--sgh-espaco-3);
}
.marca {
  font-weight: 600;
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.campo input {
  min-height: 2.25rem;
  padding: 0.25rem 0.5rem;
  font: inherit;
}
.qr-fundo {
  fill: var(--sgh-fundo);
}
.qr {
  fill: var(--sgh-texto);
}
.secundario {
  color: var(--p-text-muted-color);
  font-size: 0.9em;
  overflow-wrap: anywhere;
}
</style>
