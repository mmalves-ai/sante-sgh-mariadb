<script setup lang="ts">
// A busca num cadastro grande (fornecedores, itens, insumos) pelo nome ou pelo código, e a escolha numa SanteSelecao com
// busca (ADR 0027): o código só chega ao formulário depois de achado no cadastro; o servidor confere de novo.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref, useId } from 'vue';

interface AchadoCodigoNome {
  readonly codigo: number;
  readonly nome: string;
  readonly detalhe?: string;
}

const props = defineProps<{
  rotulo: string;
  rotuloBuscar: string;
  rotuloEscolhido: string;
  rotuloNenhum: string;
  /** O texto da opção vazia (sem ela, a escolha é obrigatória). */
  rotuloVazio?: string;
  testid: string;
  buscar: (termo: string) => Promise<{ itens: readonly AchadoCodigoNome[]; cortada?: boolean }>;
}>();
const valor = defineModel<number | null>({ required: true });
const emit = defineEmits<{ escolhido: [AchadoCodigoNome | null] }>();
const id = useId();
const termo = ref('');
const achados = ref<readonly AchadoCodigoNome[] | null>(null);
const erro = ref(false);

async function procurar(): Promise<void> {
  erro.value = false;
  try {
    const r = await props.buscar(termo.value.trim());
    achados.value = r.itens;
    if (valor.value !== null && !r.itens.some((f) => f.codigo === valor.value)) valor.value = null;
  } catch {
    erro.value = true;
  }
}
const opcoes = computed(() => [
  ...(props.rotuloVazio !== undefined ? [{ valor: null as number | null, rotulo: props.rotuloVazio }] : []),
  ...(achados.value ?? []).map((f) => ({
    valor: f.codigo as number | null,
    rotulo: `${f.codigo} · ${f.nome}${f.detalhe ? ` (${f.detalhe})` : ''}`,
  })),
]);
function mudou(v: number | null): void {
  valor.value = v;
  emit('escolhido', (achados.value ?? []).find((f) => f.codigo === v) ?? null);
}
const tid = (s: string) => `${props.testid}-${s}`;
</script>

<template>
  <span class="campo">
    <label :for="`busca-${id}`">{{ rotulo }}</label>
    <input
      :id="`busca-${id}`"
      v-model="termo"
      type="search"
      maxlength="60"
      :data-testid="tid('termo')"
      @keyup.enter="procurar"
    />
  </span>
  <SanteBotao variante="secundario" :rotulo="rotuloBuscar" :data-testid="tid('buscar')" @acionar="procurar" />
  <SanteSelecao
    v-if="achados && achados.length > 0"
    :model-value="valor"
    :rotulo="rotuloEscolhido"
    :opcoes="opcoes"
    :busca="true"
    :data-testid="testid"
    @update:model-value="mudou"
  />
  <p v-if="achados && achados.length === 0" role="status">{{ rotuloNenhum }}</p>
  <p v-if="erro" role="alert">{{ rotuloNenhum }}</p>
</template>
