<script setup lang="ts">
// Laudo complementar e sessões da APAC aberta (F7, 06-SUS linha 56): uma aba por laudo específico (oncologia, saúde
// auditiva, medicamento especializado, odontologia), com a aba exigida pelo procedimento já aberta e o aviso de
// pendência, e a aba das sessões (diálise, radioterapia, quimioterapia) da APAC autorizada. O servidor confere as
// regras (validade, família, datas); a tela confere na hora o que dá para conferir sem ir ao servidor.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  cancelarSessaoApac,
  type ComplementosApac,
  gravarLaudoEspecifico,
  LAUDOS,
  type LaudoEspecifico,
  lerComplementosApac,
  registrarSessaoApac,
  retirarLaudoEspecifico,
} from '../api-apac-complementos.js';
import { mensagensApacComplementos } from '../i18n-apac-complementos.js';

const props = defineProps<{ laudo: number; podeRegistrar: boolean }>();
const emit = defineEmits<{ alterada: [] }>();
const { t } = useI18n({ useScope: 'local', messages: mensagensApacComplementos });

const CAUSAS = [
  'causa_desconhecida',
  'causa_genetica',
  'surdez_subita',
  'malformacao_congenita',
  'presbiacusia',
  'otite_media_cronica',
  'pos_operatorio',
  'trauma_cranioencefalico',
  'idiopatica',
  'uso_ototoxicos',
  'fratura_osso_temporal',
  'anoxia',
  'baixo_peso',
  'trabalho_parto_prolongado',
  'prematuridade',
  'hiperbilirrubinemia',
  'meningite',
  'sarampo',
  'toxoplasmose',
  'caxumba',
  'rubeola_congenita',
] as const;
const MARCAS = [
  'mordida_cruzada_total',
  'mordida_cruzada_anterior',
  'mordida_cruzada_unilateral',
  'mordida_cruzada_bilateral',
  'desarmonia_maxilo_mandibular',
  'instalacao_aparelho_fixo',
  'instalacao_aparelho_movel',
  'manutencao_aparelho',
  'troca_aparelho',
  'dente_incluso',
  'dente_impactado',
  'remocao_cirurgica',
  'com_osteotomia',
  'desdentado_total',
  'desdentado_parcial',
  'implante_metalico',
] as const;
const legivel = (c: string) => c.replace(/_/g, ' ');

type Aba = LaudoEspecifico | 'sessoes';
const dados = ref<ComplementosApac | null>(null);
const aba = ref<Aba>('oncologia');
const erro = ref<string | null>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);

const vazio = () => ({
  oncologia: {
    tipoTratamento: 'quimioterapia' as 'quimioterapia' | 'radioterapia',
    estadiamentoTnm: '',
    grauHistopatologico: '',
    dataDiagnostico: null as string | null,
    dataIdentificacaoPatologica: null as string | null,
    dataInicioTratamento: null as string | null,
    finalidade: null as number | null,
    esquema: null as number | null,
    camposInsercao: '',
    metastase: false,
    metastaseLocal: null as number | null,
    continuidadeTratamento: false,
    observacao: '',
  },
  auditiva: {
    cidCausaBasica: '',
    cidCausaAssociada: '',
    justificativa: null as number | null,
    dificuldadeAuditiva: false,
    ouvidoDireito: false,
    ouvidoEsquerdo: false,
    evolucao: null as 'flutuante' | 'estavel' | 'progressiva' | null,
    causas: [] as string[],
    outrasCausas: '',
    examesRealizados: '',
    aparelhoIndicado: '',
  },
  medicamento: {
    medicamento: '',
    cidPrincipal: '',
    pesoKg: '',
    alturaCm: '',
    dosePrescrita: '',
    q1: '',
    q2: '',
    q3: '',
    periodoInicio: null as string | null,
    periodoFim: null as string | null,
  },
  odontologia: {
    anomaliaCraniofacial: false,
    descricaoAnomalia: '',
    marcas: [] as string[],
    justificativaTrocaAparelho: '',
    especificacaoDentes: '',
    quantidadeImplantes: '',
    tratamentoProposto: '',
  },
});
const f = reactive(vazio());
const sessao = reactive({
  data: null as string | null,
  comparecimento: 'compareceu' as 'compareceu' | 'faltou' | 'falta_justificada',
  modalidade: null as string | null,
  quantidade: '1',
  kits: '',
});

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const nulo = (v: string) => (v.trim() === '' ? null : v.trim());
const numero = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

function preencher(c: ComplementosApac) {
  Object.assign(f, vazio());
  const o = c.laudos.oncologia;
  if (o)
    Object.assign(f.oncologia, {
      tipoTratamento: o['tipoTratamento'],
      estadiamentoTnm: txt(o['estadiamentoTnm']),
      grauHistopatologico: txt(o['grauHistopatologico']),
      dataDiagnostico: o['dataDiagnostico'] ?? null,
      dataIdentificacaoPatologica: o['dataIdentificacaoPatologica'] ?? null,
      dataInicioTratamento: o['dataInicioTratamento'] ?? null,
      finalidade: o['finalidade'] ?? null,
      esquema: o['esquema'] ?? null,
      camposInsercao: txt(o['camposInsercao']),
      metastase: Boolean(o['metastase']),
      metastaseLocal: o['metastaseLocal'] ?? null,
      continuidadeTratamento: Boolean(o['continuidadeTratamento']),
      observacao: txt(o['observacao']),
    });
  const a = c.laudos.auditiva;
  if (a)
    Object.assign(f.auditiva, {
      cidCausaBasica: txt(a['cidCausaBasica']),
      cidCausaAssociada: txt(a['cidCausaAssociada']),
      justificativa: a['justificativa'] ?? null,
      dificuldadeAuditiva: Boolean(a['dificuldadeAuditiva']),
      ouvidoDireito: Boolean(a['ouvidoDireito']),
      ouvidoEsquerdo: Boolean(a['ouvidoEsquerdo']),
      evolucao: a['evolucao'] ?? null,
      causas: [...((a['causas'] as string[] | undefined) ?? [])],
      outrasCausas: txt(a['outrasCausas']),
      examesRealizados: txt(a['examesRealizados']),
      aparelhoIndicado: txt(a['aparelhoIndicado']),
    });
  const m = c.laudos.medicamento;
  if (m) {
    const q = (m['quantidades'] as (number | null)[] | undefined) ?? [];
    Object.assign(f.medicamento, {
      medicamento: txt(m['medicamento']),
      cidPrincipal: txt(m['cidPrincipal']),
      pesoKg: txt(m['pesoKg']),
      alturaCm: txt(m['alturaCm']),
      dosePrescrita: txt(m['dosePrescrita']),
      q1: txt(q[0]),
      q2: txt(q[1]),
      q3: txt(q[2]),
      periodoInicio: m['periodoInicio'] ?? null,
      periodoFim: m['periodoFim'] ?? null,
    });
  }
  const d = c.laudos.odontologia;
  if (d)
    Object.assign(f.odontologia, {
      anomaliaCraniofacial: Boolean(d['anomaliaCraniofacial']),
      descricaoAnomalia: txt(d['descricaoAnomalia']),
      marcas: [...((d['marcas'] as string[] | undefined) ?? [])],
      justificativaTrocaAparelho: txt(d['justificativaTrocaAparelho']),
      especificacaoDentes: txt(d['especificacaoDentes']),
      quantidadeImplantes: txt(d['quantidadeImplantes']),
      tratamentoProposto: txt(d['tratamentoProposto']),
    });
}

async function carregar(mudarAba: boolean) {
  erro.value = null;
  try {
    const c = await lerComplementosApac(props.laudo);
    dados.value = c;
    preencher(c);
    if (mudarAba)
      aba.value =
        c.exigido && c.exigido !== 'nefrologia'
          ? c.exigido
          : c.situacao === 'autorizada'
            ? 'sessoes'
            : (LAUDOS.find((l) => c.laudos[l] !== null) ?? 'oncologia');
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
}
watch(
  () => props.laudo,
  () => void carregar(true),
  { immediate: true },
);

const editavel = computed(
  () =>
    props.podeRegistrar && (dados.value?.situacao === 'solicitada' || dados.value?.situacao === 'autorizada'),
);
const opcoesDe = (lista: string) => [
  { valor: null, rotulo: t('escolha') },
  ...(dados.value?.opcoes[lista] ?? []).map((o) => ({ valor: o.id, rotulo: `${o.codigo} ${o.descricao}` })),
];
const opcoesTratamento = computed(() => [
  { valor: 'quimioterapia' as const, rotulo: t('onco.quimioterapia') },
  { valor: 'radioterapia' as const, rotulo: t('onco.radioterapia') },
]);
const opcoesEvolucao = computed(() => [
  { valor: null, rotulo: t('escolha') },
  { valor: 'flutuante' as const, rotulo: t('aud.flutuante') },
  { valor: 'estavel' as const, rotulo: t('aud.estavel') },
  { valor: 'progressiva' as const, rotulo: t('aud.progressiva') },
]);
const opcoesComparecimento = computed(() => [
  { valor: 'compareceu' as const, rotulo: t('ses.compareceu') },
  { valor: 'faltou' as const, rotulo: t('ses.faltou') },
  { valor: 'falta_justificada' as const, rotulo: t('ses.falta_justificada') },
]);
const opcoesModalidade = [
  { valor: null, rotulo: '-' },
  { valor: 'hemodialise', rotulo: 'Hemodiálise' },
  { valor: 'dpa', rotulo: 'DPA' },
  { valor: 'dpac', rotulo: 'DPAC' },
  { valor: 'capd', rotulo: 'CAPD' },
  { valor: 'dpi', rotulo: 'DPI' },
];
const renal = computed(() => dados.value?.familia === 'nefrologia');

/** Conferência na hora (a mesma do servidor, no que dá para saber sem ele). */
const avisos = computed<string[]>(() => {
  const r: string[] = [];
  if (aba.value === 'oncologia') {
    const o = f.oncologia;
    if (o.dataDiagnostico && o.dataInicioTratamento && o.dataInicioTratamento < o.dataDiagnostico)
      r.push(t('onco.inicioTratamento'));
    if (o.tipoTratamento === 'radioterapia' && !(Number(o.camposInsercao) >= 1)) r.push(t('onco.campos'));
    if (o.tipoTratamento === 'quimioterapia' && o.esquema === null) r.push(t('onco.esquema'));
    if (o.finalidade === null) r.push(t('onco.finalidade'));
  } else if (aba.value === 'auditiva') {
    const a = f.auditiva;
    if (a.dificuldadeAuditiva && !a.ouvidoDireito && !a.ouvidoEsquerdo) r.push(t('aud.direito'));
    if (a.causas.length === 0 && !a.outrasCausas.trim()) r.push(t('aud.causas'));
  } else if (aba.value === 'medicamento') {
    const m = f.medicamento;
    if (!/^06\d{8}$/.test(m.medicamento.replace(/\D/g, ''))) r.push(t('med.medicamento'));
    if (!(Number(m.q1) > 0)) r.push(t('med.mes1'));
  } else if (aba.value === 'odontologia') {
    const d = f.odontologia;
    if (!d.tratamentoProposto.trim()) r.push(t('odo.tratamento'));
    if (d.marcas.includes('implante_metalico') && !/^[1-3]$/.test(d.quantidadeImplantes))
      r.push(t('odo.implantes'));
    if (d.marcas.includes('troca_aparelho') && !d.justificativaTrocaAparelho.trim())
      r.push(t('odo.justificativaTroca'));
  } else {
    if (!sessao.data) r.push(t('ses.data'));
    if (renal.value && sessao.comparecimento === 'compareceu' && !sessao.modalidade)
      r.push(t('ses.modalidade'));
  }
  return r;
});

function corpoDo(l: LaudoEspecifico): Record<string, unknown> {
  switch (l) {
    case 'oncologia': {
      const o = f.oncologia;
      return {
        tipoTratamento: o.tipoTratamento,
        estadiamentoTnm: nulo(o.estadiamentoTnm),
        grauHistopatologico: nulo(o.grauHistopatologico),
        dataDiagnostico: o.dataDiagnostico,
        dataIdentificacaoPatologica: o.dataIdentificacaoPatologica,
        dataInicioTratamento: o.dataInicioTratamento,
        finalidade: o.finalidade,
        esquema: o.esquema,
        camposInsercao: numero(o.camposInsercao),
        metastase: o.metastase,
        metastaseLocal: o.metastase ? o.metastaseLocal : null,
        continuidadeTratamento: o.continuidadeTratamento,
        observacao: nulo(o.observacao),
      };
    }
    case 'auditiva': {
      const a = f.auditiva;
      return {
        cidCausaBasica: nulo(a.cidCausaBasica),
        cidCausaAssociada: nulo(a.cidCausaAssociada),
        justificativa: a.justificativa,
        dificuldadeAuditiva: a.dificuldadeAuditiva,
        ouvidoDireito: a.ouvidoDireito,
        ouvidoEsquerdo: a.ouvidoEsquerdo,
        evolucao: a.evolucao,
        causas: a.causas,
        outrasCausas: nulo(a.outrasCausas),
        examesRealizados: nulo(a.examesRealizados),
        aparelhoIndicado: nulo(a.aparelhoIndicado),
      };
    }
    case 'medicamento': {
      const m = f.medicamento;
      return {
        medicamento: m.medicamento.replace(/\D/g, ''),
        cidPrincipal: nulo(m.cidPrincipal),
        pesoKg: numero(m.pesoKg),
        alturaCm: numero(m.alturaCm),
        dosePrescrita: nulo(m.dosePrescrita),
        quantidades: [numero(m.q1), numero(m.q2), numero(m.q3)],
        periodoInicio: m.periodoInicio,
        periodoFim: m.periodoFim,
      };
    }
    case 'odontologia': {
      const d = f.odontologia;
      return {
        anomaliaCraniofacial: d.anomaliaCraniofacial,
        descricaoAnomalia: nulo(d.descricaoAnomalia),
        marcas: d.marcas,
        justificativaTrocaAparelho: nulo(d.justificativaTrocaAparelho),
        especificacaoDentes: nulo(d.especificacaoDentes),
        quantidadeImplantes: numero(d.quantidadeImplantes),
        tratamentoProposto: nulo(d.tratamentoProposto),
      };
    }
  }
}

async function executar(fn: () => Promise<unknown>, ok: string) {
  if (!dados.value) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    mensagem.value = ok;
    await carregar(false);
    emit('alterada');
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  } finally {
    ocupado.value = false;
  }
}
const gravar = (l: LaudoEspecifico) =>
  executar(
    () => gravarLaudoEspecifico(props.laudo, l, { versao: dados.value!.versao, dados: corpoDo(l) }),
    t('gravado'),
  );
const retirar = (l: LaudoEspecifico) =>
  executar(() => retirarLaudoEspecifico(props.laudo, l, dados.value!.versao), t('retirado'));
const registrar = () =>
  executar(
    () =>
      registrarSessaoApac(props.laudo, {
        versao: dados.value!.versao,
        data: sessao.data!,
        procedimento: '',
        quantidade: numero(sessao.quantidade) ?? 1,
        comparecimento: sessao.comparecimento,
        modalidade: renal.value ? sessao.modalidade : null,
        kits: numero(sessao.kits),
      }),
    t('ses.registrada'),
  );
const cancelar = (id: number, versao: number) =>
  executar(() => cancelarSessaoApac(id, versao), t('ses.cancelada'));
</script>

<template>
  <section aria-labelledby="apac-complementos-titulo" data-testid="apac-complementos">
    <h2 id="apac-complementos-titulo">{{ t('titulo') }}</h2>
    <p v-if="!dados && !erro">{{ t('carregando') }}</p>
    <SanteAlerta v-if="erro" :texto="erro" variante="alerta" data-testid="apac-complementos-erro" />
    <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" data-testid="apac-complementos-mensagem" />
    <template v-if="dados">
      <SanteAlerta
        v-if="dados.pendente && dados.exigido"
        :texto="t('pendente', { procedimento: dados.procedimento, laudo: t(`abas.${dados.exigido}`) })"
        variante="aviso"
        data-testid="apac-complementos-pendente"
      />
      <p v-if="dados.exigido === 'nefrologia'" class="pequeno">{{ t('exigeNefrologia') }}</p>
      <p v-if="!podeRegistrar" class="pequeno">{{ t('soConsulta') }}</p>
      <div class="abas" role="tablist">
        <button
          v-for="x in [...LAUDOS, 'sessoes' as const]"
          :key="x"
          type="button"
          role="tab"
          :aria-selected="aba === x"
          :data-testid="`apac-aba-${x}`"
          @click="aba = x"
        >
          {{ t(`abas.${x}`) }}
          <small v-if="x !== 'sessoes' && dados.laudos[x]">· {{ t('preenchido') }}</small>
          <small v-else-if="x === dados.exigido">· {{ t('exigido') }}</small>
        </button>
      </div>

      <form
        v-if="aba !== 'sessoes'"
        class="grade"
        :data-testid="`apac-form-${aba}`"
        @submit.prevent="gravar(aba as LaudoEspecifico)"
      >
        <fieldset :disabled="!editavel || ocupado">
          <template v-if="aba === 'oncologia'">
            <SanteSelecao
              v-model="f.oncologia.tipoTratamento"
              :rotulo="t('onco.tipoTratamento')"
              :opcoes="opcoesTratamento"
              data-testid="onco-tratamento"
            />
            <SanteCampoTexto v-model="f.oncologia.estadiamentoTnm" :rotulo="t('onco.tnm')" :max-bytes="20" />
            <SanteCampoTexto
              v-model="f.oncologia.grauHistopatologico"
              :rotulo="t('onco.grau')"
              :max-bytes="10"
            />
            <SanteData v-model="f.oncologia.dataDiagnostico" :rotulo="t('onco.dataDiagnostico')" editavel />
            <SanteData
              v-model="f.oncologia.dataIdentificacaoPatologica"
              :rotulo="t('onco.dataPatologica')"
              editavel
            />
            <SanteData
              v-model="f.oncologia.dataInicioTratamento"
              :rotulo="t('onco.inicioTratamento')"
              editavel
            />
            <SanteSelecao
              v-model="f.oncologia.finalidade"
              :rotulo="t('onco.finalidade')"
              :opcoes="opcoesDe('finalidade_tratamento')"
              data-testid="onco-finalidade"
            />
            <SanteSelecao
              v-if="f.oncologia.tipoTratamento === 'quimioterapia'"
              v-model="f.oncologia.esquema"
              :rotulo="t('onco.esquema')"
              :opcoes="opcoesDe('medicamento_antineoplasico')"
              data-testid="onco-esquema"
            />
            <SanteCampoTexto
              v-else
              v-model="f.oncologia.camposInsercao"
              :rotulo="t('onco.campos')"
              :max-bytes="3"
              data-testid="onco-campos"
            />
            <label><input v-model="f.oncologia.metastase" type="checkbox" /> {{ t('onco.metastase') }}</label>
            <SanteSelecao
              v-if="f.oncologia.metastase"
              v-model="f.oncologia.metastaseLocal"
              :rotulo="t('onco.localMetastase')"
              :opcoes="opcoesDe('local_metastase')"
            />
            <label>
              <input v-model="f.oncologia.continuidadeTratamento" type="checkbox" />
              {{ t('onco.continuidade') }}
            </label>
            <SanteCampoTexto
              v-model="f.oncologia.observacao"
              :rotulo="t('onco.observacao')"
              :max-bytes="2000"
            />
          </template>

          <template v-else-if="aba === 'auditiva'">
            <SanteCampoTexto
              v-model="f.auditiva.cidCausaBasica"
              :rotulo="t('aud.cidBasica')"
              :max-bytes="6"
            />
            <SanteCampoTexto
              v-model="f.auditiva.cidCausaAssociada"
              :rotulo="t('aud.cidAssociada')"
              :max-bytes="6"
            />
            <SanteSelecao
              v-model="f.auditiva.justificativa"
              :rotulo="t('aud.justificativa')"
              :opcoes="opcoesDe('justificativa_auditiva')"
            />
            <label>
              <input v-model="f.auditiva.dificuldadeAuditiva" type="checkbox" data-testid="aud-dificuldade" />
              {{ t('aud.dificuldade') }}
            </label>
            <label>
              <input v-model="f.auditiva.ouvidoDireito" type="checkbox" data-testid="aud-direito" />
              {{ t('aud.direito') }}
            </label>
            <label
              ><input v-model="f.auditiva.ouvidoEsquerdo" type="checkbox" /> {{ t('aud.esquerdo') }}</label
            >
            <SanteSelecao
              v-model="f.auditiva.evolucao"
              :rotulo="t('aud.evolucao')"
              :opcoes="opcoesEvolucao"
            />
            <fieldset>
              <legend>{{ t('aud.causas') }}</legend>
              <label v-for="c in CAUSAS" :key="c">
                <input
                  v-model="f.auditiva.causas"
                  type="checkbox"
                  :value="c"
                  :data-testid="`aud-causa-${c}`"
                />
                {{ legivel(c) }}
              </label>
            </fieldset>
            <SanteCampoTexto v-model="f.auditiva.outrasCausas" :rotulo="t('aud.outras')" :max-bytes="200" />
            <SanteCampoTexto
              v-model="f.auditiva.examesRealizados"
              :rotulo="t('aud.exames')"
              :max-bytes="4000"
            />
            <SanteCampoTexto
              v-model="f.auditiva.aparelhoIndicado"
              :rotulo="t('aud.aparelho')"
              :max-bytes="150"
            />
          </template>

          <template v-else-if="aba === 'medicamento'">
            <SanteCampoTexto
              v-model="f.medicamento.medicamento"
              :rotulo="t('med.medicamento')"
              :max-bytes="14"
              data-testid="med-codigo"
            />
            <SanteCampoTexto
              v-model="f.medicamento.cidPrincipal"
              :rotulo="t('med.cidPrincipal')"
              :max-bytes="6"
            />
            <SanteCampoTexto v-model="f.medicamento.pesoKg" :rotulo="t('med.peso')" :max-bytes="7" />
            <SanteCampoTexto v-model="f.medicamento.alturaCm" :rotulo="t('med.altura')" :max-bytes="3" />
            <SanteCampoTexto v-model="f.medicamento.dosePrescrita" :rotulo="t('med.dose')" :max-bytes="100" />
            <SanteCampoTexto
              v-model="f.medicamento.q1"
              :rotulo="t('med.mes1')"
              :max-bytes="8"
              data-testid="med-q1"
            />
            <SanteCampoTexto v-model="f.medicamento.q2" :rotulo="t('med.mes2')" :max-bytes="8" />
            <SanteCampoTexto v-model="f.medicamento.q3" :rotulo="t('med.mes3')" :max-bytes="8" />
            <SanteData v-model="f.medicamento.periodoInicio" :rotulo="t('med.inicio')" editavel />
            <SanteData v-model="f.medicamento.periodoFim" :rotulo="t('med.fim')" editavel />
          </template>

          <template v-else-if="aba === 'odontologia'">
            <label>
              <input v-model="f.odontologia.anomaliaCraniofacial" type="checkbox" /> {{ t('odo.anomalia') }}
            </label>
            <SanteCampoTexto
              v-if="f.odontologia.anomaliaCraniofacial"
              v-model="f.odontologia.descricaoAnomalia"
              :rotulo="t('odo.descricaoAnomalia')"
              :max-bytes="500"
            />
            <fieldset>
              <legend>{{ t('odo.marcas') }}</legend>
              <label v-for="m in MARCAS" :key="m">
                <input
                  v-model="f.odontologia.marcas"
                  type="checkbox"
                  :value="m"
                  :data-testid="`odo-marca-${m}`"
                />
                {{ legivel(m) }}
              </label>
            </fieldset>
            <SanteCampoTexto
              v-if="f.odontologia.marcas.includes('troca_aparelho')"
              v-model="f.odontologia.justificativaTrocaAparelho"
              :rotulo="t('odo.justificativaTroca')"
              :max-bytes="500"
            />
            <SanteCampoTexto
              v-if="
                f.odontologia.marcas.includes('dente_incluso') ||
                f.odontologia.marcas.includes('dente_impactado')
              "
              v-model="f.odontologia.especificacaoDentes"
              :rotulo="t('odo.dentes')"
              :max-bytes="500"
            />
            <SanteCampoTexto
              v-if="f.odontologia.marcas.includes('implante_metalico')"
              v-model="f.odontologia.quantidadeImplantes"
              :rotulo="t('odo.implantes')"
              :max-bytes="1"
              data-testid="odo-implantes"
            />
            <SanteCampoTexto
              v-model="f.odontologia.tratamentoProposto"
              :rotulo="t('odo.tratamento')"
              :max-bytes="4000"
              data-testid="odo-tratamento"
            />
          </template>
        </fieldset>
        <ul v-if="avisos.length && editavel" class="pequeno" data-testid="apac-complementos-avisos">
          <li v-for="a in avisos" :key="a">{{ a }}</li>
        </ul>
        <div v-if="editavel" class="linha">
          <SanteBotao
            :rotulo="t('gravar')"
            tipo="submit"
            :desabilitado="ocupado || avisos.length > 0"
            data-testid="botao-gravar-laudo-especifico"
          />
          <SanteBotao
            v-if="dados.laudos[aba as LaudoEspecifico]"
            :rotulo="t('retirar')"
            variante="secundario"
            :desabilitado="ocupado"
            data-testid="botao-retirar-laudo-especifico"
            @acionar="retirar(aba as LaudoEspecifico)"
          />
        </div>
      </form>

      <div v-else data-testid="apac-sessoes">
        <p v-if="dados.validadeInicio && dados.validadeFim" class="pequeno">
          {{ t('ses.validade', { inicio: dados.validadeInicio, fim: dados.validadeFim }) }}
        </p>
        <p v-if="!dados.sessoes.length">{{ t('ses.vazia') }}</p>
        <table v-else class="tabela" data-testid="apac-sessoes-tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('ses.data') }}</th>
              <th scope="col">{{ t('ses.competencia') }}</th>
              <th scope="col">{{ t('ses.comparecimento') }}</th>
              <th scope="col">{{ t('ses.modalidade') }}</th>
              <th scope="col">{{ t('ses.quantidade') }}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in dados.sessoes" :key="s.id" data-testid="apac-sessao-linha">
              <td>{{ s.data }}</td>
              <td>{{ s.competencia }} ({{ s.tipoApac }})</td>
              <td>{{ t(`ses.${s.comparecimento}`) }}</td>
              <td>{{ s.modalidade ?? '-' }}{{ s.kits ? ` · ${s.kits}` : '' }}</td>
              <td>{{ s.quantidade }}</td>
              <td>
                <SanteBotao
                  v-if="podeRegistrar && s.aberta"
                  :rotulo="t('ses.cancelar')"
                  variante="secundario"
                  :desabilitado="ocupado"
                  data-testid="botao-cancelar-sessao"
                  @acionar="cancelar(s.id, s.versao)"
                />
                <small v-else-if="!s.aberta">{{ t('ses.apresentada') }}</small>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="dados.situacao !== 'autorizada'" class="pequeno">{{ t('ses.soAutorizada') }}</p>
        <form
          v-else-if="podeRegistrar"
          class="linha"
          data-testid="apac-sessao-form"
          @submit.prevent="registrar"
        >
          <SanteData v-model="sessao.data" :rotulo="t('ses.data')" editavel data-testid="sessao-data" />
          <SanteSelecao
            v-model="sessao.comparecimento"
            :rotulo="t('ses.comparecimento')"
            :opcoes="opcoesComparecimento"
            data-testid="sessao-comparecimento"
          />
          <SanteSelecao
            v-if="renal"
            v-model="sessao.modalidade"
            :rotulo="t('ses.modalidade')"
            :opcoes="opcoesModalidade"
            data-testid="sessao-modalidade"
          />
          <SanteCampoTexto v-model="sessao.quantidade" :rotulo="t('ses.quantidade')" :max-bytes="4" />
          <SanteCampoTexto
            v-if="renal && sessao.modalidade && sessao.modalidade !== 'hemodialise'"
            v-model="sessao.kits"
            :rotulo="t('ses.kits')"
            :max-bytes="4"
          />
          <ul v-if="avisos.length" class="pequeno">
            <li v-for="a in avisos" :key="a">{{ a }}</li>
          </ul>
          <SanteBotao
            :rotulo="t('ses.registrar')"
            tipo="submit"
            :desabilitado="ocupado || avisos.length > 0"
            data-testid="botao-registrar-sessao"
          />
        </form>
      </div>
    </template>
  </section>
</template>

<style scoped>
.abas {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-block: 0.5rem;
}
.abas [aria-selected='true'] {
  font-weight: 600;
  text-decoration: underline;
}
.grade fieldset {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: 0.5rem;
  border: 0;
  padding: 0;
}
</style>
