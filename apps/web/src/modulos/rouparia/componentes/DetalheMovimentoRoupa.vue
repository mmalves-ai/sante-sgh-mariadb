<script setup lang="ts">
// Detalhe de um movimento: as peças, a lavanderia, o retorno com o envio e a diferença (a ocorrência para o
// fornecedor), o cancelamento (quem, quando e por quê) e o botão de cancelar dentro do prazo do parâmetro, com o motivo.
import type { PainelRouparia } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { cancelarMovimentoRoupa, lerMovimentoRoupa } from '../api-rouparia.js';
import { dataCurta, fmtKg, fmtNumero, instanteCurto, itensTexto, podeCancelar } from '../regras-rouparia.js';
import { ROTULO_LAVANDERIA, ROTULO_MOTIVO, ROTULO_SITUACAO, ROTULO_TIPO } from '../usar-rouparia.js';
import ErroRouparia from './ErroRouparia.vue';

const props = defineProps<{ id: number; painel: PainelRouparia; pode: boolean }>();
const emit = defineEmits<{ fechar: []; cancelado: [mensagem: string] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const detalhe = useQuery({
  queryKey: computed(() => ['rouparia', 'movimento', props.id]),
  queryFn: () => lerMovimentoRoupa(props.id),
});
const m = computed(() => detalhe.data.value?.movimento ?? null);
const remessa = computed(() => detalhe.data.value?.remessa ?? null);
const nomeSetor = (cc: number | null) =>
  cc === null
    ? t('rouparia.tabela.central')
    : (props.painel.setores.find((s) => s.codigo === cc)?.nome ?? `${cc}`);
const cancelavel = computed(() =>
  m.value ? podeCancelar(m.value, props.painel.agora, props.painel.parametros.cancelamentoHoras) : false,
);

const motivo = ref('');
const erro = ref<unknown>(null);
const avisos = ref<string[]>([]);
const ocupado = ref(false);
async function cancelar(): Promise<void> {
  if (!m.value) return;
  erro.value = null;
  avisos.value = [];
  if (motivo.value.trim().length < 5) {
    avisos.value = ['Explique o motivo do cancelamento.'];
    return;
  }
  ocupado.value = true;
  try {
    const r = await cancelarMovimentoRoupa(m.value.id, {
      versaoVista: m.value.versao,
      motivo: motivo.value.trim(),
    });
    motivo.value = '';
    await cliente.invalidateQueries({ queryKey: ['rouparia'] });
    emit('cancelado', r.mensagem);
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="painel" aria-labelledby="rouparia-detalhe-titulo" data-testid="rouparia-detalhe">
    <h2 id="rouparia-detalhe-titulo">{{ t('rouparia.detalhe.titulo', { id }) }}</h2>
    <ErroRouparia v-if="detalhe.isError.value" :erro="detalhe.error.value" />
    <p v-else-if="!m" role="status">{{ t('rouparia.carregando') }}</p>
    <template v-else>
      <dl class="dados">
        <dt>{{ t('rouparia.tabela.tipo') }}</dt>
        <dd>{{ ROTULO_TIPO[m.tipo] }}</dd>
        <dt>{{ t('rouparia.tabela.quando') }}</dt>
        <dd>{{ dataCurta(m.data) }} · {{ instanteCurto(m.em) }}</dd>
        <dt>{{ t('rouparia.tabela.setor') }}</dt>
        <dd>{{ nomeSetor(m.centroCusto) }}</dd>
        <dt>{{ t('rouparia.tabela.peso') }}</dt>
        <dd>{{ fmtKg(m.pesoKg) }}</dd>
        <dt>{{ t('rouparia.tabela.pecas') }}</dt>
        <dd>{{ m.pecas }} · {{ itensTexto(m.itens, painel.pecas) }}</dd>
        <dt>{{ t('rouparia.tabela.situacao') }}</dt>
        <dd data-testid="rouparia-detalhe-situacao">{{ ROTULO_SITUACAO[m.situacao] }}</dd>
        <dt>{{ t('rouparia.tabela.por') }}</dt>
        <dd>{{ m.por }}</dd>
      </dl>
      <p v-if="m.lavanderia">
        {{ t('rouparia.detalhe.lavanderia', { l: ROTULO_LAVANDERIA[m.lavanderia] }) }}
      </p>
      <p v-if="m.motivoPerda">{{ t('rouparia.detalhe.motivoPerda', { m: ROTULO_MOTIVO[m.motivoPerda] }) }}</p>
      <p v-if="m.observacao">{{ m.observacao }}</p>
      <template v-if="m.tipo === 'retorno' && remessa">
        <p>
          {{
            t('rouparia.detalhe.envio', {
              data: dataCurta(remessa.data),
              peso: fmtKg(remessa.pesoKg),
              pecas: remessa.pecas,
            })
          }}
        </p>
        <p v-if="m.diferencaKg !== null">
          {{
            t('rouparia.detalhe.conferencia', { kg: fmtKg(m.diferencaKg), pct: fmtNumero(m.diferencaPct) })
          }}
        </p>
        <p :class="m.ocorrencia ? 'alerta-texto' : 'secundario'" data-testid="rouparia-detalhe-ocorrencia">
          {{ m.ocorrencia ? t('rouparia.detalhe.comOcorrencia') : t('rouparia.detalhe.semOcorrencia') }}
        </p>
      </template>
      <SanteAlerta
        v-if="m.situacao === 'cancelado'"
        variante="aviso"
        :texto="
          t('rouparia.detalhe.cancelado', {
            por: m.canceladoPor ?? '—',
            em: m.canceladoEm ? instanteCurto(m.canceladoEm) : '—',
            motivo: m.motivoCancelamento ?? '—',
          })
        "
      />
      <template v-else-if="pode">
        <p v-if="m.tipo === 'envio' && m.situacao === 'retornado'" class="secundario">
          {{ t('rouparia.detalhe.envioRetornado') }}
        </p>
        <p v-else-if="!cancelavel" class="secundario">
          {{ t('rouparia.detalhe.foraDoPrazo', { h: painel.parametros.cancelamentoHoras }) }}
        </p>
        <form v-else class="formulario" data-testid="rouparia-cancelar-form" @submit.prevent="cancelar">
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="t('rouparia.campos.motivoCancelamento')"
            :max-bytes="200"
            obrigatorio
          />
          <ErroRouparia :erro="erro" :mensagens="avisos" />
          <SanteBotao
            variante="destrutivo"
            :confirmacao="t('rouparia.detalhe.confirmarCancelar')"
            :rotulo="t('rouparia.detalhe.cancelar')"
            :desabilitado="ocupado"
            data-testid="rouparia-cancelar"
            @acionar="cancelar"
          />
        </form>
      </template>
    </template>
    <SanteBotao variante="texto" :rotulo="t('rouparia.detalhe.fechar')" @click="emit('fechar')" />
  </section>
</template>

<style scoped>
.dados {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
  margin: 0;
}
.dados dt {
  font-weight: 600;
}
.dados dd {
  margin: 0;
}
</style>
