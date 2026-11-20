<script setup lang="ts">
// Cabeçalho do paciente (regra 11; cap-03 §3.4): seis blocos, nome social antes do civil, dois
// identificadores sempre visíveis (nome + nascimento, e prontuário), alergias em três estados ("Alergias
// não avaliadas" também é alerta) e aviso de homônimo. Mascaramento é do servidor: aqui só se exibe.
import { type ContextoPaciente, classificarData, formatarDataCalendario } from '@sgh/contratos';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import SanteAlerta from './SanteAlerta.vue';

const props = defineProps<{ paciente: ContextoPaciente }>();
const { t } = useI18n();
const id = computed(() => props.paciente.identificacao);
const nomePrincipal = computed(() => id.value.nomeSocial ?? id.value.nomeCivil);
function data(iso: string | null): string {
  const s = classificarData(iso);
  return s.tipo === 'valida' || s.tipo === 'fora-da-faixa' ? formatarDataCalendario(s) : '';
}
const alergias = computed(() => props.paciente.alergias);
// Nascimento fora da faixa de sanidade (ou malformado) é o segundo identificador: aparece com alerta.
const situacaoNascimento = computed(() => classificarData(id.value.nascimento));
const nascimentoInvalido = computed(
  () => situacaoNascimento.value.tipo === 'fora-da-faixa' || situacaoNascimento.value.tipo === 'malformada',
);
const localizacao = computed(() => {
  const l = props.paciente.localizacao;
  return [
    l.estabelecimento,
    l.unidade,
    l.leito,
    l.diasInternacao !== null ? t('ui.paciente.diasInternacao', { dias: l.diasInternacao }) : null,
    l.altaProvavel ? t('ui.paciente.altaProvavel', { data: data(l.altaProvavel) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
});
const atendimento = computed(() => {
  const a = props.paciente.atendimento;
  return [
    a.tipo,
    a.numero,
    a.convenio,
    a.medicoResponsavel ? t('ui.paciente.medicoResponsavel', { nome: a.medicoResponsavel }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
});
</script>

<template>
  <section class="sgh-paciente" :aria-label="t('ui.paciente.regiao')" data-testid="cabecalho-paciente">
    <div class="sgh-paciente__bloco" data-bloco="identificacao">
      <h2 class="sgh-paciente__nome">{{ nomePrincipal }}</h2>
      <p v-if="id.nomeSocial" class="sgh-paciente__civil">
        {{ t('ui.paciente.nomeCivil', { nome: id.nomeCivil }) }}
      </p>
      <p class="sgh-paciente__ids">
        <span data-testid="nascimento">{{ t('ui.paciente.nascimento', { data: data(id.nascimento) }) }}</span>
        <SanteAlerta
          v-if="nascimentoInvalido"
          variante="aviso"
          :texto="t('ui.paciente.nascimentoInvalido', { valor: data(id.nascimento) || id.nascimento })"
          data-testid="nascimento-invalido"
        />
        <span>{{ id.idade }}</span>
        <span>{{ id.sexo }}</span>
        <span class="sgh-paciente__prontuario" data-testid="prontuario">{{
          t('ui.paciente.prontuario', { numero: id.prontuario })
        }}</span>
      </p>
    </div>
    <div class="sgh-paciente__bloco" data-bloco="localizacao">
      <h3>{{ t('ui.paciente.localizacao') }}</h3>
      <p data-testid="localizacao">{{ localizacao }}</p>
    </div>
    <div class="sgh-paciente__bloco" data-bloco="atendimento">
      <h3>{{ t('ui.paciente.atendimento') }}</h3>
      <p data-testid="atendimento">{{ atendimento }}</p>
    </div>
    <div class="sgh-paciente__bloco" data-bloco="alergias">
      <h3>{{ t('ui.paciente.alergias') }}</h3>
      <SanteAlerta
        v-if="alergias.situacao === 'nao-avaliadas'"
        :texto="t('ui.paciente.alergiasNaoAvaliadas')"
        data-testid="alergias-nao-avaliadas"
      />
      <SanteAlerta
        v-else-if="alergias.situacao === 'lista'"
        :texto="t('ui.paciente.alergia', { lista: alergias.itens.join(', ') })"
        icone="emergencia"
        data-testid="alergias-lista"
      />
      <p v-else data-testid="nega-alergias">{{ t('ui.paciente.negaAlergias') }}</p>
    </div>
    <div class="sgh-paciente__bloco" data-bloco="alertas">
      <h3>{{ t('ui.paciente.alertas') }}</h3>
      <ul v-if="paciente.alertas.length > 0 || paciente.homonimoNaUnidade" class="sgh-paciente__lista">
        <li v-if="paciente.homonimoNaUnidade">
          <SanteAlerta
            :texto="t('ui.paciente.homonimo')"
            icone="homonimo"
            variante="aviso"
            data-testid="homonimo"
          />
        </li>
        <li v-for="a in paciente.alertas" :key="a.id"><SanteAlerta :texto="a.texto" /></li>
      </ul>
      <p v-else>{{ t('ui.paciente.semAlertas') }}</p>
    </div>
    <div class="sgh-paciente__bloco" data-bloco="medidas">
      <h3>{{ t('ui.paciente.medidas') }}</h3>
      <p v-if="paciente.medidas.peso || paciente.medidas.altura">
        <span v-if="paciente.medidas.peso">{{
          t('ui.paciente.peso', {
            valor: paciente.medidas.peso.valor,
            data: data(paciente.medidas.peso.data),
          })
        }}</span>
        <span v-if="paciente.medidas.altura">{{
          t('ui.paciente.altura', {
            valor: paciente.medidas.altura.valor,
            data: data(paciente.medidas.altura.data),
          })
        }}</span>
      </p>
      <p v-else>{{ t('ui.paciente.semMedidas') }}</p>
    </div>
  </section>
</template>

<style scoped>
.sgh-paciente {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: var(--sgh-espaco-2) var(--sgh-espaco-4);
  padding: var(--sgh-espaco-3);
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
  border-bottom: 3px solid var(--sgh-primaria);
}
.sgh-paciente__bloco[data-bloco='identificacao'] {
  grid-column: span 2;
}
.sgh-paciente__bloco h3 {
  margin: 0 0 var(--sgh-espaco-1);
  font-size: var(--sgh-fonte-pequena);
  color: var(--sgh-texto-secundario);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.sgh-paciente__bloco p {
  margin: 0;
}
.sgh-paciente__nome {
  margin: 0;
  font-family: var(--sgh-fonte-titulo);
  font-size: 1.4em;
}
.sgh-paciente__civil {
  color: var(--sgh-texto-secundario);
}
.sgh-paciente__ids {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  font-variant-numeric: tabular-nums;
}
.sgh-paciente__prontuario {
  font-family: var(--sgh-fonte-codigo);
  font-weight: 700;
}
.sgh-paciente__lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
</style>
