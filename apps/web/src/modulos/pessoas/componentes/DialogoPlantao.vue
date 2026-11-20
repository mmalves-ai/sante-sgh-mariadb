<script setup lang="ts">
// Diálogo do plantão da grade (M52.2): mostra o plantão e os alertas; quem monta a escala altera o horário, a duração,
// o tipo e o tempo de chegada, ou cancela (nunca apaga). Na escala publicada, as duas ações pedem o motivo (regra 8).
// Trocar o colaborador do plantão é cancelar e incluir (a troca entre colegas tem fluxo próprio).
import type { PlantaoLido, ResultadoEscala } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo } from '@sgh/ui';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { alterarPlantao, cancelarPlantao } from '../api-escala.js';
import { descricaoPlantao, fimDoPlantao, inteiroDe } from '../escala-comum.js';
import CamposPlantao, { type CamposPlantaoValor } from './CamposPlantao.vue';
import ErroPessoas from './ErroPessoas.vue';

const props = defineProps<{
  escala: number;
  plantao: PlantaoLido | null;
  nome: string;
  publicada: boolean;
  podeMontar: boolean;
}>();
const visivel = defineModel<boolean>('visivel', { required: true });
const emit = defineEmits<{ gravado: [r: ResultadoEscala] }>();
const { t } = useI18n();

const campos = ref<CamposPlantaoValor>({
  dia: null,
  hora: '07:00',
  duracaoMin: 720,
  tipo: 'presencial',
  chegada: '',
  motivo: '',
});
const erro = ref<unknown>(null);
const ocupado = ref(false);
watch(
  () => props.plantao,
  (p) => {
    erro.value = null;
    if (!p) return;
    const ini = Date.parse(`${p.inicio}:00Z`);
    const fim = Date.parse(`${p.fim}:00Z`);
    campos.value = {
      dia: p.inicio.slice(0, 10),
      hora: p.inicio.slice(11, 16),
      duracaoMin: Math.round((fim - ini) / 60_000),
      tipo: p.tipo,
      chegada: p.chegadaMin !== null ? String(p.chegadaMin) : '',
      motivo: '',
    };
  },
  { immediate: true },
);

async function executar(fn: () => Promise<ResultadoEscala>): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await fn();
    emit('gravado', r);
    visivel.value = false;
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
const motivo = () => (props.publicada ? campos.value.motivo.trim() || null : null);

function alterar(): void {
  const p = props.plantao;
  const c = campos.value;
  if (!p || !c.dia) return;
  void executar(() =>
    alterarPlantao(props.escala, {
      plantao: p.id,
      versao: p.versao,
      vinculo: p.vinculo,
      tipo: c.tipo,
      inicio: `${c.dia}T${c.hora}`,
      fim: fimDoPlantao(c.dia!, c.hora, c.duracaoMin),
      chegadaMin: c.tipo === 'sobreaviso' ? inteiroDe(c.chegada) : null,
      motivo: motivo(),
    }),
  );
}
function cancelar(): void {
  const p = props.plantao;
  if (!p) return;
  void executar(() => cancelarPlantao(props.escala, { plantao: p.id, versao: p.versao, motivo: motivo() }));
}
</script>

<template>
  <SanteDialogo v-model:visivel="visivel" :titulo="t('pessoas.plantao.titulo')" largura="44rem">
    <div v-if="plantao" class="bloco" data-testid="dialogo-plantao">
      <p>
        <strong>{{ nome }}</strong> · {{ descricaoPlantao(plantao) }}
      </p>
      <SanteAlerta
        v-if="plantao.situacao === 'cancelado'"
        :texto="t('pessoas.plantao.situacaoCancelado')"
        variante="info"
      />
      <SanteAlerta
        v-if="plantao.alertaConselho"
        :texto="t('pessoas.grade.alertaConselho')"
        variante="aviso"
      />
      <SanteAlerta v-if="plantao.redeNaoConferida" :texto="t('pessoas.grade.alertaRede')" variante="aviso" />
      <p v-if="plantao.motivo" class="secundario">{{ t('pessoas.motivo') }}: {{ plantao.motivo }}</p>
      <template v-if="podeMontar && plantao.situacao === 'previsto'">
        <CamposPlantao v-model="campos" :publicada="publicada" prefixo="alterar" />
        <ErroPessoas v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('pessoas.plantao.alterar')"
            :desabilitado="ocupado"
            data-testid="alterar-plantao"
            @acionar="alterar"
          />
          <SanteBotao
            :rotulo="t('pessoas.plantao.cancelar')"
            variante="destrutivo"
            :confirmacao="t('pessoas.plantao.confirmarCancelamento')"
            :desabilitado="ocupado"
            data-testid="cancelar-plantao"
            @acionar="cancelar"
          />
        </div>
      </template>
      <div class="acoes">
        <SanteBotao :rotulo="t('pessoas.plantao.fechar')" variante="texto" @acionar="visivel = false" />
      </div>
    </div>
  </SanteDialogo>
</template>

<style scoped src="../estilo-pessoas.css"></style>
