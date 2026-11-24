<script setup lang="ts">
// Adiantamentos a fornecedores e médicos (F3.8, 07-FIN linha 67): `/financeiro/pagar/adiantamentos`. Conceder (a saída
// sai da conta na hora), compensar o saldo num título em aberto do MESMO credor (a lista já vem filtrada pelo credor, e o
// valor sugerido é o menor entre o saldo e o título) e registrar a devolução do que sobrou. As regras ficam no domínio;
// a tela só evita o clique inútil.
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AvisoFaturamento from '../../faturamento/componentes/AvisoFaturamento.vue';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  compensarAdiantamento,
  concederAdiantamento,
  devolverAdiantamento,
  listarAdiantamentos,
  listarTitulosPagar,
  novaChave,
} from '../api-financeiro.js';
import { data, opcoesContas, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t, te } = useI18n();
const qc = useQueryClient();
const { apoio, pode, motivoFuncionalidade } = usarFinanceiro();
const hoje = () => new Date().toISOString().slice(0, 10);
const lista = useQuery({ queryKey: ['financeiro', 'adiantamentos'], queryFn: () => listarAdiantamentos() });
const contas = computed(() => opcoesContas(apoio.data.value?.contas));
const tipos = computed(() => [
  { valor: 'fornecedor', rotulo: t('financeiro.adiantamentos.fornecedor') },
  { valor: 'profissional', rotulo: t('financeiro.adiantamentos.profissional') },
]);
const novo = reactive({
  tipoCredor: 'fornecedor',
  credor: '',
  conta: '',
  valor: '',
  prazo: '',
  referente: '',
});
watch(
  () => apoio.data.value?.contas,
  (cs) => {
    if (cs?.[0] && !novo.conta) novo.conta = String(cs[0].id);
  },
  { immediate: true },
);
const novoValido = computed(
  () => Number(novo.credor) > 0 && Number(novo.valor) > 0 && !!novo.conta && novo.referente.trim().length > 0,
);

const aberto = ref<number | null>(null);
const escolhido = computed(() => lista.data.value?.find((a) => a.id === aberto.value) ?? null);
const titulos = useQuery({
  queryKey: computed(() => ['financeiro', 'adiantamentos', 'titulos', escolhido.value?.credor ?? 0]),
  queryFn: () => listarTitulosPagar({ credor: String(escolhido.value?.credor ?? ''), situacao: 'aberto' }),
  enabled: computed(() => !!escolhido.value && escolhido.value.saldo > 0),
});
const abertos = computed(() => (titulos.data.value?.itens ?? []).filter((x) => x.valor - x.pago > 0));
const uso = reactive({ valor: '', conta: '', motivo: '' });
function abrir(id: number) {
  aberto.value = aberto.value === id ? null : id;
  const a = lista.data.value?.find((x) => x.id === id);
  uso.valor = a ? String(a.saldo) : '';
  uso.conta = novo.conta;
  uso.motivo = '';
}
const sugerido = (saldoTitulo: number) => Math.min(saldoTitulo, escolhido.value?.saldo ?? 0);
const rotuloSituacao = (s: string) =>
  te(`financeiro.adiantamentos.situacoes.${s}`) ? t(`financeiro.adiantamentos.situacoes.${s}`) : s;

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function gravar(f: () => Promise<{ mensagem: string }>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await f()).mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const conceder = () =>
  gravar(async () => {
    const r = await concederAdiantamento(
      {
        tipoCredor: novo.tipoCredor as 'fornecedor' | 'profissional',
        credor: Number(novo.credor),
        conta: Number(novo.conta),
        valor: Number(novo.valor),
        data: hoje(),
        prazo: novo.prazo || null,
        referente: novo.referente.trim(),
      },
      novaChave('adiantamento'),
    );
    Object.assign(novo, { credor: '', valor: '', prazo: '', referente: '' });
    return r;
  });
const compensar = (id: number, parcela: number, saldoTitulo: number) =>
  gravar(() =>
    compensarAdiantamento(
      id,
      { parcela, valor: sugerido(saldoTitulo), data: hoje() },
      novaChave('compensar'),
    ),
  );
const devolver = (id: number) =>
  gravar(() =>
    devolverAdiantamento(
      id,
      { conta: Number(uso.conta), valor: Number(uso.valor), data: hoje(), motivo: uso.motivo.trim() },
      novaChave('devolver'),
    ),
  );
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ad-titulo" data-testid="tela-fin-adiantamentos">
    <h1 id="ad-titulo">{{ t('financeiro.adiantamentos.titulo') }}</h1>
    <p>{{ t('financeiro.adiantamentos.texto') }}</p>
    <AvisoFaturamento :motivo="motivoFuncionalidade('contasPagar')" />

    <fieldset v-if="pode('concederAdiantamento')" class="filtros" data-testid="ad-novo">
      <legend>{{ t('financeiro.adiantamentos.novo') }}</legend>
      <SanteSelecao
        v-model="novo.tipoCredor"
        :rotulo="t('financeiro.adiantamentos.tipoCredor')"
        :opcoes="tipos"
        data-testid="ad-novo-tipo"
      />
      <label class="campo">
        {{ t('financeiro.adiantamentos.credor') }}
        <input v-model="novo.credor" inputmode="numeric" data-testid="ad-novo-credor" />
      </label>
      <SanteSelecao
        v-model="novo.conta"
        :rotulo="t('financeiro.conta')"
        :opcoes="contas"
        data-testid="ad-novo-conta"
      />
      <label class="campo">
        {{ t('financeiro.valor') }}
        <input v-model="novo.valor" type="number" min="0.01" step="0.01" data-testid="ad-novo-valor" />
      </label>
      <label class="campo">
        {{ t('financeiro.adiantamentos.prazo') }}
        <input v-model="novo.prazo" type="date" :min="hoje()" data-testid="ad-novo-prazo" />
      </label>
      <label class="campo">
        {{ t('financeiro.adiantamentos.referente') }}
        <input v-model="novo.referente" maxlength="250" data-testid="ad-novo-referente" />
      </label>
      <button type="button" :disabled="gravando || !novoValido" data-testid="ad-conceder" @click="conceder">
        {{ t('financeiro.adiantamentos.conceder') }}
      </button>
    </fieldset>

    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="ad-mensagem" />

    <ErroFaturamento v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="lista.isLoading.value">{{ t('financeiro.carregando') }}</p>
    <table v-else-if="lista.data.value?.length" class="tabela" data-testid="ad-lista">
      <thead>
        <tr>
          <th scope="col">{{ t('financeiro.documento') }}</th>
          <th scope="col">{{ t('financeiro.credor') }}</th>
          <th scope="col">{{ t('financeiro.tipo') }}</th>
          <th scope="col">{{ t('financeiro.emissao') }}</th>
          <th scope="col">{{ t('financeiro.adiantamentos.referente') }}</th>
          <th scope="col">{{ t('financeiro.valor') }}</th>
          <th scope="col">{{ t('financeiro.adiantamentos.compensado') }}</th>
          <th scope="col">{{ t('financeiro.adiantamentos.saldo') }}</th>
          <th scope="col">{{ t('financeiro.adiantamentos.situacao') }}</th>
          <th scope="col">{{ t('financeiro.adiantamentos.compensar') }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="a in lista.data.value" :key="a.id">
          <tr>
            <td>{{ a.numero }}</td>
            <td>{{ a.credor }}</td>
            <td>{{ t(`financeiro.adiantamentos.${a.tipoCredor}`) }}</td>
            <td>{{ data(a.emissao) }}</td>
            <td>{{ a.referente }}</td>
            <td>{{ reais(a.valor) }}</td>
            <td>{{ reais(a.compensado) }}</td>
            <td>{{ reais(a.saldo) }}</td>
            <td>{{ rotuloSituacao(a.situacao) }}</td>
            <td>
              <button
                v-if="a.saldo > 0 && pode('compensarAdiantamento')"
                type="button"
                :aria-expanded="aberto === a.id"
                :data-testid="`ad-usar-${a.id}`"
                @click="abrir(a.id)"
              >
                {{ t('financeiro.adiantamentos.compensar') }}
              </button>
            </td>
          </tr>
          <tr v-if="aberto === a.id">
            <td colspan="10" :data-testid="`ad-painel-${a.id}`">
              <p>{{ t('financeiro.adiantamentos.titulosDoCredor') }}</p>
              <ul v-if="abertos.length" data-testid="ad-titulos">
                <li v-for="x in abertos" :key="x.id">
                  {{ x.documento }}/{{ x.parcela }} · {{ data(x.vencimento) }} · {{ reais(x.valor - x.pago) }}
                  <button
                    type="button"
                    :disabled="gravando"
                    :data-testid="`ad-compensar-${x.id}`"
                    @click="compensar(a.id, x.id, x.valor - x.pago)"
                  >
                    {{ t('financeiro.adiantamentos.compensar') }} {{ reais(sugerido(x.valor - x.pago)) }}
                  </button>
                </li>
              </ul>
              <p v-else-if="!titulos.isLoading.value">{{ t('financeiro.adiantamentos.semTitulos') }}</p>
              <fieldset class="filtros">
                <legend>{{ t('financeiro.adiantamentos.devolver') }}</legend>
                <SanteSelecao
                  v-model="uso.conta"
                  :rotulo="t('financeiro.conta')"
                  :opcoes="contas"
                  data-testid="ad-dev-conta"
                />
                <label class="campo">
                  {{ t('financeiro.valor') }}
                  <input
                    v-model="uso.valor"
                    type="number"
                    min="0.01"
                    :max="a.saldo"
                    step="0.01"
                    data-testid="ad-dev-valor"
                  />
                </label>
                <label class="campo">
                  {{ t('financeiro.adiantamentos.motivo') }}
                  <input v-model="uso.motivo" maxlength="250" data-testid="ad-dev-motivo" />
                </label>
                <button
                  type="button"
                  :disabled="
                    gravando || !uso.motivo.trim() || !(Number(uso.valor) > 0) || Number(uso.valor) > a.saldo
                  "
                  data-testid="ad-devolver"
                  @click="devolver(a.id)"
                >
                  {{ t('financeiro.adiantamentos.devolver') }}
                </button>
              </fieldset>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <p v-else>{{ t('financeiro.nenhum') }}</p>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
