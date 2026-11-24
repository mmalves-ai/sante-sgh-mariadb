<script setup lang="ts">
// Barra superior: marca da rede (configuração), estabelecimento ativo SEMPRE visível (regra 13; ARQ-1),
// troca de estabelecimento (some se houver um só), busca (Ctrl+K), o sino da central de avisos (M27) e menu do usuário.
// A troca só acontece ao confirmar (botão ou Enter): no Windows, cada seta no select fechado dispara
// `change`, e no M05 cada troca é um novo login. Quem troca é a casca (evento `trocar`). Ao sair, as pendências de
// assinatura são avisadas (M23, regra 9): "Assinar agora" leva às pendências; "Sair mesmo assim" encerra.
import { type PacoteMarca, SanteBotao, SanteDialogo, SanteIcone, SanteMarca, SanteSelecao } from '@sgh/ui';
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { temContaPlataforma } from '../modulos/suporte/api-suporte.js';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRouter } from 'vue-router';
import SinoAvisos from './avisos/SinoAvisos.vue';
import { usarBotaoNotificar } from './notificar/botao-notificar.js';
import { usarBloqueio } from './bloqueio/bloqueio.js';
import { pendenciasAoSair } from './sessao/pendencias-saida.js';
import { usarSaida, usarSessao } from './sessao/sessao.js';

defineProps<{ pacote: PacoteMarca; produto: string; menuAberto: boolean; trocando?: boolean }>();
const emit = defineEmits<{
  abrirPaleta: [];
  alternarMenu: [];
  trocar: [codigo: string];
  notificarIncidente: [];
}>();
const { t } = useI18n();
const { sessao, estabelecimentoAtivo, permissoes } = usarSessao();
// M48 (etapa 1): o botão global "Notificar incidente" (a permissão e a funcionalidade liberada).
const podeNotificar = usarBotaoNotificar();
// M52.4 (D-CIENCIA-524): o próprio espelho de ponto com a ciência, para quem tem a permissão (toda pessoa com vínculo).
const podeVerMeuPonto = computed(() => permissoes.value.has('pessoas.ponto.ciencia'));
// M52.6: o "Meu espaço" do colaborador (autosserviço; toda pessoa, só o próprio).
const podeVerMeuEspaco = computed(() => permissoes.value.has('pessoas.autoatendimento.ler'));
const bloqueio = usarBloqueio();
const sairDaSessao = usarSaida();
const menuUsuario = ref(false);
const roteador = useRouter();
/** Pendências de assinatura de quem está saindo (> 0 abre o aviso). */
const pendenciasSaida = ref(0);
async function pedirSaida(): Promise<void> {
  menuUsuario.value = false;
  const n = await pendenciasAoSair();
  if (n > 0) pendenciasSaida.value = n;
  else await sairDaSessao();
}
async function assinarAgora(): Promise<void> {
  pendenciasSaida.value = 0;
  await roteador.push('/inicio/assinaturas');
}
async function sairMesmoAssim(): Promise<void> {
  pendenciasSaida.value = 0;
  await sairDaSessao();
}
// ADR 0021: ícone discreto do "login como" só com a conta da plataforma aberta neste navegador; o modal é
// carregado sob demanda (quem não é plataforma nem suporte nem baixa o pedaço).
const EntrarComoModal = defineAsyncComponent(
  () => import('../modulos/suporte/componentes/EntrarComoModal.vue'),
);
const contaPlataforma = ref(false);
const modalComo = ref(false);
onMounted(() => {
  void temContaPlataforma().then((tem) => (contaPlataforma.value = tem));
});

const opcoes = computed(() =>
  (sessao.value?.estabelecimentos ?? []).map((e) => ({ valor: e.codigo, rotulo: e.nome })),
);
const ativo = computed(() => sessao.value?.estabelecimentoAtivo ?? '');
const escolhido = ref(ativo.value);
watch(ativo, (a) => (escolhido.value = a));
const mudou = computed(() => !!escolhido.value && escolhido.value !== ativo.value);
function confirmarTroca(): void {
  if (mudou.value) emit('trocar', escolhido.value);
}
function bloquear(): void {
  menuUsuario.value = false;
  bloqueio.bloquear();
}
</script>

<template>
  <header class="barra">
    <button
      type="button"
      class="barra__botao barra__menu"
      :aria-expanded="menuAberto"
      aria-controls="menu-principal"
      :aria-label="menuAberto ? t('casca.fecharMenu') : t('casca.abrirMenu')"
      @click="emit('alternarMenu')"
    >
      <SanteIcone nome="menu" />
    </button>
    <RouterLink to="/inicio" class="barra__marca"
      ><SanteMarca :pacote="pacote" :produto="produto" invertida
    /></RouterLink>

    <div class="barra__estabelecimento" data-testid="estabelecimento-ativo">
      <SanteIcone nome="hospital" />
      <span class="sgh-visualmente-oculto">{{ t('casca.estabelecimentoAtivo') }}</span>
      <SanteSelecao
        v-if="opcoes.length > 1"
        v-model="escolhido"
        :rotulo="t('casca.trocarEstabelecimento')"
        :opcoes="opcoes"
        ocultar-rotulo
        :desabilitado="trocando"
        data-testid="seletor-troca-estabelecimento"
        @keydown.enter.prevent="confirmarTroca"
      />
      <button
        v-if="opcoes.length > 1 && mudou"
        type="button"
        class="barra__botao"
        :disabled="trocando"
        data-testid="confirmar-troca"
        @click="confirmarTroca"
      >
        {{ trocando ? t('casca.trocando') : t('casca.confirmarTroca') }}
      </button>
      <strong v-else>{{ estabelecimentoAtivo?.nome ?? t('casca.semEstabelecimento') }}</strong>
    </div>

    <button
      type="button"
      class="barra__botao barra__busca"
      data-testid="abrir-paleta"
      @click="emit('abrirPaleta')"
    >
      <SanteIcone nome="busca" />
      <span>{{ t('casca.buscar') }}</span>
    </button>

    <button
      v-if="podeNotificar"
      type="button"
      class="barra__botao"
      data-testid="notificar-incidente"
      @click="emit('notificarIncidente')"
    >
      <SanteIcone nome="alerta" />
      <span>{{ t('qualidade.notificar.botao') }}</span>
    </button>

    <SinoAvisos />

    <button
      v-if="contaPlataforma"
      type="button"
      class="barra__botao"
      :aria-label="t('suporte.entrarComoIcone')"
      :title="t('suporte.entrarComoIcone')"
      data-testid="icone-como"
      @click="modalComo = true"
    >
      <SanteIcone nome="pessoa" />
    </button>
    <EntrarComoModal v-if="modalComo" @fechar="modalComo = false" />

    <span v-if="sessao?.sintetica" class="barra__sintetica" :title="t('casca.sessaoSinteticaTitulo')">{{
      t('casca.sessaoSintetica')
    }}</span>

    <div class="barra__usuario">
      <button
        type="button"
        class="barra__botao"
        :aria-expanded="menuUsuario"
        aria-controls="menu-usuario"
        data-testid="menu-usuario"
        @click="menuUsuario = !menuUsuario"
      >
        <SanteIcone nome="pessoa" />
        <span>{{ sessao?.usuario.nome ?? t('casca.usuario') }}</span>
      </button>
      <ul v-show="menuUsuario" id="menu-usuario" class="barra__lista" @keydown.esc="menuUsuario = false">
        <li>
          <RouterLink to="/preferencias" @click="menuUsuario = false">{{
            t('casca.preferencias')
          }}</RouterLink>
        </li>
        <li v-if="podeVerMeuEspaco">
          <RouterLink to="/pessoas/meu" data-testid="meu-espaco" @click="menuUsuario = false">{{
            t('casca.meuEspaco')
          }}</RouterLink>
        </li>
        <li v-if="podeVerMeuPonto">
          <RouterLink to="/pessoas/ponto/meu" data-testid="meu-espelho-ponto" @click="menuUsuario = false">{{
            t('casca.meuEspelhoPonto')
          }}</RouterLink>
        </li>
        <li>
          <RouterLink to="/sobre" @click="menuUsuario = false">{{ t('casca.sobre') }}</RouterLink>
        </li>
        <li>
          <button type="button" class="barra__item" data-testid="bloquear" @click="bloquear">
            <SanteIcone nome="cadeado" />{{ t('casca.bloquear') }}
          </button>
        </li>
        <li v-if="sessao && !sessao.sintetica">
          <button type="button" class="barra__item" data-testid="sair" @click="pedirSaida">
            {{ t('casca.sair') }}
          </button>
        </li>
      </ul>
    </div>
    <SanteDialogo
      :visivel="pendenciasSaida > 0"
      :titulo="t('casca.pendenciasSaida.titulo')"
      data-testid="aviso-pendencias-saida"
      @update:visivel="(v: boolean) => !v && (pendenciasSaida = 0)"
    >
      <p>{{ t('casca.pendenciasSaida.texto', { n: pendenciasSaida }) }}</p>
      <div class="barra__acoes-saida">
        <SanteBotao
          :rotulo="t('casca.pendenciasSaida.assinar')"
          data-testid="saida-assinar-agora"
          @acionar="assinarAgora"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('casca.pendenciasSaida.sair')"
          data-testid="saida-sair-mesmo-assim"
          @acionar="sairMesmoAssim"
        />
      </div>
    </SanteDialogo>
  </header>
</template>

<style scoped>
.barra__acoes-saida {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.barra {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2) var(--sgh-espaco-4);
  padding: var(--sgh-espaco-2) var(--sgh-espaco-4);
  background: var(--sgh-primaria);
  color: var(--sgh-primaria-texto);
}
.barra a,
.barra__marca {
  color: inherit;
  text-decoration: none;
}
.barra__botao {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
  min-width: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-2);
  background: transparent;
  color: inherit;
  border: 1px solid currentColor;
  border-radius: 4px;
  font: inherit;
  cursor: pointer;
}
.barra :focus-visible {
  outline: 2px solid var(--sgh-primaria-texto);
  outline-offset: 2px;
}
.barra__estabelecimento {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.barra__busca {
  margin-left: auto;
}
.barra__sintetica {
  font-size: var(--sgh-fonte-pequena);
  border: 1px dashed currentColor;
  border-radius: 4px;
  padding: 0 var(--sgh-espaco-1);
}
.barra__usuario {
  position: relative;
}
.barra__lista {
  position: absolute;
  right: 0;
  top: calc(100% + var(--sgh-espaco-1));
  z-index: 20;
  list-style: none;
  margin: 0;
  padding: var(--sgh-espaco-1) 0;
  min-width: 14rem;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 6px;
}
.barra__lista a,
.barra__item {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  width: 100%;
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-3);
  color: var(--sgh-texto);
  background: none;
  border: none;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.barra__lista :focus-visible {
  outline: 2px solid var(--sgh-foco);
  outline-offset: -2px;
}
@media (min-width: 64rem) {
  .barra__menu {
    display: none;
  }
}
</style>
