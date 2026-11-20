<script setup lang="ts">
// Cadastro e alteração do equipamento (M55, etapa 1; `manutencao.equipamento.editar`): código da etiqueta, tipo,
// criticidade (a crítica gera o alerta quando para), classe de risco (só o médico-hospitalar), fabricante, modelo,
// série, registro na Anvisa, unidade, setor e recurso de agenda que ele ocupa (todos por SanteSelecao com busca), bem
// patrimonial, instalação, garantia e situação. A alteração vai com a versão lida; desativar pede o motivo.
import {
  esquemaAlterarEquipamento,
  esquemaCadastrarEquipamento,
  type ApoioManutencao,
  type EquipamentoDetalhe,
  type ResultadoManutencao,
  type TipoRecursoAgenda,
} from '@sgh/contratos';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { alterarEquipamento, buscarBens, cadastrarEquipamento, lerRecursos } from '../api-manutencao.js';
import {
  comTodos,
  corpoDoEquipamento,
  OPCOES,
  problemasDe,
  rascunhoDoEquipamento,
  rascunhoEquipamentoVazio,
} from '../comum-manutencao.js';
import ErroManutencao from './ErroManutencao.vue';

const props = defineProps<{ apoio: ApoioManutencao; equipamento?: EquipamentoDetalhe | null }>();
const emit = defineEmits<{ gravado: [ResultadoManutencao]; cancelar: [] }>();
const { t } = useI18n();

const atual = props.equipamento ?? null;
const r = ref(atual ? rascunhoDoEquipamento(atual) : rascunhoEquipamentoVazio());
watch(
  () => r.value.recursoTipo,
  (novo, antigo) => {
    if (antigo !== undefined && novo !== antigo) r.value.recursoId = null;
  },
);
watch(
  () => r.value.tipo,
  (tipo) => {
    if (tipo !== 'medico') r.value.classeRisco = null;
  },
);

const vazio = computed(() => t('manutencao.nenhumSelecionado'));
const opcoesSetor = computed(() =>
  comTodos(
    vazio.value,
    props.apoio.setores
      .filter((s) => s.ativo || s.codigo === r.value.centroCusto)
      .map((s) => ({ valor: s.codigo, rotulo: `${s.nome} (${s.codigo})` })),
  ),
);
const opcoesUnidade = computed(() =>
  comTodos(
    vazio.value,
    props.apoio.unidades.map((u) => ({ valor: u.codigo, rotulo: u.nome })),
  ),
);
const opcoesRecursoTipo = computed(() =>
  comTodos(t('manutencao.equipamentos.semRecurso'), OPCOES.recursoTipo),
);
const recursos = useQuery({
  queryKey: computed(() => ['manutencao', 'recursos', r.value.recursoTipo]),
  queryFn: () => lerRecursos(r.value.recursoTipo as TipoRecursoAgenda),
  enabled: computed(() => r.value.recursoTipo !== null),
});
const opcoesRecurso = computed(() =>
  comTodos(
    vazio.value,
    (recursos.data.value ?? [])
      .filter((x) => x.ativo || x.id === r.value.recursoId)
      .map((x) => ({ valor: x.id, rotulo: x.nome })),
  ),
);
const opcoesClasse = computed(() => comTodos(vazio.value, OPCOES.classeRisco));
// O bem patrimonial: busca no patrimônio pela plaqueta ou descrição (o atual vem relido na ficha).
const termoBem = ref('');
const bemBuscado = ref<string | null>(null);
const bens = useQuery({
  queryKey: computed(() => ['manutencao', 'bens', bemBuscado.value]),
  queryFn: () => buscarBens(bemBuscado.value ?? ''),
  enabled: computed(() => bemBuscado.value !== null),
});
const opcoesBem = computed(() => {
  const achados = (bens.data.value ?? []).map((b) => ({
    valor: b.id,
    rotulo: `${b.plaqueta} ${b.descricao}`,
  }));
  const doAtual = atual?.bem;
  if (doAtual && !achados.some((o) => o.valor === doAtual.id))
    achados.unshift({ valor: doAtual.id, rotulo: `${doAtual.plaqueta} ${doAtual.descricao}` });
  return comTodos(vazio.value, achados);
});

const problemas = ref<Record<string, string>>({});
const erro = ref<unknown>(null);
const gravando = ref(false);
async function gravar() {
  erro.value = null;
  const corpo = corpoDoEquipamento(r.value, atual ? { id: atual.id, versao: atual.versao } : undefined);
  problemas.value = problemasDe(atual ? esquemaAlterarEquipamento : esquemaCadastrarEquipamento, corpo);
  if (Object.keys(problemas.value).length > 0) return;
  gravando.value = true;
  try {
    emit('gravado', atual ? await alterarEquipamento(atual.id, corpo) : await cadastrarEquipamento(corpo));
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const listaProblemas = computed(() => Object.values(problemas.value));
</script>

<template>
  <form class="tela-manutencao" data-testid="equipamento-form" @submit.prevent="gravar">
    <div class="campos">
      <SanteCampoTexto
        v-model="r.codigo"
        obrigatorio
        :rotulo="t('manutencao.equipamentos.campos.codigo')"
        :max-bytes="30"
        data-testid="equipamento-codigo"
      />
      <SanteCampoTexto
        v-model="r.nome"
        obrigatorio
        :rotulo="t('manutencao.equipamentos.campos.nome')"
        :max-bytes="80"
        data-testid="equipamento-nome"
      />
      <SanteSelecao
        v-model="r.tipo"
        :rotulo="t('manutencao.equipamentos.campos.tipo')"
        :opcoes="OPCOES.tipo"
        data-testid="equipamento-tipo"
      />
      <SanteSelecao
        v-model="r.criticidade"
        :rotulo="t('manutencao.equipamentos.campos.criticidade')"
        :opcoes="OPCOES.criticidade"
        data-testid="equipamento-criticidade"
      />
      <SanteSelecao
        v-if="r.tipo === 'medico'"
        v-model="r.classeRisco"
        :rotulo="t('manutencao.equipamentos.campos.classeRisco')"
        :opcoes="opcoesClasse"
        data-testid="equipamento-classe"
      />
      <SanteCampoTexto
        v-model="r.fabricante"
        :rotulo="t('manutencao.equipamentos.campos.fabricante')"
        :max-bytes="60"
        data-testid="equipamento-fabricante"
      />
      <SanteCampoTexto
        v-model="r.modelo"
        :rotulo="t('manutencao.equipamentos.campos.modelo')"
        :max-bytes="60"
        data-testid="equipamento-modelo"
      />
      <SanteCampoTexto
        v-model="r.numeroSerie"
        :rotulo="t('manutencao.equipamentos.campos.numeroSerie')"
        :max-bytes="40"
        data-testid="equipamento-serie"
      />
      <SanteCampoTexto
        v-model="r.registroAnvisa"
        :rotulo="t('manutencao.equipamentos.campos.registroAnvisa')"
        :max-bytes="11"
        data-testid="equipamento-anvisa"
      />
      <SanteSelecao
        v-model="r.unidade"
        :rotulo="t('manutencao.equipamentos.campos.unidade')"
        :opcoes="opcoesUnidade"
        busca
        data-testid="equipamento-unidade"
      />
      <SanteSelecao
        v-model="r.centroCusto"
        obrigatorio
        :rotulo="t('manutencao.equipamentos.campos.setor')"
        :opcoes="opcoesSetor"
        busca
        data-testid="equipamento-setor"
      />
      <SanteCampoTexto
        v-model="r.localizacao"
        :rotulo="t('manutencao.equipamentos.campos.localizacao')"
        :max-bytes="80"
        data-testid="equipamento-localizacao"
      />
      <SanteSelecao
        v-model="r.recursoTipo"
        :rotulo="t('manutencao.equipamentos.campos.recursoTipo')"
        :opcoes="opcoesRecursoTipo"
        data-testid="equipamento-recurso-tipo"
      />
      <SanteSelecao
        v-if="r.recursoTipo"
        v-model="r.recursoId"
        :rotulo="t('manutencao.equipamentos.campos.recurso')"
        :opcoes="opcoesRecurso"
        busca
        data-testid="equipamento-recurso"
      />
      <SanteCampoTexto
        v-model="termoBem"
        :rotulo="t('manutencao.equipamentos.buscarBem')"
        :max-bytes="60"
        data-testid="equipamento-bem-termo"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="t('manutencao.buscar')"
        data-testid="equipamento-bem-buscar"
        @acionar="bemBuscado = termoBem.trim()"
      />
      <SanteSelecao
        v-model="r.bemPatrimonial"
        :rotulo="t('manutencao.equipamentos.campos.bemPatrimonial')"
        :opcoes="opcoesBem"
        busca
        data-testid="equipamento-bem"
      />
      <SanteData
        v-model="r.instalacao"
        editavel
        :rotulo="t('manutencao.equipamentos.campos.instalacao')"
        :maximo="apoio.hoje"
        data-testid="equipamento-instalacao"
      />
      <SanteData
        v-model="r.garantiaAte"
        editavel
        :rotulo="t('manutencao.equipamentos.campos.garantiaAte')"
        data-testid="equipamento-garantia"
      />
      <SanteSelecao
        v-if="atual"
        v-model="r.situacao"
        :rotulo="t('manutencao.equipamentos.campos.situacao')"
        :opcoes="OPCOES.situacaoEquipamento"
        data-testid="equipamento-situacao"
      />
    </div>
    <p class="secundario">{{ t('manutencao.equipamentos.semBemPatrimonial') }}</p>
    <SanteCampoTexto
      v-if="atual"
      v-model="r.motivo"
      multilinha
      :obrigatorio="r.situacao === 'desativado'"
      :rotulo="t('manutencao.equipamentos.motivoDesativar')"
      :max-bytes="400"
      data-testid="equipamento-motivo"
    />
    <ul v-if="listaProblemas.length > 0" class="vencido" role="alert" data-testid="equipamento-problemas">
      <li v-for="p in listaProblemas" :key="p">{{ p }}</li>
    </ul>
    <ErroManutencao v-if="erro" :erro="erro" />
    <div class="acoes">
      <SanteBotao
        tipo="submit"
        :rotulo="t('manutencao.gravar')"
        :desabilitado="gravando || !apoio.gravacao.ligada"
        data-testid="equipamento-gravar"
      />
      <SanteBotao variante="texto" :rotulo="t('manutencao.cancelar')" @acionar="emit('cancelar')" />
    </div>
  </form>
</template>

<style scoped src="./estilo-manutencao.css"></style>
