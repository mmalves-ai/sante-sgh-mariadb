<script setup lang="ts">
// Cartões de preferência do cirurgião (F8, 04-CC linha 105): `/cirurgia/cartoes-preferencia`. Uma tela só: a lista
// (filtrável pelo cirurgião), o formulário que inclui ou altera (com versão) com os itens na mesma grade, a validação na
// hora pela mesma regra do domínio, copiar um cartão para outro procedimento num clique, tirar de uso e voltar (nada se
// apaga) e a consulta do cartão que vale para o cirurgião, o procedimento e a data do ato, com a sugestão para o mapa e
// os produtos do gasto de sala. Tudo se escolhe pelo nome (combos com busca; produto do estoque pela busca de 3 letras),
// nunca por código interno. O cartão vale para o procedimento, para um grupo de procedimentos ou é o geral, com
// vigência opcional; o kit padrão do cadastro de kits entra como item.
import { validarCartaoPreferencia } from '@sgh/dominio-cirurgia';
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
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
  lerProdutosCartao,
  NATUREZAS_ITEM,
  type NaturezaItem,
  type OpcaoCartao,
  usoCartao,
} from '../api-cartao-preferencia.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const filtro = ref('');
const lista = useQuery({
  queryKey: computed(() => ['cirurgia', 'cartoes-preferencia', filtro.value]),
  queryFn: () => lerCartoesPreferencia(filtro.value ? Number(filtro.value) : null),
});
const apoio = useQuery({ queryKey: ['cirurgia', 'cartoes-preferencia', 'apoio'], queryFn: lerApoioCartao });
const opcoesDe = (xs: OpcaoCartao[] | undefined, vazio = t('cirurgia.cartaoPreferencia.nenhumaOpcao')) => [
  { valor: '', rotulo: vazio },
  ...(xs ?? []).map((x) => ({ valor: String(x.id), rotulo: x.descricao })),
];
const ap = computed(() => apoio.data.value);
const opcoesCirurgiao = computed(() =>
  opcoesDe(ap.value?.cirurgioes, t('cirurgia.cartaoPreferencia.escolha')),
);
const opcoesFiltro = computed(() => opcoesDe(ap.value?.cirurgioes, t('cirurgia.cartaoPreferencia.todos')));
const opcoesProcedimento = computed(() =>
  opcoesDe(ap.value?.procedimentos, t('cirurgia.cartaoPreferencia.geral')),
);
const opcoesGrupo = computed(() => opcoesDe(ap.value?.grupos, t('cirurgia.cartaoPreferencia.semGrupo')));
const opcoesPosicao = computed(() => opcoesDe(ap.value?.posicoes));
const opcoesSala = computed(() => opcoesDe(ap.value?.salas));
const opcoesNatureza = computed(() =>
  NATUREZAS_ITEM.map((n) => ({ valor: n, rotulo: t(`cirurgia.cartaoPreferencia.naturezas.${n}`) })),
);
const DO_ESTOQUE: readonly NaturezaItem[] = ['material', 'medicamento', 'fio'];
/** As escolhas do cadastro de cada natureza que não é produto do estoque (caixa, equipamento, kit). */
const opcoesCadastro = (n: NaturezaItem) =>
  opcoesDe(
    n === 'instrumental'
      ? ap.value?.caixas
      : n === 'equipamento'
        ? ap.value?.equipamentos
        : n === 'kit'
          ? ap.value?.kits
          : [],
    t('cirurgia.cartaoPreferencia.semCadastro'),
  );

interface ItemTela {
  natureza: NaturezaItem;
  codigo: string;
  nome: string;
  descricao: string;
  quantidade: number;
  observacao: string;
}
const vazio = () => ({
  id: null as number | null,
  versao: 0,
  cirurgiao: '',
  procedimento: '',
  grupo: '',
  vigenciaInicio: '',
  vigenciaFim: '',
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
const idOuNulo = (v: string) => (v ? Number(v) : null);

/** O cadastro escolhido vai para a referência que a natureza aceita. */
function itemDe(i: ItemTela): EntradaItemCartao {
  const cad = idOuNulo(i.codigo);
  return {
    natureza: i.natureza,
    insumo: DO_ESTOQUE.includes(i.natureza) ? cad : null,
    caixaInstrumental: i.natureza === 'instrumental' ? cad : null,
    equipamento: i.natureza === 'equipamento' ? cad : null,
    kit: i.natureza === 'kit' ? cad : null,
    descricao: i.descricao.trim() || null,
    quantidade: Number(i.quantidade),
    observacao: i.observacao.trim() || null,
  };
}
const corpo = (): EntradaCartao => ({
  cirurgiao: Number(f.cirurgiao),
  procedimento: idOuNulo(f.procedimento),
  grupo: f.procedimento ? null : idOuNulo(f.grupo),
  vigenciaInicio: f.vigenciaInicio || null,
  vigenciaFim: f.vigenciaFim || null,
  posicao: idOuNulo(f.posicao),
  sala: idOuNulo(f.sala),
  tempoMinutos: f.tempoMinutos || null,
  tamanhoLuva: f.tamanhoLuva.trim() || null,
  preparoPele: f.preparoPele.trim() || null,
  fiosSutura: f.fiosSutura.trim() || null,
  observacao: f.observacao.trim() || null,
  itens: f.itens.map(itemDe),
});
const problemas = computed(() =>
  validarCartaoPreferencia({ ...corpo(), cirurgiao: idOuNulo(f.cirurgiao) }).map((p) => p.mensagem),
);
// O cartão do procedimento não leva grupo: escolher o procedimento limpa o grupo.
watch(
  () => f.procedimento,
  (v) => {
    if (v) f.grupo = '';
  },
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

// ── Itens: produto do estoque pela busca (um clique inclui); caixa, equipamento e kit pelo combo ──
const buscaProduto = ref('');
const termoProduto = ref('');
let espera: ReturnType<typeof setTimeout> | undefined;
watch(buscaProduto, (v) => {
  clearTimeout(espera);
  espera = setTimeout(() => (termoProduto.value = v.trim()), 300);
});
const produtos = useQuery({
  queryKey: computed(() => ['cirurgia', 'cartoes-preferencia', 'produtos', termoProduto.value]),
  queryFn: () => lerProdutosCartao(termoProduto.value),
  enabled: computed(() => termoProduto.value.length >= 3),
});
const achados = computed(() => (termoProduto.value.length >= 3 ? (produtos.data.value?.itens ?? []) : []));
function incluirProduto(p: OpcaoCartao): void {
  f.itens.push({
    natureza: 'material',
    codigo: String(p.id),
    nome: p.descricao,
    descricao: '',
    quantidade: 1,
    observacao: '',
  });
  buscaProduto.value = '';
  termoProduto.value = '';
}
const novoItem = () =>
  f.itens.push({
    natureza: 'instrumental',
    codigo: '',
    nome: '',
    descricao: '',
    quantidade: 1,
    observacao: '',
  });
const tirarItem = (k: number) => f.itens.splice(k, 1);
/** Trocar a natureza entre estoque e cadastro limpa a escolha que a nova natureza não aceita. */
function trocarNatureza(i: ItemTela, n: string): void {
  const mesmoCadastro = DO_ESTOQUE.includes(i.natureza) && DO_ESTOQUE.includes(n as NaturezaItem);
  i.natureza = n as NaturezaItem;
  if (!mesmoCadastro) {
    i.codigo = '';
    i.nome = '';
  }
}
const limpar = () => Object.assign(f, vazio());
function carregar(x: CartaoPreferencia, copia: boolean): void {
  Object.assign(f, {
    id: copia ? null : x.id,
    versao: copia ? 0 : x.versao,
    cirurgiao: String(x.cirurgiao),
    procedimento: copia || !x.procedimento ? '' : String(x.procedimento),
    grupo: copia || !x.grupo ? '' : String(x.grupo),
    vigenciaInicio: x.vigenciaInicio ?? '',
    vigenciaFim: x.vigenciaFim ?? '',
    posicao: x.posicao ? String(x.posicao) : '',
    sala: x.sala ? String(x.sala) : '',
    tempoMinutos: x.tempoMinutos,
    tamanhoLuva: x.tamanhoLuva ?? '',
    preparoPele: x.preparoPele ?? '',
    fiosSutura: x.fiosSutura ?? '',
    observacao: x.observacao ?? '',
    itens: x.itens.map((i) => {
      const cad = i.insumo ?? i.caixaInstrumental ?? i.equipamento ?? i.kit;
      return {
        natureza: i.natureza,
        codigo: cad ? String(cad) : '',
        nome: cad ? (i.nome ?? '') : '',
        descricao: i.descricao ?? '',
        quantidade: i.quantidade,
        observacao: i.observacao ?? '',
      };
    }),
  });
  aviso.value = copia ? t('cirurgia.cartaoPreferencia.copiado') : '';
}
const alternarUso = (x: CartaoPreferencia) => acao.mutate(() => usoCartao(x.id, !x.ativo, x.versao));
const abrangencia = (x: CartaoPreferencia) =>
  x.procedimentoDescricao ??
  (x.grupoDescricao
    ? t('cirurgia.cartaoPreferencia.doGrupo', { grupo: x.grupoDescricao })
    : t('cirurgia.cartaoPreferencia.geral'));
const vigencia = (x: CartaoPreferencia) =>
  x.vigenciaInicio || x.vigenciaFim
    ? t('cirurgia.cartaoPreferencia.vigenciaDe', {
        inicio: x.vigenciaInicio ?? '…',
        fim: x.vigenciaFim ?? '…',
      })
    : t('cirurgia.cartaoPreferencia.semLimite');

// ── Qual cartão vale (o que o mapa e o gasto de sala recebem) ──
const consulta = reactive({ cirurgiao: '', procedimento: '', data: '' });
const vale = ref<CartaoAplicavel | null>(null);
const consultar = () =>
  acao.mutate(async () => {
    vale.value = await lerCartaoAplicavel(
      Number(consulta.cirurgiao),
      idOuNulo(consulta.procedimento),
      consulta.data || null,
    );
  });
const nomeOpcao = (xs: OpcaoCartao[] | undefined, id: number | null) =>
  id === null ? '—' : (xs?.find((x) => x.id === id)?.descricao ?? '—');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="cartoes-titulo" data-testid="tela-cartoes-preferencia">
    <h1 id="cartoes-titulo">{{ t('cirurgia.cartaoPreferencia.titulo') }}</h1>
    <p>{{ t('cirurgia.cartaoPreferencia.texto') }}</p>
    <ErroCirurgia v-if="lista.isError.value" :erro="lista.error.value" />
    <ErroCirurgia v-if="apoio.isError.value" :erro="apoio.error.value" />
    <ErroCirurgia v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="cartao-aviso">{{ aviso }}</p>

    <form class="filtros" data-testid="cartao-form" @submit.prevent="salvar">
      <SanteSelecao
        v-model="f.cirurgiao"
        :rotulo="t('cirurgia.cartaoPreferencia.cirurgiao')"
        :opcoes="opcoesCirurgiao"
        data-testid="cartao-cirurgiao"
      />
      <SanteSelecao
        v-model="f.procedimento"
        :rotulo="t('cirurgia.cartaoPreferencia.procedimento')"
        :opcoes="opcoesProcedimento"
        data-testid="cartao-procedimento"
      />
      <SanteSelecao
        v-if="!f.procedimento"
        v-model="f.grupo"
        :rotulo="t('cirurgia.cartaoPreferencia.grupo')"
        :opcoes="opcoesGrupo"
        data-testid="cartao-grupo"
      />
      <label
        >{{ t('cirurgia.cartaoPreferencia.vigenciaInicio') }}
        <input v-model="f.vigenciaInicio" type="date" data-testid="cartao-vigencia-inicio"
      /></label>
      <label
        >{{ t('cirurgia.cartaoPreferencia.vigenciaFim') }}
        <input v-model="f.vigenciaFim" type="date" data-testid="cartao-vigencia-fim"
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
            :model-value="i.natureza"
            :rotulo="t('cirurgia.cartaoPreferencia.natureza')"
            :opcoes="opcoesNatureza"
            :data-testid="`cartao-item-${k}-natureza`"
            @update:model-value="(v: string) => trocarNatureza(i, v)"
          />
          <p v-if="DO_ESTOQUE.includes(i.natureza)" :data-testid="`cartao-item-${k}-produto`">
            {{ i.nome || t('cirurgia.cartaoPreferencia.semProduto') }}
          </p>
          <SanteSelecao
            v-else-if="i.natureza !== 'outro'"
            v-model="i.codigo"
            :rotulo="t(`cirurgia.cartaoPreferencia.cadastro.${i.natureza}`)"
            :opcoes="opcoesCadastro(i.natureza)"
            :data-testid="`cartao-item-${k}-cadastro`"
          />
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
        <label
          >{{ t('cirurgia.cartaoPreferencia.buscarProduto') }}
          <input v-model="buscaProduto" type="search" autocomplete="off" data-testid="cartao-busca-produto"
        /></label>
        <ul v-if="achados.length" data-testid="cartao-produtos">
          <li v-for="p in achados" :key="p.id">
            <button type="button" :data-testid="`cartao-produto-${p.id}`" @click="incluirProduto(p)">
              {{ t('cirurgia.cartaoPreferencia.incluirProduto', { nome: p.descricao }) }}
            </button>
          </li>
        </ul>
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
      <SanteSelecao
        v-model="consulta.cirurgiao"
        :rotulo="t('cirurgia.cartaoPreferencia.cirurgiao')"
        :opcoes="opcoesCirurgiao"
        data-testid="consulta-cirurgiao"
      />
      <SanteSelecao
        v-model="consulta.procedimento"
        :rotulo="t('cirurgia.cartaoPreferencia.procedimento')"
        :opcoes="opcoesProcedimento"
        data-testid="consulta-procedimento"
      />
      <label
        >{{ t('cirurgia.cartaoPreferencia.dataAto') }}
        <input v-model="consulta.data" type="date" data-testid="consulta-data"
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
                sala: nomeOpcao(ap?.salas, vale.mapa?.sala ?? null),
                tempo: vale.mapa?.tempoMinutos ?? '—',
                posicao: nomeOpcao(ap?.posicoes, vale.mapa?.posicao ?? null),
              })
            }}
          </p>
          <p>{{ t('cirurgia.cartaoPreferencia.produtosGasto') }}</p>
          <ul data-testid="consulta-gasto">
            <li v-for="g in vale.gasto" :key="g.insumo">
              {{
                t('cirurgia.cartaoPreferencia.itemGasto', {
                  nome: g.insumoNome || '—',
                  quantidade: g.quantidade,
                })
              }}
            </li>
          </ul>
        </template>
      </template>
    </fieldset>

    <SanteSelecao
      v-model="filtro"
      :rotulo="t('cirurgia.cartaoPreferencia.filtroCirurgiao')"
      :opcoes="opcoesFiltro"
      data-testid="cartao-filtro"
    />
    <p v-if="!lista.data.value" role="status">{{ t('cirurgia.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0" data-testid="cartoes-nenhum">
      {{ t('cirurgia.cartaoPreferencia.nenhum') }}
    </p>
    <table v-else class="tabela" data-testid="tabela-cartoes">
      <thead>
        <tr>
          <th scope="col">{{ t('cirurgia.cartaoPreferencia.cirurgiao') }}</th>
          <th scope="col">{{ t('cirurgia.cartaoPreferencia.vale') }}</th>
          <th scope="col">{{ t('cirurgia.cartaoPreferencia.vigencia') }}</th>
          <th scope="col">{{ t('cirurgia.cartaoPreferencia.posicao') }}</th>
          <th scope="col">{{ t('cirurgia.cartaoPreferencia.tempo') }}</th>
          <th scope="col">{{ t('cirurgia.cartaoPreferencia.itens') }}</th>
          <th scope="col">{{ t('cirurgia.cartaoPreferencia.situacao') }}</th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in lista.data.value.itens" :key="x.id" :data-testid="`cartao-${x.id}`">
          <td>{{ x.cirurgiaoNome ?? '—' }}</td>
          <td>{{ abrangencia(x) }}</td>
          <td>{{ vigencia(x) }}</td>
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
