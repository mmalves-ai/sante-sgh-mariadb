<script setup lang="ts">
// W0-04: as competências apuradas da CCIH (IRAS e dispositivos-dia). Fechar congela os indicadores da competência
// (só a terminada, ou no último dia do mês); reabrir é crítica (motivo e senha) e fica no histórico de versões. A
// correção de registro de competência fechada recebe 409 com a oferta da reabertura (CorrecoesCcih).
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import { fecharCompetencia, lerCompetencias, novaChaveCorrecao } from '../../api-correcao.js';
import DialogoCorrecao, { type PedidoCorrecao } from '../../componentes/DialogoCorrecao.vue';
import HistoricoVersoes from '../../componentes/HistoricoVersoes.vue';
import { rotuloCompetencia } from '../regras-ccih.js';
import DialogoReabertura from './DialogoReabertura.vue';
import ErroCcih from './ErroCcih.vue';

const props = defineProps<{ competencia: string }>();
const emit = defineEmits<{ alterado: [texto: string] }>();
const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`qualidade.correcao.${k}`, p ?? {});
const cliente = useQueryClient();

const q = useQuery({ queryKey: ['ccih', 'competencias'], queryFn: lerCompetencias });
const daTela = computed(() => (q.data.value?.itens ?? []).find((c) => c.competencia === props.competencia));
const podeFechar = computed(
  () => (q.data.value?.acoes.fechar ?? false) && daTela.value?.situacao !== 'fechada',
);

const visivel = ref(false);
const pedido = ref<PedidoCorrecao | null>(null);
function fechar(): void {
  const c = props.competencia;
  pedido.value = {
    titulo: T('competencias.fecharTitulo', { c: rotuloCompetencia(c) }),
    texto: T('competencias.fecharTexto'),
    semJustificativa: true,
    critica: false,
    confirmar: T('competencias.confirmarFechar'),
    gravar: () => fecharCompetencia(c, novaChaveCorrecao('fechar')),
  };
  visivel.value = true;
}
async function fechou(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['ccih'] });
  emit('alterado', T('fechada'));
}

const reabrindo = ref(false);
const alvo = ref<string | null>(null);
function reabrir(c: string): void {
  alvo.value = c;
  reabrindo.value = true;
}
</script>

<template>
  <section class="painel-ccih" aria-labelledby="ccih-competencias-titulo" data-testid="competencias-ccih">
    <h2 id="ccih-competencias-titulo">{{ T('competencias.titulo') }}</h2>
    <p class="secundario">{{ T('competencias.explicacao') }}</p>
    <ErroCcih v-if="q.isError.value" :erro="q.error.value" />
    <template v-else-if="q.data.value">
      <SanteBotao
        v-if="podeFechar"
        :rotulo="`${T('competencias.fechar')} ${rotuloCompetencia(competencia)}`"
        variante="secundario"
        data-testid="competencia-fechar"
        @acionar="fechar"
      />
      <p v-if="!q.data.value.itens.length" data-testid="competencias-nenhuma">
        {{ T('competencias.nenhuma') }}
      </p>
      <ul v-else class="lista-ccih" data-testid="lista-competencias">
        <li v-for="c in q.data.value.itens" :key="c.id" :data-testid="`competencia-${c.competencia}`">
          <strong>{{ rotuloCompetencia(c.competencia) }}</strong> ·
          <span :class="['selo', c.situacao === 'fechada' ? 'selo--grave' : '']">{{
            T(`competencias.situacoes.${c.situacao}`)
          }}</span>
          · {{ T('competencias.fechadaPor', { quem: c.fechadaPor, em: dataHora(c.fechadaEm) }) }}
          <div v-if="c.reabertaEm" class="secundario">
            {{
              T('competencias.reabertaPor', {
                quem: c.reabertaPor ?? '',
                em: dataHora(c.reabertaEm),
                motivo: c.motivoReabertura ?? '',
              })
            }}
          </div>
          <SanteBotao
            v-if="q.data.value.acoes.reabrir && c.situacao === 'fechada'"
            :rotulo="T('competencias.reabrir')"
            variante="texto"
            :data-testid="`competencia-reabrir-${c.competencia}`"
            @acionar="reabrir(c.competencia)"
          />
          <HistoricoVersoes registro="competencia" :id="c.id" />
        </li>
      </ul>
    </template>
    <DialogoCorrecao v-model:visivel="visivel" :pedido="pedido" @feito="fechou" />
    <DialogoReabertura v-model:visivel="reabrindo" :competencia="alvo" @feito="(x) => emit('alterado', x)" />
  </section>
</template>
