<script setup lang="ts">
// Composição e versões do pacote (F3.7, 06-FAT linha 20), aberta da tela de pacotes, sem trocar de tela:
// - versões: a lista com a vigência e o retrato da composição em que valeram; a nova versão começa depois da última e
//   a fecha na véspera (a data é conferida enquanto se digita, pela mesma regra do servidor);
// - exceções (cobrar à parte ou descaracterizar, por item, grupo, setor e acomodação), tetos (dias, quantidade, valor)
//   e diárias por acomodação (incluídas, item e valor da diária adicional): tudo num envio só; o que sai da lista fica
//   marcado no servidor, nada se apaga;
// - item, grupo, setor e acomodação escolhidos pelo nome (o item pela busca de código ou descrição), nunca por id
//   digitado; o lançamento automático do pacote ao lançar o procedimento é ligado aqui.
import { validarNovaVersao } from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarItensComposicao,
  gravarComposicaoPacote,
  lerComposicaoPacote,
  versionarPacote,
  type ComposicaoDoPacote,
  type OpcaoCadastro,
} from '../api-ajustes.js';
import { novaChave } from '../api-faturamento.js';
import ErroFaturamento from './ErroFaturamento.vue';
import MensagemFaturamento from './MensagemFaturamento.vue';

const props = defineProps<{ pacote: number }>();
const emit = defineEmits<{ fechar: [] }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Composição e versões do pacote {p}',
      fechar: 'Fechar',
      versoes: 'Versões',
      versao: 'Versão',
      inicio: 'Início',
      fim: 'Fim',
      valor: 'Valor',
      diarias: 'Diárias incluídas',
      vigente: 'vigente',
      novaVersao: 'Nova versão',
      criarVersao: 'Criar a versão',
      excecoes: 'Exceções',
      tetos: 'Tetos',
      diariasAcomodacao: 'Diárias por acomodação',
      item: 'Item',
      grupo: 'Grupo',
      setor: 'Setor',
      acomodacao: 'Acomodação',
      efeito: 'Efeito',
      cobrarAParte: 'Cobra à parte',
      descaracteriza: 'Descaracteriza',
      dias: 'Dias',
      quantidade: 'Quantidade',
      descaracterizaTeto: 'Passar descaracteriza',
      itemAdicional: 'Item da diária adicional',
      valorAdicional: 'Valor da diária adicional',
      acrescentar: 'Acrescentar',
      retirar: 'Retirar',
      gravar: 'Gravar a composição',
      gravado: 'Gravado.',
      alvo: 'Informe o item ou o grupo.',
      limiteTeto: 'Informe ao menos um teto (dias, quantidade ou valor).',
      negativo: 'Não pode ser negativo.',
      acomodacaoRepetida: 'Acomodação repetida.',
      vazio: 'Nada cadastrado.',
      nenhum: '(qualquer)',
      buscarItem: 'Buscar item (código ou descrição)',
      buscaCurta: 'Digite ao menos 2 letras.',
      achados: '{n} item(ns) achado(s): escolha na lista do item.',
      lancamentoAutomatico: 'Lançar o pacote na conta ao lançar o procedimento do pacote',
      acomodacaoObrigatoria: 'Escolha a acomodação.',
    },
  },
});
const qc = useQueryClient();
const q = useQuery({
  queryKey: computed(() => ['faturamento', 'pacote-composicao', props.pacote]),
  queryFn: () => lerComposicaoPacote(props.pacote),
});
type Edicao = Pick<ComposicaoDoPacote, 'excecoes' | 'tetos' | 'diarias' | 'lancamentoAutomatico'>;
const ed = reactive<Edicao>({ excecoes: [], tetos: [], diarias: [], lancamentoAutomatico: false });
watch(
  () => q.data.value,
  (d) => {
    if (!d) return;
    ed.excecoes = d.excecoes.map((x) => ({ ...x }));
    ed.tetos = d.tetos.map((x) => ({ ...x }));
    ed.diarias = d.diarias.map((x) => ({ ...x }));
    ed.lancamentoAutomatico = d.lancamentoAutomatico;
  },
  { immediate: true },
);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function acao(f: () => Promise<unknown>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    await f();
    mensagem.value = t('gravado');
    await qc.invalidateQueries({ queryKey: ['faturamento'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

// Nova versão: conferida enquanto se digita (a mesma regra do servidor).
const nova = reactive({ vigenciaInicio: '', valor: null as number | null, diarias: null as number | null });
const errosVersao = computed(() =>
  nova.vigenciaInicio
    ? validarNovaVersao(q.data.value?.versoes ?? [], nova.vigenciaInicio, nova.valor)
    : { vigenciaInicio: '' },
);
const versaoValida = computed(() => Object.keys(errosVersao.value).length === 0);
function criarVersao() {
  return acao(() =>
    versionarPacote(
      props.pacote,
      { vigenciaInicio: nova.vigenciaInicio, valor: nova.valor, quantidadeDiarias: nova.diarias },
      novaChave('pacote-versao'),
    ),
  );
}

// Composição: cada linha conferida na hora.
const neg = (v: number | null) => v !== null && v < 0;
const errosExcecao = computed(() =>
  ed.excecoes.map((x) => (x.itemId === null && x.grupoId === null ? t('alvo') : null)),
);
const errosTeto = computed(() =>
  ed.tetos.map((x) =>
    x.diasTeto === null && x.quantidadeTeto === null && x.valorTeto === null
      ? t('limiteTeto')
      : neg(x.diasTeto) || neg(x.quantidadeTeto) || neg(x.valorTeto)
        ? t('negativo')
        : null,
  ),
);
const errosDiaria = computed(() =>
  ed.diarias.map((x, i) =>
    neg(x.quantidadeDiarias) || neg(x.valorDiariaAdicional)
      ? t('negativo')
      : !(x.categoriaAcomodacaoId > 0)
        ? t('acomodacaoObrigatoria')
        : ed.diarias.findIndex((y) => y.categoriaAcomodacaoId === x.categoriaAcomodacaoId) !== i
          ? t('acomodacaoRepetida')
          : null,
  ),
);
const composicaoValida = computed(
  () =>
    !errosExcecao.value.some(Boolean) &&
    !errosTeto.value.some(Boolean) &&
    !errosDiaria.value.some(Boolean) &&
    ed.diarias.every((d) => d.categoriaAcomodacaoId > 0),
);
const numOuNulo = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

// Escolhas pelo nome: o vazio (0) é "qualquer"; o item vem dos já usados e da busca por código ou descrição.
const rotuloDe = (o: OpcaoCadastro) => `${o.codigo} - ${o.descricao}`;
const lista = (xs: readonly OpcaoCadastro[], vazio: string) => [
  { valor: 0, rotulo: vazio },
  ...xs.map((o) => ({ valor: o.id, rotulo: rotuloDe(o) })),
];
const termo = ref('');
const achados = ref<OpcaoCadastro[]>([]);
let pedido = 0;
watch(termo, async (v) => {
  const meu = ++pedido;
  if (v.trim().length < 2) {
    achados.value = [];
    return;
  }
  try {
    const r = await buscarItensComposicao(v.trim());
    if (meu === pedido) achados.value = r;
  } catch (e) {
    if (meu === pedido) erro.value = e;
  }
});
const opGrupos = computed(() => lista(q.data.value?.opcoes.grupos ?? [], t('nenhum')));
const opSetores = computed(() => lista(q.data.value?.opcoes.setores ?? [], t('nenhum')));
const opAcomodacoes = computed(() => lista(q.data.value?.opcoes.acomodacoes ?? [], t('nenhum')));
const opItens = computed(() => {
  const vistos = new Map<number, OpcaoCadastro>();
  for (const i of [...(q.data.value?.opcoes.itens ?? []), ...achados.value]) vistos.set(i.id, i);
  return lista([...vistos.values()], t('nenhum'));
});
const idOuNulo = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
const efeitos = computed(() => [
  { valor: 'cobrar_a_parte', rotulo: t('cobrarAParte') },
  { valor: 'descaracteriza', rotulo: t('descaracteriza') },
]);
function gravar() {
  return acao(() =>
    gravarComposicaoPacote(
      props.pacote,
      {
        excecoes: ed.excecoes,
        tetos: ed.tetos,
        diarias: ed.diarias,
        lancamentoAutomatico: ed.lancamentoAutomatico,
      },
      novaChave('pacote-composicao'),
    ),
  );
}
</script>

<template>
  <section class="composicao" aria-labelledby="pc-titulo" data-testid="pacote-composicao">
    <ErroFaturamento v-if="q.isError.value" :erro="q.error.value" />
    <template v-else-if="q.data.value">
      <h3 id="pc-titulo">
        {{ t('titulo', { p: `${q.data.value.codigo} - ${q.data.value.descricao}` }) }}
        <button type="button" data-testid="pc-fechar" @click="emit('fechar')">{{ t('fechar') }}</button>
      </h3>
      <ErroFaturamento v-if="erro" :erro="erro" />
      <MensagemFaturamento v-if="mensagem" :texto="mensagem" />

      <h4>{{ t('versoes') }}</h4>
      <table class="tabela" data-testid="pc-versoes">
        <thead>
          <tr>
            <th scope="col">{{ t('versao') }}</th>
            <th scope="col">{{ t('inicio') }}</th>
            <th scope="col">{{ t('fim') }}</th>
            <th scope="col">{{ t('valor') }}</th>
            <th scope="col">{{ t('diarias') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!q.data.value.versoes.length">
            <td colspan="5">{{ t('vazio') }}</td>
          </tr>
          <tr v-for="v in q.data.value.versoes" :key="v.id">
            <td>{{ v.numero }}</td>
            <td>{{ v.vigenciaInicio }}</td>
            <td>{{ v.vigenciaFim ?? t('vigente') }}</td>
            <td>{{ v.valor ?? '' }}</td>
            <td>{{ v.quantidadeDiarias ?? '' }}</td>
          </tr>
        </tbody>
      </table>
      <form class="filtros" data-testid="pc-nova-versao" @submit.prevent="criarVersao">
        <span class="campo">
          <label for="pc-ini">{{ t('inicio') }}</label>
          <input id="pc-ini" v-model="nova.vigenciaInicio" type="date" data-testid="pc-ini" />
          <small v-if="errosVersao['vigenciaInicio']" class="erro" data-testid="pc-erro-ini">
            {{ errosVersao['vigenciaInicio'] }}
          </small>
        </span>
        <span class="campo">
          <label for="pc-valor">{{ t('valor') }}</label>
          <input
            id="pc-valor"
            :value="nova.valor ?? ''"
            inputmode="decimal"
            data-testid="pc-valor"
            @input="nova.valor = numOuNulo(($event.target as HTMLInputElement).value)"
          />
          <small v-if="errosVersao['valor']" class="erro">{{ errosVersao['valor'] }}</small>
        </span>
        <span class="campo">
          <label for="pc-diarias">{{ t('diarias') }}</label>
          <input
            id="pc-diarias"
            :value="nova.diarias ?? ''"
            inputmode="numeric"
            data-testid="pc-diarias"
            @input="nova.diarias = numOuNulo(($event.target as HTMLInputElement).value)"
          />
        </span>
        <button type="submit" :disabled="gravando || !versaoValida" data-testid="pc-criar-versao">
          {{ t('criarVersao') }}
        </button>
      </form>

      <form data-testid="pc-composicao" @submit.prevent="gravar">
        <label class="campo">
          <input v-model="ed.lancamentoAutomatico" type="checkbox" data-testid="pc-lancamento-automatico" />
          {{ t('lancamentoAutomatico') }}
        </label>
        <span class="campo">
          <label for="pc-busca-item">{{ t('buscarItem') }}</label>
          <input
            id="pc-busca-item"
            v-model="termo"
            type="search"
            autocomplete="off"
            data-testid="pc-busca-item"
          />
          <small v-if="termo.trim().length === 1">{{ t('buscaCurta') }}</small>
          <small v-else-if="achados.length" data-testid="pc-achados">{{
            t('achados', { n: achados.length })
          }}</small>
        </span>
        <h4>{{ t('excecoes') }}</h4>
        <div v-for="(x, i) in ed.excecoes" :key="`e${i}`" class="filtros" :data-testid="`pc-excecao-${i}`">
          <span class="campo">
            <SanteSelecao
              :model-value="x.itemId ?? 0"
              @update:model-value="x.itemId = idOuNulo($event)"
              :rotulo="t('item')"
              :opcoes="opItens"
              :data-testid="`pc-ex-item-${i}`"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              :model-value="x.grupoId ?? 0"
              @update:model-value="x.grupoId = idOuNulo($event)"
              :rotulo="t('grupo')"
              :opcoes="opGrupos"
              :data-testid="`pc-ex-grupo-${i}`"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              :model-value="x.setorId ?? 0"
              @update:model-value="x.setorId = idOuNulo($event)"
              :rotulo="t('setor')"
              :opcoes="opSetores"
              :data-testid="`pc-ex-setor-${i}`"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              :model-value="x.categoriaAcomodacaoId ?? 0"
              @update:model-value="x.categoriaAcomodacaoId = idOuNulo($event)"
              :rotulo="t('acomodacao')"
              :opcoes="opAcomodacoes"
              :data-testid="`pc-ex-acom-${i}`"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              v-model="x.efeito"
              :rotulo="t('efeito')"
              :opcoes="efeitos"
              :data-testid="`pc-ex-efeito-${i}`"
            />
          </span>
          <button type="button" @click="ed.excecoes.splice(i, 1)">{{ t('retirar') }}</button>
          <small v-if="errosExcecao[i]" class="erro" :data-testid="`pc-erro-excecao-${i}`">
            {{ errosExcecao[i] }}
          </small>
        </div>
        <button
          type="button"
          data-testid="pc-mais-excecao"
          @click="
            ed.excecoes.push({
              itemId: null,
              grupoId: null,
              setorId: null,
              categoriaAcomodacaoId: null,
              efeito: 'cobrar_a_parte',
            })
          "
        >
          {{ t('acrescentar') }}
        </button>

        <h4>{{ t('tetos') }}</h4>
        <div v-for="(x, i) in ed.tetos" :key="`t${i}`" class="filtros" :data-testid="`pc-teto-${i}`">
          <span class="campo">
            <SanteSelecao
              :model-value="x.grupoId ?? 0"
              @update:model-value="x.grupoId = idOuNulo($event)"
              :rotulo="t('grupo')"
              :opcoes="opGrupos"
              :data-testid="`pc-te-grupo-${i}`"
            />
          </span>
          <span class="campo">
            <label :for="`pc-te-dias-${i}`">{{ t('dias') }}</label>
            <input
              :id="`pc-te-dias-${i}`"
              :value="x.diasTeto ?? ''"
              inputmode="numeric"
              :data-testid="`pc-te-dias-${i}`"
              @input="x.diasTeto = numOuNulo(($event.target as HTMLInputElement).value)"
            />
          </span>
          <span class="campo">
            <label :for="`pc-te-qtd-${i}`">{{ t('quantidade') }}</label>
            <input
              :id="`pc-te-qtd-${i}`"
              :value="x.quantidadeTeto ?? ''"
              inputmode="decimal"
              @input="x.quantidadeTeto = numOuNulo(($event.target as HTMLInputElement).value)"
            />
          </span>
          <span class="campo">
            <label :for="`pc-te-valor-${i}`">{{ t('valor') }}</label>
            <input
              :id="`pc-te-valor-${i}`"
              :value="x.valorTeto ?? ''"
              inputmode="decimal"
              @input="x.valorTeto = numOuNulo(($event.target as HTMLInputElement).value)"
            />
          </span>
          <label class="campo"
            ><input v-model="x.descaracteriza" type="checkbox" /> {{ t('descaracterizaTeto') }}</label
          >
          <button type="button" @click="ed.tetos.splice(i, 1)">{{ t('retirar') }}</button>
          <small v-if="errosTeto[i]" class="erro" :data-testid="`pc-erro-teto-${i}`">{{
            errosTeto[i]
          }}</small>
        </div>
        <button
          type="button"
          data-testid="pc-mais-teto"
          @click="
            ed.tetos.push({
              grupoId: null,
              diasTeto: null,
              quantidadeTeto: null,
              valorTeto: null,
              descaracteriza: true,
            })
          "
        >
          {{ t('acrescentar') }}
        </button>

        <h4>{{ t('diariasAcomodacao') }}</h4>
        <div v-for="(x, i) in ed.diarias" :key="`d${i}`" class="filtros" :data-testid="`pc-diaria-${i}`">
          <span class="campo">
            <SanteSelecao
              :model-value="x.categoriaAcomodacaoId"
              @update:model-value="x.categoriaAcomodacaoId = idOuNulo($event) ?? 0"
              :rotulo="t('acomodacao')"
              :opcoes="opAcomodacoes"
              :data-testid="`pc-di-acom-${i}`"
            />
          </span>
          <span class="campo">
            <label :for="`pc-di-qtd-${i}`">{{ t('diarias') }}</label>
            <input
              :id="`pc-di-qtd-${i}`"
              :value="x.quantidadeDiarias"
              inputmode="numeric"
              :data-testid="`pc-di-qtd-${i}`"
              @input="x.quantidadeDiarias = numOuNulo(($event.target as HTMLInputElement).value) ?? 0"
            />
          </span>
          <span class="campo">
            <SanteSelecao
              :model-value="x.diariaItemId ?? 0"
              @update:model-value="x.diariaItemId = idOuNulo($event)"
              :rotulo="t('itemAdicional')"
              :opcoes="opItens"
              :data-testid="`pc-di-item-${i}`"
            />
          </span>
          <span class="campo">
            <label :for="`pc-di-valor-${i}`">{{ t('valorAdicional') }}</label>
            <input
              :id="`pc-di-valor-${i}`"
              :value="x.valorDiariaAdicional ?? ''"
              inputmode="decimal"
              @input="x.valorDiariaAdicional = numOuNulo(($event.target as HTMLInputElement).value)"
            />
          </span>
          <button type="button" @click="ed.diarias.splice(i, 1)">{{ t('retirar') }}</button>
          <small v-if="errosDiaria[i]" class="erro" :data-testid="`pc-erro-diaria-${i}`">{{
            errosDiaria[i]
          }}</small>
        </div>
        <button
          type="button"
          data-testid="pc-mais-diaria"
          @click="
            ed.diarias.push({
              categoriaAcomodacaoId: 0,
              quantidadeDiarias: 0,
              diariaItemId: null,
              valorDiariaAdicional: null,
            })
          "
        >
          {{ t('acrescentar') }}
        </button>
        <p>
          <button type="submit" :disabled="gravando || !composicaoValida" data-testid="pc-gravar">
            {{ t('gravar') }}
          </button>
        </p>
      </form>
    </template>
  </section>
</template>

<style scoped>
.erro {
  color: var(--sgh-alerta-texto);
}
/* Alvo de toque mínimo (WCAG 2.5.8). */
input[type='checkbox'] {
  inline-size: 1.5rem;
  block-size: 1.5rem;
}
</style>
