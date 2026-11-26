<script setup lang="ts">
// Ata de registro de preços e empenho (C2-030, 05-SUP linha 26): `/suprimentos/atas-registro-preco`. A ata nasce do
// processo homologado com os itens adjudicados prontos (o vencedor e o preço; só a quantidade e a vigência a conferir);
// o empenho sai da própria linha da ata, sobre o saldo de cada item, com a regra do domínio conferida na hora (saldo,
// vigência, credor único, fonte de recurso). A anulação pede o motivo e devolve o saldo. Nada é apagado. A permissão
// (conduzir para a ata; homologar, da autoridade, para o empenho e a anulação) é conferida pela API.
import {
  conferirAta,
  conferirEmpenho,
  fimMaximoVigenciaAta,
  totalEmpenho,
} from '@sgh/contratos/regras-suprimentos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  anularEmpenho,
  type AtaTela,
  emitirEmpenho,
  type EmpenhoTela,
  listarAtas,
  listarEmpenhos,
  listarProcessosParaAta,
  novaChaveAtaEmpenho,
  type ProcessoParaAtaTela,
  registrarAta,
} from '../api-ata-empenho.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import ReferenciaEmpenhoPainel from '../componentes/ReferenciaEmpenhoPainel.vue';
import { data, numero, qtd, reais } from '../usar-suprimentos.js';

const { t } = useI18n();
const hoje = new Date().toISOString().slice(0, 10);
const atas = ref<AtaTela[]>([]);
const empenhos = ref<EmpenhoTela[]>([]);
const processos = ref<ProcessoParaAtaTela[]>([]);
const carregando = ref(true);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

async function carregar(): Promise<void> {
  carregando.value = true;
  try {
    [atas.value, empenhos.value, processos.value] = await Promise.all([
      listarAtas(),
      listarEmpenhos(),
      listarProcessosParaAta(),
    ]);
  } catch (x) {
    erro.value = x;
  } finally {
    carregando.value = false;
  }
}
onMounted(carregar);

// Nova ata a partir do processo homologado.
const processoEscolhido = ref('');
const numeroAta = ref('');
const objeto = ref('');
const inicio = ref(hoje);
const fim = ref(fimMaximoVigenciaAta(hoje));
const qtdsAta = ref<Record<number, string>>({});
const processo = computed(
  () => processos.value.find((p) => String(p.id) === processoEscolhido.value) ?? null,
);
const opcoesProcessos = computed(() => [
  { valor: '', rotulo: t('ataEmpenho.escolha') },
  ...processos.value.map((p) => ({ valor: String(p.id), rotulo: `${p.numero} · ${p.objeto}` })),
]);
function escolherProcesso(v: string): void {
  processoEscolhido.value = v;
  const p = processo.value;
  objeto.value = p?.objeto ?? '';
  qtdsAta.value = Object.fromEntries((p?.itens ?? []).map((i, k) => [k, String(i.quantidade)]));
}
const itensAta = computed(() =>
  (processo.value?.itens ?? []).map((i, k) => ({
    insumo: i.insumo,
    fornecedor: i.fornecedor,
    quantidade: numero(qtdsAta.value[k] ?? ''),
    valorUnitario: i.valor,
  })),
);
const recusaAta = computed(() =>
  processo.value
    ? (conferirAta({
        numero: numeroAta.value,
        objeto: objeto.value,
        vigenciaInicio: inicio.value,
        vigenciaFim: fim.value,
        itens: itensAta.value,
        processo: { etapa: 'homologado', adjudicados: processo.value.itens.map((i) => ({ ...i })) },
      })[0] ?? null)
    : null,
);
async function salvarAta(): Promise<void> {
  if (!processo.value || recusaAta.value) return;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await registrarAta(
      {
        numero: numeroAta.value.trim(),
        objeto: objeto.value.trim(),
        vigenciaInicio: inicio.value,
        vigenciaFim: fim.value,
        processo: processo.value.id,
        itens: itensAta.value,
      },
      novaChaveAtaEmpenho('ata'),
    );
    mensagem.value = t('ataEmpenho.ataRegistrada', { numero: r.numero, itens: r.itens });
    processoEscolhido.value = '';
    numeroAta.value = '';
    await carregar();
  } catch (x) {
    erro.value = x;
  }
}

// Empenho sobre o saldo de uma ata (um credor só por empenho: a regra avisa na hora).
const ataEmpenhando = ref<number | null>(null);
const qtdsEmp = ref<Record<number, string>>({});
const numeroEmp = ref('');
const emitidoEm = ref(hoje);
const fonte = ref('');
const natureza = ref('');
const ataAberta = computed(() => atas.value.find((a) => a.id === ataEmpenhando.value) ?? null);
const escolhidos = computed(() =>
  (ataAberta.value?.itens ?? [])
    .filter((i) => numero(qtdsEmp.value[i.id] ?? '') > 0)
    .map((i) => ({
      quantidade: numero(qtdsEmp.value[i.id] ?? ''),
      ataItem: {
        ...i,
        ata: {
          situacao: ataAberta.value!.situacao,
          vigenciaInicio: ataAberta.value!.vigenciaInicio,
          vigenciaFim: ataAberta.value!.vigenciaFim,
        },
      },
    })),
);
const recusaEmpenho = computed(
  () =>
    conferirEmpenho({
      numero: numeroEmp.value,
      emitidoEm: emitidoEm.value,
      hoje,
      validoAte: null,
      fonteRecurso: fonte.value,
      itens: escolhidos.value,
    })[0] ?? null,
);
const total = computed(
  () =>
    totalEmpenho(
      escolhidos.value.map((e) => ({ quantidade: e.quantidade, valorUnitario: e.ataItem.valorUnitario })),
    ).total,
);
function abrirEmpenho(a: AtaTela): void {
  ataEmpenhando.value = ataEmpenhando.value === a.id ? null : a.id;
  qtdsEmp.value = {};
}
async function salvarEmpenho(): Promise<void> {
  if (recusaEmpenho.value) return;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await emitirEmpenho(
      {
        numero: numeroEmp.value.trim(),
        emitidoEm: emitidoEm.value,
        validoAte: null,
        fonteRecurso: fonte.value.trim(),
        naturezaDespesa: natureza.value.trim() || null,
        itens: escolhidos.value.map((e) => ({ ataItem: e.ataItem.id, quantidade: e.quantidade })),
      },
      novaChaveAtaEmpenho('empenho'),
    );
    mensagem.value = t('ataEmpenho.empenhoEmitido', { numero: r.numero, total: reais(r.valorTotal) });
    ataEmpenhando.value = null;
    numeroEmp.value = '';
    await carregar();
  } catch (x) {
    erro.value = x;
  }
}

// Anulação com motivo.
const anulando = ref<number | null>(null);
const motivo = ref('');
async function confirmarAnulacao(e: EmpenhoTela): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    await anularEmpenho(
      e.id,
      { motivo: motivo.value.trim(), versao: e.versao },
      novaChaveAtaEmpenho('anular'),
    );
    mensagem.value = t('ataEmpenho.empenhoAnulado', { numero: e.numero });
    anulando.value = null;
    motivo.value = '';
    await carregar();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="arp-titulo" data-testid="tela-atas-registro-preco">
    <h1 id="arp-titulo">{{ t('ataEmpenho.titulo') }}</h1>
    <p>{{ t('ataEmpenho.texto') }}</p>
    <ErroSuprimentos :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="arp-mensagem">{{ mensagem }}</p>
    <p v-if="carregando">{{ t('ataEmpenho.carregando') }}</p>

    <form class="painel" data-testid="arp-nova" @submit.prevent="salvarAta">
      <h2>{{ t('ataEmpenho.novaAta') }}</h2>
      <p v-if="!carregando && processos.length === 0" class="secundario">{{ t('ataEmpenho.semProcesso') }}</p>
      <SanteSelecao
        :model-value="processoEscolhido"
        :rotulo="t('ataEmpenho.processo')"
        :opcoes="opcoesProcessos"
        data-testid="arp-processo"
        @update:model-value="escolherProcesso"
      />
      <template v-if="processo">
        <div class="filtros">
          <span class="campo">
            <label for="arp-numero">{{ t('ataEmpenho.numero') }}</label>
            <input id="arp-numero" v-model="numeroAta" maxlength="30" data-testid="arp-numero" />
          </span>
          <span class="campo">
            <label for="arp-objeto">{{ t('ataEmpenho.objeto') }}</label>
            <input id="arp-objeto" v-model="objeto" maxlength="500" data-testid="arp-objeto" />
          </span>
          <span class="campo">
            <label for="arp-inicio">{{ t('ataEmpenho.vigenciaInicio') }}</label>
            <input id="arp-inicio" v-model="inicio" type="date" data-testid="arp-inicio" />
          </span>
          <span class="campo">
            <label for="arp-fim">{{ t('ataEmpenho.vigenciaFim') }}</label>
            <input id="arp-fim" v-model="fim" type="date" data-testid="arp-fim" />
          </span>
        </div>
        <p class="secundario">
          {{ t('ataEmpenho.vigenciaMaxima', { fim: data(fimMaximoVigenciaAta(inicio)) }) }}
        </p>
        <table class="tabela" data-testid="arp-itens-novos">
          <caption class="sgh-visualmente-oculto">
            {{
              t('ataEmpenho.novaAta')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('ataEmpenho.item') }}</th>
              <th scope="col">{{ t('ataEmpenho.fornecedor') }}</th>
              <th scope="col">{{ t('ataEmpenho.preco') }}</th>
              <th scope="col">{{ t('ataEmpenho.quantidade') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(i, k) in processo.itens" :key="k">
              <td>{{ i.insumoNome }}</td>
              <td>{{ i.fornecedorNome }}</td>
              <td>{{ reais(i.valor) }}</td>
              <td>
                <label :for="`arp-qtd-${k}`" class="sgh-visualmente-oculto">{{
                  t('ataEmpenho.quantidade')
                }}</label>
                <input
                  :id="`arp-qtd-${k}`"
                  v-model="qtdsAta[k]"
                  inputmode="decimal"
                  :data-testid="`arp-qtd-${k}`"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="recusaAta" role="alert" data-testid="arp-recusa">{{ recusaAta.mensagem }}</p>
        <SanteBotao
          tipo="submit"
          :rotulo="t('ataEmpenho.registrarAta')"
          :desabilitado="!!recusaAta"
          data-testid="arp-registrar"
        />
      </template>
    </form>

    <h2>{{ t('ataEmpenho.atas') }}</h2>
    <p v-if="!carregando && atas.length === 0">{{ t('ataEmpenho.nenhumaAta') }}</p>
    <article v-for="a in atas" :key="a.id" class="painel" :data-testid="`arp-ata-${a.numero}`">
      <h3>
        {{ a.numero }} · {{ a.objeto }} ·
        <span :data-situacao="a.situacao" data-testid="arp-ata-situacao">{{
          t(`ataEmpenho.situacoes.${a.situacao}`)
        }}</span>
      </h3>
      <p class="secundario">
        {{ t('ataEmpenho.periodo', { inicio: data(a.vigenciaInicio), fim: data(a.vigenciaFim) }) }}
      </p>
      <table class="tabela">
        <caption class="sgh-visualmente-oculto">
          {{
            a.numero
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('ataEmpenho.item') }}</th>
            <th scope="col">{{ t('ataEmpenho.fornecedor') }}</th>
            <th scope="col">{{ t('ataEmpenho.preco') }}</th>
            <th scope="col">{{ t('ataEmpenho.registrada') }}</th>
            <th scope="col">{{ t('ataEmpenho.saldo') }}</th>
            <th scope="col">{{ t('ataEmpenho.situacao') }}</th>
            <th v-if="ataEmpenhando === a.id" scope="col">{{ t('ataEmpenho.empenhar') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in a.itens" :key="i.id">
            <td>{{ i.insumoNome }}</td>
            <td>{{ i.fornecedorNome }}</td>
            <td>{{ reais(i.valorUnitario) }}</td>
            <td>{{ qtd(i.registrada) }}</td>
            <td :data-testid="`arp-saldo-${i.sequencia}`">{{ qtd(i.saldo) }}</td>
            <td>{{ t(`ataEmpenho.situacoes.${i.situacao}`) }}</td>
            <td v-if="ataEmpenhando === a.id">
              <label :for="`emp-qtd-${i.id}`" class="sgh-visualmente-oculto">{{
                t('ataEmpenho.quantidade')
              }}</label>
              <input
                :id="`emp-qtd-${i.id}`"
                v-model="qtdsEmp[i.id]"
                inputmode="decimal"
                :data-testid="`emp-qtd-${i.sequencia}`"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="a.situacao === 'vigente'"
        variante="secundario"
        :rotulo="t('ataEmpenho.empenhar')"
        data-testid="arp-empenhar"
        @acionar="abrirEmpenho(a)"
      />
      <form v-if="ataEmpenhando === a.id" data-testid="emp-form" @submit.prevent="salvarEmpenho">
        <div class="filtros">
          <span class="campo">
            <label for="emp-numero">{{ t('ataEmpenho.numeroEmpenho') }}</label>
            <input id="emp-numero" v-model="numeroEmp" maxlength="20" data-testid="emp-numero" />
          </span>
          <span class="campo">
            <label for="emp-emissao">{{ t('ataEmpenho.emitidoEm') }}</label>
            <input id="emp-emissao" v-model="emitidoEm" type="date" :max="hoje" data-testid="emp-emissao" />
          </span>
          <span class="campo">
            <label for="emp-fonte">{{ t('ataEmpenho.fonteRecurso') }}</label>
            <input id="emp-fonte" v-model="fonte" maxlength="60" data-testid="emp-fonte" />
          </span>
          <span class="campo">
            <label for="emp-natureza">{{ t('ataEmpenho.naturezaDespesa') }}</label>
            <input id="emp-natureza" v-model="natureza" maxlength="20" data-testid="emp-natureza" />
          </span>
        </div>
        <p data-testid="emp-total">{{ t('ataEmpenho.totalEmpenho', { total: reais(total) }) }}</p>
        <p v-if="recusaEmpenho" role="alert" data-testid="emp-recusa">{{ recusaEmpenho.mensagem }}</p>
        <SanteBotao
          tipo="submit"
          :rotulo="t('ataEmpenho.emitirEmpenho')"
          :desabilitado="!!recusaEmpenho"
          data-testid="emp-emitir"
        />
      </form>
    </article>

    <h2>{{ t('ataEmpenho.empenhos') }}</h2>
    <p v-if="!carregando && empenhos.length === 0">{{ t('ataEmpenho.nenhumEmpenho') }}</p>
    <table v-else class="tabela" data-testid="emp-lista">
      <caption class="sgh-visualmente-oculto">
        {{
          t('ataEmpenho.empenhos')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('ataEmpenho.numeroEmpenho') }}</th>
          <th scope="col">{{ t('ataEmpenho.emitidoEm') }}</th>
          <th scope="col">{{ t('ataEmpenho.fornecedor') }}</th>
          <th scope="col">{{ t('ataEmpenho.ata') }}</th>
          <th scope="col">{{ t('ataEmpenho.fonteRecurso') }}</th>
          <th scope="col">{{ t('ataEmpenho.valor') }}</th>
          <th scope="col">{{ t('ataEmpenho.situacao') }}</th>
          <th scope="col">
            <span class="sgh-visualmente-oculto">{{ t('ataEmpenho.anular') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in empenhos" :key="e.id" :data-testid="`emp-${e.numero}`">
          <td>{{ e.numero }}</td>
          <td>{{ data(e.emitidoEm) }}</td>
          <td>{{ e.fornecedor }}</td>
          <td>{{ e.ata ?? '—' }}</td>
          <td>{{ e.fonteRecurso }}</td>
          <td>{{ reais(e.valorTotal) }}</td>
          <td :data-situacao="e.situacao" data-testid="emp-situacao">
            {{ t(`ataEmpenho.situacoes.${e.situacao}`) }}
            <template v-if="e.motivoAnulacao"> · {{ e.motivoAnulacao }}</template>
          </td>
          <td>
            <template v-if="e.situacao === 'emitido'">
              <SanteBotao
                v-if="anulando !== e.id"
                variante="secundario"
                :rotulo="t('ataEmpenho.anular')"
                data-testid="emp-anular"
                @acionar="anulando = e.id"
              />
              <form v-else @submit.prevent="confirmarAnulacao(e)">
                <label for="emp-motivo">{{ t('ataEmpenho.motivo') }}</label>
                <input id="emp-motivo" v-model="motivo" maxlength="500" data-testid="emp-motivo" />
                <SanteBotao
                  tipo="submit"
                  :rotulo="t('ataEmpenho.confirmarAnulacao')"
                  :desabilitado="motivo.trim().length < 10"
                  data-testid="emp-confirmar-anulacao"
                />
              </form>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <ReferenciaEmpenhoPainel :empenhos="empenhos" />
  </section>
</template>
