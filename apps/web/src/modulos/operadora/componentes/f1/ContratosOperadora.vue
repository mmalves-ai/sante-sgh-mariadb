<script setup lang="ts">
// Contratos da operadora (M56.2): pessoa física (individual ou familiar, CPF) ou jurídica (coletivo, CNPJ), num
// produto da operadora, com a forma e o mês do reajuste, a vigência e o dia de vencimento. Na lista, o documento do
// contratante sai mascarado; abrir o contrato para alterar lê o documento inteiro (leitura auditada).
import {
  type ContratoOperadora,
  FORMAS_REAJUSTE,
  SITUACOES_CONTRATO,
  type SituacaoContrato,
  TIPOS_VIGENCIA_CONTRATO,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { gravarContratoOperadora, lerContratoOperadora, lerContratosOperadora } from '../../api-operadora.js';
import { dataBr, opcoesDe, type Tela } from './comum.js';
import ErroOperadora from './ErroOperadora.vue';

const props = defineProps<{ tela: Tela; operadora: number }>();
const emit = defineEmits<{ mudou: [] }>();
const { t } = useI18n();

const busca = ref('');
const filtro = ref<string | null>(null);
const pagina = ref<number[]>([]);
const apos = computed(() => pagina.value.at(-1) ?? null);
const q = useQuery({
  queryKey: computed(() => ['operadora', 'contratos', props.operadora, filtro.value, apos.value]),
  queryFn: () => lerContratosOperadora({ operadora: props.operadora, busca: filtro.value, apos: apos.value }),
});

const cliente = useQueryClient();
const produtos = computed(() =>
  props.tela.produtos.filter((p) => p.operadora === props.operadora && p.natureza !== undefined),
);
const aberto = ref<ContratoOperadora | 'novo' | null>(null);
const produto = ref<number | null>(null);
const numero = ref('');
const tipo = ref<number>(1);
const contratanteNome = ref('');
const contratanteDocumento = ref('');
const formaReajuste = ref<number>(1);
const mesReajuste = ref<number>(1);
const tipoVigencia = ref<number>(2);
const inicio = ref<string | null>(null);
const fim = ref<string | null>(null);
const diaVencimento = ref<number | null>(null);
const situacao = ref<SituacaoContrato>('ativo');
const motivoSituacao = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
/** D-BAIXA-56: contrato com beneficiário não troca de produto nem de tipo (mudança de plano é baixa e nova adesão). */
const travado = computed(
  () => typeof aberto.value === 'object' && (aberto.value?.beneficiariosAtivos ?? 0) > 0,
);

const opcoesProduto = computed(() =>
  produtos.value.map((p) => ({ valor: p.id, rotulo: `${p.nome} (${p.codigo})` })),
);
const opcoesTipo = computed(() => [
  { valor: 1, rotulo: t('operadora.f1.contrato.tipos.1') },
  { valor: 2, rotulo: t('operadora.f1.contrato.tipos.2') },
]);
const opcoesReajuste = opcoesDe(FORMAS_REAJUSTE, true);
const opcoesVigencia = opcoesDe(TIPOS_VIGENCIA_CONTRATO, true);
const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const opcoesMes = MESES.map((m, i) => ({ valor: i + 1, rotulo: m }));
const opcoesDia = computed(() => [
  { valor: null, rotulo: t('operadora.f1.contrato.semDia') },
  ...(props.tela.dominios.diasVencimento.length
    ? props.tela.dominios.diasVencimento
    : Array.from({ length: 28 }, (_, i) => i + 1)
  ).map((d) => ({ valor: d, rotulo: String(d) })),
]);
const opcoesSituacao = opcoesDe(SITUACOES_CONTRATO, false);

function filtrar(): void {
  filtro.value = busca.value.trim() || null;
  pagina.value = [];
}

async function abrir(c: ContratoOperadora | 'novo'): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  let x: ContratoOperadora | null = null;
  if (c !== 'novo') {
    try {
      x = await lerContratoOperadora(c.id);
    } catch (e) {
      erro.value = e;
      return;
    }
  }
  aberto.value = x ?? 'novo';
  produto.value = x?.produto ?? produtos.value[0]?.id ?? null;
  numero.value = x?.numero ?? '';
  tipo.value = x?.tipo ?? 1;
  contratanteNome.value = x?.contratanteNome ?? '';
  contratanteDocumento.value = x?.contratanteDocumento ?? '';
  formaReajuste.value = x?.formaReajuste ?? 1;
  mesReajuste.value = x?.mesReajuste ?? 1;
  tipoVigencia.value = x?.tipoVigencia ?? 2;
  inicio.value = x?.inicio ?? null;
  fim.value = x?.fim ?? null;
  diaVencimento.value = x?.diaVencimento ?? null;
  situacao.value = x?.situacao ?? 'ativo';
  motivoSituacao.value = x?.motivoSituacao ?? '';
}

async function gravar(): Promise<void> {
  const c = aberto.value;
  if (!c) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await gravarContratoOperadora(c === 'novo' ? null : c.id, {
      produto: produto.value,
      numero: numero.value,
      tipo: tipo.value,
      contratanteNome: contratanteNome.value,
      contratanteDocumento: contratanteDocumento.value,
      formaReajuste: formaReajuste.value,
      mesReajuste: mesReajuste.value,
      tipoVigencia: tipoVigencia.value,
      inicio: inicio.value,
      fim: fim.value,
      diaVencimento: diaVencimento.value,
      situacao: situacao.value,
      motivoSituacao: motivoSituacao.value || null,
      ...(c === 'novo' ? {} : { versao: c.versao }),
    });
    mensagem.value = r.mensagem;
    aberto.value = null;
    await cliente.invalidateQueries({ queryKey: ['operadora', 'contratos'] });
    emit('mudou');
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="ope-contratos-titulo" data-testid="operadora-contratos">
    <h2 id="ope-contratos-titulo">{{ t('operadora.f1.contrato.titulo') }}</h2>
    <form class="campos" role="search" @submit.prevent="filtrar">
      <SanteCampoTexto v-model="busca" :rotulo="t('operadora.f1.contrato.buscar')" :max-bytes="60" />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadora.f1.buscar')"
          variante="secundario"
          tipo="submit"
          data-testid="contrato-buscar"
        />
      </div>
    </form>
    <p v-if="mensagem" role="status" data-testid="mensagem-contrato">{{ mensagem }}</p>
    <ErroOperadora v-if="q.isError.value" :erro="q.error.value" />
    <table v-else-if="q.data.value?.itens.length" class="tabela" data-testid="tabela-contratos">
      <thead>
        <tr>
          <th scope="col">{{ t('operadora.f1.contrato.numero') }}</th>
          <th scope="col">{{ t('operadora.f1.contrato.contratante') }}</th>
          <th scope="col">{{ t('operadora.f1.contrato.documento') }}</th>
          <th scope="col">{{ t('operadora.f1.contrato.produto') }}</th>
          <th scope="col">{{ t('operadora.f1.contrato.inicio') }}</th>
          <th scope="col">{{ t('operadora.f1.contrato.ativos') }}</th>
          <th scope="col">{{ t('operadora.f1.situacao') }}</th>
          <th v-if="tela.acoes.editar" scope="col">{{ t('operadora.f1.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in q.data.value.itens" :key="c.id" :data-testid="`contrato-${c.numero}`">
          <th scope="row">{{ c.numero }}</th>
          <td>{{ c.contratanteNome }}</td>
          <td>{{ c.contratanteDocumento }}</td>
          <td>{{ c.produtoNome }}</td>
          <td>{{ dataBr(c.inicio) }}</td>
          <td>{{ c.beneficiariosAtivos }}</td>
          <td>{{ SITUACOES_CONTRATO[c.situacao] }}</td>
          <td v-if="tela.acoes.editar">
            <SanteBotao :rotulo="t('operadora.f1.editar')" variante="texto" @acionar="abrir(c)" />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="q.data.value">{{ t('operadora.f1.nenhum') }}</p>
    <div class="acoes">
      <SanteBotao
        v-if="pagina.length"
        :rotulo="t('operadora.f1.primeira')"
        variante="texto"
        @acionar="pagina = []"
      />
      <SanteBotao
        v-if="q.data.value?.proxima"
        :rotulo="t('operadora.f1.proxima')"
        variante="texto"
        @acionar="pagina = [...pagina, q.data.value!.proxima!]"
      />
      <SanteBotao
        v-if="tela.acoes.editar && !aberto && produtos.length"
        :rotulo="t('operadora.f1.novo')"
        variante="secundario"
        data-testid="contrato-incluir"
        @acionar="abrir('novo')"
      />
    </div>
    <form v-if="aberto" class="campos" data-testid="form-contrato" @submit.prevent="gravar">
      <SanteSelecao
        v-model="produto"
        :rotulo="t('operadora.f1.contrato.produto')"
        :opcoes="opcoesProduto"
        :desabilitado="travado"
        data-testid="contrato-produto"
      />
      <SanteCampoTexto
        v-model="numero"
        :rotulo="t('operadora.f1.contrato.numero')"
        :max-bytes="20"
        obrigatorio
      />
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('operadora.f1.contrato.tipo')"
        :opcoes="opcoesTipo"
        :desabilitado="travado"
        data-testid="contrato-tipo"
      />
      <p v-if="travado" data-testid="contrato-travado">{{ t('operadora.f1.contrato.travado') }}</p>
      <SanteCampoTexto
        v-model="contratanteNome"
        :rotulo="t('operadora.f1.contrato.contratante')"
        :max-bytes="120"
        obrigatorio
      />
      <SanteCampoTexto
        v-model="contratanteDocumento"
        :rotulo="t('operadora.f1.contrato.documento')"
        :max-bytes="18"
        obrigatorio
      />
      <SanteSelecao
        v-model="formaReajuste"
        :rotulo="t('operadora.f1.contrato.formaReajuste')"
        :opcoes="opcoesReajuste"
      />
      <SanteSelecao
        v-model="mesReajuste"
        :rotulo="t('operadora.f1.contrato.mesReajuste')"
        :opcoes="opcoesMes"
      />
      <SanteSelecao
        v-model="tipoVigencia"
        :rotulo="t('operadora.f1.contrato.tipoVigencia')"
        :opcoes="opcoesVigencia"
        data-testid="contrato-vigencia"
      />
      <SanteData v-model="inicio" :rotulo="t('operadora.f1.contrato.inicio')" editavel />
      <SanteData v-if="tipoVigencia === 1" v-model="fim" :rotulo="t('operadora.f1.contrato.fim')" editavel />
      <SanteSelecao
        v-model="diaVencimento"
        :rotulo="t('operadora.f1.contrato.diaVencimento')"
        :opcoes="opcoesDia"
      />
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('operadora.f1.situacao')"
        :opcoes="opcoesSituacao"
        data-testid="contrato-situacao"
      />
      <SanteCampoTexto
        v-if="situacao !== 'ativo'"
        v-model="motivoSituacao"
        :rotulo="t('operadora.f1.contrato.motivoSituacao')"
        :max-bytes="200"
      />
      <div class="acoes">
        <SanteBotao
          :rotulo="t('operadora.f1.gravar')"
          variante="primario"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="contrato-gravar"
        />
        <SanteBotao :rotulo="t('operadora.f1.cancelar')" variante="texto" @acionar="aberto = null" />
      </div>
    </form>
    <ErroOperadora v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped src="../../estilo-operadora.css"></style>
