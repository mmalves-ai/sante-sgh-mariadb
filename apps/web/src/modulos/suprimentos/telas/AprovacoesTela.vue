<script setup lang="ts">
// Aprovação de pedidos por alçada (ficha do M28, seção 7): `/suprimentos/aprovacoes`. A fila por faixa de valor
// (parâmetros das alçadas); aprova quem tem a marca de autorizar pedido e a faixa do valor. A decisão fica no novo
// (com autor, data e justificativa); a situação do pedido no banco não muda (4 e 5 nunca vistos).
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { aprovarPedido, listarAprovacoes, novaChave } from '../api-suprimentos.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { data, reais } from '../usar-suprimentos.js';

const { t } = useI18n();
const cliente = useQueryClient();
const fila = useQuery({ queryKey: ['suprimentos', 'aprovacoes'], queryFn: () => listarAprovacoes() });
const justificativas = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function decidir(p: { id: number; ano: number; doc: number }, decisao: 'aprovado' | 'reprovado') {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await aprovarPedido(
      { ano: p.ano, doc: p.doc },
      { decisao, justificativa: (justificativas.value[p.id] ?? '').trim() },
      novaChave('aprovacao'),
    );
    mensagem.value = r.mensagem;
    await cliente.invalidateQueries({ queryKey: ['suprimentos'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="apr-titulo" data-testid="tela-suprimentos-aprovacoes">
    <h1 id="apr-titulo">{{ t('suprimentos.aprovacoes.titulo') }}</h1>
    <p>{{ t('suprimentos.aprovacoes.texto') }}</p>
    <ErroSuprimentos v-if="fila.error.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('suprimentos.carregando') }}</p>
    <p v-else-if="fila.data.value.length === 0">{{ t('suprimentos.aprovacoes.vazia') }}</p>
    <div v-for="p in fila.data.value ?? []" :key="p.id" class="painel" :data-testid="`apr-${p.ano}-${p.doc}`">
      <h2>{{ t('suprimentos.pedidos.numero') }} {{ p.doc }}/{{ p.ano }} · {{ data(p.data) }}</h2>
      <p>
        {{ p.centroCustoNome }} · {{ reais(p.valor.total) }}
        <template v-if="p.valor.parcelas.length > 1"
          >({{ p.valor.parcelas.map(reais).join(' + ') }})</template
        >
        · {{ t('suprimentos.aprovacoes.faixa', { n: p.faixa.nivel }) }}
        <template v-if="p.faixa.ate !== null">
          ({{ t('suprimentos.aprovacoes.ate', { v: reais(p.faixa.ate) }) }})</template
        >
      </p>
      <p v-if="p.aprovacao" class="secundario">
        {{
          p.aprovacao.decisao === 'aprovado'
            ? t('suprimentos.aprovacoes.aprovado')
            : t('suprimentos.aprovacoes.reprovado')
        }}
        · {{ p.aprovacao.aprovador }}
      </p>
      <p v-if="!p.podeAprovar && p.motivo" class="secundario">{{ p.motivo }}</p>
      <template v-if="p.podeAprovar">
        <span class="campo">
          <label :for="`apr-just-${p.id}`">{{ t('suprimentos.cotacao.justificativa') }}</label>
          <input
            :id="`apr-just-${p.id}`"
            v-model="justificativas[p.id]"
            :data-testid="`apr-justificativa-${p.doc}`"
          />
        </span>
        <div class="filtros">
          <SanteBotao
            :rotulo="t('suprimentos.aprovacoes.aprovar')"
            :data-testid="`apr-aprovar-${p.doc}`"
            @acionar="decidir(p, 'aprovado')"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="t('suprimentos.aprovacoes.reprovar')"
            @acionar="decidir(p, 'reprovado')"
          />
        </div>
      </template>
    </div>
    <p v-if="mensagem" role="status" data-testid="apr-mensagem">{{ mensagem }}</p>
    <ErroSuprimentos v-if="erro" :erro="erro" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
