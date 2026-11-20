<script setup lang="ts">
// Aba "Conciliação" (M53.6; regra 1): por competência, os eventos deste sistema, os que o sistema externo informou, os
// recibos de autônomo do repasse e as pendências acumuladas, linha a linha, com a situação de cada uma; o transmissor do
// empregador e as outras empresas da mesma raiz de CNPJ. Quem transmite registra a conferência (as quantidades do
// sistema externo e a observação), gravada com a trilha.
import { type ApoioEsocial, esquemaConferirConciliacaoEsocial } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { competenciasAte, instanteBr, rotuloCompetencia } from '../comum-folha.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { conferirConciliacaoEsocial, lerConciliacaoEsocial } from './api-esocial.js';
import { lerExterno } from './comum-esocial.js';

const props = defineProps<{ apoio: ApoioEsocial; empresa: number }>();
const { t } = useI18n();
const cliente = useQueryClient();
const competencias = competenciasAte(props.apoio.hoje, 36);
const competencia = ref<string>(competencias[0]!);
const opcoesCompetencia = competencias.map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) }));
const q = useQuery({
  queryKey: computed(() => ['folha', 'esocial', 'conciliacao', props.empresa, competencia.value]),
  queryFn: () => lerConciliacaoEsocial({ empresa: props.empresa, competencia: competencia.value }),
});
const c = computed(() => q.data.value ?? null);
const rotuloEmpresa = (codigo: number) =>
  props.apoio.empresas.find((e) => e.codigo === codigo)?.rotulo ?? String(codigo);

const externo = ref<Record<string, string>>({});
const observacao = ref('');
watch(c, (x) => {
  externo.value = Object.fromEntries(
    (x?.linhas ?? []).map((l) => [l.evento, l.externo === null ? '' : String(l.externo)]),
  );
  observacao.value = x?.conferida?.observacao ?? '';
});
const lidos = computed(() => lerExterno(externo.value));
const entrada = computed(() =>
  esquemaConferirConciliacaoEsocial.safeParse({
    empresa: props.empresa,
    competencia: competencia.value,
    externo: lidos.value ?? {},
    observacao: observacao.value.trim() || null,
  }),
);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function conferir(): Promise<void> {
  if (!entrada.value.success || lidos.value === null) return;
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    const r = await conferirConciliacaoEsocial(entrada.value.data);
    cliente.setQueryData(['folha', 'esocial', 'conciliacao', props.empresa, competencia.value], r);
    aviso.value = t('folha.esocial.conciliacao.registrada');
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section
    class="bloco"
    :aria-label="t('folha.esocial.conciliacao.titulo')"
    data-testid="esocial-conciliacao"
  >
    <h2>{{ t('folha.esocial.conciliacao.titulo') }}</h2>
    <p class="secundario">{{ t('folha.esocial.conciliacao.ajuda') }}</p>
    <SanteAlerta
      v-if="aviso"
      :texto="aviso"
      variante="info"
      anunciar
      data-testid="esocial-conciliacao-aviso"
    />
    <ErroFolha v-if="erro" :erro="erro" />
    <div class="campos">
      <SanteSelecao
        v-model="competencia"
        :rotulo="t('folha.esocial.conciliacao.competencia')"
        :opcoes="opcoesCompetencia"
        busca
        data-testid="esocial-conciliacao-competencia"
      />
    </div>
    <ErroFolha v-if="q.isError.value" :erro="q.error.value" />
    <p v-else-if="!c" role="status">{{ t('folha.esocial.carregando') }}</p>
    <template v-else>
      <p data-testid="esocial-conciliacao-transmissor">
        {{
          c.transmissor
            ? t('folha.esocial.conciliacao.transmissor', {
                t: t(`folha.esocial.transmissores.${c.transmissor}`),
              })
            : t('folha.esocial.conciliacao.semTransmissor')
        }}
        · <strong>{{ t(`folha.esocial.conciliacao.situacoes.${c.situacao}`) }}</strong>
      </p>
      <p v-if="c.mesmaRaiz.length" class="secundario">
        {{
          t('folha.esocial.conciliacao.mesmaRaiz', { empresas: c.mesmaRaiz.map(rotuloEmpresa).join(', ') })
        }}
      </p>
      <p v-if="c.conferida" class="secundario" data-testid="esocial-conciliacao-conferida">
        {{
          t('folha.esocial.conciliacao.conferida', {
            por: c.conferida.por,
            em: instanteBr(c.conferida.em),
            situacao: t(`folha.esocial.conciliacao.situacoes.${c.conferida.situacao}`),
          })
        }}
        <span v-if="c.conferida.observacao"> · {{ c.conferida.observacao }}</span>
      </p>
      <p v-if="c.linhas.length === 0" data-testid="esocial-conciliacao-vazia">
        {{ t('folha.esocial.conciliacao.nenhuma') }}
      </p>
      <div
        v-else
        class="rolagem"
        tabindex="0"
        role="region"
        :aria-label="t('folha.esocial.conciliacao.titulo')"
      >
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('folha.esocial.conciliacao.evento') }}</th>
              <th scope="col">{{ t('folha.esocial.conciliacao.sante') }}</th>
              <th scope="col">{{ t('folha.esocial.conciliacao.externo') }}</th>
              <th scope="col">{{ t('folha.esocial.conciliacao.repasse') }}</th>
              <th scope="col">{{ t('folha.esocial.conciliacao.pendencia') }}</th>
              <th scope="col">{{ t('folha.esocial.conciliacao.situacaoLinha') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in c.linhas" :key="l.evento" :data-testid="`esocial-conciliacao-linha-${l.evento}`">
              <th scope="row">{{ l.evento }} · {{ l.rotulo }}</th>
              <td>{{ l.sante }}</td>
              <td>
                <SanteCampoTexto
                  v-if="apoio.acoes.transmitir"
                  :model-value="externo[l.evento] ?? ''"
                  :rotulo="`${t('folha.esocial.conciliacao.externo')} ${l.evento}`"
                  :max-bytes="7"
                  :data-testid="`esocial-conciliacao-externo-${l.evento}`"
                  @update:model-value="(v: string) => (externo = { ...externo, [l.evento]: v })"
                />
                <template v-else>{{ l.externo ?? '—' }}</template>
              </td>
              <td :data-testid="`esocial-conciliacao-repasse-${l.evento}`">{{ l.repasse }}</td>
              <td>{{ l.pendenciaLegado }}</td>
              <td :data-testid="`esocial-conciliacao-situacao-${l.evento}`">
                {{ t(`folha.esocial.conciliacao.linha.${l.situacao}`) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form v-if="apoio.acoes.transmitir" data-testid="esocial-conciliacao-form" @submit.prevent="conferir">
        <p class="secundario">{{ t('folha.esocial.conciliacao.externoAjuda') }}</p>
        <p v-if="lidos === null" role="alert">{{ t('folha.esocial.conciliacao.externoInvalido') }}</p>
        <SanteCampoTexto
          v-model="observacao"
          :rotulo="t('folha.esocial.conciliacao.observacao')"
          :max-bytes="400"
          multilinha
          data-testid="esocial-conciliacao-observacao"
        />
        <SanteBotao
          :rotulo="t('folha.esocial.conciliacao.conferir')"
          tipo="submit"
          :desabilitado="ocupado || !entrada.success || lidos === null"
          data-testid="esocial-conciliacao-conferir"
        />
      </form>
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
