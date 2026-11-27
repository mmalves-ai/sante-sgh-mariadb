<script setup lang="ts">
// Formulário do credenciamento e da alteração do prestador da rede da operadora (M56, etapa 4, F3): pessoa e documento
// (só no credenciamento: não mudam depois), nome, CNES, UF e município do IBGE, os domínios do banco do estabelecimento
// (combos com busca, ADR 0027), a contratação indireta com a intermediária, a urgência, o contrato com a forma e o mês
// do reajuste, o próprio hospital da Rede e o convênio que representa a operadora no faturamento do hospital. As regras
// moram no servidor (@sgh/dominio-operadora); a recusa volta com o texto e a tela mostra.
import {
  type ApoioRede,
  CONTRATACAO_INDIRETA,
  MENSAGENS_REDE,
  type PrestadorDetalhe,
  type ResultadoRede,
  UFS,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { alterarPrestador, credenciarPrestador } from '../api-rede.js';

const props = defineProps<{ apoio: ApoioRede; inicial: PrestadorDetalhe | null }>();
const emit = defineEmits<{ gravado: [r: ResultadoRede]; cancelar: [] }>();
const { t } = useI18n();
const novo = computed(() => props.inicial === null);
const i = props.inicial;

const f = reactive({
  pessoa: (i?.pessoa ?? 'J') as 'F' | 'J',
  documento: '',
  nome: i?.nome ?? '',
  nomeFantasia: i?.nomeFantasia ?? '',
  cnes: i?.cnes ?? '',
  uf: (i?.uf ?? 'SC') as string,
  municipio: i ? String(i.municipioIbge) : '',
  tipo: (i?.tipo ?? null) as number | null,
  natureza: (i?.natureza ?? null) as number | null,
  classificacao: (i?.classificacao ?? null) as number | null,
  contratacao: (i?.contratacao ?? 1) as number | null,
  intermediaria: i?.operadoraIntermediaria ?? '',
  disponibilidade: (i?.disponibilidade ?? 1) as number | null,
  isencaoOnus: (i?.isencaoOnus ?? 1) as number | null,
  urgencia: i?.urgencia ?? false,
  regime: (i?.regime ?? null) as number | null,
  remuneracao: (i?.remuneracao ?? 1) as number | null,
  contratoNumero: i?.contrato.numero ?? '',
  inicio: (i?.contrato.inicio ?? props.apoio.hoje) as string | null,
  fim: (i?.contrato.fim ?? null) as string | null,
  formaReajuste: (i?.contrato.formaReajuste ?? 1) as number | null,
  mesReajuste: (i?.contrato.mesReajuste ?? Number(props.apoio.hoje.slice(5, 7))) as number | null,
  ehOHospital: i?.ehOHospital ?? false,
  estabelecimento: (i?.estabelecimento ?? null) as string | null,
  convenio: (i?.convenio ?? null) as number | null,
});

const opcoes = (lista: readonly { codigo: number; rotulo: string }[]) => [
  { valor: null, rotulo: t('operadoraRede.form.escolha') },
  ...lista.map((x) => ({ valor: x.codigo, rotulo: x.rotulo })),
];
const d = computed(() => props.apoio.dominios);
const opcoesPessoa = computed(() => [
  { valor: 'J' as const, rotulo: t('operadoraRede.ficha.pessoas.J') },
  { valor: 'F' as const, rotulo: t('operadoraRede.ficha.pessoas.F') },
]);
const opcoesUf = UFS.map((u) => ({ valor: u as string, rotulo: u }));
const opcoesMes = computed(() =>
  Array.from({ length: 12 }, (_, k) => ({ valor: k + 1, rotulo: t(`operadoraRede.meses.${k + 1}`) })),
);
const opcoesEstabelecimento = computed(() => [
  { valor: null, rotulo: t('operadoraRede.form.escolha') },
  ...props.apoio.estabelecimentos.map((e) => ({ valor: e.codigo, rotulo: `${e.nome} (${e.codigo})` })),
]);
const opcoesConvenio = computed(() => [
  { valor: null, rotulo: t('operadoraRede.ficha.semConvenio') },
  ...props.apoio.convenios.map((c) => ({
    valor: c.codigo,
    rotulo: `${c.codigo} · ${c.nome}${c.registroAns ? ` · ANS ${c.registroAns}` : ''}`,
  })),
]);
const indireta = computed(() => f.contratacao === CONTRATACAO_INDIRETA);
// C2-118: na contratação indireta, o registro na ANS da intermediária aparece na hora (mesma regra do servidor).
const problemaIntermediaria = computed(() => {
  if (!indireta.value) return null;
  const v = f.intermediaria.trim();
  if (!v) return MENSAGENS_REDE['intermediaria-obrigatoria'] ?? null;
  return /^\d{6}$/.test(v) ? null : (MENSAGENS_REDE['intermediaria-invalida'] ?? null);
});

const completo = computed(
  () =>
    (!novo.value || f.documento.trim().length >= 11) &&
    f.nome.trim().length >= 3 &&
    /^\d{7}$/.test(f.municipio.trim()) &&
    [
      f.tipo,
      f.natureza,
      f.classificacao,
      f.contratacao,
      f.disponibilidade,
      f.isencaoOnus,
      f.regime,
      f.remuneracao,
    ].every((v) => v !== null) &&
    f.contratoNumero.trim().length > 0 &&
    f.inicio !== null &&
    f.formaReajuste !== null &&
    f.mesReajuste !== null &&
    problemaIntermediaria.value === null &&
    (!f.ehOHospital || f.estabelecimento !== null),
);

const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const gravando = ref(false);

function corpo() {
  const campos = {
    nome: f.nome,
    nomeFantasia: f.nomeFantasia.trim() || null,
    cnes: f.cnes.trim() || null,
    uf: f.uf,
    municipioIbge: Number(f.municipio.trim()),
    tipo: f.tipo,
    natureza: f.natureza,
    classificacao: f.classificacao,
    contratacao: f.contratacao,
    operadoraIntermediaria: indireta.value ? f.intermediaria.trim() || null : null,
    disponibilidade: f.disponibilidade,
    isencaoOnus: f.isencaoOnus,
    urgencia: f.urgencia,
    regime: f.regime,
    remuneracao: f.remuneracao,
    contrato: {
      numero: f.contratoNumero,
      inicio: f.inicio,
      fim: f.fim,
      formaReajuste: f.formaReajuste,
      mesReajuste: f.mesReajuste,
    },
    ehOHospital: f.ehOHospital,
    estabelecimento: f.ehOHospital ? f.estabelecimento : null,
    convenio: f.convenio,
  };
  return novo.value
    ? { pessoa: f.pessoa, documento: f.documento, ...campos }
    : { versao: props.inicial?.versao ?? 0, ...campos };
}

async function gravar(): Promise<void> {
  if (!completo.value || gravando.value) return;
  recusa.value = null;
  erro.value = null;
  gravando.value = true;
  try {
    const r = props.inicial
      ? await alterarPrestador(props.inicial.id, corpo())
      : await credenciarPrestador(corpo());
    emit('gravado', r);
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 404, 409].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="formulario-rede" data-testid="form-prestador" @submit.prevent="gravar">
    <div class="campos">
      <template v-if="novo">
        <SanteSelecao
          v-model="f.pessoa"
          :rotulo="t('operadoraRede.ficha.pessoa')"
          :opcoes="opcoesPessoa"
          obrigatorio
          data-testid="rede-pessoa"
        />
        <SanteCampoTexto
          id="rede-documento"
          v-model="f.documento"
          :rotulo="t('operadoraRede.form.documento')"
          :max-bytes="18"
          obrigatorio
        />
      </template>
      <SanteCampoTexto
        id="rede-nome"
        v-model="f.nome"
        :rotulo="t('operadoraRede.form.nome')"
        :max-bytes="120"
        obrigatorio
      />
      <SanteCampoTexto
        id="rede-fantasia"
        v-model="f.nomeFantasia"
        :rotulo="t('operadoraRede.ficha.nomeFantasia')"
        :max-bytes="120"
      />
      <SanteCampoTexto
        id="rede-cnes"
        v-model="f.cnes"
        :rotulo="t('operadoraRede.form.cnes')"
        :max-bytes="7"
      />
      <SanteSelecao
        v-model="f.uf"
        :rotulo="t('operadoraRede.form.uf')"
        :opcoes="opcoesUf"
        obrigatorio
        data-testid="rede-uf"
      />
      <SanteCampoTexto
        id="rede-municipio"
        v-model="f.municipio"
        :rotulo="t('operadoraRede.form.municipio')"
        :max-bytes="7"
        obrigatorio
      />
      <SanteSelecao
        v-model="f.tipo"
        :rotulo="t('operadoraRede.colunas.tipo')"
        :opcoes="opcoes(d.tipo)"
        obrigatorio
        data-testid="rede-tipo"
      />
      <SanteSelecao
        v-model="f.natureza"
        :rotulo="t('operadoraRede.ficha.natureza')"
        :opcoes="opcoes(d.natureza)"
        obrigatorio
        data-testid="rede-natureza"
      />
      <SanteSelecao
        v-model="f.classificacao"
        :rotulo="t('operadoraRede.ficha.classificacao')"
        :opcoes="opcoes(d.classificacao)"
        obrigatorio
        data-testid="rede-classificacao"
      />
      <SanteSelecao
        v-model="f.contratacao"
        :rotulo="t('operadoraRede.ficha.contratacao')"
        :opcoes="opcoes(d.contratacao)"
        obrigatorio
        data-testid="rede-contratacao"
      />
      <SanteCampoTexto
        v-if="indireta"
        id="rede-intermediaria"
        v-model="f.intermediaria"
        :rotulo="t('operadoraRede.ficha.intermediaria')"
        :max-bytes="6"
        obrigatorio
      />
      <p
        v-if="problemaIntermediaria"
        class="secundario"
        role="alert"
        data-testid="rede-intermediaria-problema"
      >
        {{ problemaIntermediaria }}
      </p>
      <SanteSelecao
        v-model="f.disponibilidade"
        :rotulo="t('operadoraRede.ficha.disponibilidade')"
        :opcoes="opcoes(d.disponibilidade)"
        obrigatorio
        data-testid="rede-disponibilidade"
      />
      <SanteSelecao
        v-model="f.isencaoOnus"
        :rotulo="t('operadoraRede.ficha.isencaoOnus')"
        :opcoes="opcoes(d.isencaoOnus)"
        obrigatorio
        data-testid="rede-isencao"
      />
      <SanteSelecao
        v-model="f.regime"
        :rotulo="t('operadoraRede.ficha.regime')"
        :opcoes="opcoes(d.regime)"
        obrigatorio
        data-testid="rede-regime"
      />
      <SanteSelecao
        v-model="f.remuneracao"
        :rotulo="t('operadoraRede.ficha.remuneracao')"
        :opcoes="opcoes(d.remuneracao)"
        obrigatorio
        data-testid="rede-remuneracao"
      />
      <label class="marcar"
        ><input v-model="f.urgencia" type="checkbox" data-testid="rede-urgencia" />
        {{ t('operadoraRede.ficha.urgencia') }}</label
      >
    </div>

    <fieldset class="campos">
      <legend>{{ t('operadoraRede.ficha.contrato') }}</legend>
      <SanteCampoTexto
        id="rede-contrato-numero"
        v-model="f.contratoNumero"
        :rotulo="t('operadoraRede.ficha.contratoNumero')"
        :max-bytes="30"
        obrigatorio
      />
      <SanteData
        v-model="f.inicio"
        :rotulo="t('operadoraRede.ficha.inicio')"
        editavel
        data-testid="rede-inicio"
      />
      <SanteData v-model="f.fim" :rotulo="t('operadoraRede.ficha.fim')" editavel data-testid="rede-fim" />
      <SanteSelecao
        v-model="f.formaReajuste"
        :rotulo="t('operadoraRede.ficha.formaReajuste')"
        :opcoes="opcoes(d.formaReajuste)"
        obrigatorio
        data-testid="rede-reajuste"
      />
      <SanteSelecao
        v-model="f.mesReajuste"
        :rotulo="t('operadoraRede.ficha.mesReajuste')"
        :opcoes="opcoesMes"
        obrigatorio
        data-testid="rede-mes-reajuste"
      />
    </fieldset>

    <fieldset class="campos">
      <legend>{{ t('operadoraRede.ficha.ehOHospital') }}</legend>
      <label class="marcar"
        ><input v-model="f.ehOHospital" type="checkbox" data-testid="rede-eh-hospital" />
        {{ t('operadoraRede.ficha.ehOHospital') }}</label
      >
      <SanteSelecao
        v-if="f.ehOHospital"
        v-model="f.estabelecimento"
        :rotulo="t('operadoraRede.ficha.estabelecimento')"
        :opcoes="opcoesEstabelecimento"
        obrigatorio
        data-testid="rede-estabelecimento"
      />
      <SanteSelecao
        v-model="f.convenio"
        :rotulo="t('operadoraRede.ficha.convenio')"
        :opcoes="opcoesConvenio"
        :busca="true"
        data-testid="rede-convenio"
      />
    </fieldset>

    <SanteAlerta v-if="recusa" :texto="recusa" variante="alerta" data-testid="rede-recusa" />
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="!completo" class="secundario">{{ t('operadoraRede.form.obrigatorios') }}</p>
    <div class="acoes">
      <SanteBotao
        variante="secundario"
        :rotulo="t('operadoraRede.acoes.cancelar')"
        @acionar="emit('cancelar')"
      />
      <SanteBotao
        tipo="submit"
        :rotulo="t('operadoraRede.acoes.gravar')"
        :desabilitado="!completo || gravando"
        data-testid="rede-gravar"
      />
    </div>
  </form>
</template>

<style scoped src="../estilo-operadora.css"></style>
<style scoped>
.formulario-rede {
  display: grid;
  gap: 0.75rem;
}
fieldset {
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.5rem;
  padding: 0.75rem;
}
.marcar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-height: 24px;
}
</style>
