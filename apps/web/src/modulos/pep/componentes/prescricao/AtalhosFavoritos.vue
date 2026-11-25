<script setup lang="ts">
// Atalhos dos favoritos do prescritor no editor da prescrição (03-PEP L107): os protocolos favoritos aparecem como
// botões que aplicam o protocolo em um clique; a estrela marca o protocolo escolhido no combo. Tirar dos favoritos
// não apaga: o servidor desmarca a linha e a reativa se o protocolo voltar a ser favorito.
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { desmarcarFavorito, listarFavoritos, marcarFavorito } from '../../api-padroes-prescricao.js';

const props = defineProps<{ escolhido: string; rotuloEscolhido: string }>();
const emit = defineEmits<{ aplicar: [protocolo: number] }>();
const { t } = useI18n();
const qc = useQueryClient();
const chave = ['presc', 'favoritos'];
const favoritos = useQuery({ queryKey: chave, queryFn: () => listarFavoritos(), staleTime: 60_000 });
const protocolos = computed(() =>
  (favoritos.data.value ?? []).filter((f) => f.tipo === 'protocolo_prescricao'),
);
const jaFavorito = computed(() => protocolos.value.some((f) => String(f.alvo) === props.escolhido));
const ocupado = ref(false);

async function marcar(): Promise<void> {
  if (!props.escolhido || jaFavorito.value || ocupado.value) return;
  ocupado.value = true;
  try {
    await marcarFavorito({
      tipo: 'protocolo_prescricao',
      alvo: Number(props.escolhido),
      rotulo: props.rotuloEscolhido,
    });
    await qc.invalidateQueries({ queryKey: chave });
  } finally {
    ocupado.value = false;
  }
}
async function desmarcar(id: number): Promise<void> {
  ocupado.value = true;
  try {
    await desmarcarFavorito(id);
    await qc.invalidateQueries({ queryKey: chave });
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <div class="favoritos" data-testid="atalhos-favoritos">
    <SanteBotao
      :rotulo="t('pep.padroes.favoritos.marcar')"
      variante="secundario"
      :desabilitado="!escolhido || jaFavorito || ocupado"
      data-testid="favoritar-protocolo"
      @acionar="marcar"
    />
    <span class="titulo">{{ t('pep.padroes.favoritos.titulo') }}</span>
    <p v-if="!protocolos.length" class="vazio" data-testid="favoritos-vazio">
      {{ t('pep.padroes.favoritos.vazio') }}
    </p>
    <ul v-else class="lista">
      <li v-for="f in protocolos" :key="f.id">
        <SanteBotao
          :rotulo="t('pep.padroes.favoritos.aplicar', { rotulo: f.rotulo })"
          variante="secundario"
          :data-testid="`favorito-${f.alvo}`"
          @acionar="emit('aplicar', f.alvo)"
        />
        <button
          type="button"
          class="tirar"
          :aria-label="t('pep.padroes.favoritos.desmarcar', { rotulo: f.rotulo })"
          :disabled="ocupado"
          :data-testid="`desmarcar-favorito-${f.alvo}`"
          @click="desmarcar(f.id)"
        >
          {{ t('pep.padroes.favoritos.tirar') }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.favoritos {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
  margin-top: var(--sgh-espaco-2);
}
.titulo,
.vazio {
  color: var(--sgh-texto-secundario);
  font-size: var(--sgh-fonte-pequena);
  margin: 0;
}
.lista {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
  list-style: none;
  margin: 0;
  padding: 0;
}
.lista li {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
}
.tirar {
  min-width: var(--sgh-alvo-minimo);
  min-height: var(--sgh-alvo-minimo);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
