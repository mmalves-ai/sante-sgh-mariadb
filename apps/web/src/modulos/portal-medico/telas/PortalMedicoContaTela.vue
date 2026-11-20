<script setup lang="ts">
// Portal do médico externo, W0-10: a própria conta. Troca da senha (senha e código atuais; as outras sessões abertas
// terminam) e do e-mail (o link vai ao e-mail NOVO; a troca só vale depois de confirmada nele), cada uma com o painel
// de confirmação antes de enviar. O servidor confere a sessão, o CSRF do portal e as credenciais em cada pedido.
import type { TrocaEmailMedicoPedida } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  cancelarTrocaEmailMedico,
  pedirTrocaEmailMedico,
  trocaEmailMedicoPendente,
  trocarSenhaMedico,
} from '../api-portal-medico.js';
import ErroPortalMedico from '../componentes/ErroPortalMedico.vue';
import PortalMedicoCasca from '../componentes/PortalMedicoCasca.vue';

const { t } = useI18n();
const pronto = ref(false);
const pendenteQ = useQuery({
  queryKey: ['portal-medico', 'conta', 'email'],
  queryFn: trocaEmailMedicoPendente,
  enabled: pronto,
});
const pendente = computed(() => pendenteQ.data.value?.pendente ?? null);
const erro = ref<unknown>(null);
/** A ação à espera do "Confirmar" no painel (nada é enviado antes). */
const confirmando = ref<'senha' | 'email' | 'cancelar' | null>(null);
const quando = (s: string) => `${s.slice(0, 10).split('-').reverse().join('/')} ${s.slice(11, 16)}`;

const atual = ref('');
const nova = ref('');
const confirmacao = ref('');
const codigo = ref('');
const senhaTrocada = ref(false);

const emailNovo = ref('');
const senhaEmail = ref('');
const codigoEmail = ref('');
const enviada = ref<TrocaEmailMedicoPedida | null>(null);
const cancelada = ref(false);

function preparar(acao: 'senha' | 'email' | 'cancelar'): void {
  erro.value = null;
  senhaTrocada.value = false;
  cancelada.value = false;
  if (acao === 'email') enviada.value = null;
  confirmando.value = acao;
}

async function executar(): Promise<void> {
  const acao = confirmando.value;
  confirmando.value = null;
  try {
    if (acao === 'senha') {
      await trocarSenhaMedico({
        atual: atual.value,
        nova: nova.value,
        confirmacao: confirmacao.value,
        codigo: codigo.value.trim(),
      });
      senhaTrocada.value = true;
      atual.value = nova.value = confirmacao.value = codigo.value = '';
    } else if (acao === 'email') {
      enviada.value = await pedirTrocaEmailMedico({
        email: emailNovo.value.trim(),
        senha: senhaEmail.value,
        codigo: codigoEmail.value.trim(),
      });
      emailNovo.value = senhaEmail.value = codigoEmail.value = '';
      await pendenteQ.refetch();
    } else if (acao === 'cancelar') {
      await cancelarTrocaEmailMedico();
      cancelada.value = true;
      await pendenteQ.refetch();
    }
  } catch (x) {
    erro.value = x;
  }
}

const textoConfirmacao = computed(() =>
  confirmando.value === 'senha'
    ? t('portalMedico.conta.senhaConfirma')
    : confirmando.value === 'email'
      ? t('portalMedico.conta.emailConfirma', { email: emailNovo.value.trim() })
      : t('portalMedico.conta.cancelarConfirma'),
);
</script>

<template>
  <PortalMedicoCasca :titulo="t('portalMedico.conta.titulo')" @sessao="pronto = true">
    <ErroPortalMedico v-if="erro" :erro="erro" />
    <section
      v-if="confirmando"
      class="painel"
      role="dialog"
      aria-modal="false"
      data-testid="pm-conta-confirmacao"
    >
      <p>{{ textoConfirmacao }}</p>
      <div class="filtros">
        <SanteBotao
          :rotulo="t('portalMedico.conta.confirmar')"
          data-testid="pm-conta-confirmar"
          @acionar="executar"
        />
        <SanteBotao variante="texto" :rotulo="t('portalMedico.conta.voltar')" @acionar="confirmando = null" />
      </div>
    </section>

    <form class="painel" aria-labelledby="pm-trocar-senha" data-testid="pm-form-senha" @submit.prevent>
      <h2 id="pm-trocar-senha">{{ t('portalMedico.conta.trocarSenha') }}</h2>
      <span class="campo">
        <label for="pm-senha-atual">{{ t('portalMedico.conta.senhaAtual') }}</label>
        <input id="pm-senha-atual" v-model="atual" type="password" autocomplete="current-password" />
      </span>
      <span class="campo">
        <label for="pm-senha-nova">{{ t('portalMedico.conta.senhaNova') }}</label>
        <input id="pm-senha-nova" v-model="nova" type="password" autocomplete="new-password" />
      </span>
      <span class="campo">
        <label for="pm-senha-nova2">{{ t('portalMedico.conta.confirmacao') }}</label>
        <input id="pm-senha-nova2" v-model="confirmacao" type="password" autocomplete="new-password" />
      </span>
      <span class="campo">
        <label for="pm-senha-codigo">{{ t('portalMedico.conta.codigo') }}</label>
        <input
          id="pm-senha-codigo"
          v-model="codigo"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
        />
      </span>
      <SanteBotao
        :rotulo="t('portalMedico.conta.trocarSenha')"
        :desabilitado="!atual || !nova || !confirmacao || !codigo"
        data-testid="pm-senha-trocar"
        @acionar="preparar('senha')"
      />
      <SanteAlerta
        v-if="senhaTrocada"
        :texto="t('portalMedico.conta.senhaTrocada')"
        variante="info"
        anunciar
      />
    </form>

    <form class="painel" aria-labelledby="pm-trocar-email" data-testid="pm-form-email" @submit.prevent>
      <h2 id="pm-trocar-email">{{ t('portalMedico.conta.trocarEmail') }}</h2>
      <p class="secundario">{{ t('portalMedico.conta.trocarEmailAjuda') }}</p>
      <template v-if="pendente">
        <SanteAlerta
          :texto="
            t('portalMedico.conta.trocaPendente', {
              email: pendente.emailMascarado,
              quando: quando(pendente.validoAte),
            })
          "
          variante="info"
          data-testid="pm-troca-pendente"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('portalMedico.conta.cancelarTroca')"
          data-testid="pm-troca-cancelar"
          @acionar="preparar('cancelar')"
        />
      </template>
      <span class="campo">
        <label for="pm-email-novo">{{ t('portalMedico.conta.emailNovo') }}</label>
        <input
          id="pm-email-novo"
          v-model="emailNovo"
          type="email"
          autocomplete="email"
          data-testid="pm-email-novo"
        />
      </span>
      <span class="campo">
        <label for="pm-email-senha">{{ t('portalMedico.conta.senhaAtual') }}</label>
        <input id="pm-email-senha" v-model="senhaEmail" type="password" autocomplete="current-password" />
      </span>
      <span class="campo">
        <label for="pm-email-codigo">{{ t('portalMedico.conta.codigo') }}</label>
        <input
          id="pm-email-codigo"
          v-model="codigoEmail"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
        />
      </span>
      <SanteBotao
        :rotulo="t('portalMedico.conta.pedirTroca')"
        :desabilitado="!emailNovo || !senhaEmail || !codigoEmail"
        data-testid="pm-troca-pedir"
        @acionar="preparar('email')"
      />
      <SanteAlerta
        v-if="enviada"
        :texto="
          t('portalMedico.conta.trocaEnviada', {
            email: enviada.emailMascarado,
            quando: quando(enviada.validoAte),
          })
        "
        variante="info"
        anunciar
      />
      <SanteAlerta
        v-if="cancelada"
        :texto="t('portalMedico.conta.trocaCancelada')"
        variante="info"
        anunciar
      />
    </form>
  </PortalMedicoCasca>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
