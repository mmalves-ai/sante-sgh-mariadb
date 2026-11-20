<script setup lang="ts">
// A ficha de notificação do caso, para impressão (M48, etapa 4; regra 8; DP-47.3: até o canal do município ser
// confirmado, a notificação é a ficha impressa entregue à vigilância municipal). O modelo do Sinan do agravo, com os
// campos que o Sante já sabe pré-preenchidos e os demais em branco para a mão; a leitura é auditada no servidor.
import '../../ccih/componentes/estilo-ccih.css';
import { rotuloOrigemCasoAgravo, rotuloPeriodicidadeAgravo } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import { lerCaso, lerFicha } from '../api-agravo.js';
import ErroAgravo from '../componentes/ErroAgravo.vue';
import { idadeEm } from '../regras-agravo.js';

const props = defineProps<{ id: number }>();
const { t } = useI18n();
const caso = useQuery({
  queryKey: computed(() => ['agravos', 'caso', props.id]),
  queryFn: () => lerCaso(props.id),
});
const ficha = useQuery({
  queryKey: computed(() => ['agravos', 'ficha', props.id]),
  queryFn: () => lerFicha(props.id),
});
const idade = computed(() =>
  caso.data.value ? idadeEm(caso.data.value.paciente.nascimento, caso.data.value.gatilhoEm) : null,
);
const imprimir = () => window.print();
</script>

<template>
  <section
    class="tela-agenda ficha-agravo"
    aria-labelledby="ficha-agravo-titulo"
    data-testid="tela-ficha-agravo"
  >
    <div class="linha-ccih nao-imprimir">
      <RouterLink :to="`/qualidade/vigilancia/agravos?caso=${id}`" data-testid="ficha-voltar">{{
        t('agravos.ficha.voltar')
      }}</RouterLink>
      <SanteBotao :rotulo="t('agravos.ficha.imprimir')" data-testid="ficha-imprimir" @acionar="imprimir" />
    </div>
    <h1 id="ficha-agravo-titulo">{{ t('agravos.ficha.titulo') }}</h1>
    <ErroAgravo v-if="caso.isError.value" :erro="caso.error.value" />
    <ErroAgravo v-else-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!caso.data.value || !ficha.data.value" role="status">{{ t('agravos.carregando') }}</p>
    <template v-else>
      <p v-if="ficha.data.value.modelo" data-testid="ficha-modelo">
        <strong>{{ t('agravos.ficha.modelo', { nome: ficha.data.value.modelo.nome }) }}</strong>
      </p>
      <p v-else data-testid="ficha-sem-modelo">{{ t('agravos.ficha.semModelo') }}</p>
      <SanteAlerta
        v-if="ficha.data.value.generica"
        variante="info"
        :texto="t('agravos.ficha.generica')"
        data-testid="ficha-generica"
      />
      <h2>{{ t('agravos.ficha.dadosCaso') }}</h2>
      <dl class="dados-ficha">
        <dt>{{ t('agravos.caso.paciente') }}</dt>
        <dd data-testid="ficha-paciente">
          {{ caso.data.value.paciente.nome }}
          <template v-if="caso.data.value.paciente.prontuario !== null">
            · {{ t('agravos.prontuario', { n: caso.data.value.paciente.prontuario }) }}</template
          >
          <template v-if="idade !== null"> · {{ t('agravos.caso.idade', { anos: idade }) }}</template>
        </dd>
        <dt>{{ t('agravos.fila.colAgravo') }}</dt>
        <dd data-testid="ficha-agravo">
          {{ caso.data.value.cid }} {{ caso.data.value.nomeCid }} ·
          {{ rotuloPeriodicidadeAgravo(caso.data.value.periodicidade) }}
        </dd>
        <dt>{{ t('agravos.caso.origem') }}</dt>
        <dd>{{ rotuloOrigemCasoAgravo(caso.data.value.origem) }}</dd>
        <dt>{{ t('agravos.caso.gatilhoEm') }}</dt>
        <dd>{{ dataHora(caso.data.value.gatilhoEm) }}</dd>
        <dt>{{ t('agravos.caso.prazoEm') }}</dt>
        <dd>{{ dataHora(caso.data.value.prazoEm) }}</dd>
      </dl>
      <p class="secundario" data-testid="ficha-preenchidas">
        {{
          t('agravos.ficha.preenchidas', {
            n: ficha.data.value.preenchidas,
            total: ficha.data.value.perguntas.length,
          })
        }}
      </p>
      <table v-if="ficha.data.value.perguntas.length" class="tabela" data-testid="tabela-ficha">
        <caption>
          {{
            ficha.data.value.modelo?.nome ?? t('agravos.ficha.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('agravos.ficha.colCampo') }}</th>
            <th scope="col">{{ t('agravos.ficha.colValor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in ficha.data.value.perguntas"
            :key="`${p.codigo}-${p.subcodigo}`"
            :data-testid="`pergunta-${p.codigo}-${p.subcodigo}`"
          >
            <th scope="row">{{ p.texto }}</th>
            <td :class="p.valor === null ? 'em-branco' : ''">{{ p.valor ?? '' }}</td>
          </tr>
        </tbody>
      </table>
      <p class="assinatura-ficha">{{ t('agravos.ficha.assinatura') }}</p>
    </template>
  </section>
</template>

<style src="../../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.dados-ficha {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1, 0.25rem) var(--sgh-espaco-3);
  margin: 0;
}
.dados-ficha dt {
  font-weight: 600;
}
.dados-ficha dd {
  margin: 0;
}
.ficha-agravo th[scope='row'] {
  font-weight: normal;
  text-align: start;
}
.em-branco {
  min-width: 12rem;
  border-bottom: 1px solid var(--sgh-texto);
}
.assinatura-ficha {
  margin-top: var(--sgh-espaco-4, 1.5rem);
}
@media print {
  .nao-imprimir {
    display: none;
  }
}
</style>
