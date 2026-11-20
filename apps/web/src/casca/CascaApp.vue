<script setup lang="ts">
// Casca da aplicação (M07): barra com estabelecimento ativo, menu da árvore, paleta Ctrl+K, atalhos,
// camada de bloqueio. Toda tela dos marcos seguintes nasce dentro dela.
import { ARVORE_MENU } from '@sgh/contratos';
import { type PacoteMarca, buscaDaListaAtual, haBuscaDaLista } from '@sgh/ui';
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterView, useRoute, useRouter } from 'vue-router';
import BarraSuperior from './BarraSuperior.vue';
import FaixaComo from './FaixaComo.vue';
import AbrirChamadoDialogo from './AbrirChamadoDialogo.vue';
import NotificarIncidenteDialogo from './notificar/NotificarIncidenteDialogo.vue';
import { usarBotaoNotificar } from './notificar/botao-notificar.js';
import FaixaTreino from './FaixaTreino.vue';
import TermoDialogo from './TermoDialogo.vue';
import { apagarTudoLocal } from '../modulos/pep/rascunho-local.js';
import { temContaPlataforma } from '../modulos/suporte/api-suporte.js';
import MensagemErro from './MensagemErro.vue';
import { ErroApi } from './erros/problem-details.js';
import MenuLateral from './MenuLateral.vue';
import PainelAtalhos from './atalhos/PainelAtalhos.vue';
import { atalhos } from './atalhos/atalhos.js';
import CamadaBloqueio from './bloqueio/CamadaBloqueio.vue';
import { RelogioInatividade, isolarForaDaCasca, usarBloqueio } from './bloqueio/bloqueio.js';
import PaletaComandos from './busca/PaletaComandos.vue';
import { provedores } from './busca/paleta.js';
import { itensVisiveis } from './menu/filtro-menu.js';
import { usarPreferencias } from './preferencias/preferencias.js';
import { telaFechadaPelaChave, usarSessao, usarTrocaDeEstabelecimento } from './sessao/sessao.js';
import NaoEncontradaTela from '../modulos/acesso/telas/NaoEncontradaTela.vue';

const PERMISSAO_EDITAR_PREFERENCIAS = 'acesso.preferencia.editar';
const props = defineProps<{ pacote: PacoteMarca; produto: string; treino?: boolean }>();
// M37: o diálogo "Abrir chamado" (menu do usuário).
const chamadoAberto = ref(false);
// M48 (etapa 1): o diálogo global "Notificar incidente" (barra superior e paleta).
const notificarAberto = ref(false);
const podeNotificar = usarBotaoNotificar();
const { t } = useI18n();
const roteador = useRouter();
const rota = useRoute();
const { consulta, sessao, permissoes, telasDesligadas, telasCarregando } = usarSessao();
const troca = usarTrocaDeEstabelecimento();
const preferencias = usarPreferencias();
const bloqueio = usarBloqueio();
const paletaAberta = ref(false);
const atalhosAbertos = ref(false);
const menuAberto = ref(false);
const raiz = ref<HTMLElement | null>(null);
const principal = ref<HTMLElement | null>(null);
// O conteúdo rola por si (tela larga): ao trocar de tela, volta ao topo, como faria a página inteira.
watch(
  () => rota.path,
  () => principal.value?.scrollTo?.({ top: 0 }),
);

// Segunda barreira da permissão (a guarda do roteador é a primeira): a tela só é desenhada se a sessão
// lida tem a permissão da rota. Cobre a guarda que não conseguiu ler a sessão e a troca de
// estabelecimento (no M06 as permissões podem mudar entre bancos).
const rotaPermitida = computed(() => {
  if (rota.matched.length === 0 || rota.meta.publica) return true; // antes da 1ª navegação: nada a desenhar
  const exigida = rota.meta.permissao;
  // A permissão da SESSÃO (não a efetiva): com a chave de liberação desligada, a tela abre e mostra o motivo
  // do servidor (403 recurso-desligado); só o menu e a paleta escondem o destino.
  const tem = sessao.value?.permissoes ?? [];
  const alguma = [exigida, ...(rota.meta.permissaoOu ?? [])].some((p) => !!p && tem.includes(p));
  return !!exigida && alguma && !fechadaPelaChaveDeTela.value;
});
// M38: as telas sob chave de tela da onda 0 fecham na casca (o servidor também recusa a leitura: GuardaChaveDeTela);
// sem a resposta das telas, fechadas (falha fechada), com "carregando" enquanto ela não chega.
const fechadaPelaChaveDeTela = computed(() => {
  const exigida = rota.meta.permissao;
  return !!exigida && telaFechadaPelaChave(exigida, telasDesligadas.value);
});

// Sem sessão (401) numa tela protegida, inclusive quando a sessão expira no meio do uso: vai para a porta
// de entrada em vez de mostrar "Sessão encerrada" com "Tentar de novo". Telas públicas (entrar, sobre,
// não encontrada) são desenhadas mesmo sem sessão: sem isso, a própria tela de entrada nunca aparecia.
watch(
  () => consulta.error.value,
  (erro) => {
    if (erro instanceof ErroApi && erro.status === 401 && !rota.meta.publica) {
      // Sessão expirada: a digitação clínica guardada neste navegador sai junto (M22).
      void apagarTudoLocal();
      // ADR 0021: com a conta da plataforma ainda aberta (o "como" terminou ou foi revogado), o 401 volta à
      // conta de origem em vez de ir ao login do SPDATA.
      void temContaPlataforma().then((tem) =>
        tem ? window.location.assign('/plataforma') : roteador.replace({ name: 'entrar' }),
      );
    }
  },
);

// Troca de estabelecimento: confirmada na barra; ao concluir, a navegação atual passa de novo pela guarda.
function trocar(codigo: string): void {
  if (troca.isPending.value) return;
  troca.mutate(codigo, {
    onSuccess: () =>
      void roteador.replace({ path: rota.path, query: rota.query, hash: rota.hash, force: true }),
  });
}

watchEffect(() => {
  document.title = props.produto;
});

// Provedores da paleta: telas do menu (já filtradas pela permissão) e ações da casca.
const soltar: (() => void)[] = [];
soltar.push(
  provedores.registrar({
    id: 'telas',
    grupo: 'telas',
    candidatos: () => [
      ...itensVisiveis(ARVORE_MENU, permissoes.value).map((i) => ({
        id: i.id,
        grupo: 'telas' as const,
        titulo: i.titulo,
        detalhe: i.caminho.slice(0, -1).join(' > '),
        permissao: i.permissao,
        executar: () => void roteador.push(i.rota!),
      })),
      {
        id: 'sobre',
        grupo: 'telas' as const,
        titulo: t('casca.sobre'),
        detalhe: t('casca.usuario'),
        permissao: 'acesso.sobre.ler',
        executar: () => void roteador.push('/sobre'),
      },
    ],
  }),
  // M11: "Buscar paciente: <termo>" abre a busca do cadastro com o termo (nenhum dado de paciente na paleta).
  provedores.registrar({
    id: 'pacientes',
    grupo: 'pacientes',
    candidatos: () => [],
    doTermo: (termo) => {
      const x = termo.trim();
      return x.length < 3
        ? []
        : [
            {
              id: 'paciente-busca',
              grupo: 'pacientes' as const,
              titulo: t('cadastro.paleta.buscar', { termo: x }),
              detalhe: t('cadastro.paleta.detalhe'),
              permissao: 'cadastro.paciente.ler',
              executar: () => void roteador.push({ path: '/cadastros/pacientes', query: { q: x } }),
            },
          ];
    },
  }),
  // M15: "Abrir prontuário: <termo>" abre a busca do prontuário com o termo (a abertura pede o motivo).
  provedores.registrar({
    id: 'prontuario',
    grupo: 'pacientes',
    candidatos: () => [],
    doTermo: (termo) => {
      const x = termo.trim();
      return x.length < 3
        ? []
        : [
            {
              id: 'prontuario-busca',
              grupo: 'pacientes' as const,
              titulo: t('pep.paleta.abrir', { termo: x }),
              detalhe: t('pep.paleta.detalhe'),
              permissao: 'pep.prontuario.ler',
              executar: () => void roteador.push({ path: '/pep/prontuario', query: { q: x } }),
            },
          ];
    },
  }),
  provedores.registrar({
    id: 'acoes',
    grupo: 'acoes',
    candidatos: () =>
      [
        // Tema e densidade: mesma permissão da tela /preferencias.
        ...[
          { id: 'tema-claro', titulo: t('acoes.temaClaro'), executar: () => (preferencias.tema = 'claro') },
          {
            id: 'tema-escuro',
            titulo: t('acoes.temaEscuro'),
            executar: () => (preferencias.tema = 'escuro'),
          },
          {
            id: 'tema-sistema',
            titulo: t('acoes.temaSistema'),
            executar: () => (preferencias.tema = 'sistema'),
          },
          {
            id: 'densidade-compacta',
            titulo: t('acoes.densidadeCompacta'),
            executar: () => (preferencias.densidade = 'compacta'),
          },
          {
            id: 'densidade-confortavel',
            titulo: t('acoes.densidadeConfortavel'),
            executar: () => (preferencias.densidade = 'confortavel'),
          },
        ].map((a) => ({ ...a, permissao: PERMISSAO_EDITAR_PREFERENCIAS as string | null })),
        { id: 'bloquear', titulo: t('acoes.bloquear'), executar: () => bloqueio.bloquear(), permissao: null },
        ...(podeNotificar.value
          ? [
              {
                id: 'notificar-incidente',
                titulo: t('qualidade.notificar.atalhoPaleta'),
                executar: () => (notificarAberto.value = true),
                permissao: 'qualidade.notificacao.criar' as string | null,
              },
            ]
          : []),
        {
          id: 'atalhos',
          titulo: t('acoes.atalhos'),
          executar: () => (atalhosAbertos.value = true),
          permissao: null,
        },
        ...(sessao.value?.estabelecimentos ?? [])
          .filter((e) => e.codigo !== sessao.value?.estabelecimentoAtivo)
          .map((e) => ({
            id: `estabelecimento-${e.codigo}`,
            titulo: t('acoes.trocarPara', { nome: e.nome }),
            executar: () => trocar(e.codigo),
            permissao: null,
          })),
      ].map((a) => ({ ...a, grupo: 'acoes' as const, detalhe: '' })),
  }),
);

// Atalhos da casca (os das telas são registrados por elas).
soltar.push(
  atalhos.registrar('paleta', () => (paletaAberta.value = true)),
  atalhos.registrar('ajuda', () => (atalhosAbertos.value = true)),
);
let soltarBusca: (() => void) | null = null;
// "/" só existe quando há uma lista com busca na tela.
watch(
  () => haBuscaDaLista(),
  (ha) => {
    if (ha && !soltarBusca)
      soltarBusca = atalhos.registrar('busca-lista', () => buscaDaListaAtual()?.focus());
    if (!ha && soltarBusca) {
      soltarBusca();
      soltarBusca = null;
    }
  },
  { immediate: true },
);
let soltarFechar: (() => void) | null = null;
watch([paletaAberta, atalhosAbertos, menuAberto], ([p, a, m]) => {
  const algum = p || a || m;
  if (algum && !soltarFechar) {
    soltarFechar = atalhos.registrar('fechar', () => {
      paletaAberta.value = false;
      atalhosAbertos.value = false;
      menuAberto.value = false;
    });
  } else if (!algum && soltarFechar) {
    soltarFechar();
    soltarFechar = null;
  }
});

function aoTeclar(e: KeyboardEvent): void {
  if (bloqueio.bloqueada) return;
  relogio.atividade();
  if (atalhos.tratar(e, e.target)) e.preventDefault();
}

// Bloqueio sinalizado pelo servidor (inatividade gravada na sessão real): a tela bloqueia também.
watch(
  () => sessao.value?.bloqueada === true,
  (b) => {
    if (b) bloqueio.bloquear();
  },
  { immediate: true },
);

// Inatividade: o prazo vem da sessão (o M05 envia o da política).
const relogio = new RelogioInatividade(0, () => bloqueio.bloquear());
watch(
  () => sessao.value?.bloqueioInatividadeSegundos ?? 0,
  (s) => relogio.configurar(s),
  { immediate: true },
);
const atividade = () => relogio.atividade();
watch(
  () => bloqueio.bloqueada,
  (b) => {
    if (b) {
      paletaAberta.value = false;
      atalhosAbertos.value = false;
      relogio.parar();
      // Diálogos e popovers do OpenVue vivem no body, fora da casca: ficam ocultos e inertes também.
      if (raiz.value) desfazerIsolamento = isolarForaDaCasca(raiz.value);
    } else {
      desfazerIsolamento?.();
      desfazerIsolamento = null;
      relogio.atividade();
    }
  },
);
let desfazerIsolamento: (() => void) | null = null;

onMounted(() => {
  window.addEventListener('keydown', aoTeclar);
  window.addEventListener('pointerdown', atividade);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', aoTeclar);
  window.removeEventListener('pointerdown', atividade);
  relogio.parar();
  desfazerIsolamento?.();
  soltar.forEach((s) => s());
  soltarBusca?.();
  soltarFechar?.();
});
const carregando = computed(() => consulta.isPending.value);
</script>

<template>
  <!-- M19: totem e painéis de TV (perfil Painel/Totem) em tela cheia, sem casca, menu nem sessão de pessoa. -->
  <RouterView v-if="rota.meta.dispositivo" />
  <div v-else ref="raiz" class="casca" :class="{ 'casca--bloqueada': bloqueio.bloqueada }">
    <div
      class="casca__conteudo"
      :inert="bloqueio.bloqueada || undefined"
      :aria-hidden="bloqueio.bloqueada || undefined"
    >
      <a href="#conteudo" class="casca__pular">{{ t('casca.pularParaConteudo') }}</a>
      <FaixaTreino v-if="props.treino" />
      <FaixaComo v-if="sessao?.como" :como="sessao.como" class="sgh-nao-imprimir" />
      <BarraSuperior
        :pacote="pacote"
        :produto="produto"
        :menu-aberto="menuAberto"
        :trocando="troca.isPending.value"
        class="sgh-nao-imprimir"
        @abrir-paleta="paletaAberta = true"
        @alternar-menu="menuAberto = !menuAberto"
        @trocar="trocar"
        @abrir-chamado="chamadoAberto = true"
        @notificar-incidente="notificarAberto = true"
      />
      <AbrirChamadoDialogo v-if="sessao" v-model:visivel="chamadoAberto" />
      <NotificarIncidenteDialogo v-if="sessao && podeNotificar" v-model:visivel="notificarAberto" />
      <div class="casca__corpo">
        <MenuLateral :aberto="menuAberto" class="sgh-nao-imprimir" @navegou="menuAberto = false" />
        <main id="conteudo" ref="principal" class="casca__principal" tabindex="-1">
          <p v-if="carregando">{{ t('casca.carregandoSessao') }}</p>
          <template v-else-if="consulta.isError.value && !rota.meta.publica">
            <MensagemErro :erro="consulta.error.value" />
            <button type="button" class="casca__repetir" @click="consulta.refetch()">
              {{ t('casca.tentarDeNovo') }}
            </button>
          </template>
          <template v-else>
            <div v-if="troca.isError.value" class="casca__erro-troca" data-testid="erro-troca">
              <p>{{ t('casca.erroTroca') }}</p>
              <MensagemErro :erro="troca.error.value" />
            </div>
            <!-- A troca de estabelecimento remonta a tela: tudo é relido do banco novo (regra 13). -->
            <RouterView v-if="rotaPermitida" :key="sessao?.estabelecimentoAtivo ?? ''" />
            <p v-else-if="fechadaPelaChaveDeTela && telasCarregando">{{ t('casca.carregandoSessao') }}</p>
            <NaoEncontradaTela v-else :motivo="fechadaPelaChaveDeTela ? 'onda0' : 'sem-permissao'" />
          </template>
        </main>
      </div>
    </div>
    <PaletaComandos v-model:aberta="paletaAberta" />
    <PainelAtalhos v-model:aberto="atalhosAbertos" />
    <CamadaBloqueio :sintetica="sessao?.sintetica ?? false" />
    <!-- M10: termo de uso pendente abre antes de qualquer tela (aceitar ou sair). -->
    <TermoDialogo v-if="sessao?.termoPendente && !rota.meta.publica" :sessao="sessao" />
  </div>
</template>

<style scoped>
.casca__conteudo {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.casca--bloqueada .casca__conteudo {
  visibility: hidden;
}
.casca__pular {
  position: absolute;
  left: -999px;
}
.casca__pular:focus {
  left: var(--sgh-espaco-2);
  top: var(--sgh-espaco-2);
  z-index: 100;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-link);
  padding: var(--sgh-espaco-2);
}
.casca__corpo {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(16rem, 21rem) 1fr;
}
.casca__principal {
  padding: var(--sgh-espaco-4);
  min-width: 0;
}
/* Tela larga: a casca ocupa a janela, e o menu e o conteúdo rolam cada um por si (o menu não sai do
   lugar ao rolar a tela, e clicar no fim do menu não desloca o conteúdo). */
@media (min-width: 64rem) {
  /* Só duas barras de rolagem (menu e conteúdo): a casca não passa da janela. A linha da grade em
     minmax(0, 1fr) impede que o conteúdo alto estique a linha e crie a rolagem da página inteira. */
  .casca,
  .casca__conteudo {
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }
  .casca__corpo {
    min-height: 0;
    grid-template-rows: minmax(0, 1fr);
    overflow: hidden;
  }
  /* position: relative contém os textos ocultos para leitor de tela (position: absolute): sem isso eles
     se posicionam pela janela, escapam do overflow e voltam a criar a rolagem da página inteira. */
  .casca {
    position: relative;
  }
  .casca__corpo > :deep(.menu),
  .casca__principal {
    position: relative;
    overflow-y: auto;
    min-height: 0;
  }
}
.casca__erro-troca {
  margin-bottom: var(--sgh-espaco-3);
}
.casca__erro-troca p {
  margin: 0 0 var(--sgh-espaco-2);
}
.casca__repetir {
  min-height: var(--sgh-alvo-minimo);
  margin-top: var(--sgh-espaco-2);
}
@media (max-width: 63.99rem) {
  .casca__corpo {
    grid-template-columns: 1fr;
  }
}
@media print {
  .casca__corpo {
    grid-template-columns: 1fr;
  }
}
</style>
