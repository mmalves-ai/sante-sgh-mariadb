<script setup lang="ts">
// Movimento direto paciente/centro de custo (ficha do M28, seção 7): `/suprimentos/movimento-direto`. Consumo direto
// por paciente (atendimento) ou centro de custo, do local escolhido. É P2: a gravação fica desligada enquanto a
// receita não for provada (POL-3); a tela mostra o motivo.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { novaChave, registrarMovimentoDireto } from '../api-suprimentos.js';
import AvisoSuprimentos from '../componentes/AvisoSuprimentos.vue';
import BuscaItem from '../componentes/BuscaItem.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { numero, usarSuprimentos } from '../usar-suprimentos.js';

const { t } = useI18n();
const { pode, motivo, locaisDoTipo, centros } = usarSuprimentos();
const para = ref<'paciente' | 'centroCusto'>('centroCusto');
const atendimento = ref('');
const centroCusto = ref('');
const local = ref('');
const itens = ref<{ item: number; nome: string; quantidade: string }[]>([]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const opcoesPara = computed(() => [
  { valor: 'centroCusto', rotulo: t('suprimentos.movimento.centro') },
  { valor: 'paciente', rotulo: t('suprimentos.movimento.paciente') },
]);
const opcoesLocais = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...locaisDoTipo('S').map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
]);
const opcoesCentros = computed(() => [
  { valor: '', rotulo: t('suprimentos.escolha') },
  ...centros.value.map((c) => ({ valor: String(c.codigo), rotulo: `${c.codigo} · ${c.nome}` })),
]);
async function gravar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await registrarMovimentoDireto(
      {
        para: para.value,
        ...(para.value === 'paciente' ? { atendimento: Number(atendimento.value) } : {}),
        centroCusto: Number(centroCusto.value),
        local: Number(local.value),
        itens: itens.value.map((i) => ({ item: i.item, quantidade: numero(i.quantidade) })),
      },
      novaChave('movimento'),
    );
    mensagem.value = r.mensagem;
    itens.value = [];
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="mov-titulo" data-testid="tela-suprimentos-movimento">
    <h1 id="mov-titulo">{{ t('suprimentos.movimento.titulo') }}</h1>
    <p>{{ t('suprimentos.movimento.texto') }}</p>
    <AvisoSuprimentos
      :motivo="
        pode('suprimentos.registrarMovimentoDireto') ? null : motivo('suprimentos.registrarMovimentoDireto')
      "
    />
    <form class="painel" @submit.prevent="gravar">
      <SanteSelecao v-model="para" :rotulo="t('suprimentos.movimento.para')" :opcoes="opcoesPara" />
      <span v-if="para === 'paciente'" class="campo">
        <label for="mov-at">{{ t('suprimentos.atendimento') }}</label>
        <input id="mov-at" v-model="atendimento" inputmode="numeric" />
      </span>
      <SanteSelecao v-model="centroCusto" :rotulo="t('suprimentos.centroCusto')" :opcoes="opcoesCentros" />
      <SanteSelecao v-model="local" :rotulo="t('suprimentos.local')" :opcoes="opcoesLocais" />
      <BuscaItem
        testid="mov-busca"
        @escolher="
          (i) =>
            !itens.some((x) => x.item === i.codigo) &&
            itens.push({ item: i.codigo, nome: i.nome, quantidade: '' })
        "
      />
      <ul v-if="itens.length">
        <li v-for="(i, k) in itens" :key="i.item" class="filtros">
          <span>{{ i.item }} · {{ i.nome }}</span>
          <span class="campo">
            <label :for="`mov-q-${i.item}`" class="sgh-visualmente-oculto">{{
              t('suprimentos.quantidade')
            }}</label>
            <input :id="`mov-q-${i.item}`" v-model="i.quantidade" inputmode="decimal" size="6" />
          </span>
          <SanteBotao variante="texto" :rotulo="t('suprimentos.retirar')" @acionar="itens.splice(k, 1)" />
        </li>
      </ul>
      <SanteBotao
        v-if="pode('suprimentos.registrarMovimentoDireto')"
        tipo="submit"
        :rotulo="t('suprimentos.gravar')"
        :desabilitado="!local || !centroCusto || itens.length === 0"
      />
    </form>
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
