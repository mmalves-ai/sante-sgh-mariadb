<script setup lang="ts">
// Orçamento de particular (ficha do M30, seção 7): `/faturamento/particular/orcamentos`. O orçamento com os itens, o
// desconto e a validade; a urgência nunca é condicionada a caução ou garantia (regra 12; Lei 12.653/2012: o servidor
// recusa). O recebimento é no caixa.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { listarOrcamentos, novaChave, registrarOrcamento } from '../api-faturamento.js';
import AvisoFaturamento from '../componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';
import { data, numero, reais, usarFaturamento } from '../usar-faturamento.js';

const { t } = useI18n();
const qc = useQueryClient();
const { pode, motivoFuncionalidade } = usarFaturamento(true);
const q = useQuery({ queryKey: ['faturamento', 'orcamentos'], queryFn: () => listarOrcamentos() });
const novo = ref({
  prontuario: '0',
  nome: '',
  itens: [{ descricao: '', quantidade: '1', unitario: '' }],
  desconto: '0',
  validadeDias: '30',
  urgencia: false,
  garantia: false,
});
const totalPrevisto = computed(() =>
  Math.max(
    0,
    novo.value.itens.reduce((s, i) => s + numero(i.quantidade || '0') * numero(i.unitario || '0'), 0) -
      numero(novo.value.desconto || '0'),
  ),
);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function gravar() {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = (
      await registrarOrcamento(
        {
          prontuario: Number(novo.value.prontuario || 0),
          nome: novo.value.nome,
          itens: novo.value.itens.map((i) => ({
            descricao: i.descricao,
            quantidade: numero(i.quantidade),
            unitario: numero(i.unitario),
          })),
          desconto: numero(novo.value.desconto || '0'),
          validadeDias: Number(novo.value.validadeDias || 30),
          urgencia: novo.value.urgencia,
          exigeGarantiaAntes: novo.value.garantia,
        },
        novaChave('orcamento'),
      )
    ).mensagem;
    await qc.invalidateQueries({ queryKey: ['faturamento', 'orcamentos'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="orc-titulo" data-testid="tela-faturamento-orcamentos">
    <h1 id="orc-titulo">{{ t('faturamento.orcamentos.titulo') }}</h1>
    <p>{{ t('faturamento.orcamentos.texto') }}</p>
    <p>
      <RouterLink to="/faturamento/particular/caixa">{{ t('faturamento.caixa.titulo') }}</RouterLink>
    </p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('particular')" />
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="orc-mensagem" />
    <form v-if="pode('registrarOrcamento')" @submit.prevent="gravar">
      <div class="filtros">
        <span class="campo"
          ><label for="orc-pront">{{ t('faturamento.orcamentos.prontuario') }}</label
          ><input id="orc-pront" v-model="novo.prontuario" inputmode="numeric" size="8"
        /></span>
        <span class="campo"
          ><label for="orc-nome">{{ t('faturamento.paciente') }}</label
          ><input id="orc-nome" v-model="novo.nome" maxlength="80" data-testid="orc-nome"
        /></span>
      </div>
      <div v-for="(i, k) in novo.itens" :key="k" class="filtros">
        <span class="campo"
          ><label :for="`orc-desc-${k}`">{{ t('faturamento.orcamentos.descricao') }}</label
          ><input :id="`orc-desc-${k}`" v-model="i.descricao" maxlength="80" :data-testid="`orc-desc-${k}`"
        /></span>
        <span class="campo"
          ><label :for="`orc-qtd-${k}`">{{ t('faturamento.quantidade') }}</label
          ><input :id="`orc-qtd-${k}`" v-model="i.quantidade" inputmode="decimal" size="5"
        /></span>
        <span class="campo"
          ><label :for="`orc-unit-${k}`">{{ t('faturamento.unitario') }}</label
          ><input
            :id="`orc-unit-${k}`"
            v-model="i.unitario"
            inputmode="decimal"
            size="8"
            :data-testid="`orc-unit-${k}`"
        /></span>
      </div>
      <div class="filtros">
        <button type="button" @click="novo.itens.push({ descricao: '', quantidade: '1', unitario: '' })">
          {{ t('faturamento.orcamentos.maisItem') }}
        </button>
        <span class="campo"
          ><label for="orc-desconto">{{ t('faturamento.orcamentos.desconto') }}</label
          ><input id="orc-desconto" v-model="novo.desconto" inputmode="decimal" size="8"
        /></span>
        <span class="campo"
          ><label for="orc-validade">{{ t('faturamento.orcamentos.validade') }}</label
          ><input id="orc-validade" v-model="novo.validadeDias" inputmode="numeric" size="4"
        /></span>
        <label
          ><input v-model="novo.urgencia" type="checkbox" data-testid="orc-urgencia" />
          {{ t('faturamento.orcamentos.urgencia') }}</label
        >
        <label
          ><input v-model="novo.garantia" type="checkbox" data-testid="orc-garantia" />
          {{ t('faturamento.orcamentos.garantia') }}</label
        >
        <span>{{ t('faturamento.total') }} {{ reais(totalPrevisto) }}</span>
        <button type="submit" data-testid="orc-gravar">{{ t('faturamento.orcamentos.novo') }}</button>
      </div>
    </form>
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('faturamento.carregando') }}</p>
    <table v-else class="tabela" data-testid="orc-lista">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">{{ t('faturamento.paciente') }}</th>
          <th scope="col">{{ t('faturamento.total') }}</th>
          <th scope="col">{{ t('faturamento.orcamentos.pago') }}</th>
          <th scope="col">{{ t('faturamento.orcamentos.validoAte') }}</th>
          <th scope="col">{{ t('faturamento.situacao') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="q.data.value.length === 0">
          <td colspan="6">{{ t('faturamento.nenhum') }}</td>
        </tr>
        <tr v-for="o in q.data.value" :key="o.id" :data-testid="`orc-${o.id}`">
          <td>{{ o.id }}</td>
          <td>{{ o.nome }}</td>
          <td>{{ reais(o.total) }}</td>
          <td>{{ reais(o.pago) }}</td>
          <td>{{ data(o.validoAte) }}</td>
          <td :data-testid="`orc-situacao-${o.id}`">
            {{ t(`faturamento.orcamentos.situacoes.${o.situacao}`) }}
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
