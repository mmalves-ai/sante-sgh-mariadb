<script setup lang="ts">
// Adesão à ata de registro de preços (C2-017, 09-AREA linha 81; Lei 14.133, art. 86), na tela da ata e do empenho.
// Solicitar: o item vem das atas do estabelecimento (insumo e fornecedor); na ata de outro órgão, informam-se o
// gerenciador, o pregão, a quantidade registrada e o preço. Decidir: autorizar com o ofício do gerenciador, o aceite do
// fornecedor e a documentação conferida, ou negar com motivo. Os limites (50% por órgão, o dobro no total) e os aceites
// são conferidos pelo servidor, que recusa com a mensagem da lei.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type AdesaoTela,
  type AtaTela,
  decidirAdesao,
  listarAdesoes,
  novaChaveAtaEmpenho,
  solicitarAdesao,
} from '../api-ata-empenho.js';
import { qtd, reais } from '../usar-suprimentos.js';
import ErroSuprimentos from './ErroSuprimentos.vue';

const props = defineProps<{ atas: readonly AtaTela[]; hoje: string }>();
const { t } = useI18n();
const adesoes = ref<AdesaoTela[]>([]);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

async function carregar(): Promise<void> {
  try {
    adesoes.value = await listarAdesoes();
  } catch (x) {
    erro.value = x;
  }
}
onMounted(carregar);

const numero = ref('');
const tipo = ref<'carona' | 'participante'>('carona');
const externa = ref(false);
const itemEscolhido = ref('');
const gerenciador = ref('');
const pregao = ref('');
const registrada = ref('');
const preco = ref('');
const quantidade = ref('');
const justificativa = ref('');
const opcoesTipo = computed(() =>
  (['carona', 'participante'] as const).map((v) => ({ valor: v, rotulo: t(`ataEmpenho.adesao.tipos.${v}`) })),
);
const opcoesOrigem = computed(() => [
  { valor: 'propria', rotulo: t('ataEmpenho.adesao.ataPropria') },
  { valor: 'externa', rotulo: t('ataEmpenho.adesao.ataExterna') },
]);
const opcoesItens = computed(() =>
  props.atas
    .filter((a) => a.situacao === 'vigente')
    .flatMap((a) =>
      a.itens.map((i) => ({
        valor: `${a.id}:${i.insumo}:${i.fornecedor}`,
        rotulo: `${a.numero} · ${i.insumoNome} · ${i.fornecedorNome} · ${reais(i.valorUnitario)}`,
      })),
    ),
);
const num = (v: string): number | null => (v.trim() === '' ? null : Number(v.replace(',', '.')));

async function solicitar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  const [ata, insumo, fornecedor] = itemEscolhido.value.split(':').map(Number);
  try {
    const r = await solicitarAdesao(
      {
        numero: numero.value,
        tipo: tipo.value,
        ata: externa.value ? null : (ata ?? null),
        orgaoGerenciador: externa.value ? gerenciador.value : null,
        numeroProcesso: null,
        numeroPregao: externa.value ? pregao.value : null,
        insumo,
        fornecedor,
        quantidadeRegistrada: externa.value ? num(registrada.value) : null,
        quantidadeSolicitada: num(quantidade.value),
        valorUnitario: externa.value ? num(preco.value) : null,
        dataSolicitacao: props.hoje,
        justificativa: justificativa.value || null,
      },
      novaChaveAtaEmpenho('adesao'),
    );
    mensagem.value = t('ataEmpenho.adesao.solicitada', { numero: r.numero });
    numero.value = '';
    quantidade.value = '';
    await carregar();
  } catch (x) {
    erro.value = x;
  }
}

const decidindo = ref<number | null>(null);
const aderida = ref('');
const oficio = ref('');
const aceiteGerenciador = ref(false);
const aceiteFornecedor = ref(false);
const documentacao = ref(false);
const motivo = ref('');
function abrir(a: AdesaoTela): void {
  decidindo.value = a.id;
  aderida.value = String(a.quantidadeSolicitada);
  oficio.value = '';
  aceiteGerenciador.value = aceiteFornecedor.value = documentacao.value = false;
  motivo.value = '';
}
async function decidir(a: AdesaoTela, decisao: 'autorizar' | 'negar'): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    await decidirAdesao(
      a.id,
      decisao === 'autorizar'
        ? {
            decisao,
            versao: a.versao,
            quantidadeAderida: num(aderida.value),
            numeroOficio: oficio.value || null,
            aceiteGerenciador: aceiteGerenciador.value,
            aceiteFornecedor: aceiteFornecedor.value,
            aceiteFornecedorEm: aceiteFornecedor.value ? props.hoje : null,
            documentacaoConferida: documentacao.value,
          }
        : { decisao, versao: a.versao, motivo: motivo.value || null },
      novaChaveAtaEmpenho('decisao'),
    );
    mensagem.value = t('ataEmpenho.adesao.decidida', { numero: a.numero });
    decidindo.value = null;
    await carregar();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="painel" aria-labelledby="ade-titulo" data-testid="arp-adesoes">
    <h2 id="ade-titulo">{{ t('ataEmpenho.adesao.titulo') }}</h2>
    <p class="secundario">{{ t('ataEmpenho.adesao.texto') }}</p>
    <ErroSuprimentos :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="ade-mensagem">{{ mensagem }}</p>

    <form data-testid="ade-nova" @submit.prevent="solicitar">
      <h3>{{ t('ataEmpenho.adesao.nova') }}</h3>
      <div class="filtros">
        <span class="campo">
          <label for="ade-numero">{{ t('ataEmpenho.adesao.numero') }}</label>
          <input id="ade-numero" v-model="numero" maxlength="30" data-testid="ade-numero" />
        </span>
        <SanteSelecao
          v-model="tipo"
          :rotulo="t('ataEmpenho.adesao.tipo')"
          :opcoes="opcoesTipo"
          data-testid="ade-tipo"
        />
        <SanteSelecao
          :model-value="externa ? 'externa' : 'propria'"
          :rotulo="t('ataEmpenho.adesao.origem')"
          :opcoes="opcoesOrigem"
          data-testid="ade-origem"
          @update:model-value="(v: string) => (externa = v === 'externa')"
        />
        <SanteSelecao
          v-model="itemEscolhido"
          :rotulo="t('ataEmpenho.adesao.item')"
          :opcoes="opcoesItens"
          data-testid="ade-item"
        />
        <template v-if="externa">
          <span class="campo">
            <label for="ade-gerenciador">{{ t('ataEmpenho.adesao.gerenciador') }}</label>
            <input id="ade-gerenciador" v-model="gerenciador" maxlength="150" data-testid="ade-gerenciador" />
          </span>
          <span class="campo">
            <label for="ade-pregao">{{ t('ataEmpenho.adesao.pregao') }}</label>
            <input id="ade-pregao" v-model="pregao" maxlength="20" data-testid="ade-pregao" />
          </span>
          <span class="campo">
            <label for="ade-registrada">{{ t('ataEmpenho.adesao.registrada') }}</label>
            <input
              id="ade-registrada"
              v-model="registrada"
              inputmode="decimal"
              data-testid="ade-registrada"
            />
          </span>
          <span class="campo">
            <label for="ade-preco">{{ t('ataEmpenho.adesao.preco') }}</label>
            <input id="ade-preco" v-model="preco" inputmode="decimal" data-testid="ade-preco" />
          </span>
        </template>
        <span class="campo">
          <label for="ade-quantidade">{{ t('ataEmpenho.adesao.quantidade') }}</label>
          <input id="ade-quantidade" v-model="quantidade" inputmode="decimal" data-testid="ade-quantidade" />
        </span>
        <span class="campo">
          <label for="ade-justificativa">{{ t('ataEmpenho.adesao.justificativa') }}</label>
          <textarea
            id="ade-justificativa"
            v-model="justificativa"
            maxlength="2000"
            data-testid="ade-justificativa"
          />
        </span>
      </div>
      <SanteBotao tipo="submit" :rotulo="t('ataEmpenho.adesao.solicitar')" data-testid="ade-solicitar" />
    </form>

    <p v-if="adesoes.length === 0">{{ t('ataEmpenho.adesao.nenhuma') }}</p>
    <article v-for="a in adesoes" :key="a.id" :data-testid="`ade-${a.numero}`">
      <h3>
        {{ a.numero }} · {{ t(`ataEmpenho.adesao.tipos.${a.tipo}`) }} · {{ a.ata ?? a.orgaoGerenciador }} ·
        <span :data-situacao="a.situacao" data-testid="ade-situacao">{{
          t(`ataEmpenho.adesao.situacoes.${a.situacao}`)
        }}</span>
      </h3>
      <p class="secundario">
        {{
          t('ataEmpenho.adesao.linha', {
            insumo: a.insumoNome,
            fornecedor: a.fornecedorNome,
            solicitada: qtd(a.quantidadeSolicitada),
            aderida: a.quantidadeAderida === null ? '-' : qtd(a.quantidadeAderida),
          })
        }}
        <template v-if="a.motivoDecisao"> · {{ a.motivoDecisao }}</template>
      </p>
      <template v-if="a.situacao === 'solicitada' || a.situacao === 'em_analise'">
        <SanteBotao
          v-if="decidindo !== a.id"
          variante="secundario"
          :rotulo="`${t('ataEmpenho.adesao.autorizar')} / ${t('ataEmpenho.adesao.negar')}`"
          data-testid="ade-decidir"
          @acionar="abrir(a)"
        />
        <div v-else class="filtros" data-testid="ade-decisao">
          <span class="campo">
            <label :for="`ade-aderida-${a.id}`">{{ t('ataEmpenho.adesao.aderida') }}</label>
            <input
              :id="`ade-aderida-${a.id}`"
              v-model="aderida"
              inputmode="decimal"
              data-testid="ade-aderida"
            />
          </span>
          <span class="campo">
            <label :for="`ade-oficio-${a.id}`">{{ t('ataEmpenho.adesao.oficio') }}</label>
            <input :id="`ade-oficio-${a.id}`" v-model="oficio" maxlength="15" data-testid="ade-oficio" />
          </span>
          <label
            ><input v-model="aceiteGerenciador" type="checkbox" data-testid="ade-aceite-gerenciador" />
            {{ t('ataEmpenho.adesao.aceiteGerenciador') }}</label
          >
          <label
            ><input v-model="aceiteFornecedor" type="checkbox" data-testid="ade-aceite-fornecedor" />
            {{ t('ataEmpenho.adesao.aceiteFornecedor') }}</label
          >
          <label
            ><input v-model="documentacao" type="checkbox" data-testid="ade-documentacao" />
            {{ t('ataEmpenho.adesao.documentacao') }}</label
          >
          <SanteBotao
            :rotulo="t('ataEmpenho.adesao.autorizar')"
            data-testid="ade-autorizar"
            @acionar="decidir(a, 'autorizar')"
          />
          <span class="campo">
            <label :for="`ade-motivo-${a.id}`">{{ t('ataEmpenho.adesao.motivo') }}</label>
            <input :id="`ade-motivo-${a.id}`" v-model="motivo" maxlength="500" data-testid="ade-motivo" />
          </span>
          <SanteBotao
            variante="secundario"
            :rotulo="t('ataEmpenho.adesao.negar')"
            data-testid="ade-negar"
            @acionar="decidir(a, 'negar')"
          />
        </div>
      </template>
    </article>
  </section>
</template>
