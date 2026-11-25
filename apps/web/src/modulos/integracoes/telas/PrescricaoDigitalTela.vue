<script setup lang="ts">
// Prescrição digital por plataforma externa (F8, 08-INTG L132): `/pep/prescricao-digital`. Visão por paciente: as
// receitas com a situação da assinatura e os envios; a receita pronta (emitida, assinada em ICP-Brasil) vai à
// plataforma com um clique; o motivo do bloqueio aparece na hora, sem ida ao servidor. O retorno validável (código e
// endereço de validação) aparece no envio; o cancelamento pede o motivo e a versão lida. Nada é apagado.
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  buscarPacientesPrescricao,
  cancelarEnvioPrescricao,
  enviarReceitaPlataforma,
  type EnvioPrescricao,
  lerPlataformasPrescricao,
  lerReceitasDoPaciente,
  type PacientePrescricao,
  type ReceitaPrescricao,
} from '../api-prescricao-digital.js';
import { mensagensPrescricaoDigital } from '../i18n-prescricao-digital.js';

const { t } = useI18n({ useScope: 'local', messages: mensagensPrescricaoDigital });
const fila = useQueryClient();
const podeEnviar = computed(() => pode('pep.prescricaoDigital.enviar'));
const VIVAS = ['pendente', 'enviada', 'aceita', 'dispensada'];

const termo = ref('');
const termoBusca = ref('');
let espera: ReturnType<typeof setTimeout> | undefined;
watch(termo, (v) => {
  clearTimeout(espera);
  espera = setTimeout(() => (termoBusca.value = v), 300);
});
const pacientes = useQuery({
  queryKey: ['prescricao-digital', 'pacientes', termoBusca],
  queryFn: () => buscarPacientesPrescricao(termoBusca.value),
});
const paciente = ref<PacientePrescricao | null>(null);

const plataformas = useQuery({
  queryKey: ['prescricao-digital', 'plataformas'],
  queryFn: lerPlataformasPrescricao,
});
const plataforma = ref<string | null>(null);
const opcoesPlataforma = computed(() =>
  (plataformas.data.value ?? [])
    .filter((p) => p.parceiroApiAtivo)
    .map((p) => ({ valor: p.codigo, rotulo: p.nome })),
);
watch(opcoesPlataforma, (o) => {
  if (!plataforma.value && o.length === 1) plataforma.value = o[0]!.valor;
});

const idPaciente = computed(() => paciente.value?.id ?? 0);
const receitas = useQuery({
  queryKey: ['prescricao-digital', 'paciente', idPaciente],
  queryFn: () => lerReceitasDoPaciente(idPaciente.value),
  enabled: computed(() => idPaciente.value > 0),
});

const hoje = new Date().toISOString().slice(0, 10);
/** O motivo do bloqueio do envio, conferido na tela (o servidor confere de novo pela regra do domínio). */
function bloqueio(r: ReceitaPrescricao): string | null {
  if (r.situacao !== 'emitida') return t('bloqueio.naoEmitida');
  if (r.assinatura !== 'assinado') return t('bloqueio.semAssinatura');
  if (r.nivelAssinatura !== 'icp-brasil') return t('bloqueio.naoIcp');
  if (r.validadeAte && r.validadeAte < hoje) return t('bloqueio.vencida');
  if (r.envios.some((e) => e.plataforma === plataforma.value && VIVAS.includes(e.situacao)))
    return t('bloqueio.jaEnviada');
  return null;
}

const aviso = ref('');
const erro = ref<unknown>(null);
const recarregar = () => fila.invalidateQueries({ queryKey: ['prescricao-digital', 'paciente'] });

const envio = useMutation({
  mutationFn: (r: ReceitaPrescricao) => enviarReceitaPlataforma(r.id, plataforma.value!),
  onSuccess: async () => {
    aviso.value = t('enviado');
    erro.value = null;
    await recarregar();
  },
  onError: (e) => (erro.value = e),
});

const cancelando = ref<EnvioPrescricao | null>(null);
const motivo = ref('');
const motivoValido = computed(() => motivo.value.trim().length >= 10);
const cancelamento = useMutation({
  mutationFn: (e: EnvioPrescricao) => cancelarEnvioPrescricao(e.id, motivo.value.trim(), e.versao),
  onSuccess: async () => {
    aviso.value = t('cancelado');
    erro.value = null;
    cancelando.value = null;
    motivo.value = '';
    await recarregar();
  },
  onError: (e) => (erro.value = e),
});

const data = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '');
const assinaturaTexto = (r: ReceitaPrescricao) =>
  t(`assinatura.${r.assinatura ?? 'nenhuma'}`) + (r.nivelAssinatura === 'icp-brasil' ? ' (ICP-Brasil)' : '');
</script>

<template>
  <section
    class="tela-agenda"
    aria-labelledby="prescricao-digital-titulo"
    data-testid="tela-prescricao-digital"
  >
    <h1 id="prescricao-digital-titulo">{{ t('titulo') }}</h1>
    <p>{{ t('explicacao') }}</p>
    <p v-if="!podeEnviar" role="note" data-testid="prescricao-so-consulta">{{ t('soConsulta') }}</p>
    <p v-if="aviso" role="status" data-testid="prescricao-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erro" :erro="erro" />

    <div class="prescricao-filtros">
      <label>
        {{ t('buscarPaciente') }}
        <input v-model="termo" type="search" autocomplete="off" data-testid="prescricao-busca-paciente" />
      </label>
      <SanteSelecao
        v-model="plataforma"
        :rotulo="t('plataforma')"
        :opcoes="opcoesPlataforma"
        obrigatorio
        data-testid="prescricao-plataforma"
      />
    </div>
    <p v-if="plataformas.isSuccess.value && opcoesPlataforma.length === 0" role="note">
      {{ t('semPlataforma') }}
    </p>

    <ul
      v-if="!paciente && termoBusca.length >= 2"
      class="prescricao-pacientes"
      data-testid="prescricao-pacientes"
    >
      <li v-for="p in pacientes.data.value ?? []" :key="p.id">
        <button type="button" :data-testid="`prescricao-paciente-${p.id}`" @click="paciente = p">
          {{ p.nome }} ({{ p.prontuario }})
        </button>
      </li>
      <li v-if="pacientes.isSuccess.value && (pacientes.data.value ?? []).length === 0">
        {{ t('semPaciente') }}
      </li>
    </ul>

    <template v-if="paciente">
      <p data-testid="prescricao-paciente-escolhido">
        {{ t('pacienteEscolhido', { nome: paciente.nome, prontuario: paciente.prontuario }) }}
        <button type="button" data-testid="prescricao-trocar-paciente" @click="paciente = null">
          {{ t('fechar') }}
        </button>
      </p>
      <p v-if="receitas.isSuccess.value && (receitas.data.value ?? []).length === 0">
        {{ t('semReceitas') }}
      </p>
      <article
        v-for="r in receitas.data.value ?? []"
        :key="r.id"
        class="prescricao-receita"
        :data-testid="`prescricao-receita-${r.id}`"
      >
        <h2>{{ t('receita', { numero: r.numero }) }}</h2>
        <p>
          {{ r.tipo }} · {{ t('emitida', { data: data(r.emitidaEm) }) }}
          <template v-if="r.validadeAte"> · {{ t('validade', { data: r.validadeAte }) }}</template>
          <template v-if="r.controleEspecial"> · {{ t('controle') }}</template>
        </p>
        <p v-if="r.prescritor">{{ t('prescritor', { nome: r.prescritor }) }} · {{ assinaturaTexto(r) }}</p>
        <p
          v-if="podeEnviar && plataforma && bloqueio(r)"
          role="note"
          :data-testid="`prescricao-bloqueio-${r.id}`"
        >
          {{ bloqueio(r) }}
        </p>
        <button
          v-if="podeEnviar"
          type="button"
          :disabled="!plataforma || !!bloqueio(r) || envio.isPending.value"
          :data-testid="`prescricao-enviar-${r.id}`"
          @click="envio.mutate(r)"
        >
          {{ t('enviar') }}
        </button>
        <h3>{{ t('envios') }}</h3>
        <p v-if="r.envios.length === 0">{{ t('semEnvio') }}</p>
        <ul>
          <li v-for="e in r.envios" :key="e.id" :data-testid="`prescricao-envio-${e.id}`">
            <strong>{{ e.plataformaNome }}</strong> · {{ t(`situacao.${e.situacao}`) }} ·
            {{ data(e.criadoEm) }}
            <span v-if="e.filaSituacao && e.situacao === 'pendente'">
              · {{ t('fila', { situacao: e.filaSituacao }) }}</span
            >
            <div v-if="e.identificadorExterno">{{ t('identificador', { id: e.identificadorExterno }) }}</div>
            <div v-if="e.codigoValidacao" :data-testid="`prescricao-codigo-${e.id}`">
              {{ t('codigo', { codigo: e.codigoValidacao }) }}
              <a v-if="e.urlValidacao" :href="e.urlValidacao" target="_blank" rel="noopener noreferrer">{{
                t('validar')
              }}</a>
            </div>
            <div v-if="e.motivoCancelamento">
              {{ t('motivoCancelado', { motivo: e.motivoCancelamento }) }}
            </div>
            <button
              v-if="podeEnviar && e.situacao !== 'cancelada' && e.situacao !== 'dispensada'"
              type="button"
              :data-testid="`prescricao-cancelar-${e.id}`"
              @click="((cancelando = e), (motivo = ''))"
            >
              {{ t('cancelar') }}
            </button>
            <form
              v-if="cancelando?.id === e.id"
              class="prescricao-cancelamento"
              @submit.prevent="motivoValido && cancelamento.mutate(e)"
            >
              <label>
                {{ t('motivo') }}
                <input v-model="motivo" maxlength="500" required data-testid="prescricao-motivo" />
              </label>
              <button
                type="submit"
                :disabled="!motivoValido || cancelamento.isPending.value"
                data-testid="prescricao-confirmar-cancelamento"
              >
                {{ t('confirmarCancelamento') }}
              </button>
              <button type="button" @click="cancelando = null">{{ t('fechar') }}</button>
            </form>
          </li>
        </ul>
      </article>
    </template>
  </section>
</template>

<style scoped>
.prescricao-filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  align-items: end;
}
.prescricao-pacientes {
  list-style: none;
  padding: 0;
}
.prescricao-receita {
  border-top: 1px solid var(--sgh-borda);
  padding-block: var(--sgh-espaco-3);
}
.prescricao-cancelamento {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
</style>
