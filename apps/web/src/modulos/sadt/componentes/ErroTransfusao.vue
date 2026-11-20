<script setup lang="ts">
// Erro das telas da agência transfusional (M47): a recusa conhecida com o texto da aplicação (as regras do domínio dão
// os textos dos bloqueios do início, da bolsa, da requisição e da reação; as recusas da gravação ficam aqui) e, no
// bloqueio, a lista com cada motivo; o resto, a mensagem geral com o código de correlação (nunca o texto do servidor).
import {
  MENSAGENS_BOLSA,
  MENSAGENS_ESTOQUE,
  MENSAGENS_IMUNO,
  MENSAGENS_INICIO,
  MENSAGENS_REACAO,
  MENSAGENS_REQUISICAO,
} from '@sgh/dominio-sadt';
import { SanteAlerta } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { codigoDaRecusa } from '../api-sadt.js';
import { bloqueiosDaRecusa } from '../api-transfusao.js';

const RECUSAS: Readonly<Record<string, string>> = {
  'requisicao-em-aberto': 'Já há uma requisição em aberto para este item.',
  'nao-cancelavel': 'A transfusão já começou: a requisição não é mais cancelável.',
  'ja-cancelada': 'A requisição já foi cancelada.',
  'requisicao-fechada': 'A requisição não está aberta para transfusão.',
  'ato-em-curso': 'Há uma transfusão em curso nesta requisição: conclua-a antes.',
  'ato-encerrado': 'A transfusão já foi concluída ou interrompida.',
  'sinais-ja-registrados': 'Os sinais deste momento já foram registrados.',
  'bolsa-ja-usada': 'Esta bolsa já foi usada em outra transfusão.',
  'ja-notificada': 'O envio desta notificação já foi registrado.',
  'pulseira-outro-paciente': 'A pulseira lida não é do paciente da requisição: confira antes de seguir.',
  'pulseira-ilegivel': 'O código lido não é de uma pulseira de identificação.',
  'pulseira-sem-motivo': 'Leia a pulseira ou informe o motivo de não ler.',
  'categoria-nao-checa': 'O ato transfusional é da enfermagem (enfermeiro ou técnico com o vínculo ativo).',
  'recurso-desligado': 'A agência transfusional ainda não foi liberada para gravar neste estabelecimento.',
  'somente-leitura': 'Neste ambiente o banco é só de leitura: nada é gravado.',
  'horario-suspenso': 'O horário da prescrição foi suspenso: nada foi gravado.',
  'horario-ja-checado': 'O horário da prescrição já foi checado em outro terminal: nada foi gravado.',
  'horario-mudou': 'O horário da prescrição mudou: abra de novo e confira.',
};
const TEXTOS: Readonly<Record<string, string>> = {
  ...MENSAGENS_REQUISICAO,
  ...MENSAGENS_BOLSA,
  ...(MENSAGENS_INICIO as Record<string, string>),
  ...MENSAGENS_REACAO,
  // M47 (etapa 2): as recusas da imuno-hematologia, da prova cruzada e do estoque.
  ...MENSAGENS_IMUNO,
  ...MENSAGENS_ESTOQUE,
  ...RECUSAS,
};

const props = defineProps<{ erro: unknown }>();
const { t } = useI18n();
const bloqueios = computed(() => bloqueiosDaRecusa(props.erro).filter((b) => TEXTOS[b]));
const codigo = computed(() => codigoDaRecusa(props.erro));
const texto = computed(() => (codigo.value ? (TEXTOS[codigo.value] ?? null) : null));
</script>

<template>
  <div v-if="bloqueios.length" role="alert" data-testid="recusa-transfusao">
    <SanteAlerta variante="alerta" :texto="t('sadt.transfusao.naoFoiPossivel')" />
    <ul class="bloqueios">
      <li v-for="b in bloqueios" :key="b" :data-bloqueio="b" data-testid="bloqueio-transfusao">
        {{ TEXTOS[b] }}
      </li>
    </ul>
  </div>
  <div v-else-if="texto" role="alert" data-testid="recusa-transfusao" :data-codigo="codigo">
    <SanteAlerta variante="alerta" :texto="texto" />
  </div>
  <MensagemErro v-else :erro="erro" />
</template>

<style scoped>
.bloqueios {
  margin: var(--sgh-espaco-1) 0 0;
  padding-left: var(--sgh-espaco-3);
}
</style>
