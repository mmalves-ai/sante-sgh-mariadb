<script setup lang="ts">
// Composição e versões do pacote (F3.7, 06-FAT linha 20), aberta da tela de pacotes, sem trocar de tela:
// - versões: a lista com a vigência e o retrato da composição em que valeram; a nova versão começa depois da última e
//   a fecha na véspera (a data é conferida enquanto se digita, pela mesma regra do servidor);
// - exceções (cobrar à parte ou descaracterizar, por item, grupo, setor e acomodação), tetos (dias, quantidade, valor)
//   e diárias por acomodação (incluídas, item e valor da diária adicional): tudo num envio só; o que sai da lista fica
//   marcado no servidor, nada se apaga.
import { validarNovaVersao } from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  gravarComposicaoPacote,
  lerComposicaoPacote,
  versionarPacote,
  type ComposicaoDoPacote,
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
      item: 'Item (id)',
      grupo: 'Grupo (id)',
      setor: 'Setor (id)',
      acomodacao: 'Acomodação (id)',
      efeito: 'Efeito',
      cobrarAParte: 'Cobra à parte',
      descaracteriza: 'Descaracteriza',
      dias: 'Dias',
      quantidade: 'Quantidade',
      descaracterizaTeto: 'Passar descaracteriza',
      itemAdicional: 'Item da diária adicional (id)',
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
    },
  },
});
const qc = useQueryClient();
const q = useQuery({
  queryKey: computed(() => ['faturamento', 'pacote-composicao', props.pacote]),
  queryFn: () => lerComposicaoPacote(props.pacote),
});
type Edicao = Pick<ComposicaoDoPacote, 'excecoes' | 'tetos' | 'diarias'>;
const ed = reactive<Edicao>({ excecoes: [], tetos: [], diarias: [] });
watch(
  () => q.data.value,
  (d) => {
    if (!d) return;
    ed.excecoes = d.excecoes.map((x) => ({ ...x }));
    ed.tetos = d.tetos.map((x) => ({ ...x }));
    ed.diarias = d.diarias.map((x) => ({ ...x }));
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
const efeitos = computed(() => [
  { valor: 'cobrar_a_parte', rotulo: t('cobrarAParte') },
  { valor: 'descaracteriza', rotulo: t('descaracteriza') },
]);
function gravar() {
  return acao(() =>
    gravarComposicaoPacote(
      props.pacote,
      { excecoes: ed.excecoes, tetos: ed.tetos, diarias: ed.diarias },
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
        <h4>{{ t('excecoes') }}</h4>
        <div v-for="(x, i) in ed.excecoes" :key="`e${i}`" class="filtros" :data-testid="`pc-excecao-${i}`">
          <span class="campo">
            <label :for="`pc-ex-item-${i}`">{{ t('item') }}</label>
            <input
              :id="`pc-ex-item-${i}`"
              :value="x.itemId ?? ''"
              inputmode="numeric"
              :data-testid="`pc-ex-item-${i}`"
              @input="x.itemId = numOuNulo(($event.target as HTMLInputElement).value)"
            />
          </span>
          <span class="campo">
            <label :for="`pc-ex-grupo-${i}`">{{ t('grupo') }}</label>
            <input
              :id="`pc-ex-grupo-${i}`"
              :value="x.grupoId ?? ''"
              inputmode="numeric"
              @input="x.grupoId = numOuNulo(($event.target as HTMLInputElement).value)"
            />
          </span>
          <span class="campo">
            <label :for="`pc-ex-setor-${i}`">{{ t('setor') }}</label>
            <input
              :id="`pc-ex-setor-${i}`"
              :value="x.setorId ?? ''"
              inputmode="numeric"
              @input="x.setorId = numOuNulo(($event.target as HTMLInputElement).value)"
            />
          </span>
          <span class="campo">
            <label :for="`pc-ex-acom-${i}`">{{ t('acomodacao') }}</label>
            <input
              :id="`pc-ex-acom-${i}`"
              :value="x.categoriaAcomodacaoId ?? ''"
              inputmode="numeric"
              @input="x.categoriaAcomodacaoId = numOuNulo(($event.target as HTMLInputElement).value)"
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
            <label :for="`pc-te-grupo-${i}`">{{ t('grupo') }}</label>
            <input
              :id="`pc-te-grupo-${i}`"
              :value="x.grupoId ?? ''"
              inputmode="numeric"
              @input="x.grupoId = numOuNulo(($event.target as HTMLInputElement).value)"
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
            <label :for="`pc-di-acom-${i}`">{{ t('acomodacao') }}</label>
            <input
              :id="`pc-di-acom-${i}`"
              :value="x.categoriaAcomodacaoId || ''"
              inputmode="numeric"
              :data-testid="`pc-di-acom-${i}`"
              @input="x.categoriaAcomodacaoId = numOuNulo(($event.target as HTMLInputElement).value) ?? 0"
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
            <label :for="`pc-di-item-${i}`">{{ t('itemAdicional') }}</label>
            <input
              :id="`pc-di-item-${i}`"
              :value="x.diariaItemId ?? ''"
              inputmode="numeric"
              @input="x.diariaItemId = numOuNulo(($event.target as HTMLInputElement).value)"
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
</style>
