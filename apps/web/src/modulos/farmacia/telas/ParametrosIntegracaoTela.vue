<script setup lang="ts">
// Parâmetros da integração prescrição × estoque (F3.6, 05-SUP linha 7): `/farmacia/parametros`. Numa tela só, a
// regra que diz qual local atende a prescrição de cada escopo (centro de custo, setor ou unidade), em que momento e de
// que forma, e a grade de horários padrão de cada frequência. A validação roda na hora (as mesmas regras da API) e a
// gravação vai ao Executor. Nada se apaga: a regra se inativa; o horário que sai da grade fica inativo.
import type { RegraIntegracaoLida } from '@sgh/contratos';
import {
  conferirHorariosPadrao,
  conferirRegraIntegracao,
  FORMAS_DISPENSACAO,
  MOMENTOS_INTEGRACAO,
  TIPOS_INTEGRACAO,
} from '@sgh/contratos/regras-suprimentos';
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  gravarHorariosPadrao,
  gravarRegraIntegracao,
  lerParametrosEditaveis,
  novaChave,
} from '../api-farmacia.js';
import ErroFarmacia from '../componentes/ErroFarmacia.vue';

const { t } = useI18n();
const p = useQuery({
  queryKey: ['farmacia', 'parametros', 'editaveis'],
  queryFn: () => lerParametrosEditaveis(),
});
const opcoes = computed(() => p.data.value?.opcoes);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

type Form = {
  regra?: number;
  versao?: number;
  centroCusto: number | null;
  setor: number | null;
  unidade: number | null;
  tipoItem: number | null;
  grupo: number | null;
  subgrupo: number | null;
  item: number | null;
  localAtendente: number | null;
  localSubstituto: number | null;
  tipoIntegracao: (typeof TIPOS_INTEGRACAO)[number];
  momento: (typeof MOMENTOS_INTEGRACAO)[number];
  antecedenciaMinutos: number | null;
  forma: (typeof FORMAS_DISPENSACAO)[number];
  geraManipulacao: boolean;
  prioridade: number;
  ativo: boolean;
};
const vazio = (): Form => ({
  centroCusto: null,
  setor: null,
  unidade: null,
  tipoItem: null,
  grupo: null,
  subgrupo: null,
  item: null,
  localAtendente: null,
  localSubstituto: null,
  tipoIntegracao: 'requisicao_automatica',
  momento: 'na_prescricao',
  antecedenciaMinutos: null,
  forma: 'dose_individualizada',
  geraManipulacao: false,
  prioridade: 100,
  ativo: true,
});
const form = ref<Form>(vazio());
/** O subgrupo só entre os do grupo escolhido; o item, só entre os do subgrupo escolhido. */
const subgruposDoGrupo = computed(() =>
  (opcoes.value?.subgrupos ?? []).filter((s) => form.value.grupo === null || s.grupo === form.value.grupo),
);
const itensDoSubgrupo = computed(() =>
  form.value.subgrupo === null
    ? []
    : (opcoes.value?.itens ?? []).filter((i) => i.subgrupo === form.value.subgrupo),
);
function escolherGrupo(v: number | null): void {
  form.value.grupo = v;
  form.value.subgrupo = null;
  form.value.item = null;
}
function escolherSubgrupo(v: number | null): void {
  form.value.subgrupo = v;
  form.value.item = null;
}
const nulo = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));

/** As recusas na hora, pelas mesmas regras da API. */
const recusasRegra = computed(() => {
  const f = form.value;
  const rs = conferirRegraIntegracao({ ...f, localAtendente: f.localAtendente ?? 0 }).map((r) => r.mensagem);
  if (f.localAtendente === null) rs.unshift(t('farmacia.parametros.semLocal'));
  return rs;
});

function editar(r: RegraIntegracaoLida): void {
  const resto: Partial<RegraIntegracaoLida> = { ...r };
  delete resto.escopoNome;
  delete resto.localNome;
  form.value = { ...vazio(), ...resto };
  mensagem.value = null;
}

async function gravarRegra(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  if (recusasRegra.value.length) return;
  try {
    const r = await gravarRegraIntegracao(form.value, novaChave('regra-integracao'));
    mensagem.value = r.mensagem;
    form.value = vazio();
    await p.refetch();
  } catch (x) {
    erro.value = x;
  }
}

// ── Grade de horários padrão ────────────────────────────────────────────────────────────────────────────
const frequencia = ref<number | null>(null);
const setorGrade = ref<number | null>(null);
/** Os horários digitados de uma vez: "06:00, 14:00, 22:00". */
const horariosTexto = ref('');
/** Os dias de cada horário (1 = domingo … 7 = sábado; vazio = todos os dias), preservados ao reabrir a grade. */
const diasPorHora = ref<Record<string, number[]>>({});
const DIAS = [1, 2, 3, 4, 5, 6, 7] as const;
const horas = computed(() =>
  horariosTexto.value
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (/^\d:\d\d$/.test(x) ? `0${x}` : x)),
);
const horarios = computed(() =>
  horas.value.map((hora) => ({ hora, dias: [...(diasPorHora.value[hora] ?? [])].sort((a, b) => a - b) })),
);
function alternarDia(hora: string, dia: number, marcado: boolean): void {
  const atuais = new Set(diasPorHora.value[hora] ?? []);
  if (marcado) atuais.add(dia);
  else atuais.delete(dia);
  diasPorHora.value = { ...diasPorHora.value, [hora]: [...atuais] };
}
const nomeDias = (dias: readonly number[]) =>
  dias.length === 0 ? '' : ` (${dias.map((d) => t(`farmacia.parametros.dias.${d}`)).join(', ')})`;
const dosesPorDia = computed(
  () => opcoes.value?.frequencias.find((f) => f.id === frequencia.value)?.dosesPorDia ?? null,
);
const recusasGrade = computed(() =>
  frequencia.value === null
    ? [t('farmacia.parametros.semFrequencia')]
    : conferirHorariosPadrao(horarios.value, dosesPorDia.value).map((r) => r.mensagem),
);

function editarGrade(g: {
  frequencia: number;
  setor: number | null;
  horarios: readonly { hora: string; dias: readonly number[] }[];
}): void {
  frequencia.value = g.frequencia;
  setorGrade.value = g.setor;
  horariosTexto.value = g.horarios.map((h) => h.hora).join(', ');
  diasPorHora.value = Object.fromEntries(g.horarios.map((h) => [h.hora, [...h.dias]]));
}

async function gravarGrade(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  if (recusasGrade.value.length) return;
  try {
    const r = await gravarHorariosPadrao(
      { frequencia: frequencia.value, setor: setorGrade.value, horarios: horarios.value },
      novaChave('horarios-padrao'),
    );
    mensagem.value = r.mensagem;
    await p.refetch();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="par-titulo" data-testid="tela-farmacia-parametros">
    <h1 id="par-titulo">{{ t('farmacia.parametros.titulo') }}</h1>
    <p>{{ t('farmacia.parametros.texto') }}</p>
    <ErroFarmacia v-if="p.error.value" :erro="p.error.value" />
    <ErroFarmacia v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="par-mensagem">{{ mensagem }}</p>
    <template v-if="p.data.value && opcoes">
      <table class="tabela" data-testid="par-regras">
        <caption>
          {{
            t('farmacia.parametros.regras')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('farmacia.parametros.escopo') }}</th>
            <th scope="col">{{ t('farmacia.parametros.local') }}</th>
            <th scope="col">{{ t('farmacia.parametros.tipoIntegracao') }}</th>
            <th scope="col">{{ t('farmacia.parametros.momento') }}</th>
            <th scope="col">{{ t('farmacia.parametros.forma') }}</th>
            <th scope="col">{{ t('farmacia.parametros.prioridade') }}</th>
            <th scope="col">{{ t('farmacia.parametros.ativa') }}</th>
            <th scope="col">{{ t('farmacia.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in p.data.value.regras" :key="r.regra" :data-testid="`par-regra-${r.regra}`">
            <td>{{ r.escopoNome }}</td>
            <td>{{ r.localNome }}</td>
            <td>{{ t(`farmacia.parametros.tipos.${r.tipoIntegracao}`) }}</td>
            <td>
              {{ t(`farmacia.parametros.momentos.${r.momento}`) }}
              <template v-if="r.antecedenciaMinutos">{{
                t('farmacia.parametros.minutos', { n: r.antecedenciaMinutos })
              }}</template>
            </td>
            <td>{{ t(`farmacia.parametros.formas.${r.forma}`) }}</td>
            <td>{{ r.prioridade }}</td>
            <td>{{ r.ativo ? t('farmacia.parametros.sim') : t('farmacia.parametros.nao') }}</td>
            <td>
              <SanteBotao
                variante="secundario"
                :rotulo="t('farmacia.parametros.editar')"
                :data-testid="`par-editar-${r.regra}`"
                @acionar="editar(r)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <form class="filtros" data-testid="par-form-regra" @submit.prevent="gravarRegra()">
        <h2>
          {{
            form.regra
              ? t('farmacia.parametros.alterarRegra', { n: form.regra })
              : t('farmacia.parametros.novaRegra')
          }}
        </h2>
        <span class="campo">
          <label for="par-centro">{{ t('farmacia.parametros.centro') }}</label>
          <select
            id="par-centro"
            :value="form.centroCusto ?? ''"
            data-testid="par-centro"
            @change="form.centroCusto = nulo(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('farmacia.parametros.nenhum') }}</option>
            <option v-for="o in opcoes.centros" :key="o.id" :value="o.id">{{ o.nome }}</option>
          </select>
        </span>
        <span class="campo">
          <label for="par-setor">{{ t('farmacia.parametros.setor') }}</label>
          <select
            id="par-setor"
            :value="form.setor ?? ''"
            @change="form.setor = nulo(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('farmacia.parametros.nenhum') }}</option>
            <option v-for="o in opcoes.setores" :key="o.id" :value="o.id">{{ o.nome }}</option>
          </select>
        </span>
        <span class="campo">
          <label for="par-unidade">{{ t('farmacia.parametros.unidade') }}</label>
          <select
            id="par-unidade"
            :value="form.unidade ?? ''"
            @change="form.unidade = nulo(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('farmacia.parametros.nenhum') }}</option>
            <option v-for="o in opcoes.unidades" :key="o.id" :value="o.id">{{ o.nome }}</option>
          </select>
        </span>
        <span class="campo">
          <label for="par-tipo-item">{{ t('farmacia.parametros.tipoItem') }}</label>
          <select
            id="par-tipo-item"
            :value="form.tipoItem ?? ''"
            @change="form.tipoItem = nulo(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('farmacia.parametros.todos') }}</option>
            <option v-for="o in opcoes.tiposItem" :key="o.id" :value="o.id">{{ o.nome }}</option>
          </select>
        </span>
        <span class="campo">
          <label for="par-grupo">{{ t('farmacia.parametros.grupo') }}</label>
          <select
            id="par-grupo"
            :value="form.grupo ?? ''"
            data-testid="par-grupo"
            @change="escolherGrupo(nulo(($event.target as HTMLSelectElement).value))"
          >
            <option value="">{{ t('farmacia.parametros.todos') }}</option>
            <option v-for="o in opcoes.grupos" :key="o.id" :value="o.id">{{ o.nome }}</option>
          </select>
        </span>
        <span class="campo">
          <label for="par-subgrupo">{{ t('farmacia.parametros.subgrupo') }}</label>
          <select
            id="par-subgrupo"
            :value="form.subgrupo ?? ''"
            data-testid="par-subgrupo"
            @change="escolherSubgrupo(nulo(($event.target as HTMLSelectElement).value))"
          >
            <option value="">{{ t('farmacia.parametros.todos') }}</option>
            <option v-for="o in subgruposDoGrupo" :key="o.id" :value="o.id">{{ o.nome }}</option>
          </select>
        </span>
        <span v-if="form.subgrupo !== null" class="campo">
          <label for="par-item">{{ t('farmacia.parametros.item') }}</label>
          <select
            id="par-item"
            :value="form.item ?? ''"
            data-testid="par-item"
            @change="form.item = nulo(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('farmacia.parametros.todos') }}</option>
            <option v-for="o in itensDoSubgrupo" :key="o.id" :value="o.id">{{ o.nome }}</option>
          </select>
        </span>
        <span class="campo">
          <label for="par-local">{{ t('farmacia.parametros.local') }}</label>
          <select
            id="par-local"
            :value="form.localAtendente ?? ''"
            data-testid="par-local"
            @change="form.localAtendente = nulo(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('farmacia.parametros.nenhum') }}</option>
            <option v-for="o in opcoes.locais" :key="o.id" :value="o.id">{{ o.nome }}</option>
          </select>
        </span>
        <span class="campo">
          <label for="par-substituto">{{ t('farmacia.parametros.substituto') }}</label>
          <select
            id="par-substituto"
            :value="form.localSubstituto ?? ''"
            data-testid="par-substituto"
            @change="form.localSubstituto = nulo(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('farmacia.parametros.nenhum') }}</option>
            <option v-for="o in opcoes.locais" :key="o.id" :value="o.id">{{ o.nome }}</option>
          </select>
        </span>
        <span class="campo">
          <label for="par-tipo">{{ t('farmacia.parametros.tipoIntegracao') }}</label>
          <select id="par-tipo" v-model="form.tipoIntegracao" data-testid="par-tipo">
            <option v-for="x in TIPOS_INTEGRACAO" :key="x" :value="x">
              {{ t(`farmacia.parametros.tipos.${x}`) }}
            </option>
          </select>
        </span>
        <span class="campo">
          <label for="par-momento">{{ t('farmacia.parametros.momento') }}</label>
          <select id="par-momento" v-model="form.momento" data-testid="par-momento">
            <option v-for="x in MOMENTOS_INTEGRACAO" :key="x" :value="x">
              {{ t(`farmacia.parametros.momentos.${x}`) }}
            </option>
          </select>
        </span>
        <span v-if="form.momento === 'antes_do_horario'" class="campo">
          <label for="par-antecedencia">{{ t('farmacia.parametros.antecedencia') }}</label>
          <input
            id="par-antecedencia"
            type="number"
            min="1"
            :value="form.antecedenciaMinutos ?? ''"
            data-testid="par-antecedencia"
            @input="form.antecedenciaMinutos = nulo(($event.target as HTMLInputElement).value)"
          />
        </span>
        <span class="campo">
          <label for="par-forma">{{ t('farmacia.parametros.forma') }}</label>
          <select id="par-forma" v-model="form.forma">
            <option v-for="x in FORMAS_DISPENSACAO" :key="x" :value="x">
              {{ t(`farmacia.parametros.formas.${x}`) }}
            </option>
          </select>
        </span>
        <span class="campo">
          <label for="par-prioridade">{{ t('farmacia.parametros.prioridade') }}</label>
          <input id="par-prioridade" v-model.number="form.prioridade" type="number" min="1" max="999" />
        </span>
        <span class="campo">
          <input id="par-manipulacao" v-model="form.geraManipulacao" type="checkbox" />
          <label for="par-manipulacao">{{ t('farmacia.parametros.manipulacao') }}</label>
        </span>
        <span class="campo">
          <input id="par-ativa" v-model="form.ativo" type="checkbox" data-testid="par-ativa" />
          <label for="par-ativa">{{ t('farmacia.parametros.ativa') }}</label>
        </span>
        <div v-if="recusasRegra.length" role="alert" data-testid="par-recusas-regra">
          <ul>
            <li v-for="m in recusasRegra" :key="m">{{ m }}</li>
          </ul>
        </div>
        <SanteBotao
          :rotulo="t('farmacia.parametros.gravar')"
          :desabilitado="recusasRegra.length > 0"
          data-testid="par-gravar-regra"
          @acionar="gravarRegra()"
        />
        <SanteBotao
          variante="secundario"
          :rotulo="t('farmacia.parametros.limpar')"
          @acionar="form = vazio()"
        />
      </form>

      <table class="tabela" data-testid="par-grades">
        <caption>
          {{
            t('farmacia.parametros.horarios')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('farmacia.parametros.frequencia') }}</th>
            <th scope="col">{{ t('farmacia.parametros.setor') }}</th>
            <th scope="col">{{ t('farmacia.parametros.valor') }}</th>
            <th scope="col">{{ t('farmacia.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in p.data.value.grades" :key="`${g.frequencia}-${g.setor}`">
            <td>{{ g.frequenciaNome }}</td>
            <td>{{ g.setorNome ?? t('farmacia.parametros.todoEstabelecimento') }}</td>
            <td>{{ g.horarios.map((h) => `${h.hora}${nomeDias(h.dias)}`).join(', ') }}</td>
            <td>
              <SanteBotao
                variante="secundario"
                :rotulo="t('farmacia.parametros.editar')"
                :data-testid="`par-editar-grade-${g.frequencia}`"
                @acionar="editarGrade(g)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <form class="filtros" data-testid="par-form-grade" @submit.prevent="gravarGrade()">
        <span class="campo">
          <label for="par-frequencia">{{ t('farmacia.parametros.frequencia') }}</label>
          <select
            id="par-frequencia"
            :value="frequencia ?? ''"
            data-testid="par-frequencia"
            @change="frequencia = nulo(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('farmacia.parametros.nenhum') }}</option>
            <option v-for="o in opcoes.frequencias" :key="o.id" :value="o.id">{{ o.nome }}</option>
          </select>
        </span>
        <span class="campo">
          <label for="par-setor-grade">{{ t('farmacia.parametros.setor') }}</label>
          <select
            id="par-setor-grade"
            :value="setorGrade ?? ''"
            @change="setorGrade = nulo(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('farmacia.parametros.todoEstabelecimento') }}</option>
            <option v-for="o in opcoes.setores" :key="o.id" :value="o.id">{{ o.nome }}</option>
          </select>
        </span>
        <span class="campo">
          <label for="par-horarios">{{ t('farmacia.parametros.horariosTexto') }}</label>
          <input
            id="par-horarios"
            v-model="horariosTexto"
            :placeholder="t('farmacia.parametros.exemploHorarios')"
            data-testid="par-horarios"
          />
        </span>
        <fieldset v-for="h in horas" :key="h" class="filtros" :data-testid="`par-dias-${h.replace(':', '')}`">
          <legend>{{ t('farmacia.parametros.diasDe', { hora: h }) }}</legend>
          <span v-for="d in DIAS" :key="d" class="campo">
            <input
              :id="`par-dia-${h.replace(':', '')}-${d}`"
              type="checkbox"
              :checked="(diasPorHora[h] ?? []).includes(d)"
              :data-testid="`par-dia-${h.replace(':', '')}-${d}`"
              @change="alternarDia(h, d, ($event.target as HTMLInputElement).checked)"
            />
            <label :for="`par-dia-${h.replace(':', '')}-${d}`">{{
              t(`farmacia.parametros.dias.${d}`)
            }}</label>
          </span>
        </fieldset>
        <div v-if="recusasGrade.length" role="alert" data-testid="par-recusas-grade">
          <ul>
            <li v-for="m in recusasGrade" :key="m">{{ m }}</li>
          </ul>
        </div>
        <SanteBotao
          :rotulo="t('farmacia.parametros.gravarHorarios')"
          :desabilitado="recusasGrade.length > 0"
          data-testid="par-gravar-grade"
          @acionar="gravarGrade()"
        />
      </form>
    </template>
  </section>
</template>
