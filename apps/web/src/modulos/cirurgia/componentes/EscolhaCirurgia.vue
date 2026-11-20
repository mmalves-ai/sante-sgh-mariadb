<script setup lang="ts">
// Escolha da cirurgia do dia para a APA, a ficha anestésica ou a admissão na recuperação (M46): a data, as cirurgias com
// a sala, o horário, o paciente e a situação de cada registro, e o botão que abre a tela do registro escolhido.
import { CONCLUSOES_APA } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { lerCirurgiasAnestesia } from '../api-anestesia.js';
import ErroAnestesia from './ErroAnestesia.vue';

const props = defineProps<{ destino: 'apa' | 'ficha' | 'srpa' }>();
const { t } = useI18n();
const router = useRouter();
const data = ref('');
const lista = useQuery({
  queryKey: computed(() => ['anestesia', 'cirurgias', data.value]),
  queryFn: () => lerCirurgiasAnestesia(data.value || null),
});
const rota = { apa: 'bloco.apa', ficha: 'bloco.ficha', srpa: 'bloco.srpa' } as const;
const conclusao = (c: string | null) =>
  CONCLUSOES_APA.find((x) => x.codigo === c)?.rotulo ?? t('anestesia.escolha.semApa');
function abrir(agenda: number): void {
  void router.push(
    props.destino === 'srpa'
      ? { name: rota.srpa, query: { agenda: String(agenda) } }
      : { name: rota[props.destino], params: { agenda: String(agenda) } },
  );
}
</script>

<template>
  <section aria-labelledby="anest-escolha" data-testid="escolha-cirurgia">
    <h2 id="anest-escolha">{{ t('anestesia.escolha.titulo') }}</h2>
    <div class="barra">
      <span class="campo">
        <label for="anest-data">{{ t('anestesia.escolha.data') }}</label>
        <input id="anest-data" v-model="data" type="date" data-testid="anest-data" />
      </span>
    </div>
    <ErroAnestesia v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('anestesia.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0">{{ t('anestesia.escolha.semCirurgias') }}</p>
    <div v-else class="rolagem">
      <table class="grade">
        <caption class="secundario">
          {{
            t('anestesia.escolha.legenda', { data: lista.data.value.data })
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('anestesia.escolha.sala') }}</th>
            <th scope="col">{{ t('anestesia.horario') }}</th>
            <th scope="col">{{ t('anestesia.escolha.paciente') }}</th>
            <th scope="col">{{ t('anestesia.cabecalho.procedimento') }}</th>
            <th scope="col">{{ t('anestesia.escolha.situacao') }}</th>
            <th scope="col">{{ t('anestesia.escolha.acao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in lista.data.value.itens"
            :key="c.agendamento"
            :data-testid="`cirurgia-${c.agendamento}`"
          >
            <td>{{ c.sala }}</td>
            <td>{{ c.inicio.slice(11, 16) }}</td>
            <td>{{ c.paciente }}</td>
            <td>{{ c.procedimento ?? '—' }}</td>
            <td>
              {{ conclusao(c.apa) }} ·
              {{ c.ficha ? t(`anestesia.ficha.situacoes.${c.ficha}`) : t('anestesia.escolha.semFicha') }}
              <template v-if="c.srpa"> · {{ t(`anestesia.srpa.momentos.${c.srpa}`) }}</template>
            </td>
            <td>
              <SanteBotao
                variante="secundario"
                :rotulo="t('anestesia.escolha.abrir')"
                :data-testid="`abrir-${c.agendamento}`"
                @acionar="abrir(c.agendamento)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="lista.data.value.truncado" class="secundario">{{ t('anestesia.escolha.truncado') }}</p>
    </div>
  </section>
</template>
