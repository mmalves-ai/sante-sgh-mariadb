<script setup lang="ts">
// Cadastro do analito (campo de resultado) do catálogo do diagnóstico (F3.5, análise 05-SADT linha 3), dentro da tela
// `/sadt/catalogo`. Busca, inclui e altera o analito da rede; sair é inativar (o resultado antigo continua apontando
// para ele). Melhorias: a regra do domínio (validarAnalito) confere cada campo na hora, antes de enviar; a unidade e o
// método vêm por seletor, nunca por id digitado; a alteração manda só o que a tela mostra, com a versão vista.
import { TIPOS_RESULTADO_ANALITO, validarAnalito } from '@sgh/dominio-sadt';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, reactive, ref } from 'vue';
import { z } from 'zod';
import { enviar, ler } from '../../exames/api-exames.js';
import { novaChave } from '../api-sadt.js';

type Linha = Record<string, unknown>;
type Opcao = { id: number; nome: string };
type ValorCombo = string | number | null;
const props = defineProps<{
  unidades: readonly Opcao[] | undefined;
  metodos: readonly Opcao[] | undefined;
}>();
const emit = defineEmits<{ gravado: [] }>();
const B = '/api/sadt/catalogo/analitos';
const qualquer = z.any();

const T = {
  titulo: 'Analitos (campos de resultado)',
  busca: 'Nome, código ou sigla',
  buscar: 'Buscar',
  novo: 'Novo analito',
  codigo: 'Código',
  nome: 'Nome',
  sigla: 'Sigla',
  tituloLaudo: 'Título no laudo',
  tipo: 'Tipo de resultado',
  casas: 'Casas decimais',
  unidade: 'Unidade',
  metodo: 'Método',
  loinc: 'Código LOINC',
  minimo: 'Mínimo aceito',
  maximo: 'Máximo aceito',
  obrigatorio: 'Resultado obrigatório',
  imprime: 'Imprime no laudo',
  pula: 'Pula na digitação',
  ativo: 'Ativo',
  gravar: 'Gravar analito',
  escolha: 'Escolha',
  gravado: 'Analito gravado.',
} as const;

const termo = ref('');
const lista = ref<Linha[]>([]);
const erro = ref('');
const aviso = ref('');
const a = reactive<Linha>({});
const aberto = computed(() => a['codigo'] !== undefined);

const numOuNulo = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));
const valorDe = (k: string): ValorCombo => {
  const v = a[k];
  return typeof v === 'string' || typeof v === 'number' ? v : '';
};
const opLista = (xs: readonly Opcao[] | undefined) => [
  { valor: '' as ValorCombo, rotulo: T.escolha },
  ...(xs ?? []).map((o) => ({ valor: o.id as ValorCombo, rotulo: o.nome })),
];

async function buscar() {
  lista.value = (await ler(`${B}?${new URLSearchParams({ termo: termo.value })}`, qualquer)) as Linha[];
}
function preencher(l: Linha) {
  for (const k of Object.keys(a)) delete a[k];
  Object.assign(a, l);
}
const novo = () =>
  preencher({
    codigo: '',
    nome: '',
    sigla: '',
    tipoResultado: 'numerico',
    resultadoObrigatorio: true,
    imprimeNoLaudo: true,
    pulaNaDigitacao: false,
    ativo: true,
  });

const texto = (k: string) => (String(a[k] ?? '').trim() === '' ? null : String(a[k]).trim());
const corpo = computed(() => ({
  ...(a['id'] ? { versao: Number(a['versao']) } : {}),
  codigo: String(a['codigo'] ?? '').trim(),
  nome: String(a['nome'] ?? '').trim(),
  sigla: texto('sigla'),
  tituloLaudo: texto('tituloLaudo'),
  tipoResultado: String(a['tipoResultado'] ?? ''),
  casasDecimais: numOuNulo(a['casasDecimais']),
  unidadeResultadoId: numOuNulo(a['unidadeResultadoId']),
  metodoAnaliticoId: numOuNulo(a['metodoAnaliticoId']),
  codigoLoinc: texto('codigoLoinc'),
  limiteMinimoAceito: numOuNulo(a['limiteMinimoAceito']),
  limiteMaximoAceito: numOuNulo(a['limiteMaximoAceito']),
  resultadoObrigatorio: Boolean(a['resultadoObrigatorio']),
  imprimeNoLaudo: Boolean(a['imprimeNoLaudo']),
  pulaNaDigitacao: Boolean(a['pulaNaDigitacao']),
  ativo: Boolean(a['ativo']),
}));
/** A regra do domínio conferida na hora, campo a campo. */
const falhas = computed(() => {
  const r: Record<string, string> = {};
  for (const f of validarAnalito(corpo.value))
    r[f.campo] = r[f.campo] ? `${r[f.campo]} ${f.mensagem}` : f.mensagem;
  return r;
});

async function gravar() {
  erro.value = '';
  aviso.value = '';
  try {
    const id = a['id'] ? Number(a['id']) : null;
    const r = (await enviar(
      id ? `${B}/${id}` : B,
      corpo.value,
      qualquer,
      novaChave('catalogo.analito'),
    )) as Linha;
    termo.value = corpo.value.codigo;
    await buscar();
    const gravado = lista.value.find((l) => Number(l['id']) === Number(r['id']));
    if (gravado) preencher(gravado);
    aviso.value = T.gravado;
    emit('gravado');
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
}

onMounted(() => buscar().catch((e) => (erro.value = e instanceof Error ? e.message : String(e))));
</script>

<template>
  <section class="analitos" data-testid="cadastro-analitos">
    <h2>{{ T.titulo }}</h2>
    <form @submit.prevent="buscar">
      <input v-model="termo" :placeholder="T.busca" :aria-label="T.busca" />
      <SanteBotao :rotulo="T.buscar" tipo="submit" />
      <SanteBotao :rotulo="T.novo" data-testid="novo-analito" @acionar="novo" />
    </form>
    <ul>
      <li v-for="l in lista" :key="String(l['id'])">
        <button type="button" :class="{ inativo: !l['ativo'] }" @click="preencher(l)">
          {{ l['codigo'] }} · {{ l['nome']
          }}<span v-if="l['simboloUnidade']"> ({{ l['simboloUnidade'] }})</span>
        </button>
      </li>
    </ul>
    <p v-if="erro" role="alert" class="erro">{{ erro }}</p>
    <p v-if="aviso" role="status">{{ aviso }}</p>
    <form v-if="aberto" data-testid="form-analito" @submit.prevent="gravar">
      <label
        >{{ T.codigo }} <input v-model="a['codigo']" required maxlength="30" name="codigo-analito" />
        <small v-if="falhas['codigo']" class="erro">{{ falhas['codigo'] }}</small></label
      >
      <label
        >{{ T.nome }} <input v-model="a['nome']" required maxlength="150" name="nome-analito" />
        <small v-if="falhas['nome']" class="erro">{{ falhas['nome'] }}</small></label
      >
      <label>{{ T.sigla }} <input v-model="a['sigla']" maxlength="20" name="sigla-analito" /></label>
      <label>{{ T.tituloLaudo }} <input v-model="a['tituloLaudo']" maxlength="150" /></label>
      <div class="campo-selecao">
        <SanteSelecao
          :model-value="valorDe('tipoResultado')"
          :rotulo="T.tipo"
          :opcoes="TIPOS_RESULTADO_ANALITO.map((x) => ({ valor: x as ValorCombo, rotulo: x }))"
          data-testid="analito-tipo"
          @update:model-value="(v) => (a['tipoResultado'] = v)"
        />
        <small v-if="falhas['tipoResultado']" class="erro">{{ falhas['tipoResultado'] }}</small>
      </div>
      <label
        >{{ T.casas }} <input v-model="a['casasDecimais']" type="number" min="0" max="6" name="casas" />
        <small v-if="falhas['casasDecimais']" class="erro">{{ falhas['casasDecimais'] }}</small></label
      >
      <div class="campo-selecao">
        <SanteSelecao
          :model-value="valorDe('unidadeResultadoId')"
          :rotulo="T.unidade"
          :opcoes="opLista(props.unidades)"
          @update:model-value="(v) => (a['unidadeResultadoId'] = v)"
        />
        <small v-if="falhas['unidadeResultadoId']" class="erro">{{ falhas['unidadeResultadoId'] }}</small>
      </div>
      <div class="campo-selecao">
        <SanteSelecao
          :model-value="valorDe('metodoAnaliticoId')"
          :rotulo="T.metodo"
          :opcoes="opLista(props.metodos)"
          @update:model-value="(v) => (a['metodoAnaliticoId'] = v)"
        />
      </div>
      <label>{{ T.loinc }} <input v-model="a['codigoLoinc']" maxlength="10" pattern="\d{1,7}-\d" /></label>
      <label
        >{{ T.minimo }} <input v-model="a['limiteMinimoAceito']" type="number" step="any" name="minimo"
      /></label>
      <label
        >{{ T.maximo }} <input v-model="a['limiteMaximoAceito']" type="number" step="any" name="maximo" />
        <small v-if="falhas['limiteMaximoAceito']" class="erro">{{
          falhas['limiteMaximoAceito']
        }}</small></label
      >
      <label><input v-model="a['resultadoObrigatorio']" type="checkbox" /> {{ T.obrigatorio }}</label>
      <label><input v-model="a['imprimeNoLaudo']" type="checkbox" /> {{ T.imprime }}</label>
      <label
        ><input v-model="a['pulaNaDigitacao']" type="checkbox" /> {{ T.pula }}
        <small v-if="falhas['pulaNaDigitacao']" class="erro">{{ falhas['pulaNaDigitacao'] }}</small></label
      >
      <label><input v-model="a['ativo']" type="checkbox" name="ativo-analito" /> {{ T.ativo }}</label>
      <SanteBotao
        :rotulo="T.gravar"
        tipo="submit"
        data-testid="salvar-analito"
        :desabilitado="Object.keys(falhas).length > 0"
      />
    </form>
  </section>
</template>

<style scoped>
.inativo {
  opacity: 0.55;
  text-decoration: line-through;
}
.erro {
  color: var(--sgh-alerta);
}
form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
  margin: 0.5rem 0;
}
</style>
