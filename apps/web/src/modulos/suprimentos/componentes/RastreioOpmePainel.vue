<script setup lang="ts">
// Rastreio reverso do OPME (M46, etapa 3; regra 8; recall e tecnovigilância): do lote, da série ou do registro Anvisa
// aos pacientes expostos (os consumos em sala, com a cirurgia e o cirurgião) e, com o item e o lote, às saídas do lote no
// estoque com o atendimento (inclusive as feitas por outro caminho do estoque). O item é buscado pelo nome ou código
// (com a permissão de ler o OPME); sem ele, a busca vale para qualquer item. Leitura auditada no servidor
// (suprimentos.lote.rastrear).
import type { ItemOpme, RastreioReversoOpme } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarItensOpme, lerRastreioReversoOpme } from '../api-opme.js';
import ErroSuprimentos from './ErroSuprimentos.vue';

const { t } = useI18n();
const podeBuscarItem = computed(() => pode('suprimentos.opme.ler'));
const termo = ref('');
const itens = ref<ItemOpme[] | null>(null);
const item = ref<number | null>(null);
const lote = ref('');
const serie = ref('');
const anvisa = ref('');
const rastreio = ref<RastreioReversoOpme | null>(null);
const erro = ref<unknown>(null);
const diaHora = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)}`;

async function buscarItem(): Promise<void> {
  erro.value = null;
  try {
    itens.value = (await buscarItensOpme(termo.value.trim(), null)).itens;
    if (item.value !== null && !itens.value.some((i) => i.item === item.value)) item.value = null;
  } catch (e) {
    erro.value = e;
  }
}
const opcoesItem = computed(() => [
  { valor: null as number | null, rotulo: t('opme.conciliacao.qualquerItem') },
  ...(itens.value ?? []).map((i) => ({ valor: i.item as number | null, rotulo: `${i.item} · ${i.nome}` })),
]);
const podeRastrear = computed(() => !!lote.value.trim() || !!serie.value.trim() || !!anvisa.value.trim());

async function rastrear(): Promise<void> {
  erro.value = null;
  try {
    rastreio.value = await lerRastreioReversoOpme({
      item: item.value,
      lote: lote.value.trim() || null,
      serie: serie.value.trim() || null,
      registroAnvisa: anvisa.value.trim() || null,
    });
  } catch (e) {
    rastreio.value = null;
    erro.value = e;
  }
}
</script>

<template>
  <div v-if="podeBuscarItem" class="barra">
    <span class="campo">
      <label for="opmez-termo">{{ t('opme.conciliacao.item') }}</label>
      <input
        id="opmez-termo"
        v-model="termo"
        type="search"
        maxlength="60"
        data-testid="opmez-termo"
        @keyup.enter="buscarItem"
      />
    </span>
    <SanteBotao
      variante="secundario"
      :rotulo="t('opme.solicitacoes.buscar')"
      data-testid="opmez-buscar-item"
      @acionar="buscarItem"
    />
    <SanteSelecao
      v-if="itens"
      v-model="item"
      :rotulo="t('opme.conciliacao.itemEscolhido')"
      :opcoes="opcoesItem"
      :busca="true"
      data-testid="opmez-item"
    />
  </div>
  <div class="barra">
    <span class="campo">
      <label for="opmez-lote">{{ t('opme.conciliacao.lote') }}</label>
      <input id="opmez-lote" v-model="lote" maxlength="30" data-testid="opmez-lote" />
    </span>
    <span class="campo">
      <label for="opmez-serie">{{ t('opme.conciliacao.serie') }}</label>
      <input id="opmez-serie" v-model="serie" maxlength="40" data-testid="opmez-serie" />
    </span>
    <span class="campo">
      <label for="opmez-anvisa">{{ t('opme.conciliacao.anvisa') }}</label>
      <input
        id="opmez-anvisa"
        v-model="anvisa"
        inputmode="numeric"
        maxlength="13"
        data-testid="opmez-anvisa"
      />
    </span>
    <SanteBotao
      :rotulo="t('opme.conciliacao.rastrear')"
      :desabilitado="!podeRastrear"
      data-testid="opmez-rastrear"
      @acionar="rastrear"
    />
  </div>
  <ErroSuprimentos v-if="erro" :erro="erro" />
  <template v-if="rastreio">
    <p role="status" data-testid="opmez-expostos">
      {{ rastreio.itemNome ?? rastreio.item ?? t('opme.conciliacao.qualquerItem') }} ·
      {{ t('opme.conciliacao.expostos', { n: rastreio.expostos.length }) }} ·
      {{ t('opme.conciliacao.saidasDoLote', { n: rastreio.saidasDoLote }) }}
    </p>
    <p v-if="rastreio.expostos.length === 0">{{ t('opme.conciliacao.nenhumExposto') }}</p>
    <div v-else class="rolagem">
      <table class="grade">
        <caption class="secundario">
          {{
            t('opme.conciliacao.consumosEmSala')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('opme.conciliacao.colData') }}</th>
            <th scope="col">{{ t('opme.conciliacao.colAtendimento') }}</th>
            <th scope="col">{{ t('opme.conciliacao.colCirurgia') }}</th>
            <th scope="col">{{ t('opme.conciliacao.colCirurgiao') }}</th>
            <th scope="col">{{ t('opme.conciliacao.colRastreio') }}</th>
            <th scope="col">{{ t('opme.conciliacao.colQtd') }}</th>
            <th scope="col">{{ t('opme.conciliacao.colRegistro') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in rastreio.expostos" :key="x.consumo" :data-testid="`opmez-exposto-${x.consumo}`">
            <td>{{ diaHora(x.dataHora) }}</td>
            <td>{{ x.atendimento }}</td>
            <td>{{ x.agendamento }} · {{ x.sala }}</td>
            <td>{{ x.cirurgiao ?? '—' }}</td>
            <td>{{ x.lote ?? '—' }} / {{ x.serie ?? '—' }} · {{ x.registroAnvisa }}</td>
            <td>{{ x.quantidade }} ({{ x.devolvida }})</td>
            <td>{{ x.usuario }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="rastreio.saidasEstoque.length > 0" class="rolagem">
      <table class="grade">
        <caption class="secundario">
          {{
            t('opme.conciliacao.saidasEstoque')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('opme.conciliacao.colData') }}</th>
            <th scope="col">{{ t('opme.conciliacao.colAtendimento') }}</th>
            <th scope="col">{{ t('opme.conciliacao.colDocumento') }}</th>
            <th scope="col">{{ t('opme.conciliacao.colQtdSaida') }}</th>
            <th scope="col">{{ t('opme.conciliacao.colOrigem') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="x in rastreio.saidasEstoque"
            :key="`${x.saida.ano}-${x.saida.mes}-${x.saida.doc}-${x.atendimento}`"
            :data-testid="`opmez-saida-${x.saida.doc}`"
          >
            <td>{{ x.data ? diaHora(x.data) : '—' }}</td>
            <td>{{ x.atendimento || '—' }}</td>
            <td>{{ x.saida.doc }} ({{ x.saida.mes }}/{{ x.saida.ano }})</td>
            <td>{{ x.quantidade }}</td>
            <td>{{ t(`opme.conciliacao.origens.${x.origem}`) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="rastreio.cortada" class="secundario">{{ t('opme.conciliacao.rastreioCortado') }}</p>
  </template>
</template>
