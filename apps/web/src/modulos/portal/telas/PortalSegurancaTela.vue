<script setup lang="ts">
// Portal do paciente: conta e segurança (M50, etapa 1; ficha, seção 7). O e-mail de acesso só mascarado, o último
// acesso, a troca da senha (a atual e o código do aplicativo autenticador conferidos) e o que fazer quando perder o
// celular (a recepção refaz o segundo fator: nenhuma mensagem é enviada ao paciente). O pedido de encerrar a conta vai
// à área de privacidade como pedido do titular (eliminação). W0-10: a troca do e-mail (o link vai ao e-mail novo e a
// conta só muda quando ele é aberto; o pedido pendente aparece com a opção de desistir) e a troca do aplicativo
// autenticador (senha e código atuais, o QR novo e o primeiro código do aplicativo novo).
import type { TrocaEmailPedida } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPortal from '../componentes/ErroPortal.vue';
import {
  cancelarTrocaEmailPortal,
  confirmarTrocaSegundoFatorPortal,
  iniciarTrocaSegundoFatorPortal,
  pedirTrocaEmailPortal,
  registrarPedidoPortal,
  segurancaPortal,
  trocarSenhaPortal,
} from '../api-portal-paciente.js';
import { desenharQr } from '../../suporte/qr.js';
import PortalCasca from '../componentes/PortalCasca.vue';

const { t } = useI18n();
const pronta = ref(false);
const dados = useQuery({
  queryKey: ['portal-paciente', 'seguranca'],
  queryFn: () => segurancaPortal(),
  enabled: pronta,
});
const atual = ref('');
const nova = ref('');
const confirmacao = ref('');
const codigo = ref('');
const trocada = ref(false);
const pedido = ref<string | null>(null);
const erro = ref<unknown>(null);
const quando = (s: string | null) =>
  s ? `${s.slice(0, 10).split('-').reverse().join('/')} ${s.slice(11, 16)}` : '—';

async function trocar(): Promise<void> {
  erro.value = null;
  trocada.value = false;
  try {
    await trocarSenhaPortal({
      atual: atual.value,
      nova: nova.value,
      confirmacao: confirmacao.value,
      codigo: codigo.value.trim(),
    });
    trocada.value = true;
    atual.value = '';
    nova.value = '';
    confirmacao.value = '';
    codigo.value = '';
  } catch (x) {
    erro.value = x;
  }
}
// W0-10: troca do e-mail.
const emailNovo = ref('');
const senhaEmail = ref('');
const codigoEmail = ref('');
const enviada = ref<TrocaEmailPedida | null>(null);
const cancelada = ref(false);
const pendente = computed(() => dados.data.value?.trocaEmail ?? null);
async function pedirTroca(): Promise<void> {
  erro.value = null;
  cancelada.value = false;
  try {
    enviada.value = await pedirTrocaEmailPortal({
      email: emailNovo.value.trim(),
      senha: senhaEmail.value,
      codigo: codigoEmail.value.trim(),
    });
    emailNovo.value = '';
    senhaEmail.value = '';
    codigoEmail.value = '';
    await dados.refetch();
  } catch (x) {
    erro.value = x;
  }
}
async function desistir(): Promise<void> {
  erro.value = null;
  try {
    await cancelarTrocaEmailPortal();
    enviada.value = null;
    cancelada.value = true;
    await dados.refetch();
  } catch (x) {
    erro.value = x;
  }
}
// W0-10: troca do autenticador.
const senha2fa = ref('');
const codigo2fa = ref('');
const otpauth = ref<string | null>(null);
const codigoNovo = ref('');
const autenticadorTrocado = ref(false);
const qr = computed(() => (otpauth.value ? desenharQr(otpauth.value) : null));
const chave = computed(() =>
  otpauth.value ? (new URL(otpauth.value).searchParams.get('secret') ?? '') : '',
);
async function iniciarAutenticador(): Promise<void> {
  erro.value = null;
  autenticadorTrocado.value = false;
  try {
    otpauth.value = (
      await iniciarTrocaSegundoFatorPortal({ senha: senha2fa.value, codigo: codigo2fa.value.trim() })
    ).otpauth;
    senha2fa.value = '';
    codigo2fa.value = '';
  } catch (x) {
    erro.value = x;
  }
}
async function confirmarAutenticador(): Promise<void> {
  erro.value = null;
  try {
    await confirmarTrocaSegundoFatorPortal(codigoNovo.value.trim());
    otpauth.value = null;
    codigoNovo.value = '';
    autenticadorTrocado.value = true;
  } catch (x) {
    erro.value = x;
  }
}
async function encerrar(): Promise<void> {
  erro.value = null;
  try {
    pedido.value = (
      await registrarPedidoPortal({ tipo: 'eliminacao', descricao: t('portal.seguranca.encerrarTexto') })
    ).protocolo;
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <PortalCasca :titulo="t('portal.seguranca.titulo')" @sessao="pronta = true">
    <ErroPortal v-if="erro" :erro="erro" />
    <section class="portal-painel" data-testid="portal-seguranca">
      <p>
        {{ t('portal.seguranca.email') }}: <strong>{{ dados.data.value?.emailMascarado ?? '—' }}</strong>
      </p>
      <p>
        {{ t('portal.seguranca.ultimoAcesso', { quando: quando(dados.data.value?.ultimoAcessoEm ?? null) }) }}
      </p>
      <SanteAlerta :texto="t('portal.seguranca.aparelho')" variante="info" />
    </section>
    <form class="portal-painel" aria-labelledby="pac-trocar" @submit.prevent="trocar">
      <h2 id="pac-trocar">{{ t('portal.seguranca.trocarSenha') }}</h2>
      <span class="portal-campo">
        <label for="pac-atual">{{ t('portal.seguranca.senhaAtual') }}</label>
        <input id="pac-atual" v-model="atual" type="password" autocomplete="current-password" />
      </span>
      <span class="portal-campo">
        <label for="pac-nova">{{ t('portal.seguranca.senhaNova') }}</label>
        <input id="pac-nova" v-model="nova" type="password" autocomplete="new-password" />
      </span>
      <span class="portal-campo">
        <label for="pac-nova2">{{ t('portal.ativar.confirmacao') }}</label>
        <input id="pac-nova2" v-model="confirmacao" type="password" autocomplete="new-password" />
      </span>
      <span class="portal-campo">
        <label for="pac-cod">{{ t('portal.entrar.codigo') }}</label>
        <input id="pac-cod" v-model="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" />
      </span>
      <SanteBotao tipo="submit" :rotulo="t('portal.seguranca.trocarSenha')" @acionar="trocar" />
      <SanteAlerta v-if="trocada" :texto="t('portal.seguranca.senhaTrocada')" variante="info" anunciar />
    </form>
    <form class="portal-painel" aria-labelledby="pac-trocar-email" @submit.prevent="pedirTroca">
      <h2 id="pac-trocar-email">{{ t('portal.seguranca.trocarEmail') }}</h2>
      <p>{{ t('portal.seguranca.trocarEmailAjuda') }}</p>
      <template v-if="pendente">
        <SanteAlerta
          :texto="
            t('portal.seguranca.trocaPendente', {
              email: pendente.emailMascarado ?? '—',
              quando: quando(pendente.validoAte),
            })
          "
          variante="info"
          data-testid="pac-troca-pendente"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('portal.seguranca.cancelarTroca')"
          :confirmacao="t('portal.seguranca.cancelarTrocaConfirma')"
          data-testid="pac-troca-cancelar"
          @acionar="desistir"
        />
      </template>
      <span class="portal-campo">
        <label for="pac-email-novo">{{ t('portal.seguranca.emailNovo') }}</label>
        <input
          id="pac-email-novo"
          v-model="emailNovo"
          type="email"
          autocomplete="email"
          data-testid="pac-email-novo"
        />
      </span>
      <span class="portal-campo">
        <label for="pac-email-senha">{{ t('portal.seguranca.senhaAtual') }}</label>
        <input id="pac-email-senha" v-model="senhaEmail" type="password" autocomplete="current-password" />
      </span>
      <span class="portal-campo">
        <label for="pac-email-cod">{{ t('portal.entrar.codigo') }}</label>
        <input
          id="pac-email-cod"
          v-model="codigoEmail"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
        />
      </span>
      <SanteBotao
        tipo="submit"
        :rotulo="t('portal.seguranca.pedirTroca')"
        :confirmacao="t('portal.seguranca.trocarEmailAjuda')"
        data-testid="pac-troca-pedir"
        @acionar="pedirTroca"
      />
      <SanteAlerta
        v-if="enviada"
        :texto="
          t('portal.seguranca.trocaEnviada', {
            email: enviada.emailMascarado ?? '—',
            quando: quando(enviada.validoAte),
          })
        "
        variante="info"
        anunciar
      />
      <SanteAlerta v-if="cancelada" :texto="t('portal.seguranca.trocaCancelada')" variante="info" anunciar />
    </form>
    <section class="portal-painel" aria-labelledby="pac-trocar-2fa">
      <h2 id="pac-trocar-2fa">{{ t('portal.seguranca.trocarAutenticador') }}</h2>
      <p>{{ t('portal.seguranca.trocarAutenticadorAjuda') }}</p>
      <form v-if="!otpauth" @submit.prevent="iniciarAutenticador">
        <span class="portal-campo">
          <label for="pac-2fa-senha">{{ t('portal.seguranca.senhaAtual') }}</label>
          <input id="pac-2fa-senha" v-model="senha2fa" type="password" autocomplete="current-password" />
        </span>
        <span class="portal-campo">
          <label for="pac-2fa-cod">{{ t('portal.entrar.codigo') }}</label>
          <input
            id="pac-2fa-cod"
            v-model="codigo2fa"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
          />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('portal.continuar')"
          data-testid="pac-2fa-iniciar"
          @acionar="iniciarAutenticador"
        />
      </form>
      <form v-else @submit.prevent="confirmarAutenticador">
        <p>{{ t('portal.ativar.qr') }}</p>
        <svg
          v-if="qr"
          :width="qr.lado"
          :height="qr.lado"
          :viewBox="`0 0 ${qr.lado} ${qr.lado}`"
          role="img"
          :aria-label="t('portal.ativar.qr')"
          data-testid="pac-2fa-qr"
        >
          <rect class="portal-qr-fundo" :width="qr.lado" :height="qr.lado" />
          <path class="portal-qr" :d="qr.caminho" />
        </svg>
        <p class="portal-secundario">{{ t('portal.ativar.semCamera', { chave }) }}</p>
        <span class="portal-campo">
          <label for="pac-2fa-novo">{{ t('portal.ativar.confirmarCodigo') }}</label>
          <input
            id="pac-2fa-novo"
            v-model="codigoNovo"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            data-testid="pac-2fa-novo"
          />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('portal.seguranca.trocarAutenticador')"
          data-testid="pac-2fa-confirmar"
          @acionar="confirmarAutenticador"
        />
        <SanteBotao variante="texto" :rotulo="t('portal.cancelar')" @acionar="otpauth = null" />
      </form>
      <SanteAlerta
        v-if="autenticadorTrocado"
        :texto="t('portal.seguranca.autenticadorTrocado')"
        variante="info"
        anunciar
      />
    </section>
    <section class="portal-painel" aria-labelledby="pac-encerrar">
      <h2 id="pac-encerrar">{{ t('portal.seguranca.encerrar') }}</h2>
      <p>{{ t('portal.seguranca.encerrarAjuda') }}</p>
      <SanteBotao
        variante="destrutivo"
        :rotulo="t('portal.seguranca.encerrar')"
        :confirmacao="t('portal.seguranca.encerrarConfirma')"
        @acionar="encerrar"
      />
      <SanteAlerta
        v-if="pedido"
        :texto="t('portal.privacidade.enviado', { protocolo: pedido, prazo: '' })"
        variante="info"
        anunciar
      />
    </section>
  </PortalCasca>
</template>
