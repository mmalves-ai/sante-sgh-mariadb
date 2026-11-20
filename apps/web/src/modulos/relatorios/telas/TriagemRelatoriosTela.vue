<script setup lang="ts">
// Triagem dos relatórios de consulta livre (M34; ficha, seção 7 e regra 2): `/relatorios/triagem`. A grade com o
// destino, o marco, o artefato, o papel dono e a onda de cada relatório (filtro por destino, situação, marco e nome;
// páginas de 50), o resumo do critério de aceite (total, sem destino, sem dono, confirmados) e a decisão da área com
// o motivo (`relatorio.triagem.decidir`). Abaixo, as consultas dos relatórios e parâmetros de origem (só metadado).
import { DESTINOS_TRIAGEM, type TriagemLida } from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import { decidirTriagem, lerTriagem } from '../api-relatorios.js';

const { t } = useI18n();
const cliente = useQueryClient();
const filtro = reactive({ destino: '', situacao: '', marco: '', termo: '' });
const aplicado = ref({ ...filtro });
const pagina = ref(0);
const TAMANHO = 50;
const podeDecidir = pode('relatorio.triagem.decidir');
const triagem = useQuery({
  queryKey: computed(() => ['relatorios', 'triagem', aplicado.value, pagina.value]),
  queryFn: () =>
    lerTriagem({
      ...(aplicado.value.destino ? { destino: aplicado.value.destino } : {}),
      ...(aplicado.value.situacao ? { situacao: aplicado.value.situacao } : {}),
      ...(aplicado.value.marco ? { marco: aplicado.value.marco } : {}),
      ...(aplicado.value.termo ? { termo: aplicado.value.termo } : {}),
      pagina: pagina.value,
      tamanho: TAMANHO,
    }),
});
const paginas = computed(() => Math.max(1, Math.ceil((triagem.data.value?.total ?? 0) / TAMANHO)));
function buscar(): void {
  pagina.value = 0;
  aplicado.value = { ...filtro };
}

const aberto = ref<TriagemLida | null>(null);
const dialogo = ref(false);
const decisao = reactive({ destino: 'tela', marco: '', artefato: '', papelDono: '', onda: '', motivo: '' });
const erro = ref<unknown>(null);
const feito = ref(false);
function abrir(x: TriagemLida): void {
  aberto.value = x;
  dialogo.value = true;
  erro.value = null;
  feito.value = false;
  Object.assign(decisao, {
    destino: x.destino,
    marco: x.marco ?? '',
    artefato: x.artefato,
    papelDono: x.papelDono,
    onda: x.onda === null ? '' : String(x.onda),
    motivo: '',
  });
}
async function confirmar(): Promise<void> {
  if (!aberto.value) return;
  erro.value = null;
  try {
    await decidirTriagem(aberto.value.id, {
      destino: decisao.destino,
      marco: decisao.marco.trim() || null,
      artefato: decisao.artefato,
      papelDono: decisao.papelDono,
      onda: decisao.onda === '' ? null : Number(decisao.onda),
      motivo: decisao.motivo,
    });
    feito.value = true;
    dialogo.value = false;
    aberto.value = null;
    await cliente.invalidateQueries({ queryKey: ['relatorios', 'triagem'] });
  } catch (e) {
    erro.value = e;
  }
}
const opDestinos = computed(() => [
  { valor: '', rotulo: t('relatorios.triagem.todos') },
  ...DESTINOS_TRIAGEM.map((d) => ({ valor: d, rotulo: t(`relatorios.triagem.destinos.${d}`) })),
]);
const opSituacoes = computed(() => [
  { valor: '', rotulo: t('relatorios.triagem.todos') },
  ...(['proposta', 'confirmada'] as const).map((s) => ({
    valor: s,
    rotulo: t(`relatorios.triagem.situacoes.${s}`),
  })),
]);
const opDestinosDecisao = computed(() =>
  DESTINOS_TRIAGEM.map((d) => ({ valor: d, rotulo: t(`relatorios.triagem.destinos.${d}`) })),
);
const opOndas = computed(() => [
  { valor: '', rotulo: t('relatorios.triagem.semOnda') },
  ...[0, 1, 2, 3, 4].map((n) => ({ valor: String(n), rotulo: String(n) })),
]);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="triagem-titulo" data-testid="tela-triagem">
    <h1 id="triagem-titulo">{{ t('relatorios.triagem.titulo') }}</h1>
    <p>{{ t('relatorios.triagem.texto') }}</p>
    <p v-if="triagem.data.value" role="status" data-testid="triagem-resumo">
      {{ t('relatorios.triagem.resumo', triagem.data.value.resumo) }}
    </p>
    <form class="filtros" @submit.prevent="buscar">
      <SanteSelecao v-model="filtro.destino" :rotulo="t('relatorios.triagem.destino')" :opcoes="opDestinos" />
      <SanteSelecao
        v-model="filtro.situacao"
        :rotulo="t('relatorios.triagem.situacao')"
        :opcoes="opSituacoes"
      />
      <span class="campo">
        <label for="triagem-marco">{{ t('relatorios.triagem.marco') }}</label>
        <input id="triagem-marco" v-model="filtro.marco" maxlength="3" />
      </span>
      <span class="campo">
        <label for="triagem-termo">{{ t('relatorios.triagem.termo') }}</label>
        <input id="triagem-termo" v-model="filtro.termo" maxlength="60" />
      </span>
      <SanteBotao tipo="submit" variante="secundario" :rotulo="t('relatorios.buscar')" />
    </form>
    <p v-if="feito" role="status" data-testid="triagem-feito">{{ t('relatorios.triagem.decidido') }}</p>
    <MensagemErro v-if="triagem.isError.value" :erro="triagem.error.value" />
    <p v-else-if="!triagem.data.value" role="status">{{ t('relatorios.carregando') }}</p>
    <template v-else>
      <table class="tabela" data-testid="tabela-triagem">
        <caption>
          {{
            t('relatorios.triagem.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('relatorios.triagem.nome') }}</th>
            <th scope="col">{{ t('relatorios.triagem.destino') }}</th>
            <th scope="col">{{ t('relatorios.triagem.marco') }}</th>
            <th scope="col">{{ t('relatorios.triagem.artefato') }}</th>
            <th scope="col">{{ t('relatorios.triagem.papelDono') }}</th>
            <th scope="col">{{ t('relatorios.triagem.onda') }}</th>
            <th scope="col">{{ t('relatorios.triagem.situacao') }}</th>
            <th v-if="podeDecidir" scope="col">{{ t('relatorios.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in triagem.data.value.itens" :key="x.id" :data-testid="`triagem-${x.id}`">
            <td>
              {{ x.nome }}
              <span class="secundario">
                {{ x.parametros }} {{ t('relatorios.triagem.parametros')
                }}<template v-if="x.acessoRestrito"> · {{ t('relatorios.triagem.restrito') }}</template>
              </span>
            </td>
            <td>{{ t(`relatorios.triagem.destinos.${x.destino}`) }}</td>
            <td>{{ x.marco ?? '—' }}</td>
            <td>{{ x.artefato }}</td>
            <td>{{ x.papelDono }}</td>
            <td>{{ x.onda ?? '—' }}</td>
            <td>{{ t(`relatorios.triagem.situacoes.${x.situacao}`) }}</td>
            <td v-if="podeDecidir">
              <SanteBotao
                variante="texto"
                :rotulo="t('relatorios.triagem.decidir')"
                :data-testid="`triagem-decidir-${x.id}`"
                @acionar="abrir(x)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <nav class="filtros" :aria-label="t('relatorios.triagem.pagina', { n: pagina + 1, t: paginas })">
        <SanteBotao
          variante="texto"
          :rotulo="t('relatorios.triagem.anterior')"
          :desabilitado="pagina === 0"
          @acionar="pagina--"
        />
        <span>{{ t('relatorios.triagem.pagina', { n: pagina + 1, t: paginas }) }}</span>
        <SanteBotao
          variante="texto"
          :rotulo="t('relatorios.triagem.proxima')"
          :desabilitado="pagina + 1 >= paginas"
          @acionar="pagina++"
        />
      </nav>
    </template>
    <SanteDialogo
      v-model:visivel="dialogo"
      :titulo="`${t('relatorios.triagem.decidir')}: ${aberto?.nome ?? ''}`"
    >
      <form class="formulario" data-testid="dialogo-triagem" @submit.prevent="confirmar">
        <SanteSelecao
          v-model="decisao.destino"
          :rotulo="t('relatorios.triagem.destino')"
          :opcoes="opDestinosDecisao"
        />
        <span class="campo">
          <label for="decisao-marco">{{ t('relatorios.triagem.marco') }}</label>
          <input id="decisao-marco" v-model="decisao.marco" maxlength="3" />
        </span>
        <SanteCampoTexto
          v-model="decisao.artefato"
          :rotulo="t('relatorios.triagem.artefato')"
          :max-bytes="120"
          obrigatorio
        />
        <SanteCampoTexto
          v-model="decisao.papelDono"
          :rotulo="t('relatorios.triagem.papelDono')"
          :max-bytes="60"
          obrigatorio
        />
        <SanteSelecao v-model="decisao.onda" :rotulo="t('relatorios.triagem.onda')" :opcoes="opOndas" />
        <SanteCampoTexto
          v-model="decisao.motivo"
          :rotulo="t('relatorios.triagem.motivo')"
          :max-bytes="200"
          obrigatorio
          data-testid="decisao-motivo"
        />
        <div v-if="erro" role="alert"><MensagemErro :erro="erro" /></div>
        <SanteBotao
          tipo="submit"
          :rotulo="t('relatorios.triagem.confirmar')"
          data-testid="decisao-confirmar"
        />
      </form>
    </SanteDialogo>
    <details>
      <summary>{{ t('relatorios.triagem.origem') }}</summary>
      <GrupoDominiosTela subitem="relatoriosOrigem" embutida />
    </details>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
