<script setup lang="ts">
// Vínculo da conta ao estabelecimento (01-ADM L59). A pessoa tem uma conta só no cliente: quem já tem conta em outro
// estabelecimento recebe acesso a este (com o grupo daqui) sem criar conta nova, e esse acesso pode ser encerrado
// sem bloquear a conta nos demais. Um formulário só: o login, o que fazer, o grupo (ao dar acesso) e a senha de quem
// grava (reautenticação). O botão só libera com o formulário completo; a recusa do servidor aparece no lugar.
import { useQuery } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarOpcoesUsuarios } from '../api.js';
import { encerrarVinculo, vincularConta } from '../api-vinculo.js';
import SenhaConfirmacao from '../componentes/SenhaConfirmacao.vue';
import { CAMINHO_LISTA_USUARIOS } from '../usuarios-tela.js';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Acesso de conta existente a este estabelecimento',
      texto:
        'Cada pessoa tem uma conta só. Quem já tem conta em outro estabelecimento recebe acesso a este com o grupo daqui, sem conta nova. Encerrar tira o acesso só deste estabelecimento: a conta e o histórico ficam.',
      voltar: 'Usuários',
      login: 'Login da conta',
      acao: 'O que fazer',
      dar: 'Dar acesso a este estabelecimento',
      encerrar: 'Encerrar o acesso a este estabelecimento',
      grupo: 'Grupo neste estabelecimento',
      escolha: 'Escolha',
      avisoEncerrar:
        'As sessões da conta neste estabelecimento são encerradas. Para tirar todo o acesso da pessoa, bloqueie a conta na ficha.',
      confirmarDar: 'Dar acesso',
      confirmarEncerrar: 'Encerrar acesso',
      gravando: 'Gravando…',
      feitoDar: 'Acesso concedido a {login}.',
      feitoEncerrar: 'Acesso de {login} a este estabelecimento encerrado.',
      abrirFicha: 'Abrir a ficha de {login}',
      semPermissao: 'Seu perfil não permite esta gravação.',
    },
  },
});

const caminhoFicha = (l: string) => `${CAMINHO_LISTA_USUARIOS}/${encodeURIComponent(l)}`;
const rota = useRoute();
const login = ref(typeof rota.query['login'] === 'string' ? rota.query['login'] : '');
const podeDar = computed(() => pode('acesso.usuario.criar'));
const podeEncerrar = computed(() => pode('acesso.usuario.editar'));
const acao = ref<'dar' | 'encerrar'>(
  podeDar.value && !login.value ? 'dar' : podeEncerrar.value ? 'encerrar' : 'dar',
);
const grupo = ref('');
const senha = ref('');
const gravando = ref(false);
const erro = ref<unknown>(null);
const feito = ref<{ acao: 'dar' | 'encerrar'; login: string } | null>(null);

const opcoes = useQuery({ queryKey: ['adm', 'usuarios-opcoes'], queryFn: buscarOpcoesUsuarios });
const opcoesAcao = computed(() => [
  ...(podeDar.value ? [{ valor: 'dar', rotulo: t('dar') }] : []),
  ...(podeEncerrar.value ? [{ valor: 'encerrar', rotulo: t('encerrar') }] : []),
]);
const opcoesGrupo = computed(() => [
  { valor: '', rotulo: t('escolha') },
  ...(opcoes.data.value?.grupos ?? []).filter((g) => g.ativo).map((g) => ({ valor: g.nome, rotulo: g.nome })),
]);
const permitido = computed(() => (acao.value === 'dar' ? podeDar.value : podeEncerrar.value));
const pronto = computed(
  () =>
    permitido.value &&
    login.value.trim() !== '' &&
    senha.value !== '' &&
    (acao.value === 'encerrar' || grupo.value !== ''),
);

async function gravar(): Promise<void> {
  if (!pronto.value || gravando.value) return;
  const alvo = login.value.trim();
  const qual = acao.value;
  gravando.value = true;
  erro.value = null;
  feito.value = null;
  try {
    if (qual === 'dar') await vincularConta(alvo, grupo.value, senha.value);
    else await encerrarVinculo(alvo, senha.value);
    feito.value = { acao: qual, login: alvo };
    login.value = '';
    grupo.value = '';
  } catch (e) {
    erro.value = e;
  } finally {
    // A senha nunca fica na tela depois do pedido.
    senha.value = '';
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela vinculo" aria-labelledby="vinculo-titulo">
    <nav>
      <router-link :to="{ name: 'adm.usuarios' }" data-testid="vinculo-voltar">{{ t('voltar') }}</router-link>
    </nav>
    <h1 id="vinculo-titulo">{{ t('titulo') }}</h1>
    <p class="nota">{{ t('texto') }}</p>
    <div v-if="feito" class="feito" role="status" data-testid="vinculo-feito">
      <span>{{ t(feito.acao === 'dar' ? 'feitoDar' : 'feitoEncerrar', { login: feito.login }) }}</span>
      <router-link
        v-if="feito.acao === 'dar'"
        :to="caminhoFicha(feito.login)"
        data-testid="vinculo-abrir-ficha"
        >{{ t('abrirFicha', { login: feito.login }) }}</router-link
      >
    </div>
    <form class="form" data-testid="form-vinculo" @submit.prevent="gravar">
      <MensagemErro v-if="erro" :erro="erro" />
      <SanteCampoTexto
        v-model="login"
        :rotulo="t('login')"
        :max-bytes="31"
        obrigatorio
        data-testid="vinculo-login"
      />
      <SanteSelecao
        id="vinculo-acao"
        v-model="acao"
        obrigatorio
        :rotulo="t('acao')"
        :opcoes="opcoesAcao"
        data-testid="vinculo-acao"
      />
      <SanteSelecao
        v-if="acao === 'dar'"
        id="vinculo-grupo"
        v-model="grupo"
        obrigatorio
        :rotulo="t('grupo')"
        :opcoes="opcoesGrupo"
        data-testid="vinculo-grupo"
      />
      <SanteAlerta v-else :texto="t('avisoEncerrar')" variante="aviso" data-testid="vinculo-aviso-encerrar" />
      <SanteAlerta v-if="!permitido" :texto="t('semPermissao')" variante="info" />
      <SenhaConfirmacao v-model="senha" testid="vinculo-senha" />
      <div>
        <SanteBotao
          :rotulo="gravando ? t('gravando') : t(acao === 'dar' ? 'confirmarDar' : 'confirmarEncerrar')"
          tipo="submit"
          :desabilitado="!pronto || gravando"
          data-testid="vinculo-gravar"
        />
      </div>
    </form>
  </section>
</template>

<style scoped>
.vinculo {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: 0;
  max-width: 42rem;
}
.form {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.nota {
  color: var(--sgh-texto-secundario);
  margin: 0;
}
.feito {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
</style>
