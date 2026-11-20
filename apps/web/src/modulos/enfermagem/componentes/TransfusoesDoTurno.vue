<script setup lang="ts">
// As transfusões na linha do tempo do turno (M47, etapa 1; regra 4): os sinais vitais antes, aos 10 a 15 minutos e ao
// término cobrados como tarefa, com a situação de cada medida (devida, atrasada, aguardando, feita), para as
// transfusões em curso e as do dia com medida pendente na unidade; cada uma abre o ato à beira do leito.
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerTarefasDoTurno } from '../../sadt/api-transfusao.js';
import ErroTransfusao from '../../sadt/componentes/ErroTransfusao.vue';

const props = defineProps<{ unidade: string }>();
const { t } = useI18n();
const T = (k: string) => t(`sadt.transfusao.${k}`);
const dados = useQuery({
  queryKey: computed(() => ['transfusao', 'turno', props.unidade]),
  queryFn: () => lerTarefasDoTurno(props.unidade),
  enabled: computed(() => !!props.unidade),
  refetchInterval: 60_000,
});
const hora = (x: string | null) => (x ? x.slice(11, 16) : '—');
const situacao = (s: string) =>
  ({
    feita: T('ato.tarefaFeita'),
    devida: T('ato.tarefaDevida'),
    atrasada: T('ato.tarefaAtrasada'),
    aguardando: T('ato.tarefaAguardando'),
  })[s] ?? s;
const momento = (m: string) =>
  ({ antes: T('ato.sinaisAntes'), durante: T('ato.sinaisDurante'), depois: T('ato.sinaisDepois') })[m] ?? m;
</script>

<template>
  <section class="cartao" aria-labelledby="turno-transfusoes" data-testid="turno-transfusoes">
    <h2 id="turno-transfusoes">{{ T('ato.doTurno') }}</h2>
    <p class="secundario">{{ T('ato.doTurnoTexto') }}</p>
    <ErroTransfusao v-if="dados.isError.value" :erro="dados.error.value" />
    <p v-else-if="dados.data.value && dados.data.value.itens.length === 0">{{ T('ato.semDoTurno') }}</p>
    <ul v-else-if="dados.data.value">
      <li v-for="x in dados.data.value.itens" :key="x.ato" :data-testid="`turno-transfusao-${x.ato}`">
        <RouterLink :to="{ name: 'enfermagem.transfusao', params: { req: String(x.requisicao) } }">
          {{ x.paciente.leito }} · {{ x.paciente.nome }} · {{ x.bolsa.hemocomponente }} {{ x.bolsa.numero }}
        </RouterLink>
        <span v-for="k in x.tarefas" :key="k.momento" :data-situacao="k.situacao" :data-momento="k.momento">
          · {{ momento(k.momento) }}: {{ situacao(k.situacao) }} ({{ hora(k.atrasaEm) }})
        </span>
      </li>
    </ul>
  </section>
</template>
