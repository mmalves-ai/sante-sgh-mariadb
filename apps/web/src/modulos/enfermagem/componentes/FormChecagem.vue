<script setup lang="ts">
// O formulário da checagem de um horário (ficha do M25, regras 4 a 7 e 12): a pulseira (lida ou o motivo), o
// desfecho (administrado ou não administrado com o motivo da lista), a quantidade, a leitura da dose (com lote e
// validade quando a unidade exige), a glicemia com a dose indicada pela escala, a dupla checagem (segundo
// profissional com login e senha próprios) e a conferência dos avisos. Quem decide é o servidor (os nove certos são
// conferidos lá de novo); a tela só monta o pedido. Emite o corpo pronto para `checar` (ou para a fila sem rede).
import {
  type FaixaGlicemiaLida,
  type GravacaoEnfermagem,
  type HorarioEnfermagem,
  MOTIVOS_NAO_ADMINISTRACAO,
  MOTIVOS_SEM_PULSEIRA,
} from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  horario: HorarioEnfermagem;
  parametros: GravacaoEnfermagem['parametros'] | null;
  /** Código da pulseira já lido (beira do leito). */
  pulseiraLida?: string | null;
  ocupado?: boolean;
  podeChecar: boolean;
  motivo?: string | null;
}>();
const emit = defineEmits<{ enviar: [corpo: Record<string, unknown>] }>();
const { t } = useI18n();

const desfecho = ref<'administrado' | 'naoAdministrado'>('administrado');
const motivoNao = ref('');
const observacao = ref('');
const codigoPulseira = ref(props.pulseiraLida ?? '');
const semPulseira = ref(false);
const motivoSemPulseira = ref('');
const quantidade = ref<string>(props.horario.dose !== null ? String(props.horario.dose) : '');
const codigoDose = ref('');
const lote = ref('');
const validade = ref('');
const glicemia = ref('');
const conferenteLogin = ref('');
const conferenteSenha = ref('');
const avisosConferidos = ref(false);
watch(
  () => props.pulseiraLida,
  (v) => {
    if (v) codigoPulseira.value = v;
  },
);

const pulseiraConfere = computed(() => {
  const c = codigoPulseira.value.trim().toUpperCase();
  const m = /^P(\d+)(?:\|A(\d+))?$/.exec(c);
  if (!m) return null;
  return Number(m[1]) === props.horario.paciente && (!m[2] || Number(m[2]) === props.horario.numero);
});
const exigeDupla = computed(
  () => props.horario.duplaChecagem || props.horario.altaVigilancia || props.horario.hemocomponente,
);
const exigeLote = computed(
  () => props.parametros?.loteValidadeObrigatorio === true && props.horario.hemocomponente,
);
const faixa = computed<FaixaGlicemiaLida | null>(() => {
  const g = Number(glicemia.value);
  if (!glicemia.value || !Number.isFinite(g)) return null;
  return props.horario.faixasGlicemia.find((f) => g >= f.de && g <= f.ate) ?? null;
});
const opcoesMotivo = computed(() => [
  { valor: '', rotulo: '—' },
  ...Object.entries(MOTIVOS_NAO_ADMINISTRACAO).map(([valor, rotulo]) => ({ valor, rotulo })),
]);
const opcoesSemPulseira = computed(() => [
  { valor: '', rotulo: '—' },
  ...Object.entries(MOTIVOS_SEM_PULSEIRA).map(([valor, rotulo]) => ({ valor, rotulo })),
]);
const opcoesDesfecho = computed(() => [
  { valor: 'administrado' as const, rotulo: t('enfermagem.checagem.administrado') },
  { valor: 'naoAdministrado' as const, rotulo: t('enfermagem.checagem.naoAdministrado') },
]);

const pronto = computed(() => {
  if (!props.podeChecar) return false;
  if (!semPulseira.value && !codigoPulseira.value.trim()) return false;
  if (semPulseira.value && !motivoSemPulseira.value) return false;
  if (desfecho.value === 'naoAdministrado' && !motivoNao.value) return false;
  if (
    desfecho.value === 'administrado' &&
    exigeDupla.value &&
    (!conferenteLogin.value || !conferenteSenha.value)
  )
    return false;
  return true;
});

function corpo(): Record<string, unknown> {
  const adm = desfecho.value === 'administrado';
  const q = Number(quantidade.value.replace(',', '.'));
  const dose =
    adm && (codigoDose.value.trim() || lote.value.trim() || validade.value)
      ? {
          ...(codigoDose.value.trim() ? { codigo: codigoDose.value.trim() } : {}),
          ...(lote.value.trim() ? { lote: lote.value.trim() } : {}),
          ...(validade.value ? { validade: validade.value } : {}),
        }
      : null;
  return {
    desfecho: desfecho.value,
    situacaoLida: props.horario.situacao,
    motivo: adm ? null : motivoNao.value,
    observacao: observacao.value.trim() || null,
    quantidade: adm && quantidade.value.trim() && Number.isFinite(q) ? q : null,
    pulseira: semPulseira.value
      ? { lida: false, motivo: motivoSemPulseira.value }
      : { lida: true, codigo: codigoPulseira.value.trim().toUpperCase() },
    dose,
    conferente:
      adm && exigeDupla.value ? { login: conferenteLogin.value.trim(), senha: conferenteSenha.value } : null,
    glicemia: props.horario.tipo === 'glicemia' && glicemia.value ? Number(glicemia.value) : null,
    avisosConferidos: avisosConferidos.value,
  };
}
function enviar(): void {
  emit('enviar', corpo());
  conferenteSenha.value = '';
}
const id = (s: string) => `chk-${props.horario.id}-${s}`;
</script>

<template>
  <form class="form-checagem" data-testid="form-checagem" @submit.prevent="enviar">
    <p class="cabeca">
      <strong>{{ horario.descricao }}</strong>
      <span v-if="horario.dose !== null"> · {{ horario.dose }} {{ horario.unidadeDose ?? '' }}</span>
      <span v-if="horario.via"> · {{ horario.via }}</span>
      <span> · {{ t('enfermagem.comum.previsto') }} {{ horario.previsto.slice(11, 16) }}</span>
    </p>
    <p
      v-if="horario.altaVigilancia || horario.hemocomponente"
      class="marca"
      data-testid="marca-alta-vigilancia"
    >
      {{
        horario.hemocomponente ? t('enfermagem.comum.hemocomponente') : t('enfermagem.comum.altaVigilancia')
      }}
      · {{ t('enfermagem.comum.duplaChecagem') }}
    </p>
    <p v-if="horario.observacaoMedica" class="secundario">{{ horario.observacaoMedica }}</p>

    <fieldset>
      <legend>{{ t('enfermagem.checagem.lerPulseira') }}</legend>
      <label :for="id('pulseira')">{{ t('enfermagem.checagem.codigoPulseira') }}</label>
      <input
        :id="id('pulseira')"
        v-model="codigoPulseira"
        :disabled="semPulseira"
        autocomplete="off"
        data-testid="chk-pulseira"
      />
      <p
        v-if="pulseiraConfere === false && !semPulseira"
        role="alert"
        class="erro"
        data-testid="pulseira-nao-confere"
      >
        {{ t('enfermagem.checagem.pulseiraNaoConfere') }}
      </p>
      <label class="linha">
        <input v-model="semPulseira" type="checkbox" data-testid="chk-sem-pulseira" />
        {{ t('enfermagem.checagem.semPulseira') }}
      </label>
      <SanteSelecao
        v-if="semPulseira"
        v-model="motivoSemPulseira"
        :rotulo="t('enfermagem.checagem.motivoSemPulseira')"
        :opcoes="opcoesSemPulseira"
        data-testid="chk-motivo-sem-pulseira"
      />
    </fieldset>

    <fieldset>
      <legend>{{ t('enfermagem.checagem.desfecho') }}</legend>
      <label v-for="o in opcoesDesfecho" :key="o.valor" class="linha">
        <input
          v-model="desfecho"
          type="radio"
          :value="o.valor"
          :name="id('desfecho')"
          :data-testid="`chk-${o.valor}`"
        />
        {{ o.rotulo }}
      </label>
      <SanteSelecao
        v-if="desfecho === 'naoAdministrado'"
        v-model="motivoNao"
        :rotulo="t('enfermagem.checagem.motivo')"
        :opcoes="opcoesMotivo"
        data-testid="chk-motivo"
      />
      <template v-if="desfecho === 'administrado'">
        <label v-if="horario.dose !== null" :for="id('qtde')">{{
          t('enfermagem.checagem.quantidade', { unidade: horario.unidadeDose ?? '' })
        }}</label>
        <input
          v-if="horario.dose !== null"
          :id="id('qtde')"
          v-model="quantidade"
          inputmode="decimal"
          data-testid="chk-quantidade"
        />
        <template v-if="horario.tipo === 'glicemia'">
          <label :for="id('gli')">{{ t('enfermagem.checagem.glicemia') }}</label>
          <input :id="id('gli')" v-model="glicemia" inputmode="numeric" data-testid="chk-glicemia" />
          <p v-if="glicemia && faixa" role="status" data-testid="chk-faixa">
            {{ t('enfermagem.checagem.faixa', { dose: `${faixa.dose ?? '—'} ${faixa.unidade ?? ''}` }) }}
          </p>
          <p v-else-if="glicemia && horario.faixasGlicemia.length" role="status">
            {{ t('enfermagem.checagem.foraDaEscala') }}
          </p>
        </template>
        <template v-if="['medicamento', 'solucao', 'hemoterapia', 'dieta'].includes(horario.tipo)">
          <label :for="id('dose')">{{ t('enfermagem.checagem.dose') }}</label>
          <input :id="id('dose')" v-model="codigoDose" autocomplete="off" data-testid="chk-dose" />
          <div class="duas">
            <span>
              <label :for="id('lote')">{{ t('enfermagem.checagem.lote') }}</label>
              <input
                :id="id('lote')"
                v-model="lote"
                :required="exigeLote"
                maxlength="20"
                data-testid="chk-lote"
              />
            </span>
            <span>
              <label :for="id('val')">{{ t('enfermagem.checagem.validade') }}</label>
              <input
                :id="id('val')"
                v-model="validade"
                type="date"
                :required="exigeLote"
                data-testid="chk-validade"
              />
            </span>
          </div>
        </template>
        <fieldset v-if="exigeDupla" class="dupla" data-testid="chk-dupla">
          <legend>{{ t('enfermagem.checagem.conferente') }}</legend>
          <label :for="id('conf')">{{ t('enfermagem.checagem.conferenteLogin') }}</label>
          <input
            :id="id('conf')"
            v-model="conferenteLogin"
            autocomplete="off"
            data-testid="chk-conferente-login"
          />
          <label :for="id('confs')">{{ t('enfermagem.checagem.conferenteSenha') }}</label>
          <input
            :id="id('confs')"
            v-model="conferenteSenha"
            type="password"
            autocomplete="off"
            data-testid="chk-conferente-senha"
          />
        </fieldset>
      </template>
      <label :for="id('obs')">{{
        horario.seNecessario ? t('enfermagem.checagem.condicao') : t('enfermagem.comum.observacao')
      }}</label>
      <input :id="id('obs')" v-model="observacao" maxlength="200" data-testid="chk-observacao" />
    </fieldset>
    <label class="linha">
      <input v-model="avisosConferidos" type="checkbox" data-testid="chk-avisos-conferidos" />
      {{ t('enfermagem.checagem.avisosConferidos') }}
    </label>
    <p v-if="motivo" class="secundario" role="note">{{ motivo }}</p>
    <SanteBotao
      tipo="submit"
      :rotulo="t('enfermagem.checagem.registrar')"
      :desabilitado="!pronto || ocupado"
      data-testid="chk-registrar"
    />
  </form>
</template>

<style scoped>
.form-checagem {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.form-checagem fieldset {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2);
}
.form-checagem input:not([type='checkbox'], [type='radio']) {
  min-height: var(--sgh-alvo-minimo);
  padding: 0 var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda-forte);
  border-radius: 4px;
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
.linha {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: var(--sgh-alvo-minimo);
}
.duas {
  display: flex;
  gap: var(--sgh-espaco-2);
  flex-wrap: wrap;
}
.duas span {
  display: flex;
  flex-direction: column;
}
.marca {
  font-weight: 600;
  color: var(--sgh-alerta);
}
.erro {
  color: var(--sgh-alerta);
}
.secundario {
  color: var(--sgh-texto-secundario);
}
</style>
