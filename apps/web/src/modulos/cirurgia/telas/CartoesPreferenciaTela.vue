<script setup lang="ts">
// Cartões de preferência do cirurgião (F8, 04-CC linha 105): `/cirurgia/cartoes-preferencia`. Uma tela só: a lista
// (filtrável pelo cirurgião), o formulário que inclui ou altera (com versão) com os itens na mesma grade, a validação na
// hora pela mesma regra do domínio, copiar um cartão para outro procedimento num clique, tirar de uso e voltar (nada se
// apaga) e a consulta do cartão que vale para o cirurgião e o procedimento, com a sugestão para o mapa e os produtos
// do gasto de sala.
import { validarCartaoPreferencia } from '@sgh/dominio-cirurgia';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarCartao,
  type CartaoAplicavel,
  type CartaoPreferencia,
  type EntradaCartao,
  type EntradaItemCartao,
  incluirCartao,
  lerApoioCartao,
  lerCartaoAplicavel,
  lerCartoesPreferencia,
  NATUREZAS_ITEM,
  type NaturezaItem,
  usoCartao,
} from '../api-cartao-preferencia.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const filtro = ref<number | null>(null);
const lista = useQuery({
  queryKey: computed(() => ['cirurgia', 'cartoes-preferencia', filtro.value]),
  queryFn: () => lerCartoesPreferencia(filtro.value || null),
});
const apoio = useQuery({ queryKey: ['cirurgia', 'cartoes-preferencia', 'apoio'], queryFn: lerApoioCartao });
const opcoesDe = (xs: { id: number; descricao: string }[] | undefined) => [
  { valor: '', rotulo: t('cirurgia.cartaoPreferencia.nenhumaOpcao') },
  ...(xs ?? []).map((x) => ({ valor: String(x.id), rotulo: x.descricao })),
];
const opcoesPosicao = computed(() => opcoesDe(apoio.data.value?.posicoes));
const opcoesSala = computed(() => opcoesDe(apoio.data.value?.salas));
const opcoesNatureza = computed(() =>
  NATUREZAS_ITEM.map((n) => ({ valor: n, rotulo: t(`cirurgia.cartaoPreferencia.naturezas.${n}`) })),
);

interface ItemTela {
  natureza: NaturezaItem;
  codigo: number | null;
  descricao: string;
  quantidade: number;
  observacao: string;
}
const vazio = () => ({
  id: null as number | null,
  versao: 0,
  cirurgiao: null as number | null,
  procedimento: null as number | null,
  posicao: '',
  sala: '',
  tempoMinutos: null as number | null,
  tamanhoLuva: '',
  preparoPele: '',
  fiosSutura: '',
  observacao: '',
  itens: [] as ItemTela[],
});
const f = reactive(vazio());

/** O código digitado vai para o cadastro que a natureza aceita. */
function itemDe(i: ItemTela): EntradaItemCartao {
  const cad = i.codigo || null;
  const insumo = ['material', 'medicamento', 'fio'].includes(i.natureza) ? cad : null;
  return {
    natureza: i.natureza,
    insumo,
    caixaInstrumental: i.natureza === 'instrumental' ? cad : null,
    equipamento: i.natureza === 'equipamento' ? cad : null,
    descricao: i.descricao.trim() || null,
    quantidade: Number(i.quantidade),
    observacao: i.observacao.trim() || null,
  };
}
const corpo = (): EntradaCartao => ({
  cirurgiao: Number(f.cirurgiao),
  procedimento: f.procedimento || null,
  posicao: f.posicao ? Number(f.posicao) : null,
  sala: f.sala ? Number(f.sala) : null,
  tempoMinutos: f.tempoMinutos || null,
  tamanhoLuva: f.tamanhoLuva.trim() || null,
  preparoPele: f.preparoPele.trim() || null,
  fiosSutura: f.fiosSutura.trim() || null,
  observacao: f.observacao.trim() || null,
  itens: f.itens.map(itemDe),
});
const problemas = computed(() =>
  validarCartaoPreferencia({ ...corpo(), cirurgiao: f.cirurgiao || null }).map((p) => p.mensagem),
);

const aviso = ref('');
const erro = ref<unknown>(null);
const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    void cliente.invalidateQueries({ queryKey: ['cirurgia', 'cartoes-preferencia'] });
  },
  onError: (e) => {
    erro.value = e;
  },
});
const salvar = () =>
  acao.mutate(async () => {
    if (f.id) await alterarCartao(f.id, { ...corpo(), versao: f.versao });
    else await incluirCartao(corpo());
    Object.assign(f, vazio());
    aviso.value = t('cirurgia.cartaoPreferencia.salvo');
  });
const novoItem = () =>
  f.itens.push({ natureza: 'material', codigo: null, descricao: '', quantidade: 1, observacao: '' });
const tirarItem = (k: number) => f.itens.splice(k, 1);
const limpar = () => Object.assign(f, vazio());
function carregar(x: CartaoPreferencia, copia: boolean): void {
  Object.assign(f, {
    id: copia ? null : x.id,
    versao: copia ? 0 : x.versao,
    cirurgiao: x.cirurgiao,
    procedimento: copia ? null : x.procedimento,
    posicao: x.posicao ? String(x.posicao) : '',
    sala: x.sala ? String(x.sala) : '',
    tempoMinutos: x.tempoMinutos,
    tamanhoLuva: x.tamanhoLuva ?? '',
    preparoPele: x.preparoPele ?? '',
    fiosSutura: x.fiosSutura ?? '',
    observacao: x.observacao ?? '',
    itens: x.itens.map((i) => ({
      natureza: i.natureza,
      codigo: i.insumo ?? i.caixaInstrumental ?? i.equipamento,
      descricao: i.descricao ?? '',
      quantidade: i.quantidade,
      observacao: i.observacao ?? '',
    })),
  });
  aviso.value = '';
}
const alternarUso = (x: CartaoPreferencia) => acao.mutate(() => usoCartao(x.id, !x.ativo, x.versao));

// ── Qual cartão vale (o que o mapa e o gasto de sala recebem) ──
const consulta = reactive({ cirurgiao: null as number | null, procedimento: null as number | null });
const vale = ref<CartaoAplicavel | null>(null);
const consultar = () =>
  acao.mutate(async () => {
    vale.value = await lerCartaoAplicavel(Number(consulta.cirurgiao), consulta.procedimento || null);
  });
const nomeOpcao = (xs: { id: number; descricao: string }[] | undefined, id: number | null) =>
  id === null ? '—' : (xs?.find((x) => x.id === id)?.descricao ?? `#${id}`);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cartoes-titulo" data-testid="tela-cartoes-preferencia">
    <h1 id="cartoes-titulo">{{ t('cirurgia.cartaoPreferencia.titulo') }}</h1>
    <p>{{ t('cirurgia.cartaoPreferencia.texto') }}</p>
    <ErroCirurgia v-if="lista.isError.value" :erro="lista.error.value" />
    <ErroCirurgia v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="cartao-aviso">{{ aviso }}</p>

    <form class="filtros" data-testid="cartao-form" @submit.prevent="salvar">
      <label
        >{{ t('cirurgia.cartaoPreferencia.cirurgiao') }}
        <input v-model.number="f.cirurgiao" type="number" min="1" required data-testid="cartao-cirurgiao"
      /></label>
      <label
        >{{ t('cirurgia.cartaoPreferencia.procedimento') }}
        <input v-model.number="f.procedimento" type="number" min="1" data-testid="cartao-procedimento"
      /></label>
      <SanteSelecao
        v-model="f.posicao"
        :rotulo="t('cirurgia.cartaoPreferencia.posicao')"
        :opcoes="opcoesPosicao"
        data-testid="cartao-posicao"
      />
      <SanteSelecao
        v-model="f.sala"
        :rotulo="t('cirurgia.cartaoPreferencia.sala')"
        :opcoes="opcoesSala"
        data-testid="cartao-sala"
      />
      <label
        >{{ t('cirurgia.cartaoPreferencia.tempo') }}
        <input
          v-model.number="f.tempoMinutos"
          type="number"
          min="5"
          max="1440"
          step="5"
          data-testid="cartao-tempo"
      /></label>
      <label
        >{{ t('cirurgia.cartaoPreferencia.luva') }}
        <input v-model="f.tamanhoLuva" maxlength="10" data-testid="cartao-luva"
      /></label>
      <label
        >{{ t('cirurgia.cartaoPreferencia.preparo') }}
        <input v-model="f.preparoPele" maxlength="300" data-testid="cartao-preparo"
      /></label>
      <label
        >{{ t('cirurgia.cartaoPreferencia.fios') }}
        <input v-model="f.fiosSutura" maxlength="500" data-testid="cartao-fios"
      /></label>
      <label
        >{{ t('cirurgia.cartaoPreferencia.observacao') }}
        <textarea v-model="f.observacao" rows="2" data-testid="cartao-observacao"></textarea>
      </label>

      <fieldset data-testid="cartao-itens">
        <legend>{{ t('cirurgia.cartaoPreferencia.itens') }}</legend>
        <div v-for="(i, k) in f.itens" :key="k" class="filtros" :data-testid="`cartao-item-${k}`">
          <SanteSelecao
            v-model="i.natureza"
            :rotulo="t('cirurgia.cartaoPreferencia.natureza')"
            :opcoes="opcoesNatureza"
            :data-testid="`cartao-item-${k}-natureza`"
          />
          <label
            >{{ t('cirurgia.cartaoPreferencia.codigoCadastro') }}
            <input
              v-model.number="i.codigo"
              type="number"
              min="1"
              :disabled="i.natureza === 'outro'"
              :data-testid="`cartao-item-${k}-codigo`"
          /></label>
          <label
            >{{ t('cirurgia.cartaoPreferencia.descricao') }}
            <input v-model="i.descricao" maxlength="150" :data-testid="`cartao-item-${k}-descricao`"
          /></label>
          <label
            >{{ t('cirurgia.cartaoPreferencia.quantidade') }}
            <input
              v-model.number="i.quantidade"
              type="number"
              min="0.0001"
              step="any"
              :data-testid="`cartao-item-${k}-quantidade`"
          /></label>
          <button type="button" :data-testid="`cartao-item-${k}-tirar`" @click="tirarItem(k)">
            {{ t('cirurgia.cartaoPreferencia.tirarItem', { n: k + 1 }) }}
          </button>
        </div>
        <button type="button" data-testid="cartao-novo-item" @click="novoItem">
          {{ t('cirurgia.cartaoPreferencia.novoItem') }}
        </button>
      </fieldset>

      <ul v-if="problemas.length" class="problemas" data-testid="cartao-problemas">
        <li v-for="p in problemas" :key="p">{{ p }}</li>
      </ul>
      <button
        type="submit"
        :disabled="problemas.length > 0 || acao.isPending.value"
        data-testid="cartao-salvar"
      >
        {{ f.id ? t('cirurgia.cartaoPreferencia.salvarAlteracao') : t('cirurgia.cartaoPreferencia.incluir') }}
      </button>
      <button v-if="f.id" type="button" data-testid="cartao-novo" @click="limpar">
        {{ t('cirurgia.cartaoPreferencia.novo') }}
      </button>
    </form>

    <fieldset data-testid="cartao-consulta">
      <legend>{{ t('cirurgia.cartaoPreferencia.consultar') }}</legend>
      <label
        >{{ t('cirurgia.cartaoPreferencia.cirurgiao') }}
        <input v-model.number="consulta.cirurgiao" type="number" min="1" data-testid="consulta-cirurgiao"
      /></label>
      <label
        >{{ t('cirurgia.cartaoPreferencia.procedimento') }}
        <input
          v-model.number="consulta.procedimento"
          type="number"
          min="1"
          data-testid="consulta-procedimento"
      /></label>
      <button
        type="button"
        :disabled="!consulta.cirurgiao || acao.isPending.value"
        data-testid="consulta-botao"
        @click="consultar"
      >
        {{ t('cirurgia.cartaoPreferencia.consultarBotao') }}
      </button>
      <template v-if="vale">
        <p v-if="!vale.cartao" role="status" data-testid="consulta-sem-cartao">
          {{ t('cirurgia.cartaoPreferencia.semCartao') }}
        </p>
        <template v-else>
          <p role="status" data-testid="consulta-mapa">
            {{
              t('cirurgia.cartaoPreferencia.sugestaoMapa', {
                sala: nomeOpcao(apoio.data.value?.salas, vale.mapa?.sala ?? null),
                tempo: vale.mapa?.tempoMinutos ?? '—',
                posicao: nomeOpcao(apoio.data.value?.posicoes, vale.mapa?.posicao ?? null),
              })
            }}
          </p>
          <p>{{ t('cirurgia.cartaoPreferencia.produtosGasto') }}</p>
          <ul data-testid="consulta-gasto">
            <li v-for="g in vale.gasto" :key="g.insumo">
              {{
                t('cirurgia.cartaoPreferencia.itemGasto', {
                  nome: g.insumoNome || `#${g.insumo}`,
                  quantidade: g.quantidade,
                })
              }}
            </li>
          </ul>
        </template>
      </template>
    </fieldset>

    <label
      >{{ t('cirurgia.cartaoPreferencia.filtroCirurgiao') }}
      <input v-model.number="filtro" type="number" min="1" data-testid="cartao-filtro"
    /></label>
    <p v-if="!lista.data.value" role="status">{{ t('cirurgia.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0" data-testid="cartoes-nenhum">
      {{ t('cirurgia.cartaoPreferencia.nenhum') }}
    </p>
    <table v-else class="tabela" data-testid="tabela-cartoes">
      <thead>
        <tr>
          <th scope="col">{{ t('cirurgia.cartaoPreferencia.cirurgiao') }}</th>
          <th scope="col">{{ t('cirurgia.procedimento') }}</th>
          <th scope="col">{{ t('cirurgia.cartaoPreferencia.posicao') }}</th>
          <th scope="col">{{ t('cirurgia.cartaoPreferencia.tempo') }}</th>
          <th scope="col">{{ t('cirurgia.cartaoPreferencia.itens') }}</th>
          <th scope="col">{{ t('cirurgia.cartaoPreferencia.situacao') }}</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in lista.data.value.itens" :key="x.id" :data-testid="`cartao-${x.id}`">
          <td>{{ x.cirurgiaoNome ?? `#${x.cirurgiao}` }}</td>
          <td>{{ x.procedimentoDescricao ?? t('cirurgia.cartaoPreferencia.geral') }}</td>
          <td>{{ x.posicaoDescricao ?? '—' }}</td>
          <td>{{ x.tempoMinutos ?? '—' }}</td>
          <td>{{ x.itens.length }}</td>
          <td>
            {{ x.ativo ? t('cirurgia.cartaoPreferencia.emUso') : t('cirurgia.cartaoPreferencia.foraDeUso') }}
          </td>
          <td>
            <button type="button" :data-testid="`cartao-editar-${x.id}`" @click="carregar(x, false)">
              {{ t('cirurgia.cartaoPreferencia.editar') }}
            </button>
            <button type="button" :data-testid="`cartao-copiar-${x.id}`" @click="carregar(x, true)">
              {{ t('cirurgia.cartaoPreferencia.copiar') }}
            </button>
            <button
              type="button"
              :disabled="acao.isPending.value"
              :data-testid="`cartao-uso-${x.id}`"
              @click="alternarUso(x)"
            >
              {{
                x.ativo
                  ? t('cirurgia.cartaoPreferencia.tirarDeUso')
                  : t('cirurgia.cartaoPreferencia.voltarAoUso')
              }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
