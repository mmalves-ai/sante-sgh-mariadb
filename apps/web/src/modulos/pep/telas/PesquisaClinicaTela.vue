<script setup lang="ts">
// Pesquisa clínica (03-PEP L144): a lista dos estudos do estabelecimento e, aberto um, o cadastro ético (situação,
// CAAE e aprovações), a equipe, os critérios de elegibilidade, a triagem (que só sugere candidatos; com a automática
// desligada, a equipe indica os pacientes pela busca remota), a avaliação do candidato com a inclusão pelo TCLE
// anexado ao prontuário dele e o acompanhamento dos participantes (situação com motivo na saída e visitas).
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  avaliarTriagemPesquisa,
  buscarPacientesPesquisa,
  buscarProfissionaisPesquisa,
  cadastrarEstudoPesquisa,
  desativarCriterioPesquisa,
  incluirCriterioPesquisa,
  incluirMembroPesquisa,
  lerAnexosPesquisa,
  lerEstudoPesquisa,
  lerPainelPesquisa,
  mudarParticipantePesquisa,
  mudarSituacaoEstudo,
  registrarVisitaPesquisa,
  triarPesquisa,
} from '../api-pesquisa-clinica.js';
import { dataHoraBr } from '../formato.js';

const { t } = useI18n();
const cliente = useQueryClient();
const painel = useQuery({ queryKey: ['pep', 'pesquisa'], queryFn: () => lerPainelPesquisa(), staleTime: 0 });
const aberto = ref<number | null>(null);
const estudo = useQuery({
  queryKey: computed(() => ['pep', 'pesquisa', aberto.value]),
  queryFn: () => lerEstudoPesquisa(aberto.value!),
  enabled: computed(() => aberto.value !== null),
  staleTime: 0,
});
const e = computed(() => estudo.data.value ?? null);

const erro = ref<unknown>(null);
const aviso = ref('');
async function fazer(
  acao: () => Promise<Record<string, unknown>>,
  msg?: (r: Record<string, unknown>) => string,
) {
  erro.value = null;
  aviso.value = '';
  try {
    const r = await acao();
    aviso.value = msg ? msg(r) : t('pep.pesquisa.gravado');
    await cliente.invalidateQueries({ queryKey: ['pep', 'pesquisa'] });
  } catch (x) {
    erro.value = x;
  }
}

// Opções das listas fechadas, pelos textos do i18n.
const op = (grupo: string, chaves: readonly string[]) =>
  chaves.map((v) => ({ valor: v, rotulo: t(`pep.pesquisa.${grupo}.${v}`) }));
const SITUACOES = [
  'em_aprovacao',
  'aprovada',
  'recrutando',
  'em_andamento',
  'suspensa',
  'encerrada',
  'cancelada',
];
const FASES = ['fase_1', 'fase_2', 'fase_3', 'fase_4', 'observacional', 'outro'];
const PAPEIS = ['coordenador', 'subinvestigador', 'farmaceutico', 'enfermeiro', 'monitor', 'outro'];
const TIPOS = ['inclusao', 'exclusao', 'saida'];
const FONTES = ['diagnostico', 'idade', 'sexo', 'manual'];
const DECISOES = ['em_avaliacao', 'incluido', 'recusado', 'inelegivel', 'descartado'];
const PARTICIPANTE = [
  'em_tratamento',
  'em_acompanhamento',
  'concluido',
  'retirado',
  'excluido_por_criterio',
  'obito',
];

// Busca remota dos profissionais (investigador, equipe e avaliador) e dos pacientes indicados à triagem.
const termoProf = ref('');
const profissionais = useQuery({
  queryKey: computed(() => ['pep', 'pesquisa', 'prof', termoProf.value]),
  queryFn: () => buscarProfissionaisPesquisa(termoProf.value),
  enabled: computed(() => termoProf.value.trim().length >= 3),
});
const opcProf = computed(() => [
  { valor: null as number | null, rotulo: t('pep.pesquisa.buscarProfissional') },
  ...(profissionais.data.value ?? []).map((p) => ({ valor: p.id as number | null, rotulo: p.nome })),
]);
const termoPac = ref('');
const pacientes = useQuery({
  queryKey: computed(() => ['pep', 'pesquisa', 'pac', termoPac.value]),
  queryFn: () => buscarPacientesPesquisa(termoPac.value),
  enabled: computed(() => termoPac.value.trim().length >= 3),
});
const opcPac = computed(() => [
  { valor: null as number | null, rotulo: t('pep.pesquisa.buscarPaciente') },
  ...(pacientes.data.value ?? []).map((p) => ({ valor: p.id as number | null, rotulo: p.nome })),
]);

const novo = reactive({
  codigo: '',
  titulo: '',
  fase: 'fase_3',
  inicio: '',
  investigador: null as number | null,
});
const cadastrar = () =>
  fazer(
    () => cadastrarEstudoPesquisa({ ...novo }),
    (r) => {
      aberto.value = Number(r['estudo']);
      return t('pep.pesquisa.gravado');
    },
  );

const sit = reactive({
  situacao: 'aprovada',
  numeroCaae: '',
  aprovacaoEticaEm: '',
  aprovadoComite: false,
  aprovadoDiretoria: false,
});
const mudarSituacao = () =>
  fazer(() =>
    mudarSituacaoEstudo(e.value!.id, {
      versao: e.value!.versao,
      situacao: sit.situacao,
      numeroCaae: sit.numeroCaae || null,
      aprovacaoEticaEm: sit.aprovacaoEticaEm || null,
      aprovadoComite: sit.aprovadoComite,
      aprovadoDiretoria: sit.aprovadoDiretoria,
    }),
  );

const membro = reactive({ profissional: null as number | null, papel: 'coordenador', inicio: '' });
const incluirMembro = () => fazer(() => incluirMembroPesquisa(e.value!.id, { ...membro }));

const crit = reactive({
  tipo: 'inclusao',
  fonte: 'diagnostico',
  grupo: 1,
  descricao: '',
  valorTexto: '',
  valorMinimo: null as number | null,
  valorMaximo: null as number | null,
});
const incluirCriterio = () =>
  fazer(() =>
    incluirCriterioPesquisa(e.value!.id, {
      ...crit,
      valorTexto: crit.valorTexto || null,
      valorMinimo: crit.valorMinimo === null || Number.isNaN(crit.valorMinimo) ? null : crit.valorMinimo,
      valorMaximo: crit.valorMaximo === null || Number.isNaN(crit.valorMaximo) ? null : crit.valorMaximo,
    }),
  );

// Pacientes indicados à triagem (obrigatórios com a automática desligada).
const indicado = ref<number | null>(null);
const indicados = ref<{ id: number; nome: string }[]>([]);
watch(indicado, (v) => {
  const p = (pacientes.data.value ?? []).find((x) => x.id === v);
  if (p && !indicados.value.some((x) => x.id === p.id)) indicados.value.push({ id: p.id, nome: p.nome });
  if (v !== null) indicado.value = null;
});
const triar = () =>
  fazer(
    () =>
      triarPesquisa(
        e.value!.id,
        indicados.value.map((x) => x.id),
      ),
    (r) => {
      indicados.value = [];
      return t('pep.pesquisa.triado', { avaliados: r['avaliados'], sugeridos: r['sugeridos'] });
    },
  );

// Avaliação do candidato escolhido: na inclusão, o TCLE é um anexo do prontuário dele.
const candidato = ref<number | null>(null);
const cand = computed(() => e.value?.triagens.find((x) => x.id === candidato.value) ?? null);
const anexos = useQuery({
  queryKey: computed(() => ['pep', 'pesquisa', 'anexos', cand.value?.paciente]),
  queryFn: () => lerAnexosPesquisa(cand.value!.paciente),
  enabled: computed(() => cand.value !== null),
});
const opcAnexos = computed(() => [
  { valor: null as number | null, rotulo: '—' },
  ...(anexos.data.value ?? []).map((a) => ({
    valor: a.id as number | null,
    rotulo: `${a.nome ?? a.id} · ${dataHoraBr(a.em)}`,
  })),
]);
const aval = reactive({
  decisao: 'incluido',
  avaliador: null as number | null,
  consentimentoEm: '',
  anexo: null as number | null,
  codigoParticipante: '',
  braco: '',
  observacao: '',
});
const avaliar = () =>
  fazer(() =>
    avaliarTriagemPesquisa(cand.value!.id, {
      versao: cand.value!.versao,
      decisao: aval.decisao,
      avaliador: aval.avaliador,
      consentimentoEm: aval.consentimentoEm || null,
      anexo: aval.anexo,
      codigoParticipante: aval.codigoParticipante || null,
      braco: aval.braco || null,
      observacao: aval.observacao || null,
    }),
  );

const escolhido = ref<number | null>(null);
const part = computed(() => e.value?.participantes.find((x) => x.id === escolhido.value) ?? null);
const mud = reactive({ situacao: 'em_tratamento', motivo: '', visitaEm: '', observacao: '' });
const mudarParticipante = () =>
  fazer(() =>
    mudarParticipantePesquisa(part.value!.id, {
      versao: part.value!.versao,
      situacao: mud.situacao,
      motivo: mud.motivo || null,
    }),
  );
const registrarVisita = () =>
  fazer(() =>
    registrarVisitaPesquisa(part.value!.id, { ocorridoEm: mud.visitaEm, observacao: mud.observacao || null }),
  );

const opcCandidatos = computed(() => [
  { valor: null as number | null, rotulo: '—' },
  ...(e.value?.triagens ?? [])
    .filter((x) => x.situacao === 'identificado' || x.situacao === 'em_avaliacao')
    .map((x) => ({ valor: x.id as number | null, rotulo: x.nome ?? String(x.paciente) })),
]);
const opcParticipantes = computed(() => [
  { valor: null as number | null, rotulo: '—' },
  ...(e.value?.participantes ?? []).map((x) => ({
    valor: x.id as number | null,
    rotulo: x.nome ?? String(x.paciente),
  })),
]);
</script>

<template>
  <section class="tela" aria-labelledby="pesquisa-titulo" data-testid="pesquisa-clinica">
    <h1 id="pesquisa-titulo">{{ t('pep.pesquisa.titulo') }}</h1>
    <p>{{ t('pep.pesquisa.explicacao') }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="aviso" role="status" data-testid="pesquisa-aviso">{{ aviso }}</p>

    <h2>{{ t('pep.pesquisa.estudos') }}</h2>
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="!painel.data.value" role="status">{{ t('pep.carregando') }}</p>
    <template v-else>
      <p v-if="painel.data.value.estudos.length === 0" role="status">{{ t('pep.pesquisa.nenhumEstudo') }}</p>
      <ul v-else class="lista" data-testid="pesquisa-estudos">
        <li v-for="s in painel.data.value.estudos" :key="s.id">
          <button
            type="button"
            class="ligacao"
            :data-testid="`pesquisa-abrir-${s.id}`"
            @click="aberto = s.id"
          >
            {{
              t('pep.pesquisa.linhaEstudo', {
                codigo: s.codigo,
                titulo: s.titulo,
                situacao: t(`pep.pesquisa.situacoesEstudo.${s.situacao}`),
                participantes: s.participantes,
                candidatos: s.candidatos,
              })
            }}
          </button>
        </li>
      </ul>
    </template>

    <form class="grade" data-testid="pesquisa-novo" @submit.prevent="cadastrar">
      <h3>{{ t('pep.pesquisa.novo') }}</h3>
      <label>{{ t('pep.pesquisa.codigo') }} <input v-model="novo.codigo" maxlength="30" required /></label>
      <label
        >{{ t('pep.pesquisa.tituloEstudo') }} <input v-model="novo.titulo" maxlength="250" required
      /></label>
      <SanteSelecao v-model="novo.fase" :rotulo="t('pep.pesquisa.fase')" :opcoes="op('fases', FASES)" />
      <label>{{ t('pep.pesquisa.inicio') }} <input v-model="novo.inicio" type="date" required /></label>
      <SanteSelecao
        v-model="novo.investigador"
        :rotulo="t('pep.pesquisa.investigador')"
        :opcoes="opcProf"
        :buscar="(q: string) => (termoProf = q)"
        obrigatorio
        data-testid="pesquisa-investigador"
      />
      <SanteBotao :rotulo="t('pep.pesquisa.cadastrar')" tipo="submit" data-testid="pesquisa-cadastrar" />
    </form>

    <MensagemErro v-if="estudo.isError.value" :erro="estudo.error.value" />
    <article v-if="e" class="estudo" :aria-label="e.titulo" data-testid="pesquisa-estudo">
      <h2>{{ e.codigo }} · {{ e.titulo }}</h2>
      <p>
        {{ t(`pep.pesquisa.situacoesEstudo.${e.situacao}`) }} · {{ e.numeroCaae ?? '—' }} ·
        {{ e.aprovacaoEticaEm ?? '—' }}
      </p>

      <form class="grade" data-testid="pesquisa-situacao" @submit.prevent="mudarSituacao">
        <h3>{{ t('pep.pesquisa.mudarSituacao') }}</h3>
        <SanteSelecao
          v-model="sit.situacao"
          :rotulo="t('pep.pesquisa.situacao')"
          :opcoes="op('situacoesEstudo', SITUACOES)"
        />
        <label>{{ t('pep.pesquisa.numeroCaae') }} <input v-model="sit.numeroCaae" maxlength="20" /></label>
        <label
          >{{ t('pep.pesquisa.aprovacaoEticaEm') }} <input v-model="sit.aprovacaoEticaEm" type="date"
        /></label>
        <label
          ><input v-model="sit.aprovadoComite" type="checkbox" />
          {{ t('pep.pesquisa.aprovadoComite') }}</label
        >
        <label
          ><input v-model="sit.aprovadoDiretoria" type="checkbox" />
          {{ t('pep.pesquisa.aprovadoDiretoria') }}</label
        >
        <SanteBotao
          :rotulo="t('pep.pesquisa.mudarSituacao')"
          tipo="submit"
          data-testid="pesquisa-mudar-situacao"
        />
      </form>

      <h3>{{ t('pep.pesquisa.equipe') }}</h3>
      <ul class="lista" data-testid="pesquisa-equipe">
        <li v-for="m in e.equipe" :key="m.id">{{ m.nome }} · {{ t(`pep.pesquisa.papeis.${m.papel}`) }}</li>
      </ul>
      <form class="grade" @submit.prevent="incluirMembro">
        <SanteSelecao
          v-model="membro.profissional"
          :rotulo="t('pep.pesquisa.incluirMembro')"
          :opcoes="opcProf"
          :buscar="(q: string) => (termoProf = q)"
        />
        <SanteSelecao
          v-model="membro.papel"
          :rotulo="t('pep.pesquisa.papel')"
          :opcoes="op('papeis', PAPEIS)"
        />
        <label>{{ t('pep.pesquisa.inicio') }} <input v-model="membro.inicio" type="date" required /></label>
        <SanteBotao :rotulo="t('pep.pesquisa.incluirMembro')" tipo="submit" />
      </form>

      <h3>{{ t('pep.pesquisa.criterios') }}</h3>
      <ul class="lista" data-testid="pesquisa-criterios">
        <li v-for="c in e.criterios" :key="c.id">
          {{ c.sequencia }}. {{ t(`pep.pesquisa.tipos.${c.tipo}`) }} ({{ c.grupo }}) ·
          {{ t(`pep.pesquisa.fontes.${c.fonte}`) }} · {{ c.descricao }} {{ c.valorTexto ?? '' }}
          {{ c.valorMinimo ?? '' }} {{ c.valorMaximo ?? '' }}
          <span v-if="!c.ativo">· {{ t('pep.pesquisa.inativo') }}</span>
          <SanteBotao
            v-else
            variante="secundario"
            :rotulo="t('pep.pesquisa.desativar', { n: c.sequencia })"
            @click="fazer(() => desativarCriterioPesquisa(e!.id, c.id, c.versao))"
          />
        </li>
      </ul>
      <form class="grade" data-testid="pesquisa-criterio" @submit.prevent="incluirCriterio">
        <SanteSelecao v-model="crit.tipo" :rotulo="t('pep.pesquisa.tipo')" :opcoes="op('tipos', TIPOS)" />
        <SanteSelecao v-model="crit.fonte" :rotulo="t('pep.pesquisa.fonte')" :opcoes="op('fontes', FONTES)" />
        <label
          >{{ t('pep.pesquisa.grupo') }} <input v-model.number="crit.grupo" type="number" min="1" max="99"
        /></label>
        <label
          >{{ t('pep.pesquisa.descricao') }} <input v-model="crit.descricao" maxlength="500" required
        /></label>
        <label>{{ t('pep.pesquisa.valorTexto') }} <input v-model="crit.valorTexto" maxlength="500" /></label>
        <label
          >{{ t('pep.pesquisa.valorMinimo') }} <input v-model.number="crit.valorMinimo" type="number"
        /></label>
        <label
          >{{ t('pep.pesquisa.valorMaximo') }} <input v-model.number="crit.valorMaximo" type="number"
        /></label>
        <SanteBotao
          :rotulo="t('pep.pesquisa.incluirCriterio')"
          tipo="submit"
          data-testid="pesquisa-incluir-criterio"
        />
      </form>

      <h3>{{ t('pep.pesquisa.triagem') }}</h3>
      <p v-if="!e.recruta" role="status">{{ t('pep.pesquisa.naoRecruta') }}</p>
      <p role="status" data-testid="pesquisa-automatica">
        {{
          painel.data.value?.triagemAutomatica
            ? t('pep.pesquisa.automaticaLigada')
            : t('pep.pesquisa.automaticaDesligada')
        }}
      </p>
      <div class="grade">
        <SanteSelecao
          v-model="indicado"
          :rotulo="t('pep.pesquisa.pacienteIndicado')"
          :opcoes="opcPac"
          :buscar="(q: string) => (termoPac = q)"
          data-testid="pesquisa-paciente"
        />
        <ul class="lista" data-testid="pesquisa-indicados">
          <li v-for="p in indicados" :key="p.id">
            {{ p.nome }}
            <SanteBotao
              variante="secundario"
              :rotulo="t('pep.pesquisa.retirar', { nome: p.nome })"
              @click="indicados = indicados.filter((x) => x.id !== p.id)"
            />
          </li>
        </ul>
        <SanteBotao
          :rotulo="t('pep.pesquisa.triar')"
          :desabilitado="!e.recruta || (!painel.data.value?.triagemAutomatica && indicados.length === 0)"
          data-testid="pesquisa-triar"
          @click="triar"
        />
      </div>

      <h3>{{ t('pep.pesquisa.candidatos') }}</h3>
      <p v-if="e.triagens.length === 0" role="status">{{ t('pep.pesquisa.nenhumCandidato') }}</p>
      <ul v-else class="lista" data-testid="pesquisa-candidatos">
        <li v-for="x in e.triagens" :key="x.id">
          {{
            t('pep.pesquisa.linhaCandidato', {
              nome: x.nome ?? x.paciente,
              situacao: t(`pep.pesquisa.situacoesTriagem.${x.situacao}`),
              atendidos: x.atendidos.length,
              conferir: x.aConferir.length,
            })
          }}
        </li>
      </ul>
      <form class="grade" data-testid="pesquisa-avaliacao" @submit.prevent="avaliar">
        <SanteSelecao
          v-model="candidato"
          :rotulo="t('pep.pesquisa.candidatos')"
          :opcoes="opcCandidatos"
          data-testid="pesquisa-candidato"
        />
        <template v-if="cand">
          <SanteSelecao
            v-model="aval.decisao"
            :rotulo="t('pep.pesquisa.decisao')"
            :opcoes="op('decisoes', DECISOES)"
          />
          <SanteSelecao
            v-model="aval.avaliador"
            :rotulo="t('pep.pesquisa.investigador')"
            :opcoes="opcProf"
            :buscar="(q: string) => (termoProf = q)"
          />
          <template v-if="aval.decisao === 'incluido'">
            <label
              >{{ t('pep.pesquisa.consentimentoEm') }}
              <input v-model="aval.consentimentoEm" type="datetime-local" data-testid="pesquisa-tcle-em"
            /></label>
            <SanteSelecao
              v-model="aval.anexo"
              :rotulo="t('pep.pesquisa.termo')"
              :opcoes="opcAnexos"
              data-testid="pesquisa-tcle"
            />
            <label
              >{{ t('pep.pesquisa.codigoParticipante') }}
              <input v-model="aval.codigoParticipante" maxlength="30"
            /></label>
            <label>{{ t('pep.pesquisa.braco') }} <input v-model="aval.braco" maxlength="60" /></label>
          </template>
          <label
            >{{ t('pep.pesquisa.observacao') }} <input v-model="aval.observacao" maxlength="4000"
          /></label>
          <SanteBotao :rotulo="t('pep.pesquisa.avaliar')" tipo="submit" data-testid="pesquisa-avaliar" />
        </template>
      </form>

      <h3>{{ t('pep.pesquisa.participantes') }}</h3>
      <p v-if="e.participantes.length === 0" role="status">{{ t('pep.pesquisa.nenhumParticipante') }}</p>
      <ul v-else class="lista" data-testid="pesquisa-participantes">
        <li v-for="x in e.participantes" :key="x.id">
          {{
            t('pep.pesquisa.linhaParticipante', {
              nome: x.nome ?? x.paciente,
              codigo: x.codigo ?? '—',
              situacao: t(`pep.pesquisa.situacoesParticipante.${x.situacao}`),
              incluido: dataHoraBr(x.incluidoEm),
              visita: x.ultimaVisita ? dataHoraBr(x.ultimaVisita) : '—',
            })
          }}
        </li>
      </ul>
      <div class="grade" data-testid="pesquisa-acompanhamento">
        <SanteSelecao
          v-model="escolhido"
          :rotulo="t('pep.pesquisa.participantes')"
          :opcoes="opcParticipantes"
        />
        <template v-if="part">
          <SanteSelecao
            v-model="mud.situacao"
            :rotulo="t('pep.pesquisa.novaSituacao')"
            :opcoes="op('situacoesParticipante', PARTICIPANTE)"
          />
          <label>{{ t('pep.pesquisa.motivo') }} <input v-model="mud.motivo" maxlength="500" /></label>
          <SanteBotao :rotulo="t('pep.pesquisa.mudarParticipante')" @click="mudarParticipante" />
          <label
            >{{ t('pep.pesquisa.visitaEm') }}
            <input v-model="mud.visitaEm" type="datetime-local" data-testid="pesquisa-visita-em"
          /></label>
          <label>{{ t('pep.pesquisa.observacao') }} <input v-model="mud.observacao" maxlength="500" /></label>
          <SanteBotao
            :rotulo="t('pep.pesquisa.registrarVisita')"
            :desabilitado="!mud.visitaEm"
            data-testid="pesquisa-registrar-visita"
            @click="registrarVisita"
          />
        </template>
      </div>
    </article>
  </section>
</template>

<style scoped>
.grade {
  display: grid;
  gap: 0.5rem;
  max-width: 48rem;
  margin-block: 1rem;
}
.lista {
  padding-left: 1.25rem;
}
.ligacao {
  background: none;
  border: none;
  padding: 0;
  color: var(--sgh-cor-link, inherit);
  text-decoration: underline;
  cursor: pointer;
  text-align: left;
}
</style>
