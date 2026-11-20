<script setup lang="ts">
// Conferência dos responsáveis legais do portal do paciente (M50, etapa 1; ficha, seção 7 e regra 5; tela interna da
// privacidade e da recepção com a opção de ações do termo de consentimento). A fila por situação, o documento enviado
// (aberto aqui, sem sair do sistema), os sinais do cadastro (o guardião registrado; o incapaz), aprovar com o escopo
// (procurador: o que a procuração permite, com a validade), recusar com o motivo que o responsável vê e encerrar.
// Quem pediu não aprova o próprio pedido. As decisões pedem a senha de novo. A fila vem em páginas (por ordem de
// chegada, "Carregar mais" pelo cursor) e tem a busca pelo prontuário do representado: nenhum vínculo fica fora de
// alcance (o encerramento de um acesso antigo ou recente sai daqui ou da ficha do paciente).
import { ESCOPOS_VINCULO, type EscopoVinculo, type VinculoParaConferir } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useInfiniteQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroPortal from '../componentes/ErroPortal.vue';
import { decidirVinculo, encerrarVinculo, filaVinculos, provaDoVinculo } from '../api-portal-interno.js';

const { t } = useI18n();
const situacao = ref('pendente');
const buscaTexto = ref('');
const prontuario = ref<string | null>(null);
const fila = useInfiniteQuery({
  queryKey: computed(() => ['portal-paciente', 'vinculos', situacao.value, prontuario.value]),
  queryFn: ({ pageParam }) => filaVinculos(situacao.value, prontuario.value, pageParam),
  initialPageParam: null as string | null,
  getNextPageParam: (p) => p.proximo,
});
const itens = computed(() => fila.data.value?.pages.flatMap((p) => p.itens) ?? []);
function buscar(): void {
  const n = buscaTexto.value.replace(/\D/g, '');
  prontuario.value = n === '' ? null : n;
}
function limpar(): void {
  buscaTexto.value = '';
  prontuario.value = null;
}
const aberto = ref<VinculoParaConferir | null>(null);
const prova = ref<{ tipo: string; url: string } | null>(null);
const escopos = ref<EscopoVinculo[]>([]);
const validade = ref('');
const motivo = ref('');
const senha = ref('');
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
const opcoesSituacao = computed(() =>
  ['pendente', 'ativo', 'recusado', 'encerrado', 'todas'].map((v) => ({
    valor: v,
    rotulo: v === 'todas' ? t('portal.interno.vinculos.todas') : t(`portal.responsaveis.situacoes.${v}`),
  })),
);
const dia = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');

async function abrir(v: VinculoParaConferir): Promise<void> {
  erro.value = null;
  feito.value = null;
  aberto.value = v;
  escopos.value = [...v.escopos];
  validade.value = v.validade ?? '';
  motivo.value = '';
  if (prova.value) URL.revokeObjectURL(prova.value.url);
  prova.value = null;
  if (!v.temArquivo) return;
  try {
    const p = await provaDoVinculo(v.vinculo);
    const bytes = Uint8Array.from(atob(p.conteudo), (c) => c.charCodeAt(0));
    prova.value = { tipo: p.tipo, url: URL.createObjectURL(new Blob([bytes], { type: p.tipo })) };
  } catch (x) {
    erro.value = x;
  }
}

async function decidir(decisao: 'aprovar' | 'recusar'): Promise<void> {
  if (!aberto.value) return;
  erro.value = null;
  try {
    const r = await decidirVinculo(
      aberto.value.vinculo,
      decisao === 'aprovar'
        ? { decisao, escopos: escopos.value, validade: validade.value || null, senha: senha.value }
        : { decisao, motivo: motivo.value, senha: senha.value },
    );
    feito.value = t(`portal.responsaveis.situacoes.${r.situacao}`);
    aberto.value = r;
    senha.value = '';
    await fila.refetch();
  } catch (x) {
    erro.value = x;
  }
}
async function encerrar(): Promise<void> {
  if (!aberto.value) return;
  erro.value = null;
  try {
    await encerrarVinculo(aberto.value.vinculo, {
      motivo: 'revogado-pelo-hospital',
      justificativa: motivo.value,
      senha: senha.value,
    });
    feito.value = t('portal.responsaveis.situacoes.encerrado');
    aberto.value = null;
    senha.value = '';
    await fila.refetch();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="conf-titulo" data-testid="tela-conferencia-vinculos">
    <h1 id="conf-titulo">{{ t('portal.interno.vinculos.titulo') }}</h1>
    <p>{{ t('portal.interno.vinculos.ajuda') }}</p>
    <SanteSelecao
      v-model="situacao"
      :rotulo="t('portal.interno.vinculos.filtro')"
      :opcoes="opcoesSituacao"
      :busca="true"
      data-testid="conf-situacao"
    />
    <form class="conf-busca" role="search" @submit.prevent="buscar">
      <span class="campo">
        <label for="conf-busca">{{ t('portal.interno.vinculos.buscar') }}</label>
        <input
          id="conf-busca"
          v-model="buscaTexto"
          type="search"
          inputmode="numeric"
          autocomplete="off"
          data-testid="conf-busca"
        />
      </span>
      <SanteBotao
        tipo="submit"
        variante="secundario"
        :rotulo="t('portal.interno.vinculos.buscarBotao')"
        data-testid="conf-buscar"
        @acionar="buscar"
      />
      <SanteBotao
        v-if="prontuario"
        variante="texto"
        :rotulo="t('portal.interno.vinculos.limpar')"
        @acionar="limpar"
      />
    </form>
    <ErroPortal v-if="fila.isError.value" :erro="fila.error.value" />
    <template v-else-if="fila.data.value">
      <p v-if="itens.length === 0">{{ t('portal.nenhum') }}</p>
      <table v-else class="conf-tabela" data-testid="conf-fila">
        <caption>
          {{
            t('portal.interno.vinculos.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('portal.interno.vinculos.titular') }}</th>
            <th scope="col">{{ t('portal.interno.vinculos.responsavel') }}</th>
            <th scope="col">{{ t('portal.responsaveis.tipo') }}</th>
            <th scope="col">{{ t('portal.interno.vinculos.pedidoEm') }}</th>
            <th scope="col">{{ t('portal.interno.vinculos.filtro') }}</th>
            <th scope="col">{{ t('portal.interno.vinculos.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in itens" :key="v.vinculo">
            <td>
              {{ v.primeiroNomeOutro }} ·
              {{ t('portal.interno.vinculos.prontuario', { n: v.prontuarioTitular }) }}
              <span v-if="v.idadeTitular !== null">
                · {{ t('portal.interno.vinculos.idade', { n: v.idadeTitular }) }}</span
              >
            </td>
            <td>{{ v.primeiroNomeResponsavel }}</td>
            <td>{{ t(`portal.responsaveis.tipos.${v.tipo}`) }}</td>
            <td>
              {{ dia(v.pedidoEm) }} ·
              {{ t('portal.interno.vinculos.diasNaFila', { n: v.diasNaFila }, v.diasNaFila) }}
            </td>
            <td>{{ t(`portal.responsaveis.situacoes.${v.situacao}`) }}</td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="t('portal.interno.vinculos.abrir')"
                :data-testid="`conf-abrir-${v.vinculo}`"
                @acionar="abrir(v)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="fila.hasNextPage.value"
        variante="secundario"
        :rotulo="t('portal.interno.vinculos.carregarMais')"
        :desabilitado="fila.isFetchingNextPage.value"
        data-testid="conf-mais"
        @acionar="fila.fetchNextPage()"
      />
    </template>
    <p v-else role="status">{{ t('portal.carregando') }}</p>
    <SanteAlerta v-if="feito" :texto="feito" variante="info" anunciar data-testid="conf-feito" />
    <ErroPortal v-if="erro" :erro="erro" />
    <section v-if="aberto" class="conf-detalhe" aria-labelledby="conf-detalhe" data-testid="conf-detalhe">
      <h2 id="conf-detalhe">
        {{ aberto.primeiroNomeOutro }} · {{ t(`portal.responsaveis.tipos.${aberto.tipo}`) }}
      </h2>
      <p>{{ t('portal.responsaveis.prova') }}: {{ t(`portal.responsaveis.provas.${aberto.prova}`) }}</p>
      <p v-if="aberto.canal === 'balcao'">{{ t('portal.interno.vinculos.balcao') }}</p>
      <SanteAlerta
        v-if="aberto.guardiao"
        :texto="
          aberto.guardiao === 'confere'
            ? t('portal.interno.vinculos.guardiaoNoCadastro')
            : t('portal.interno.vinculos.guardiaoDiferente')
        "
        variante="info"
      />
      <SanteAlerta
        v-if="aberto.curatelado"
        :texto="t('portal.interno.vinculos.curatelado')"
        variante="aviso"
      />
      <SanteAlerta v-if="aberto.motivoRecusa" :texto="aberto.motivoRecusa" variante="aviso" />
      <template v-if="prova">
        <img
          v-if="prova.tipo.startsWith('image/')"
          :src="prova.url"
          :alt="t('portal.interno.vinculos.verDocumento')"
          class="conf-prova"
          data-testid="conf-prova"
        />
        <a v-else :href="prova.url" target="_blank" rel="noopener" data-testid="conf-prova">{{
          t('portal.interno.vinculos.verDocumento')
        }}</a>
      </template>
      <form v-if="aberto.situacao === 'pendente' || aberto.situacao === 'ativo'" class="form" @submit.prevent>
        <fieldset v-if="aberto.situacao === 'pendente'">
          <legend>{{ t('portal.interno.vinculos.escopo') }}</legend>
          <label v-for="e in ESCOPOS_VINCULO" :key="e"
            ><input v-model="escopos" type="checkbox" :value="e" :data-testid="`conf-escopo-${e}`" />
            {{ t(`portal.responsaveis.escopos.${e}`) }}</label
          >
        </fieldset>
        <span v-if="aberto.situacao === 'pendente' && aberto.tipo === 'procurador'" class="campo">
          <label for="conf-validade">{{ t('portal.interno.vinculos.validade') }}</label>
          <input id="conf-validade" v-model="validade" type="date" />
        </span>
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('portal.interno.vinculos.motivoRecusa')"
          :max-bytes="400"
          multilinha
        />
        <span class="campo">
          <label for="conf-senha">{{ t('portal.interno.senha') }}</label>
          <input
            id="conf-senha"
            v-model="senha"
            type="password"
            autocomplete="current-password"
            data-testid="conf-senha"
          />
        </span>
        <template v-if="aberto.situacao === 'pendente'">
          <SanteBotao
            :rotulo="t('portal.interno.vinculos.aprovar')"
            data-testid="conf-aprovar"
            @acionar="decidir('aprovar')"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('portal.interno.vinculos.recusar')"
            data-testid="conf-recusar"
            @acionar="decidir('recusar')"
          />
        </template>
        <SanteBotao
          v-else
          variante="destrutivo"
          :rotulo="t('portal.interno.vinculos.encerrar')"
          :confirmacao="t('portal.interno.vinculos.encerrarConfirma')"
          data-testid="conf-encerrar"
          @acionar="encerrar"
        />
      </form>
    </section>
  </section>
</template>

<style scoped>
.conf-tabela {
  border-collapse: collapse;
  width: 100%;
}
.conf-tabela th,
.conf-tabela td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.conf-busca {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--sgh-espaco-2);
}
.conf-detalhe {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-3);
}
.conf-prova {
  max-width: 100%;
  max-height: 32rem;
  object-fit: contain;
}
</style>
