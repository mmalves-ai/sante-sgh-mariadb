<script setup lang="ts">
// Transferências entre locais (ficha do M28, seção 7): `/suprimentos/transferencias`. Em dois passos: o envio (a
// origem, o destino e os itens com os lotes; o saldo fica na origem até o recebimento) e o recebimento no destino
// (a quantidade recebida por item; a divergência exige motivo), que grava e consolida o documento no banco. O envio
// ainda não recebido pode ser cancelado com motivo. Os dois locais têm de estar no escopo do usuário.
import type { TransferenciaEnviada } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  cancelarEnvio,
  enviarTransferencia,
  listarEnvios,
  novaChave,
  receberTransferencia,
} from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import FiltroDocumentos from '../componentes/FiltroDocumentos.vue';
import { usarListaDocumentos } from '../componentes/usar-lista-documentos.js';
import LinhasItens from '../componentes/LinhasItens.vue';
import { itensDaEntrada, type LinhaItem } from '../componentes/linhas.js';
import { chaveDoc, data, numero, qtd, quando, reais, usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { pode, motivo, locaisDoTipo, locais, nomeLocal } = usarSuprimentos();
// Os documentos de transferência gravados no estoque (os de passo único e os recebimentos), por local e período.
const { filtro, pagina, lista, haSeguinte } = usarListaDocumentos('transferencia');
const origem = ref('');
const destino = ref('');
const observacao = ref('');
const linhas = ref<LinhaItem[]>([]);
const etapa = ref('enviada');
const recebidos = ref<Record<string, string>>({});
const motivos = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
watch(origem, () => (linhas.value = []));
const opcoesOrigem = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...locaisDoTipo('TO').map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
]);
const opcoesDestino = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...locais.value
    .filter((l) => String(l.codigo) !== origem.value)
    .map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
]);
const etapas = computed(() => [
  { valor: 'enviada', rotulo: t('suprimentos.transferencias.etapas.enviada') },
  { valor: 'recebida', rotulo: t('suprimentos.transferencias.etapas.recebida') },
  { valor: 'divergente', rotulo: t('suprimentos.transferencias.etapas.divergente') },
  { valor: 'cancelada', rotulo: t('suprimentos.transferencias.etapas.cancelada') },
]);
const envios = useQuery({
  queryKey: computed(() => ['suprimentos', 'envios', etapa.value]),
  queryFn: () => listarEnvios({ etapa: etapa.value }),
});
const podeReceber = (e: TransferenciaEnviada) =>
  e.etapa === 'enviada' && locaisDoTipo('TD').some((l) => l.codigo === e.destino);

async function enviar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await enviarTransferencia(
      {
        origem: Number(origem.value),
        destino: Number(destino.value),
        ...(observacao.value.trim() ? { observacao: observacao.value.trim() } : {}),
        itens: itensDaEntrada(linhas.value).map((i) => ({
          item: i.item,
          quantidade: i.quantidade,
          lotes: i.lotes,
        })),
      },
      novaChave('envio'),
    );
    mensagem.value = r.mensagem;
    linhas.value = [];
    await cliente.invalidateQueries({ queryKey: ['suprimentos', 'envios'] });
  } catch (x) {
    erro.value = x;
  }
}
async function receber(e: TransferenciaEnviada): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const m = (motivos.value[e.id] ?? '').trim();
    const r = await receberTransferencia(
      e.id,
      {
        recebidos: e.itens.map((i) => ({
          item: i.item,
          quantidade: numero(recebidos.value[`${e.id}-${i.item}`] ?? String(i.quantidade)),
        })),
        ...(m ? { motivoDivergencia: m } : {}),
      },
      novaChave('receber'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['suprimentos'] });
  } catch (x) {
    erro.value = x;
  }
}
async function cancelar(e: TransferenciaEnviada): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await cancelarEnvio(e.id, (motivos.value[e.id] ?? '').trim(), novaChave('cancelar'));
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['suprimentos', 'envios'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="tra-titulo" data-testid="tela-suprimentos-transferencias">
    <h1 id="tra-titulo">{{ t('suprimentos.transferencias.titulo') }}</h1>
    <p>{{ t('suprimentos.transferencias.texto') }}</p>
    <AvisoSuprimentos :motivo="pode('suprimentos.transferir') ? null : motivo('suprimentos.transferir')" />
    <form class="painel" data-testid="tra-envio" @submit.prevent="enviar">
      <h2>{{ t('suprimentos.transferencias.novo') }}</h2>
      <SanteSelecao
        v-model="origem"
        :rotulo="t('suprimentos.transferencias.origem')"
        :opcoes="opcoesOrigem"
        data-testid="tra-origem"
      />
      <SanteSelecao
        v-model="destino"
        :rotulo="t('suprimentos.transferencias.destino')"
        :opcoes="opcoesDestino"
        data-testid="tra-destino"
      />
      <span class="campo">
        <label for="tra-obs">{{ t('suprimentos.observacao') }}</label>
        <input id="tra-obs" v-model="observacao" maxlength="60" />
      </span>
      <LinhasItens v-if="origem" v-model="linhas" :local="Number(origem)" testid="tra-itens" />
      <SanteBotao
        v-if="pode('suprimentos.transferir')"
        tipo="submit"
        :rotulo="t('suprimentos.transferencias.enviar')"
        :desabilitado="!origem || !destino || linhas.length === 0"
        data-testid="tra-enviar"
      />
    </form>
    <p v-if="mensagem" role="status" data-testid="tra-mensagem">{{ mensagem }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <h2>{{ t('suprimentos.transferencias.envios') }}</h2>
    <SanteSelecao
      v-model="etapa"
      :rotulo="t('suprimentos.transferencias.etapa')"
      :opcoes="etapas"
      data-testid="tra-etapa"
    />
    <p v-if="!envios.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <p v-else-if="envios.data.value.length === 0">{{ t('suprimentos.nenhum') }}</p>
    <div v-for="e in envios.data.value ?? []" :key="e.id" class="painel" :data-testid="`tra-envio-${e.id}`">
      <h3>
        {{ e.origemNome }} {{ t('suprimentos.para', { l: e.destinoNome }) }} · {{ quando(e.enviadaEm) }} ·
        {{ e.enviadaPor }}
      </h3>
      <p v-if="e.documento" class="secundario">
        {{ t('suprimentos.documento') }}
        <RouterLink
          :to="`/suprimentos/documentos/transferencia/${e.documento.ano}/${e.documento.mes}/${e.documento.doc}`"
          >{{ chaveDoc(e.documento) }}</RouterLink
        >
      </p>
      <table class="tabela">
        <caption>
          {{
            t('suprimentos.itens')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.item') }}</th>
            <th scope="col">{{ t('suprimentos.transferencias.enviada') }}</th>
            <th scope="col">{{ t('suprimentos.transferencias.recebida') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in e.itens" :key="i.item">
            <td>{{ i.item }} · {{ i.nome }}</td>
            <td>{{ qtd(i.quantidade) }}</td>
            <td>
              <template v-if="podeReceber(e)">
                <label :for="`tra-r-${e.id}-${i.item}`" class="sgh-visualmente-oculto">{{
                  t('suprimentos.transferencias.recebida')
                }}</label>
                <input
                  :id="`tra-r-${e.id}-${i.item}`"
                  v-model="recebidos[`${e.id}-${i.item}`]"
                  :placeholder="String(i.quantidade)"
                  inputmode="decimal"
                  size="6"
                  :data-testid="`tra-recebida-${e.id}-${i.item}`"
                />
              </template>
              <template v-else>{{ i.recebida === null ? '—' : qtd(i.recebida) }}</template>
            </td>
          </tr>
        </tbody>
      </table>
      <template v-if="e.etapa === 'enviada' && pode('suprimentos.transferir')">
        <span class="campo">
          <label :for="`tra-m-${e.id}`">{{ t('suprimentos.transferencias.motivo') }}</label>
          <input :id="`tra-m-${e.id}`" v-model="motivos[e.id]" :data-testid="`tra-motivo-${e.id}`" />
        </span>
        <div class="filtros">
          <SanteBotao
            v-if="podeReceber(e)"
            :rotulo="t('suprimentos.transferencias.receber')"
            :data-testid="`tra-receber-${e.id}`"
            @acionar="receber(e)"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('suprimentos.transferencias.cancelar')"
            @acionar="cancelar(e)"
          />
        </div>
      </template>
    </div>
    <h2>{{ t('suprimentos.listaDocumentos.doEstoque') }}</h2>
    <FiltroDocumentos
      v-model:filtro="filtro"
      v-model:pagina="pagina"
      prefixo="transferencias"
      :ha-seguinte="haSeguinte"
    />
    <ErroSuprimentos v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0">{{ t('suprimentos.nenhum') }}</p>
    <ul v-else data-testid="tra-documentos">
      <li v-for="d in lista.data.value.itens" :key="d.id">
        <RouterLink
          :to="`/suprimentos/documentos/transferencia/${d.chave.ano}/${d.chave.mes}/${d.chave.doc}`"
          >{{ chaveDoc(d.chave) }}</RouterLink
        >
        · {{ data(d.data) }} ·
        {{
          t('suprimentos.listaDocumentos.dePara', { de: nomeLocal(d.local), para: nomeLocal(d.localDestino) })
        }}
        · {{ reais(d.valor) }}
      </li>
    </ul>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
