<script setup lang="ts">
// W0-08: correção da abertura da ordem de serviço enquanto ninguém a assumiu (descrição, urgência, setor, equipamento e
// local), sempre com o motivo. O servidor recusa (409) depois de assumida; o histórico guarda o motivo e os valores
// anteriores. A tela confere pelo mesmo esquema do servidor.
import { esquemaCorrigirOs, type ApoioManutencao, type OsDetalhe, type PrioridadeOs } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { agirNaOs, buscarEquipamentos } from '../api-manutencao.js';
import { OPCOES, problemasDe, setoresDaAbertura } from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';

const props = defineProps<{ os: OsDetalhe; apoio: ApoioManutencao }>();
const emit = defineEmits<{ corrigida: [string]; cancelar: [] }>();
const { t } = useI18n();

const r = ref({
  equipamento: props.os.equipamento?.id ?? (null as number | null),
  centroCusto: Number(props.os.setor.codigo) as number | null,
  local: props.os.local ?? '',
  descricao: props.os.descricao,
  prioridadeSugerida: props.os.prioridadeSugerida as PrioridadeOs,
  motivo: '',
});

const termo = ref('');
const termoBuscado = ref('');
const equipamentos = useQuery({
  queryKey: computed(() => ['manutencao', 'equipamentos', 'busca', termoBuscado.value]),
  queryFn: () => buscarEquipamentos(termoBuscado.value, null),
});
const opcoesEquipamento = computed(() => {
  const atual = props.os.equipamento;
  const lista = (equipamentos.data.value ?? []).map((e) => ({
    valor: e.id as number | null,
    rotulo: `${e.codigo} - ${e.nome}${e.setor ? ` (${e.setor.nome})` : ''}`,
  }));
  if (atual && !lista.some((e) => e.valor === atual.id))
    lista.unshift({ valor: atual.id, rotulo: `${atual.codigo} - ${atual.nome}` });
  return [{ valor: null as number | null, rotulo: t('manutencao.nenhumSelecionado') }, ...lista];
});
const opcoesSetor = computed(() => {
  const lista = setoresDaAbertura(props.apoio).map((s) => ({
    valor: s.valor as number | null,
    rotulo: s.rotulo,
  }));
  const atual = Number(props.os.setor.codigo);
  if (!lista.some((s) => s.valor === atual)) lista.unshift({ valor: atual, rotulo: props.os.setor.nome });
  return lista;
});

const problemas = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const gravando = ref(false);
async function enviar() {
  erro.value = null;
  const corpo = {
    versao: props.os.versao,
    equipamento: r.value.equipamento,
    centroCusto: r.value.centroCusto,
    local: r.value.local.trim() === '' ? null : r.value.local.trim(),
    descricao: r.value.descricao.trim(),
    prioridadeSugerida: r.value.prioridadeSugerida,
    motivo: r.value.motivo.trim(),
  };
  problemas.value = problemasDe(esquemaCorrigirOs, { ...corpo, os: props.os.id });
  if (Object.keys(problemas.value).length > 0) return;
  gravando.value = true;
  try {
    const x = await agirNaOs(props.os.id, 'correcao', corpo);
    emit('corrigida', x.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const listaProblemas = computed(() => Object.values(problemas.value));
</script>

<template>
  <form class="tela-manutencao" data-testid="os-form-corrigir" @submit.prevent="enviar">
    <SanteAlerta variante="info" :texto="t('manutencao.os.correcao.ajuda')" />
    <div class="campos">
      <SanteCampoTexto
        v-model="termo"
        :rotulo="t('manutencao.buscar')"
        :max-bytes="80"
        data-testid="os-corrigir-termo"
        @keydown.enter.prevent="termoBuscado = termo.trim()"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('manutencao.buscar')"
        @acionar="termoBuscado = termo.trim()"
      />
      <SanteSelecao
        v-model="r.equipamento"
        class="largo"
        :rotulo="t('manutencao.os.campos.equipamento')"
        :opcoes="opcoesEquipamento"
        busca
        data-testid="os-corrigir-equipamento"
      />
    </div>
    <div class="campos">
      <SanteSelecao
        v-model="r.centroCusto"
        :rotulo="t('manutencao.os.campos.setor')"
        :opcoes="opcoesSetor"
        busca
        obrigatorio
        data-testid="os-corrigir-setor"
      />
      <SanteCampoTexto
        v-model="r.local"
        :rotulo="t('manutencao.os.campos.local')"
        :max-bytes="80"
        data-testid="os-corrigir-local"
      />
      <SanteSelecao
        v-model="r.prioridadeSugerida"
        :rotulo="t('manutencao.os.campos.prioridadeSugerida')"
        :opcoes="OPCOES.prioridade"
        data-testid="os-corrigir-prioridade"
      />
    </div>
    <SanteCampoTexto
      v-model="r.descricao"
      multilinha
      obrigatorio
      :rotulo="t('manutencao.os.campos.descricao')"
      :max-bytes="2000"
      data-testid="os-corrigir-descricao"
    />
    <SanteCampoTexto
      v-model="r.motivo"
      multilinha
      obrigatorio
      :rotulo="t('manutencao.motivo')"
      :max-bytes="400"
      data-testid="os-corrigir-motivo"
    />
    <ul v-if="listaProblemas.length > 0" class="vencido" role="alert">
      <li v-for="p in listaProblemas" :key="p">{{ p }}</li>
    </ul>
    <ErroManutencao v-if="erro" :erro="erro" />
    <div class="acoes">
      <SanteBotao
        tipo="submit"
        :rotulo="t('manutencao.os.correcao.gravar')"
        :desabilitado="gravando || !apoio.gravacao.ligada"
        data-testid="os-corrigir-gravar"
      />
      <SanteBotao
        variante="texto"
        :rotulo="t('manutencao.cancelar')"
        data-testid="os-corrigir-cancelar"
        @acionar="emit('cancelar')"
      />
    </div>
  </form>
</template>

<style scoped src="./estilo-manutencao.css"></style>
