<script setup lang="ts">
// W0-06 (programa CRUD completo): a retificação do acidente e da CAT com motivo. O registro vai inteiro (como o S-2210
// retificador, que substitui o evento todo); o valor anterior fica no histórico. Se já havia S-2210 aceito, a fila do
// eSocial ganha o retificador (indRetif 2 com o recibo); o ainda não enviado se descarta e sai de novo. Os dados da CAT
// que a tela não mostra seguem como estavam.
import {
  type AcidenteResposta,
  type ApoioSesmt,
  esquemaRetificarAcidente,
  type ResultadoSesmt,
  TIPOS_ACIDENTE,
  type TipoAcidente,
} from '@sgh/contratos';
import { SanteCampoTexto, SanteData, SanteHora, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DialogoMotivo from '../componentes/DialogoMotivo.vue';
import { opcoesDe } from '../comum.js';
import { retificarAcidente } from './api-sesmt.js';

const props = defineProps<{ acidente: AcidenteResposta; apoio: ApoioSesmt }>();
const visivel = defineModel<boolean>('visivel', { required: true });
const emit = defineEmits<{ feito: [r: ResultadoSesmt] }>();
const { t } = useI18n();

const dia = ref<string | null>(null);
const hora = ref<string | null>(null);
const tipo = ref<TipoAcidente | null>(null);
const local = ref('');
const descricao = ref('');
const parteCorpo = ref<number | null>(null);
const natureza = ref<number | null>(null);
const agente = ref<number | null>(null);
const situacao = ref<number | null>(null);
const afastamento = ref(false);
const obito = ref(false);
const horasAntes = ref('');
const lateralidade = ref<number | null>(null);
const cid = ref('');
const atestadoData = ref<string | null>(null);
const duracaoDias = ref('');
const emitenteNome = ref('');
const emitenteNumero = ref('');
const emitenteUf = ref('');

watch(
  visivel,
  (v) => {
    if (!v) return;
    const a = props.acidente;
    dia.value = a.ocorridoEm.slice(0, 10);
    hora.value = a.ocorridoEm.slice(11, 16).replace(':', '');
    tipo.value = a.tipo;
    local.value = a.local;
    descricao.value = a.descricao;
    parteCorpo.value = a.parteCorpo;
    natureza.value = a.natureza;
    agente.value = a.agente;
    situacao.value = a.situacao;
    afastamento.value = a.afastamento;
    obito.value = a.obito;
    horasAntes.value = a.cat.horasAntes ?? '';
    lateralidade.value = a.cat.lateralidade;
    cid.value = a.cat.cid ?? '';
    atestadoData.value = a.cat.atestadoData;
    duracaoDias.value = a.cat.duracaoDias === null ? '' : String(a.cat.duracaoDias);
    emitenteNome.value = a.cat.emitenteNome ?? '';
    emitenteNumero.value = a.cat.emitenteNumero ?? '';
    emitenteUf.value = a.cat.emitenteUf ?? '';
  },
  { immediate: true },
);

const opcoesTipo = opcoesDe(TIPOS_ACIDENTE);
const opcoesDominio = (xs: readonly { codigo: number; rotulo: string }[]) => [
  { valor: null, rotulo: '—' },
  ...xs.map((x) => ({ valor: x.codigo, rotulo: x.rotulo })),
];
const opcoesLateralidade = computed(() => [
  { valor: null, rotulo: '—' },
  ...[0, 1, 2, 3].map((n) => ({ valor: n, rotulo: t(`sesmt.cat.lateralidades.l${n}`) })),
]);
const vazio = (x: string) => (x.trim() === '' ? null : x.trim());
const instante = () =>
  dia.value && hora.value && /^\d{4}$/.test(hora.value)
    ? `${dia.value}T${hora.value.slice(0, 2)}:${hora.value.slice(2)}`
    : '';
/** A entrada sem o motivo (o diálogo pede o motivo): o motivo provisório só valida o resto. */
const entrada = (motivo: string) =>
  esquemaRetificarAcidente.safeParse({
    acidente: props.acidente.id,
    versao: props.acidente.versao,
    motivo,
    ocorridoEm: instante(),
    tipo: tipo.value ?? '',
    local: local.value.trim(),
    descricao: descricao.value.trim(),
    parteCorpo: parteCorpo.value,
    natureza: natureza.value,
    agente: agente.value,
    situacao: situacao.value,
    afastamento: afastamento.value,
    obito: obito.value,
    cat: {
      ...props.acidente.cat,
      horasAntes: vazio(horasAntes.value),
      lateralidade: lateralidade.value,
      cid: vazio(cid.value.toUpperCase().replace('.', '')),
      atestadoData: atestadoData.value,
      duracaoDias: vazio(duracaoDias.value) === null ? null : Number(duracaoDias.value),
      emitenteNome: vazio(emitenteNome.value),
      emitenteNumero: vazio(emitenteNumero.value),
      emitenteUf: vazio(emitenteUf.value.toUpperCase()),
    },
  });
const valida = computed(() => entrada('motivo provisório da conferência'));
const pronto = computed(() => valida.value.success);
const problema = computed(() =>
  valida.value.success ? null : (valida.value.error.issues[0]?.message ?? null),
);

async function acao(motivo: string): Promise<ResultadoSesmt> {
  const r = entrada(motivo);
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? '');
  // O corpo leva o id da rota também (o servidor fica com o da rota).
  return retificarAcidente(props.acidente.id, r.data);
}
</script>

<template>
  <DialogoMotivo
    v-model:visivel="visivel"
    :titulo="t('sesmt.cat.retificarTitulo', { id: acidente.id })"
    :texto="t('sesmt.cat.retificarTexto')"
    :confirmar="t('sesmt.cat.retificarConfirmar')"
    variante="primario"
    largura="56rem"
    :pronto="pronto"
    :acao="acao"
    testid="dlg-retificar-acidente"
    @feito="(r) => emit('feito', r as ResultadoSesmt)"
  >
    <div class="campos">
      <SanteData v-model="dia" :rotulo="t('sesmt.data')" editavel data-testid="ret-data" />
      <SanteHora v-model="hora" :rotulo="t('sesmt.hora')" editavel data-testid="ret-hora" />
      <SanteSelecao
        v-model="tipo"
        :rotulo="t('sesmt.cat.tipo')"
        :opcoes="opcoesTipo"
        data-testid="ret-tipo"
      />
      <SanteCampoTexto
        v-model="local"
        :rotulo="t('sesmt.cat.local')"
        :max-bytes="80"
        data-testid="ret-local"
      />
    </div>
    <SanteCampoTexto
      v-model="descricao"
      :rotulo="t('sesmt.cat.descricao')"
      :max-bytes="1000"
      multilinha
      data-testid="ret-descricao"
    />
    <div class="campos">
      <SanteSelecao
        v-model="parteCorpo"
        :rotulo="t('sesmt.cat.parteCorpo')"
        :opcoes="opcoesDominio(apoio.dominios.partesCorpo)"
        busca
        data-testid="ret-parte-corpo"
      />
      <SanteSelecao
        v-model="natureza"
        :rotulo="t('sesmt.cat.natureza')"
        :opcoes="opcoesDominio(apoio.dominios.naturezas)"
        busca
        data-testid="ret-natureza"
      />
      <SanteSelecao
        v-model="agente"
        :rotulo="t('sesmt.cat.agente')"
        :opcoes="opcoesDominio(apoio.dominios.agentes)"
        busca
        data-testid="ret-agente"
      />
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('sesmt.cat.situacaoGeradora')"
        :opcoes="opcoesDominio(apoio.dominios.situacoes)"
        busca
        data-testid="ret-situacao"
      />
      <label class="marca"
        ><input v-model="afastamento" type="checkbox" data-testid="ret-afastamento" />{{
          t('sesmt.cat.afastamento')
        }}</label
      >
      <label class="marca"
        ><input v-model="obito" type="checkbox" data-testid="ret-obito" />{{ t('sesmt.cat.obito') }}</label
      >
    </div>
    <fieldset class="bloco">
      <legend>{{ t('sesmt.cat.dadosCat') }}</legend>
      <div class="campos">
        <SanteCampoTexto
          v-model="horasAntes"
          :rotulo="t('sesmt.cat.horasAntes')"
          :max-bytes="4"
          data-testid="ret-horas-antes"
        />
        <SanteSelecao
          v-model="lateralidade"
          :rotulo="t('sesmt.cat.lateralidade')"
          :opcoes="opcoesLateralidade"
          data-testid="ret-lateralidade"
        />
        <SanteData
          v-model="atestadoData"
          :rotulo="t('sesmt.cat.atestadoData')"
          editavel
          data-testid="ret-atestado-data"
        />
        <SanteCampoTexto
          v-model="duracaoDias"
          :rotulo="t('sesmt.cat.duracaoDias')"
          :max-bytes="4"
          data-testid="ret-duracao"
        />
        <SanteCampoTexto v-model="cid" :rotulo="t('sesmt.cat.cid')" :max-bytes="5" data-testid="ret-cid" />
        <SanteCampoTexto
          v-model="emitenteNome"
          :rotulo="t('sesmt.cat.emitenteNome')"
          :max-bytes="70"
          data-testid="ret-emitente-nome"
        />
        <SanteCampoTexto
          v-model="emitenteNumero"
          :rotulo="t('sesmt.cat.emitenteNumero')"
          :max-bytes="14"
          data-testid="ret-emitente-numero"
        />
        <SanteCampoTexto
          v-model="emitenteUf"
          :rotulo="t('sesmt.cat.emitenteUf')"
          :max-bytes="2"
          data-testid="ret-emitente-uf"
        />
      </div>
    </fieldset>
    <p v-if="problema" class="secundario" role="status" data-testid="ret-problema">{{ problema }}</p>
  </DialogoMotivo>
</template>

<style scoped src="../estilo-pessoas.css"></style>
