<script setup lang="ts">
// Plano previsto da pré-internação (C2-048, 04-INT linha 70): procedimentos (um principal, que entra na guia TISS de
// solicitação de internação), materiais e medicamentos (inclusive OPME) e a equipe prevista por função. Tudo numa
// tela: busca, adiciona, confere na hora (repetido, quantidade) e grava a lista inteira com a versão lida. O que sai
// do plano fica guardado no banco; encerrada a pré-internação, o plano é só leitura (histórico).
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  buscarInsumosPlano,
  buscarItensPlano,
  buscarProfissionaisPlano,
  gravarPlanoPre,
  lerApoioPlanoPre,
  lerPlanoDoPaciente,
  VIAS_ACESSO,
} from '../api-pre-internacao-plano.js';
import ErroAdt from './ErroAdt.vue';

const props = defineProps<{ paciente: number; podeGravar: boolean }>();
const emit = defineEmits<{ fechar: [] }>();
const { t } = useI18n();
const cliente = useQueryClient();
const plano = useQuery({
  queryKey: computed(() => ['adt', 'pre-plano', props.paciente]),
  queryFn: () => lerPlanoDoPaciente(props.paciente),
});
const apoio = useQuery({ queryKey: ['adt', 'pre-plano-apoio'], queryFn: lerApoioPlanoPre });

interface Proc {
  item: number;
  rotulo: string;
  quantidade: string;
  principal: boolean;
  viaAcesso: string;
  incluirNaGuia: boolean;
}
interface Mat {
  insumo: number;
  rotulo: string;
  quantidade: string;
  fornecedor: number | null;
  observacao: string;
}
interface Eqp {
  profissional: number;
  nome: string;
  funcao: number;
  funcaoDescricao: string;
}
const procs = ref<Proc[]>([]);
const mats = ref<Mat[]>([]);
const eqp = ref<Eqp[]>([]);
watch(
  () => plano.data.value?.plano,
  (p) => {
    if (!p) return;
    procs.value = p.procedimentos.map((x) => ({
      item: x.item,
      rotulo: `${x.codigo} · ${x.descricao}`,
      quantidade: String(x.quantidade),
      principal: x.principal,
      viaAcesso: x.viaAcesso ?? '',
      incluirNaGuia: x.incluirNaGuia,
    }));
    mats.value = p.materiais.map((x) => ({
      insumo: x.insumo,
      rotulo: `${x.codigo} · ${x.nome}${x.unidade ? ` (${x.unidade})` : ''}`,
      quantidade: String(x.quantidade),
      fornecedor: x.fornecedor,
      observacao: x.observacao ?? '',
    }));
    eqp.value = p.equipe.map((x) => ({ ...x }));
  },
  { immediate: true },
);
const editavel = computed(() => props.podeGravar && !!plano.data.value?.plano?.editavel);

const qtd = (s: string) => Number(s.replace(',', '.'));
const qtdValida = (s: string) => Number.isFinite(qtd(s)) && qtd(s) > 0;
const invalido = computed(
  () => procs.value.some((p) => !qtdValida(p.quantidade)) || mats.value.some((m) => !qtdValida(m.quantidade)),
);

// ── Buscas: termo → combo de resultados → adicionar ──
const termoItem = ref('');
const pedidoItem = ref('');
const itens = useQuery({
  queryKey: computed(() => ['adt', 'pre-plano-itens', pedidoItem.value]),
  queryFn: () => buscarItensPlano(pedidoItem.value),
  enabled: computed(() => pedidoItem.value.length >= 2),
});
const itemEscolhido = ref('');
const termoInsumo = ref('');
const pedidoInsumo = ref('');
const insumos = useQuery({
  queryKey: computed(() => ['adt', 'pre-plano-insumos', pedidoInsumo.value]),
  queryFn: () => buscarInsumosPlano(pedidoInsumo.value),
  enabled: computed(() => pedidoInsumo.value.length >= 2),
});
const insumoEscolhido = ref('');
const termoProf = ref('');
const pedidoProf = ref('');
const profs = useQuery({
  queryKey: computed(() => ['adt', 'pre-plano-profs', pedidoProf.value]),
  queryFn: () => buscarProfissionaisPlano(pedidoProf.value),
  enabled: computed(() => pedidoProf.value.length >= 2),
});
const profEscolhido = ref('');
const funcaoEscolhida = ref('');
const escolha = { valor: '', rotulo: t('adt.escolha') };
const opcoes = computed(() => ({
  itens: [
    escolha,
    ...(itens.data.value ?? []).map((i) => ({ valor: String(i.id), rotulo: `${i.codigo} · ${i.descricao}` })),
  ],
  insumos: [
    escolha,
    ...(insumos.data.value ?? []).map((i) => ({
      valor: String(i.id),
      rotulo: `${i.codigo} · ${i.nome}${i.unidade ? ` (${i.unidade})` : ''}`,
    })),
  ],
  profs: [escolha, ...(profs.data.value ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome }))],
  funcoes: [
    escolha,
    ...(apoio.data.value?.funcoes ?? []).map((f) => ({ valor: String(f.id), rotulo: f.descricao })),
  ],
  vias: ['', ...VIAS_ACESSO].map((v) => ({ valor: v, rotulo: t(`adt.prePlano.vias.${v}`) })),
}));
const aviso = ref<string | null>(null);
function adicionarItem(): void {
  aviso.value = null;
  const id = Number(itemEscolhido.value);
  if (!id) return;
  if (procs.value.some((p) => p.item === id)) {
    aviso.value = t('adt.prePlano.repetido');
    return;
  }
  const rotulo = opcoes.value.itens.find((o) => o.valor === itemEscolhido.value)?.rotulo ?? String(id);
  procs.value.push({
    item: id,
    rotulo,
    quantidade: '1',
    principal: procs.value.length === 0,
    viaAcesso: '',
    incluirNaGuia: true,
  });
  itemEscolhido.value = '';
}
function marcarPrincipal(i: number): void {
  procs.value.forEach((p, j) => {
    p.principal = i === j;
    if (i === j) p.incluirNaGuia = true;
  });
}
function adicionarInsumo(): void {
  aviso.value = null;
  const id = Number(insumoEscolhido.value);
  if (!id) return;
  if (mats.value.some((m) => m.insumo === id)) {
    aviso.value = t('adt.prePlano.repetido');
    return;
  }
  const rotulo = opcoes.value.insumos.find((o) => o.valor === insumoEscolhido.value)?.rotulo ?? String(id);
  mats.value.push({ insumo: id, rotulo, quantidade: '1', fornecedor: null, observacao: '' });
  insumoEscolhido.value = '';
}
function adicionarProf(): void {
  aviso.value = null;
  const p = Number(profEscolhido.value);
  const f = Number(funcaoEscolhida.value);
  if (!p || !f) return;
  if (eqp.value.some((x) => x.profissional === p && x.funcao === f)) {
    aviso.value = t('adt.prePlano.repetido');
    return;
  }
  eqp.value.push({
    profissional: p,
    nome: opcoes.value.profs.find((o) => o.valor === profEscolhido.value)?.rotulo ?? String(p),
    funcao: f,
    funcaoDescricao: opcoes.value.funcoes.find((o) => o.valor === funcaoEscolhida.value)?.rotulo ?? '',
  });
  profEscolhido.value = '';
}

const ocupado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
async function gravar(): Promise<void> {
  const p = plano.data.value?.plano;
  if (!p || invalido.value) return;
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    await gravarPlanoPre(p.preInternacao, {
      versao: p.versao,
      procedimentos: procs.value.map((x) => ({
        item: x.item,
        quantidade: qtd(x.quantidade),
        principal: x.principal,
        viaAcesso: x.viaAcesso || null,
        incluirNaGuia: x.incluirNaGuia,
      })),
      materiais: mats.value.map((x) => ({
        insumo: x.insumo,
        quantidade: qtd(x.quantidade),
        fornecedor: x.fornecedor,
        observacao: x.observacao.trim() || null,
      })),
      equipe: eqp.value.map((x) => ({ profissional: x.profissional, funcao: x.funcao })),
    });
    mensagem.value = t('adt.prePlano.gravado');
    await cliente.invalidateQueries({ queryKey: ['adt', 'pre-plano', props.paciente] });
    await cliente.invalidateQueries({ queryKey: ['adt', 'pre-fila'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="painel" aria-labelledby="pre-plano-titulo" data-testid="pre-plano">
    <ErroAdt v-if="plano.isError.value" :erro="plano.error.value" />
    <p v-else-if="!plano.data.value" role="status">{{ t('adt.carregando') }}</p>
    <p v-else-if="!plano.data.value.plano">{{ t('adt.prePlano.semPendente') }}</p>
    <template v-else>
      <h2 id="pre-plano-titulo">{{ t('adt.prePlano.titulo', { numero: plano.data.value.plano.numero }) }}</h2>
      <SanteAlerta
        v-if="!plano.data.value.plano.editavel"
        variante="info"
        :texto="t('adt.prePlano.historico')"
      />

      <h3>{{ t('adt.prePlano.procedimentos') }}</h3>
      <p v-if="procs.length === 0" class="secundario">{{ t('adt.prePlano.vazio') }}</p>
      <ul v-else class="lista-simples" data-testid="pre-plano-procedimentos">
        <li v-for="(p, i) in procs" :key="p.item" class="acoes" :data-testid="`pre-plano-proc-${p.item}`">
          <span>{{ p.rotulo }}</span>
          <SanteCampoTexto
            v-model="p.quantidade"
            :rotulo="t('adt.prePlano.quantidade')"
            :max-bytes="10"
            :data-testid="`pre-plano-proc-qtd-${p.item}`"
          />
          <label
            ><input
              type="radio"
              name="pre-plano-principal"
              :checked="p.principal"
              :disabled="!editavel"
              :data-testid="`pre-plano-principal-${p.item}`"
              @change="marcarPrincipal(i)"
            />
            {{ t('adt.prePlano.principal') }}</label
          >
          <label
            ><input v-model="p.incluirNaGuia" type="checkbox" :disabled="!editavel || p.principal" />
            {{ t('adt.prePlano.naGuia') }}</label
          >
          <SanteSelecao v-model="p.viaAcesso" :rotulo="t('adt.prePlano.viaAcesso')" :opcoes="opcoes.vias" />
          <SanteBotao
            v-if="editavel"
            variante="texto"
            :rotulo="t('adt.prePlano.remover')"
            :data-testid="`pre-plano-proc-tirar-${p.item}`"
            @acionar="procs.splice(i, 1)"
          />
          <span v-if="!qtdValida(p.quantidade)" role="alert">{{ t('adt.prePlano.quantidadeInvalida') }}</span>
        </li>
      </ul>
      <form v-if="editavel" class="filtros" role="search" @submit.prevent="pedidoItem = termoItem.trim()">
        <SanteCampoTexto
          v-model="termoItem"
          :rotulo="t('adt.prePlano.buscarItem')"
          :max-bytes="60"
          data-testid="pre-plano-termo-item"
        />
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('adt.buscar')"
          data-testid="pre-plano-buscar-item"
        />
        <SanteSelecao
          v-model="itemEscolhido"
          :rotulo="t('adt.prePlano.procedimentos')"
          :opcoes="opcoes.itens"
          data-testid="pre-plano-item"
        />
        <SanteBotao
          :rotulo="t('adt.prePlano.adicionar')"
          data-testid="pre-plano-adicionar-item"
          @acionar="adicionarItem"
        />
      </form>
      <p v-if="editavel" class="secundario">{{ t('adt.prePlano.principalAuto') }}</p>

      <h3>{{ t('adt.prePlano.materiais') }}</h3>
      <p v-if="mats.length === 0" class="secundario">{{ t('adt.prePlano.vazio') }}</p>
      <ul v-else class="lista-simples" data-testid="pre-plano-materiais">
        <li v-for="(m, i) in mats" :key="m.insumo" class="acoes" :data-testid="`pre-plano-mat-${m.insumo}`">
          <span>{{ m.rotulo }}</span>
          <SanteCampoTexto v-model="m.quantidade" :rotulo="t('adt.prePlano.quantidade')" :max-bytes="10" />
          <SanteCampoTexto v-model="m.observacao" :rotulo="t('adt.prePlano.observacao')" :max-bytes="500" />
          <SanteBotao
            v-if="editavel"
            variante="texto"
            :rotulo="t('adt.prePlano.remover')"
            @acionar="mats.splice(i, 1)"
          />
          <span v-if="!qtdValida(m.quantidade)" role="alert">{{ t('adt.prePlano.quantidadeInvalida') }}</span>
        </li>
      </ul>
      <form v-if="editavel" class="filtros" role="search" @submit.prevent="pedidoInsumo = termoInsumo.trim()">
        <SanteCampoTexto
          v-model="termoInsumo"
          :rotulo="t('adt.prePlano.buscarInsumo')"
          :max-bytes="60"
          data-testid="pre-plano-termo-insumo"
        />
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('adt.buscar')"
          data-testid="pre-plano-buscar-insumo"
        />
        <SanteSelecao
          v-model="insumoEscolhido"
          :rotulo="t('adt.prePlano.materiais')"
          :opcoes="opcoes.insumos"
          data-testid="pre-plano-insumo"
        />
        <SanteBotao
          :rotulo="t('adt.prePlano.adicionar')"
          data-testid="pre-plano-adicionar-insumo"
          @acionar="adicionarInsumo"
        />
      </form>

      <h3>{{ t('adt.prePlano.equipe') }}</h3>
      <p v-if="eqp.length === 0" class="secundario">{{ t('adt.prePlano.vazio') }}</p>
      <ul v-else class="lista-simples" data-testid="pre-plano-equipe">
        <li v-for="(x, i) in eqp" :key="`${x.profissional}:${x.funcao}`" class="acoes">
          <span>{{ x.nome }} · {{ x.funcaoDescricao }}</span>
          <SanteBotao
            v-if="editavel"
            variante="texto"
            :rotulo="t('adt.prePlano.remover')"
            @acionar="eqp.splice(i, 1)"
          />
        </li>
      </ul>
      <form v-if="editavel" class="filtros" role="search" @submit.prevent="pedidoProf = termoProf.trim()">
        <SanteCampoTexto
          v-model="termoProf"
          :rotulo="t('adt.prePlano.buscarProfissional')"
          :max-bytes="60"
          data-testid="pre-plano-termo-prof"
        />
        <SanteBotao
          tipo="submit"
          variante="secundario"
          :rotulo="t('adt.buscar')"
          data-testid="pre-plano-buscar-prof"
        />
        <SanteSelecao
          v-model="profEscolhido"
          :rotulo="t('adt.prePlano.equipe')"
          :opcoes="opcoes.profs"
          data-testid="pre-plano-prof"
        />
        <SanteSelecao
          v-model="funcaoEscolhida"
          :rotulo="t('adt.prePlano.funcao')"
          :opcoes="opcoes.funcoes"
          data-testid="pre-plano-funcao"
        />
        <SanteBotao
          :rotulo="t('adt.prePlano.adicionar')"
          data-testid="pre-plano-adicionar-prof"
          @acionar="adicionarProf"
        />
      </form>

      <p v-if="aviso" role="alert" data-testid="pre-plano-aviso">{{ aviso }}</p>
      <p class="acoes">
        <SanteBotao
          v-if="editavel"
          :rotulo="t('adt.prePlano.gravar')"
          :desabilitado="ocupado || invalido"
          data-testid="pre-plano-gravar"
          @acionar="gravar"
        />
        <SanteBotao variante="secundario" :rotulo="t('adt.prePlano.fechar')" @acionar="emit('fechar')" />
      </p>
      <p v-if="mensagem" role="status" data-testid="pre-plano-mensagem">{{ mensagem }}</p>
      <ErroAdt v-if="erro" :erro="erro" />
    </template>
  </section>
</template>
