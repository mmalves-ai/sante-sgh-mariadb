<script setup lang="ts">
// Acompanhar o pedido de compra emitido (F3.6, 05-SUP linha 20), numa tela só: cada item com o que falta chegar e a
// agenda de entregas (atrasada em destaque), a agenda editada no próprio item com a soma conferida na hora, os
// contatos com o fornecedor (o seguimento aponta o contato anterior) e o cancelamento do item ou do pedido com motivo
// (a justificativa aparece quando o motivo exige). Nada se apaga: cada cancelamento, inclusive o parcial, fica no
// histórico do item com quanto, motivo, justificativa, quem e quando.
import {
  conferirAcompanhamentoPedido,
  conferirCancelamentoCompra,
  conferirEntregasProgramadas,
  type ItemGestaoPedido,
  SITUACOES_ACOMPANHAMENTO_PEDIDO,
  type SituacaoAcompanhamentoPedido,
} from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import {
  acompanharPedido,
  cancelarCompra,
  gravarMotivoCancelamento,
  lerGestaoPedido,
  programarEntregas,
} from '../api-pedido-gestao.js';
import { novaChave } from '../api-suprimentos.js';
import ErroSuprimentos from '../componentes/ErroSuprimentos.vue';
import { mensagensPedidoGestao as M } from '../i18n-pedido-gestao.js';
import { data, qtd, quando, usarSuprimentos } from '../usar-suprimentos.js';

const props = defineProps<{ ano: string; doc: string }>();
const ano = computed(() => Number(props.ano));
const doc = computed(() => Number(props.doc));
const cliente = useQueryClient();
const { pode } = usarSuprimentos();
const chaveConsulta = computed(() => ['suprimentos', 'pedido-gestao', ano.value, doc.value]);
const g = useQuery({ queryKey: chaveConsulta, queryFn: () => lerGestaoPedido(ano.value, doc.value) });
const erro = ref<unknown>(null);
const aviso = ref('');
const ocupado = ref(false);

async function gravar(fazer: (chave: string) => Promise<unknown>, rotulo: string, depois: () => void) {
  erro.value = null;
  aviso.value = '';
  ocupado.value = true;
  try {
    await fazer(novaChave(rotulo));
    aviso.value = M.gravado;
    depois();
    await cliente.invalidateQueries({ queryKey: chaveConsulta.value });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Agenda de entregas do item ────────────────────────────────────────────────────────────────────────────────
const agendaItem = ref<number | null>(null);
const agenda = ref<Array<{ dataPrevista: string; dataLimite: string; quantidade: number | null }>>([]);
function abrirAgenda(i: ItemGestaoPedido) {
  agendaItem.value = i.id;
  const abertas = i.entregas.filter((e) => e.recebida === 0);
  agenda.value = abertas.length
    ? abertas.map((e) => ({
        dataPrevista: e.dataPrevista,
        dataLimite: e.dataLimite ?? '',
        quantidade: e.quantidade - e.cancelada,
      }))
    : [{ dataPrevista: g.data.value?.hoje ?? '', dataLimite: '', quantidade: i.pendente }];
}
const entregasDigitadas = computed(() =>
  agenda.value.map((e) => ({
    dataPrevista: e.dataPrevista,
    dataLimite: e.dataLimite || null,
    quantidade: Number(e.quantidade ?? 0),
  })),
);
const recusasAgenda = computed(() => {
  const d = g.data.value;
  const i = d?.itens.find((x) => x.id === agendaItem.value);
  if (!d || !i) return [];
  const fixas = i.entregas.filter((e) => e.recebida > 0);
  return conferirEntregasProgramadas({
    situacaoPedido: d.pedido.situacao,
    dataPedido: d.pedido.dataPedido,
    quantidadeValida: i.quantidade - i.cancelada,
    quantidadeFixa: fixas.reduce((s, e) => s + e.quantidade - e.cancelada, 0),
    entregas: entregasDigitadas.value,
  });
});
const somaAgenda = computed(() => entregasDigitadas.value.reduce((s, e) => s + e.quantidade, 0));
const gravarAgenda = () =>
  gravar(
    (c) =>
      programarEntregas(
        ano.value,
        doc.value,
        { item: agendaItem.value, entregas: entregasDigitadas.value },
        c,
      ),
    'pedido-agenda',
    () => (agendaItem.value = null),
  );

// ── Contato com o fornecedor ──────────────────────────────────────────────────────────────────────────────────
const contato = reactive({
  aberto: false,
  contatoNome: '',
  contatoTelefone: '',
  contatoEmail: '',
  previsaoEntrega: '',
  situacao: 'em_dia' as SituacaoAcompanhamentoPedido,
  andamento: '',
  anterior: null as number | null,
});
function abrirContato(anterior: number | null) {
  Object.assign(contato, { aberto: true, anterior, andamento: '', previsaoEntrega: '' });
}
const recusasContato = computed(() =>
  g.data.value
    ? conferirAcompanhamentoPedido({
        situacaoPedido: g.data.value.pedido.situacao,
        dataPedido: g.data.value.pedido.dataPedido,
        previsaoEntrega: contato.previsaoEntrega || null,
        andamento: contato.andamento,
      })
    : [],
);
const gravarContato = () =>
  gravar(
    (c) =>
      acompanharPedido(
        ano.value,
        doc.value,
        {
          contatoNome: contato.contatoNome || null,
          contatoTelefone: contato.contatoTelefone || null,
          contatoEmail: contato.contatoEmail || null,
          previsaoEntrega: contato.previsaoEntrega || null,
          situacao: contato.situacao,
          andamento: contato.andamento,
          anterior: contato.anterior,
        },
        c,
      ),
    'pedido-contato',
    () => (contato.aberto = false),
  );

// ── Cancelamento ──────────────────────────────────────────────────────────────────────────────────────────────
const canc = reactive({
  aberto: false,
  item: null as number | null,
  quantidade: '' as string,
  motivo: null as number | null,
  justificativa: '',
});
function abrirCancelamento(item: number | null) {
  Object.assign(canc, { aberto: true, item, quantidade: '', motivo: null, justificativa: '' });
}
const motivoEscolhido = computed(() => g.data.value?.motivos.find((m) => m.id === canc.motivo) ?? null);
const motivosDoAlvo = computed(
  () =>
    g.data.value?.motivos.filter((m) => m.ativo && (canc.item === null ? m.aplicaPedido : m.aplicaItem)) ??
    [],
);
const conferenciaCancelamento = computed(() =>
  g.data.value
    ? conferirCancelamentoCompra({
        situacaoPedido: g.data.value.pedido.situacao,
        item: canc.item,
        quantidade: canc.item !== null && canc.quantidade !== '' ? Number(canc.quantidade) : null,
        motivo: motivoEscolhido.value,
        justificativa: canc.justificativa || null,
        itens: g.data.value.itens,
      })
    : { recusas: [], cancelar: [] },
);
const confirmarCancelamento = () =>
  gravar(
    (c) =>
      cancelarCompra(
        ano.value,
        doc.value,
        {
          item: canc.item,
          quantidade: canc.item !== null && canc.quantidade !== '' ? Number(canc.quantidade) : null,
          motivo: canc.motivo,
          justificativa: canc.justificativa || null,
        },
        c,
      ),
    'pedido-cancelamento',
    () => (canc.aberto = false),
  );
const motivoNovo = reactive({
  aberto: false,
  codigo: '',
  descricao: '',
  aplicaPedido: true,
  aplicaItem: true,
  exigeJustificativa: true,
});
const gravarMotivo = () =>
  gravar(
    (c) => gravarMotivoCancelamento({ ...motivoNovo, aberto: undefined, ativo: true }, c),
    'motivo-cancelamento',
    () => (motivoNovo.aberto = false),
  );
const fechado = computed(() =>
  ['cancelado', 'reprovado', 'recebido', 'encerrado'].includes(g.data.value?.pedido.situacao ?? ''),
);
/** As situações do contato com o fornecedor, para o combo. */
const opcoesSituacaoContato = SITUACOES_ACOMPANHAMENTO_PEDIDO.map((x) => ({
  valor: x,
  rotulo: M.situacoesContato[x],
}));
</script>

<template>
  <section class="pedido-gestao" data-testid="pedido-gestao">
    <header>
      <h1>{{ M.titulo }} {{ doc }}/{{ ano }}</h1>
      <RouterLink to="/suprimentos/pedidos">{{ M.voltar }}</RouterLink>
    </header>
    <p v-if="g.isPending.value">{{ M.carregando }}</p>
    <ErroSuprimentos v-if="g.error.value" :erro="g.error.value" />
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="pg-aviso">{{ aviso }}</p>
    <template v-if="g.data.value">
      <p>
        {{ M.fornecedor }}: {{ g.data.value.pedido.fornecedor }} · {{ M.situacao }}:
        <strong data-testid="pg-situacao">{{ g.data.value.pedido.situacao }}</strong>
        <span v-if="g.data.value.pedido.canceladoEm">
          · {{ M.cancelado }} {{ quando(g.data.value.pedido.canceladoEm) }} ({{
            g.data.value.pedido.motivoCancelamento
          }}{{
            g.data.value.pedido.justificativaCancelamento
              ? ': ' + g.data.value.pedido.justificativaCancelamento
              : ''
          }})</span
        >
      </p>

      <h2>{{ M.itens }}</h2>
      <article
        v-for="i in g.data.value.itens"
        :key="i.id"
        class="item"
        :data-testid="`pg-item-${i.sequencia}`"
      >
        <h3>{{ i.sequencia }}. {{ i.nome }}</h3>
        <p>
          {{ M.pedida }} {{ qtd(i.quantidade) }} · {{ M.recebida }} {{ qtd(i.recebida) }} · {{ M.cancelada }}
          {{ qtd(i.cancelada) }} · <strong>{{ M.falta }} {{ qtd(i.pendente) }}</strong>
          <span v-if="i.motivoCancelamento" class="secundario"> ({{ i.motivoCancelamento }})</span>
        </p>
        <ul v-if="i.entregas.length">
          <li v-for="e in i.entregas" :key="e.id" :class="{ atrasada: e.atrasada }">
            {{ data(e.dataPrevista)
            }}<span v-if="e.dataLimite"> · {{ M.dataLimite }} {{ data(e.dataLimite) }}</span
            >: {{ qtd(e.quantidade) }} · {{ M.recebida }} {{ qtd(e.recebida)
            }}<span v-if="e.cancelada"> · {{ M.cancelada }} {{ qtd(e.cancelada) }}</span>
            <strong v-if="e.atrasada"> · {{ M.atrasada }}</strong>
          </li>
        </ul>
        <p v-else class="secundario">{{ M.semAgenda }}</p>
        <details v-if="i.cancelamentos.length" :data-testid="`pg-cancelamentos-${i.sequencia}`">
          <summary>{{ M.historicoCancelamentos }} ({{ i.cancelamentos.length }})</summary>
          <ol class="cancelamentos">
            <li v-for="cx in i.cancelamentos" :key="cx.id">
              <strong>{{ quando(cx.ocorridoEm) }}</strong> · {{ cx.usuario }} · {{ qtd(cx.quantidade) }}
              {{ cx.abrangencia === 'pedido' ? M.noPedidoInteiro : '' }} · {{ cx.motivo
              }}<span v-if="cx.justificativa">: {{ cx.justificativa }}</span>
            </li>
          </ol>
        </details>
        <div v-if="!fechado && i.pendente > 0" class="acoes">
          <SanteBotao
            :rotulo="M.programar"
            v-if="pode('suprimentos.programarEntregasPedido')"
            variante="secundario"
            :data-testid="`pg-agenda-${i.sequencia}`"
            @acionar="abrirAgenda(i)"
          />
          <SanteBotao
            :rotulo="M.cancelarItem"
            v-if="pode('suprimentos.cancelarCompra')"
            variante="secundario"
            :data-testid="`pg-cancelar-item-${i.sequencia}`"
            @acionar="abrirCancelamento(i.id)"
          />
        </div>
        <form
          v-if="agendaItem === i.id"
          class="agenda"
          data-testid="pg-form-agenda"
          @submit.prevent="gravarAgenda"
        >
          <div v-for="(e, k) in agenda" :key="k" class="linha">
            <label
              >{{ M.dataPrevista }}
              <input v-model="e.dataPrevista" type="date" :data-testid="`pg-ag-data-${k}`"
            /></label>
            <label>{{ M.dataLimite }} <input v-model="e.dataLimite" type="date" /></label>
            <label
              >{{ M.quantidade }}
              <input
                v-model.number="e.quantidade"
                type="number"
                min="0"
                step="any"
                :data-testid="`pg-ag-qtd-${k}`"
            /></label>
            <button type="button" @click="agenda.splice(k, 1)">{{ M.tirar }}</button>
          </div>
          <button
            type="button"
            data-testid="pg-ag-mais"
            @click="agenda.push({ dataPrevista: '', dataLimite: '', quantidade: null })"
          >
            {{ M.maisEntrega }}
          </button>
          <p>{{ M.somaAgenda }}: {{ qtd(somaAgenda) }} / {{ qtd(i.quantidade - i.cancelada) }}</p>
          <ul v-if="recusasAgenda.length" class="recusas" data-testid="pg-ag-recusas">
            <li v-for="r in recusasAgenda" :key="r.codigo + r.mensagem">{{ r.mensagem }}</li>
          </ul>
          <SanteBotao
            :rotulo="M.gravarAgenda"
            tipo="submit"
            :desabilitado="ocupado || recusasAgenda.length > 0"
            data-testid="pg-ag-gravar"
          />
          <button type="button" @click="agendaItem = null">{{ M.cancelar }}</button>
        </form>
      </article>

      <div v-if="!fechado && pode('suprimentos.cancelarCompra')" class="acoes">
        <SanteBotao
          :rotulo="M.cancelarPedido"
          variante="secundario"
          data-testid="pg-cancelar-pedido"
          @acionar="abrirCancelamento(null)"
        />
      </div>
      <form v-if="canc.aberto" class="cancelamento" data-testid="pg-form-cancelamento" @submit.prevent>
        <SanteSelecao
          v-model="canc.motivo"
          :rotulo="M.motivo"
          :opcoes="[...motivosDoAlvo.map((m) => ({ valor: m.id, rotulo: m.descricao }))]"
          data-testid="pg-canc-motivo"
        />
        <button
          v-if="pode('suprimentos.gravarMotivoCancelamentoCompra')"
          type="button"
          data-testid="pg-novo-motivo"
          @click="motivoNovo.aberto = true"
        >
          {{ M.novoMotivo }}
        </button>
        <label v-if="canc.item !== null"
          >{{ M.quantidadeCancelar }}
          <input v-model="canc.quantidade" type="number" min="0" step="any" data-testid="pg-canc-qtd"
        /></label>
        <label v-if="motivoEscolhido?.exigeJustificativa"
          >{{ M.justificativa }}
          <textarea v-model="canc.justificativa" maxlength="500" data-testid="pg-canc-just"></textarea>
        </label>
        <ul
          v-if="canc.motivo !== null && conferenciaCancelamento.recusas.length"
          class="recusas"
          data-testid="pg-canc-recusas"
        >
          <li v-for="r in conferenciaCancelamento.recusas" :key="r.codigo">{{ r.mensagem }}</li>
        </ul>
        <SanteBotao
          :rotulo="M.confirmarCancelamento"
          variante="destrutivo"
          :confirmacao="M.confirmarCancelamento + '?'"
          :desabilitado="ocupado || canc.motivo === null || conferenciaCancelamento.recusas.length > 0"
          data-testid="pg-canc-confirmar"
          @acionar="confirmarCancelamento"
        />
        <button type="button" @click="canc.aberto = false">{{ M.cancelar }}</button>
      </form>
      <form
        v-if="motivoNovo.aberto"
        class="motivo"
        data-testid="pg-form-motivo"
        @submit.prevent="gravarMotivo"
      >
        <label
          >{{ M.codigo }} <input v-model="motivoNovo.codigo" maxlength="30" data-testid="pg-mot-codigo"
        /></label>
        <label
          >{{ M.descricao }}
          <input v-model="motivoNovo.descricao" maxlength="150" data-testid="pg-mot-descricao"
        /></label>
        <fieldset>
          <legend>{{ M.vale }}</legend>
          <label><input v-model="motivoNovo.aplicaPedido" type="checkbox" /> {{ M.oPedido }}</label>
          <label><input v-model="motivoNovo.aplicaItem" type="checkbox" /> {{ M.oItem }}</label>
        </fieldset>
        <label
          ><input v-model="motivoNovo.exigeJustificativa" type="checkbox" /> {{ M.exigeJustificativa }}</label
        >
        <SanteBotao
          :rotulo="M.gravarMotivo"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="pg-mot-gravar"
        />
      </form>

      <h2>{{ M.contatos }}</h2>
      <SanteBotao
        :rotulo="M.novoContato"
        v-if="
          pode('suprimentos.acompanharPedido') &&
          !['cancelado', 'reprovado'].includes(g.data.value.pedido.situacao)
        "
        variante="secundario"
        data-testid="pg-novo-contato"
        @acionar="abrirContato(g.data.value.acompanhamentos[0]?.id ?? null)"
      />
      <form
        v-if="contato.aberto"
        class="contato"
        data-testid="pg-form-contato"
        @submit.prevent="gravarContato"
      >
        <p v-if="contato.anterior" class="secundario">{{ M.seguimentoDe }} {{ `#${contato.anterior}` }}</p>
        <label>{{ M.contatoNome }} <input v-model="contato.contatoNome" maxlength="150" /></label>
        <label
          >{{ M.telefone }} <input v-model="contato.contatoTelefone" maxlength="20" inputmode="tel"
        /></label>
        <label>{{ M.email }} <input v-model="contato.contatoEmail" type="email" maxlength="254" /></label>
        <label
          >{{ M.previsao }} <input v-model="contato.previsaoEntrega" type="date" data-testid="pg-ct-previsao"
        /></label>
        <SanteSelecao
          v-model="contato.situacao"
          :rotulo="M.situacaoContato"
          :opcoes="opcoesSituacaoContato"
          data-testid="pg-ct-situacao"
        />
        <label
          >{{ M.andamento }}
          <textarea v-model="contato.andamento" maxlength="4000" data-testid="pg-ct-andamento"></textarea>
        </label>
        <ul v-if="contato.andamento && recusasContato.length" class="recusas">
          <li v-for="r in recusasContato" :key="r.codigo">{{ r.mensagem }}</li>
        </ul>
        <SanteBotao
          :rotulo="M.gravarContato"
          tipo="submit"
          :desabilitado="ocupado || recusasContato.length > 0"
          data-testid="pg-ct-gravar"
        />
        <button type="button" @click="contato.aberto = false">{{ M.cancelar }}</button>
      </form>
      <p v-if="!g.data.value.acompanhamentos.length" class="secundario">{{ M.semContatos }}</p>
      <ol v-else class="contatos" data-testid="pg-contatos">
        <li v-for="a in g.data.value.acompanhamentos" :key="a.id">
          <strong>{{ quando(a.ocorridoEm) }}</strong> · {{ a.usuario }} ·
          {{ a.situacao ? M.situacoesContato[a.situacao] : '' }}
          <span v-if="a.previsaoEntrega"> · {{ M.previsao }} {{ data(a.previsaoEntrega) }}</span>
          <span v-if="a.contatoNome"> · {{ a.contatoNome }}</span>
          <span v-if="a.anterior" class="secundario"> · {{ M.seguimentoDe }} {{ `#${a.anterior}` }}</span>
          <p>{{ a.andamento }}</p>
        </li>
      </ol>
    </template>
  </section>
</template>

<style scoped>
.item {
  border-block-end: 1px solid var(--sgh-borda);
  padding-block: 0.5rem;
}
.atrasada {
  color: var(--sgh-alerta);
}
.acoes,
.linha {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: end;
}
.recusas {
  color: var(--sgh-alerta);
}
.secundario {
  opacity: 0.75;
}
</style>
