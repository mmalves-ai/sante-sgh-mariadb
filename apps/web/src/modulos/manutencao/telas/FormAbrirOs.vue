<script setup lang="ts">
// Abertura da ordem de serviço (M55, etapa 1; `manutencao.os.abrir`, qualquer pessoa, para o seu setor): corretiva com o
// equipamento (pela lista com busca ou já escolhido pelo QR da etiqueta) ou predial com o local, a descrição sem dado
// de paciente, a urgência percebida e o equipamento parado. A tela confere pelo mesmo esquema do servidor; o resultado
// traz o número, o aviso do crítico parado (quantas pessoas do setor foram avisadas) e as OS já abertas do equipamento.
import {
  esquemaAbrirOs,
  type ApoioManutencao,
  type EquipamentoPeloCodigo,
  type ResultadoManutencao,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { abrirOs, buscarEquipamentos } from '../api-manutencao.js';
import {
  corpoDaAbertura,
  OPCOES,
  problemasDe,
  rascunhoAberturaVazio,
  setoresDaAbertura,
} from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';

const props = defineProps<{ apoio: ApoioManutencao; equipamento?: EquipamentoPeloCodigo | null }>();
const emit = defineEmits<{ aberta: [ResultadoManutencao]; cancelar: [] }>();
const { t } = useI18n();

const setores = computed(() => setoresDaAbertura(props.apoio));
const inicial = props.equipamento ?? null;
const r = ref(
  rascunhoAberturaVazio(
    inicial && setores.value.some((s) => s.valor === inicial.centroCusto)
      ? inicial.centroCusto
      : setores.value.length === 1
        ? setores.value[0]!.valor
        : null,
  ),
);
if (inicial) {
  r.value.equipamento = inicial.id;
  r.value.equipamentoParado = inicial.parado;
}

const termo = ref('');
const termoBuscado = ref('');
const equipamentos = useQuery({
  queryKey: computed(() => ['manutencao', 'equipamentos', 'busca', termoBuscado.value]),
  queryFn: () => buscarEquipamentos(termoBuscado.value, null),
});
const opcoesEquipamento = computed(() => {
  const lista = [...(equipamentos.data.value ?? [])];
  if (inicial && !lista.some((e) => e.id === inicial.id)) lista.unshift(inicial);
  return [
    { valor: null as number | null, rotulo: t('manutencao.nenhumSelecionado') },
    ...lista.map((e) => ({
      valor: e.id as number | null,
      rotulo: `${e.codigo} - ${e.nome}${e.setor ? ` (${e.setor.nome})` : ''}`,
    })),
  ];
});
const escolhido = computed(() =>
  r.value.equipamento === null
    ? null
    : ((equipamentos.data.value ?? []).find((e) => e.id === r.value.equipamento) ??
      (inicial?.id === r.value.equipamento ? inicial : null)),
);
watch(escolhido, (e) => {
  if (e && r.value.centroCusto === null && setores.value.some((s) => s.valor === e.centroCusto))
    r.value.centroCusto = e.centroCusto;
});
const opcoesSetor = computed(() => [
  { valor: null as number | null, rotulo: t('manutencao.os.escolherSetor') },
  ...setores.value.map((s) => ({ valor: s.valor as number | null, rotulo: s.rotulo })),
]);

const problemas = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const gravando = ref(false);
async function enviar() {
  erro.value = null;
  const corpo = corpoDaAbertura(r.value);
  problemas.value = problemasDe(esquemaAbrirOs, corpo);
  if (Object.keys(problemas.value).length > 0) return;
  gravando.value = true;
  try {
    emit('aberta', await abrirOs(corpo));
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="tela-manutencao" data-testid="os-form-abrir" @submit.prevent="enviar">
    <SanteOpcoes
      v-model="r.natureza"
      :legenda="t('manutencao.os.campos.natureza')"
      :opcoes="OPCOES.naturezaAbertura"
      data-testid="os-abrir-natureza"
    />
    <div class="campos">
      <SanteCampoTexto
        v-model="termo"
        :rotulo="t('manutencao.buscar')"
        :max-bytes="80"
        data-testid="os-abrir-termo"
        @keydown.enter.prevent="termoBuscado = termo.trim()"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('manutencao.buscar')"
        data-testid="os-abrir-buscar"
        @acionar="termoBuscado = termo.trim()"
      />
      <SanteSelecao
        v-model="r.equipamento"
        class="largo"
        :rotulo="t('manutencao.os.campos.equipamento')"
        :opcoes="opcoesEquipamento"
        busca
        data-testid="os-abrir-equipamento"
      />
    </div>
    <p v-if="problemas['equipamento']" class="vencido" role="alert">{{ problemas['equipamento'] }}</p>
    <SanteAlerta
      v-if="escolhido && escolhido.osAbertas > 0"
      variante="aviso"
      :texto="t('manutencao.os.avisos.duplicada')"
      data-testid="os-abrir-duplicada"
    />
    <div class="campos">
      <SanteSelecao
        v-model="r.centroCusto"
        :rotulo="t('manutencao.os.campos.setor')"
        :opcoes="opcoesSetor"
        busca
        obrigatorio
        data-testid="os-abrir-setor"
      />
      <SanteCampoTexto
        v-model="r.local"
        :rotulo="t('manutencao.os.campos.local')"
        :max-bytes="80"
        data-testid="os-abrir-local"
      />
      <SanteSelecao
        v-model="r.prioridadeSugerida"
        :rotulo="t('manutencao.os.campos.prioridadeSugerida')"
        :opcoes="OPCOES.prioridade"
        data-testid="os-abrir-prioridade"
      />
      <SanteCampoTexto
        v-model="r.contato"
        :rotulo="t('manutencao.os.campos.contato')"
        :max-bytes="30"
        data-testid="os-abrir-contato"
      />
    </div>
    <p v-if="problemas['centroCusto']" class="vencido" role="alert">{{ problemas['centroCusto'] }}</p>
    <p v-if="problemas['local']" class="vencido" role="alert">{{ problemas['local'] }}</p>
    <SanteCampoTexto
      v-model="r.descricao"
      multilinha
      obrigatorio
      :rotulo="t('manutencao.os.campos.descricao')"
      :max-bytes="2000"
      data-testid="os-abrir-descricao"
    />
    <p class="secundario">{{ t('manutencao.os.campos.descricaoAjuda') }}</p>
    <p v-if="problemas['descricao']" class="vencido" role="alert">{{ problemas['descricao'] }}</p>
    <label v-if="r.equipamento !== null">
      <input v-model="r.equipamentoParado" type="checkbox" data-testid="os-abrir-parado" />
      {{ t('manutencao.os.campos.parado') }}
    </label>
    <ErroManutencao v-if="erro" :erro="erro" />
    <div class="acoes">
      <SanteBotao
        tipo="submit"
        :rotulo="t('manutencao.abrir')"
        :desabilitado="gravando || !apoio.gravacao.ligada"
        data-testid="os-abrir-gravar"
      />
      <SanteBotao
        variante="texto"
        :rotulo="t('manutencao.cancelar')"
        data-testid="os-abrir-cancelar"
        @acionar="emit('cancelar')"
      />
    </div>
  </form>
</template>

<style scoped src="./estilo-manutencao.css"></style>
