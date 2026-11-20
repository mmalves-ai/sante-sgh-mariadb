<script setup lang="ts">
// Qualidade e segurança › Segurança do paciente (NSP) › Prazos regulatórios e exportação NOTIVISA (M48, etapa 1;
// ficha, seção 7; regra 3): a fila ordenada pelo prazo que vence primeiro (72 h do óbito, 15º dia útil do mês seguinte
// e 60 dias da análise de causa raiz), com a situação colorida e o tempo que falta; o aviso do feriado móvel que não
// está no cadastro (o prazo conta o dia como útil até o cadastro); e, por notificação, os campos do Notivisa e o
// registro da transcrição. O cartão da página inicial abre esta tela.
import {
  CLASSIFICACOES_OMS,
  GRAUS_DANO,
  SITUACOES_NOTIVISA,
  TIPOS_INCIDENTE,
  TIPOS_PRAZO_REGULATORIO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { lerFilaPrazos, lerNotificacao } from '../api.js';
import ErroQualidade from '../componentes/ErroQualidade.vue';
import PainelNotivisa from '../componentes/PainelNotivisa.vue';
import PrazoChip from '../componentes/PrazoChip.vue';
import { dataHora } from '../regras-qualidade.js';

const { t } = useI18n();
const cliente = useQueryClient();
const fila = useQuery({
  queryKey: ['qualidade', 'nsp', 'prazos'],
  queryFn: lerFilaPrazos,
  refetchInterval: 60_000,
});
const aberta = ref<number | null>(null);
const itemAberto = computed(() => fila.data.value?.itens.find((i) => i.id === aberta.value) ?? null);
// A versão vem do detalhe (a fila não a traz): o painel do Notivisa lê o detalhe ao abrir.
const detalhe = useQuery({
  queryKey: computed(() => ['qualidade', 'nsp', 'notificacao', aberta.value]),
  queryFn: () => lerNotificacao(aberta.value ?? 0),
  enabled: computed(() => aberta.value !== null),
});

const rotulo = {
  tipo: (c: string) => TIPOS_INCIDENTE.find((x) => x.codigo === c)?.rotulo ?? c,
  classificacao: (c: string) => CLASSIFICACOES_OMS.find((x) => x.codigo === c)?.rotulo ?? c,
  dano: (c: string) => GRAUS_DANO.find((x) => x.codigo === c)?.rotulo ?? c,
  notivisa: (c: string) => SITUACOES_NOTIVISA.find((x) => x.codigo === c)?.rotulo ?? c,
  prazo: (c: string) => TIPOS_PRAZO_REGULATORIO.find((x) => x.codigo === c)?.rotulo ?? c,
};
async function mudou(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['qualidade', 'nsp'] });
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="nsp-prazos-titulo" data-testid="tela-nsp-prazos">
    <h1 id="nsp-prazos-titulo">{{ t('qualidade.prazos.titulo') }}</h1>
    <p>
      <RouterLink to="/qualidade/nsp/notificacoes">{{ t('qualidade.lista.titulo') }}</RouterLink>
    </p>
    <ErroQualidade v-if="fila.isError.value" :erro="fila.error.value" />
    <p v-else-if="!fila.data.value" role="status">{{ t('qualidade.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-for="f in fila.data.value.resumo.feriadosAusentes"
        :key="f.data"
        variante="aviso"
        :texto="t('qualidade.prazos.feriadoMovelAusente', { data: dataHora(f.data), nome: f.nome })"
        data-testid="feriado-ausente"
      />
      <p class="contagens" data-testid="prazos-contagens">
        <span class="prazo prazo--vencido"
          >{{ t('qualidade.prazos.situacoes.vencido') }}:
          {{ fila.data.value.resumo.porSituacao.vencido }}</span
        >
        <span class="prazo prazo--venceEmBreve"
          >{{ t('qualidade.prazos.situacoes.venceEmBreve') }}:
          {{ fila.data.value.resumo.porSituacao.venceEmBreve }}</span
        >
        <span class="prazo prazo--noPrazo"
          >{{ t('qualidade.prazos.situacoes.noPrazo') }}:
          {{ fila.data.value.resumo.porSituacao.noPrazo }}</span
        >
      </p>
      <p v-if="fila.data.value.cortada" role="status">{{ t('qualidade.cortada') }}</p>
      <p v-if="fila.data.value.itens.length === 0" data-testid="prazos-nenhum">
        {{ t('qualidade.prazos.nenhum') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-prazos">
        <caption>
          {{
            t('qualidade.prazos.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('qualidade.lista.prazo') }}</th>
            <th scope="col">{{ t('qualidade.lista.protocolo') }}</th>
            <th scope="col">{{ t('qualidade.lista.tipo') }}</th>
            <th scope="col">{{ t('qualidade.lista.classificacao') }}</th>
            <th scope="col">{{ t('qualidade.lista.unidade') }}</th>
            <th scope="col">{{ t('qualidade.lista.notivisa') }}</th>
            <th scope="col">
              <span class="sr">{{ t('qualidade.lista.acoes') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in fila.data.value.itens" :key="i.id" :data-testid="`prazo-linha-${i.protocolo}`">
            <td>
              <PrazoChip :prazo="i.proximoPrazo" />
              <div v-if="i.proximoPrazo" class="secundario">
                {{ rotulo.prazo(i.proximoPrazo.tipo) }} · {{ dataHora(i.proximoPrazo.venceEm) }}
              </div>
            </td>
            <td>
              <RouterLink :to="`/qualidade/nsp/notificacoes/${i.id}`">{{ i.protocolo }}</RouterLink>
              <div class="secundario">{{ dataHora(i.ocorridoEm) }}</div>
            </td>
            <td>{{ rotulo.tipo(i.tipo) }}</td>
            <td>{{ rotulo.classificacao(i.classificacao) }} · {{ rotulo.dano(i.dano) }}</td>
            <td>{{ i.unidade ?? '-' }}</td>
            <td>{{ rotulo.notivisa(i.notivisa) }}</td>
            <td>
              <SanteBotao
                v-if="i.situacao !== 'recebida' && i.situacao !== 'descartada'"
                :rotulo="aberta === i.id ? t('qualidade.prazos.fechar') : t('qualidade.prazos.abrirNotivisa')"
                variante="secundario"
                :data-testid="`prazo-notivisa-${i.protocolo}`"
                @acionar="aberta = aberta === i.id ? null : i.id"
              />
              <span v-else class="secundario">{{ t('qualidade.prazos.aguardaTriagem') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <template v-if="itemAberto">
        <ErroQualidade v-if="detalhe.isError.value" :erro="detalhe.error.value" />
        <p v-else-if="!detalhe.data.value" role="status">{{ t('qualidade.carregando') }}</p>
        <PainelNotivisa
          v-else
          :id="itemAberto.id"
          :key="`${itemAberto.id}-${detalhe.data.value.notificacao.versao}`"
          :protocolo="itemAberto.protocolo"
          :versao="detalhe.data.value.notificacao.versao"
          :agora="fila.data.value.agora"
          :transcrita="detalhe.data.value.notificacao.notivisa === 'transcrita'"
          :pode-exportar="fila.data.value.gravacao.acoes.notivisa"
          @mudou="mudou"
        />
      </template>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style>
@import '../componentes/estilo-qualidade.css';
</style>
<style scoped>
.contagens {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
