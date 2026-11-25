<script setup lang="ts">
// 02-AGE linha 50: agenda de grupos e turmas (atividade coletiva). Uma tela só: a lista das turmas com a ocupação e o
// próximo encontro; ao abrir a turma, o cadastro (com profissionais e fontes aceitas), a escala semanal com a geração
// dos encontros, os encontros com a presença de todos numa lista (um clique marca todos presentes) e os participantes
// com a frequência, a espera e a inscrição pela busca do paciente, que mostra na hora as turmas de que ele já participa.
// A validação é a do domínio (@sgh/dominio-agenda), na hora; o servidor confere de novo sob trava.
import type { ResultadoBuscaPaciente } from '@sgh/contratos';
import { validarEscala, validarTurma } from '@sgh/dominio-agenda';
import { SanteBotao, SanteCampoTexto, SanteChave, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode as podePermissao } from '../../../casca/sessao/pode.js';
import { buscarPacientes } from '../../cadastro/api-cadastro.js';
import { novaChave } from '../api-agenda.js';
import {
  cancelarEncontro,
  type EncontroLido,
  gerarEncontros,
  inscrever,
  lerOpcoesTurma,
  lerPresencaEncontro,
  lerTurma,
  lerTurmas,
  lerTurmasDoPaciente,
  type ParticipanteLido,
  registrarPresenca,
  type RegistroPresenca,
  type Saida,
  SAIDAS,
  sairDaTurma,
  salvarEscala,
  salvarTurma,
  SITUACOES_PRESENCA,
  type TurmaLida,
} from '../api-turmas.js';
import ErroAgenda from '../componentes/ErroAgenda.vue';
import { dataBr } from '../formato.js';

const { t } = useI18n();
const qc = useQueryClient();
const podeManter = computed(() => podePermissao('agenda.escala.editar'));
const podeInscrever = computed(() => podePermissao('agenda.marcacao.agendar'));
const podePresenca = computed(() => podePermissao('agenda.falta.registrar'));
const lista = useQuery({ queryKey: ['agenda-turmas'], queryFn: lerTurmas });
const opcoes = useQuery({ queryKey: ['agenda-turmas-opcoes'], queryFn: lerOpcoesTurma });
const aberta = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['agenda-turma', aberta.value]),
  queryFn: () => lerTurma(aberta.value!),
  enabled: computed(() => aberta.value !== null),
});
const erro = ref<unknown>(null);
const mensagem = ref('');
const ocupado = ref(false);

async function gravar(acao: () => Promise<{ mensagem?: string | undefined }>, depois?: () => void) {
  erro.value = null;
  mensagem.value = '';
  ocupado.value = true;
  try {
    const r = await acao();
    await qc.invalidateQueries({ queryKey: ['agenda-turmas'] });
    await qc.invalidateQueries({ queryKey: ['agenda-turma'] });
    await qc.invalidateQueries({ queryKey: ['agenda-turma-encontro'] });
    await qc.invalidateQueries({ queryKey: ['agenda-turmas-paciente'] });
    mensagem.value = r.mensagem ?? '';
    depois?.();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

const opcoesDe = (k: keyof NonNullable<typeof opcoes.data.value>, vazio: string | null = null) => [
  ...(vazio === null ? [] : [{ valor: '', rotulo: vazio }]),
  ...(opcoes.data.value?.[k] ?? []).map((o) => ({ valor: String(o.id), rotulo: o.nome })),
];
const idOuNulo = (v: string) => (v === '' ? null : Number(v));
const inteiroOuNulo = (v: string) => (v.trim() === '' ? null : /^\d+$/.test(v.trim()) ? Number(v) : NaN);
const texto = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

// ── Cadastro da turma ───────────────────────────────────────────────────────────────────────────────
const editando = ref<number | 'nova' | null>(null);
const versao = ref<number | null>(null);
const f = reactive({
  codigo: '',
  descricao: '',
  tipo: '',
  itemAgendavel: '',
  setorFuncional: '',
  dataInicio: null as string | null,
  dataFim: null as string | null,
  vagas: '10',
  vagasEncaixe: '0',
  idadeMinimaAnos: '',
  idadeMaximaAnos: '',
  sexo: '',
  exigeIndicacaoMedica: false,
  permiteAcompanhante: false,
  exigeAcompanhante: false,
  ativo: true,
  profissionais: [] as { profissional: string; principal: boolean }[],
  fontes: [] as { fontePagadora: string; limite: string }[],
});
function abrirCadastro(x: TurmaLida | null) {
  erro.value = null;
  editando.value = x ? x.id : 'nova';
  versao.value = x?.versao ?? null;
  f.codigo = x?.codigo ?? '';
  f.descricao = x?.descricao ?? '';
  f.tipo = texto(x?.tipo);
  f.itemAgendavel = texto(x?.itemAgendavel);
  f.setorFuncional = texto(x?.setorFuncional);
  f.dataInicio = x?.dataInicio ?? new Date().toISOString().slice(0, 10);
  f.dataFim = x?.dataFim ?? null;
  f.vagas = String(x?.vagas ?? 10);
  f.vagasEncaixe = String(x?.vagasEncaixe ?? 0);
  f.idadeMinimaAnos = texto(x?.idadeMinimaAnos);
  f.idadeMaximaAnos = texto(x?.idadeMaximaAnos);
  f.sexo = texto(x?.sexo);
  f.exigeIndicacaoMedica = x?.exigeIndicacaoMedica ?? false;
  f.permiteAcompanhante = x?.permiteAcompanhante ?? false;
  f.exigeAcompanhante = x?.exigeAcompanhante ?? false;
  f.ativo = x?.ativo ?? true;
  f.profissionais = (x?.profissionais ?? []).map((p) => ({
    profissional: String(p.profissional),
    principal: p.principal,
  }));
  f.fontes = (x?.fontes ?? []).map((p) => ({
    fontePagadora: String(p.fontePagadora),
    limite: texto(p.limite),
  }));
}
const entradaTurma = computed(() => ({
  codigo: f.codigo.trim(),
  descricao: f.descricao.trim(),
  tipo: Number(f.tipo),
  itemAgendavel: Number(f.itemAgendavel),
  setorFuncional: Number(f.setorFuncional),
  localFisico: null,
  dataInicio: f.dataInicio ?? '',
  dataFim: f.dataFim,
  vagas: inteiroOuNulo(f.vagas) ?? 0,
  vagasEncaixe: inteiroOuNulo(f.vagasEncaixe) ?? 0,
  exigeAcompanhante: f.exigeAcompanhante,
  permiteAcompanhante: f.permiteAcompanhante || f.exigeAcompanhante,
  exigeIndicacaoMedica: f.exigeIndicacaoMedica,
  idadeMinimaAnos: inteiroOuNulo(f.idadeMinimaAnos),
  idadeMaximaAnos: inteiroOuNulo(f.idadeMaximaAnos),
  sexo: idOuNulo(f.sexo),
  ativo: f.ativo,
  profissionais: f.profissionais
    .filter((p) => p.profissional !== '')
    .map((p) => ({ profissional: Number(p.profissional), principal: p.principal })),
  fontes: f.fontes
    .filter((p) => p.fontePagadora !== '')
    .map((p) => ({ fontePagadora: Number(p.fontePagadora), plano: null, limite: inteiroOuNulo(p.limite) })),
}));
const recusaTurma = computed(() => {
  if (editando.value === null) return null;
  const e = entradaTurma.value;
  if (!e.tipo || !e.itemAgendavel || !e.setorFuncional) return { mensagem: t('turmas.validacao.semCampos') };
  return validarTurma(e);
});
function marcarResponsavel(i: number) {
  f.profissionais.forEach((p, j) => (p.principal = i === j));
}
function salvarCadastro() {
  if (recusaTurma.value) return;
  const id = editando.value === 'nova' ? null : editando.value;
  void gravar(
    () =>
      salvarTurma(
        id,
        { ...entradaTurma.value, ...(id !== null && versao.value !== null ? { versao: versao.value } : {}) },
        novaChave('turma'),
      ),
    () => (editando.value = null),
  );
}

// ── Escala e geração ────────────────────────────────────────────────────────────────────────────────
const ef = reactive({
  diaSemana: '2',
  horaInicio: '14:00',
  horaFim: '15:00',
  inclusiveFeriado: false,
  vigenciaInicio: null as string | null,
  vigenciaFim: null as string | null,
});
const entradaEscala = computed(() => ({
  diaSemana: Number(ef.diaSemana),
  horaInicio: ef.horaInicio,
  horaFim: ef.horaFim,
  inclusiveFeriado: ef.inclusiveFeriado,
  vigenciaInicio: ef.vigenciaInicio ?? detalhe.data.value?.turma.dataInicio ?? '',
  vigenciaFim: ef.vigenciaFim,
  ativo: true,
}));
const recusaEscala = computed(() => validarEscala(entradaEscala.value));
const opcoesDia = computed(() =>
  [1, 2, 3, 4, 5, 6, 7].map((d) => ({ valor: String(d), rotulo: t(`turmas.dias.${d}`) })),
);
const gerarDe = ref<string | null>(null);
const gerarAte = ref<string | null>(null);

// ── Encontros e presença ────────────────────────────────────────────────────────────────────────────
const encontroAberto = ref<number | null>(null);
const presenca = useQuery({
  queryKey: computed(() => ['agenda-turma-encontro', encontroAberto.value]),
  queryFn: () => lerPresencaEncontro(encontroAberto.value!),
  enabled: computed(() => encontroAberto.value !== null),
});
const marcas = ref<RegistroPresenca[]>([]);
function abrirPresenca(e: EncontroLido) {
  encontroAberto.value = e.id;
  marcas.value = [];
  void lerPresencaEncontro(e.id).then((p) => {
    marcas.value = p.participantes.map((x) => ({
      participante: x.participante,
      situacao: x.situacao ?? 'presente',
      justificativa: x.justificativa,
      acompanhante: x.acompanhante,
    }));
  });
}
const nomeDoParticipante = (id: number) =>
  presenca.data.value?.participantes.find((x) => x.participante === id)?.nome ?? '';
const recusaPresenca = computed(() =>
  marcas.value.some((m) => m.situacao === 'falta_justificada' && !m.justificativa?.trim())
    ? t('turmas.validacao.justificativa')
    : null,
);
const opcoesPresenca = computed(() =>
  SITUACOES_PRESENCA.map((s) => ({ valor: s, rotulo: t(`turmas.presencas.${s}`) })),
);
const cancelando = ref<EncontroLido | null>(null);
const motivoCancelamento = ref('');

// ── Participantes, inscrição e visão por paciente ───────────────────────────────────────────────────
const termo = ref('');
const pedido = ref('');
const pacientes = useQuery({
  queryKey: computed(() => ['agenda-turmas-busca', pedido.value]),
  queryFn: (): Promise<ResultadoBuscaPaciente> => buscarPacientes(pedido.value),
  enabled: computed(() => pedido.value.length >= 2),
});
const paciente = ref<{ id: number; nome: string } | null>(null);
const doPaciente = useQuery({
  queryKey: computed(() => ['agenda-turmas-paciente', paciente.value?.id]),
  queryFn: () => lerTurmasDoPaciente(paciente.value!.id),
  enabled: computed(() => paciente.value !== null),
});
const insc = reactive({
  fontePagadora: '',
  indicacao: '',
  acompanhante: false,
  encaixe: false,
  observacao: '',
});
const exigeIndicacao = computed(() => detalhe.data.value?.turma.exigeIndicacaoMedica ?? false);
const recusaInscricao = computed(() => {
  if (!paciente.value || insc.fontePagadora === '') return t('turmas.escolha');
  if (exigeIndicacao.value && insc.indicacao === '') return t('turmas.indicacao');
  return null;
});
function confirmarInscricao() {
  if (recusaInscricao.value || !paciente.value || aberta.value === null) return;
  void gravar(
    () =>
      inscrever(
        aberta.value!,
        {
          paciente: paciente.value!.id,
          fontePagadora: Number(insc.fontePagadora),
          plano: null,
          indicacaoProfissional: idOuNulo(insc.indicacao),
          acompanhante: insc.acompanhante,
          encaixe: insc.encaixe,
          observacao: insc.observacao.trim() || null,
        },
        novaChave('turma-inscricao'),
      ),
    () => {
      paciente.value = null;
      termo.value = '';
      pedido.value = '';
    },
  );
}
const saindo = ref<ParticipanteLido | null>(null);
const saida = reactive({ tipo: 'desistente' as Saida, motivo: '' });
const opcoesSaida = computed(() => SAIDAS.map((s) => ({ valor: s, rotulo: t(`turmas.saidas.${s}`) })));
const situacaoTexto = (p: { situacao: ParticipanteLido['situacao']; posicaoEspera: number | null }) =>
  t(`turmas.situacoesParticipante.${p.situacao}`, { posicao: p.posicaoEspera ?? '' });
const freqTexto = (n: number | null) => (n === null ? t('turmas.semFrequencia') : `${n}%`);
const dataHoraBr = (s: string | null) =>
  s ? `${dataBr(s.slice(0, 10))} ${s.slice(11, 16)}` : t('turmas.semProximo');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="turmas-titulo" data-testid="turmas">
    <h1 id="turmas-titulo">{{ t('turmas.titulo') }}</h1>
    <p>{{ t('turmas.explicacao') }}</p>
    <p v-if="lista.isPending.value">{{ t('turmas.carregando') }}</p>
    <template v-else-if="lista.data.value">
      <p v-if="lista.data.value.length === 0" data-testid="turmas-vazio">{{ t('turmas.nenhuma') }}</p>
      <table v-else class="tabela" data-testid="turmas-lista">
        <thead>
          <tr>
            <th scope="col">{{ t('turmas.colunas.turma') }}</th>
            <th scope="col">{{ t('turmas.colunas.tipo') }}</th>
            <th scope="col">{{ t('turmas.colunas.periodo') }}</th>
            <th scope="col">{{ t('turmas.colunas.ocupacao') }}</th>
            <th scope="col">{{ t('turmas.colunas.proximo') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in lista.data.value" :key="x.id" :data-testid="`turma-${x.id}`">
            <td>
              {{ x.codigo }} · {{ x.descricao }}<span v-if="!x.ativo"> ({{ t('turmas.inativa') }})</span>
            </td>
            <td>{{ x.tipo }}</td>
            <td>
              {{
                t('turmas.periodo', {
                  de: dataBr(x.dataInicio),
                  ate: x.dataFim ? dataBr(x.dataFim) : t('turmas.semFim'),
                })
              }}
            </td>
            <td>
              {{ t('turmas.ocupacao', { ocupadas: x.ocupadas, vagas: x.vagas, espera: x.espera }) }}
            </td>
            <td>{{ dataHoraBr(x.proximoEncontro) }}</td>
            <td class="acoes">
              <SanteBotao
                variante="secundario"
                :rotulo="aberta === x.id ? t('turmas.fechar') : t('turmas.abrir')"
                :data-testid="`turma-abrir-${x.id}`"
                @acionar="aberta = aberta === x.id ? null : x.id"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <SanteBotao
        v-if="podeManter && editando === null"
        :rotulo="t('turmas.nova')"
        data-testid="turma-nova"
        @acionar="abrirCadastro(null)"
      />
    </template>

    <section
      v-if="editando !== null"
      class="painel"
      :aria-label="t('turmas.editar')"
      data-testid="turma-edicao"
    >
      <div class="filtros">
        <SanteCampoTexto
          v-model="f.codigo"
          :rotulo="t('turmas.campos.codigo')"
          :max-bytes="30"
          data-testid="turma-codigo"
        />
        <SanteCampoTexto
          v-model="f.descricao"
          :rotulo="t('turmas.campos.descricao')"
          :max-bytes="150"
          data-testid="turma-descricao"
        />
        <SanteSelecao
          id="turma-tipo"
          v-model="f.tipo"
          :rotulo="t('turmas.campos.tipo')"
          :opcoes="opcoesDe('tipo', t('turmas.escolha'))"
        />
        <SanteSelecao
          id="turma-item"
          v-model="f.itemAgendavel"
          :rotulo="t('turmas.campos.itemAgendavel')"
          :opcoes="opcoesDe('itemAgendavel', t('turmas.escolha'))"
        />
        <SanteSelecao
          id="turma-setor"
          v-model="f.setorFuncional"
          :rotulo="t('turmas.campos.setorFuncional')"
          :opcoes="opcoesDe('setorFuncional', t('turmas.escolha'))"
        />
      </div>
      <div class="filtros">
        <SanteData v-model="f.dataInicio" :rotulo="t('turmas.campos.dataInicio')" editavel />
        <SanteData v-model="f.dataFim" :rotulo="t('turmas.campos.dataFim')" editavel />
        <SanteCampoTexto
          v-model="f.vagas"
          :rotulo="t('turmas.campos.vagas')"
          :max-bytes="3"
          data-testid="turma-vagas"
        />
        <SanteCampoTexto v-model="f.vagasEncaixe" :rotulo="t('turmas.campos.vagasEncaixe')" :max-bytes="3" />
        <SanteCampoTexto
          v-model="f.idadeMinimaAnos"
          :rotulo="t('turmas.campos.idadeMinimaAnos')"
          :max-bytes="3"
          data-testid="turma-idade-min"
        />
        <SanteCampoTexto
          v-model="f.idadeMaximaAnos"
          :rotulo="t('turmas.campos.idadeMaximaAnos')"
          :max-bytes="3"
          data-testid="turma-idade-max"
        />
        <SanteSelecao
          id="turma-sexo"
          v-model="f.sexo"
          :rotulo="t('turmas.campos.sexo')"
          :opcoes="opcoesDe('sexo', t('turmas.todos'))"
        />
      </div>
      <div class="filtros">
        <SanteChave
          :ligada="f.exigeIndicacaoMedica"
          :rotulo="t('turmas.campos.exigeIndicacaoMedica')"
          @alternar="(v: boolean) => (f.exigeIndicacaoMedica = v)"
        />
        <SanteChave
          :ligada="f.permiteAcompanhante"
          :rotulo="t('turmas.campos.permiteAcompanhante')"
          @alternar="(v: boolean) => (f.permiteAcompanhante = v)"
        />
        <SanteChave
          :ligada="f.exigeAcompanhante"
          :rotulo="t('turmas.campos.exigeAcompanhante')"
          @alternar="(v: boolean) => (f.exigeAcompanhante = v)"
        />
        <SanteChave
          :ligada="f.ativo"
          :rotulo="t('turmas.campos.ativo')"
          @alternar="(v: boolean) => (f.ativo = v)"
        />
      </div>
      <h3>{{ t('turmas.profissionais') }}</h3>
      <div v-for="(p, i) in f.profissionais" :key="`p${i}`" class="filtros">
        <SanteSelecao
          :id="`turma-prof-${i}`"
          v-model="p.profissional"
          :rotulo="t('turmas.campos.profissional')"
          :opcoes="opcoesDe('profissional', t('turmas.escolha'))"
        />
        <SanteChave
          :ligada="p.principal"
          :rotulo="t('turmas.campos.responsavel')"
          @alternar="() => marcarResponsavel(i)"
        />
        <SanteBotao variante="texto" :rotulo="t('turmas.remover')" @acionar="f.profissionais.splice(i, 1)" />
      </div>
      <SanteBotao
        variante="secundario"
        :rotulo="t('turmas.adicionarProfissional')"
        data-testid="turma-add-prof"
        @acionar="f.profissionais.push({ profissional: '', principal: f.profissionais.length === 0 })"
      />
      <h3>{{ t('turmas.fontes') }}</h3>
      <div v-for="(p, i) in f.fontes" :key="`f${i}`" class="filtros">
        <SanteSelecao
          :id="`turma-fonte-${i}`"
          v-model="p.fontePagadora"
          :rotulo="t('turmas.campos.fontePagadora')"
          :opcoes="opcoesDe('fontePagadora', t('turmas.escolha'))"
        />
        <SanteCampoTexto v-model="p.limite" :rotulo="t('turmas.campos.limite')" :max-bytes="3" />
        <SanteBotao variante="texto" :rotulo="t('turmas.remover')" @acionar="f.fontes.splice(i, 1)" />
      </div>
      <SanteBotao
        variante="secundario"
        :rotulo="t('turmas.adicionarFonte')"
        @acionar="f.fontes.push({ fontePagadora: '', limite: '' })"
      />
      <p v-if="recusaTurma" role="alert" data-testid="turma-recusa">{{ recusaTurma.mensagem }}</p>
      <div class="acoes">
        <SanteBotao
          :rotulo="t('turmas.gravar')"
          :desabilitado="!!recusaTurma || ocupado"
          data-testid="turma-gravar"
          @acionar="salvarCadastro"
        />
        <SanteBotao variante="secundario" :rotulo="t('turmas.cancelar')" @acionar="editando = null" />
      </div>
    </section>

    <section v-if="aberta !== null && detalhe.data.value" class="painel" data-testid="turma-detalhe">
      <h2>{{ detalhe.data.value.turma.codigo }} · {{ detalhe.data.value.turma.descricao }}</h2>
      <SanteBotao
        v-if="podeManter && editando === null"
        variante="secundario"
        :rotulo="t('turmas.editar')"
        data-testid="turma-editar"
        @acionar="abrirCadastro(detalhe.data.value.turma)"
      />

      <h3>{{ t('turmas.escala') }}</h3>
      <p v-if="detalhe.data.value.escalas.length === 0">{{ t('turmas.semEscala') }}</p>
      <ul v-else class="lista-simples" data-testid="turma-escalas">
        <li v-for="s in detalhe.data.value.escalas" :key="s.id">
          {{ t(`turmas.dias.${s.diaSemana}`) }}
          {{ t('turmas.faixaHorario', { inicio: s.horaInicio, fim: s.horaFim }) }}
          {{ t('turmas.separador') }}
          {{
            t('turmas.periodo', {
              de: dataBr(s.vigenciaInicio),
              ate: s.vigenciaFim ? dataBr(s.vigenciaFim) : t('turmas.semFim'),
            })
          }}
          <span v-if="s.inclusiveFeriado"> · {{ t('turmas.inclusiveFeriado') }}</span>
        </li>
      </ul>
      <div v-if="podeManter" class="filtros" data-testid="turma-escala-form">
        <SanteSelecao
          id="escala-dia"
          v-model="ef.diaSemana"
          :rotulo="t('turmas.diaSemana')"
          :opcoes="opcoesDia"
        />
        <SanteCampoTexto
          v-model="ef.horaInicio"
          :rotulo="t('turmas.horaInicio')"
          :max-bytes="5"
          data-testid="escala-inicio"
        />
        <SanteCampoTexto
          v-model="ef.horaFim"
          :rotulo="t('turmas.horaFim')"
          :max-bytes="5"
          data-testid="escala-fim"
        />
        <SanteData v-model="ef.vigenciaInicio" :rotulo="t('turmas.vigenciaInicio')" editavel />
        <SanteData v-model="ef.vigenciaFim" :rotulo="t('turmas.vigenciaFim')" editavel />
        <SanteChave
          :ligada="ef.inclusiveFeriado"
          :rotulo="t('turmas.inclusiveFeriado')"
          @alternar="(v: boolean) => (ef.inclusiveFeriado = v)"
        />
        <SanteBotao
          :rotulo="t('turmas.gravarEscala')"
          :desabilitado="!!recusaEscala || ocupado"
          data-testid="escala-gravar"
          @acionar="gravar(() => salvarEscala(aberta!, entradaEscala, novaChave('turma-escala')))"
        />
      </div>
      <p v-if="podeManter && recusaEscala" role="alert" data-testid="escala-recusa">
        {{ recusaEscala.mensagem }}
      </p>
      <div v-if="podeManter && detalhe.data.value.escalas.length > 0" class="filtros">
        <SanteData v-model="gerarDe" :rotulo="t('turmas.de')" editavel />
        <SanteData v-model="gerarAte" :rotulo="t('turmas.ate')" editavel />
        <SanteBotao
          :rotulo="t('turmas.gerar')"
          :desabilitado="!gerarDe || !gerarAte || ocupado"
          data-testid="encontros-gerar"
          @acionar="gravar(() => gerarEncontros(aberta!, gerarDe!, gerarAte!, novaChave('turma-encontros')))"
        />
      </div>

      <h3>{{ t('turmas.encontros') }}</h3>
      <p v-if="detalhe.data.value.encontros.length === 0">{{ t('turmas.semEncontros') }}</p>
      <table v-else class="tabela" data-testid="turma-encontros">
        <tbody>
          <tr v-for="e in detalhe.data.value.encontros" :key="e.id">
            <td>
              {{ dataBr(e.data) }}
              {{ t('turmas.faixaHorario', { inicio: e.horaInicio, fim: e.horaFim }) }}
            </td>
            <td>
              {{ t(`turmas.situacoesEncontro.${e.situacao}`) }}
              <span v-if="e.motivoCancelamento"> · {{ e.motivoCancelamento }}</span>
            </td>
            <td class="acoes">
              <SanteBotao
                v-if="podePresenca && e.situacao !== 'cancelado'"
                variante="secundario"
                :rotulo="t('turmas.presenca')"
                :data-testid="`encontro-presenca-${e.id}`"
                @acionar="abrirPresenca(e)"
              />
              <SanteBotao
                v-if="podeManter && e.situacao === 'previsto'"
                variante="texto"
                :rotulo="t('turmas.cancelarEncontro')"
                :data-testid="`encontro-cancelar-${e.id}`"
                @acionar="((cancelando = e), (motivoCancelamento = ''))"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="cancelando" class="filtros" data-testid="encontro-cancelamento">
        <SanteCampoTexto
          v-model="motivoCancelamento"
          :rotulo="t('turmas.motivo')"
          :max-bytes="500"
          data-testid="encontro-motivo"
        />
        <SanteBotao
          :rotulo="t('turmas.confirmarCancelamento')"
          :desabilitado="!motivoCancelamento.trim() || ocupado"
          data-testid="encontro-cancelar-confirmar"
          @acionar="
            gravar(
              () =>
                cancelarEncontro(
                  cancelando!.id,
                  cancelando!.versao,
                  motivoCancelamento,
                  novaChave('turma-cancelar'),
                ),
              () => (cancelando = null),
            )
          "
        />
        <SanteBotao variante="secundario" :rotulo="t('turmas.cancelar')" @acionar="cancelando = null" />
      </div>
      <section
        v-if="encontroAberto !== null && presenca.data.value"
        class="painel"
        data-testid="presenca-encontro"
      >
        <h4>
          {{ t('turmas.presenca') }} · {{ dataBr(presenca.data.value.encontro.data) }}
          {{ presenca.data.value.encontro.horaInicio }}
        </h4>
        <SanteBotao
          variante="texto"
          :rotulo="t('turmas.todosPresentes')"
          data-testid="presenca-todos"
          @acionar="marcas.forEach((m) => ((m.situacao = 'presente'), (m.justificativa = null)))"
        />
        <div
          v-for="(m, i) in marcas"
          :key="m.participante"
          class="filtros"
          :data-testid="`presenca-linha-${m.participante}`"
        >
          <span>{{ nomeDoParticipante(m.participante) }}</span>
          <SanteSelecao
            :id="`presenca-${i}`"
            v-model="m.situacao"
            :rotulo="t('turmas.presenca')"
            :opcoes="opcoesPresenca"
          />
          <SanteCampoTexto
            v-if="m.situacao !== 'presente'"
            :model-value="m.justificativa ?? ''"
            :rotulo="t('turmas.justificativa')"
            :max-bytes="500"
            @update:model-value="(v: string) => (m.justificativa = v)"
          />
          <SanteChave
            v-if="detalhe.data.value.turma.permiteAcompanhante"
            :ligada="m.acompanhante"
            :rotulo="t('turmas.acompanhantePresente')"
            @alternar="(v: boolean) => (m.acompanhante = v)"
          />
        </div>
        <p v-if="recusaPresenca" role="alert">{{ recusaPresenca }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('turmas.gravarPresenca')"
            :desabilitado="!!recusaPresenca || marcas.length === 0 || ocupado"
            data-testid="presenca-gravar"
            @acionar="
              gravar(
                () => registrarPresenca(encontroAberto!, marcas, novaChave('turma-presenca')),
                () => (encontroAberto = null),
              )
            "
          />
          <SanteBotao variante="secundario" :rotulo="t('turmas.fechar')" @acionar="encontroAberto = null" />
        </div>
      </section>

      <h3>{{ t('turmas.participantes') }}</h3>
      <p v-if="detalhe.data.value.participantes.length === 0">{{ t('turmas.semParticipantes') }}</p>
      <table v-else class="tabela" data-testid="turma-participantes">
        <tbody>
          <tr v-for="p in detalhe.data.value.participantes" :key="p.id" :data-testid="`participante-${p.id}`">
            <td>
              {{ p.nome }}<span v-if="p.prontuario"> · {{ p.prontuario }}</span>
            </td>
            <td>{{ p.fontePagadora }}</td>
            <td>{{ situacaoTexto(p) }}</td>
            <td>{{ t('turmas.frequencia') }}: {{ freqTexto(p.frequencia) }}</td>
            <td class="acoes">
              <SanteBotao
                v-if="podeInscrever && ['em_espera', 'inscrito', 'ativo'].includes(p.situacao)"
                variante="texto"
                :rotulo="t('turmas.sair')"
                :data-testid="`participante-sair-${p.id}`"
                @acionar="((saindo = p), (saida.motivo = ''))"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="saindo" class="filtros" data-testid="participante-saida">
        <SanteSelecao id="saida-tipo" v-model="saida.tipo" :rotulo="t('turmas.sair')" :opcoes="opcoesSaida" />
        <SanteCampoTexto
          v-model="saida.motivo"
          :rotulo="t('turmas.motivo')"
          :max-bytes="500"
          data-testid="saida-motivo"
        />
        <SanteBotao
          :rotulo="t('turmas.confirmarSaida')"
          :desabilitado="(saida.tipo !== 'concluido' && !saida.motivo.trim()) || ocupado"
          data-testid="saida-confirmar"
          @acionar="
            gravar(
              () =>
                sairDaTurma(
                  saindo!.id,
                  saindo!.versao,
                  saida.tipo,
                  saida.motivo.trim() || null,
                  novaChave('turma-saida'),
                ),
              () => (saindo = null),
            )
          "
        />
        <SanteBotao variante="secundario" :rotulo="t('turmas.cancelar')" @acionar="saindo = null" />
      </div>

      <section v-if="podeInscrever" class="painel" data-testid="turma-inscricao">
        <h3>{{ t('turmas.inscrever') }}</h3>
        <form v-if="!paciente" class="filtros" @submit.prevent="pedido = termo.trim()">
          <SanteCampoTexto
            v-model="termo"
            :rotulo="t('turmas.buscarPaciente')"
            :max-bytes="100"
            data-testid="inscricao-busca"
          />
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="t('turmas.buscar')"
            data-testid="inscricao-buscar"
          />
        </form>
        <ul v-if="pacientes.data.value && !paciente" class="lista-simples">
          <li v-for="p in pacientes.data.value.itens" :key="p.id">
            <SanteBotao
              variante="texto"
              :rotulo="t('turmas.escolherPaciente', { nome: p.nomeSocial ?? p.nome })"
              :data-testid="`inscricao-paciente-${p.id}`"
              @acionar="paciente = { id: p.id, nome: p.nomeSocial ?? p.nome }"
            />
          </li>
        </ul>
        <template v-if="paciente">
          <p>
            {{ t('turmas.pacienteEscolhido', { nome: paciente.nome }) }}
            <SanteBotao variante="texto" :rotulo="t('turmas.trocar')" @acionar="paciente = null" />
          </p>
          <div data-testid="turmas-do-paciente">
            <strong>{{ t('turmas.turmasDoPaciente') }}</strong>
            <p v-if="doPaciente.data.value && doPaciente.data.value.length === 0">
              {{ t('turmas.nenhumaDoPaciente') }}
            </p>
            <ul v-else-if="doPaciente.data.value" class="lista-simples">
              <li v-for="x in doPaciente.data.value" :key="x.turma">
                {{ x.codigo }} · {{ x.descricao }} · {{ situacaoTexto(x) }} · {{ t('turmas.frequencia') }}:
                {{ freqTexto(x.frequencia) }} · {{ dataHoraBr(x.proximoEncontro) }}
              </li>
            </ul>
          </div>
          <div class="filtros">
            <SanteSelecao
              id="inscricao-fonte"
              v-model="insc.fontePagadora"
              :rotulo="t('turmas.campos.fontePagadora')"
              :opcoes="opcoesDe('fontePagadora', t('turmas.escolha'))"
            />
            <SanteSelecao
              id="inscricao-indicacao"
              v-model="insc.indicacao"
              :rotulo="t('turmas.indicacao')"
              :opcoes="opcoesDe('profissional', exigeIndicacao ? t('turmas.escolha') : t('turmas.todos'))"
            />
            <SanteChave
              v-if="detalhe.data.value.turma.permiteAcompanhante"
              :ligada="insc.acompanhante"
              :rotulo="t('turmas.acompanhante')"
              @alternar="(v: boolean) => (insc.acompanhante = v)"
            />
            <SanteChave
              v-if="detalhe.data.value.turma.vagasEncaixe > 0"
              :ligada="insc.encaixe"
              :rotulo="t('turmas.encaixe')"
              @alternar="(v: boolean) => (insc.encaixe = v)"
            />
          </div>
          <SanteCampoTexto
            v-model="insc.observacao"
            :rotulo="t('turmas.observacao')"
            :max-bytes="2000"
            multilinha
          />
          <SanteBotao
            :rotulo="t('turmas.confirmarInscricao')"
            :desabilitado="!!recusaInscricao || ocupado"
            data-testid="inscricao-confirmar"
            @acionar="confirmarInscricao"
          />
        </template>
      </section>
    </section>

    <p v-if="mensagem" role="status" data-testid="turmas-mensagem">{{ mensagem }}</p>
    <ErroAgenda
      v-if="erro || lista.error.value || detalhe.error.value"
      :erro="erro ?? lista.error.value ?? detalhe.error.value"
    />
  </section>
</template>

<style src="../componentes/estilo-agenda.css"></style>
