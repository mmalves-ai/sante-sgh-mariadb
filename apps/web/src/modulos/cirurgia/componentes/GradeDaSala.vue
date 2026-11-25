<script setup lang="ts">
// Grade de funcionamento da sala cirúrgica (04-CC linha 92; F3.4), dentro de `/cirurgia/salas`. A semana da sala num
// quadro só (as faixas ativas por dia, com a reserva e o feriado), incluir a mesma faixa em vários dias de uma vez
// (segunda a sexta num clique), editar com a versão e inativar com confirmação (a linha fica no histórico). A regra do
// domínio (`validarFaixaGrade`) roda na hora, antes de gravar; o servidor confere de novo sob a trava da sala.
import { type FaixaGradeSala, validarFaixaGrade } from '@sgh/dominio-cirurgia';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { lerOpcoesCirurgia } from '../api-cirurgia.js';
import {
  type EntradaFaixaGrade,
  type FaixaGrade,
  gravarFaixaGrade,
  inativarFaixaGrade,
  lerGradeDaSala,
  novaChave,
} from '../api-grade-sala.js';
import ErroCirurgia from './ErroCirurgia.vue';

const props = defineProps<{ sala: number; nomeSala: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeEditar = computed(() => permissoes.value.has('cirurgia.sala.editar'));

const grade = useQuery({
  queryKey: computed(() => ['cirurgia', 'grade-sala', props.sala]),
  queryFn: () => lerGradeDaSala(props.sala),
});
const opcoes = useQuery({ queryKey: ['cirurgia', 'opcoes'], queryFn: lerOpcoesCirurgia });
const faixas = computed<FaixaGrade[]>(() => grade.data.value?.faixas ?? []);
const mostrarInativas = ref(false);
const DIAS = [1, 2, 3, 4, 5, 6, 7] as const;
const nomeDia = (d: number) => t(`cirurgia.gradeSala.dias.${d}`);
const porDia = computed(() =>
  DIAS.map((d) => ({
    dia: d,
    faixas: faixas.value.filter((f) => f.diaSemana === d && (f.ativo || mostrarInativas.value)),
  })),
);
const temGrade = computed(() => faixas.value.some((f) => f.ativo));
const nomeEspecialidade = (id: number) =>
  opcoes.data.value?.especialidades.find((e) => e.codigo === id)?.nome ?? String(id);
const nomeCirurgiao = (id: number) =>
  opcoes.data.value?.profissionais.find((p) => p.id === id)?.nome ?? String(id);
const reservaDe = (f: FaixaGrade) =>
  f.profissional !== null
    ? nomeCirurgiao(f.profissional)
    : f.especialidade !== null
      ? nomeEspecialidade(f.especialidade)
      : t('cirurgia.gradeSala.livre');
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

// ── formulário ──
const hoje = () => new Date().toISOString().slice(0, 10);
const f = reactive({
  faixa: null as FaixaGrade | null,
  dias: [] as number[],
  inicio: '07:00',
  fim: '13:00',
  vigenciaInicio: hoje(),
  vigenciaFim: '',
  valeFeriado: false,
  reserva: 'nenhuma' as 'nenhuma' | 'especialidade' | 'cirurgiao',
  especialidade: '',
  cirurgiao: '',
});
const opcoesReserva = computed(() =>
  (['nenhuma', 'especialidade', 'cirurgiao'] as const).map((v) => ({
    valor: v,
    rotulo: t(`cirurgia.gradeSala.reservaTipo.${v}`),
  })),
);
const opcoesEspecialidade = computed(() => [
  { valor: '', rotulo: t('cirurgia.gradeSala.escolha') },
  ...(opcoes.data.value?.especialidades ?? []).map((e) => ({ valor: String(e.codigo), rotulo: e.nome })),
]);
const opcoesCirurgiao = computed(() => [
  { valor: '', rotulo: t('cirurgia.gradeSala.escolha') },
  ...(opcoes.data.value?.profissionais ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome })),
]);
function limpar(): void {
  Object.assign(f, {
    faixa: null,
    dias: [],
    inicio: '07:00',
    fim: '13:00',
    vigenciaInicio: hoje(),
    vigenciaFim: '',
    valeFeriado: false,
    reserva: 'nenhuma',
    especialidade: '',
    cirurgiao: '',
  });
}
function editar(x: FaixaGrade): void {
  Object.assign(f, {
    faixa: x,
    dias: [x.diaSemana],
    inicio: x.inicio,
    fim: x.fim,
    vigenciaInicio: x.vigenciaInicio,
    vigenciaFim: x.vigenciaFim ?? '',
    valeFeriado: x.valeFeriado,
    reserva: x.profissional !== null ? 'cirurgiao' : x.especialidade !== null ? 'especialidade' : 'nenhuma',
    especialidade: x.especialidade !== null ? String(x.especialidade) : '',
    cirurgiao: x.profissional !== null ? String(x.profissional) : '',
  });
}
function alternarDia(d: number): void {
  if (f.faixa) {
    f.dias = [d];
    return;
  }
  f.dias = f.dias.includes(d) ? f.dias.filter((x) => x !== d) : [...f.dias, d].sort();
}
function diasUteis(): void {
  f.dias = [1, 2, 3, 4, 5];
}
const entradaDo = (dia: number): EntradaFaixaGrade => ({
  ...(f.faixa ? { faixa: f.faixa.id, versao: f.faixa.versao } : {}),
  diaSemana: dia,
  inicio: f.inicio,
  fim: f.fim,
  vigenciaInicio: f.vigenciaInicio,
  vigenciaFim: f.vigenciaFim || null,
  valeFeriado: f.valeFeriado,
  especialidade: f.reserva === 'especialidade' && f.especialidade ? Number(f.especialidade) : null,
  profissional: f.reserva === 'cirurgiao' && f.cirurgiao ? Number(f.cirurgiao) : null,
});
// Validação na hora: a mesma regra do domínio que o servidor usa, contra as faixas da sala e as outras do pedido.
const pendencia = computed<string | null>(() => {
  if (f.dias.length === 0) return t('cirurgia.gradeSala.escolhaDia');
  if ((f.reserva === 'especialidade' && !f.especialidade) || (f.reserva === 'cirurgiao' && !f.cirurgiao))
    return t('cirurgia.gradeSala.escolhaReserva');
  const lidas: FaixaGradeSala[] = faixas.value;
  for (const dia of f.dias) {
    const e = entradaDo(dia);
    const r = validarFaixaGrade(
      {
        ...(f.faixa ? { id: f.faixa.id } : {}),
        diaSemana: e.diaSemana,
        inicio: e.inicio,
        fim: e.fim,
        vigenciaInicio: e.vigenciaInicio,
        vigenciaFim: e.vigenciaFim,
        valeFeriado: e.valeFeriado,
        especialidade: e.especialidade,
        profissional: e.profissional,
        ativo: true,
      },
      lidas,
    );
    if (r) return f.dias.length > 1 ? `${nomeDia(dia)}: ${r.mensagem}` : r.mensagem;
  }
  return null;
});
const gravando = ref(false);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['cirurgia', 'grade-sala'] });
}
async function gravar(): Promise<void> {
  if (pendencia.value || gravando.value) return;
  gravando.value = true;
  erro.value = null;
  mensagem.value = null;
  let n = 0;
  try {
    for (const dia of f.dias) {
      await gravarFaixaGrade(props.sala, entradaDo(dia), novaChave('grade-sala'));
      n += 1;
    }
    mensagem.value = n > 1 ? t('cirurgia.gradeSala.gravadas', { n }) : t('cirurgia.gradeSala.gravada');
    limpar();
  } catch (e) {
    erro.value = e;
    if (n > 0) mensagem.value = t('cirurgia.gradeSala.gravadas', { n });
  } finally {
    gravando.value = false;
    await recarregar();
  }
}
async function inativar(x: FaixaGrade): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    await inativarFaixaGrade(x.id, x.versao, novaChave('grade-sala-inativar'));
    mensagem.value = t('cirurgia.gradeSala.inativada');
    if (f.faixa?.id === x.id) limpar();
  } catch (e) {
    erro.value = e;
  } finally {
    await recarregar();
  }
}
</script>

<template>
  <section class="painel" aria-labelledby="grade-sala-titulo" data-testid="grade-da-sala">
    <h2 id="grade-sala-titulo">{{ t('cirurgia.gradeSala.titulo', { sala: nomeSala }) }}</h2>
    <p class="secundario">{{ t('cirurgia.gradeSala.texto') }}</p>
    <ErroCirurgia v-if="grade.isError.value" :erro="grade.error.value" />
    <p v-else-if="!grade.data.value" role="status">{{ t('cirurgia.carregando') }}</p>
    <template v-else>
      <p v-if="!temGrade" class="secundario" data-testid="grade-sem-grade">
        {{ t('cirurgia.gradeSala.semGrade') }}
      </p>
      <label
        ><input v-model="mostrarInativas" type="checkbox" data-testid="grade-mostrar-inativas" />
        {{ t('cirurgia.gradeSala.mostrarInativas') }}</label
      >
      <table class="tabela" data-testid="grade-tabela">
        <thead>
          <tr>
            <th scope="col">{{ t('cirurgia.gradeSala.dia') }}</th>
            <th scope="col">{{ t('cirurgia.gradeSala.horario') }}</th>
            <th scope="col">{{ t('cirurgia.gradeSala.vigencia') }}</th>
            <th scope="col">{{ t('cirurgia.gradeSala.reserva') }}</th>
            <th scope="col">{{ t('cirurgia.gradeSala.situacao') }}</th>
            <th v-if="podeEditar" scope="col">{{ t('cirurgia.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="d in porDia" :key="d.dia">
            <tr
              v-for="x in d.faixas"
              :key="x.id"
              :class="{ secundario: !x.ativo }"
              :data-testid="`grade-faixa-${x.id}`"
            >
              <th scope="row">{{ nomeDia(d.dia) }}</th>
              <td>
                {{ t('cirurgia.faixa', { de: x.inicio, ate: x.fim }) }}
                <span v-if="x.valeFeriado" class="secundario">· {{ t('cirurgia.gradeSala.feriado') }}</span>
              </td>
              <td>
                {{
                  t('cirurgia.gradeSala.periodo', {
                    de: dataBr(x.vigenciaInicio),
                    ate: x.vigenciaFim ? dataBr(x.vigenciaFim) : t('cirurgia.gradeSala.semFim'),
                  })
                }}
              </td>
              <td>{{ reservaDe(x) }}</td>
              <td>{{ x.ativo ? t('cirurgia.gradeSala.ativa') : t('cirurgia.gradeSala.inativa') }}</td>
              <td v-if="podeEditar" class="acoes">
                <template v-if="x.ativo">
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('cirurgia.gradeSala.editar')"
                    :data-testid="`grade-editar-${x.id}`"
                    @acionar="editar(x)"
                  />
                  <SanteBotao
                    variante="destrutivo"
                    :rotulo="t('cirurgia.gradeSala.inativar')"
                    :confirmacao="
                      t('cirurgia.gradeSala.inativarPergunta', {
                        dia: nomeDia(d.dia),
                        de: x.inicio,
                        ate: x.fim,
                      })
                    "
                    :data-testid="`grade-inativar-${x.id}`"
                    @acionar="inativar(x)"
                  />
                </template>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <form v-if="podeEditar" class="filtros" data-testid="grade-formulario" @submit.prevent="gravar">
        <fieldset class="campo">
          <legend>{{ t('cirurgia.gradeSala.diasDaFaixa') }}</legend>
          <span class="acoes">
            <label v-for="d in DIAS" :key="d"
              ><input
                type="checkbox"
                :checked="f.dias.includes(d)"
                :data-testid="`grade-dia-${d}`"
                @change="alternarDia(d)"
              />
              {{ nomeDia(d) }}</label
            >
            <SanteBotao
              v-if="!f.faixa"
              variante="texto"
              :rotulo="t('cirurgia.gradeSala.diasUteis')"
              data-testid="grade-dias-uteis"
              @acionar="diasUteis"
            />
          </span>
        </fieldset>
        <div class="campo">
          <label for="grade-inicio">{{ t('cirurgia.gradeSala.inicio') }}</label>
          <input id="grade-inicio" v-model="f.inicio" type="time" data-testid="grade-inicio" />
        </div>
        <div class="campo">
          <label for="grade-fim">{{ t('cirurgia.gradeSala.fim') }}</label>
          <input id="grade-fim" v-model="f.fim" type="time" data-testid="grade-fim" />
        </div>
        <div class="campo">
          <label for="grade-vig-ini">{{ t('cirurgia.gradeSala.vigenciaInicio') }}</label>
          <input
            id="grade-vig-ini"
            v-model="f.vigenciaInicio"
            type="date"
            data-testid="grade-vigencia-inicio"
          />
        </div>
        <div class="campo">
          <label for="grade-vig-fim">{{ t('cirurgia.gradeSala.vigenciaFim') }}</label>
          <input id="grade-vig-fim" v-model="f.vigenciaFim" type="date" data-testid="grade-vigencia-fim" />
        </div>
        <label
          ><input v-model="f.valeFeriado" type="checkbox" data-testid="grade-vale-feriado" />
          {{ t('cirurgia.gradeSala.valeFeriado') }}</label
        >
        <SanteSelecao
          v-model="f.reserva"
          :rotulo="t('cirurgia.gradeSala.reserva')"
          :opcoes="opcoesReserva"
          data-testid="grade-reserva"
        />
        <SanteSelecao
          v-if="f.reserva === 'especialidade'"
          v-model="f.especialidade"
          :rotulo="t('cirurgia.gradeSala.especialidade')"
          :opcoes="opcoesEspecialidade"
          data-testid="grade-especialidade"
        />
        <SanteSelecao
          v-if="f.reserva === 'cirurgiao'"
          v-model="f.cirurgiao"
          :rotulo="t('cirurgia.gradeSala.cirurgiao')"
          :opcoes="opcoesCirurgiao"
          data-testid="grade-cirurgiao"
        />
        <div v-if="pendencia" role="status" data-testid="grade-pendencia">
          <SanteAlerta variante="aviso" :texto="pendencia" />
        </div>
        <span class="acoes">
          <SanteBotao
            tipo="submit"
            :rotulo="
              f.faixa
                ? t('cirurgia.gradeSala.salvar')
                : f.dias.length > 1
                  ? t('cirurgia.gradeSala.incluirEm', { n: f.dias.length })
                  : t('cirurgia.gradeSala.incluir')
            "
            :desabilitado="!!pendencia || gravando"
            data-testid="grade-gravar"
          />
          <SanteBotao
            v-if="f.faixa"
            variante="texto"
            :rotulo="t('cirurgia.gradeSala.cancelar')"
            @acionar="limpar"
          />
        </span>
      </form>
      <p v-if="mensagem" role="status" data-testid="grade-mensagem">{{ mensagem }}</p>
      <ErroCirurgia v-if="erro" :erro="erro" />
    </template>
  </section>
</template>
