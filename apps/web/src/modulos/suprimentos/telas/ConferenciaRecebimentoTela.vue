<script setup lang="ts">
// Conferência física do recebimento (C2-038, 05-SUP linha 21): `/suprimentos/notas-fiscais/conferencias`, aberta pelo
// atalho da tela de entrada por nota fiscal. Quem recebe conta cada item (o pedido pré-preenche o esperado; sem
// pedido, a conferência é às cegas), lê lote e validade e aponta avaria, temperatura ou produto errado. A regra do
// domínio classifica cada item na hora (a mesma que a API aplica ao gravar); a divergente só é validada com a
// justificativa, por outra pessoa (conferido pela API). Cancelar pede o motivo; nada é apagado.
import {
  APONTAMENTOS_RECEBIMENTO,
  classificarRecebimento,
  conferirItensRecebimento,
  podeCancelarRecebimento,
  podeValidarRecebimento,
  type ApontamentoRecebimento,
  type ItemParaConferir,
  type SituacaoConferencia,
  TIPOS_RECEBIMENTO,
  type TipoRecebimento,
} from '@sgh/contratos/regras-suprimentos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import {
  cancelarConferencia,
  type ConferenciaDetalheTela,
  type ConferenciaResumoTela,
  esperadosDoPedido,
  lerConferencia,
  listarConferencias,
  novaChaveConferencia,
  registrarConferencia,
  validarConferencia,
} from '../api-conferencia-recebimento.js';
import BuscaItem from '../componentes/BuscaItem.vue';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import {
  APONTAMENTOS_ROTULO,
  DIVERGENCIAS_ROTULO,
  SITUACOES_ROTULO,
  TIPOS_ROTULO,
  textoConferencia as k,
} from '../i18n-conferencia-recebimento.js';
import { data, numero, qtd, quando, usarSuprimentos } from '../usar-suprimentos.js';

interface LinhaConferida {
  item: number;
  nome: string;
  controlaLote: boolean;
  esperada: number | null;
  conferida: string;
  lote: string;
  validade: string;
  apontamento: string;
  observacao: string;
}

const { locaisDoTipo } = usarSuprimentos();
const hoje = new Date().toISOString().slice(0, 10);

// ── Lista ──
const filtro = ref('');
const lista = ref<ConferenciaResumoTela[] | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function carregar(): Promise<void> {
  try {
    lista.value = await listarConferencias((filtro.value || null) as SituacaoConferencia | null);
  } catch (x) {
    erro.value = x;
  }
}
onMounted(carregar);
function filtrar(v: string): void {
  filtro.value = v;
  void carregar();
}
const opcoesFiltro = computed(() => [
  { valor: '', rotulo: k('todas') },
  ...Object.entries(SITUACOES_ROTULO).map(([valor, rotulo]) => ({ valor, rotulo })),
]);

// ── Nova conferência ──
const tipo = ref<TipoRecebimento>('compra');
const fornecedor = ref('');
const local = ref('');
const pedidoAno = ref(String(new Date().getFullYear()));
const pedidoDoc = ref('');
const numeroNota = ref('');
const serie = ref('');
const observacaoGeral = ref('');
const linhas = ref<LinhaConferida[]>([]);
const gravando = ref(false);
const opcoesTipo = TIPOS_RECEBIMENTO.map((t) => ({ valor: t, rotulo: TIPOS_ROTULO[t] ?? t }));
const opcoesLocais = computed(() => [
  { valor: '', rotulo: k('escolha') },
  ...locaisDoTipo('E').map((l) => ({ valor: String(l.codigo), rotulo: l.nome })),
]);
const opcoesApontamento = [
  { valor: '', rotulo: DIVERGENCIAS_ROTULO['nenhuma'] ?? '' },
  ...APONTAMENTOS_RECEBIMENTO.map((a) => ({ valor: a, rotulo: APONTAMENTOS_ROTULO[a] ?? a })),
];

function novaLinha(i: { item: number; nome: string; controlaLote: boolean; esperada: number | null }) {
  return { ...i, conferida: '', lote: '', validade: '', apontamento: '', observacao: '' };
}
function incluir(i: { codigo: number; nome: string; rastreavel: boolean }): void {
  if (linhas.value.some((l) => l.item === i.codigo)) return;
  linhas.value.push(novaLinha({ item: i.codigo, nome: i.nome, controlaLote: i.rastreavel, esperada: null }));
}
async function trazerPedido(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await esperadosDoPedido(Number(pedidoAno.value), Number(pedidoDoc.value));
    if (!r.length) mensagem.value = k('pedidoSemSaldo');
    linhas.value = r.map((e) =>
      novaLinha({ item: e.item, nome: e.nome, controlaLote: e.controlaLote, esperada: e.esperada }),
    );
  } catch (x) {
    erro.value = x;
  }
}

const paraConferir = computed<ItemParaConferir[]>(() =>
  linhas.value.map((l) => ({
    item: l.item,
    esperada: l.esperada,
    conferida: l.conferida.trim() === '' ? 0 : numero(l.conferida),
    controlaLote: l.controlaLote,
    lote: l.lote.trim() || null,
    validade: l.validade || null,
    apontamento: (l.apontamento || null) as ApontamentoRecebimento | null,
    observacao: l.observacao.trim() || null,
  })),
);
/** A regra do domínio na hora: a mesma que a API confere antes de gravar. */
const recusa = computed(() =>
  linhas.value.some((l) => l.conferida.trim() === '' || !Number.isFinite(numero(l.conferida)))
    ? null
    : conferirItensRecebimento(paraConferir.value),
);
const classe = computed(() => classificarRecebimento(paraConferir.value, hoje));
const divergenciaDe = (k2: number) => classe.value.itens[k2]?.divergencia ?? 'nenhuma';
const completa = computed(
  () =>
    !!fornecedor.value &&
    !!local.value &&
    linhas.value.length > 0 &&
    linhas.value.every((l) => l.conferida.trim() !== '' && Number.isFinite(numero(l.conferida))),
);

async function registrar(): Promise<void> {
  if (!completa.value || recusa.value) return;
  gravando.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await registrarConferencia(
      {
        tipo: tipo.value,
        fornecedor: Number(fornecedor.value),
        local: Number(local.value),
        pedido:
          Number(pedidoDoc.value) > 0 ? { ano: Number(pedidoAno.value), doc: Number(pedidoDoc.value) } : null,
        numeroNota: numeroNota.value.trim() || null,
        serie: serie.value.trim() || null,
        observacao: observacaoGeral.value.trim() || null,
        itens: paraConferir.value.map((i) => ({
          item: i.item,
          esperada: i.esperada,
          conferida: i.conferida,
          lote: i.lote ?? null,
          validade: i.validade ?? null,
          apontamento: i.apontamento ?? null,
          observacao: i.observacao ?? null,
        })),
      },
      novaChaveConferencia('registrar'),
    );
    mensagem.value = k('registrada', {
      id: r.id,
      situacao: SITUACOES_ROTULO[r.situacao] ?? r.situacao,
      divergentes: r.divergentes,
    });
    linhas.value = [];
    await carregar();
    await abrir(r.id);
  } catch (x) {
    erro.value = x;
  } finally {
    gravando.value = false;
  }
}

// ── Detalhe, validação e cancelamento ──
const detalhe = ref<ConferenciaDetalheTela | null>(null);
const justificativa = ref('');
const motivo = ref('');
async function abrir(id: number): Promise<void> {
  erro.value = null;
  justificativa.value = '';
  motivo.value = '';
  try {
    detalhe.value = await lerConferencia(id);
  } catch (x) {
    erro.value = x;
  }
}
/** Quem conferiu não valida: a API confere pela sessão; aqui, a situação e a justificativa. */
const avisoValidar = computed(() =>
  detalhe.value
    ? (podeValidarRecebimento({ situacao: detalhe.value.situacao, conferente: null }, 0, justificativa.value)
        ?.mensagem ?? null)
    : null,
);
const avisoCancelar = computed(() =>
  detalhe.value
    ? (podeCancelarRecebimento(
        { situacao: detalhe.value.situacao, notaLigada: detalhe.value.nota !== null },
        motivo.value,
      )?.mensagem ?? null)
    : null,
);
const podeValidarAgora = computed(
  () => detalhe.value?.situacao === 'conferida' || detalhe.value?.situacao === 'divergente',
);
async function validar(): Promise<void> {
  if (!detalhe.value || avisoValidar.value) return;
  erro.value = null;
  try {
    const r = await validarConferencia(
      detalhe.value.id,
      justificativa.value.trim() || null,
      novaChaveConferencia('validar'),
    );
    mensagem.value = k('validada', { id: r.id });
    await carregar();
    await abrir(r.id);
  } catch (x) {
    erro.value = x;
  }
}
async function cancelar(): Promise<void> {
  if (!detalhe.value || avisoCancelar.value) return;
  erro.value = null;
  try {
    const r = await cancelarConferencia(
      detalhe.value.id,
      motivo.value.trim(),
      novaChaveConferencia('cancelar'),
    );
    mensagem.value = k('cancelada', { id: r.id });
    await carregar();
    await abrir(r.id);
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="conf-titulo" data-testid="tela-conferencia-recebimento">
    <h1 id="conf-titulo">{{ k('titulo') }}</h1>
    <p>{{ k('texto') }}</p>
    <RouterLink to="/suprimentos/notas-fiscais">{{ k('voltar') }}</RouterLink>
    <ErroSuprimentos :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="conf-mensagem">{{ mensagem }}</p>

    <form class="painel" data-testid="conf-form" @submit.prevent="registrar">
      <h2>{{ k('nova') }}</h2>
      <div class="filtros">
        <SanteSelecao v-model="tipo" :rotulo="k('tipo')" :opcoes="opcoesTipo" data-testid="conf-tipo" />
        <span class="campo">
          <label for="conf-forn">{{ k('fornecedor') }}</label>
          <input id="conf-forn" v-model="fornecedor" inputmode="numeric" data-testid="conf-fornecedor" />
        </span>
        <SanteSelecao v-model="local" :rotulo="k('local')" :opcoes="opcoesLocais" data-testid="conf-local" />
      </div>
      <div class="filtros">
        <span class="campo">
          <label for="conf-pano">{{ k('pedidoAno') }}</label>
          <input
            id="conf-pano"
            v-model="pedidoAno"
            inputmode="numeric"
            size="5"
            data-testid="conf-pedido-ano"
          />
        </span>
        <span class="campo">
          <label for="conf-pdoc">{{ k('pedido') }}</label>
          <input id="conf-pdoc" v-model="pedidoDoc" inputmode="numeric" data-testid="conf-pedido" />
        </span>
        <SanteBotao
          variante="secundario"
          :rotulo="k('trazerPedido')"
          :desabilitado="!(Number(pedidoDoc) > 0)"
          data-testid="conf-trazer-pedido"
          @acionar="trazerPedido"
        />
        <span class="campo">
          <label for="conf-nota">{{ k('numeroNota') }}</label>
          <input id="conf-nota" v-model="numeroNota" inputmode="numeric" data-testid="conf-numero-nota" />
        </span>
        <span class="campo">
          <label for="conf-serie">{{ k('serie') }}</label>
          <input id="conf-serie" v-model="serie" size="3" />
        </span>
      </div>
      <BuscaItem testid="conf-busca" @escolher="incluir" />
      <table v-if="linhas.length" class="tabela" data-testid="conf-itens">
        <caption>
          {{
            k('nova')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ k('item') }}</th>
            <th scope="col">{{ k('esperada') }}</th>
            <th scope="col">{{ k('conferida') }}</th>
            <th scope="col">{{ k('lote') }}</th>
            <th scope="col">{{ k('validade') }}</th>
            <th scope="col">{{ k('apontamento') }}</th>
            <th scope="col">{{ k('divergencia') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(l, j) in linhas" :key="l.item" :data-testid="`conf-linha-${l.item}`">
            <td>
              {{ l.item }} · {{ l.nome }}
              <SanteBotao variante="texto" :rotulo="k('retirar')" @acionar="linhas.splice(j, 1)" />
            </td>
            <td>{{ l.esperada === null ? k('semEsperada') : qtd(l.esperada) }}</td>
            <td>
              <label :for="`conf-q-${l.item}`" class="sgh-visualmente-oculto">{{ k('conferida') }}</label>
              <input
                :id="`conf-q-${l.item}`"
                v-model="l.conferida"
                inputmode="decimal"
                size="6"
                :data-testid="`conf-qtde-${l.item}`"
              />
            </td>
            <td>
              <label :for="`conf-l-${l.item}`" class="sgh-visualmente-oculto">{{ k('lote') }}</label>
              <input
                :id="`conf-l-${l.item}`"
                v-model="l.lote"
                size="10"
                :data-testid="`conf-lote-${l.item}`"
              />
            </td>
            <td>
              <label :for="`conf-v-${l.item}`" class="sgh-visualmente-oculto">{{ k('validade') }}</label>
              <input
                :id="`conf-v-${l.item}`"
                v-model="l.validade"
                type="date"
                :data-testid="`conf-validade-${l.item}`"
              />
            </td>
            <td>
              <SanteSelecao
                v-model="l.apontamento"
                :rotulo="k('apontamento')"
                :opcoes="opcoesApontamento"
                :data-testid="`conf-apontamento-${l.item}`"
              />
              <span v-if="l.apontamento" class="campo">
                <label :for="`conf-o-${l.item}`">{{ k('observacao') }}</label>
                <input
                  :id="`conf-o-${l.item}`"
                  v-model="l.observacao"
                  :data-testid="`conf-observacao-${l.item}`"
                />
              </span>
            </td>
            <td :data-testid="`conf-divergencia-${l.item}`">
              {{ DIVERGENCIAS_ROTULO[divergenciaDe(j)] ?? divergenciaDe(j) }}
            </td>
          </tr>
        </tbody>
      </table>
      <span class="campo">
        <label for="conf-obs">{{ k('observacaoGeral') }}</label>
        <input id="conf-obs" v-model="observacaoGeral" />
      </span>
      <p v-if="recusa" role="alert" data-testid="conf-aviso">{{ recusa.mensagem }}</p>
      <SanteBotao
        tipo="submit"
        :rotulo="k('registrar')"
        :desabilitado="gravando || !completa || recusa !== null"
        data-testid="conf-registrar"
      />
    </form>

    <article v-if="detalhe" class="painel" data-testid="conf-detalhe">
      <h2>{{ k('detalhe', { id: detalhe.id }) }}</h2>
      <p>
        {{ SITUACOES_ROTULO[detalhe.situacao] ?? detalhe.situacao }} ·
        {{ TIPOS_ROTULO[detalhe.tipo] ?? detalhe.tipo }} · {{ detalhe.fornecedorNome }} ·
        {{ detalhe.localNome }} · {{ k('chegada') }} {{ quando(detalhe.chegadaEm) }}
      </p>
      <p class="secundario">
        {{ k('conferente') }}: {{ detalhe.conferente ?? '—' }} · {{ k('validador') }}:
        {{ detalhe.validador ?? '—' }}
        <template v-if="detalhe.nota !== null"> · {{ k('nota') }} {{ detalhe.nota }}</template>
      </p>
      <p v-if="detalhe.motivoCancelamento" class="secundario">
        {{ k('motivoCancelamento', { motivo: detalhe.motivoCancelamento }) }}
      </p>
      <table class="tabela" data-testid="conf-detalhe-itens">
        <caption>
          {{
            k('detalhe', { id: detalhe.id })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ k('item') }}</th>
            <th scope="col">{{ k('esperada') }}</th>
            <th scope="col">{{ k('conferida') }}</th>
            <th scope="col">{{ k('lote') }}</th>
            <th scope="col">{{ k('validade') }}</th>
            <th scope="col">{{ k('divergencia') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in detalhe.itensDetalhe" :key="i.sequencia">
            <td>{{ i.item }} · {{ i.nome }}</td>
            <td>{{ i.esperada === null ? k('semEsperada') : qtd(i.esperada) }}</td>
            <td>{{ qtd(i.conferida) }}</td>
            <td>{{ i.lote ?? '—' }}</td>
            <td>{{ data(i.validade) }}</td>
            <td>
              {{ DIVERGENCIAS_ROTULO[i.divergencia] ?? i.divergencia
              }}<template v-if="i.observacao"> · {{ i.observacao }}</template>
            </td>
          </tr>
        </tbody>
      </table>
      <form v-if="podeValidarAgora" class="filtros" @submit.prevent="validar">
        <span class="campo">
          <label for="conf-just">{{ k('justificativa') }}</label>
          <input id="conf-just" v-model="justificativa" size="40" data-testid="conf-justificativa" />
        </span>
        <SanteBotao
          tipo="submit"
          :rotulo="k('validar')"
          :desabilitado="avisoValidar !== null"
          data-testid="conf-validar"
        />
      </form>
      <p v-if="podeValidarAgora && avisoValidar" role="alert" data-testid="conf-aviso-validar">
        {{ avisoValidar }}
      </p>
      <form
        v-if="detalhe.situacao !== 'cancelada' && detalhe.nota === null"
        class="filtros"
        @submit.prevent="cancelar"
      >
        <span class="campo">
          <label for="conf-motivo">{{ k('motivo') }}</label>
          <input id="conf-motivo" v-model="motivo" size="40" data-testid="conf-motivo" />
        </span>
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="k('cancelar')"
          :desabilitado="avisoCancelar !== null"
          data-testid="conf-cancelar"
        />
      </form>
    </article>

    <h2>{{ k('lista') }}</h2>
    <SanteSelecao
      :model-value="filtro"
      :rotulo="k('filtroSituacao')"
      :opcoes="opcoesFiltro"
      data-testid="conf-filtro"
      @update:model-value="filtrar"
    />
    <p v-if="!lista && !erro">{{ k('carregando') }}</p>
    <p v-else-if="lista && lista.length === 0" class="secundario">{{ k('vazia') }}</p>
    <table v-else-if="lista" class="tabela" data-testid="conf-lista">
      <caption>
        {{
          k('lista')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">{{ k('chegada') }}</th>
          <th scope="col">{{ k('fornecedor') }}</th>
          <th scope="col">{{ k('local') }}</th>
          <th scope="col">{{ k('filtroSituacao') }}</th>
          <th scope="col">{{ k('divergentes') }}</th>
          <th scope="col">
            <span class="sgh-visualmente-oculto">{{ k('abrir') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in lista" :key="c.id" :data-testid="`conf-lista-${c.id}`">
          <td>{{ c.id }}</td>
          <td>{{ quando(c.chegadaEm) }}</td>
          <td>{{ c.fornecedorNome }}</td>
          <td>{{ c.localNome }}</td>
          <td>{{ SITUACOES_ROTULO[c.situacao] ?? c.situacao }}</td>
          <td>{{ c.divergentes }} / {{ c.itens }}</td>
          <td>
            <SanteBotao
              variante="texto"
              :rotulo="k('abrir')"
              :data-testid="`conf-abrir-${c.id}`"
              @acionar="abrir(c.id)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
