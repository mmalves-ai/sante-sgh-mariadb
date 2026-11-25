<script setup lang="ts">
// Fila de espera eletiva da internação (C2-048, 04-INT linha 70): as pré-internações sem data, na ordem da
// prioridade clínica e da data do pedido (a posição vem do domínio, no servidor), com os dias de espera e o resumo do
// plano previsto. A mudança de prioridade pede justificativa, conferida na hora e registrada na pré-internação.
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerFilaEspera, PRIORIDADES_FILA, priorizarPre } from '../api-pre-internacao-plano.js';
import ErroAdt from './ErroAdt.vue';

const props = defineProps<{ podeGravar: boolean }>();
const emit = defineEmits<{ plano: [paciente: number] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const fila = useQuery({ queryKey: ['adt', 'pre-fila'], queryFn: lerFilaEspera });
const prioridades = computed(() =>
  PRIORIDADES_FILA.map((p) => ({ valor: p as string, rotulo: t(`adt.prePlano.prioridades.${p}`) })),
);

const aberta = ref<number | null>(null);
const nova = ref('');
const justificativa = ref('');
const curta = computed(() => justificativa.value.trim().length < 10);
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
function abrir(pre: number, atual: string): void {
  aberta.value = aberta.value === pre ? null : pre;
  nova.value = atual;
  justificativa.value = '';
  erro.value = null;
}
async function mudar(pre: number, versao: number): Promise<void> {
  if (curta.value) return;
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await priorizarPre(pre, { versao, prioridade: nova.value, justificativa: justificativa.value.trim() });
    mensagem.value = t('adt.prePlano.fila.mudada');
    aberta.value = null;
    await cliente.invalidateQueries({ queryKey: ['adt', 'pre-fila'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="painel" aria-labelledby="pre-fila-titulo" data-testid="pre-fila">
    <h2 id="pre-fila-titulo">{{ t('adt.prePlano.fila.titulo') }}</h2>
    <p>{{ t('adt.prePlano.fila.texto') }}</p>
    <ErroAdt v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <p data-testid="pre-fila-contagem">
        {{
          t('adt.prePlano.fila.contagem', {
            total: fila.data.value.contagens['total'] ?? 0,
            urgente: fila.data.value.contagens['urgente'] ?? 0,
            prioritaria: fila.data.value.contagens['prioritaria'] ?? 0,
            normal: fila.data.value.contagens['normal'] ?? 0,
          })
        }}
      </p>
      <p v-if="fila.data.value.itens.length === 0">{{ t('adt.prePlano.fila.vazia') }}</p>
      <table v-else class="tabela" data-testid="tabela-pre-fila">
        <caption class="secundario">
          {{
            t('adt.prePlano.fila.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('adt.prePlano.fila.posicao') }}</th>
            <th scope="col">{{ t('adt.prePlano.fila.paciente') }}</th>
            <th scope="col">{{ t('adt.prePlano.fila.prioridade') }}</th>
            <th scope="col">{{ t('adt.prePlano.fila.espera') }}</th>
            <th scope="col">{{ t('adt.prePlano.fila.plano') }}</th>
            <th scope="col">{{ t('adt.acoesColuna') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="x in fila.data.value.itens" :key="x.preInternacao">
            <tr :data-testid="`pre-fila-${x.preInternacao}`">
              <td>{{ x.posicao }}</td>
              <td>
                {{ x.nome }}
                <span v-if="x.prontuario" class="secundario"
                  >· {{ t('adt.prontuario', { n: x.prontuario }) }}</span
                >
                <span v-if="x.especialidade" class="secundario">· {{ x.especialidade }}</span>
              </td>
              <td :data-testid="`pre-fila-prioridade-${x.preInternacao}`">
                {{ t(`adt.prePlano.prioridades.${x.prioridade}`) }}
              </td>
              <td>{{ t('adt.prePlano.fila.dias', { n: x.diasEspera }) }}</td>
              <td>
                {{ x.procedimentoPrincipal ?? '' }}
                <span class="secundario">{{
                  t('adt.prePlano.fila.resumo', { p: x.procedimentos, m: x.materiais, e: x.equipe })
                }}</span>
              </td>
              <td class="acoes">
                <SanteBotao
                  variante="texto"
                  :rotulo="t('adt.prePlano.plano')"
                  :data-testid="`pre-fila-plano-${x.preInternacao}`"
                  @acionar="emit('plano', x.paciente)"
                />
                <SanteBotao
                  v-if="props.podeGravar"
                  variante="secundario"
                  :rotulo="t('adt.prePlano.fila.mudar')"
                  :data-testid="`pre-fila-mudar-${x.preInternacao}`"
                  @acionar="abrir(x.preInternacao, x.prioridade)"
                />
              </td>
            </tr>
            <tr v-if="aberta === x.preInternacao">
              <td colspan="6">
                <form class="filtros" @submit.prevent="mudar(x.preInternacao, x.versao)">
                  <SanteSelecao
                    v-model="nova"
                    :rotulo="t('adt.prePlano.fila.novaPrioridade')"
                    :opcoes="prioridades"
                    data-testid="pre-fila-nova-prioridade"
                  />
                  <SanteCampoTexto
                    v-model="justificativa"
                    :rotulo="t('adt.prePlano.fila.justificativa')"
                    :max-bytes="500"
                    obrigatorio
                    data-testid="pre-fila-justificativa"
                  />
                  <span v-if="curta" class="secundario">{{ t('adt.prePlano.fila.justificativaCurta') }}</span>
                  <SanteBotao
                    tipo="submit"
                    :rotulo="t('adt.prePlano.fila.mudar')"
                    :desabilitado="ocupado || curta || nova === x.prioridade"
                    data-testid="pre-fila-confirmar"
                  />
                </form>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </template>
    <p v-if="mensagem" role="status" data-testid="pre-fila-mensagem">{{ mensagem }}</p>
    <ErroAdt v-if="erro" :erro="erro" />
  </section>
</template>
