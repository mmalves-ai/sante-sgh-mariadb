<script setup lang="ts">
// "Revisão de acessos por quebra de vidro" (M10, ficha seção 7; cap-08 §8.5): toda abertura é revisada como
// justificada ou não; ninguém revisa o próprio acesso. A justificativa só o Auditor vê.
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { tipoDoProblema } from '@sgh/contratos';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarQuebras, revisarQuebra } from '../api.js';

const { t } = useI18n();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['adm', 'quebras'], queryFn: () => buscarQuebras() });
const recusa = ref('');
const erro = ref<unknown>(null);
const podeRevisar = computed(() => pode('acesso.emergencia.revisar'));
async function revisar(id: string, c: 'justificado' | 'nao-justificado'): Promise<void> {
  recusa.value = '';
  erro.value = null;
  try {
    await revisarQuebra(id, c);
    await cliente.invalidateQueries({ queryKey: ['adm', 'quebras'] });
  } catch (e) {
    if (e instanceof ErroApi && e.problema && tipoDoProblema(e.problema) === 'recusa-de-negocio')
      recusa.value = e.problema.detail ?? '';
    else erro.value = e;
  }
}
const fmt = (s: string | null) => (s ? s.slice(0, 16).replace('T', ' ') : '—');
</script>

<template>
  <section class="tela" aria-labelledby="quebras-titulo">
    <h1 id="quebras-titulo">{{ t('adm.quebras.titulo') }}</h1>
    <p>{{ t('adm.quebras.texto') }}</p>
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar />
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('adm.comum.carregando') }}</p>
    <template v-else-if="consulta.data.value">
      <p role="status">{{ t('adm.quebras.pendentes', { n: consulta.data.value.pendentes }) }}</p>
      <p v-if="consulta.data.value.itens.length === 0">{{ t('adm.quebras.nenhum') }}</p>
      <table v-else data-testid="tabela-quebras">
        <caption class="oculto">
          {{
            t('adm.quebras.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('adm.quebras.login') }}</th>
            <th scope="col">{{ t('adm.quebras.paciente') }}</th>
            <th scope="col">{{ t('adm.quebras.motivo') }}</th>
            <th scope="col">{{ t('adm.quebras.periodo') }}</th>
            <th scope="col">{{ t('adm.quebras.revisao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="q in consulta.data.value.itens" :key="q.id">
            <th scope="row">{{ q.login }}</th>
            <td>{{ q.prontuario ?? '—' }}</td>
            <td>{{ q.motivo ?? '—' }}</td>
            <td>{{ fmt(q.inicio) }} — {{ fmt(q.fim) }}</td>
            <td>
              <span v-if="q.revisao">{{
                t('adm.quebras.revisado', {
                  classe:
                    q.revisao.classificacao === 'justificado'
                      ? t('adm.quebras.justificado')
                      : t('adm.quebras.naoJustificado'),
                  por: q.revisao.por,
                })
              }}</span>
              <span v-else-if="podeRevisar" class="botoes">
                <SanteBotao
                  :rotulo="t('adm.quebras.justificado')"
                  variante="secundario"
                  :data-testid="`justificar-${q.id}`"
                  @acionar="revisar(q.id, 'justificado')"
                />
                <SanteBotao
                  :rotulo="t('adm.quebras.naoJustificado')"
                  variante="texto"
                  @acionar="revisar(q.id, 'nao-justificado')"
                />
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.botoes {
  display: inline-flex;
  gap: var(--sgh-espaco-1);
}
.oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
