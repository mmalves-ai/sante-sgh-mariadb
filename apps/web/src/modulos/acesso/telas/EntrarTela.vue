<script setup lang="ts">
// Tela de entrada (M05): seletor de estabelecimento da rede do endereço (ARQ-1/ARQ-2), login, senha e
// segundo fator (quando cadastrado). Nome e marca do produto vêm da configuração (DP-49). Nenhum token é
// guardado no navegador: a sessão volta no cookie HttpOnly. O seletor mostra os indisponíveis marcados,
// lembra a última escolha (só o código) e some quando há um estabelecimento só. Depois do login, com
// acesso a mais de uma unidade (TBUNIDAD), pede a unidade; então vai para a tela inicial (ou à troca de
// senha, quando obrigatória). M49 (etapa 3): com a chave `acesso.loginCertificado` ligada no estabelecimento e o
// agente local configurado, "Entrar com certificado digital" (A1/A3): o agente deste computador assina o desafio e o
// servidor confere a cadeia, a revogação, o CPF e o vínculo do certificado com a conta. M59-F2: a recusa por causa do
// segundo fator mostra o texto próprio e põe o foco no código; na adesão, o login leva à segurança da conta.
import { SanteBotao, SanteMarca, SanteSelecao, type PacoteMarca } from '@sgh/ui';
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import type { Sessao } from '@sgh/contratos';
import { useQueryClient } from '@tanstack/vue-query';
import {
  buscarEstabelecimentos,
  desafioCertificado,
  disponibilidadeCertificado,
  disponibilidadeRecuperacao,
  entrar,
  entrarComCertificado,
  escolherUnidade,
} from '../../../api.js';
import { assinarNoAgente } from '../../assinatura/api-assinatura.js';
import { escolhaInicial, lembrarEscolha, ultimaEscolha } from '../ultima-escolha.js';
import { CHAVE_MARCA } from '../../../configuracao.js';
import { CHAVE_SESSAO } from '../../../casca/sessao/sessao.js';
import { entrarPlataforma } from '../../suporte/api-suporte.js';
import { ErroApi, mensagemDoErro } from '../../../casca/erros/problem-details.js';
import { codigoDoErro } from '../api-identidade.js';
import { codigoLimpo, destinoDepoisDoLogin, textoRecusaSegundoFator } from '../identidade-tela.js';

const { t } = useI18n();
const roteador = useRouter();
const rota = useRoute();
const cliente = useQueryClient();
const marca = inject<{ produto: string; pacote: PacoteMarca }>(CHAVE_MARCA);

const estabelecimentos = ref<{ codigo: string; nome: string; disponivel: boolean }[]>([]);
const rede = ref('');
const escolhido = ref('');
const login = ref('');
const senha = ref('');
const segundoFator = ref('');
/** O servidor pediu o código do segundo fator (M59-F2): o campo vira obrigatório e recebe o foco. */
const pedeCodigo = ref(false);
const campoCodigo = ref<HTMLInputElement | null>(null);
const entrando = ref(false);
const erro = ref('');
const carregou = ref(false);
/** Sessão aberta à espera da escolha da unidade (segundo seletor). */
const aguardandoUnidade = ref<Sessao | null>(null);
const unidade = ref('');

const disponiveis = computed(() => estabelecimentos.value.filter((e) => e.disponivel));
const indisponiveis = computed(() => estabelecimentos.value.filter((e) => !e.disponivel));
const opcoes = computed(() => disponiveis.value.map((e) => ({ valor: e.codigo, rotulo: e.nome })));
// Some só quando a rede tem UM estabelecimento; com outros fora do ar, eles aparecem como indisponíveis.
const umSo = computed(() => estabelecimentos.value.length === 1 && disponiveis.value.length === 1);
const opcoesUnidade = computed(() =>
  (aguardandoUnidade.value?.unidades ?? []).map((u) => ({ valor: String(u.codigo), rotulo: u.nome })),
);

onMounted(async () => {
  try {
    const r = await buscarEstabelecimentos();
    estabelecimentos.value = r.estabelecimentos;
    rede.value = r.rede;
    const pedida = typeof rota.query['estabelecimento'] === 'string' ? rota.query['estabelecimento'] : null;
    escolhido.value = escolhaInicial(disponiveis.value, pedida, ultimaEscolha());
  } catch {
    estabelecimentos.value = [];
  } finally {
    carregou.value = true;
  }
});

async function enviar(): Promise<void> {
  if (entrando.value || !escolhido.value) return;
  entrando.value = true;
  erro.value = '';
  try {
    // Conta da plataforma ou do suporte (e-mail) também entra por aqui: a mesma porta, sem o usuário
    // precisar saber do endereço /plataforma/entrar. Com segundo fator pendente, segue na tela própria.
    if (login.value.includes('@')) {
      const r = await entrarPlataforma({
        email: login.value.trim(),
        senha: senha.value,
        ...(segundoFator.value ? { codigo: segundoFator.value } : {}),
      });
      senha.value = '';
      await roteador.replace('segundoFator' in r ? '/plataforma/entrar' : '/plataforma');
      return;
    }
    const sessao = await entrar({
      estabelecimento: escolhido.value,
      login: login.value,
      senha: senha.value,
      ...(segundoFator.value ? { codigoSegundoFator: codigoLimpo(segundoFator.value) } : {}),
    });
    lembrarEscolha(escolhido.value);
    senha.value = '';
    if ((sessao.unidades?.length ?? 0) > 1 && sessao.unidadeAtiva == null) {
      aguardandoUnidade.value = sessao;
      unidade.value = String(sessao.unidades?.[0]?.codigo ?? '');
      return;
    }
    await seguir(sessao);
  } catch (e) {
    const tipo = mensagemDoErro(e).tipo;
    // M59-F2: a recusa por causa do segundo fator diz qual (pedir o código, código errado, cadastro obrigatório).
    const doFator = textoRecusaSegundoFator(codigoDoErro(e));
    if (doFator) {
      erro.value = t(doFator);
      segundoFator.value = '';
      pedeCodigo.value = doFator !== 'entrar.segundoFatorCadastro';
      if (pedeCodigo.value) void nextTick(() => campoCodigo.value?.focus());
      return;
    }
    // W1-01 (parte 8b): o limite de sessões simultâneas do perfil (409); o detalhe diz quantas estão abertas.
    if (codigoDoErro(e) === 'limite-sessoes') {
      erro.value = (e instanceof ErroApi ? e.problema?.detail : null) || t('entrar.limiteSessoes');
      return;
    }
    erro.value =
      tipo === 'muitas-tentativas'
        ? t('entrar.muitasTentativas')
        : tipo === 'primeiro-acesso'
          ? t('entrar.primeiroAcesso')
          : tipo === 'indisponivel' || tipo === 'rede' || tipo === 'rede-desconhecida'
            ? t('entrar.indisponivelServico')
            : t('entrar.erroGenerico');
  } finally {
    entrando.value = false;
  }
}

// M49 (etapa 3): entrada com certificado A1/A3 (só aparece com a chave ligada e o agente configurado).
const certificado = ref<{ disponivel: boolean; agenteLocal: string | null }>({
  disponivel: false,
  agenteLocal: null,
});
watch(escolhido, async (e) => {
  certificado.value = e ? await disponibilidadeCertificado(e) : { disponivel: false, agenteLocal: null };
});

// W1-01 (parte 7): "Esqueci a senha" (só com a chave acesso.recuperacaoSenha e o e-mail institucional configurados).
const recuperacao = ref(false);
watch(
  escolhido,
  async (e) => {
    recuperacao.value = e ? await disponibilidadeRecuperacao(e) : false;
  },
  { immediate: true },
);

async function entrarCertificado(): Promise<void> {
  if (entrando.value || !escolhido.value) return;
  erro.value = '';
  if (!login.value.trim()) {
    erro.value = t('entrar.certificado.informeLogin');
    return;
  }
  entrando.value = true;
  try {
    const d = await desafioCertificado({ estabelecimento: escolhido.value, login: login.value.trim() });
    let resp: Awaited<ReturnType<typeof assinarNoAgente>>;
    try {
      resp = await assinarNoAgente(d.agenteLocal, { ...d, tipo: 'agente-local', expiraEm: '' });
    } catch {
      erro.value = t('entrar.certificado.agenteAusente');
      return;
    }
    const sessao = await entrarComCertificado({ desafio: d.desafio, ...resp });
    lembrarEscolha(escolhido.value);
    if ((sessao.unidades?.length ?? 0) > 1 && sessao.unidadeAtiva == null) {
      aguardandoUnidade.value = sessao;
      unidade.value = String(sessao.unidades?.[0]?.codigo ?? '');
      return;
    }
    await seguir(sessao);
  } catch (e) {
    const m = mensagemDoErro(e);
    erro.value =
      m.tipo === 'muitas-tentativas'
        ? t('entrar.muitasTentativas')
        : m.tipo === 'indisponivel' || m.tipo === 'rede'
          ? t('entrar.indisponivelServico')
          : t('entrar.certificado.recusado');
  } finally {
    entrando.value = false;
  }
}

async function seguir(sessao: Sessao): Promise<void> {
  cliente.setQueryData(CHAVE_SESSAO, sessao);
  // M59-F2: depois da troca de senha obrigatória, o cadastro do segundo fator no prazo de adesão.
  await roteador.replace(destinoDepoisDoLogin(sessao));
}

async function confirmarUnidade(): Promise<void> {
  if (entrando.value || !unidade.value) return;
  entrando.value = true;
  erro.value = '';
  try {
    await seguir(await escolherUnidade(Number(unidade.value)));
  } catch {
    erro.value = t('entrar.indisponivelServico');
  } finally {
    entrando.value = false;
  }
}
</script>

<template>
  <main class="entrar" aria-labelledby="entrar-titulo">
    <div class="entrar__caixa">
      <SanteMarca v-if="marca" :pacote="marca.pacote" :produto="marca.produto" />
      <h1 id="entrar-titulo">{{ t('entrar.titulo') }}</h1>
      <p v-if="rede" class="entrar__rede">{{ t('entrar.rede', { rede }) }}</p>

      <p v-if="carregou && disponiveis.length === 0" role="alert" data-testid="sem-estabelecimentos">
        {{ t('entrar.semEstabelecimentos') }}
      </p>

      <form
        v-else-if="aguardandoUnidade"
        class="entrar__form"
        data-testid="seletor-unidade"
        @submit.prevent="confirmarUnidade"
      >
        <SanteSelecao v-model="unidade" :rotulo="t('entrar.unidade')" :opcoes="opcoesUnidade" />
        <p v-if="erro" role="alert" class="entrar__erro" data-testid="erro-entrar">{{ erro }}</p>
        <SanteBotao
          :rotulo="t('entrar.continuar')"
          tipo="submit"
          :desabilitado="entrando"
          data-testid="botao-unidade"
        />
      </form>

      <form v-else class="entrar__form" @submit.prevent="enviar">
        <SanteSelecao
          v-if="!umSo"
          v-model="escolhido"
          :rotulo="t('entrar.estabelecimento')"
          :opcoes="opcoes"
          data-testid="seletor-estabelecimento"
        />
        <p v-else class="entrar__unico" data-testid="estabelecimento-unico">
          {{ disponiveis[0]?.nome }}
        </p>
        <ul
          v-if="indisponiveis.length"
          class="entrar__indisponiveis"
          data-testid="estabelecimentos-indisponiveis"
        >
          <li v-for="e in indisponiveis" :key="e.codigo">{{ e.nome }} {{ t('entrar.indisponivel') }}</li>
        </ul>

        <label class="entrar__campo">
          <span>{{ t('entrar.login') }}</span>
          <input v-model="login" name="login" autocomplete="username" required data-testid="campo-login" />
        </label>
        <label class="entrar__campo">
          <span>{{ t('entrar.senha') }}</span>
          <input
            v-model="senha"
            type="password"
            name="senha"
            autocomplete="current-password"
            required
            data-testid="campo-senha"
          />
        </label>
        <label class="entrar__campo">
          <span>{{ t('entrar.segundoFator') }}</span>
          <input
            ref="campoCodigo"
            v-model="segundoFator"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="7"
            :required="pedeCodigo"
            :aria-invalid="pedeCodigo && !!erro ? 'true' : 'false'"
            data-testid="campo-2fa"
          />
          <small>{{ t('entrar.segundoFatorAjuda') }}</small>
        </label>

        <p v-if="erro" role="alert" class="entrar__erro" data-testid="erro-entrar">{{ erro }}</p>

        <SanteBotao
          :rotulo="entrando ? t('entrar.entrando') : t('entrar.acessar')"
          tipo="submit"
          :desabilitado="entrando || !escolhido"
          data-testid="botao-entrar"
        />
        <template v-if="certificado.disponivel">
          <SanteBotao
            :rotulo="entrando ? t('entrar.certificado.assinando') : t('entrar.certificado.botao')"
            variante="secundario"
            :desabilitado="entrando || !escolhido"
            data-testid="botao-entrar-certificado"
            @click="entrarCertificado"
          />
          <small>{{ t('entrar.certificado.ajuda') }}</small>
        </template>
        <RouterLink
          v-if="recuperacao && escolhido"
          :to="{
            name: 'recuperar-senha',
            query: { estabelecimento: escolhido, login: login.trim() || undefined },
          }"
          data-testid="link-esqueci-senha"
          >{{ t('entrar.esqueciSenha') }}</RouterLink
        >
      </form>
    </div>
  </main>
</template>

<style scoped>
.entrar {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--sgh-espaco-4);
  background: var(--sgh-fundo);
}
.entrar__caixa {
  width: 100%;
  max-width: 24rem;
  padding: var(--sgh-espaco-4);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 8px;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
}
.entrar__rede {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.entrar__form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-3);
}
.entrar__campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.entrar__campo input {
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-2);
  font: inherit;
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.entrar__erro {
  color: var(--sgh-alerta);
}
.entrar__indisponiveis {
  margin: 0;
  padding-left: var(--sgh-espaco-4);
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.entrar :focus-visible {
  outline: 2px solid var(--sgh-foco);
  outline-offset: 2px;
}
</style>
