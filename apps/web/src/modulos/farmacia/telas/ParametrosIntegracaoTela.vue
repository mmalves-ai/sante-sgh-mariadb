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
import { SanteBotao, SanteSelecao } from '@sgh/ui';
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

/**
 * A regra que vai à API: com a exceção por item, o grupo e o subgrupo foram só o caminho para achar o item na tela (o
 * item já diz a que grupo pertence) e não entram no escopo da regra, que não combina item com grupo ou subgrupo.
 */
function regraDoForm(f: Form): Form {
  return f.item === null ? f : { ...f, grupo: null, subgrupo: null };
}

/** As recusas na hora, pelas mesmas regras da API. */
const recusasRegra = computed(() => {
  const f = regraDoForm(form.value);
  const rs = conferirRegraIntegracao({ ...f, localAtendente: f.localAtendente ?? 0 }).map((r) => r.mensagem);
  if (f.localAtendente === null) rs.unshift(t('farmacia.parametros.semLocal'));
  return rs;
});

function editar(r: RegraIntegracaoLida): void {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { escopoNome, localNome, ...resto } = r;
  form.value = { ...vazio(), ...resto };
  // A exceção por item volta com o caminho (grupo e subgrupo do item) para a escolha do item aparecer na tela.
  if (r.item !== null) {
    const subgrupo = opcoes.value?.itens.find((i) => i.id === r.item)?.subgrupo ?? null;
    form.value.subgrupo = subgrupo;
    form.value.grupo = opcoes.value?.subgrupos.find((s) => s.id === subgrupo)?.grupo ?? null;
  }
  mensagem.value = null;
}

async function gravarRegra(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  if (recusasRegra.value.length) return;
  try {
    const r = await gravarRegraIntegracao(regraDoForm(form.value), novaChave('regra-integracao'));
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
          <SanteSelecao
            v-model="form.centroCusto"
            :rotulo="t('farmacia.parametros.centro')"
            :opcoes="[
              { valor: null, rotulo: t('farmacia.parametros.nenhum') },
              ...opcoes.centros.map((o) => ({ valor: o.id, rotulo: o.nome })),
            ]"
            data-testid="par-centro"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="form.setor"
            :rotulo="t('farmacia.parametros.setor')"
            :opcoes="[
              { valor: null, rotulo: t('farmacia.parametros.nenhum') },
              ...opcoes.setores.map((o) => ({ valor: o.id, rotulo: o.nome })),
            ]"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="form.unidade"
            :rotulo="t('farmacia.parametros.unidade')"
            :opcoes="[
              { valor: null, rotulo: t('farmacia.parametros.nenhum') },
              ...opcoes.unidades.map((o) => ({ valor: o.id, rotulo: o.nome })),
            ]"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="form.tipoItem"
            :rotulo="t('farmacia.parametros.tipoItem')"
            :opcoes="[
              { valor: null, rotulo: t('farmacia.parametros.todos') },
              ...opcoes.tiposItem.map((o) => ({ valor: o.id, rotulo: o.nome })),
            ]"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            :model-value="form.grupo"
            @update:model-value="escolherGrupo"
            :rotulo="t('farmacia.parametros.grupo')"
            :opcoes="[
              { valor: null, rotulo: t('farmacia.parametros.todos') },
              ...opcoes.grupos.map((o) => ({ valor: o.id, rotulo: o.nome })),
            ]"
            data-testid="par-grupo"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            :model-value="form.subgrupo"
            @update:model-value="escolherSubgrupo"
            :rotulo="t('farmacia.parametros.subgrupo')"
            :opcoes="[
              { valor: null, rotulo: t('farmacia.parametros.todos') },
              ...subgruposDoGrupo.map((o) => ({ valor: o.id, rotulo: o.nome })),
            ]"
            data-testid="par-subgrupo"
          />
        </span>
        <span v-if="form.subgrupo !== null" class="campo">
          <SanteSelecao
            v-model="form.item"
            :rotulo="t('farmacia.parametros.item')"
            :opcoes="[
              { valor: null, rotulo: t('farmacia.parametros.todos') },
              ...itensDoSubgrupo.map((o) => ({ valor: o.id, rotulo: o.nome })),
            ]"
            data-testid="par-item"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="form.localAtendente"
            :rotulo="t('farmacia.parametros.local')"
            :opcoes="[
              { valor: null, rotulo: t('farmacia.parametros.nenhum') },
              ...opcoes.locais.map((o) => ({ valor: o.id, rotulo: o.nome })),
            ]"
            data-testid="par-local"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="form.localSubstituto"
            :rotulo="t('farmacia.parametros.substituto')"
            :opcoes="[
              { valor: null, rotulo: t('farmacia.parametros.nenhum') },
              ...opcoes.locais.map((o) => ({ valor: o.id, rotulo: o.nome })),
            ]"
            data-testid="par-substituto"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="form.tipoIntegracao"
            :rotulo="t('farmacia.parametros.tipoIntegracao')"
            :opcoes="[
              ...TIPOS_INTEGRACAO.map((x) => ({ valor: x, rotulo: t(`farmacia.parametros.tipos.${x}`) })),
            ]"
            data-testid="par-tipo"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="form.momento"
            :rotulo="t('farmacia.parametros.momento')"
            :opcoes="[
              ...MOMENTOS_INTEGRACAO.map((x) => ({
                valor: x,
                rotulo: t(`farmacia.parametros.momentos.${x}`),
              })),
            ]"
            data-testid="par-momento"
          />
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
          <SanteSelecao
            v-model="form.forma"
            :rotulo="t('farmacia.parametros.forma')"
            :opcoes="[
              ...FORMAS_DISPENSACAO.map((x) => ({ valor: x, rotulo: t(`farmacia.parametros.formas.${x}`) })),
            ]"
          />
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
          <SanteSelecao
            v-model="frequencia"
            :rotulo="t('farmacia.parametros.frequencia')"
            :opcoes="[
              { valor: null, rotulo: t('farmacia.parametros.nenhum') },
              ...opcoes.frequencias.map((o) => ({ valor: o.id, rotulo: o.nome })),
            ]"
            data-testid="par-frequencia"
          />
        </span>
        <span class="campo">
          <SanteSelecao
            v-model="setorGrade"
            :rotulo="t('farmacia.parametros.setor')"
            :opcoes="[
              { valor: null, rotulo: t('farmacia.parametros.todoEstabelecimento') },
              ...opcoes.setores.map((o) => ({ valor: o.id, rotulo: o.nome })),
            ]"
          />
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
