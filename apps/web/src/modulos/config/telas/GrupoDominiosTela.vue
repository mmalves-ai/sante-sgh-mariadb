<script setup lang="ts">
// Tela genérica de um item da árvore com vários cadastros do CRUD genérico (M14; ficha, seção 7): alergias e
// princípios ativos, exames, kits, materiais, setores, resultados e categorias de fornecedor. Mostra os
// domínios do item (os que a pessoa lê) e as consultas dele (históricos e retratos, somente leitura); onde o
// item tem mestre e detalhes (MESTRE_DETALHE), escolher um registro do mestre mostra os detalhes filtrados por
// ele. Nenhuma tela escrita à mão por tabela: tudo sai das declarações.
import {
  ARVORE_MENU,
  MESTRE_DETALHE,
  PERMISSOES_ESPECIALIDADES_CODIGOS,
  SUBITENS_DOMINIOS,
  type ItemDominio,
  type SubitemDominio,
} from '@sgh/contratos';
import { SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarIndiceConsultas } from '../../consultas/api-consultas.js';
import ConsultaTela from '../../consultas/telas/ConsultaTela.vue';
import { buscarIndiceDominios } from '../api-m08.js';
import DominioTela from './DominioTela.vue';

// M24: `embutida` — a tela mora dentro de uma tela própria (cadastros de prescrição): o título vira h2.
const props = defineProps<{ subitem: string; declaracao?: string; embutida?: boolean }>();
// M45 (etapa 6): telas de trabalho ligadas ao item sem item próprio na árvore (o lactário fica no serviço de nutrição e
// dietética), mostradas só a quem tem a permissão da tela.
const ATALHOS: Partial<Record<string, { rota: string; rotulo: string; permissao: string }>> = {
  nutricaoHotelaria: {
    rota: '/nutricao/lactario',
    rotulo: 'especialidades.lactario.titulo',
    permissao: PERMISSOES_ESPECIALIDADES_CODIGOS.lactarioLer,
  },
  // F3.5 (05-SADT linhas 1 a 3): o cadastro completo do exame (faixas, fórmulas, opções) fica na tela do catálogo.
  exames: { rota: '/sadt/catalogo', rotulo: 'sadt.catalogoAtalho', permissao: 'sadt.catalogo.ler' },
};
const atalho = computed(() => {
  const a = ATALHOS[props.subitem];
  return a && pode(a.permissao) ? a : null;
});
const { t, te } = useI18n();
const idItem = computed(() => SUBITENS_DOMINIOS[props.subitem as SubitemDominio] ?? '');
const titulo = computed(() => {
  const k = `dominios.subitens.${props.subitem}`;
  return te(k) ? t(k) : (ARVORE_MENU.find((i) => i.id === idItem.value)?.titulo ?? props.subitem);
});
const dominios = useQuery({ queryKey: ['dominios', 'indice'], queryFn: () => buscarIndiceDominios() });
const consultas = useQuery({
  queryKey: computed(() => ['consultas', 'item', idItem.value]),
  queryFn: () => buscarIndiceConsultas(idItem.value),
});
const md = computed(() => MESTRE_DETALHE[props.subitem as SubitemDominio] ?? null);
const doItem = computed(() =>
  (dominios.data.value?.dominios ?? []).filter((d) => d.subitem === idItem.value),
);
/** Os detalhes do mestre aparecem com ele; o seletor mostra o mestre e os demais domínios do item. */
const opcoes = computed(() => {
  const detalhes = new Set(md.value?.detalhes.map((x) => x.dominio) ?? []);
  return [
    ...doItem.value
      .filter((d) => !detalhes.has(`${d.modulo}.${d.recurso}`))
      .map((d) => ({ tipo: 'dominio' as const, id: `${d.modulo}.${d.recurso}`, rotulo: d.rotulo.plural })),
    ...(consultas.data.value?.consultas ?? []).map((c) => ({
      tipo: 'consulta' as const,
      id: `${c.modulo}.${c.recurso}`,
      rotulo: c.rotulo,
    })),
  ];
});
const opcoesEscolha = computed(() => opcoes.value.map((o) => ({ valor: o.id, rotulo: o.rotulo })));
const escolhida = ref('');
watch(
  opcoes,
  (l) => {
    // Espera o índice dos domínios: com só as consultas carregadas, a primeira consulta tomaria o lugar do mestre.
    if (dominios.isPending.value) return;
    if (l.some((o) => o.id === escolhida.value)) return;
    const pedida = props.declaracao ? l.find((o) => o.id.endsWith(`.${props.declaracao}`)) : undefined;
    const mestre = md.value ? l.find((o) => o.id === md.value?.mestre) : undefined;
    escolhida.value = (pedida ?? mestre ?? l[0])?.id ?? '';
  },
  { immediate: true },
);
const atual = computed(() => opcoes.value.find((o) => o.id === escolhida.value) ?? null);
const partes = (id: string) => {
  const [modulo = '', recurso = ''] = id.split('.');
  return { modulo, recurso };
};
const ehMestre = computed(() => md.value !== null && escolhida.value === md.value.mestre);
const selecionado = ref<ItemDominio | null>(null);
watch(escolhida, () => (selecionado.value = null));
const detalhes = computed(() =>
  ehMestre.value && selecionado.value
    ? (md.value?.detalhes ?? [])
        .filter((x) => doItem.value.some((d) => `${d.modulo}.${d.recurso}` === x.dominio))
        .map((x) => ({
          ...x,
          ...partes(x.dominio),
          valor:
            x.deCampo === 'codigo'
              ? (selecionado.value?.codigo ?? '')
              : String(selecionado.value?.valores[x.deCampo] ?? ''),
        }))
    : [],
);
// Correção do M14: as consultas ligadas ao mestre (histórico de referência do exame, retrato do kit) abrem já
// filtradas pelo registro escolhido.
const valorDoMestre = (deCampo: string) =>
  deCampo === 'codigo'
    ? (selecionado.value?.codigo ?? '')
    : String(selecionado.value?.valores[deCampo] ?? '');
const consultasDoMestre = computed(() =>
  ehMestre.value && selecionado.value
    ? (md.value?.consultas ?? [])
        .filter((x) =>
          (consultas.data.value?.consultas ?? []).some((c) => `${c.modulo}.${c.recurso}` === x.consulta),
        )
        .map((x) => ({
          ...x,
          ...partes(x.consulta),
          filtros: Object.fromEntries(x.filtros.map((f) => [`f.${f.campo}`, valorDoMestre(f.deCampo)])),
        }))
    : [],
);
</script>

<template>
  <section class="tela" aria-labelledby="grupo-titulo" :data-testid="`grupo-dominios-${props.subitem}`">
    <h2 v-if="props.embutida" id="grupo-titulo">{{ titulo }}</h2>
    <h1 v-else id="grupo-titulo">{{ titulo }}</h1>
    <p v-if="atalho" class="atalho">
      <RouterLink :to="atalho.rota" data-testid="grupo-atalho">{{ t(atalho.rotulo) }}</RouterLink>
    </p>
    <MensagemErro v-if="dominios.isError.value" :erro="dominios.error.value" />
    <p v-else-if="dominios.isPending.value">{{ t('dominios.carregando') }}</p>
    <p v-else-if="opcoes.length === 0">{{ t('dominios.nenhum') }}</p>
    <template v-else>
      <div class="campo">
        <SanteSelecao
          id="grupo-escolha"
          v-model="escolhida"
          :rotulo="t('consultas.grupo.escolher')"
          :opcoes="opcoesEscolha"
          data-testid="grupo-escolha"
        />
      </div>
      <template v-if="atual">
        <DominioTela
          v-if="atual.tipo === 'dominio'"
          :key="atual.id"
          :modulo="partes(atual.id).modulo"
          :recurso="partes(atual.id).recurso"
          :selecionavel="ehMestre"
          secundaria
          @selecionar="(i) => (selecionado = i)"
        />
        <ConsultaTela
          v-else
          :key="atual.id"
          :modulo="partes(atual.id).modulo"
          :recurso="partes(atual.id).recurso"
          secundaria
        />
      </template>
      <section
        v-if="detalhes.length || consultasDoMestre.length"
        aria-labelledby="grupo-detalhes"
        data-testid="grupo-detalhes"
      >
        <component :is="props.embutida ? 'h3' : 'h2'" id="grupo-detalhes">
          {{
            t('consultas.grupo.selecionado', { codigo: selecionado?.codigo ?? '', nome: atual?.rotulo ?? '' })
          }}
        </component>
        <DominioTela
          v-for="x in detalhes"
          :key="`${x.dominio}:${x.valor}`"
          :modulo="x.modulo"
          :recurso="x.recurso"
          :referencia="{ campo: x.campo, valor: x.valor }"
          secundaria
        />
        <ConsultaTela
          v-for="x in consultasDoMestre"
          :key="`${x.consulta}:${JSON.stringify(x.filtros)}`"
          :modulo="x.modulo"
          :recurso="x.recurso"
          :filtros-fixos="x.filtros"
          secundaria
        />
      </section>
    </template>
  </section>
</template>

<style scoped>
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
  max-width: 32rem;
  margin: var(--sgh-espaco-2) 0;
}
</style>
