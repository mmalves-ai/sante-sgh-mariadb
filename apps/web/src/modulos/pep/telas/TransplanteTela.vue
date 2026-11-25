<script setup lang="ts">
// Doação e transplante de órgãos (03-PEP L145), numa tela só por paciente. À esquerda o paciente como doador: a
// doação em aberto com as pendências (notificar a central, entrevista familiar), o formulário por grupos (avaliação,
// autorização da família, captação) validado na hora pela mesma regra do servidor, os antibióticos em uso, a oferta de
// cada órgão a um receptor da lista (urgência primeiro), os passos do destino até o transplante e as soluções de
// preservação. À direita o paciente como receptor: a inscrição por órgão, a situação e a aptidão, o transplante vindo
// do destino e o acompanhamento depois do transplante (D+n; suspeita de rejeição em destaque). Nada é apagado.
import {
  CONSENTIMENTOS_DOACAO,
  conferirAcompanhamento,
  conferirAntibioticoDoador,
  conferirDoadorOrgao,
  conferirPreservacao,
  conferirReceptor,
  conferirTransicaoDestino,
  conferirTransicaoDoador,
  conferirTransicaoReceptor,
  type ConsentimentoDoacao,
  type FalhaTransplante,
  SITUACOES_DESTINO_ORGAO,
  SITUACOES_DOADOR_ORGAO,
  SITUACOES_RECEPTOR,
  type SituacaoDestinoOrgao,
  type SituacaoDoadorOrgao,
  type SituacaoReceptor,
  TIPOS_ACOMPANHAMENTO_TRANSPLANTE,
  TIPOS_DIALISE,
  TIPOS_DOADOR_ORGAO,
  TIPOS_PERFUSAO,
  type TipoDoadorOrgao,
} from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  type DestinoTela,
  type DoacaoTela,
  gravarTransplante,
  type GravacaoTransplanteTela,
  type InscricaoTela,
  lerOpcoesTransplante,
  lerReceptoresDoOrgao,
  lerTransplantePaciente,
} from '../api-transplante.js';
import { dataHoraBr } from '../formato.js';

const props = defineProps<{ paciente: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const id = computed(() => Number(props.paciente));
const chave = computed(() => ['pep', 'transplante', id.value]);
const op = useQuery({ queryKey: ['pep', 'transplante', 'opcoes'], queryFn: () => lerOpcoesTransplante() });
const dados = useQuery({ queryKey: chave, queryFn: () => lerTransplantePaciente(id.value), staleTime: 0 });
const d = computed(() => dados.data.value);
const o = computed(() => op.data.value);
const podeGravar = computed(() => pode('pep.evolucao.criar'));
const erro = ref<unknown>(null);
const ok = ref('');
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const dataBr = (v: string | null) => (v ? v.split('-').reverse().join('/') : '');
/** "aaaa-mm-ddThh:mm" do campo local para ISO; vazio é nulo. */
const isoDe = (v: string) => (v ? new Date(v).toISOString() : null);
const localDe = (v: string | null) => {
  if (!v) return '';
  const x = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
};
const numOuNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const opcoes = <T extends string>(lista: readonly T[], grupo: string) =>
  lista.map((v) => ({ valor: v as string, rotulo: t(`pep.transplante.${grupo}.${v}`) }));
const opcoesOrgao = computed(() =>
  (o.value?.orgaos ?? []).map((x) => ({ valor: String(x.id), rotulo: x.descricao })),
);
const opcoesParentesco = computed(() => [
  { valor: '', rotulo: t('pep.transplante.nenhum') },
  ...(o.value?.parentescos ?? []).map((x) => ({ valor: String(x.id), rotulo: x.descricao })),
]);

async function gravar(tipo: GravacaoTransplanteTela, corpo: Record<string, unknown>, depois?: () => void) {
  erro.value = null;
  ok.value = '';
  try {
    const r = await gravarTransplante(tipo, corpo);
    ok.value = r.mensagem ?? t('pep.transplante.gravado');
    depois?.();
    await cliente.invalidateQueries({ queryKey: chave.value });
  } catch (e) {
    erro.value = e;
  }
}

// ------------------------------------------------------------------ doador
const CAMPOS_MOMENTO = [
  'consentimentoEm',
  'morteEncefalicaEm',
  'internadoEm',
  'captacaoEm',
  'procedimentoInicioEm',
  'procedimentoFimEm',
  'clampeamentoEm',
] as const;
const CAMPOS_TEXTO = [
  ['registroCentral', 30],
  ['causaInternacao', 100],
  ['causaMorte', 100],
  ['pressaoArterial', 20],
  ['aminasVasoativas', 100],
  ['responsavelConsentimento', 150],
  ['paradaDescricao', 100],
  ['observacao', 2000],
] as const;
const CAMPOS_NUMERO = [
  'diasTerapiaIntensiva',
  'pesoKg',
  'alturaCm',
  'frequenciaCardiaca',
  'saturacao',
] as const;
const vazioDoador = () => ({
  tipo: 'falecido' as string,
  situacao: 'em_avaliacao' as string,
  consentimento: 'pendente' as string,
  parentesco: '',
  tipoPerfusao: '',
  teveParadaCardiaca: false,
  ...Object.fromEntries(CAMPOS_MOMENTO.map((c) => [c, ''])),
  ...Object.fromEntries(CAMPOS_TEXTO.map(([c]) => [c, ''])),
  ...Object.fromEntries(CAMPOS_NUMERO.map((c) => [c, ''])),
});
const fd = reactive<Record<string, string | boolean>>(vazioDoador());
const editando = ref<{ id: number; versao: number; situacao: SituacaoDoadorOrgao } | null>(null);
const abrirFormulario = ref(false);
const doacaoAberta = computed(() => (d.value?.doacoes ?? []).find((x) => !x.encerrada) ?? null);

function editar(x: DoacaoTela) {
  Object.assign(fd, vazioDoador(), {
    tipo: x.tipo,
    situacao: x.situacao,
    consentimento: x.consentimento,
    parentesco: x.parentesco ? String(x.parentesco.id) : '',
    tipoPerfusao: x.tipoPerfusao ?? '',
    teveParadaCardiaca: x.teveParadaCardiaca,
  });
  for (const c of CAMPOS_MOMENTO) fd[c] = localDe(x[c]);
  for (const [c] of CAMPOS_TEXTO) fd[c] = x[c] ?? '';
  for (const c of CAMPOS_NUMERO) fd[c] = x[c] === null ? '' : String(x[c]);
  editando.value = { id: x.id, versao: x.versao, situacao: x.situacao as SituacaoDoadorOrgao };
  abrirFormulario.value = true;
}
function novaDoacao() {
  Object.assign(fd, vazioDoador());
  editando.value = null;
  abrirFormulario.value = true;
}
const str = (c: string) => String(fd[c] ?? '');
const situacoesPossiveis = computed(() =>
  editando.value
    ? SITUACOES_DOADOR_ORGAO.filter((s) => !conferirTransicaoDoador(editando.value!.situacao, s))
    : (['em_avaliacao'] as const),
);
const falhasDoador = computed<FalhaTransplante[]>(() => {
  const m = (c: string) => (str(c) ? new Date(str(c)) : null);
  const f = conferirDoadorOrgao(
    {
      tipo: str('tipo') as TipoDoadorOrgao,
      situacao: str('situacao') as SituacaoDoadorOrgao,
      consentimento: str('consentimento') as ConsentimentoDoacao,
      consentimentoEm: m('consentimentoEm'),
      responsavelConsentimento: str('responsavelConsentimento') || null,
      parentescoId: str('parentesco') ? Number(str('parentesco')) : null,
      morteEncefalicaEm: m('morteEncefalicaEm'),
      captacaoEm: m('captacaoEm'),
      procedimentoInicioEm: m('procedimentoInicioEm'),
      procedimentoFimEm: m('procedimentoFimEm'),
      clampeamentoEm: m('clampeamentoEm'),
      saturacao: numOuNull(str('saturacao')),
      pesoKg: numOuNull(str('pesoKg')),
      alturaCm: numOuNull(str('alturaCm')),
      teveParadaCardiaca: Boolean(fd['teveParadaCardiaca']),
      paradaDescricao: str('paradaDescricao') || null,
    },
    new Date(),
  );
  const tr = editando.value
    ? conferirTransicaoDoador(editando.value.situacao, str('situacao') as SituacaoDoadorOrgao)
    : null;
  return tr ? [tr, ...f] : f;
});
function gravarDoador() {
  const corpo: Record<string, unknown> = {
    paciente: id.value,
    tipo: str('tipo'),
    situacao: str('situacao'),
    consentimento: str('consentimento'),
    parentesco: str('parentesco') ? Number(str('parentesco')) : null,
    tipoPerfusao: str('tipoPerfusao') || null,
    teveParadaCardiaca: Boolean(fd['teveParadaCardiaca']),
    ...Object.fromEntries(CAMPOS_MOMENTO.map((c) => [c, isoDe(str(c))])),
    ...Object.fromEntries(CAMPOS_TEXTO.map(([c]) => [c, str(c).trim() || null])),
    ...Object.fromEntries(CAMPOS_NUMERO.map((c) => [c, numOuNull(str(c))])),
  };
  if (editando.value) Object.assign(corpo, { id: editando.value.id, versao: editando.value.versao });
  return gravar('doador', corpo, () => {
    abrirFormulario.value = false;
    editando.value = null;
  });
}

// ------------------------------------------------------------------ antibiótico, oferta e preservação
const ab = reactive({ descricao: '', inicio: hoje() });
const falhasAntibiotico = computed(() =>
  conferirAntibioticoDoador({ descricao: ab.descricao, inicio: ab.inicio, fim: null }, hoje()),
);
const of = reactive({ orgao: '', receptor: '', parente: false, parentesco: '' });
const receptores = useQuery({
  queryKey: computed(() => ['pep', 'transplante', 'receptores', of.orgao]),
  queryFn: () => lerReceptoresDoOrgao(Number(of.orgao)),
  enabled: computed(() => Boolean(of.orgao)),
});
const opcoesReceptor = computed(() =>
  (receptores.data.value ?? [])
    .filter((r) => r.paciente !== id.value)
    .map((r) => ({
      valor: String(r.id),
      rotulo: [
        t('pep.transplante.prontuario', { n: r.prontuario ?? r.paciente }),
        dataBr(r.cadastradoEm),
        r.urgencia ? t('pep.transplante.urgente') : '',
        r.apto ? '' : t('pep.transplante.inapto'),
      ]
        .filter(Boolean)
        .join(' · '),
    })),
);
const pv = reactive({
  orgao: '',
  receptor: '',
  nomeSolucao: '',
  lote: '',
  validade: '',
  volumeMl: '',
  aplicadaEm: '',
});
function receptoresDaDoacao(x: DoacaoTela) {
  return [
    { valor: '', rotulo: t('pep.transplante.semReceptor') },
    ...x.destinos
      .filter(
        (y) => String(y.orgao.id) === pv.orgao && y.situacao !== 'recusado' && y.situacao !== 'descartado',
      )
      .map((y) => ({
        valor: String(y.receptor),
        rotulo: t('pep.transplante.prontuario', { n: y.prontuarioReceptor }),
      })),
  ];
}
function falhasPreservacao(x: DoacaoTela) {
  if (!pv.aplicadaEm) return [];
  return conferirPreservacao(
    {
      situacaoDoador: x.situacao as SituacaoDoadorOrgao,
      aplicadaEm: new Date(pv.aplicadaEm),
      validade: pv.validade || null,
      volumeMl: numOuNull(pv.volumeMl),
      procedimentoInicioEm: x.procedimentoInicioEm ? new Date(x.procedimentoInicioEm) : null,
      nomeSolucao: pv.nomeSolucao,
    },
    new Date(),
  );
}
const dataTransplante = ref(hoje());
/** Próximos passos do destino que a regra aceita agora (o servidor confere de novo). */
function passosDestino(
  y: DestinoTela,
  situacaoDoador: string,
  situacaoReceptor: string,
): SituacaoDestinoOrgao[] {
  return SITUACOES_DESTINO_ORGAO.filter(
    (s) =>
      s !== y.situacao &&
      conferirTransicaoDestino(y.situacao as SituacaoDestinoOrgao, s, {
        situacaoDoador: situacaoDoador as SituacaoDoadorOrgao,
        situacaoReceptor: situacaoReceptor as SituacaoReceptor,
      }).length === 0,
  );
}

// ------------------------------------------------------------------ receptor e acompanhamento
const fr = reactive({
  orgao: '',
  cadastradoEm: hoje(),
  numeroRegistroCentral: '',
  numeroCadastroNacional: '',
  urgencia: false,
  tipoDialise: '',
  centroHemodialise: '',
  tipoAcessoDialise: '',
});
const falhasReceptor = computed(() =>
  conferirReceptor({ cadastradoEm: fr.cadastradoEm, apto: true, motivoAptidao: null }, hoje()),
);
const er = reactive<Record<number, { situacao: string; apto: boolean; motivo: string; urgencia: boolean }>>(
  {},
);
const edicaoReceptor = (x: InscricaoTela) =>
  (er[x.id] ??= { situacao: x.situacao, apto: x.apto, motivo: x.motivoAptidao ?? '', urgencia: x.urgencia });
function falhasEdicaoReceptor(x: InscricaoTela) {
  const e = edicaoReceptor(x);
  const tr = conferirTransicaoReceptor(x.situacao as SituacaoReceptor, e.situacao as SituacaoReceptor);
  const f = conferirReceptor(
    { cadastradoEm: x.cadastradoEm ?? hoje(), apto: e.apto, motivoAptidao: e.motivo || null },
    hoje(),
  );
  return tr ? [tr, ...f] : f;
}
function gravarEdicaoReceptor(x: InscricaoTela) {
  const e = edicaoReceptor(x);
  return gravar(
    'receptor',
    {
      id: x.id,
      versao: x.versao,
      paciente: id.value,
      orgao: x.orgao.id,
      cadastradoEm: x.cadastradoEm,
      numeroRegistroCentral: x.numeroRegistroCentral,
      numeroCadastroNacional: x.numeroCadastroNacional,
      situacao: e.situacao,
      apto: e.apto,
      motivoAptidao: e.apto ? null : e.motivo || null,
      urgencia: e.urgencia,
      centroHemodialise: x.centroHemodialise,
      tipoDialise: x.tipoDialise,
      tipoAcessoDialise: x.tipoAcessoDialise,
      outrosResultados: x.outrosResultados,
    },
    () => delete er[x.id],
  );
}
const ac = reactive({ observadoEm: hoje(), tipo: 'sintoma', descricao: '' });
const falhasAcompanhamento = (x: InscricaoTela) =>
  conferirAcompanhamento(
    {
      situacaoReceptor: x.situacao as SituacaoReceptor,
      transplantadoEm: x.transplantadoEm,
      observadoEm: ac.observadoEm,
      descricao: ac.descricao,
    },
    hoje(),
  );
</script>

<template>
  <section class="tx" data-testid="transplante-tela">
    <h1>{{ t('pep.transplante.titulo') }}</h1>
    <p class="tx__dica">{{ t('pep.transplante.intro') }}</p>
    <MensagemErro v-if="dados.error.value" :erro="dados.error.value" />
    <MensagemErro v-else-if="op.error.value" :erro="op.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta v-if="ok" variante="info" :texto="ok" anunciar data-testid="transplante-ok" />
    <p v-if="!d || !o">{{ t('pep.carregando') }}</p>
    <div v-else class="tx__colunas">
      <!-- ============================== doador -->
      <div class="tx__coluna" data-testid="transplante-doador">
        <h2>{{ t('pep.transplante.comoDoador') }}</h2>
        <p v-if="!d.doacoes.length">{{ t('pep.transplante.semDoacao') }}</p>
        <SanteBotao
          v-if="podeGravar && !doacaoAberta && !abrirFormulario"
          data-testid="transplante-nova-doacao"
          @acionar="novaDoacao"
          :rotulo="t('pep.transplante.novaDoacao')"
        />
        <form
          v-if="abrirFormulario"
          class="tx__form"
          data-testid="transplante-form-doador"
          @submit.prevent="gravarDoador"
        >
          <fieldset>
            <legend>{{ t('pep.transplante.grupoAvaliacao') }}</legend>
            <SanteSelecao
              v-model="fd['tipo'] as string"
              :rotulo="t('pep.transplante.tipo')"
              :opcoes="opcoes(TIPOS_DOADOR_ORGAO, 'tipos')"
              data-testid="transplante-tipo"
            />
            <SanteSelecao
              v-model="fd['situacao'] as string"
              :rotulo="t('pep.transplante.situacao')"
              :opcoes="opcoes(situacoesPossiveis, 'situacoesDoador')"
              data-testid="transplante-situacao"
            />
            <SanteCampoTexto
              v-model="fd['causaInternacao'] as string"
              :rotulo="t('pep.transplante.causaInternacao')"
              :max-bytes="100"
            />
            <SanteCampoTexto
              v-model="fd['causaMorte'] as string"
              :rotulo="t('pep.transplante.causaMorte')"
              :max-bytes="100"
            />
            <label class="tx__campo"
              >{{ t('pep.transplante.morteEncefalicaEm') }}
              <input
                v-model="fd['morteEncefalicaEm']"
                type="datetime-local"
                data-testid="transplante-morte-encefalica"
              />
            </label>
            <label class="tx__campo"
              >{{ t('pep.transplante.internadoEm') }}
              <input v-model="fd['internadoEm']" type="datetime-local" />
            </label>
            <label v-for="c in CAMPOS_NUMERO" :key="c" class="tx__campo"
              >{{ t(`pep.transplante.${c}`) }}
              <input v-model="fd[c]" type="number" step="any" min="0" :data-testid="`transplante-${c}`" />
            </label>
            <SanteCampoTexto
              v-model="fd['pressaoArterial'] as string"
              :rotulo="t('pep.transplante.pressaoArterial')"
              :max-bytes="20"
            />
            <SanteCampoTexto
              v-model="fd['aminasVasoativas'] as string"
              :rotulo="t('pep.transplante.aminasVasoativas')"
              :max-bytes="100"
            />
            <label class="tx__marca"
              ><input v-model="fd['teveParadaCardiaca']" type="checkbox" />{{
                t('pep.transplante.teveParadaCardiaca')
              }}</label
            >
            <SanteCampoTexto
              v-if="fd['teveParadaCardiaca']"
              v-model="fd['paradaDescricao'] as string"
              :rotulo="t('pep.transplante.paradaDescricao')"
              :max-bytes="100"
            />
            <SanteCampoTexto
              v-model="fd['registroCentral'] as string"
              :rotulo="t('pep.transplante.registroCentral')"
              :max-bytes="30"
            />
          </fieldset>
          <fieldset>
            <legend>{{ t('pep.transplante.grupoFamilia') }}</legend>
            <SanteSelecao
              v-model="fd['consentimento'] as string"
              :rotulo="t('pep.transplante.consentimento')"
              :opcoes="opcoes(CONSENTIMENTOS_DOACAO, 'consentimentos')"
              data-testid="transplante-consentimento"
            />
            <label class="tx__campo"
              >{{ t('pep.transplante.consentimentoEm') }}
              <input
                v-model="fd['consentimentoEm']"
                type="datetime-local"
                data-testid="transplante-consentimento-em"
              />
            </label>
            <SanteCampoTexto
              v-model="fd['responsavelConsentimento'] as string"
              :rotulo="t('pep.transplante.responsavel')"
              :max-bytes="150"
            />
            <SanteSelecao
              v-model="fd['parentesco'] as string"
              :rotulo="t('pep.transplante.parentesco')"
              :opcoes="opcoesParentesco"
            />
          </fieldset>
          <fieldset>
            <legend>{{ t('pep.transplante.grupoCaptacao') }}</legend>
            <label
              v-for="c in ['captacaoEm', 'procedimentoInicioEm', 'procedimentoFimEm', 'clampeamentoEm']"
              :key="c"
              class="tx__campo"
            >
              {{ t(`pep.transplante.${c}`) }}
              <input v-model="fd[c]" type="datetime-local" :data-testid="`transplante-${c}`" />
            </label>
            <SanteSelecao
              v-model="fd['tipoPerfusao'] as string"
              :rotulo="t('pep.transplante.tipoPerfusao')"
              :opcoes="[
                { valor: '', rotulo: t('pep.transplante.nenhum') },
                ...opcoes(TIPOS_PERFUSAO, 'perfusoes'),
              ]"
            />
            <SanteCampoTexto
              v-model="fd['observacao'] as string"
              :rotulo="t('pep.transplante.observacao')"
              :max-bytes="2000"
              multilinha
            />
          </fieldset>
          <ul v-if="falhasDoador.length" class="tx__falhas" data-testid="transplante-falhas-doador">
            <li v-for="f in falhasDoador" :key="f.codigo">{{ f.mensagem }}</li>
          </ul>
          <div class="tx__acoes">
            <SanteBotao
              tipo="submit"
              :desabilitado="falhasDoador.length > 0"
              data-testid="transplante-gravar-doador"
              :rotulo="t('pep.transplante.gravar')"
            />
            <SanteBotao
              variante="secundario"
              @acionar="abrirFormulario = false"
              :rotulo="t('pep.transplante.cancelar')"
            />
          </div>
        </form>

        <article
          v-for="x in d.doacoes"
          :key="x.id"
          class="tx__cartao"
          :data-testid="`transplante-doacao-${x.id}`"
        >
          <header class="tx__cabeca">
            <strong
              >{{ t(`pep.transplante.tipos.${x.tipo}`) }} ·
              {{ t(`pep.transplante.situacoesDoador.${x.situacao}`) }}</strong
            >
            <span v-if="x.encerrada && x.fechadoEm">{{
              t('pep.transplante.encerrada', { d: dataHoraBr(x.fechadoEm) })
            }}</span>
            <SanteBotao
              v-if="podeGravar && !x.encerrada"
              variante="secundario"
              :data-testid="`transplante-editar-${x.id}`"
              @acionar="editar(x)"
              :rotulo="t('pep.transplante.editar')"
            />
          </header>
          <SanteAlerta
            v-for="p in x.pendencias"
            :key="p.codigo"
            variante="aviso"
            :texto="p.mensagem"
            :data-testid="`transplante-pendencia-${p.codigo}`"
          />
          <dl class="tx__dados">
            <dt>{{ t('pep.transplante.consentimento') }}</dt>
            <dd>
              {{ t(`pep.transplante.consentimentos.${x.consentimento}`)
              }}<template v-if="x.parentesco"> · {{ x.parentesco.descricao }}</template>
            </dd>
            <template v-if="x.morteEncefalicaEm"
              ><dt>{{ t('pep.transplante.morteEncefalicaEm') }}</dt>
              <dd>{{ dataHoraBr(x.morteEncefalicaEm) }}</dd></template
            >
            <template v-if="x.captacaoEm"
              ><dt>{{ t('pep.transplante.captacaoEm') }}</dt>
              <dd>{{ dataHoraBr(x.captacaoEm) }}</dd></template
            >
            <template v-if="x.registroCentral"
              ><dt>{{ t('pep.transplante.registroCentral') }}</dt>
              <dd>{{ x.registroCentral }}</dd></template
            >
          </dl>

          <h3>{{ t('pep.transplante.antibioticos') }}</h3>
          <ul>
            <li v-for="a in x.antibioticos" :key="a.id">
              {{ a.descricao }} · {{ dataBr(a.inicio)
              }}<template v-if="a.fim">{{ t('pep.transplante.ate', { d: dataBr(a.fim) }) }}</template>
              <SanteBotao
                v-if="podeGravar && !a.fim && !x.encerrada"
                variante="secundario"
                @acionar="gravar('antibiotico', { doador: x.id, id: a.id, versao: a.versao, fim: hoje() })"
                :rotulo="t('pep.transplante.encerrarHoje')"
              />
            </li>
          </ul>
          <form
            v-if="podeGravar && !x.encerrada"
            class="tx__linha"
            @submit.prevent="
              gravar(
                'antibiotico',
                { doador: x.id, descricao: ab.descricao, inicio: ab.inicio },
                () => (ab.descricao = ''),
              )
            "
          >
            <SanteCampoTexto
              v-model="ab.descricao"
              :rotulo="t('pep.transplante.antibiotico')"
              :max-bytes="100"
              data-testid="transplante-antibiotico"
            />
            <label class="tx__campo"
              >{{ t('pep.transplante.inicio') }}<input v-model="ab.inicio" type="date"
            /></label>
            <SanteBotao
              tipo="submit"
              :desabilitado="falhasAntibiotico.length > 0"
              data-testid="transplante-incluir-antibiotico"
              :rotulo="t('pep.transplante.incluir')"
            />
          </form>

          <h3>{{ t('pep.transplante.destinos') }}</h3>
          <ul>
            <li v-for="y in x.destinos" :key="y.id" :data-testid="`transplante-destino-${y.id}`">
              {{ t('pep.transplante.destinoLinha', { o: y.orgao.descricao, n: y.prontuarioReceptor }) }}
              {{ t(`pep.transplante.situacoesDestino.${y.situacao}`) }}
              <template v-if="podeGravar">
                <SanteBotao
                  v-for="s in passosDestino(y, x.situacao, 'ativo')"
                  :key="s"
                  variante="secundario"
                  :data-testid="`transplante-destino-${y.id}-${s}`"
                  @acionar="
                    gravar('destino', {
                      id: y.id,
                      versao: y.versao,
                      situacao: s,
                      ...(s === 'transplantado' ? { transplantadoEm: dataTransplante } : {}),
                    })
                  "
                  :rotulo="t('pep.transplante.passar', { s: t(`pep.transplante.situacoesDestino.${s}`) })"
                />
              </template>
            </li>
          </ul>
          <label v-if="podeGravar && x.destinos.some((y) => y.situacao === 'aceito')" class="tx__campo">
            {{ t('pep.transplante.transplantadoEm')
            }}<input v-model="dataTransplante" type="date" :max="hoje()" />
          </label>
          <form
            v-if="podeGravar && (x.situacao === 'apto' || x.situacao === 'captado')"
            class="tx__linha"
            data-testid="transplante-form-oferta"
            @submit.prevent="
              gravar(
                'destino',
                {
                  doador: x.id,
                  receptor: Number(of.receptor),
                  orgao: Number(of.orgao),
                  doadorVivoParente: of.parente,
                  parentesco: of.parente && of.parentesco ? Number(of.parentesco) : null,
                },
                () => (of.receptor = ''),
              )
            "
          >
            <SanteSelecao
              v-model="of.orgao"
              :rotulo="t('pep.transplante.orgao')"
              :opcoes="opcoesOrgao"
              data-testid="transplante-oferta-orgao"
            />
            <SanteSelecao
              v-if="of.orgao"
              v-model="of.receptor"
              :rotulo="t('pep.transplante.receptoresDoOrgao')"
              :opcoes="opcoesReceptor"
              data-testid="transplante-oferta-receptor"
            />
            <p v-if="of.orgao && receptores.data.value && !opcoesReceptor.length">
              {{ t('pep.transplante.semReceptores') }}
            </p>
            <template v-if="x.tipo === 'vivo'">
              <label class="tx__marca"
                ><input v-model="of.parente" type="checkbox" />{{
                  t('pep.transplante.doadorVivoParente')
                }}</label
              >
              <SanteSelecao
                v-if="of.parente"
                v-model="of.parentesco"
                :rotulo="t('pep.transplante.parentesco')"
                :opcoes="opcoesParentesco"
              />
            </template>
            <SanteBotao
              tipo="submit"
              :desabilitado="!of.receptor || (of.parente && !of.parentesco)"
              data-testid="transplante-ofertar"
              :rotulo="t('pep.transplante.ofertar')"
            />
          </form>

          <h3>{{ t('pep.transplante.preservacoes') }}</h3>
          <ul>
            <li v-for="p in x.preservacoes" :key="p.id">
              {{ p.sequencia }}. {{ p.orgao.descricao }} · {{ p.nomeSolucao
              }}<template v-if="p.lote"> ({{ p.lote }})</template> · {{ dataHoraBr(p.aplicadaEm)
              }}<template v-if="p.volumeMl">{{ t('pep.transplante.volume', { v: p.volumeMl }) }}</template>
            </li>
          </ul>
          <form
            v-if="podeGravar && (x.situacao === 'apto' || x.situacao === 'captado')"
            class="tx__linha"
            @submit.prevent="
              gravar(
                'preservacao',
                {
                  doador: x.id,
                  orgao: Number(pv.orgao),
                  receptor: pv.receptor ? Number(pv.receptor) : null,
                  nomeSolucao: pv.nomeSolucao,
                  lote: pv.lote || null,
                  validade: pv.validade || null,
                  volumeMl: numOuNull(pv.volumeMl),
                  aplicadaEm: isoDe(pv.aplicadaEm),
                },
                () => Object.assign(pv, { nomeSolucao: '', lote: '', volumeMl: '' }),
              )
            "
          >
            <SanteSelecao v-model="pv.orgao" :rotulo="t('pep.transplante.orgao')" :opcoes="opcoesOrgao" />
            <SanteSelecao
              v-if="pv.orgao"
              v-model="pv.receptor"
              :rotulo="t('pep.transplante.receptor')"
              :opcoes="receptoresDaDoacao(x)"
            />
            <SanteCampoTexto
              v-model="pv.nomeSolucao"
              :rotulo="t('pep.transplante.nomeSolucao')"
              :max-bytes="150"
            />
            <SanteCampoTexto v-model="pv.lote" :rotulo="t('pep.transplante.lote')" :max-bytes="30" />
            <label class="tx__campo"
              >{{ t('pep.transplante.validade') }}<input v-model="pv.validade" type="date"
            /></label>
            <label class="tx__campo"
              >{{ t('pep.transplante.volumeMl')
              }}<input v-model="pv.volumeMl" type="number" min="0" step="any"
            /></label>
            <label class="tx__campo"
              >{{ t('pep.transplante.aplicadaEm') }}<input v-model="pv.aplicadaEm" type="datetime-local"
            /></label>
            <ul v-if="falhasPreservacao(x).length" class="tx__falhas">
              <li v-for="f in falhasPreservacao(x)" :key="f.codigo">{{ f.mensagem }}</li>
            </ul>
            <SanteBotao
              tipo="submit"
              :desabilitado="
                !pv.orgao || !pv.aplicadaEm || !pv.nomeSolucao.trim() || falhasPreservacao(x).length > 0
              "
              :rotulo="t('pep.transplante.incluir')"
            />
          </form>
        </article>
      </div>

      <!-- ============================== receptor -->
      <div class="tx__coluna" data-testid="transplante-receptor">
        <h2>{{ t('pep.transplante.comoReceptor') }}</h2>
        <p v-if="!d.inscricoes.length">{{ t('pep.transplante.semInscricao') }}</p>
        <article
          v-for="x in d.inscricoes"
          :key="x.id"
          class="tx__cartao"
          :data-testid="`transplante-inscricao-${x.id}`"
        >
          <header class="tx__cabeca">
            <strong
              >{{ x.orgao.descricao }} · {{ t(`pep.transplante.situacoesReceptor.${x.situacao}`) }}</strong
            >
            <span>{{ t('pep.transplante.cadastradoEm') }} {{ dataBr(x.cadastradoEm) }}</span>
            <span v-if="x.urgencia" class="tx__selo">{{ t('pep.transplante.urgente') }}</span>
          </header>
          <p v-if="x.transplantadoEm">
            {{ t('pep.transplante.transplantadoEm') }}: {{ dataBr(x.transplantadoEm) }}
            <template v-for="y in x.destinos.filter((z) => z.situacao === 'transplantado')" :key="y.id">
              · {{ t('pep.transplante.doadorDoOrgao', { n: y.prontuarioDoador }) }}</template
            >
          </p>
          <form v-if="podeGravar && x.naLista" class="tx__linha" @submit.prevent="gravarEdicaoReceptor(x)">
            <SanteSelecao
              v-model="edicaoReceptor(x).situacao"
              :rotulo="t('pep.transplante.situacao')"
              :opcoes="
                opcoes(
                  SITUACOES_RECEPTOR.filter((s) => s !== 'transplantado'),
                  'situacoesReceptor',
                )
              "
              :data-testid="`transplante-receptor-situacao-${x.id}`"
            />
            <label class="tx__marca"
              ><input v-model="edicaoReceptor(x).apto" type="checkbox" />{{
                t('pep.transplante.apto')
              }}</label
            >
            <SanteCampoTexto
              v-if="!edicaoReceptor(x).apto"
              v-model="edicaoReceptor(x).motivo"
              :rotulo="t('pep.transplante.motivoAptidao')"
              :max-bytes="500"
            />
            <label class="tx__marca"
              ><input v-model="edicaoReceptor(x).urgencia" type="checkbox" />{{
                t('pep.transplante.urgencia')
              }}</label
            >
            <ul v-if="falhasEdicaoReceptor(x).length" class="tx__falhas">
              <li v-for="f in falhasEdicaoReceptor(x)" :key="f.codigo">{{ f.mensagem }}</li>
            </ul>
            <SanteBotao
              tipo="submit"
              :desabilitado="falhasEdicaoReceptor(x).length > 0"
              :data-testid="`transplante-gravar-receptor-${x.id}`"
              :rotulo="t('pep.transplante.gravar')"
            />
          </form>
          <template v-if="x.situacao === 'transplantado'">
            <h3>{{ t('pep.transplante.acompanhamento') }}</h3>
            <ol class="tx__acomp">
              <li
                v-for="a in x.acompanhamentos"
                :key="a.id"
                :class="{ tx__destaque: a.destaque }"
                :data-testid="`transplante-acompanhamento-${a.id}`"
              >
                <strong>{{ a.dias === null ? '' : t('pep.transplante.dia', { n: a.dias }) }}</strong>
                {{ dataBr(a.observadoEm) }} · {{ t(`pep.transplante.tiposAcompanhamento.${a.tipo}`) }}:
                {{ a.descricao }}
                <template v-if="a.profissional"> ({{ a.profissional }})</template>
              </li>
            </ol>
            <form
              v-if="podeGravar"
              class="tx__linha"
              data-testid="transplante-form-acompanhamento"
              @submit.prevent="
                gravar(
                  'acompanhamento',
                  { receptor: x.id, observadoEm: ac.observadoEm, tipo: ac.tipo, descricao: ac.descricao },
                  () => (ac.descricao = ''),
                )
              "
            >
              <label class="tx__campo"
                >{{ t('pep.transplante.observadoEm')
                }}<input
                  v-model="ac.observadoEm"
                  type="date"
                  :min="x.transplantadoEm ?? undefined"
                  :max="hoje()"
              /></label>
              <SanteSelecao
                v-model="ac.tipo"
                :rotulo="t('pep.transplante.tipoAcompanhamento')"
                :opcoes="opcoes(TIPOS_ACOMPANHAMENTO_TRANSPLANTE, 'tiposAcompanhamento')"
              />
              <SanteCampoTexto
                v-model="ac.descricao"
                :rotulo="t('pep.transplante.descricao')"
                :max-bytes="500"
                multilinha
                data-testid="transplante-acompanhamento-descricao"
              />
              <ul v-if="ac.descricao && falhasAcompanhamento(x).length" class="tx__falhas">
                <li v-for="f in falhasAcompanhamento(x)" :key="f.codigo">{{ f.mensagem }}</li>
              </ul>
              <SanteBotao
                tipo="submit"
                :desabilitado="falhasAcompanhamento(x).length > 0"
                data-testid="transplante-incluir-acompanhamento"
                :rotulo="t('pep.transplante.incluir')"
              />
            </form>
          </template>
        </article>
        <form
          v-if="podeGravar"
          class="tx__form"
          data-testid="transplante-form-receptor"
          @submit.prevent="
            gravar(
              'receptor',
              {
                paciente: id,
                orgao: Number(fr.orgao),
                cadastradoEm: fr.cadastradoEm,
                numeroRegistroCentral: fr.numeroRegistroCentral || null,
                numeroCadastroNacional: fr.numeroCadastroNacional || null,
                urgencia: fr.urgencia,
                tipoDialise: fr.tipoDialise || null,
                centroHemodialise: fr.centroHemodialise || null,
                tipoAcessoDialise: fr.tipoAcessoDialise || null,
              },
              () => (fr.orgao = ''),
            )
          "
        >
          <h3>{{ t('pep.transplante.novaInscricao') }}</h3>
          <SanteSelecao
            v-model="fr.orgao"
            :rotulo="t('pep.transplante.orgao')"
            :opcoes="opcoesOrgao"
            data-testid="transplante-receptor-orgao"
          />
          <label class="tx__campo"
            >{{ t('pep.transplante.cadastradoEm')
            }}<input v-model="fr.cadastradoEm" type="date" :max="hoje()"
          /></label>
          <SanteCampoTexto
            v-model="fr.numeroRegistroCentral"
            :rotulo="t('pep.transplante.registroCentral')"
            :max-bytes="30"
          />
          <SanteCampoTexto
            v-model="fr.numeroCadastroNacional"
            :rotulo="t('pep.transplante.numeroCadastroNacional')"
            :max-bytes="30"
          />
          <label class="tx__marca"
            ><input v-model="fr.urgencia" type="checkbox" />{{ t('pep.transplante.urgencia') }}</label
          >
          <SanteSelecao
            v-model="fr.tipoDialise"
            :rotulo="t('pep.transplante.tipoDialise')"
            :opcoes="[
              { valor: '', rotulo: t('pep.transplante.nenhum') },
              ...opcoes(TIPOS_DIALISE, 'dialises'),
            ]"
          />
          <template v-if="fr.tipoDialise && fr.tipoDialise !== 'nenhuma'">
            <SanteCampoTexto
              v-model="fr.centroHemodialise"
              :rotulo="t('pep.transplante.centroHemodialise')"
              :max-bytes="100"
            />
            <SanteCampoTexto
              v-model="fr.tipoAcessoDialise"
              :rotulo="t('pep.transplante.tipoAcessoDialise')"
              :max-bytes="40"
            />
          </template>
          <ul v-if="falhasReceptor.length" class="tx__falhas">
            <li v-for="f in falhasReceptor" :key="f.codigo">{{ f.mensagem }}</li>
          </ul>
          <SanteBotao
            tipo="submit"
            :desabilitado="!fr.orgao || falhasReceptor.length > 0"
            data-testid="transplante-inscrever"
            :rotulo="t('pep.transplante.novaInscricao')"
          />
        </form>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tx__dica {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
}
.tx__colunas {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
  gap: var(--sgh-espaco-4);
}
.tx__coluna,
.tx__form {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.tx__form fieldset {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
}
.tx__linha {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--sgh-espaco-2);
}
.tx__campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.tx__marca {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
}
.tx__cartao {
  border: 1px solid var(--sgh-borda);
  background: var(--sgh-fundo-sutil);
  padding: var(--sgh-espaco-3);
}
.tx__cabeca {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
}
.tx__dados {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-2);
}
.tx__falhas {
  color: var(--sgh-alerta);
}
.tx__selo,
.tx__destaque {
  font-weight: bold;
  color: var(--sgh-alerta);
}
</style>
