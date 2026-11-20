<script setup lang="ts">
// Portal do paciente: início, entrar e primeiro acesso (M50, etapa 1; ficha, seção 7 "Portal: início, conta e
// segurança"; regras 1 e 8). Fora da casca interna. Entrar: e-mail, senha e o código do aplicativo autenticador (erro
// sempre genérico). Primeiro acesso em três passos: o convite impresso na recepção com a data de nascimento; o e-mail, a
// senha e o aceite do termo de uso e da política; o segundo fator (QR do aplicativo autenticador e o primeiro código).
// Nenhuma mensagem é enviada ao paciente: o convite é entregue no balcão.
import type { SessaoContaPortal } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SantePassos } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import ErroPortal from '../componentes/ErroPortal.vue';
import { desenharQr } from '../../suporte/qr.js';
import {
  conferirConvite,
  confirmarSegundoFator,
  entrarPortal,
  estabelecimentoPortal,
  euPortalPaciente,
  iniciarAtivacao,
} from '../api-portal-paciente.js';
import PortalCasca from '../componentes/PortalCasca.vue';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const hospital = ref(
  typeof rota.params['estabelecimento'] === 'string' ? rota.params['estabelecimento'] : '',
);
const versoes = ref({ termoUso: '', politica: '' });
const logado = ref<boolean | null>(null);
const modo = ref<'entrar' | 'ativar'>('entrar');
const erro = ref<unknown>(null);
const ocupado = ref(false);
const expirou = computed(() => rota.query['expirou'] === '1');

// Entrar
const email = ref('');
const senha = ref('');
const codigo = ref('');
// Primeiro acesso
const passo = ref('convite');
const convite = ref('');
const nascimento = ref('');
const emailNovo = ref('');
const senhaNova = ref('');
const confirmacao = ref('');
const aceiteTermo = ref(false);
const aceitePolitica = ref(false);
const otpauth = ref<string | null>(null);
const codigoNovo = ref('');
const pronto = ref(false);

const passos = computed(() => [
  { valor: 'convite', rotulo: t('portal.ativar.passo1') },
  { valor: 'dados', rotulo: t('portal.ativar.passo2') },
  { valor: 'segundo-fator', rotulo: t('portal.ativar.passo3') },
]);
const qr = computed(() => (otpauth.value ? desenharQr(otpauth.value) : null));
const chave = computed(() =>
  otpauth.value ? (new URL(otpauth.value).searchParams.get('secret') ?? '') : '',
);

onMounted(async () => {
  const e = await estabelecimentoPortal().catch(() => null);
  if (e) versoes.value = { termoUso: e.termoUso, politica: e.politica };
  if (!hospital.value) hospital.value = e?.estabelecimento ?? '';
  logado.value = await euPortalPaciente()
    .then(() => true)
    .catch(() => false);
});

async function tentar(fn: () => Promise<void>): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    await fn();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const entrar = () =>
  tentar(async () => {
    await entrarPortal(hospital.value, {
      email: email.value.trim(),
      senha: senha.value,
      codigo: codigo.value.trim(),
    });
    senha.value = '';
    codigo.value = '';
    logado.value = true;
    await roteador.replace({ name: 'portal.paciente' });
  });

const conferir = () =>
  tentar(async () => {
    await conferirConvite(hospital.value, { codigo: convite.value.trim(), nascimento: nascimento.value });
    passo.value = 'dados';
  });

const dados = () =>
  tentar(async () => {
    const r = await iniciarAtivacao({
      codigo: convite.value.trim(),
      nascimento: nascimento.value,
      email: emailNovo.value.trim(),
      senha: senhaNova.value,
      confirmacao: confirmacao.value,
      termoUso: versoes.value.termoUso,
      politicaPrivacidade: versoes.value.politica,
    });
    otpauth.value = r.otpauth;
    passo.value = 'segundo-fator';
  });

const confirmar = () =>
  tentar(async () => {
    const s: SessaoContaPortal = await confirmarSegundoFator(codigoNovo.value.trim());
    void s;
    senhaNova.value = '';
    confirmacao.value = '';
    otpauth.value = null;
    pronto.value = true;
    logado.value = true;
  });
</script>

<template>
  <PortalCasca v-if="logado" :titulo="t('portal.menu.inicio')">
    <template #default="{ sessao }">
      <SanteAlerta
        v-if="pronto"
        :texto="t('portal.ativar.pronto')"
        variante="info"
        anunciar
        data-testid="portal-ativada"
      />
      <section class="portal-painel" data-testid="portal-inicio">
        <p v-if="sessao.soResponsavel">{{ t('portal.responsaveis.meus') }}</p>
        <RouterLink :to="{ name: 'portal.documentos' }" data-testid="portal-ir-documentos">{{
          t('portal.menu.documentos')
        }}</RouterLink>
        <RouterLink :to="{ name: 'portal.responsaveis' }">{{ t('portal.menu.responsaveis') }}</RouterLink>
        <RouterLink :to="{ name: 'portal.privacidade' }">{{ t('portal.menu.privacidade') }}</RouterLink>
        <RouterLink :to="{ name: 'portal.seguranca' }">{{ t('portal.menu.seguranca') }}</RouterLink>
      </section>
    </template>
  </PortalCasca>
  <main
    v-else-if="logado === false"
    class="portal-paciente"
    aria-labelledby="portal-entrar"
    data-testid="tela-portal-paciente"
  >
    <p class="portal-marca">{{ t('portal.titulo') }}</p>
    <SanteAlerta v-if="expirou" :texto="t('portal.sessaoExpirou')" variante="aviso" />
    <template v-if="modo === 'entrar'">
      <h1 id="portal-entrar">{{ t('portal.entrar.titulo') }}</h1>
      <form class="portal-painel" @submit.prevent="entrar">
        <span class="portal-campo">
          <label for="pac-email">{{ t('portal.entrar.email') }}</label>
          <input
            id="pac-email"
            v-model="email"
            type="email"
            autocomplete="username"
            data-testid="pac-email"
          />
        </span>
        <span class="portal-campo">
          <label for="pac-senha">{{ t('portal.entrar.senha') }}</label>
          <input
            id="pac-senha"
            v-model="senha"
            type="password"
            autocomplete="current-password"
            data-testid="pac-senha"
          />
        </span>
        <span class="portal-campo">
          <label for="pac-codigo">{{ t('portal.entrar.codigo') }}</label>
          <input
            id="pac-codigo"
            v-model="codigo"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            aria-describedby="pac-codigo-ajuda"
            data-testid="pac-codigo"
          />
          <small id="pac-codigo-ajuda">{{ t('portal.entrar.codigoAjuda') }}</small>
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('portal.entrar.acao')"
          :desabilitado="ocupado"
          data-testid="pac-entrar"
          @acionar="entrar"
        />
      </form>
      <p>{{ t('portal.entrar.primeiroAcesso') }}</p>
      <SanteBotao
        variante="secundario"
        :rotulo="t('portal.ativar.titulo')"
        data-testid="pac-primeiro-acesso"
        @acionar="modo = 'ativar'"
      />
    </template>
    <template v-else>
      <h1 id="portal-entrar">{{ t('portal.ativar.titulo') }}</h1>
      <SantePassos v-model="passo" :passos="passos" />
      <form v-if="passo === 'convite'" class="portal-painel" @submit.prevent="conferir">
        <span class="portal-campo">
          <label for="pac-convite">{{ t('portal.ativar.codigo') }}</label>
          <input
            id="pac-convite"
            v-model="convite"
            autocomplete="off"
            aria-describedby="pac-convite-ajuda"
            data-testid="pac-convite"
          />
          <small id="pac-convite-ajuda">{{ t('portal.ativar.codigoAjuda') }}</small>
        </span>
        <span class="portal-campo">
          <label for="pac-nascimento">{{ t('portal.ativar.nascimento') }}</label>
          <input id="pac-nascimento" v-model="nascimento" type="date" data-testid="pac-nascimento" />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('portal.continuar')"
          :desabilitado="ocupado"
          data-testid="pac-conferir"
          @acionar="conferir"
        />
      </form>
      <form v-else-if="passo === 'dados'" class="portal-painel" @submit.prevent="dados">
        <span class="portal-campo">
          <label for="pac-email-novo">{{ t('portal.ativar.email') }}</label>
          <input
            id="pac-email-novo"
            v-model="emailNovo"
            type="email"
            autocomplete="email"
            data-testid="pac-email-novo"
          />
        </span>
        <span class="portal-campo">
          <label for="pac-senha-nova">{{ t('portal.ativar.senha') }}</label>
          <input
            id="pac-senha-nova"
            v-model="senhaNova"
            type="password"
            autocomplete="new-password"
            aria-describedby="pac-senha-ajuda"
            data-testid="pac-senha-nova"
          />
          <small id="pac-senha-ajuda">{{ t('portal.ativar.senhaAjuda') }}</small>
        </span>
        <span class="portal-campo">
          <label for="pac-confirmacao">{{ t('portal.ativar.confirmacao') }}</label>
          <input
            id="pac-confirmacao"
            v-model="confirmacao"
            type="password"
            autocomplete="new-password"
            data-testid="pac-confirmacao"
          />
        </span>
        <label
          ><input v-model="aceiteTermo" type="checkbox" data-testid="pac-termo" />
          {{ t('portal.ativar.termoUso', { versao: versoes.termoUso }) }}</label
        >
        <label
          ><input v-model="aceitePolitica" type="checkbox" data-testid="pac-politica" />
          {{ t('portal.ativar.politica', { versao: versoes.politica }) }}</label
        >
        <SanteBotao
          tipo="submit"
          :rotulo="t('portal.continuar')"
          :desabilitado="ocupado || !aceiteTermo || !aceitePolitica"
          data-testid="pac-dados"
          @acionar="dados"
        />
      </form>
      <form v-else class="portal-painel" @submit.prevent="confirmar">
        <p>{{ t('portal.ativar.qr') }}</p>
        <svg
          v-if="qr"
          :width="qr.lado"
          :height="qr.lado"
          :viewBox="`0 0 ${qr.lado} ${qr.lado}`"
          role="img"
          :aria-label="t('portal.ativar.qr')"
          data-testid="pac-qr"
        >
          <rect class="portal-qr-fundo" :width="qr.lado" :height="qr.lado" />
          <path class="portal-qr" :d="qr.caminho" />
        </svg>
        <p class="portal-secundario">{{ t('portal.ativar.semCamera', { chave }) }}</p>
        <span class="portal-campo">
          <label for="pac-codigo-novo">{{ t('portal.ativar.confirmarCodigo') }}</label>
          <input
            id="pac-codigo-novo"
            v-model="codigoNovo"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            data-testid="pac-codigo-novo"
          />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="t('portal.continuar')"
          :desabilitado="ocupado"
          data-testid="pac-confirmar"
          @acionar="confirmar"
        />
      </form>
      <SanteBotao variante="texto" :rotulo="t('portal.voltar')" @acionar="modo = 'entrar'" />
    </template>
    <ErroPortal v-if="erro" :erro="erro" />
  </main>
  <p v-else role="status">{{ t('portal.carregando') }}</p>
</template>

<style src="../componentes/estilo-portal.css"></style>
