<script setup lang="ts">
// Produtos e planos da operadora (M56.2; regras 2 e 3): natureza (plano ou cartão de desconto), registro do produto na
// ANS, tipo de contratação, segmentação, abrangência, acomodação, coparticipação, carências (com o teto legal) e a
// tabela de preços nas 10 faixas etárias da RN 63. O servidor confere as regras e responde a frase da recusa.
import {
  ABRANGENCIAS_PRODUTO,
  type AbrangenciaProduto,
  ACOMODACOES_PLANO_OPERADORA,
  CARENCIAS_PRODUTO,
  FAIXAS_ETARIAS_ANS,
  NATUREZAS_PRODUTO,
  type NaturezaProduto,
  type ProdutoOperadora,
  SEGMENTACOES_PRODUTO,
  type SegmentacaoProduto,
  SITUACOES_PRODUTO,
  type SituacaoProduto,
  TIPOS_CARENCIA,
  TIPOS_CONTRATACAO,
  TIPOS_COPARTICIPACAO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { gravarProdutoOperadora } from '../../api-operadora.js';
import { numeroDe, opcoesDe, type Tela } from './comum.js';
import ErroOperadora from './ErroOperadora.vue';

const props = defineProps<{ tela: Tela; operadora: number }>();
const emit = defineEmits<{ mudou: [] }>();
const { t } = useI18n();

const produtos = computed(() => props.tela.produtos.filter((p) => p.operadora === props.operadora));
const aberto = ref<ProdutoOperadora | 'novo' | null>(null);
const codigo = ref('');
const nome = ref('');
const natureza = ref<NaturezaProduto>('plano');
const registroAns = ref('');
const tipoContratacao = ref<number>(1);
const segmentacao = ref<SegmentacaoProduto | null>('ambulatorialHospitalar');
const abrangencia = ref<AbrangenciaProduto | null>('estadual');
const acomodacao = ref<number | null>(2);
const copartTipo = ref<number>(1);
const copartValor = ref('');
const carencias = ref<Record<string, string>>({ urgencia: '1', partos: '300', demais: '180', cpt: '24' });
const precos = ref<string[]>(Array.from({ length: 10 }, () => ''));
const situacao = ref<SituacaoProduto>('ativo');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);

const opcoesNatureza = opcoesDe(NATUREZAS_PRODUTO, false);
const opcoesContratacao = opcoesDe(TIPOS_CONTRATACAO, true);
const opcoesSegmentacao = computed(() => [
  { valor: null, rotulo: t('operadora.f1.produto.semSegmentacao') },
  ...opcoesDe(SEGMENTACOES_PRODUTO, false),
]);
const opcoesAbrangencia = computed(() => [
  { valor: null, rotulo: t('operadora.f1.produto.semSegmentacao') },
  ...opcoesDe(ABRANGENCIAS_PRODUTO, false),
]);
const opcoesAcomodacao = computed(() => [
  { valor: null, rotulo: t('operadora.f1.produto.semAcomodacao') },
  ...opcoesDe(ACOMODACOES_PLANO_OPERADORA, true),
]);
const opcoesCopart = opcoesDe(TIPOS_COPARTICIPACAO, true);
const opcoesSituacao = opcoesDe(SITUACOES_PRODUTO, false);

function abrir(p: ProdutoOperadora | 'novo'): void {
  aberto.value = p;
  erro.value = null;
  mensagem.value = null;
  const x = p === 'novo' ? null : p;
  codigo.value = x?.codigo ?? '';
  nome.value = x?.nome ?? '';
  natureza.value = x?.natureza ?? 'plano';
  registroAns.value = x?.registroAns ?? '';
  tipoContratacao.value = x?.tipoContratacao ?? 1;
  segmentacao.value = (x ? x.segmentacao : 'ambulatorialHospitalar') as SegmentacaoProduto | null;
  abrangencia.value = (x ? x.abrangencia : 'estadual') as AbrangenciaProduto | null;
  acomodacao.value = x ? x.acomodacao : 2;
  copartTipo.value = x?.coparticipacao.tipo ?? 1;
  copartValor.value =
    x?.coparticipacao.valor !== null && x?.coparticipacao.valor !== undefined
      ? String(x.coparticipacao.valor)
      : '';
  carencias.value = x
    ? Object.fromEntries(TIPOS_CARENCIA.map((c) => [c, String(x.carencias[c])]))
    : { urgencia: '1', partos: '300', demais: '180', cpt: '24' };
  precos.value = x?.precos ? x.precos.map(String) : Array.from({ length: 10 }, () => '');
  situacao.value = x?.situacao ?? 'ativo';
}

async function gravar(): Promise<void> {
  const p = aberto.value;
  if (!p) return;
  ocupado.value = true;
  erro.value = null;
  const valores = precos.value.map(numeroDe);
  try {
    const r = await gravarProdutoOperadora(p === 'novo' ? null : p.id, {
      operadora: props.operadora,
      codigo: codigo.value,
      nome: nome.value,
      natureza: natureza.value,
      registroAns: registroAns.value || null,
      tipoContratacao: tipoContratacao.value,
      segmentacao: segmentacao.value,
      abrangencia: abrangencia.value,
      acomodacao: acomodacao.value,
      coparticipacao: { tipo: copartTipo.value, valor: numeroDe(copartValor.value) },
      carencias: Object.fromEntries(TIPOS_CARENCIA.map((c) => [c, numeroDe(carencias.value[c] ?? '') ?? 0])),
      precos: valores.every((v) => v === null) ? null : valores.map((v) => v ?? 0),
      situacao: situacao.value,
      ...(p === 'novo' ? {} : { versao: p.versao }),
    });
    mensagem.value = r.mensagem;
    aberto.value = null;
    emit('mudou');
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const moeda = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
</script>

<template>
  <section class="bloco" aria-labelledby="ope-produtos-titulo" data-testid="operadora-produtos">
    <h2 id="ope-produtos-titulo">{{ t('operadora.f1.produto.titulo') }}</h2>
    <p v-if="mensagem" role="status" data-testid="mensagem-produto">{{ mensagem }}</p>
    <table v-if="produtos.length" class="tabela" data-testid="tabela-produtos">
      <thead>
        <tr>
          <th scope="col">{{ t('operadora.f1.produto.nome') }}</th>
          <th scope="col">{{ t('operadora.f1.produto.natureza') }}</th>
          <th scope="col">{{ t('operadora.f1.produto.registroAns') }}</th>
          <th scope="col">{{ t('operadora.f1.produto.tipoContratacao') }}</th>
          <th scope="col">{{ t('operadora.f1.produto.segmentacao') }}</th>
          <th scope="col">{{ t('operadora.f1.produto.precos') }}</th>
          <th scope="col">{{ t('operadora.f1.situacao') }}</th>
          <th v-if="tela.acoes.editar" scope="col">{{ t('operadora.f1.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in produtos" :key="p.id" :data-testid="`produto-${p.codigo}`">
          <th scope="row">
            {{ p.nome }} <span class="secundario">({{ p.codigo }})</span>
          </th>
          <td>{{ NATUREZAS_PRODUTO[p.natureza] }}</td>
          <td>{{ p.registroAns ?? '' }}</td>
          <td>{{ TIPOS_CONTRATACAO[p.tipoContratacao as 1] }}</td>
          <td>{{ p.segmentacao ? SEGMENTACOES_PRODUTO[p.segmentacao as SegmentacaoProduto] : '' }}</td>
          <td>{{ p.precos ? `${moeda(p.precos[0] ?? 0)} a ${moeda(p.precos[9] ?? 0)}` : '' }}</td>
          <td>{{ SITUACOES_PRODUTO[p.situacao] }}</td>
          <td v-if="tela.acoes.editar">
            <SanteBotao :rotulo="t('operadora.f1.editar')" variante="texto" @acionar="abrir(p)" />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else>{{ t('operadora.f1.nenhum') }}</p>
    <div v-if="tela.acoes.editar && !aberto" class="acoes">
      <SanteBotao
        :rotulo="t('operadora.f1.novo')"
        variante="secundario"
        data-testid="produto-incluir"
        @acionar="abrir('novo')"
      />
    </div>
    <form v-if="aberto" class="form-produto" data-testid="form-produto" @submit.prevent="gravar">
      <div class="campos">
        <SanteCampoTexto
          v-model="codigo"
          :rotulo="t('operadora.f1.produto.codigo')"
          :max-bytes="20"
          obrigatorio
        />
        <SanteCampoTexto
          v-model="nome"
          :rotulo="t('operadora.f1.produto.nome')"
          :max-bytes="80"
          obrigatorio
        />
        <SanteSelecao
          v-model="natureza"
          :rotulo="t('operadora.f1.produto.natureza')"
          :opcoes="opcoesNatureza"
          data-testid="produto-natureza"
        />
        <SanteCampoTexto
          v-model="registroAns"
          :rotulo="t('operadora.f1.produto.registroAns')"
          :max-bytes="13"
        />
        <SanteSelecao
          v-model="tipoContratacao"
          :rotulo="t('operadora.f1.produto.tipoContratacao')"
          :opcoes="opcoesContratacao"
          data-testid="produto-contratacao"
        />
        <SanteSelecao
          v-model="segmentacao"
          :rotulo="t('operadora.f1.produto.segmentacao')"
          :opcoes="opcoesSegmentacao"
          data-testid="produto-segmentacao"
        />
        <SanteSelecao
          v-model="abrangencia"
          :rotulo="t('operadora.f1.produto.abrangencia')"
          :opcoes="opcoesAbrangencia"
          data-testid="produto-abrangencia"
        />
        <SanteSelecao
          v-model="acomodacao"
          :rotulo="t('operadora.f1.produto.acomodacao')"
          :opcoes="opcoesAcomodacao"
          data-testid="produto-acomodacao"
        />
        <SanteSelecao
          v-model="copartTipo"
          :rotulo="t('operadora.f1.produto.coparticipacao')"
          :opcoes="opcoesCopart"
          data-testid="produto-coparticipacao"
        />
        <SanteCampoTexto
          v-if="copartTipo !== 1"
          v-model="copartValor"
          :rotulo="t('operadora.f1.produto.valorCoparticipacao')"
          :max-bytes="12"
        />
        <SanteSelecao v-model="situacao" :rotulo="t('operadora.f1.situacao')" :opcoes="opcoesSituacao" />
      </div>
      <SanteAlerta
        v-if="natureza === 'cartaoDesconto'"
        :texto="t('operadora.f1.produto.cartaoDesconto')"
        variante="info"
      />
      <fieldset class="campos">
        <legend>{{ t('operadora.f1.produto.carencias') }}</legend>
        <SanteCampoTexto
          v-for="c in TIPOS_CARENCIA"
          :key="c"
          v-model="carencias[c]!"
          :rotulo="`${CARENCIAS_PRODUTO[c].rotulo} (até ${CARENCIAS_PRODUTO[c].maximo} ${CARENCIAS_PRODUTO[c].unidade})`"
          :max-bytes="4"
        />
      </fieldset>
      <fieldset class="campos">
        <legend>{{ t('operadora.f1.produto.precos') }}</legend>
        <p class="secundario">{{ t('operadora.f1.produto.precosAjuda') }}</p>
        <SanteCampoTexto
          v-for="(f, i) in FAIXAS_ETARIAS_ANS"
          :key="f.rotulo"
          v-model="precos[i]!"
          :rotulo="f.rotulo"
          :max-bytes="12"
        />
      </fieldset>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadora.f1.gravar')"
          variante="primario"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="produto-gravar"
        />
        <SanteBotao :rotulo="t('operadora.f1.cancelar')" variante="texto" @acionar="aberto = null" />
      </div>
    </form>
    <ErroOperadora v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
<style scoped>
.form-produto {
  display: grid;
  gap: 0.75rem;
}
fieldset {
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
}
</style>
