<script setup lang="ts">
// Campos do plantão (M52.2): dia e hora do início, duração, tipo, tempo de chegada do sobreaviso e o motivo (na escala
// publicada). A tela calcula o fim pela duração (o noturno termina no dia seguinte); o servidor confere as regras.
import { CODIGOS_TIPO_PLANTAO, TIPOS_PLANTAO, type TipoPlantao } from '@sgh/contratos';
import { SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

export interface CamposPlantaoValor {
  dia: string | null;
  hora: string;
  duracaoMin: number;
  tipo: TipoPlantao;
  chegada: string;
  motivo: string;
}

defineProps<{ publicada: boolean; prefixo: string }>();
const v = defineModel<CamposPlantaoValor>({ required: true });
const { t } = useI18n();
const p2 = (x: number) => String(x).padStart(2, '0');
const opcoesHora = Array.from({ length: 48 }, (_, i) => {
  const h = `${p2(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`;
  return { valor: h, rotulo: h };
});
const opcoesDuracao = computed(() =>
  Array.from({ length: 24 }, (_, i) => ({
    valor: (i + 1) * 60,
    rotulo: t('pessoas.plantao.duracaoHoras', { n: i + 1 }),
  })),
);
const opcoesTipo = CODIGOS_TIPO_PLANTAO.map((c) => ({ valor: c, rotulo: TIPOS_PLANTAO[c] }));
</script>

<template>
  <div class="campos">
    <SanteData v-model="v.dia" :rotulo="t('pessoas.plantao.dia')" editavel :data-testid="`${prefixo}-dia`" />
    <SanteSelecao
      v-model="v.hora"
      :rotulo="t('pessoas.plantao.hora')"
      :opcoes="opcoesHora"
      :data-testid="`${prefixo}-hora`"
    />
    <SanteSelecao
      v-model="v.duracaoMin"
      :rotulo="t('pessoas.plantao.duracao')"
      :opcoes="opcoesDuracao"
      :data-testid="`${prefixo}-duracao`"
    />
    <SanteSelecao
      v-model="v.tipo"
      :rotulo="t('pessoas.plantao.tipo')"
      :opcoes="opcoesTipo"
      :data-testid="`${prefixo}-tipo`"
    />
    <SanteCampoTexto
      v-if="v.tipo === 'sobreaviso'"
      v-model="v.chegada"
      :rotulo="t('pessoas.plantao.chegada')"
      :max-bytes="3"
      obrigatorio
      :data-testid="`${prefixo}-chegada`"
    />
  </div>
  <template v-if="publicada">
    <p class="secundario">{{ t('pessoas.plantao.motivoPublicada') }}</p>
    <SanteCampoTexto
      v-model="v.motivo"
      :rotulo="t('pessoas.plantao.motivo')"
      :max-bytes="400"
      multilinha
      obrigatorio
      :data-testid="`${prefixo}-motivo`"
    />
  </template>
</template>

<style scoped src="../estilo-pessoas.css"></style>
