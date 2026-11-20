<script setup lang="ts">
// O cadastro do contrato com fornecedor (suprimentos.criarContrato) e a alteração pela versão
// (suprimentos.alterarContrato): as partes, o objeto, a vigência, o valor, o reajuste, a garantia, o gestor e o fiscal
// (usuários diferentes, achados na busca) e o centro de custo. Na alteração o número, o fornecedor, a vigência e o valor
// ficam fixos (mudam só por evento). A tela confere o que dá antes de enviar; o servidor confere tudo de novo (o mesmo Zod).
import { GARANTIAS_CONTRATO, INDICES_REAJUSTE, TIPOS_CONTRATO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarContratoTela,
  buscarFornecedoresContrato,
  criarContratoTela,
  type DetalheContratoTela,
  lerCentrosContrato,
  novaChaveContrato,
} from '../api-contrato.js';
import { lerDinheiro } from './contrato-tela.js';
import BuscaCodigoNome from './BuscaCodigoNome.vue';
import BuscaUsuarioContrato from './BuscaUsuarioContrato.vue';
import ErroSuprimentos from './ErroSuprimentos.vue';

const props = defineProps<{ contrato?: DetalheContratoTela | null; pode: boolean }>();
const emit = defineEmits<{ gravado: [id: number, mensagem: string]; cancelar: [] }>();
const { t } = useI18n();
const k = (s: string) => t(`contratoFornecedor.formulario.${s}`);
const alterando = computed(() => !!props.contrato);
const c = props.contrato ?? null;
const dinheiroTexto = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : String(n).replace('.', ',');
const f = reactive({
  numero: c?.numero ?? '',
  fornecedor: (c?.fornecedor ?? null) as number | null,
  tipo: (c?.tipo ?? 'fornecimento') as string,
  objeto: c?.objeto ?? '',
  critico: c?.critico ?? false,
  inicio: c?.inicio ?? '',
  fim: c?.fimOriginal ?? '',
  valor: dinheiroTexto(c?.valorInicial),
  indiceReajuste: (c?.indiceReajuste ?? 'nenhum') as string,
  dataBase: c?.dataBase ?? '',
  garantia: (c?.garantia ?? 'nenhuma') as string,
  garantiaValor: dinheiroTexto(c?.garantiaValor),
  garantiaValidade: c?.garantiaValidade ?? '',
  gestor: c?.gestor ?? '',
  fiscal: c?.fiscal ?? '',
  centroCusto: (c?.centroCusto ?? null) as number | null,
  observacao: c?.observacao ?? '',
});
const centros = useQuery({ queryKey: ['contratos', 'centros'], queryFn: lerCentrosContrato });
const opcoesCentro = computed(() => [
  { valor: null as number | null, rotulo: k('semCentro') },
  ...(centros.data.value?.itens ?? []).map((x) => ({
    valor: x.codigo as number | null,
    rotulo: `${x.codigo} · ${x.nome}`,
  })),
  ...(c?.centroCusto && !(centros.data.value?.itens ?? []).some((x) => x.codigo === c.centroCusto)
    ? [{ valor: c.centroCusto as number | null, rotulo: `${c.centroCusto} · ${c.centroCustoNome ?? ''}` }]
    : []),
]);
const tipos = TIPOS_CONTRATO.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo }));
const indices = INDICES_REAJUSTE.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo }));
const garantias = GARANTIAS_CONTRATO.map((x) => ({ valor: x.codigo as string, rotulo: x.rotulo }));
const buscarFornecedor = (termo: string) => buscarFornecedoresContrato(termo);

const dinheiro = lerDinheiro;

const faltam = computed(() => {
  const xs: string[] = [];
  if (!alterando.value) {
    if (!f.numero.trim()) xs.push(k('numero'));
    if (f.fornecedor === null) xs.push(k('fornecedor'));
    if (!f.inicio) xs.push(k('inicio'));
    if (!f.fim) xs.push(k('fim'));
    if (!(dinheiro(f.valor) ?? 0)) xs.push(k('valor'));
  }
  if (f.objeto.trim().length < 10) xs.push(k('objeto'));
  if (f.indiceReajuste !== 'nenhum' && !f.dataBase) xs.push(k('dataBase'));
  if (f.garantia !== 'nenhuma' && !(dinheiro(f.garantiaValor) ?? 0)) xs.push(k('garantiaValor'));
  if (!f.gestor) xs.push(k('gestor'));
  if (!f.fiscal) xs.push(k('fiscal'));
  return xs;
});
const conflito = computed(() => {
  if (f.gestor && f.fiscal && f.gestor.toUpperCase() === f.fiscal.toUpperCase()) return k('mesmaPessoa');
  if (!alterando.value && f.inicio && f.fim && f.fim < f.inicio) return k('fimAntes');
  return null;
});
const erro = ref<unknown>(null);
const enviando = ref(false);
let chave = novaChaveContrato('criar');

async function gravar(): Promise<void> {
  if (faltam.value.length || conflito.value) return;
  erro.value = null;
  enviando.value = true;
  const comum = {
    objeto: f.objeto,
    critico: f.critico,
    indiceReajuste: f.indiceReajuste,
    dataBase: f.indiceReajuste === 'nenhum' ? null : f.dataBase || null,
    garantia: f.garantia,
    garantiaValor: f.garantia === 'nenhuma' ? null : dinheiro(f.garantiaValor),
    garantiaValidade: f.garantia === 'nenhuma' ? null : f.garantiaValidade || null,
    gestor: f.gestor,
    fiscal: f.fiscal,
    centroCusto: f.centroCusto,
    observacao: f.observacao.trim() || null,
  };
  try {
    const r = c
      ? await alterarContratoTela(c.id, { versao: c.versao, ...comum })
      : await criarContratoTela(
          {
            numero: f.numero,
            fornecedor: f.fornecedor,
            tipo: f.tipo,
            inicio: f.inicio,
            fim: f.fim,
            valor: dinheiro(f.valor),
            ...comum,
          },
          chave,
        );
    chave = novaChaveContrato('criar');
    emit('gravado', r.id, r.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <form class="formulario-contrato" data-testid="contrato-formulario" @submit.prevent="gravar">
    <h2>{{ alterando ? k('tituloAlterar') : k('tituloNovo') }}</h2>
    <p v-if="alterando" class="secundario">{{ k('explicaAlterar') }}</p>
    <div class="barra">
      <span class="campo">
        <label for="ctr-numero">{{ k('numero') }}</label>
        <input
          id="ctr-numero"
          v-model="f.numero"
          maxlength="30"
          :disabled="alterando"
          required
          data-testid="ctr-numero"
        />
      </span>
      <SanteSelecao
        v-model="f.tipo"
        :rotulo="k('tipo')"
        :opcoes="tipos"
        :desabilitado="alterando"
        data-testid="ctr-tipo"
      />
      <span class="campo">
        <input id="ctr-critico" v-model="f.critico" type="checkbox" data-testid="ctr-critico" />
        <label for="ctr-critico">{{ k('critico') }}</label>
      </span>
    </div>
    <div v-if="!alterando" class="barra">
      <BuscaCodigoNome
        v-model="f.fornecedor"
        :rotulo="k('fornecedor')"
        :rotulo-buscar="k('buscarFornecedor')"
        :rotulo-escolhido="k('fornecedorEscolhido')"
        :rotulo-nenhum="k('fornecedorNenhum')"
        :buscar="buscarFornecedor"
        testid="ctr-fornecedor"
      />
    </div>
    <p v-else>{{ k('fornecedor') }}: {{ c?.fornecedor }} · {{ c?.fornecedorNome }}</p>
    <span class="campo campo-largo">
      <label for="ctr-objeto">{{ k('objeto') }}</label>
      <textarea
        id="ctr-objeto"
        v-model="f.objeto"
        maxlength="400"
        rows="3"
        required
        data-testid="ctr-objeto"
      />
    </span>
    <div class="barra">
      <span class="campo">
        <label for="ctr-inicio">{{ k('inicio') }}</label>
        <input
          id="ctr-inicio"
          v-model="f.inicio"
          type="date"
          :disabled="alterando"
          data-testid="ctr-inicio"
        />
      </span>
      <span class="campo">
        <label for="ctr-fim">{{ k('fim') }}</label>
        <input id="ctr-fim" v-model="f.fim" type="date" :disabled="alterando" data-testid="ctr-fim" />
      </span>
      <span class="campo">
        <label for="ctr-valor">{{ k('valor') }}</label>
        <input
          id="ctr-valor"
          v-model="f.valor"
          inputmode="decimal"
          :disabled="alterando"
          data-testid="ctr-valor"
        />
      </span>
    </div>
    <div class="barra">
      <SanteSelecao
        v-model="f.indiceReajuste"
        :rotulo="k('indice')"
        :opcoes="indices"
        data-testid="ctr-indice"
      />
      <span v-if="f.indiceReajuste !== 'nenhum'" class="campo">
        <label for="ctr-database">{{ k('dataBase') }}</label>
        <input id="ctr-database" v-model="f.dataBase" type="date" data-testid="ctr-database" />
      </span>
      <SanteSelecao
        v-model="f.garantia"
        :rotulo="k('garantia')"
        :opcoes="garantias"
        data-testid="ctr-garantia"
      />
      <template v-if="f.garantia !== 'nenhuma'">
        <span class="campo">
          <label for="ctr-garantia-valor">{{ k('garantiaValor') }}</label>
          <input
            id="ctr-garantia-valor"
            v-model="f.garantiaValor"
            inputmode="decimal"
            data-testid="ctr-garantia-valor"
          />
        </span>
        <span class="campo">
          <label for="ctr-garantia-validade">{{ k('garantiaValidade') }}</label>
          <input
            id="ctr-garantia-validade"
            v-model="f.garantiaValidade"
            type="date"
            data-testid="ctr-garantia-validade"
          />
        </span>
      </template>
    </div>
    <div class="barra">
      <BuscaUsuarioContrato v-model="f.gestor" :rotulo="k('gestor')" testid="ctr-gestor" />
      <BuscaUsuarioContrato v-model="f.fiscal" :rotulo="k('fiscal')" testid="ctr-fiscal" />
    </div>
    <div class="barra">
      <SanteSelecao
        v-model="f.centroCusto"
        :rotulo="k('centro')"
        :opcoes="opcoesCentro"
        :busca="true"
        data-testid="ctr-centro"
      />
    </div>
    <span class="campo campo-largo">
      <label for="ctr-obs">{{ k('observacao') }}</label>
      <textarea id="ctr-obs" v-model="f.observacao" maxlength="1000" rows="2" data-testid="ctr-observacao" />
    </span>
    <SanteAlerta
      v-if="faltam.length"
      variante="info"
      :texto="t('contratoFornecedor.formulario.faltam', { campos: faltam.join(', ') })"
      data-testid="ctr-faltam"
    />
    <SanteAlerta v-if="conflito" variante="aviso" :texto="conflito" data-testid="ctr-conflito" />
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <div class="barra">
      <SanteBotao
        tipo="submit"
        :rotulo="alterando ? k('gravarAlterar') : k('gravarNovo')"
        :desabilitado="!pode || enviando || faltam.length > 0 || !!conflito"
        data-testid="ctr-gravar"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="k('cancelar')"
        data-testid="ctr-cancelar"
        @acionar="emit('cancelar')"
      />
    </div>
  </form>
</template>
