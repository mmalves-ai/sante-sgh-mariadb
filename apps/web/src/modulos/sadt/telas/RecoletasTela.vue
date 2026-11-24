<script setup lang="ts">
// Recoleta e alíquotas (F3.5, 05-SADT linha 7): pela etiqueta, o laboratório pede a recoleta com o motivo (a amostra
// original fica rejeitada e ligada à nova) ou gera as alíquotas pelas regras do exame. A lista mostra as recoletas em
// aberto, com coletar e cancelar.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  cancelarRecoleta,
  coletarRecoleta,
  gerarAliquotas,
  lerMotivosPedido,
  listarRecoletas,
  pedirRecoleta,
} from '../api-pedido.js';
import { lerAmostraPorCodigo, novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';
import { quando } from '../usar-sadt.js';

const { t } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({ queryKey: ['sadt', 'recoletas'], queryFn: listarRecoletas });
const motivos = useQuery({ queryKey: ['sadt', 'pedido', 'motivos'], queryFn: lerMotivosPedido });
const opcoes = computed(() => [
  { valor: '', rotulo: t('sadt.pedido.escolha') },
  ...(motivos.data.value?.recoleta ?? []).map((m) => ({ valor: String(m.id), rotulo: m.descricao })),
]);
const codigo = ref('');
const motivo = ref('');
const motivoCancelar = ref<Record<number, string>>({});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const atualizar = () => cliente.invalidateQueries({ queryKey: ['sadt', 'recoletas'] });

async function executar(fn: () => Promise<string>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = await fn();
    await atualizar();
  } catch (x) {
    erro.value = x;
  }
}
const amostraDoCodigo = async () => (await lerAmostraPorCodigo(codigo.value.trim())).id;
const pedir = () =>
  executar(async () => {
    const r = await pedirRecoleta(await amostraDoCodigo(), Number(motivo.value), novaChave('recoleta.pedir'));
    return t('sadt.pedido.pedida', { numero: r.numero });
  });
const aliquotar = () =>
  executar(async () => {
    const r = await gerarAliquotas(await amostraDoCodigo(), novaChave('amostra.aliquotar'));
    return t('sadt.pedido.aliquotas', {
      n: r.subamostras.length,
      codigos: r.subamostras.map((s) => s.codigo).join(', '),
    });
  });
const coletar = (id: number) =>
  executar(async () =>
    t('sadt.pedido.coletada', { codigo: (await coletarRecoleta(id, novaChave('recoleta.coletar'))).codigo }),
  );
const cancelar = (id: number) =>
  executar(async () => {
    await cancelarRecoleta(id, motivoCancelar.value[id] ?? '', novaChave('recoleta.cancelar'));
    return t('sadt.pedido.situacoes.cancelada');
  });
</script>

<template>
  <section class="recoletas" data-testid="recoletas">
    <h1>{{ t('sadt.pedido.recoletas') }}</h1>
    <div class="linha">
      <label for="recoleta-codigo">{{ t('sadt.pedido.codigoAmostra') }}</label>
      <input id="recoleta-codigo" v-model="codigo" data-testid="recoleta-codigo" />
      <SanteSelecao
        v-model="motivo"
        :rotulo="t('sadt.pedido.motivo')"
        :opcoes="opcoes"
        data-testid="recoleta-motivo"
      />
      <SanteBotao :disabled="!codigo || !motivo" data-testid="recoleta-pedir" @click="pedir">
        {{ t('sadt.pedido.pedirRecoleta') }}
      </SanteBotao>
      <SanteBotao :disabled="!codigo" data-testid="recoleta-aliquotar" @click="aliquotar">
        {{ t('sadt.pedido.gerarAliquotas') }}
      </SanteBotao>
    </div>
    <p v-if="mensagem" role="status" data-testid="recoleta-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
    <ErroSadt v-if="lista.isError.value" :erro="lista.error.value" />
    <h2>{{ t('sadt.pedido.abertas') }}</h2>
    <p v-if="(lista.data.value?.itens ?? []).length === 0">{{ t('sadt.pedido.nenhuma') }}</p>
    <article v-for="r in lista.data.value?.itens ?? []" :key="r.id" :data-testid="`recoleta-${r.id}`">
      <p>
        {{ r.numero }} · {{ t(`sadt.pedido.situacoes.${r.situacao}`) }} · {{ r.motivo }} ·
        {{ t('sadt.pedido.original') }} {{ r.codigoOriginal }} · {{ quando(r.solicitadaEm) }}
      </p>
      <SanteBotao @click="coletar(r.id)">{{ t('sadt.pedido.coletar') }}</SanteBotao>
      <input v-model="motivoCancelar[r.id]" :aria-label="t('sadt.pedido.motivo')" maxlength="500" />
      <SanteBotao :disabled="(motivoCancelar[r.id] ?? '').trim().length < 5" @click="cancelar(r.id)">
        {{ t('sadt.pedido.cancelarRecoleta') }}
      </SanteBotao>
    </article>
  </section>
</template>

<style scoped>
.recoletas {
  display: grid;
  gap: 0.75rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
</style>
