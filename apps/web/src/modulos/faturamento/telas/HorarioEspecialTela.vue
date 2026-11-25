<script setup lang="ts">
// Cadastro do horário especial (F3.7, 06-FAT linha 17): `/faturamento/horario-especial`. Numa tela só:
// - Faixas de acréscimo: noturno, fim de semana, feriado, fora do expediente da tabela ou outra faixa de horas, geral ou
//   de uma fonte pagadora, com o percentual geral e os percentuais por componente (honorário, custo operacional, filme,
//   anestesia). Marcas: só no atendimento de urgência ou emergência (caráter TISS do atendimento) e replicar o
//   acréscimo do item principal nos itens acoplados do mesmo ato. A validação aparece enquanto se digita (a mesma regra
//   do servidor). Nada se apaga: a faixa que sai de uso fica inativa.
// - Expediente da tabela de preço: os períodos de cada dia; fora deles vale a faixa "fora do expediente".
// O acréscimo entra sozinho ao lançar o item na conta; a tela da conta mostra a prévia e reaplica.
import { validarFaixaHorario } from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type FaixaHorarioTela,
  gravarExpediente,
  gravarFaixaHorario,
  lerHorarioEspecial,
} from '../api-ajustes.js';
import { novaChave } from '../api-faturamento.js';
import ErroFaturamento from '../componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../componentes/MensagemFaturamento.vue';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Horário especial',
      texto:
        'Acréscimo por horário (noturno, fim de semana, feriado, fora do expediente) e por urgência. Os acréscimos não se somam: vale a faixa do acordo, depois a da fonte, depois a geral, e entre elas a de maior percentual. O acréscimo entra ao lançar o item na conta.',
      carregando: 'Carregando…',
      faixas: 'Faixas de acréscimo',
      nenhuma: 'Nenhuma faixa cadastrada.',
      nova: 'Nova faixa',
      editando: 'Alterando a faixa {codigo}',
      codigo: 'Código',
      descricao: 'Descrição',
      tipo: 'Tipo de horário',
      fonte: 'Fonte pagadora',
      todas: 'Todas as fontes',
      dia: 'Dia da semana',
      todosDias: 'Todos os dias',
      inicio: 'Início',
      fim: 'Fim',
      percentual: 'Acréscimo geral (%)',
      honorario: 'Honorário (%)',
      custo: 'Custo operacional (%)',
      filme: 'Filme (%)',
      anestesia: 'Anestesia (%)',
      componentes: 'Percentual próprio por componente (vazio: segue o geral)',
      feriado: 'Vale também em feriado',
      urgencia: 'Só no atendimento de urgência ou emergência',
      vinculados: 'Replicar nos itens acoplados do mesmo ato',
      vigencia: 'Vigência',
      vigenciaFim: 'até',
      ativa: 'Ativa',
      inativa: 'Inativa',
      gravar: 'Gravar a faixa',
      limpar: 'Limpar',
      alterar: 'Alterar',
      inativar: 'Inativar',
      reativar: 'Reativar',
      gravado: 'Gravado.',
      horas: 'Horas',
      marcas: 'Marcas',
      expediente: 'Expediente da tabela de preço',
      expedienteTexto:
        'Fora destes períodos vale a faixa "fora do expediente". Sem período: a faixa não se aplica.',
      tabela: 'Tabela de preço',
      escolha: 'Escolha',
      semPeriodo: 'Nenhum período nesta tabela.',
      incluirPeriodo: 'Incluir período',
      remover: 'Remover',
      gravarExpediente: 'Gravar o expediente',
      periodoInvalido: 'O fim tem de ser depois do início.',
      'tipo.noturno': 'Noturno',
      'tipo.fim_de_semana': 'Fim de semana',
      'tipo.feriado': 'Feriado',
      'tipo.apos_horario': 'Fora do expediente da tabela',
      'tipo.outro': 'Outra faixa de horas',
      'd.0': 'Domingo',
      'd.1': 'Segunda',
      'd.2': 'Terça',
      'd.3': 'Quarta',
      'd.4': 'Quinta',
      'd.5': 'Sexta',
      'd.6': 'Sábado',
    },
  },
});

const qc = useQueryClient();
const tabela = ref<number | null>(null);
const q = useQuery({
  queryKey: computed(() => ['faturamento', 'horario-especial', tabela.value]),
  queryFn: () => lerHorarioEspecial(tabela.value),
});
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

const TIPOS = ['noturno', 'fim_de_semana', 'feriado', 'apos_horario', 'outro'] as const;
const opcoesTipo = computed(() => TIPOS.map((x) => ({ valor: x as string, rotulo: t(`tipo.${x}`) })));
// Na faixa, o dia vai de 1 (domingo) a 7 (sábado); no expediente, de 0 (domingo) a 6 (sábado).
const opcoesDiaFaixa = computed(() => [
  { valor: 0, rotulo: t('todosDias') },
  ...[0, 1, 2, 3, 4, 5, 6].map((d) => ({ valor: d + 1, rotulo: t(`d.${d}`) })),
]);
const opcoesDia = computed(() => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ valor: d, rotulo: t(`d.${d}`) })));
const opcoesFonte = computed(() => [
  { valor: 0, rotulo: t('todas') },
  ...(q.data.value?.fontes ?? []).map((f) => ({ valor: f.id, rotulo: f.nome })),
]);
const opcoesTabela = computed(() => [
  { valor: 0, rotulo: t('escolha') },
  ...(q.data.value?.tabelas ?? []).map((x) => ({ valor: x.id, rotulo: `${x.codigo} · ${x.descricao}` })),
]);
const nomeFonte = (id: number | null) =>
  id === null ? t('todas') : (q.data.value?.fontes.find((f) => f.id === id)?.nome ?? String(id));

const hoje = new Date().toISOString().slice(0, 10);
const vazio = () => ({
  id: null as number | null,
  versao: null as number | null,
  codigo: '',
  descricao: '',
  tipoHorario: 'noturno',
  fontePagadoraId: 0,
  diaSemana: 0,
  aplicaFeriado: false,
  horaInicio: '19:00',
  horaFim: '07:00',
  percentual: '' as string | number,
  percentualHonorario: '' as string | number,
  percentualCustoOperacional: '' as string | number,
  percentualFilme: '' as string | number,
  percentualAnestesia: '' as string | number,
  exigeUrgencia: false,
  aplicaProcedimentosVinculados: false,
  vigenciaInicio: hoje,
  vigenciaFim: '',
  ativo: true,
});
const f = reactive(vazio());
const tocado = ref(false);
const numOuNulo = (v: string | number) => (v === '' || v === null ? null : Number(v));
const semHoras = computed(() => f.tipoHorario === 'feriado' || f.tipoHorario === 'fim_de_semana');
const entrada = computed(() => ({
  id: f.id,
  versao: f.versao,
  codigo: f.codigo.trim(),
  descricao: f.descricao.trim(),
  tipoHorario: f.tipoHorario,
  fontePagadoraId: f.fontePagadoraId || null,
  diaSemana: f.diaSemana || null,
  aplicaFeriado: f.aplicaFeriado,
  horaInicio: f.horaInicio || null,
  horaFim: f.horaFim || null,
  percentual: Number(f.percentual === '' ? Number.NaN : f.percentual),
  percentualHonorario: numOuNulo(f.percentualHonorario),
  percentualCustoOperacional: numOuNulo(f.percentualCustoOperacional),
  percentualFilme: numOuNulo(f.percentualFilme),
  percentualAnestesia: numOuNulo(f.percentualAnestesia),
  exigeUrgencia: f.exigeUrgencia,
  aplicaProcedimentosVinculados: f.aplicaProcedimentosVinculados,
  vigenciaInicio: f.vigenciaInicio,
  vigenciaFim: f.vigenciaFim || null,
  ativo: f.ativo,
}));
const erros = computed(() => validarFaixaHorario(entrada.value));
const valida = computed(() => Object.keys(erros.value).length === 0);

function limpar() {
  Object.assign(f, vazio());
  tocado.value = false;
}
function alterar(x: FaixaHorarioTela) {
  Object.assign(f, {
    id: x.id,
    versao: x.versao,
    codigo: x.codigo,
    descricao: x.descricao,
    tipoHorario: x.tipoHorario,
    fontePagadoraId: x.fontePagadoraId ?? 0,
    diaSemana: x.diaSemana ?? 0,
    aplicaFeriado: x.aplicaFeriado,
    horaInicio: x.horaInicio?.slice(0, 5) ?? '',
    horaFim: x.horaFim?.slice(0, 5) ?? '',
    percentual: x.percentual,
    percentualHonorario: x.percentualHonorario ?? '',
    percentualCustoOperacional: x.percentualCustoOperacional ?? '',
    percentualFilme: x.percentualFilme ?? '',
    percentualAnestesia: x.percentualAnestesia ?? '',
    exigeUrgencia: x.exigeUrgencia ?? false,
    aplicaProcedimentosVinculados: x.aplicaProcedimentosVinculados ?? false,
    vigenciaInicio: x.vigenciaInicio,
    vigenciaFim: x.vigenciaFim ?? '',
    ativo: x.ativo,
  });
}
async function executar(fn: () => Promise<unknown>) {
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    mensagem.value = t('gravado');
    await qc.invalidateQueries({ queryKey: ['faturamento', 'horario-especial'] });
  } catch (e) {
    erro.value = e;
  }
}
async function gravar() {
  tocado.value = true;
  if (!valida.value) return;
  const e = { ...entrada.value, contratoId: null };
  if (semHoras.value && !f.horaInicio) Object.assign(e, { horaInicio: null, horaFim: null });
  await executar(() => gravarFaixaHorario(e, novaChave('faixa-horario')));
  if (!erro.value) limpar();
}
function trocarAtivo(x: FaixaHorarioTela) {
  void executar(() =>
    gravarFaixaHorario(
      {
        ...x,
        horaInicio: x.horaInicio?.slice(0, 5) ?? null,
        horaFim: x.horaFim?.slice(0, 5) ?? null,
        contratoId: x.contratoId ?? null,
        ativo: !x.ativo,
      },
      novaChave('faixa-horario'),
    ),
  );
}

// Expediente da tabela escolhida: edita-se a lista inteira e grava-se num pedido só.
const periodos = ref<{ diaSemana: number; horaInicio: string; horaFim: string }[]>([]);
watch(
  () => q.data.value?.expediente,
  (x) => {
    periodos.value = (x ?? []).map((p) => ({
      diaSemana: p.diaSemana,
      horaInicio: p.horaInicio.slice(0, 5),
      horaFim: p.horaFim.slice(0, 5),
    }));
  },
  { immediate: true },
);
const periodoInvalido = (p: { horaInicio: string; horaFim: string }) =>
  !p.horaInicio || !p.horaFim || p.horaFim <= p.horaInicio;
const expedienteValido = computed(() => periodos.value.every((p) => !periodoInvalido(p)));
function incluirPeriodo() {
  periodos.value.push({ diaSemana: 1, horaInicio: '07:00', horaFim: '19:00' });
}
async function gravarPeriodos() {
  if (!tabela.value || !expedienteValido.value) return;
  const t0 = tabela.value;
  await executar(() => gravarExpediente(t0, periodos.value, novaChave('expediente')));
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="he-titulo" data-testid="tela-horario-especial">
    <h1 id="he-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('texto') }}</p>
    <ErroFaturamento v-if="erro" :erro="erro" />
    <MensagemFaturamento :texto="mensagem" :avisos="[]" testid="he-mensagem" />
    <ErroFaturamento v-if="q.error.value" :erro="q.error.value" />
    <p v-else-if="!q.data.value" role="status">{{ t('carregando') }}</p>
    <template v-else>
      <h2>{{ t('faixas') }}</h2>
      <table class="tabela" data-testid="he-faixas">
        <thead>
          <tr>
            <th scope="col">{{ t('codigo') }}</th>
            <th scope="col">{{ t('tipo') }}</th>
            <th scope="col">{{ t('fonte') }}</th>
            <th scope="col">{{ t('horas') }}</th>
            <th scope="col">{{ t('percentual') }}</th>
            <th scope="col">{{ t('marcas') }}</th>
            <th scope="col">{{ t('vigencia') }}</th>
            <th scope="col">
              <span class="sr-only">{{ t('alterar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="q.data.value.faixas.length === 0">
            <td colspan="8">{{ t('nenhuma') }}</td>
          </tr>
          <tr v-for="x in q.data.value.faixas" :key="x.id" :data-testid="`he-faixa-${x.codigo}`">
            <td>{{ x.codigo }} · {{ x.descricao }}</td>
            <td>{{ t(`tipo.${x.tipoHorario}`) }}</td>
            <td>{{ nomeFonte(x.fontePagadoraId) }}</td>
            <td>{{ x.horaInicio ? `${x.horaInicio.slice(0, 5)}–${x.horaFim?.slice(0, 5)}` : '—' }}</td>
            <td>
              {{ x.percentual }}%<span
                v-if="x.percentualAnestesia !== null && x.percentualAnestesia !== undefined"
              >
                · {{ t('anestesia') }} {{ x.percentualAnestesia }}</span
              >
            </td>
            <td>
              <span v-if="x.exigeUrgencia">{{ t('urgencia') }}. </span>
              <span v-if="x.aplicaProcedimentosVinculados">{{ t('vinculados') }}. </span>
              <span v-if="x.aplicaFeriado">{{ t('feriado') }}.</span>
            </td>
            <td>
              {{ x.vigenciaInicio }}{{ x.vigenciaFim ? ` ${t('vigenciaFim')} ${x.vigenciaFim}` : '' }} ·
              {{ x.ativo ? t('ativa') : t('inativa') }}
            </td>
            <td>
              <button type="button" :data-testid="`he-alterar-${x.codigo}`" @click="alterar(x)">
                {{ t('alterar') }}
              </button>
              <button type="button" :data-testid="`he-ativo-${x.codigo}`" @click="trocarAtivo(x)">
                {{ x.ativo ? t('inativar') : t('reativar') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <form class="formulario" data-testid="he-form" novalidate @submit.prevent="gravar">
        <h2>{{ f.id ? t('editando', { codigo: f.codigo }) : t('nova') }}</h2>
        <div class="filtros">
          <span class="campo">
            <label for="he-codigo">{{ t('codigo') }}</label>
            <input
              id="he-codigo"
              v-model="f.codigo"
              maxlength="30"
              data-testid="he-codigo"
              :aria-invalid="tocado && !!erros['codigo']"
            />
            <small v-if="tocado && erros['codigo']" class="erro">{{ erros['codigo'] }}</small>
          </span>
          <span class="campo">
            <label for="he-descricao">{{ t('descricao') }}</label>
            <input id="he-descricao" v-model="f.descricao" maxlength="150" data-testid="he-descricao" />
            <small v-if="tocado && erros['descricao']" class="erro">{{ erros['descricao'] }}</small>
          </span>
          <SanteSelecao
            v-model="f.tipoHorario"
            :rotulo="t('tipo')"
            :opcoes="opcoesTipo"
            data-testid="he-tipo"
          />
          <SanteSelecao
            v-model="f.fontePagadoraId"
            :rotulo="t('fonte')"
            :opcoes="opcoesFonte"
            data-testid="he-fonte"
          />
          <SanteSelecao
            v-model="f.diaSemana"
            :rotulo="t('dia')"
            :opcoes="opcoesDiaFaixa"
            data-testid="he-dia"
          />
          <span class="campo">
            <label for="he-inicio">{{ t('inicio') }}</label>
            <input id="he-inicio" v-model="f.horaInicio" type="time" data-testid="he-inicio" />
          </span>
          <span class="campo">
            <label for="he-fim">{{ t('fim') }}</label>
            <input id="he-fim" v-model="f.horaFim" type="time" data-testid="he-fim" />
            <small v-if="tocado && (erros['horaInicio'] || erros['horaFim'])" class="erro">{{
              erros['horaInicio'] ?? erros['horaFim']
            }}</small>
          </span>
        </div>
        <div class="filtros">
          <span class="campo">
            <label for="he-percentual">{{ t('percentual') }}</label>
            <input
              id="he-percentual"
              v-model="f.percentual"
              type="number"
              min="0"
              step="0.01"
              data-testid="he-percentual"
            />
            <small v-if="tocado && erros['percentual']" class="erro">{{ erros['percentual'] }}</small>
          </span>
        </div>
        <fieldset>
          <legend>{{ t('componentes') }}</legend>
          <div class="filtros">
            <span class="campo">
              <label for="he-hon">{{ t('honorario') }}</label>
              <input id="he-hon" v-model="f.percentualHonorario" type="number" min="0" step="0.01" />
            </span>
            <span class="campo">
              <label for="he-co">{{ t('custo') }}</label>
              <input id="he-co" v-model="f.percentualCustoOperacional" type="number" min="0" step="0.01" />
            </span>
            <span class="campo">
              <label for="he-filme">{{ t('filme') }}</label>
              <input id="he-filme" v-model="f.percentualFilme" type="number" min="0" step="0.01" />
            </span>
            <span class="campo">
              <label for="he-anest">{{ t('anestesia') }}</label>
              <input
                id="he-anest"
                v-model="f.percentualAnestesia"
                type="number"
                min="0"
                step="0.01"
                data-testid="he-anestesia"
              />
            </span>
          </div>
        </fieldset>
        <div class="filtros">
          <label
            ><input v-model="f.aplicaFeriado" type="checkbox" data-testid="he-feriado" />
            {{ t('feriado') }}</label
          >
          <label
            ><input v-model="f.exigeUrgencia" type="checkbox" data-testid="he-urgencia" />
            {{ t('urgencia') }}</label
          >
          <label
            ><input v-model="f.aplicaProcedimentosVinculados" type="checkbox" data-testid="he-vinculados" />
            {{ t('vinculados') }}</label
          >
        </div>
        <div class="filtros">
          <span class="campo">
            <label for="he-vig-ini">{{ t('vigencia') }}</label>
            <input id="he-vig-ini" v-model="f.vigenciaInicio" type="date" data-testid="he-vigencia" />
          </span>
          <span class="campo">
            <label for="he-vig-fim">{{ t('vigenciaFim') }}</label>
            <input id="he-vig-fim" v-model="f.vigenciaFim" type="date" />
            <small v-if="tocado && erros['vigenciaFim']" class="erro">{{ erros['vigenciaFim'] }}</small>
          </span>
        </div>
        <button type="submit" :disabled="tocado && !valida" data-testid="he-gravar">{{ t('gravar') }}</button>
        <button type="button" @click="limpar">{{ t('limpar') }}</button>
      </form>

      <h2>{{ t('expediente') }}</h2>
      <p>{{ t('expedienteTexto') }}</p>
      <SanteSelecao
        :model-value="tabela ?? 0"
        @update:model-value="(v) => (tabela = Number(v) || null)"
        :rotulo="t('tabela')"
        :opcoes="opcoesTabela"
        data-testid="he-tabela"
      />
      <template v-if="tabela">
        <table class="tabela" data-testid="he-expediente">
          <thead>
            <tr>
              <th scope="col">{{ t('dia') }}</th>
              <th scope="col">{{ t('inicio') }}</th>
              <th scope="col">{{ t('fim') }}</th>
              <th scope="col">
                <span class="sr-only">{{ t('remover') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="periodos.length === 0">
              <td colspan="4">{{ t('semPeriodo') }}</td>
            </tr>
            <tr v-for="(p, k) in periodos" :key="k" :data-testid="`he-periodo-${k}`">
              <td>
                <SanteSelecao
                  v-model="p.diaSemana"
                  :rotulo="t('dia')"
                  ocultar-rotulo
                  :opcoes="opcoesDia"
                  :data-testid="`he-p-dia-${k}`"
                />
              </td>
              <td>
                <label :for="`he-p-ini-${k}`" class="sr-only">{{ t('inicio') }}</label>
                <input :id="`he-p-ini-${k}`" v-model="p.horaInicio" type="time" />
              </td>
              <td>
                <label :for="`he-p-fim-${k}`" class="sr-only">{{ t('fim') }}</label>
                <input
                  :id="`he-p-fim-${k}`"
                  v-model="p.horaFim"
                  type="time"
                  :aria-invalid="periodoInvalido(p)"
                />
                <small v-if="periodoInvalido(p)" class="erro">{{ t('periodoInvalido') }}</small>
              </td>
              <td>
                <button type="button" @click="periodos.splice(k, 1)">{{ t('remover') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
        <button type="button" data-testid="he-incluir-periodo" @click="incluirPeriodo">
          {{ t('incluirPeriodo') }}
        </button>
        <button
          type="button"
          :disabled="!expedienteValido"
          data-testid="he-gravar-expediente"
          @click="gravarPeriodos"
        >
          {{ t('gravarExpediente') }}
        </button>
      </template>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
