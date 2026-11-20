<script setup lang="ts">
// Requisições do setor ao estoque (ficha do M28, seção 7): `/suprimentos/requisicoes`. O setor (ou a enfermagem, pela
// remissão) pede o material para o centro de custo do seu escopo; o estoque vê a fila por local e atende no todo ou
// em parte (o item não atendido sai da requisição; o atendido vira a saída consolidada, com o lote que vence primeiro).
// A requisição não baixa estoque.
import type { ItemBusca, RequisicaoPendente } from '@sgh/contratos';
import { sugerirLotes } from '@sgh/dominio-suprimentos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import {
  atenderRequisicao,
  autorizarRequisicao,
  listarRequisicoes,
  lotesDoLocal,
  novaChave,
  requisitar,
} from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import BuscaItem from '../componentes/BuscaItem.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { chaveDoc, data, numero, qtd, usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { pode, motivo, locais, centros, gravacao } = usarSuprimentos();
const filtroLocal = ref('');
const fila = useQuery({
  queryKey: computed(() => ['suprimentos', 'requisicoes', filtroLocal.value]),
  queryFn: () => listarRequisicoes(filtroLocal.value ? Number(filtroLocal.value) : null),
});
const opcoesLocais = computed(() => [
  { valor: '', rotulo: t('suprimentos.todos') },
  ...locais.value.map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

// ── Nova requisição ──
const rLocal = ref('');
const rCentro = ref('');
const rItens = ref<{ item: number; nome: string; quantidade: string }[]>([]);
const opcoesCentros = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...centros.value.map((c) => ({ valor: String(c.codigo), rotulo: `${c.codigo} · ${c.nome}` })),
]);
const opcoesLocaisReq = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...opcoesLocais.value.slice(1),
]);
function incluirItem(i: ItemBusca): void {
  if (!rItens.value.some((x) => x.item === i.codigo))
    rItens.value.push({ item: i.codigo, nome: i.nome, quantidade: '' });
}
async function enviarRequisicao(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const cc = centros.value.find((c) => c.codigo === Number(rCentro.value));
    const r = await requisitar(
      {
        destino: 2,
        local: Number(rLocal.value),
        centroCusto: Number(rCentro.value),
        localConsumo: cc?.localConsumo ?? 1,
        itens: rItens.value.map((i) => ({ item: i.item, quantidade: numero(i.quantidade) })),
      },
      novaChave('requisicao'),
    );
    mensagem.value = r.mensagem;
    rItens.value = [];
    await cliente.invalidateQueries({ queryKey: ['suprimentos', 'requisicoes'] });
  } catch (x) {
    erro.value = x;
  }
}

// ── Atendimento ──
const atendendo = ref<RequisicaoPendente | null>(null);
const qtdAtendida = ref<Record<number, string>>({});
const lotes = ref<Record<number, { lote: string; validade: string; quantidade: number }[]>>({});
async function abrir(r: RequisicaoPendente): Promise<void> {
  atendendo.value = r;
  qtdAtendida.value = Object.fromEntries(
    r.itens.map((i) => [i.seq, String(Math.min(i.quantidade, i.saldoLocal))]),
  );
  lotes.value = {};
  await sugerir();
}
async function sugerir(): Promise<void> {
  const r = atendendo.value;
  if (!r) return;
  const hoje = new Date().toISOString().slice(0, 10);
  for (const i of r.itens.filter((x) => x.rastreavel)) {
    const ds = await lotesDoLocal(i.item, r.local);
    lotes.value[i.seq] = sugerirLotes(
      ds.map((d) => ({ id: d.id, lote: d.lote, validade: d.validade, saldo: d.quantidade })),
      numero(qtdAtendida.value[i.seq] ?? '0') || 0,
      hoje,
    );
  }
}
async function atender(): Promise<void> {
  const r = atendendo.value;
  if (!r) return;
  erro.value = null;
  mensagem.value = null;
  try {
    const x = await atenderRequisicao(
      {
        requisicao: r.chave,
        itens: r.itens.map((i) => ({
          seq: i.seq,
          item: i.item,
          quantidade: numero(qtdAtendida.value[i.seq] ?? '0') || 0,
          lotes: lotes.value[i.seq] ?? [],
        })),
      },
      novaChave('atender'),
    );
    mensagem.value = x.mensagem;
    atendendo.value = null;
    await cliente.invalidateQueries({ queryKey: ['suprimentos'] });
  } catch (e) {
    erro.value = e;
  }
}
// ── Autorização (registro do novo; o servidor confere a marca "autoriza requisição" do usuário do estoque) ──
const podeAutorizar = computed(() => podePermissao('suprimentos.requisicao.autorizar'));
async function autorizar(r: RequisicaoPendente): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const x = await autorizarRequisicao(r.chave, novaChave('autorizar'));
    mensagem.value = x.mensagem;
    await cliente.invalidateQueries({ queryKey: ['suprimentos', 'requisicoes'] });
  } catch (e) {
    erro.value = e;
  }
}
const podeAtender = computed(() => gravacao.data.value?.operacoes['atenderRequisicao']?.ligada ?? false);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="req-titulo" data-testid="tela-suprimentos-requisicoes">
    <h1 id="req-titulo">{{ t('suprimentos.requisicoes.titulo') }}</h1>
    <p>{{ t('suprimentos.requisicoes.texto') }}</p>
    <p>
      <RouterLink to="/suprimentos/saidas">{{ t('suprimentos.requisicoes.irSaidas') }}</RouterLink>
    </p>
    <AvisoSuprimentos
      :motivo="pode('suprimentos.requisitarMaterial') ? null : motivo('suprimentos.requisitarMaterial')"
    />
    <form v-if="pode('suprimentos.requisitarMaterial')" class="painel" @submit.prevent="enviarRequisicao">
      <h2>{{ t('suprimentos.requisicoes.nova') }}</h2>
      <div class="filtros">
        <SanteSelecao
          v-model="rLocal"
          :rotulo="t('suprimentos.requisicoes.localAtende')"
          :opcoes="opcoesLocaisReq"
          data-testid="req-local"
        />
        <SanteSelecao
          v-model="rCentro"
          :rotulo="t('suprimentos.centroCusto')"
          :opcoes="opcoesCentros"
          data-testid="req-cc"
        />
      </div>
      <BuscaItem testid="req-busca" @escolher="incluirItem" />
      <ul>
        <li v-for="i in rItens" :key="i.item" class="campo">
          <label :for="`req-qtde-${i.item}`">{{ i.item }} · {{ i.nome }}</label>
          <input
            :id="`req-qtde-${i.item}`"
            v-model="i.quantidade"
            inputmode="decimal"
            :data-testid="`req-qtde-${i.item}`"
          />
        </li>
      </ul>
      <SanteBotao
        tipo="submit"
        :rotulo="t('suprimentos.requisicoes.enviar')"
        :desabilitado="!rLocal || !rCentro || rItens.length === 0"
        data-testid="req-enviar"
      />
    </form>
    <div class="filtros">
      <SanteSelecao v-model="filtroLocal" :rotulo="t('suprimentos.local')" :opcoes="opcoesLocais" />
    </div>
    <ErroSuprimentos v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <p v-else-if="fila.data.value.itens.length === 0">{{ t('suprimentos.requisicoes.vazia') }}</p>
    <div
      v-for="r in fila.data.value?.itens ?? []"
      :key="r.id"
      class="painel"
      :data-testid="`requisicao-${r.chave.doc}`"
    >
      <h2>{{ t('suprimentos.requisicoes.numero', { n: chaveDoc(r.chave) }) }}</h2>
      <p>
        {{ data(r.data) }} {{ r.hora }} · {{ r.localNome }} · {{ r.centroCustoNome || r.centroCusto }} ·
        {{ r.usuario }}
        <template v-if="r.paciente"> · {{ r.paciente.nome }}</template>
      </p>
      <p :data-testid="`autorizacao-${r.chave.doc}`">
        {{
          r.autorizacao
            ? t('suprimentos.requisicoes.autorizadaPor', {
                por: r.autorizacao.por,
                em: data(r.autorizacao.em),
              })
            : t('suprimentos.requisicoes.naoAutorizada')
        }}
      </p>
      <template v-if="atendendo?.id === r.id">
        <table class="tabela">
          <caption>
            {{
              t('suprimentos.requisicoes.atendimento')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('suprimentos.item') }}</th>
              <th scope="col">{{ t('suprimentos.requisicoes.pedida') }}</th>
              <th scope="col">{{ t('suprimentos.saldo') }}</th>
              <th scope="col">{{ t('suprimentos.requisicoes.atendida') }}</th>
              <th scope="col">{{ t('suprimentos.lotes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in r.itens" :key="i.seq">
              <td>{{ i.item }} · {{ i.nome }}</td>
              <td>{{ qtd(i.quantidade) }}</td>
              <td>{{ qtd(i.saldoLocal) }}</td>
              <td>
                <span class="campo">
                  <label :for="`atender-${r.id}-${i.seq}`" class="sgh-visualmente-oculto">{{
                    t('suprimentos.requisicoes.atendida')
                  }}</label>
                  <input
                    :id="`atender-${r.id}-${i.seq}`"
                    v-model="qtdAtendida[i.seq]"
                    inputmode="decimal"
                    :data-testid="`atender-qtde-${i.seq}`"
                  />
                </span>
              </td>
              <td>
                {{ (lotes[i.seq] ?? []).map((l) => `${l.lote} ${qtd(l.quantidade)}`).join('; ') || '—' }}
              </td>
            </tr>
          </tbody>
        </table>
        <div class="acoes">
          <SanteBotao variante="secundario" :rotulo="t('suprimentos.sugerirLotes')" @acionar="sugerir" />
          <SanteBotao
            :rotulo="t('suprimentos.requisicoes.confirmar')"
            data-testid="atender-confirmar"
            @acionar="atender"
          />
          <SanteBotao variante="texto" :rotulo="t('suprimentos.cancelar')" @acionar="atendendo = null" />
        </div>
      </template>
      <ul v-else>
        <li v-for="i in r.itens" :key="i.seq">
          {{ i.item }} · {{ i.nome }} · {{ qtd(i.quantidade) }} ({{ t('suprimentos.saldo') }}
          {{ qtd(i.saldoLocal) }})
        </li>
      </ul>
      <SanteBotao
        v-if="podeAutorizar && !r.autorizacao && atendendo?.id !== r.id"
        variante="secundario"
        :rotulo="t('suprimentos.requisicoes.autorizar')"
        :data-testid="`autorizar-${r.chave.doc}`"
        @acionar="autorizar(r)"
      />
      <SanteBotao
        v-if="podeAtender && atendendo?.id !== r.id"
        variante="secundario"
        :rotulo="t('suprimentos.requisicoes.atender')"
        :data-testid="`atender-${r.chave.doc}`"
        @acionar="abrir(r)"
      />
    </div>
    <p v-if="mensagem" role="status" data-testid="req-mensagem">{{ mensagem }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
