<script setup lang="ts">
// Movimento bancário, saldos e caixa (ficha do M32, seção 7): `/financeiro/tesouraria/movimento`. Só as contas do
// escopo do usuário (o servidor recusa as outras); o saldo calculado (o último fechamento mais os lançamentos) ao lado
// do apurado no fechamento; o lançamento de tarifa, fechamento de caixa, transferência, crédito e débito avulsos.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { lancarMovimento, lerMovimento, novaChave } from '../api-financeiro.js';
import {
  data,
  lerClassificacao,
  opcoesClassificacao,
  opcoesContas,
  reais,
  somarDias,
  usarFinanceiro,
} from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivo, motivoFuncionalidade } = usarFinanceiro();
const filtro = reactive({ conta: '', de: '', ate: '' });
watch(
  () => apoio.data.value,
  (a) => {
    if (!a) return;
    if (!filtro.de) {
      filtro.de = somarDias(a.hoje, -30);
      filtro.ate = a.hoje;
    }
    if (!filtro.conta && a.contas[0]) filtro.conta = String(a.contas[0].id);
  },
  { immediate: true },
);
const pedido = ref<{ conta: string; de: string; ate: string } | null>(null);
watch(
  () => filtro.conta,
  (c) => {
    if (c && !pedido.value) pedido.value = { ...filtro };
  },
  { immediate: true },
);
const movimento = useQuery({
  queryKey: computed(() => ['financeiro', 'movimento', pedido.value]),
  queryFn: () => lerMovimento(pedido.value ?? {}),
  enabled: computed(() => pedido.value !== null),
});
const contas = computed(() => opcoesContas(apoio.data.value?.contas));
const contasOuNenhuma = computed(() => opcoesContas(apoio.data.value?.contas, t('financeiro.nenhum')));
const contaEscolhida = computed(() =>
  apoio.data.value?.contas.find((c) => String(c.id) === pedido.value?.conta),
);
const tipos = computed(() =>
  (['O', 'F', 'T', 'C', 'D'] as const).map((x) => ({
    valor: x,
    rotulo: t(`financeiro.movimento.tipos.${x}`),
  })),
);
const classificacoes = computed(() =>
  opcoesClassificacao(apoio.data.value?.classificacoes, t('financeiro.escolha')),
);
const novo = reactive({
  tipo: 'O',
  data: '',
  contaCredito: '',
  contaDebito: '',
  valor: '',
  historico: '',
  classificacao: '',
});
watch(
  () => apoio.data.value?.hoje,
  (h) => {
    if (h && !novo.data) novo.data = h;
  },
  { immediate: true },
);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
let chave = novaChave('movimento');
async function lancar() {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    const r = await lancarMovimento(
      {
        tipo: novo.tipo,
        data: novo.data,
        contaCredito: novo.contaCredito ? Number(novo.contaCredito) : null,
        contaDebito: novo.contaDebito ? Number(novo.contaDebito) : null,
        valor: Number(String(novo.valor).replace(',', '.')),
        historico: novo.historico,
        classificacao: lerClassificacao(novo.classificacao),
      },
      chave,
    );
    mensagem.value = r.mensagem;
    chave = novaChave('movimento');
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="mv-titulo" data-testid="tela-fin-movimento">
    <h1 id="mv-titulo">{{ t('financeiro.movimento.titulo') }}</h1>
    <p>{{ t('financeiro.movimento.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('tesouraria')" />
    <form class="filtros" @submit.prevent="pedido = { ...filtro }">
      <span class="campo">
        <SanteSelecao
          v-model="filtro.conta"
          :rotulo="t('financeiro.conta')"
          :opcoes="contas"
          data-testid="mv-conta"
        />
      </span>
      <span class="campo">
        <label for="mv-de">{{ t('financeiro.de') }}</label>
        <input id="mv-de" v-model="filtro.de" type="date" data-testid="mv-de" />
      </span>
      <span class="campo">
        <label for="mv-ate">{{ t('financeiro.ate') }}</label>
        <input id="mv-ate" v-model="filtro.ate" type="date" data-testid="mv-ate" />
      </span>
      <button type="submit" data-testid="mv-consultar">{{ t('financeiro.consultar') }}</button>
    </form>
    <dl v-if="contaEscolhida" class="resumo" data-testid="mv-saldo">
      <dt>{{ t('financeiro.movimento.saldo') }}</dt>
      <dd>{{ reais(contaEscolhida.saldo) }}</dd>
      <template v-if="contaEscolhida.saldoFechadoEm">
        <dt>{{ t('financeiro.movimento.saldoFechado', { em: data(contaEscolhida.saldoFechadoEm) }) }}</dt>
        <dd>
          {{
            contaEscolhida.saldoApuradoOutroSistema === null
              ? '—'
              : reais(contaEscolhida.saldoApuradoOutroSistema)
          }}
        </dd>
      </template>
    </dl>
    <ErroFaturamento v-if="movimento.error.value" :erro="movimento.error.value" />
    <table v-else-if="movimento.data.value?.length" class="tabela" data-testid="mv-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.data') }}</th>
          <th scope="col">{{ t('financeiro.documento') }}</th>
          <th scope="col">{{ t('financeiro.tipo') }}</th>
          <th scope="col">{{ t('financeiro.historico') }}</th>
          <th scope="col">{{ t('financeiro.movimento.credito') }}</th>
          <th scope="col">{{ t('financeiro.movimento.debito') }}</th>
          <th scope="col">{{ t('financeiro.valor') }}</th>
          <th scope="col">{{ t('financeiro.usuario') }}</th>
          <th scope="col">{{ t('financeiro.gestao.reclassificar.titulo') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in movimento.data.value" :key="m.id">
          <td>{{ data(m.data) }}</td>
          <td>{{ m.documento }}</td>
          <td>{{ m.rotuloTipo }}</td>
          <td>{{ m.historico }}</td>
          <td>{{ m.contaCredito ?? '—' }}</td>
          <td>{{ m.contaDebito ?? '—' }}</td>
          <td>{{ reais(m.valor) }}</td>
          <td>{{ m.usuario }}</td>
          <td>
            <RouterLink
              :to="`/financeiro/gerencial/reclassificar?alvo=movimento_bancario&id=${m.id}`"
              :data-testid="`mv-reclassificar-${m.id}`"
              >{{ t('financeiro.gestao.reclassificar.titulo') }}</RouterLink
            >
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="movimento.data.value">{{ t('financeiro.nenhum') }}</p>

    <form class="formulario" data-testid="mv-formulario" @submit.prevent="lancar">
      <h2>{{ t('financeiro.movimento.lancar') }}</h2>
      <span class="campo">
        <SanteSelecao
          v-model="novo.tipo"
          :rotulo="t('financeiro.tipo')"
          :opcoes="tipos"
          data-testid="mv-novo-tipo"
        />
      </span>
      <span class="campo">
        <label for="mv-novo-data">{{ t('financeiro.data') }}</label>
        <input id="mv-novo-data" v-model="novo.data" type="date" required data-testid="mv-novo-data" />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="novo.contaCredito"
          :rotulo="t('financeiro.movimento.contaCredito')"
          :opcoes="contasOuNenhuma"
          data-testid="mv-novo-credito"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="novo.contaDebito"
          :rotulo="t('financeiro.movimento.contaDebito')"
          :opcoes="contasOuNenhuma"
          data-testid="mv-novo-debito"
        />
      </span>
      <span class="campo">
        <label for="mv-novo-valor">{{ t('financeiro.valor') }}</label>
        <input
          id="mv-novo-valor"
          v-model="novo.valor"
          inputmode="decimal"
          required
          data-testid="mv-novo-valor"
        />
      </span>
      <span class="campo">
        <label for="mv-novo-hist">{{ t('financeiro.historico') }}</label>
        <input
          id="mv-novo-hist"
          v-model="novo.historico"
          maxlength="100"
          required
          data-testid="mv-novo-historico"
        />
      </span>
      <span class="campo">
        <SanteSelecao
          v-model="novo.classificacao"
          :rotulo="t('financeiro.classificacao')"
          :opcoes="classificacoes"
          obrigatorio
          data-testid="mv-novo-classificacao"
        />
      </span>
      <button
        type="submit"
        :disabled="gravando || !pode('financeiro.lancarMovimento')"
        data-testid="mv-lancar"
      >
        {{ t('financeiro.movimento.lancar') }}
      </button>
      <p v-if="!pode('financeiro.lancarMovimento')" class="secundario">
        {{ motivo('financeiro.lancarMovimento') }}
      </p>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="mv-mensagem" />
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
