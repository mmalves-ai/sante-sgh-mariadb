<script setup lang="ts">
// Profissionais, registros (CBO, conselho) e especialidades (M11): consulta por nome (chave sem acento, por
// palavra) ou número do registro. A categoria vem do CBO (regra 10), a atividade real do registro, e a
// situação do cadastro antigo aparece "a confirmar" (DP-46.1). D-PROF-39: "Novo profissional" para quem tem
// `cadastro.profissional.criar` (a gravação é do servidor, pelo executor). Redesenho do dono (18/11/2026): o visual
// de Usuários e Acessos (cabeçalho com a ação principal, busca com ícone, situação em segmentos, linhas com as
// iniciais e pílulas).
import type { ProfissionalResumo } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteIcone } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarProfissionais } from '../api-cadastro.js';
import NovoProfissional from '../componentes/NovoProfissional.vue';
import { iniciais } from '../profissional-tela.js';

const props = defineProps<{ historico?: boolean }>();
const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const termo = ref(typeof rota.query['q'] === 'string' ? rota.query['q'] : '');
const ativos = ref(true);
const pedido = ref<{ termo: string; ativos: boolean } | null>(
  termo.value ? { termo: termo.value, ativos: true } : null,
);

const consulta = useQuery({
  queryKey: computed(() => ['cadastro', 'profissionais', pedido.value]),
  queryFn: () => buscarProfissionais(pedido.value!.termo, pedido.value!.ativos),
  enabled: computed(() => pedido.value !== null),
});
const r = computed(() => consulta.data.value);

const excluido = computed(() => rota.query['excluido'] === '1');
const incluindo = ref(false);
function incluido(id: number): void {
  incluindo.value = false;
  // Vindo do atalho da ficha do usuário, o profissional novo abre na aba Login do sistema com o login escolhido.
  void roteador.push(`/cadastros/profissionais/${id}${abaPedida.value}`);
}

function buscar(): void {
  const x = termo.value.trim();
  if (!x) return;
  pedido.value = { termo: x, ativos: ativos.value };
  // A busca mantém o ?aba=login&login= do atalho da ficha do usuário (senão a ficha abriria na aba Dados).
  void roteador.replace({ query: { q: x, ...atalho.value } });
}

// Vindo do atalho da ficha do usuário (?aba=login&login=X), a ficha do profissional abre direto na aba "Login do
// sistema", com o login X já escolhido no combo.
const loginDoAtalho = computed(() => {
  const l = rota.query['login'];
  return typeof l === 'string' ? l.trim().toUpperCase() : '';
});
const atalho = computed((): Record<string, string> =>
  rota.query['aba'] === 'login'
    ? { aba: 'login', ...(loginDoAtalho.value ? { login: loginDoAtalho.value } : {}) }
    : {},
);
const abaPedida = computed(() => {
  const q = new URLSearchParams(atalho.value).toString();
  return q ? `?${q}` : '';
});
const destino = (p: ProfissionalResumo) =>
  props.historico
    ? `/cadastros/profissionais/${p.id}/historico`
    : `/cadastros/profissionais/${p.id}${abaPedida.value}`;
const registro = (x: ProfissionalResumo['registros'][number]) =>
  t('cadastro.profissionais.registro', {
    conselho: x.sigla ?? x.conselho ?? '',
    numero: x.numero ?? '',
    uf: x.uf ?? '',
  });
</script>

<template>
  <section class="tela profissionais" aria-labelledby="profissionais-titulo" data-testid="tela-profissionais">
    <header class="cabecalho">
      <div class="cabecalho__titulo">
        <h1 id="profissionais-titulo">
          {{ historico ? t('cadastro.profissionais.historico') : t('cadastro.profissionais.titulo') }}
        </h1>
        <span v-if="r" class="contador">{{
          t('cadastro.profissionais.legenda', { n: r.itens.length })
        }}</span>
      </div>
      <p class="cabecalho__texto">
        {{ historico ? t('cadastro.profissionais.escolhaHistorico') : t('cadastro.profissionais.texto') }}
      </p>
      <div v-if="!historico" class="cabecalho__acoes">
        <RouterLink
          v-if="pode('cadastro.conselho.ler')"
          class="link-discreto"
          to="/cadastros/profissionais/conselhos"
          >{{ t('cadastro.profissionais.conselhos') }}</RouterLink
        >
        <RouterLink
          v-if="pode('cadastro.solicitante.ler')"
          class="link-discreto"
          to="/cadastros/solicitantes"
          >{{ t('cadastro.profissionais.solicitantes') }}</RouterLink
        >
        <RouterLink v-if="pode('cadastro.prestador.ler')" class="link-discreto" to="/cadastros/prestadores">{{
          t('cadastro.profissionais.prestadores')
        }}</RouterLink>
        <SanteBotao
          v-if="pode('cadastro.profissional.criar') && !incluindo"
          :rotulo="t('cadastro.profissionais.edicao.novo')"
          variante="primario"
          data-testid="novo-profissional-abrir"
          @acionar="incluindo = true"
        />
      </div>
    </header>
    <SanteAlerta
      v-if="excluido"
      :texto="t('cadastro.profissionais.tela.excluido')"
      variante="info"
      anunciar
      data-testid="profissional-excluido"
    />
    <SanteAlerta
      v-if="!historico && atalho.aba && loginDoAtalho"
      :texto="t('cadastro.profissionais.vincularLogin', { login: loginDoAtalho })"
      variante="info"
      data-testid="profissionais-vincular-login"
    />
    <NovoProfissional v-if="!historico && incluindo" @incluido="incluido" @cancelar="incluindo = false" />
    <form class="filtros" role="search" @submit.prevent="buscar">
      <div class="busca">
        <label for="termo-profissional" class="sgh-visualmente-oculto">{{
          t('cadastro.profissionais.termo')
        }}</label>
        <SanteIcone nome="busca" class="busca__icone" />
        <input
          id="termo-profissional"
          v-model="termo"
          type="search"
          maxlength="70"
          :placeholder="t('cadastro.profissionais.termo')"
          autocomplete="off"
          data-testid="termo-profissional"
        />
      </div>
      <fieldset class="segmentos">
        <legend class="sgh-visualmente-oculto">{{ t('cadastro.profissionais.tela.situacaoFiltro') }}</legend>
        <label :class="['segmento', { 'segmento--ativo': ativos }]">
          <input v-model="ativos" type="radio" name="prof-situacao" :value="true" />
          <span>{{ t('cadastro.profissionais.ativos') }}</span>
        </label>
        <label :class="['segmento', { 'segmento--ativo': !ativos }]">
          <input v-model="ativos" type="radio" name="prof-situacao" :value="false" />
          <span>{{ t('cadastro.profissionais.tela.todos') }}</span>
        </label>
      </fieldset>
      <SanteBotao
        :rotulo="t('cadastro.profissionais.buscar')"
        variante="primario"
        tipo="submit"
        data-testid="botao-buscar-profissional"
      />
    </form>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-else-if="r">
      <p v-if="r.truncado" role="status">{{ t('cadastro.busca.truncado') }}</p>
      <p v-if="r.itens.length === 0 && r.sugestoes.length === 0" role="status">{{ t('cadastro.nenhum') }}</p>
      <table v-if="r.itens.length > 0" class="cartao-tabela" data-testid="tabela-profissionais">
        <caption>
          {{
            t('cadastro.profissionais.legenda', { n: r.itens.length })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('cadastro.profissionais.nome') }}</th>
            <th scope="col">{{ t('cadastro.profissionais.categoria') }}</th>
            <th scope="col">{{ t('cadastro.profissionais.registros') }}</th>
            <th scope="col">{{ t('cadastro.profissionais.ativo') }}</th>
            <th scope="col">{{ t('cadastro.profissionais.situacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in r.itens" :key="p.id" :data-testid="`profissional-${p.id}`">
            <td>
              <span class="usuario">
                <span class="avatar" aria-hidden="true">{{ iniciais(p.nome) }}</span>
                <RouterLink
                  :to="destino(p)"
                  :aria-label="t('cadastro.profissionais.abrir', { nome: p.nome })"
                  >{{ p.nome }}</RouterLink
                >
              </span>
            </td>
            <td>
              <span class="etiqueta etiqueta--texto">{{
                t(`cadastro.profissionais.categorias.${p.categoria}`)
              }}</span>
            </td>
            <td>
              <span v-for="(x, i) in p.registros" :key="i" class="etiqueta">{{ registro(x) }}</span>
            </td>
            <td>
              <span :class="['pilula', p.ativo ? 'pilula--ok' : 'pilula--neutra']">{{
                p.ativo ? t('cadastro.profissionais.tela.ativo') : t('cadastro.profissionais.tela.inativo')
              }}</span>
            </td>
            <td>{{ p.situacaoLegado.codigo ?? '' }} ({{ t('cadastro.aConfirmar') }})</td>
          </tr>
        </tbody>
      </table>
      <div v-if="r.sugestoes.length > 0">
        <p>{{ t('cadastro.profissionais.sugestoes') }}</p>
        <ul>
          <li v-for="p in r.sugestoes" :key="p.id">
            <RouterLink :to="destino(p)">{{ p.nome }}</RouterLink>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<style scoped>
.profissionais {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: 0;
}
.cabecalho {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    'titulo acoes'
    'texto acoes';
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
  align-items: center;
}
@media (max-width: 40rem) {
  .cabecalho {
    grid-template-columns: 1fr;
    grid-template-areas: 'titulo' 'texto' 'acoes';
  }
}
.cabecalho__titulo {
  grid-area: titulo;
  display: flex;
  align-items: baseline;
  gap: var(--sgh-espaco-2);
  flex-wrap: wrap;
}
.cabecalho__titulo h1 {
  margin: 0;
}
.cabecalho__texto {
  grid-area: texto;
  margin: 0;
  color: var(--sgh-texto-secundario);
}
.cabecalho__acoes {
  grid-area: acoes;
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-3);
  flex-wrap: wrap;
  justify-content: flex-end;
}
.contador {
  padding: 2px var(--sgh-espaco-2);
  border-radius: 999px;
  background: var(--sgh-fundo-sutil);
  border: 1px solid var(--sgh-borda);
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
  white-space: nowrap;
}
.link-discreto {
  color: var(--sgh-link);
  font-size: var(--sgh-fonte-pequena);
}
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.busca {
  position: relative;
  flex: 1 1 18rem;
}
.busca__icone {
  position: absolute;
  left: var(--sgh-espaco-2);
  top: 50%;
  transform: translateY(-50%);
  color: var(--sgh-texto-secundario);
}
.busca input {
  width: 100%;
  min-height: var(--sgh-alvo-minimo);
  padding-left: calc(var(--sgh-espaco-2) * 2 + 1em);
}
.segmentos {
  display: inline-flex;
  border: 1px solid var(--sgh-borda-forte);
  border-radius: var(--p-button-border-radius, 6px);
  padding: 0;
  margin: 0;
  overflow: hidden;
}
.segmento {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-3);
  cursor: pointer;
}
.segmento input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
}
.segmento--ativo {
  background: var(--sgh-primaria-suave);
  color: var(--sgh-primaria);
  font-weight: 600;
}
.segmento:focus-within {
  outline: 3px solid var(--sgh-foco);
  outline-offset: -3px;
}
.cartao-tabela {
  border: 1px solid var(--sgh-borda);
  border-radius: var(--p-button-border-radius, 6px);
  background: var(--sgh-fundo-elevado);
}
.usuario {
  display: inline-flex;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.avatar {
  display: inline-grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  background: var(--sgh-primaria-suave);
  color: var(--sgh-primaria);
  font-weight: 700;
  font-size: 0.85rem;
  flex: none;
}
.pilula {
  display: inline-flex;
  align-items: center;
  padding: 1px var(--sgh-espaco-2);
  border-radius: 999px;
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  border: 1px solid currentcolor;
  white-space: nowrap;
}
.pilula--ok {
  color: var(--sgh-sucesso);
}
.pilula--neutra {
  color: var(--sgh-texto-secundario);
}
.etiqueta {
  display: inline-block;
  margin: 1px 2px;
  padding: 1px var(--sgh-espaco-2);
  border-radius: var(--p-button-border-radius, 6px);
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo-sutil);
  font-size: var(--sgh-fonte-pequena);
  font-family: var(--sgh-fonte-codigo);
  white-space: nowrap;
}
.etiqueta--texto {
  font-family: inherit;
}
/* Alvo mínimo de toque (WCAG 2.5.8): links de ação e de lista. */
nav a,
.acoes a,
li a,
.link-acao {
  display: inline-flex;
  align-items: center;
  min-height: var(--sgh-alvo-minimo);
}

table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
input[type='search'] {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
