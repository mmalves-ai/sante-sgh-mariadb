<script setup lang="ts">
// Atalhos dos favoritos do prescritor no editor da prescrição (03-PEP L107): protocolos, kits e itens favoritos
// aparecem como botões que se aplicam em um clique (o protocolo e o kit entram inteiros; o item fica escolhido no
// formulário). A estrela marca o protocolo ou o kit escolhido no combo, ou o último item incluído. Tirar dos favoritos
// não apaga: o servidor desmarca a linha e a reativa se o alvo voltar a ser favorito.
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  desmarcarFavorito,
  type FavoritoPrescritor,
  listarFavoritos,
  marcarFavorito,
} from '../../api-padroes-prescricao.js';

type Tipo = FavoritoPrescritor['tipo'];
withDefaults(
  defineProps<{
    escolhido: string;
    rotuloEscolhido: string;
    kitEscolhido?: string;
    rotuloKit?: string;
    itemEscolhido?: number | null;
    rotuloItem?: string;
  }>(),
  { kitEscolhido: '', rotuloKit: '', itemEscolhido: null, rotuloItem: '' },
);
const emit = defineEmits<{ aplicar: [tipo: Tipo, alvo: number, rotulo: string] }>();
const { t } = useI18n();
const qc = useQueryClient();
const chave = ['presc', 'favoritos'];
const favoritos = useQuery({ queryKey: chave, queryFn: () => listarFavoritos(), staleTime: 60_000 });
const lista = computed(() => favoritos.data.value ?? []);
const ja = (tipo: Tipo, alvo: string | number | null) =>
  alvo !== null && alvo !== '' && lista.value.some((f) => f.tipo === tipo && String(f.alvo) === String(alvo));
const ocupado = ref(false);

async function marcar(tipo: Tipo, alvo: string | number | null, rotulo: string): Promise<void> {
  if (alvo === null || alvo === '' || ja(tipo, alvo) || ocupado.value) return;
  ocupado.value = true;
  try {
    await marcarFavorito({ tipo, alvo: Number(alvo), rotulo });
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
      :desabilitado="!escolhido || ja('protocolo_prescricao', escolhido) || ocupado"
      data-testid="favoritar-protocolo"
      @acionar="marcar('protocolo_prescricao', escolhido, rotuloEscolhido)"
    />
    <SanteBotao
      :rotulo="t('pep.padroes.favoritos.marcarKit')"
      variante="secundario"
      :desabilitado="!kitEscolhido || ja('kit_prescricao', kitEscolhido) || ocupado"
      data-testid="favoritar-kit"
      @acionar="marcar('kit_prescricao', kitEscolhido, rotuloKit)"
    />
    <SanteBotao
      :rotulo="t('pep.padroes.favoritos.marcarItem')"
      variante="secundario"
      :desabilitado="itemEscolhido === null || ja('item_prescritivel', itemEscolhido) || ocupado"
      data-testid="favoritar-item"
      @acionar="marcar('item_prescritivel', itemEscolhido, rotuloItem)"
    />
    <span class="titulo">{{ t('pep.padroes.favoritos.titulo') }}</span>
    <p v-if="!lista.length" class="vazio" data-testid="favoritos-vazio">
      {{ t('pep.padroes.favoritos.vazio') }}
    </p>
    <ul v-else class="lista">
      <li v-for="f in lista" :key="f.id">
        <SanteBotao
          :rotulo="`${t(`pep.padroes.favoritos.tipo.${f.tipo}`)}: ${t('pep.padroes.favoritos.aplicar', { rotulo: f.rotulo })}`"
          variante="secundario"
          :data-testid="
            f.tipo === 'protocolo_prescricao' ? `favorito-${f.alvo}` : `favorito-${f.tipo}-${f.alvo}`
          "
          @acionar="emit('aplicar', f.tipo, f.alvo, f.rotulo)"
        />
        <button
          type="button"
          class="tirar"
          :aria-label="t('pep.padroes.favoritos.desmarcar', { rotulo: f.rotulo })"
          :disabled="ocupado"
          :data-testid="
            f.tipo === 'protocolo_prescricao'
              ? `desmarcar-favorito-${f.alvo}`
              : `desmarcar-favorito-${f.tipo}-${f.alvo}`
          "
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
