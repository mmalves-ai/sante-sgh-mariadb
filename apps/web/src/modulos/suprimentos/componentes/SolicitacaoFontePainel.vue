<script setup lang="ts">
// Solicitação de compra pública com a fonte de recurso de cada item (C2-017, 09-AREA linha 81; Lei 14.133, art. 150),
// na tela da ata e do empenho. Monta-se item a item (insumo pela busca, quantidade, valor estimado) com as fontes por
// percentual; o servidor confere que cada item tem fonte ativa, sem repetição, e que a soma fecha 100%, grava a
// solicitação numerada e escolhe a fonte principal (a de maior valor estimado).
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type ApoioSolicitacaoCompraTela,
  lerApoioSolicitacaoCompra,
  listarSolicitacoesCompraPublica,
  novaChaveAtaEmpenho,
  registrarSolicitacaoCompraPublica,
  type SolicitacaoCompraPublicaTela,
} from '../api-ata-empenho.js';
import { qtd, reais } from '../usar-suprimentos.js';
import ErroSuprimentos from './ErroSuprimentos.vue';

interface FonteMontada {
  origem: number;
  percentual: number;
}
interface ItemMontado {
  insumo: number;
  insumoNome: string;
  quantidade: number;
  valorUnitarioEstimado: number | null;
  fontes: FonteMontada[];
}

const { t } = useI18n();
const apoio = ref<ApoioSolicitacaoCompraTela>({ origens: [], locais: [], insumos: [] });
const solicitacoes = ref<SolicitacaoCompraPublicaTela[]>([]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

const local = ref('');
const justificativa = ref('');
const termo = ref('');
const insumo = ref('');
const quantidade = ref('');
const valor = ref('');
const fonte = ref('');
const percentual = ref('100');
const fontesDoItem = ref<FonteMontada[]>([]);
const itens = ref<ItemMontado[]>([]);

const num = (v: string): number | null => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const opcoesLocais = computed(() => apoio.value.locais.map((l) => ({ valor: String(l.id), rotulo: l.nome })));
const opcoesInsumos = computed(() =>
  apoio.value.insumos.map((i) => ({ valor: String(i.id), rotulo: i.nome })),
);
const opcoesFontes = computed(() =>
  apoio.value.origens.map((o) => ({ valor: String(o.id), rotulo: `${o.codigo} · ${o.descricao}` })),
);
const nomeFonte = (id: number) => apoio.value.origens.find((o) => o.id === id)?.codigo ?? String(id);

async function carregar(): Promise<void> {
  try {
    apoio.value = await lerApoioSolicitacaoCompra(termo.value);
    solicitacoes.value = await listarSolicitacoesCompraPublica();
  } catch (x) {
    erro.value = x;
  }
}
onMounted(carregar);

async function buscar(): Promise<void> {
  try {
    apoio.value = await lerApoioSolicitacaoCompra(termo.value);
  } catch (x) {
    erro.value = x;
  }
}

function adicionarFonte(): void {
  const o = Number(fonte.value);
  const p = num(percentual.value);
  if (!o || p === null) return;
  fontesDoItem.value = [...fontesDoItem.value, { origem: o, percentual: p }];
  fonte.value = '';
  percentual.value = '';
}

function adicionarItem(): void {
  const i = apoio.value.insumos.find((x) => String(x.id) === insumo.value);
  const q = num(quantidade.value);
  if (!i || q === null) return;
  itens.value = [
    ...itens.value,
    {
      insumo: i.id,
      insumoNome: i.nome,
      quantidade: q,
      valorUnitarioEstimado: num(valor.value),
      fontes: fontesDoItem.value,
    },
  ];
  insumo.value = '';
  quantidade.value = '';
  valor.value = '';
  fontesDoItem.value = [];
  percentual.value = '100';
}

async function registrar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await registrarSolicitacaoCompraPublica(
      {
        tipo: 'insumo',
        localEstoque: Number(local.value),
        justificativa: justificativa.value,
        itens: itens.value.map((i) => ({
          insumo: i.insumo,
          quantidade: i.quantidade,
          valorUnitarioEstimado: i.valorUnitarioEstimado,
          fontes: i.fontes.map((f) => ({ origem: f.origem, quantidade: null, percentual: f.percentual })),
        })),
      },
      novaChaveAtaEmpenho('scf'),
    );
    mensagem.value = t('ataEmpenho.solicitacaoFonte.registrada', { numero: r.numero });
    itens.value = [];
    justificativa.value = '';
    solicitacoes.value = await listarSolicitacoesCompraPublica();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="painel" aria-labelledby="scf-titulo" data-testid="scf-painel">
    <h2 id="scf-titulo">{{ t('ataEmpenho.solicitacaoFonte.titulo') }}</h2>
    <p class="secundario">{{ t('ataEmpenho.solicitacaoFonte.texto') }}</p>
    <ErroSuprimentos :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="scf-mensagem">{{ mensagem }}</p>
    <p v-if="apoio.origens.length === 0" role="note" data-testid="scf-sem-fonte">
      {{ t('ataEmpenho.solicitacaoFonte.semFonte') }}
    </p>

    <form data-testid="scf-nova" @submit.prevent="registrar">
      <div class="grade">
        <SanteSelecao
          v-model="local"
          :rotulo="t('ataEmpenho.solicitacaoFonte.local')"
          :opcoes="opcoesLocais"
          data-testid="scf-local"
        />
        <span class="campo">
          <label for="scf-justificativa">{{ t('ataEmpenho.solicitacaoFonte.justificativa') }}</label>
          <input
            id="scf-justificativa"
            v-model="justificativa"
            maxlength="2000"
            data-testid="scf-justificativa"
          />
        </span>
        <span class="campo">
          <label for="scf-termo">{{ t('ataEmpenho.solicitacaoFonte.buscaInsumo') }}</label>
          <input id="scf-termo" v-model="termo" maxlength="60" data-testid="scf-termo" @change="buscar" />
        </span>
        <SanteSelecao
          v-model="insumo"
          :rotulo="t('ataEmpenho.solicitacaoFonte.insumo')"
          :opcoes="opcoesInsumos"
          data-testid="scf-insumo"
        />
        <span class="campo">
          <label for="scf-quantidade">{{ t('ataEmpenho.solicitacaoFonte.quantidade') }}</label>
          <input id="scf-quantidade" v-model="quantidade" inputmode="decimal" data-testid="scf-quantidade" />
        </span>
        <span class="campo">
          <label for="scf-valor">{{ t('ataEmpenho.solicitacaoFonte.valor') }}</label>
          <input id="scf-valor" v-model="valor" inputmode="decimal" data-testid="scf-valor" />
        </span>
        <SanteSelecao
          v-model="fonte"
          :rotulo="t('ataEmpenho.solicitacaoFonte.fonte')"
          :opcoes="opcoesFontes"
          data-testid="scf-fonte"
        />
        <span class="campo">
          <label for="scf-percentual">{{ t('ataEmpenho.solicitacaoFonte.percentual') }}</label>
          <input id="scf-percentual" v-model="percentual" inputmode="decimal" data-testid="scf-percentual" />
        </span>
      </div>
      <p v-if="fontesDoItem.length" data-testid="scf-fontes-item">
        {{ fontesDoItem.map((f) => `${nomeFonte(f.origem)} ${f.percentual}%`).join(' + ') }}
      </p>
      <SanteBotao
        variante="secundario"
        :rotulo="t('ataEmpenho.solicitacaoFonte.adicionarFonte')"
        data-testid="scf-adicionar-fonte"
        @acionar="adicionarFonte"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('ataEmpenho.solicitacaoFonte.adicionarItem')"
        data-testid="scf-adicionar-item"
        @acionar="adicionarItem"
      />
      <ul data-testid="scf-itens">
        <li v-for="(i, k) in itens" :key="k">
          {{
            t('ataEmpenho.solicitacaoFonte.itemMontado', {
              n: k + 1,
              insumo: i.insumoNome,
              quantidade: qtd(i.quantidade),
              fontes: i.fontes.map((f) => `${nomeFonte(f.origem)} ${f.percentual}%`).join(' + '),
            })
          }}
        </li>
      </ul>
      <SanteBotao
        tipo="submit"
        :rotulo="t('ataEmpenho.solicitacaoFonte.registrar')"
        data-testid="scf-registrar"
      />
    </form>

    <p v-if="solicitacoes.length === 0">{{ t('ataEmpenho.solicitacaoFonte.nenhuma') }}</p>
    <article v-for="s in solicitacoes" :key="s.id" :data-testid="`scf-${s.numero}`">
      <h3>
        {{
          t('ataEmpenho.solicitacaoFonte.linha', {
            numero: s.numero,
            fonte: s.fontePrincipal ?? '',
            situacao: s.situacao,
          })
        }}
      </h3>
      <ul>
        <li v-for="i in s.itens" :key="i.sequencia">
          {{ i.insumoNome }} · {{ qtd(i.quantidade) }}
          <template v-if="i.valorUnitarioEstimado !== null"> · {{ reais(i.valorUnitarioEstimado) }}</template>
          ·
          {{
            i.fontes
              .map(
                (f) => `${f.codigo} ${f.percentual !== null ? `${f.percentual}%` : qtd(f.quantidade ?? 0)}`,
              )
              .join(' + ')
          }}
        </li>
      </ul>
    </article>
  </section>
</template>
