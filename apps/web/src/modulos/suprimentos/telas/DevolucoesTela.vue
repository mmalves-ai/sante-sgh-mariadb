<script setup lang="ts">
// Devoluções ao estoque (ficha do M28, seção 7): `/suprimentos/devolucoes`. Abre a saída pelo número (ano, mês e
// documento), mostra o que saiu e o que já voltou por item e por lote; a devolução não passa do que saiu. O valor é
// proporcional ao da saída (o banco); o lote volta ao local. Na saída a paciente, o estorno na conta é feito na
// consolidação (aviso).
import type { DocumentoDetalhe } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerDocumento, novaChave, registrarDevolucao } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import FiltroDocumentos from '../componentes/FiltroDocumentos.vue';
import { usarListaDocumentos } from '../componentes/usar-lista-documentos.js';
import { chaveDoc, data, numero, qtd, reais, usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const cliente = useQueryClient();
const { pode, motivo, locaisDoTipo, nomeLocal } = usarSuprimentos();
const ano = ref(String(new Date().getFullYear()));
const mes = ref(String(new Date().getMonth() + 1));
const doc = ref('');
const saida = ref<DocumentoDetalhe | null>(null);
const local = ref('');
const qtds = ref<Record<number, string>>({});
const lotes = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const opcoesLocais = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...locaisDoTipo('D').map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
]);
async function abrir(): Promise<void> {
  erro.value = null;
  saida.value = null;
  try {
    saida.value = await lerDocumento('saida', {
      ano: Number(ano.value),
      mes: Number(mes.value),
      doc: Number(doc.value),
    });
    local.value = String(saida.value.local);
    qtds.value = {};
    lotes.value = {};
  } catch (x) {
    erro.value = x;
  }
}
async function devolver(): Promise<void> {
  const s = saida.value;
  if (!s) return;
  erro.value = null;
  mensagem.value = null;
  try {
    const itens = s.itensDetalhe
      .filter((i) => numero(qtds.value[i.id] ?? '') > 0)
      .map((i) => ({
        lancamentoSaida: i.id,
        item: i.item,
        quantidade: numero(qtds.value[i.id] ?? ''),
        lotes: i.lotes
          .filter((l) => numero(lotes.value[l.id] ?? '') > 0)
          .map((l) => ({ loteSaida: l.id, quantidade: numero(lotes.value[l.id] ?? '') })),
      }));
    const r = await registrarDevolucao(
      { saida: s.chave, local: Number(local.value), itens },
      novaChave('devolucao'),
    );
    mensagem.value = r.mensagem;
    await abrir();
    await cliente.invalidateQueries({ queryKey: ['suprimentos'] });
  } catch (x) {
    erro.value = x;
  }
}
const { filtro, pagina, lista, haSeguinte } = usarListaDocumentos('devolucao');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="dev-titulo" data-testid="tela-suprimentos-devolucoes">
    <h1 id="dev-titulo">{{ t('suprimentos.devolucoes.titulo') }}</h1>
    <p>{{ t('suprimentos.devolucoes.texto') }}</p>
    <AvisoSuprimentos
      :motivo="pode('suprimentos.registrarDevolucao') ? null : motivo('suprimentos.registrarDevolucao')"
    />
    <div class="filtros">
      <span class="campo">
        <label for="dev-ano">{{ t('suprimentos.ano') }}</label>
        <input id="dev-ano" v-model="ano" inputmode="numeric" data-testid="dev-ano" />
      </span>
      <span class="campo">
        <label for="dev-mes">{{ t('suprimentos.mes') }}</label>
        <input id="dev-mes" v-model="mes" inputmode="numeric" data-testid="dev-mes" />
      </span>
      <span class="campo">
        <label for="dev-doc">{{ t('suprimentos.devolucoes.saida') }}</label>
        <input id="dev-doc" v-model="doc" inputmode="numeric" data-testid="dev-doc" />
      </span>
      <SanteBotao
        variante="secundario"
        :rotulo="t('suprimentos.abrir')"
        data-testid="dev-abrir"
        @acionar="abrir"
      />
    </div>
    <form v-if="saida" class="painel" @submit.prevent="devolver">
      <h2>{{ t('suprimentos.devolucoes.daSaida', { n: chaveDoc(saida.chave) }) }}</h2>
      <p>
        {{ data(saida.data) }} · {{ nomeLocal(saida.local) }}
        <template v-if="saida.paciente"> · {{ saida.paciente.nome }}</template>
      </p>
      <p v-if="saida.paciente" class="secundario">{{ t('suprimentos.devolucoes.estorno') }}</p>
      <SanteSelecao
        v-model="local"
        :rotulo="t('suprimentos.devolucoes.localRecebe')"
        :opcoes="opcoesLocais"
      />
      <table class="tabela" data-testid="dev-itens">
        <caption>
          {{
            t('suprimentos.itens')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('suprimentos.item') }}</th>
            <th scope="col">{{ t('suprimentos.devolucoes.saiu') }}</th>
            <th scope="col">{{ t('suprimentos.devolvido') }}</th>
            <th scope="col">{{ t('suprimentos.devolucoes.devolver') }}</th>
            <th scope="col">{{ t('suprimentos.lotes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in saida.itensDetalhe" :key="i.id">
            <td>{{ i.item }} · {{ i.nome }} · {{ reais(i.valor) }}</td>
            <td>{{ qtd(i.quantidade) }}</td>
            <td>{{ qtd(i.devolvido) }}</td>
            <td>
              <span class="campo">
                <label :for="`dev-qtde-${i.id}`" class="sgh-visualmente-oculto">{{
                  t('suprimentos.devolucoes.devolver')
                }}</label>
                <input
                  :id="`dev-qtde-${i.id}`"
                  v-model="qtds[i.id]"
                  inputmode="decimal"
                  :data-testid="`dev-qtde-${i.item}`"
                />
              </span>
            </td>
            <td>
              <div v-for="l in i.lotes" :key="l.id" class="campo">
                <label :for="`dev-lote-${l.id}`"
                  >{{ l.lote }} · {{ data(l.validade) }} · {{ qtd(l.quantidade) }}</label
                >
                <input
                  :id="`dev-lote-${l.id}`"
                  v-model="lotes[l.id]"
                  inputmode="decimal"
                  :data-testid="`dev-lote-${i.item}-${l.lote}`"
                />
              </div>
              <span v-if="i.lotes.length === 0">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="pode('suprimentos.registrarDevolucao')"
        tipo="submit"
        :rotulo="t('suprimentos.devolucoes.gravar')"
        :desabilitado="!local"
        data-testid="dev-gravar"
      />
    </form>
    <p v-if="mensagem" role="status" data-testid="dev-mensagem">{{ mensagem }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <h2>{{ t('suprimentos.devolucoes.lista') }}</h2>
    <FiltroDocumentos
      v-model:filtro="filtro"
      v-model:pagina="pagina"
      prefixo="devolucoes"
      :ha-seguinte="haSeguinte"
    />
    <ErroSuprimentos v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <ul v-else>
      <li v-for="d in lista.data.value.itens" :key="d.id">
        <RouterLink :to="`/suprimentos/documentos/devolucao/${d.chave.ano}/${d.chave.mes}/${d.chave.doc}`">{{
          chaveDoc(d.chave)
        }}</RouterLink>
        · {{ data(d.data) }} · {{ nomeLocal(d.local) }} · {{ reais(d.valor) }}
      </li>
    </ul>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
