<script setup lang="ts">
// Renegociação de títulos a receber (F3.8, 07-FIN linha 76): `/financeiro/receber/renegociacoes`. Numa tela só:
// escolher quem deve (convênio, paciente particular ou cliente, com busca pelo nome), ver TODOS os títulos em aberto
// dele com o saldo real das parcelas, marcar, ver a prévia do acordo (a mesma regra e o mesmo saldo do servidor, na
// hora) e gravar; embaixo, os acordos com o histórico (o que entrou e as parcelas novas) e o desfazer com motivo,
// enquanto não houve recebimento.
import { planejarRenegociacao } from '@sgh/contratos/regras-financeiro';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import {
  type Acordo,
  desfazerAcordo,
  gravarAcordo,
  lerAcordo,
  listarAcordos,
  listarDevedoresDoAcordo,
  listarTitulosDoDevedor,
  type TipoDevedorAcordo,
} from '../api-acordos.js';
import { listarRenegociacoes, novaChave } from '../api-financeiro.js';
import { data, quando, reais, usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { tem } = usarFinanceiro();
const podeGravar = computed(() => tem('financeiro.tituloReceber.criar'));
const hoje = new Date().toISOString().slice(0, 10);
const numero = (v: string) => Number(String(v).replace(',', '.')) || 0;

// ── Novo acordo ──
const MAXIMO_TITULOS = 100;
const tipo = ref<TipoDevedorAcordo | ''>('');
const tipos = computed(() => [
  { valor: '', rotulo: t('financeiro.escolha') },
  { valor: 'C', rotulo: t('financeiro.acordos.tipos.C') },
  { valor: 'E', rotulo: t('financeiro.acordos.tipos.E') },
  { valor: 'O', rotulo: t('financeiro.acordos.tipos.O') },
]);
// A busca pelo nome vai ao servidor depois de uma pausa na digitação.
const busca = ref('');
const buscaAplicada = ref('');
let espera: ReturnType<typeof setTimeout> | undefined;
watch(busca, (v) => {
  clearTimeout(espera);
  espera = setTimeout(() => {
    buscaAplicada.value = v.trim();
  }, 300);
});
const devedores = useQuery({
  queryKey: computed(() => ['financeiro', 'acordos-devedores', tipo.value, buscaAplicada.value]),
  queryFn: () => listarDevedoresDoAcordo(tipo.value as TipoDevedorAcordo, buscaAplicada.value),
  enabled: computed(() => !!tipo.value),
});
const devedor = ref('');
const opcoesDevedor = computed(() => [
  { valor: '', rotulo: t('financeiro.escolha') },
  ...(devedores.data.value ?? []).map((d) => ({
    valor: String(d.id),
    rotulo: t('financeiro.acordos.opcaoDevedor', { nome: d.nome, titulos: d.titulos, saldo: reais(d.saldo) }),
  })),
]);
const doDevedor = useQuery({
  queryKey: computed(() => ['financeiro', 'acordos-titulos', tipo.value, Number(devedor.value)]),
  queryFn: () => listarTitulosDoDevedor(tipo.value as TipoDevedorAcordo, Number(devedor.value)),
  enabled: computed(() => !!tipo.value && !!devedor.value),
});
const titulos = computed(() => doDevedor.data.value?.titulos ?? []);
const saldoDoDevedor = computed(() => Math.round(titulos.value.reduce((x, y) => x + y.saldo, 0) * 100) / 100);
const marcados = ref<number[]>([]);
watch(tipo, () => {
  devedor.value = '';
  busca.value = '';
  buscaAplicada.value = '';
});
watch(devedor, () => {
  marcados.value = [];
});
const marcaveis = computed(() => titulos.value.filter((x) => !x.emEncontro).map((x) => x.id));
const todosMarcados = computed(
  () => marcaveis.value.length > 0 && marcaveis.value.every((id) => marcados.value.includes(id)),
);
function alternarTodos() {
  marcados.value = todosMarcados.value ? [] : [...marcaveis.value];
}
const escolhidos = computed(() => titulos.value.filter((x) => marcados.value.includes(x.id)));
const form = reactive({
  juros: '',
  multa: '',
  desconto: '',
  parcelas: '1',
  vencimento: hoje,
  observacao: '',
});
// A prévia usa as parcelas e o saldo que o servidor devolveu: as mesmas que a gravação lê.
const calculo = computed(() =>
  escolhidos.value.length === 0
    ? null
    : planejarRenegociacao({
        dataAcordo: hoje,
        parcelas: escolhidos.value.flatMap((x) =>
          x.parcelas.map((p) => ({
            parcela: p.parcela,
            titulo: x.id,
            situacao: p.situacao,
            valor: p.valor,
            saldo: p.saldo,
            devedor: doDevedor.data.value?.devedor ?? '',
            emEncontro: p.emEncontro,
          })),
        ),
        juros: numero(form.juros),
        multa: numero(form.multa),
        desconto: numero(form.desconto),
        quantidadeParcelas: Number(form.parcelas),
        primeiroVencimento: form.vencimento,
      }),
);
const impedimento = computed(() =>
  marcados.value.length > MAXIMO_TITULOS
    ? t('financeiro.acordos.muitosTitulos', { maximo: MAXIMO_TITULOS })
    : calculo.value && 'codigo' in calculo.value
      ? calculo.value.mensagem
      : null,
);
const plano = computed(() =>
  !impedimento.value && calculo.value && !('codigo' in calculo.value) ? calculo.value : null,
);

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function agir(fn: () => Promise<{ mensagem: string }>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro'] });
    return true;
  } catch (e) {
    erro.value = e;
    return false;
  } finally {
    gravando.value = false;
  }
}
async function gravar() {
  const feito = await agir(() =>
    gravarAcordo(
      {
        titulos: [...marcados.value],
        juros: numero(form.juros),
        multa: numero(form.multa),
        desconto: numero(form.desconto),
        quantidadeParcelas: Number(form.parcelas),
        primeiroVencimento: form.vencimento,
        ...(form.observacao.trim() ? { observacao: form.observacao.trim() } : {}),
      },
      novaChave('acordo'),
    ),
  );
  if (feito) {
    marcados.value = [];
    devedor.value = '';
    Object.assign(form, { juros: '', multa: '', desconto: '', parcelas: '1', observacao: '' });
  }
}

// ── Acordos feitos ──
const acordos = useQuery({
  queryKey: ['financeiro', 'acordos'],
  queryFn: () => listarAcordos(),
  retry: false,
});
// Onde os acordos detalhados não estão disponíveis, fica o histórico simples.
const historico = useQuery({
  queryKey: ['financeiro', 'renegociacoes'],
  queryFn: () => listarRenegociacoes(),
  enabled: computed(() => !!acordos.error.value),
});
const aberto = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['financeiro', 'acordos', aberto.value]),
  queryFn: () => lerAcordo(aberto.value as number),
  enabled: computed(() => aberto.value !== null),
});
const desfazendo = ref<number | null>(null);
const motivo = ref('');
const podeDesfazer = (a: Acordo) => a.situacao === 'efetivada' && !(a.recebido > 0) && podeGravar.value;
async function desfazer(a: Acordo) {
  if (await agir(() => desfazerAcordo(a.id, motivo.value.trim(), novaChave('desfazer-acordo')))) {
    desfazendo.value = null;
    motivo.value = '';
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="rn-titulo" data-testid="tela-fin-renegociacoes">
    <h1 id="rn-titulo">{{ t('financeiro.renegociacoes.titulo') }}</h1>
    <p>{{ t('financeiro.renegociacoes.texto') }}</p>

    <form class="formulario" data-testid="ac-formulario" @submit.prevent="gravar">
      <h2>{{ t('financeiro.acordos.novo') }}</h2>
      <p class="secundario">{{ t('financeiro.acordos.textoNovo') }}</p>
      <span class="campo">
        <SanteSelecao
          v-model="tipo"
          :rotulo="t('financeiro.acordos.tipoDevedor')"
          :opcoes="tipos"
          data-testid="ac-tipo"
        />
      </span>
      <template v-if="tipo">
        <span class="campo">
          <label for="ac-busca">{{ t('financeiro.acordos.busca') }}</label>
          <input id="ac-busca" v-model="busca" type="search" maxlength="80" data-testid="ac-busca" />
        </span>
        <ErroFaturamento v-if="devedores.error.value" :erro="devedores.error.value" />
        <p v-else-if="devedores.isLoading.value">{{ t('financeiro.carregando') }}</p>
        <p v-else-if="!devedores.data.value?.length" data-testid="ac-sem-devedor">
          {{ t('financeiro.acordos.nenhumDevedor') }}
        </p>
        <span v-else class="campo">
          <SanteSelecao
            v-model="devedor"
            :rotulo="t('financeiro.acordos.quem')"
            :opcoes="opcoesDevedor"
            data-testid="ac-devedor"
          />
        </span>
      </template>
      <template v-if="tipo && devedor">
        <ErroFaturamento v-if="doDevedor.error.value" :erro="doDevedor.error.value" />
        <p v-else-if="doDevedor.isLoading.value">{{ t('financeiro.carregando') }}</p>
        <template v-else-if="titulos.length">
          <p data-testid="ac-resumo-devedor">
            {{
              t('financeiro.acordos.resumoDevedor', {
                titulos: titulos.length,
                saldo: reais(saldoDoDevedor),
                data: data(titulos[0]?.vencimento ?? ''),
              })
            }}
          </p>
          <button type="button" data-testid="ac-marcar-todos" @click="alternarTodos">
            {{ todosMarcados ? t('financeiro.acordos.desmarcarTodos') : t('financeiro.acordos.marcarTodos') }}
          </button>
          <table class="tabela" data-testid="ac-titulos">
            <thead>
              <tr>
                <th scope="col">{{ t('financeiro.acordos.novo') }}</th>
                <th scope="col">{{ t('financeiro.acordos.documento') }}</th>
                <th scope="col">{{ t('financeiro.acordos.emissao') }}</th>
                <th scope="col">{{ t('financeiro.acordos.vencimento') }}</th>
                <th scope="col">{{ t('financeiro.acordos.parcelasAbertas') }}</th>
                <th scope="col">{{ t('financeiro.acordos.saldo') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in titulos" :key="x.id">
                <td>
                  <input
                    v-model="marcados"
                    type="checkbox"
                    :value="x.id"
                    :disabled="x.emEncontro"
                    :aria-label="t('financeiro.acordos.marcar', { documento: x.documento || x.numero })"
                    :title="x.emEncontro ? t('financeiro.acordos.emEncontro') : undefined"
                    :data-testid="`ac-marcar-${x.id}`"
                  />
                </td>
                <td>{{ x.numero }}{{ x.documento ? ` (${x.documento})` : '' }}</td>
                <td>{{ data(x.emissao) }}</td>
                <td>{{ data(x.vencimento) }}</td>
                <td>{{ x.parcelas.length }}</td>
                <td>{{ reais(x.saldo) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
        <p v-else data-testid="ac-sem-titulo">{{ t('financeiro.acordos.nenhumAberto') }}</p>
      </template>

      <template v-if="escolhidos.length">
        <span class="campo">
          <label for="ac-juros">{{ t('financeiro.acordos.juros') }}</label>
          <input id="ac-juros" v-model="form.juros" inputmode="decimal" data-testid="ac-juros" />
        </span>
        <span class="campo">
          <label for="ac-multa">{{ t('financeiro.acordos.multa') }}</label>
          <input id="ac-multa" v-model="form.multa" inputmode="decimal" data-testid="ac-multa" />
        </span>
        <span class="campo">
          <label for="ac-desconto">{{ t('financeiro.acordos.desconto') }}</label>
          <input id="ac-desconto" v-model="form.desconto" inputmode="decimal" data-testid="ac-desconto" />
        </span>
        <span class="campo">
          <label for="ac-parcelas">{{ t('financeiro.acordos.parcelas') }}</label>
          <input
            id="ac-parcelas"
            v-model="form.parcelas"
            type="number"
            min="1"
            max="360"
            required
            data-testid="ac-parcelas"
          />
        </span>
        <span class="campo">
          <label for="ac-vencimento">{{ t('financeiro.acordos.primeiroVencimento') }}</label>
          <input
            id="ac-vencimento"
            v-model="form.vencimento"
            type="date"
            :min="hoje"
            required
            data-testid="ac-vencimento"
          />
        </span>
        <span class="campo">
          <label for="ac-observacao">{{ t('financeiro.acordos.observacao') }}</label>
          <input id="ac-observacao" v-model="form.observacao" maxlength="900" data-testid="ac-observacao" />
        </span>
        <p v-if="impedimento" role="alert" data-testid="ac-impedimento">{{ impedimento }}</p>
        <div v-else-if="plano" data-testid="ac-previa">
          <h3>{{ t('financeiro.acordos.previa') }}</h3>
          <p class="secundario">{{ t('financeiro.acordos.previaTexto') }}</p>
          <p>
            {{ t('financeiro.acordos.original') }}: <strong>{{ reais(plano.valorOriginal) }}</strong> ·
            {{ t('financeiro.acordos.total') }}:
            <strong data-testid="ac-previa-total">{{ reais(plano.valorRenegociado) }}</strong>
          </p>
          <table class="tabela" data-testid="ac-previa-parcelas">
            <thead>
              <tr>
                <th scope="col">{{ t('financeiro.acordos.parcela') }}</th>
                <th scope="col">{{ t('financeiro.acordos.vencimento') }}</th>
                <th scope="col">{{ t('financeiro.acordos.valor') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="n in plano.novas" :key="n.sequencia">
                <td>{{ n.sequencia }}</td>
                <td>{{ data(n.vencimento) }}</td>
                <td>{{ reais(n.valor) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <button type="submit" :disabled="gravando || !plano || !podeGravar" data-testid="ac-gravar">
          {{ t('financeiro.acordos.gravar') }}
        </button>
        <p v-if="!podeGravar" class="secundario">{{ t('financeiro.acordos.semPermissao') }}</p>
      </template>
    </form>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" testid="ac-mensagem" />

    <template v-if="acordos.error.value">
      <h2>{{ t('financeiro.acordos.historicoSimples') }}</h2>
      <ErroFaturamento v-if="historico.error.value" :erro="historico.error.value" />
      <p v-else-if="historico.isLoading.value">{{ t('financeiro.carregando') }}</p>
      <table v-else-if="historico.data.value?.length" class="tabela" data-testid="rn-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.renegociacoes.em') }}</th>
            <th scope="col">{{ t('financeiro.renegociacoes.responsavel') }}</th>
            <th scope="col">{{ t('financeiro.renegociacoes.titulos') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in historico.data.value" :key="x.id">
            <td>{{ quando(x.em) }}</td>
            <td>{{ x.responsavel }}</td>
            <td>{{ x.titulos }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else>{{ t('financeiro.nenhum') }}</p>
    </template>
    <template v-else>
      <h2>{{ t('financeiro.acordos.lista') }}</h2>
      <p v-if="acordos.isLoading.value">{{ t('financeiro.carregando') }}</p>
      <table v-else-if="acordos.data.value?.length" class="tabela" data-testid="ac-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.acordos.numero') }}</th>
            <th scope="col">{{ t('financeiro.acordos.em') }}</th>
            <th scope="col">{{ t('financeiro.acordos.devedor') }}</th>
            <th scope="col">{{ t('financeiro.acordos.original') }}</th>
            <th scope="col">{{ t('financeiro.acordos.total') }}</th>
            <th scope="col">{{ t('financeiro.acordos.parcelas') }}</th>
            <th scope="col">{{ t('financeiro.acordos.situacao') }}</th>
            <th scope="col">{{ t('financeiro.acordos.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="a in acordos.data.value" :key="a.id">
            <tr>
              <td>{{ a.numero }}</td>
              <td>{{ quando(a.em) }}</td>
              <td>{{ a.devedor }}</td>
              <td>{{ reais(a.valorOriginal) }}</td>
              <td>{{ reais(a.valorRenegociado) }}</td>
              <td>{{ a.parcelas }}</td>
              <td>{{ t(`financeiro.acordos.situacoes.${a.situacao}`) }}</td>
              <td>
                <button
                  type="button"
                  :aria-expanded="aberto === a.id"
                  :data-testid="`ac-historico-${a.id}`"
                  @click="aberto = aberto === a.id ? null : a.id"
                >
                  {{
                    aberto === a.id
                      ? t('financeiro.acordos.ocultarHistorico')
                      : t('financeiro.acordos.verHistorico')
                  }}
                </button>
                <button
                  v-if="podeDesfazer(a)"
                  type="button"
                  :data-testid="`ac-desfazer-${a.id}`"
                  @click="
                    desfazendo = a.id;
                    motivo = '';
                  "
                >
                  {{ t('financeiro.acordos.desfazer') }}
                </button>
              </td>
            </tr>
            <tr v-if="desfazendo === a.id">
              <td colspan="8">
                <form class="formulario" @submit.prevent="desfazer(a)">
                  <span class="campo">
                    <label :for="`ac-motivo-${a.id}`">{{ t('financeiro.acordos.motivoDesfazer') }}</label>
                    <input
                      :id="`ac-motivo-${a.id}`"
                      v-model="motivo"
                      minlength="5"
                      maxlength="250"
                      required
                      data-testid="ac-motivo"
                    />
                  </span>
                  <button type="submit" :disabled="gravando" data-testid="ac-confirmar-desfazer">
                    {{ t('financeiro.acordos.confirmarDesfazer') }}
                  </button>
                  <button type="button" @click="desfazendo = null">
                    {{ t('financeiro.acordos.desistir') }}
                  </button>
                </form>
              </td>
            </tr>
            <tr v-if="aberto === a.id">
              <td colspan="8" data-testid="ac-detalhe">
                <ErroFaturamento v-if="detalhe.error.value" :erro="detalhe.error.value" />
                <p v-else-if="detalhe.isLoading.value">{{ t('financeiro.carregando') }}</p>
                <template v-else-if="detalhe.data.value">
                  <p v-if="a.observacao" class="secundario">{{ a.observacao }}</p>
                  <h3>{{ t('financeiro.acordos.originais') }}</h3>
                  <table class="tabela">
                    <thead>
                      <tr>
                        <th scope="col">{{ t('financeiro.acordos.documento') }}</th>
                        <th scope="col">{{ t('financeiro.acordos.parcela') }}</th>
                        <th scope="col">{{ t('financeiro.acordos.vencimento') }}</th>
                        <th scope="col">{{ t('financeiro.acordos.saldoLevado') }}</th>
                        <th scope="col">{{ t('financeiro.acordos.juros') }}</th>
                        <th scope="col">{{ t('financeiro.acordos.multa') }}</th>
                        <th scope="col">{{ t('financeiro.acordos.desconto') }}</th>
                        <th scope="col">{{ t('financeiro.acordos.situacao') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="o in detalhe.data.value.originais" :key="o.parcela">
                        <td>{{ o.documento }}</td>
                        <td>{{ o.sequencia }}</td>
                        <td>{{ data(o.vencimento) }}</td>
                        <td>{{ reais(o.saldoLevado) }}</td>
                        <td>{{ reais(o.juros) }}</td>
                        <td>{{ reais(o.multa) }}</td>
                        <td>{{ reais(o.desconto) }}</td>
                        <td>{{ t(`financeiro.acordos.situacoesParcela.${o.situacao}`) }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <h3>{{ t('financeiro.acordos.novas') }} ({{ a.numeroTitulo }})</h3>
                  <table class="tabela">
                    <thead>
                      <tr>
                        <th scope="col">{{ t('financeiro.acordos.parcela') }}</th>
                        <th scope="col">{{ t('financeiro.acordos.vencimento') }}</th>
                        <th scope="col">{{ t('financeiro.acordos.valor') }}</th>
                        <th scope="col">{{ t('financeiro.acordos.recebido') }}</th>
                        <th scope="col">{{ t('financeiro.acordos.saldo') }}</th>
                        <th scope="col">{{ t('financeiro.acordos.situacao') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="n in detalhe.data.value.novas" :key="n.parcela">
                        <td>{{ n.sequencia }}</td>
                        <td>{{ data(n.vencimento) }}</td>
                        <td>{{ reais(n.valor) }}</td>
                        <td>{{ reais(n.recebido) }}</td>
                        <td>{{ reais(n.saldo) }}</td>
                        <td>{{ t(`financeiro.acordos.situacoesParcela.${n.situacao}`) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </template>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <p v-else>{{ t('financeiro.nenhum') }}</p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style src="../componentes/estilo-financeiro.css"></style>
