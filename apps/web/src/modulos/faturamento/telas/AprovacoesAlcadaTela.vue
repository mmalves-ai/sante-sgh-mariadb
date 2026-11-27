<script setup lang="ts">
// Aprovações de alçada do faturamento (C1-135, 06-FAT linha 38) — `Faturamento > Contas do paciente > Aprovações de
// alçada`. Quem precisa reabrir a competência com contas apresentadas, aceitar a glosa ou cancelar a conta pede aqui;
// outro usuário, com a alçada vigente do documento para o valor, aprova ou recusa (com motivo). O servidor confere a
// alçada pelo domínio e recusa quem pede tentando aprovar; o fluxo do documento consome a aprovação uma vez.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { novaChave } from '../../exames/api-exames.js';
import {
  decidirAlcada,
  DOCUMENTOS_ALCADA,
  type DocumentoAlcada,
  lerPedidosAlcada,
  pedirAlcada,
} from '../api-parametros-faturamento.js';

const { t, n } = useI18n();
const P = 'parametrosFaturamento.alcada';
const CHAVE = ['faturamento', 'alcada', 'pedidos'];
const cliente = useQueryClient();
const lista = useQuery({ queryKey: CHAVE, queryFn: lerPedidosAlcada });

const f = reactive({
  documento: 'fat_reabertura_competencia' as DocumentoAlcada,
  referencia: '' as string | number,
  valor: '' as string | number,
  motivo: '',
});
const opDocumentos = computed(() =>
  DOCUMENTOS_ALCADA.map((d) => ({ valor: d, rotulo: t(`${P}.documentos.${d}`) })),
);
const valido = computed(
  () =>
    Number(f.referencia) > 0 &&
    Number.isFinite(Number(f.valor)) &&
    String(f.valor).trim() !== '' &&
    Number(f.valor) >= 0 &&
    f.motivo.trim().length >= 3,
);
const aviso = ref<string | null>(null);
let chavePedido = novaChave('alcada-pedido');
const pedir = useMutation({
  mutationFn: () =>
    pedirAlcada(
      {
        documento: f.documento,
        referencia: Number(f.referencia),
        valor: Number(f.valor),
        motivo: f.motivo.trim(),
      },
      chavePedido,
    ),
  onSuccess: async () => {
    aviso.value = t(`${P}.pedido`);
    chavePedido = novaChave('alcada-pedido');
    f.referencia = '';
    f.valor = '';
    f.motivo = '';
    await cliente.invalidateQueries({ queryKey: CHAVE });
  },
});

const motivos = reactive<Record<number, string>>({});
const decidir = useMutation({
  mutationFn: (p: { pedido: number; aprovar: boolean }) => {
    const motivo = (motivos[p.pedido] ?? '').trim();
    return decidirAlcada(
      p.pedido,
      { aprovar: p.aprovar, ...(motivo ? { motivo } : {}) },
      novaChave('alcada-decisao'),
    );
  },
  onSuccess: async () => {
    aviso.value = t(`${P}.decidido`);
    await cliente.invalidateQueries({ queryKey: CHAVE });
  },
});
const brl = (v: number) => n(v, { style: 'currency', currency: 'BRL' });
</script>

<template>
  <section class="tela" aria-labelledby="alcada-faturamento-titulo" data-testid="tela-alcada-faturamento">
    <h1 id="alcada-faturamento-titulo">{{ t(`${P}.titulo`) }}</h1>
    <p class="ajuda">{{ t(`${P}.explicacao`) }}</p>

    <h2>{{ t(`${P}.novo`) }}</h2>
    <form class="formulario" data-testid="alcada-pedido-form" @submit.prevent="valido && pedir.mutate()">
      <SanteSelecao
        v-model="f.documento"
        :rotulo="t(`${P}.documento`)"
        :opcoes="opDocumentos"
        data-testid="alcada-documento"
      />
      <label
        >{{ t(`${P}.referencia`) }}
        <input
          v-model="f.referencia"
          type="number"
          min="1"
          inputmode="numeric"
          data-testid="alcada-referencia"
        />
      </label>
      <label
        >{{ t(`${P}.valor`) }}
        <input v-model="f.valor" type="number" min="0" step="0.01" data-testid="alcada-valor" />
      </label>
      <label class="largo"
        >{{ t(`${P}.motivo`) }}
        <input v-model="f.motivo" type="text" maxlength="250" data-testid="alcada-motivo" />
      </label>
      <SanteBotao
        :rotulo="t(`${P}.pedir`)"
        tipo="submit"
        :desabilitado="!valido || pedir.isPending.value"
        data-testid="alcada-pedir"
      />
    </form>
    <MensagemErro v-if="pedir.isError.value" :erro="pedir.error.value" />
    <MensagemErro v-if="decidir.isError.value" :erro="decidir.error.value" />
    <p v-if="aviso" role="status" data-testid="alcada-aviso">{{ aviso }}</p>

    <h2>{{ t(`${P}.lista`) }}</h2>
    <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="lista.data.value && !lista.data.value.length" data-testid="alcada-vazio">
      {{ t(`${P}.vazio`) }}
    </p>
    <table v-else-if="lista.data.value" class="tabela" data-testid="alcada-lista">
      <thead>
        <tr>
          <th>{{ t(`${P}.colunas.documento`) }}</th>
          <th>{{ t(`${P}.colunas.valor`) }}</th>
          <th>{{ t(`${P}.colunas.solicitante`) }}</th>
          <th>{{ t(`${P}.colunas.situacao`) }}</th>
          <th>{{ t(`${P}.colunas.decisao`) }}</th>
          <th>{{ t(`${P}.colunas.acoes`) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in lista.data.value" :key="p.id" :data-testid="`alcada-pedido-${p.id}`">
          <td>
            {{ t(`${P}.numero`, { doc: t(`${P}.documentos.${p.documento}`), ref: p.referencia }) }}
            <div class="ajuda">{{ p.motivo }}</div>
          </td>
          <td>{{ brl(p.valor) }}</td>
          <td>{{ p.solicitanteNome ?? p.solicitante }}</td>
          <td :data-testid="`alcada-situacao-${p.id}`">{{ t(`${P}.situacoes.${p.situacao}`) }}</td>
          <td>
            <template v-if="p.decisor !== null">
              {{ p.decisorNome ?? p.decisor }}
              <span v-if="p.nivel !== null">({{ t(`${P}.nivel`, { n: p.nivel }) }})</span>
              <div v-if="p.motivoDecisao" class="ajuda">{{ p.motivoDecisao }}</div>
            </template>
          </td>
          <td>
            <div v-if="p.situacao === 'pendente'" class="acoes">
              <input
                v-model="motivos[p.id]"
                type="text"
                maxlength="250"
                :aria-label="t(`${P}.motivoRecusa`)"
                :placeholder="t(`${P}.motivoRecusa`)"
                :data-testid="`alcada-motivo-${p.id}`"
              />
              <SanteBotao
                :rotulo="t(`${P}.aprovar`)"
                :desabilitado="decidir.isPending.value"
                :data-testid="`alcada-aprovar-${p.id}`"
                @acionar="decidir.mutate({ pedido: p.id, aprovar: true })"
              />
              <SanteBotao
                :rotulo="t(`${P}.recusar`)"
                variante="secundario"
                :desabilitado="decidir.isPending.value || (motivos[p.id] ?? '').trim().length < 3"
                :data-testid="`alcada-recusar-${p.id}`"
                @acionar="decidir.mutate({ pedido: p.id, aprovar: false })"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.formulario {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
  margin: var(--sgh-espaco-2) 0;
}
.largo {
  flex: 1 1 20rem;
}
.ajuda {
  color: var(--sgh-texto-suave, inherit);
  font-size: 0.9em;
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
</style>
