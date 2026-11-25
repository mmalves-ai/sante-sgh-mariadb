<script setup lang="ts">
// F3.8, 07-FIN linha 89: `/financeiro/receber/cartao`. Dois trabalhos do cartão numa tela só.
// A receber: as parcelas que as administradoras vão creditar, pela data prevista; marca-se o que caiu na conta e a
// baixa lança UM crédito (a conta sugerida é a do cadastro da administradora; a diferença para o previsto aparece na
// hora, antes de gravar). Um crédito é de uma administradora só: as parcelas das outras ficam presas enquanto houver
// marcação.
// Taxas: por administradora, bandeira, modalidade e faixa de parcelas, com vigência. A taxa digitada é conferida a
// cada tecla pela regra do domínio, a tela diz qual taxa de hoje ela substitui (a antiga fica no histórico) e mostra
// quanto uma venda de exemplo renderia com ela, antes de gravar.
import {
  conferirTaxaAdministradora,
  gerarParcelasRecebivel,
  type ModalidadeCartao,
  type NovaTaxaAdministradora,
  planejarVigenciaTaxa,
  repartirCreditoCartao,
} from '@sgh/dominio-financeiro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  baixarRecebiveis,
  encerrarTaxa,
  gravarAdministradora,
  gravarTaxa,
  lerAdministradoras,
  lerRecebiveis,
  lerTaxas,
  type RecebivelCartao,
  type TaxaCartao,
} from '../api-cartao.js';
import { novaChave } from '../api-financeiro.js';
import { data, numero, opcoesContas, reais, somarDias, usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { apoio, tem } = usarFinanceiro();
const hoje = new Date().toISOString().slice(0, 10);
type Aba = 'receber' | 'taxas';
const ABAS = computed<Aba[]>(() => (tem('financeiro.cadastro.ler') ? ['receber', 'taxas'] : ['receber']));
const aba = ref<Aba>('receber');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function gravar(fn: () => Promise<{ mensagem: string }>, depois?: () => void) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
    depois?.();
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
function trocarAba(a: Aba) {
  aba.value = a;
  erro.value = null;
  mensagem.value = null;
}
const contas = computed(() => opcoesContas(apoio.data.value?.contas, t('financeiro.escolha')));

// ── A receber ──
const SITUACOES = ['prevista', 'recebida', 'conciliada', 'cancelada', 'contestada'] as const;
const filtro = reactive({ de: somarDias(hoje, -30), ate: somarDias(hoje, 60), situacao: 'prevista' });
const pedido = ref({ ...filtro });
const recebiveis = useQuery({
  queryKey: computed(() => ['financeiro', 'cartao', 'recebiveis', pedido.value]),
  queryFn: () => lerRecebiveis(pedido.value),
});
const opcoesSituacao = computed(() => [
  { valor: '', rotulo: t('financeiro.cartao.situacoes.todas') },
  ...SITUACOES.map((s) => ({ valor: s as string, rotulo: t(`financeiro.cartao.situacoes.${s}`) })),
]);
const marcadas = ref<number[]>([]);
const baixa = reactive({ conta: '', dataCredito: hoje, valorCreditado: '' });
const escolhidas = computed(() =>
  (recebiveis.data.value ?? []).filter((p) => marcadas.value.includes(p.id) && p.situacao === 'prevista'),
);
const administradoraMarcada = computed(() => escolhidas.value[0]?.administradora ?? null);
const presa = (p: RecebivelCartao) =>
  p.situacao !== 'prevista' ||
  (administradoraMarcada.value !== null && p.administradora !== administradoraMarcada.value);
const previsto = computed(() => Math.round(escolhidas.value.reduce((s, p) => s + p.liquido * 100, 0)) / 100);
watch(administradoraMarcada, () => {
  // A conta do cadastro da administradora já vem escolhida.
  const sugerida = escolhidas.value[0]?.contaSugerida;
  if (sugerida && !baixa.conta) baixa.conta = String(sugerida);
});
watch(
  () => recebiveis.data.value,
  (lista) => {
    const previstas = new Set((lista ?? []).filter((p) => p.situacao === 'prevista').map((p) => p.id));
    marcadas.value = marcadas.value.filter((id) => previstas.has(id));
  },
);
/** A diferença para o previsto, conferida na hora pela regra do domínio. */
const credito = computed(() => {
  if (!escolhidas.value.length) return null;
  const valor = baixa.valorCreditado.trim() ? numero(baixa.valorCreditado) : previsto.value;
  return repartirCreditoCartao(
    escolhidas.value.map((p) => p.liquido),
    valor,
  );
});
const podeBaixar = computed(
  () =>
    tem('financeiro.conciliacao.conciliar') &&
    !gravando.value &&
    credito.value !== null &&
    !('recusa' in credito.value) &&
    Number(baixa.conta) > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(baixa.dataCredito),
);
const baixar = () =>
  gravar(
    () =>
      baixarRecebiveis(
        {
          parcelas: escolhidas.value.map((p) => p.id),
          conta: Number(baixa.conta),
          dataCredito: baixa.dataCredito,
          valorCreditado: baixa.valorCreditado.trim() ? numero(baixa.valorCreditado) : null,
        },
        novaChave('baixa-cartao'),
      ),
    () => {
      marcadas.value = [];
      baixa.valorCreditado = '';
    },
  );

// ── Taxas ──
const cadastro = useQuery({
  queryKey: ['financeiro', 'cartao', 'administradoras'],
  queryFn: () => lerAdministradoras(),
  enabled: computed(() => aba.value === 'taxas'),
});
const administradora = ref('');
watch(
  () => cadastro.data.value,
  (c) => {
    // Uma só administradora: já vem escolhida.
    if (!administradora.value && c?.administradoras.length === 1)
      administradora.value = String(c.administradoras[0]?.id);
  },
);
const opcoesAdministradora = computed(() => [
  { valor: '', rotulo: t('financeiro.escolha') },
  ...(cadastro.data.value?.administradoras ?? []).map((a) => ({ valor: String(a.id), rotulo: a.nome })),
]);
const opcoesBandeira = computed(() => [
  { valor: '', rotulo: t('financeiro.cartao.taxas.todasBandeiras') },
  ...(cadastro.data.value?.bandeiras ?? []).map((b) => ({ valor: String(b.id), rotulo: b.nome })),
]);
const nomeBandeira = (id: number | null) =>
  id === null
    ? t('financeiro.cartao.taxas.todasBandeiras')
    : (cadastro.data.value?.bandeiras.find((b) => b.id === id)?.nome ?? String(id));
const taxas = useQuery({
  queryKey: computed(() => ['financeiro', 'cartao', 'taxas', administradora.value]),
  queryFn: () => lerTaxas(Number(administradora.value)),
  enabled: computed(() => aba.value === 'taxas' && Number(administradora.value) > 0),
});
const MODALIDADES: readonly ModalidadeCartao[] = ['credito', 'debito', 'pre_pago', 'voucher'];
const opcoesModalidade = computed(() =>
  MODALIDADES.map((m) => ({ valor: m as string, rotulo: t(`financeiro.cartao.modalidades.${m}`) })),
);
const opcoesTipo = computed(() =>
  (['percentual', 'valor'] as const).map((x) => ({
    valor: x as string,
    rotulo: t(`financeiro.cartao.taxas.tipos.${x}`),
  })),
);
const nova = reactive({
  bandeira: '',
  modalidade: 'credito',
  parcelaInicial: '1',
  parcelaFinal: '1',
  tipo: 'percentual',
  percentual: '',
  valor: '',
  diasRepasse: '30',
  vigenciaInicio: hoje,
  exemplo: '1000',
});
const parcelado = computed(() => nova.modalidade === 'credito');
/** A taxa como vai ao servidor; fora do crédito a faixa é sempre de 1 a 1 (a tela nem mostra os campos). */
const novaTaxa = computed<NovaTaxaAdministradora>(() => ({
  administradora: Number(administradora.value) || 0,
  bandeira: nova.bandeira ? Number(nova.bandeira) : null,
  modalidade: nova.modalidade as ModalidadeCartao,
  parcelaInicial: parcelado.value ? Number(nova.parcelaInicial) : 1,
  parcelaFinal: parcelado.value ? Number(nova.parcelaFinal) : 1,
  tipo: nova.tipo as 'percentual' | 'valor',
  percentual: nova.tipo === 'percentual' && nova.percentual.trim() ? numero(nova.percentual) : null,
  valor: nova.tipo === 'valor' && nova.valor.trim() ? numero(nova.valor) : null,
  diasRepasse: Number(nova.diasRepasse),
  vigenciaInicio: nova.vigenciaInicio,
}));
const recusaTaxa = computed(() => conferirTaxaAdministradora(novaTaxa.value));
const planoVigencia = computed(() =>
  recusaTaxa.value ? null : planejarVigenciaTaxa(taxas.data.value ?? [], novaTaxa.value),
);
const recusaVigencia = computed(() =>
  planoVigencia.value && 'recusa' in planoVigencia.value ? planoVigencia.value.recusa : null,
);
const substituidas = computed(() =>
  planoVigencia.value && 'encerrar' in planoVigencia.value ? planoVigencia.value.encerrar.length : 0,
);
/** Quanto uma venda de exemplo renderia com a taxa digitada (a mesma conta do recebimento). */
const simulacao = computed(() => {
  if (recusaTaxa.value) return null;
  const r = gerarParcelasRecebivel({
    valor: numero(nova.exemplo),
    parcelas: novaTaxa.value.parcelaFinal,
    dataVenda: novaTaxa.value.vigenciaInicio,
    taxa: { ...novaTaxa.value, id: 0, vigenciaFim: null, ativo: true },
  });
  if ('recusa' in r) return null;
  const soma = (campo: 'bruto' | 'taxa' | 'liquido') =>
    Math.round(r.parcelas.reduce((s, p) => s + p[campo] * 100, 0)) / 100;
  return {
    valor: reais(soma('bruto')),
    parcelas: r.parcelas.length,
    taxa: reais(soma('taxa')),
    liquido: reais(soma('liquido')),
    dias: novaTaxa.value.diasRepasse,
    data: data(r.parcelas[0]?.dataPrevista ?? ''),
  };
});
const podeGravarTaxa = computed(
  () =>
    tem('financeiro.cadastro.editar') &&
    !gravando.value &&
    Number(administradora.value) > 0 &&
    !recusaTaxa.value &&
    !recusaVigencia.value,
);
const enviarTaxa = () =>
  gravar(
    () => gravarTaxa(novaTaxa.value, novaChave('taxa-cartao')),
    () => {
      nova.percentual = '';
      nova.valor = '';
    },
  );
const encerrar = (x: TaxaCartao) => gravar(() => encerrarTaxa(x.id, hoje, novaChave('encerrar-taxa-cartao')));
const situacaoDaTaxa = (x: TaxaCartao) =>
  x.vigente ? 'vale' : x.vigenciaInicio > hoje && x.vigenciaFim === null ? 'futura' : 'encerrada';
const textoDaTaxa = (x: TaxaCartao) =>
  x.tipo === 'percentual' ? `${String(x.percentual ?? 0).replace('.', ',')}%` : reais(x.valor ?? 0);

const adm = reactive({ nome: '', diasParaPagamento: '30', contaBancaria: '', permiteParcelamento: true });
const podeGravarAdministradora = computed(
  () => tem('financeiro.cadastro.editar') && !gravando.value && adm.nome.trim().length >= 2,
);
const enviarAdministradora = () =>
  gravar(
    () =>
      gravarAdministradora(
        {
          nome: adm.nome.trim(),
          diasParaPagamento: Number(adm.diasParaPagamento) || 0,
          contaBancaria: adm.contaBancaria ? Number(adm.contaBancaria) : null,
          permiteParcelamento: adm.permiteParcelamento,
        },
        novaChave('administradora-cartao'),
      ),
    () => {
      adm.nome = '';
    },
  );
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ct-titulo" data-testid="tela-fin-cartao">
    <h1 id="ct-titulo">{{ t('financeiro.cartao.titulo') }}</h1>
    <p>{{ t('financeiro.cartao.texto') }}</p>
    <p v-if="tem('financeiro.fluxoCaixa.ler')">
      <RouterLink to="/financeiro/tesouraria/fluxo-caixa" data-testid="ct-voltar">
        {{ t('financeiro.cartao.voltar') }}
      </RouterLink>
    </p>
    <div class="filtros" role="group" :aria-label="t('financeiro.cartao.titulo')">
      <button
        v-for="a in ABAS"
        :key="a"
        type="button"
        :aria-pressed="aba === a"
        :data-testid="`ct-aba-${a}`"
        @click="trocarAba(a)"
      >
        {{ t(`financeiro.cartao.abas.${a}`) }}
      </button>
    </div>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="ct-mensagem" />

    <template v-if="aba === 'receber'">
      <h2>{{ t('financeiro.cartao.abas.receber') }}</h2>
      <form class="filtros" @submit.prevent="pedido = { ...filtro }">
        <span class="campo">
          <label for="ct-de">{{ t('financeiro.de') }}</label>
          <input id="ct-de" v-model="filtro.de" type="date" required data-testid="ct-de" />
        </span>
        <span class="campo">
          <label for="ct-ate">{{ t('financeiro.ate') }}</label>
          <input id="ct-ate" v-model="filtro.ate" type="date" required data-testid="ct-ate" />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="filtro.situacao"
            :rotulo="t('financeiro.cartao.receber.situacao')"
            :opcoes="opcoesSituacao"
            data-testid="ct-situacao"
          />
        </span>
        <button type="submit" data-testid="ct-buscar">{{ t('financeiro.cartao.receber.buscar') }}</button>
      </form>
      <ErroFaturamento v-if="recebiveis.error.value" :erro="recebiveis.error.value" />
      <table v-if="recebiveis.data.value?.length" class="tabela" data-testid="ct-recebiveis">
        <thead>
          <tr>
            <th scope="col"></th>
            <th scope="col">{{ t('financeiro.cartao.receber.prevista') }}</th>
            <th scope="col">{{ t('financeiro.cartao.receber.administradora') }}</th>
            <th scope="col">{{ t('financeiro.cartao.receber.venda') }}</th>
            <th scope="col">{{ t('financeiro.cartao.receber.parcela') }}</th>
            <th scope="col">{{ t('financeiro.cartao.receber.bruto') }}</th>
            <th scope="col">{{ t('financeiro.cartao.receber.taxa') }}</th>
            <th scope="col">{{ t('financeiro.cartao.receber.liquido') }}</th>
            <th scope="col">{{ t('financeiro.cartao.receber.situacao') }}</th>
            <th scope="col">{{ t('financeiro.cartao.receber.recebido') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in recebiveis.data.value" :key="p.id" :data-testid="`ct-recebivel-${p.id}`">
            <td>
              <input
                v-model="marcadas"
                type="checkbox"
                :value="p.id"
                :disabled="presa(p)"
                :aria-label="t('financeiro.cartao.receber.marcar', { n: p.sequencia, de: p.de, nsu: p.nsu })"
                :data-testid="`ct-marcar-${p.id}`"
              />
            </td>
            <td>{{ data(p.dataPrevista) }}</td>
            <td>{{ p.administradoraNome }} · {{ p.bandeira }}</td>
            <td>{{ data(p.dataVenda) }} · {{ p.nsu }}</td>
            <td>{{ p.sequencia }}/{{ p.de }}</td>
            <td>{{ reais(p.bruto) }}</td>
            <td>{{ reais(p.taxa) }}</td>
            <td>{{ reais(p.liquido) }}</td>
            <td>{{ t(`financeiro.cartao.situacoes.${p.situacao}`) }}</td>
            <td>
              {{ p.valorRecebido === null ? '' : `${reais(p.valorRecebido)} · ${data(p.recebidaEm ?? '')}` }}
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!recebiveis.isPending.value && !recebiveis.error.value" data-testid="ct-nenhuma">
        {{ t('financeiro.cartao.receber.nenhuma') }}
      </p>
      <form
        v-if="tem('financeiro.conciliacao.conciliar')"
        class="filtros"
        data-testid="ct-baixa"
        @submit.prevent="baixar"
      >
        <p data-testid="ct-resumo">
          {{ t('financeiro.cartao.receber.resumo', { n: escolhidas.length, previsto: reais(previsto) }) }}
          <span v-if="administradoraMarcada !== null" class="secundario">
            {{ t('financeiro.cartao.receber.outraAdministradora') }}
          </span>
        </p>
        <span class="campo">
          <SanteSelecao
            v-model="baixa.conta"
            :rotulo="t('financeiro.cartao.receber.conta')"
            :opcoes="contas"
            obrigatorio
            data-testid="ct-conta"
          />
        </span>
        <span class="campo">
          <label for="ct-data-credito">{{ t('financeiro.cartao.receber.dataCredito') }}</label>
          <input
            id="ct-data-credito"
            v-model="baixa.dataCredito"
            type="date"
            required
            data-testid="ct-data-credito"
          />
        </span>
        <span class="campo">
          <label for="ct-creditado">{{ t('financeiro.cartao.receber.valorCreditado') }}</label>
          <input
            id="ct-creditado"
            v-model="baixa.valorCreditado"
            inputmode="decimal"
            size="10"
            data-testid="ct-creditado"
          />
        </span>
        <p v-if="credito && 'recusa' in credito" role="alert" data-testid="ct-credito-recusado">
          {{ t('financeiro.cartao.receber.creditoInvalido') }}
        </p>
        <p v-else-if="credito && credito.diferenca !== 0" data-testid="ct-diferenca">
          {{ t('financeiro.cartao.receber.diferenca', { valor: reais(credito.diferenca) }) }}
        </p>
        <button type="submit" :disabled="!podeBaixar" data-testid="ct-baixar">
          {{ t('financeiro.cartao.receber.baixar') }}
        </button>
      </form>
    </template>

    <template v-else>
      <h2>{{ t('financeiro.cartao.abas.taxas') }}</h2>
      <ErroFaturamento v-if="cadastro.error.value" :erro="cadastro.error.value" />
      <div class="filtros">
        <span class="campo">
          <SanteSelecao
            v-model="administradora"
            :rotulo="t('financeiro.cartao.taxas.administradora')"
            :opcoes="opcoesAdministradora"
            data-testid="ct-administradora"
          />
        </span>
      </div>
      <p
        v-if="cadastro.data.value && !cadastro.data.value.administradoras.length"
        data-testid="ct-sem-administradora"
      >
        {{ t('financeiro.cartao.taxas.nenhumaAdministradora') }}
      </p>

      <template v-if="Number(administradora) > 0">
        <h3>{{ t('financeiro.cartao.taxas.lista') }}</h3>
        <ErroFaturamento v-if="taxas.error.value" :erro="taxas.error.value" />
        <table v-if="taxas.data.value?.length" class="tabela" data-testid="ct-taxas">
          <thead>
            <tr>
              <th scope="col">{{ t('financeiro.cartao.taxas.bandeira') }}</th>
              <th scope="col">{{ t('financeiro.cartao.taxas.modalidade') }}</th>
              <th scope="col">{{ t('financeiro.cartao.taxas.faixa') }}</th>
              <th scope="col">{{ t('financeiro.cartao.taxas.taxa') }}</th>
              <th scope="col">{{ t('financeiro.cartao.taxas.diasRepasse') }}</th>
              <th scope="col">{{ t('financeiro.cartao.taxas.vigencia') }}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in taxas.data.value" :key="x.id" :data-testid="`ct-taxa-${x.id}`">
              <td>{{ nomeBandeira(x.bandeira) }}</td>
              <td>{{ t(`financeiro.cartao.modalidades.${x.modalidade}`) }}</td>
              <td>
                {{ t('financeiro.cartao.taxas.faixaDeAte', { de: x.parcelaInicial, ate: x.parcelaFinal }) }}
              </td>
              <td>{{ textoDaTaxa(x) }}</td>
              <td>{{ t('financeiro.cartao.taxas.repasse', { n: x.diasRepasse }) }}</td>
              <td>
                {{
                  x.vigenciaFim
                    ? t('financeiro.cartao.taxas.vigenciaFechada', {
                        de: data(x.vigenciaInicio),
                        ate: data(x.vigenciaFim),
                      })
                    : t('financeiro.cartao.taxas.vigenciaAberta', { de: data(x.vigenciaInicio) })
                }}
                · {{ t(`financeiro.cartao.taxas.${situacaoDaTaxa(x)}`) }}
              </td>
              <td>
                <button
                  v-if="x.vigente && tem('financeiro.cadastro.editar')"
                  type="button"
                  :disabled="gravando"
                  :data-testid="`ct-encerrar-${x.id}`"
                  @click="encerrar(x)"
                >
                  {{ t('financeiro.cartao.taxas.encerrar') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="!taxas.isPending.value && !taxas.error.value" data-testid="ct-taxas-nenhuma">
          {{ t('financeiro.cartao.taxas.nenhuma') }}
        </p>
      </template>

      <h3>{{ t('financeiro.cartao.taxas.nova') }}</h3>
      <form class="filtros" data-testid="ct-form-taxa" @submit.prevent="enviarTaxa">
        <span class="campo">
          <SanteSelecao
            v-model="nova.bandeira"
            :rotulo="t('financeiro.cartao.taxas.bandeira')"
            :opcoes="opcoesBandeira"
            data-testid="ct-bandeira"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="nova.modalidade"
            :rotulo="t('financeiro.cartao.taxas.modalidade')"
            :opcoes="opcoesModalidade"
            data-testid="ct-modalidade"
          />
        </span>
        <template v-if="parcelado">
          <span class="campo">
            <label for="ct-parcela-inicial">{{ t('financeiro.cartao.taxas.parcelaInicial') }}</label>
            <input
              id="ct-parcela-inicial"
              v-model="nova.parcelaInicial"
              inputmode="numeric"
              size="3"
              data-testid="ct-parcela-inicial"
            />
          </span>
          <span class="campo">
            <label for="ct-parcela-final">{{ t('financeiro.cartao.taxas.parcelaFinal') }}</label>
            <input
              id="ct-parcela-final"
              v-model="nova.parcelaFinal"
              inputmode="numeric"
              size="3"
              data-testid="ct-parcela-final"
            />
          </span>
        </template>
        <span class="campo">
          <SanteSelecao
            v-model="nova.tipo"
            :rotulo="t('financeiro.cartao.taxas.tipo')"
            :opcoes="opcoesTipo"
            data-testid="ct-tipo"
          />
        </span>
        <span v-if="nova.tipo === 'percentual'" class="campo">
          <label for="ct-percentual">{{ t('financeiro.cartao.taxas.percentual') }}</label>
          <input
            id="ct-percentual"
            v-model="nova.percentual"
            inputmode="decimal"
            size="6"
            data-testid="ct-percentual"
          />
        </span>
        <span v-else class="campo">
          <label for="ct-valor">{{ t('financeiro.cartao.taxas.valor') }}</label>
          <input id="ct-valor" v-model="nova.valor" inputmode="decimal" size="8" data-testid="ct-valor" />
        </span>
        <span class="campo">
          <label for="ct-dias">{{ t('financeiro.cartao.taxas.diasRepasse') }}</label>
          <input id="ct-dias" v-model="nova.diasRepasse" inputmode="numeric" size="4" data-testid="ct-dias" />
        </span>
        <span class="campo">
          <label for="ct-vigencia">{{ t('financeiro.cartao.taxas.vigenciaInicio') }}</label>
          <input
            id="ct-vigencia"
            v-model="nova.vigenciaInicio"
            type="date"
            required
            data-testid="ct-vigencia"
          />
        </span>
        <span class="campo">
          <label for="ct-exemplo">{{ t('financeiro.cartao.taxas.exemplo') }}</label>
          <input
            id="ct-exemplo"
            v-model="nova.exemplo"
            inputmode="decimal"
            size="8"
            data-testid="ct-exemplo"
          />
        </span>
        <p v-if="recusaTaxa" role="alert" data-testid="ct-recusa-taxa">{{ recusaTaxa.mensagem }}</p>
        <p v-else-if="recusaVigencia" role="alert" data-testid="ct-recusa-taxa">
          {{ recusaVigencia.mensagem }}
        </p>
        <template v-else>
          <p v-if="substituidas > 0" data-testid="ct-substitui">
            {{ t('financeiro.cartao.taxas.substitui', { n: substituidas }) }}
          </p>
          <p v-if="simulacao" data-testid="ct-simulacao">
            {{ t('financeiro.cartao.taxas.simulacao', simulacao) }}
          </p>
        </template>
        <button type="submit" :disabled="!podeGravarTaxa" data-testid="ct-gravar-taxa">
          {{ t('financeiro.cartao.taxas.gravar') }}
        </button>
      </form>

      <template v-if="tem('financeiro.cadastro.editar')">
        <h3>{{ t('financeiro.cartao.taxas.novaAdministradora') }}</h3>
        <form class="filtros" data-testid="ct-form-administradora" @submit.prevent="enviarAdministradora">
          <span class="campo">
            <label for="ct-adm-nome">{{ t('financeiro.cartao.taxas.nome') }}</label>
            <input id="ct-adm-nome" v-model="adm.nome" maxlength="150" data-testid="ct-adm-nome" />
          </span>
          <span class="campo">
            <label for="ct-adm-dias">{{ t('financeiro.cartao.taxas.diasPagamento') }}</label>
            <input
              id="ct-adm-dias"
              v-model="adm.diasParaPagamento"
              inputmode="numeric"
              size="4"
              data-testid="ct-adm-dias"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              v-model="adm.contaBancaria"
              :rotulo="t('financeiro.cartao.taxas.conta')"
              :opcoes="contas"
              data-testid="ct-adm-conta"
            />
          </span>
          <span class="campo">
            <label for="ct-adm-parcelamento">
              <input
                id="ct-adm-parcelamento"
                v-model="adm.permiteParcelamento"
                type="checkbox"
                data-testid="ct-adm-parcelamento"
              />
              {{ t('financeiro.cartao.taxas.parcelamento') }}
            </label>
          </span>
          <button type="submit" :disabled="!podeGravarAdministradora" data-testid="ct-gravar-administradora">
            {{ t('financeiro.cartao.taxas.gravarAdministradora') }}
          </button>
        </form>
      </template>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
