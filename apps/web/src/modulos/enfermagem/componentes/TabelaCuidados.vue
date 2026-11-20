<script setup lang="ts">
// Os horários dos cuidados de enfermagem (M45, etapa 4; regra 8): a hora, o paciente, o cuidado, a situação (a checar,
// atrasada em vermelho, feita, não feita com o motivo) e as ações — checar feito, não feito (o motivo é obrigatório) e
// estornar a checagem com a justificativa (a original fica guardada). Usada pelo processo do paciente e pela linha do
// tempo do turno.
import type { HorarioCuidado } from '@sgh/contratos';
import { SanteBotao, SanteDialogo } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    horarios: readonly HorarioCuidado[];
    podeChecar: boolean;
    podeEstornar: boolean;
    ocupado?: boolean;
    prefixo: string;
    mostrarPaciente?: boolean;
  }>(),
  { ocupado: false, mostrarPaciente: false },
);
const emit = defineEmits<{
  checar: [h: HorarioCuidado, feita: boolean, motivo: string | null];
  estornar: [checagem: number, motivo: string];
}>();
const { t } = useI18n();
const hora = (x: string) => x.slice(11, 16);
const chave = (h: HorarioCuidado) => `${h.atividade}-${h.previsto.replace(/\D/g, '')}`;

const dialogo = ref(false);
const modo = ref<'naoFeita' | 'estorno'>('naoFeita');
const alvo = ref<HorarioCuidado | null>(null);
const motivo = ref('');
const minimo = computed(() => (modo.value === 'estorno' ? 10 : 5));
function abrir(m: 'naoFeita' | 'estorno', h: HorarioCuidado): void {
  modo.value = m;
  alvo.value = h;
  motivo.value = '';
  dialogo.value = true;
}
function confirmar(): void {
  const h = alvo.value;
  if (!h) return;
  if (modo.value === 'naoFeita') emit('checar', h, false, motivo.value.trim());
  else if (h.checagem) emit('estornar', h.checagem.id, motivo.value.trim());
  dialogo.value = false;
}
</script>

<template>
  <div class="rolagem">
    <table class="grade" :data-testid="`${prefixo}-cuidados`">
      <thead>
        <tr>
          <th scope="col">{{ t('enfermagem.cuidados.hora') }}</th>
          <th v-if="mostrarPaciente" scope="col">{{ t('enfermagem.cuidados.paciente') }}</th>
          <th scope="col">{{ t('enfermagem.cuidados.cuidado') }}</th>
          <th scope="col">{{ t('enfermagem.cuidados.situacao') }}</th>
          <th scope="col">{{ t('enfermagem.cuidados.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="h in props.horarios"
          :key="`${chave(h)}-${h.checagem?.id ?? 'a'}`"
          :data-testid="`${prefixo}-cuidado-${chave(h)}`"
          :data-estado="h.estado"
          :data-sn="h.seNecessario ? 'sim' : 'nao'"
        >
          <td>
            {{ h.seNecessario && !h.checagem ? t('enfermagem.cuidados.seNecessario') : hora(h.previsto) }}
          </td>
          <td v-if="mostrarPaciente">
            {{ h.leito || t('enfermagem.comum.semLeito') }} · {{ h.nome }}
            <RouterLink :to="`/enfermagem/sae/${h.atendimento}`">{{
              t('enfermagem.cuidados.processo')
            }}</RouterLink>
          </td>
          <td>
            {{ h.descricao }}
            <span v-if="h.seNecessario" class="secundario">
              · {{ t('enfermagem.cuidados.seNecessario') }}</span
            >
          </td>
          <td :class="{ alerta: h.estado === 'atrasada' || h.estado === 'naoFeita' }">
            {{ t(`enfermagem.cuidados.estados.${h.estado}`) }}
            <span v-if="h.checagem" class="secundario">
              · {{ h.checagem.horaReal.slice(11, 16) }} · {{ h.checagem.usuario }}
              <span v-if="h.checagem.motivo"> · {{ h.checagem.motivo }}</span>
            </span>
            <span v-if="h.estornos" class="secundario">
              · {{ t('enfermagem.cuidados.estornos', { n: h.estornos }) }}</span
            >
          </td>
          <td>
            <template v-if="!h.checagem && podeChecar">
              <SanteBotao
                :rotulo="t('enfermagem.cuidados.feita')"
                :desabilitado="ocupado"
                :data-testid="`${prefixo}-feita-${chave(h)}`"
                @acionar="emit('checar', h, true, null)"
              />
              <SanteBotao
                variante="secundario"
                :rotulo="t('enfermagem.cuidados.naoFeita')"
                :desabilitado="ocupado"
                :data-testid="`${prefixo}-nao-feita-${chave(h)}`"
                @acionar="abrir('naoFeita', h)"
              />
            </template>
            <SanteBotao
              v-else-if="h.checagem && podeEstornar"
              variante="texto"
              :rotulo="t('enfermagem.cuidados.estornar')"
              :desabilitado="ocupado"
              :data-testid="`${prefixo}-estornar-${chave(h)}`"
              @acionar="abrir('estorno', h)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <SanteDialogo
    v-model:visivel="dialogo"
    :titulo="
      modo === 'estorno' ? t('enfermagem.cuidados.estornoTitulo') : t('enfermagem.cuidados.naoFeitaTitulo')
    "
  >
    <div class="campo">
      <p>{{ alvo?.descricao }} · {{ alvo ? hora(alvo.previsto) : '' }}</p>
      <p v-if="modo === 'estorno'">{{ t('enfermagem.cuidados.estornoTexto') }}</p>
      <label :for="`${prefixo}-motivo-cuidado`">{{
        modo === 'estorno' ? t('enfermagem.cuidados.motivoEstorno') : t('enfermagem.cuidados.motivoNaoFeita')
      }}</label>
      <input
        :id="`${prefixo}-motivo-cuidado`"
        v-model="motivo"
        maxlength="200"
        :data-testid="`${prefixo}-motivo-cuidado`"
      />
    </div>
    <template #rodape>
      <SanteBotao
        :rotulo="t('enfermagem.cuidados.confirmar')"
        :desabilitado="motivo.trim().length < minimo"
        :data-testid="`${prefixo}-motivo-confirmar`"
        @acionar="confirmar"
      />
    </template>
  </SanteDialogo>
</template>
