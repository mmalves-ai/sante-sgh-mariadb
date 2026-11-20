<script setup lang="ts">
// Portal do prestador credenciado, W0-10: a própria conta. Troca da senha (a atual e o código do aplicativo; as outras
// sessões abertas terminam) e do aplicativo autenticador (a senha e o código do atual geram o código novo, que só vale
// depois de confirmado com um código do aplicativo novo), cada uma com o painel de confirmação antes de enviar. O
// e-mail de acesso é o login da conta e fica com o credenciamento da operadora. O servidor confere a sessão, o CSRF do
// portal e as credenciais em cada pedido.
import type { AutenticadorNovoPortalPrestador } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { desenharQr } from '../../suporte/qr.js';
import {
  confirmarAutenticadorPortalPrestador,
  iniciarAutenticadorPortalPrestador,
  trocarSenhaPortalPrestador,
} from '../api-portal-prestador.js';
import PortalPrestadorCasca from '../componentes/PortalPrestadorCasca.vue';

const { t } = useI18n();
type Acao = 'senha' | 'iniciar' | 'confirmar';
/** A ação à espera do "Confirmar" no painel (nada é enviado antes). */
const confirmando = ref<Acao | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);

const atual = ref('');
const nova = ref('');
const repetir = ref('');
const codigo = ref('');
const senhaAut = ref('');
const codigoAut = ref('');
const novo = ref<AutenticadorNovoPortalPrestador | null>(null);
const codigoNovo = ref('');

const seisDigitos = (v: string) => /^\d{6}$/.test(v.trim());
const senhaForte = (v: string) => v.length >= 12 && /[A-Za-z]/.test(v) && /\d/.test(v);
const diferentes = computed(() => !!repetir.value && nova.value !== repetir.value);
const igual = computed(() => !!nova.value && nova.value === atual.value);
const podeSenha = computed(
  () =>
    !!atual.value &&
    senhaForte(nova.value) &&
    nova.value === repetir.value &&
    !igual.value &&
    seisDigitos(codigo.value),
);
const podeIniciar = computed(() => !!senhaAut.value && seisDigitos(codigoAut.value));
const podeConfirmar = computed(() => !!novo.value && seisDigitos(codigoNovo.value));
const qr = computed(() => (novo.value ? desenharQr(novo.value.otpauth) : null));
const chave = computed(() => {
  try {
    return novo.value ? (new URL(novo.value.otpauth).searchParams.get('secret') ?? '') : '';
  } catch {
    return '';
  }
});
const hora = computed(() => {
  if (!novo.value) return '';
  const d = new Date(novo.value.validoAte);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
});

function preparar(acao: Acao): void {
  recusa.value = null;
  erro.value = null;
  mensagem.value = null;
  confirmando.value = acao;
}

function falhou(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && [400, 403, 409, 422, 429].includes(e.status))
    recusa.value = e.problema.detail;
  else erro.value = e;
}

async function executar(): Promise<void> {
  const acao = confirmando.value;
  confirmando.value = null;
  if (!acao || ocupado.value) return;
  ocupado.value = true;
  try {
    if (acao === 'senha') {
      const r = await trocarSenhaPortalPrestador({
        senhaAtual: atual.value,
        codigo: codigo.value.trim(),
        senhaNova: nova.value,
      });
      mensagem.value = r.mensagem;
      atual.value = nova.value = repetir.value = codigo.value = '';
    } else if (acao === 'iniciar') {
      novo.value = await iniciarAutenticadorPortalPrestador({
        senha: senhaAut.value,
        codigo: codigoAut.value.trim(),
      });
      senhaAut.value = codigoAut.value = '';
    } else {
      const r = await confirmarAutenticadorPortalPrestador(codigoNovo.value.trim());
      mensagem.value = r.mensagem;
      novo.value = null;
      codigoNovo.value = '';
    }
  } catch (e) {
    if (acao === 'senha') codigo.value = '';
    if (acao === 'iniciar') codigoAut.value = '';
    if (acao === 'confirmar') codigoNovo.value = '';
    falhou(e);
  } finally {
    ocupado.value = false;
  }
}

const textoConfirmacao = computed(() =>
  confirmando.value === 'senha'
    ? t('portalPrestador.conta.senhaConfirma')
    : confirmando.value === 'iniciar'
      ? t('portalPrestador.conta.iniciarConfirma')
      : t('portalPrestador.conta.confirmarNovoConfirma'),
);
</script>

<template>
  <PortalPrestadorCasca :titulo="t('portalPrestador.conta.titulo')">
    <div class="conta" data-testid="pp-conta">
      <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" anunciar />
      <div v-if="recusa" role="alert" data-testid="pp-conta-recusa">
        <SanteAlerta :texto="recusa" variante="alerta" />
      </div>
      <MensagemErro v-if="erro" :erro="erro" />
      <section
        v-if="confirmando"
        class="painel"
        role="dialog"
        aria-modal="false"
        data-testid="pp-conta-confirmacao"
      >
        <p>{{ textoConfirmacao }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('portalPrestador.conta.confirmar')"
            :desabilitado="ocupado"
            data-testid="pp-conta-confirmar"
            @acionar="executar"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t('portalPrestador.conta.voltar')"
            data-testid="pp-conta-voltar"
            @acionar="confirmando = null"
          />
        </div>
      </section>

      <form class="painel" aria-labelledby="pp-trocar-senha" data-testid="pp-form-senha" @submit.prevent>
        <h2 id="pp-trocar-senha">{{ t('portalPrestador.conta.trocarSenha') }}</h2>
        <label class="campo">
          <span>{{ t('portalPrestador.conta.senhaAtual') }}</span>
          <input
            v-model="atual"
            type="password"
            autocomplete="current-password"
            data-testid="pp-senha-atual"
          />
        </label>
        <label class="campo">
          <span>{{ t('portalPrestador.conta.senhaNova') }}</span>
          <input v-model="nova" type="password" autocomplete="new-password" data-testid="pp-senha-nova" />
        </label>
        <label class="campo">
          <span>{{ t('portalPrestador.conta.repetir') }}</span>
          <input
            v-model="repetir"
            type="password"
            autocomplete="new-password"
            data-testid="pp-senha-repetir"
          />
        </label>
        <p v-if="diferentes" role="alert">{{ t('portalPrestador.conta.diferentes') }}</p>
        <p v-else-if="igual" role="alert">{{ t('portalPrestador.conta.igual') }}</p>
        <label class="campo">
          <span>{{ t('portalPrestador.conta.codigo') }}</span>
          <input
            v-model="codigo"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            data-testid="pp-senha-codigo"
          />
        </label>
        <SanteBotao
          :rotulo="t('portalPrestador.conta.trocarSenha')"
          :desabilitado="!podeSenha || ocupado"
          data-testid="pp-senha-trocar"
          @acionar="preparar('senha')"
        />
      </form>

      <form
        class="painel"
        aria-labelledby="pp-trocar-autenticador"
        data-testid="pp-form-autenticador"
        @submit.prevent
      >
        <h2 id="pp-trocar-autenticador">{{ t('portalPrestador.conta.trocarAutenticador') }}</h2>
        <template v-if="!novo">
          <p class="secundario">{{ t('portalPrestador.conta.autenticadorAjuda') }}</p>
          <label class="campo">
            <span>{{ t('portalPrestador.conta.senha') }}</span>
            <input
              v-model="senhaAut"
              type="password"
              autocomplete="current-password"
              data-testid="pp-aut-senha"
            />
          </label>
          <label class="campo">
            <span>{{ t('portalPrestador.conta.codigo') }}</span>
            <input
              v-model="codigoAut"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              data-testid="pp-aut-codigo"
            />
          </label>
          <SanteBotao
            :rotulo="t('portalPrestador.conta.iniciar')"
            :desabilitado="!podeIniciar || ocupado"
            data-testid="pp-aut-iniciar"
            @acionar="preparar('iniciar')"
          />
        </template>
        <template v-else>
          <p data-testid="pp-aut-qr">{{ t('portalPrestador.conta.qr') }}</p>
          <svg
            v-if="qr"
            :width="qr.lado"
            :height="qr.lado"
            :viewBox="`0 0 ${qr.lado} ${qr.lado}`"
            role="img"
            :aria-label="t('portalPrestador.conta.qr')"
          >
            <rect class="qr-fundo" :width="qr.lado" :height="qr.lado" />
            <path class="qr" :d="qr.caminho" />
          </svg>
          <p v-if="chave" class="secundario" data-testid="pp-aut-chave">
            {{ t('portalPrestador.conta.chave', { chave }) }}
          </p>
          <p class="secundario">{{ t('portalPrestador.conta.validoAte', { hora }) }}</p>
          <label class="campo">
            <span>{{ t('portalPrestador.conta.codigoNovo') }}</span>
            <input
              v-model="codigoNovo"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              data-testid="pp-aut-codigo-novo"
            />
          </label>
          <SanteBotao
            :rotulo="t('portalPrestador.conta.confirmarNovo')"
            :desabilitado="!podeConfirmar || ocupado"
            data-testid="pp-aut-confirmar"
            @acionar="preparar('confirmar')"
          />
        </template>
      </form>
    </div>
  </PortalPrestadorCasca>
</template>

<style scoped>
.conta {
  display: grid;
  gap: var(--sgh-espaco-3);
  max-width: 36rem;
}
.painel {
  display: grid;
  gap: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 6px);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
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
