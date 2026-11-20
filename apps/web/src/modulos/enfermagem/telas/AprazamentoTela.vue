<script setup lang="ts">
// Aprazamento da prescrição (ficha do M25, seção 7 e regras 1 e 2): a proposta vem da grade de horários da unidade;
// o enfermeiro confere, ajusta a hora, escolhe aprazar, reaprazar ou suprimir (os dois últimos com motivo) e confirma
// em lote. W1-08: a confirmação grava no horário da prescrição (reaprazar substitui a hora; suprimir com o motivo).
import type { PropostaAprazamento } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { confirmarAprazamento, lerAprazamento, novaChave } from '../api-enfermagem.js';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import SeletorUnidade from '../componentes/SeletorUnidade.vue';
import { usarEnfermagem } from '../usar-enfermagem.js';

const { t } = useI18n();
const { unidade, escolherUnidade, opcoesUnidade, gravacao, pode, motivoDe } = usarEnfermagem();
const podeAprazar = pode('registrarAprazamento');
const motivoAprazar = motivoDe('registrarAprazamento');
const lista = useQuery({
  queryKey: computed(() => ['enfermagem', 'aprazamento', unidade.value]),
  queryFn: () => lerAprazamento(unidade.value),
  enabled: computed(() => !!unidade.value),
});

interface Linha {
  marcado: boolean;
  acao: 'aprazar' | 'reaprazar' | 'suprimir';
  confirmado: string;
  motivo: string;
}
const linhas = ref<Record<number, Linha>>({});
watch(
  () => lista.data.value?.itens,
  (itens) => {
    const novo: Record<number, Linha> = {};
    for (const i of itens ?? [])
      novo[i.horario] = linhas.value[i.horario] ?? {
        marcado: false,
        acao: 'aprazar',
        confirmado: i.proposto.slice(0, 16),
        motivo: '',
      };
    linhas.value = novo;
  },
  { immediate: true },
);
const marcados = computed(() =>
  (lista.data.value?.itens ?? []).filter((i) => linhas.value[i.horario]?.marcado),
);
const faltaMotivo = computed(() =>
  marcados.value.some((i) => {
    const l = linhas.value[i.horario]!;
    return l.acao !== 'aprazar' && l.motivo.trim().length === 0;
  }),
);
function marcarTodos(v: boolean): void {
  for (const l of Object.values(linhas.value)) l.marcado = v;
}
const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function confirmar(): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const itens = marcados.value.map((i: PropostaAprazamento) => {
      const l = linhas.value[i.horario]!;
      return {
        horario: i.horario,
        acao: l.acao,
        proposto: i.proposto.slice(0, 16),
        confirmado: l.acao === 'suprimir' ? null : l.confirmado || i.proposto.slice(0, 16),
        motivo: l.motivo.trim() || null,
      };
    });
    const r = await confirmarAprazamento(itens, novaChave('aprazar'));
    mensagem.value = r.mensagem;
    await lista.refetch();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const ACOES = ['aprazar', 'reaprazar', 'suprimir'] as const;
const opcoesAcao = computed(() =>
  ACOES.map((a) => ({ valor: a, rotulo: t(`enfermagem.aprazamento.acoes.${a}`) })),
);
const hora = (iso: string) => iso.slice(0, 16).replace('T', ' ');
</script>

<template>
  <section class="tela-enf" aria-labelledby="apr-titulo" data-testid="tela-aprazamento">
    <h1 id="apr-titulo">{{ t('enfermagem.aprazamento.titulo') }}</h1>
    <p>{{ t('enfermagem.aprazamento.texto') }}</p>
    <div class="barra">
      <SeletorUnidade :model-value="unidade" :opcoes="opcoesUnidade" @update:model-value="escolherUnidade" />
    </div>
    <SanteAlerta
      v-if="gravacao.data.value && gravacao.data.value.categoria !== 'enfermeiro'"
      variante="info"
      :texto="t('enfermagem.aprazamento.soEnfermeiro')"
    />
    <SanteAlerta v-else-if="motivoAprazar" variante="aviso" :texto="motivoAprazar" />
    <SanteAlerta
      v-if="lista.data.value?.motivo"
      variante="info"
      :texto="lista.data.value.motivo"
      data-testid="apr-motivo"
    />
    <p v-if="mensagem" role="status" data-testid="apr-mensagem">{{ mensagem }}</p>
    <ErroEnfermagem v-if="erro" :erro="erro" />
    <ErroEnfermagem v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <p v-else-if="lista.data.value.itens.length === 0">{{ t('enfermagem.aprazamento.vazio') }}</p>
    <template v-else>
      <div class="rolagem">
        <table class="grade" data-testid="apr-grade">
          <thead>
            <tr>
              <th scope="col">
                <label class="linha">
                  <input
                    type="checkbox"
                    data-testid="apr-todos"
                    @change="marcarTodos(($event.target as HTMLInputElement).checked)"
                  />
                  {{ t('enfermagem.aprazamento.marcarTodos') }}
                </label>
              </th>
              <th scope="col">{{ t('enfermagem.comum.paciente') }}</th>
              <th scope="col">{{ t('enfermagem.comum.item') }}</th>
              <th scope="col">{{ t('enfermagem.comum.previsto') }}</th>
              <th scope="col">{{ t('enfermagem.aprazamento.proposto') }}</th>
              <th scope="col">{{ t('enfermagem.aprazamento.acao') }}</th>
              <th scope="col">{{ t('enfermagem.aprazamento.confirmado') }}</th>
              <th scope="col">{{ t('enfermagem.aprazamento.motivo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in lista.data.value.itens" :key="i.horario" :data-testid="`apr-${i.horario}`">
              <td>
                <input
                  v-model="linhas[i.horario]!.marcado"
                  type="checkbox"
                  :aria-label="t('enfermagem.aprazamento.marcar')"
                  :data-testid="`apr-marcar-${i.horario}`"
                />
              </td>
              <td>
                {{ i.leito ? t('enfermagem.comum.leito', { leito: i.leito }) : '' }} {{ i.pacienteNome }}
              </td>
              <td>
                {{ i.descricao }}
                <span v-if="i.registrado" class="secundario" :data-testid="`apr-registrado-${i.horario}`">
                  ·
                  {{
                    t('enfermagem.aprazamento.registrado', {
                      acao: t(`enfermagem.aprazamento.acoes.${i.registrado.acao}`),
                      por: i.registrado.por,
                    })
                  }}
                </span>
              </td>
              <td>{{ hora(i.previsto) }}</td>
              <td>
                {{ hora(i.proposto) }}
                <span class="secundario">· {{ i.motivoProposta }}</span>
              </td>
              <td>
                <SanteSelecao
                  v-model="linhas[i.horario]!.acao"
                  :rotulo="t('enfermagem.aprazamento.acao')"
                  :ocultar-rotulo="true"
                  :opcoes="opcoesAcao"
                  :data-testid="`apr-acao-${i.horario}`"
                />
              </td>
              <td>
                <input
                  v-model="linhas[i.horario]!.confirmado"
                  type="datetime-local"
                  :disabled="linhas[i.horario]!.acao === 'suprimir'"
                  :aria-label="t('enfermagem.aprazamento.confirmado')"
                  :data-testid="`apr-hora-${i.horario}`"
                />
              </td>
              <td>
                <input
                  v-model="linhas[i.horario]!.motivo"
                  maxlength="200"
                  :aria-label="t('enfermagem.aprazamento.motivo')"
                  :data-testid="`apr-motivo-${i.horario}`"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="faltaMotivo" role="alert" class="alerta">
        {{ t('enfermagem.aprazamento.motivoObrigatorio') }}
      </p>
      <SanteBotao
        :rotulo="t('enfermagem.aprazamento.confirmarLote', { n: marcados.length })"
        :desabilitado="!podeAprazar || marcados.length === 0 || faltaMotivo || ocupado"
        data-testid="apr-confirmar"
        @acionar="confirmar"
      />
    </template>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
