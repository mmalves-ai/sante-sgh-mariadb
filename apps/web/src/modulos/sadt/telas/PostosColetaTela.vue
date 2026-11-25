<script setup lang="ts">
// Postos de coleta (F3.5, 05-SADT linha 7): o cadastro próprio do lugar onde a amostra é colhida, com o setor de
// laboratório que recebe e o horário. Uma tela só: o formulário confere na hora o que impede gravar, e a lista mostra
// todos os postos (o inativo fica marcado, nunca some do cadastro). Alterar carrega o posto no formulário.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { lerMotivosPedido } from '../api-pedido.js';
import {
  type CorpoPosto,
  listarPostos,
  type PostoDeColeta,
  problemaDoPosto,
  salvarPosto,
  situarPosto,
  TIPOS_DE_POSTO,
  type TipoDePosto,
} from '../api-posto-coleta.js';
import { novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({ queryKey: ['sadt', 'postos-coleta', 'todos'], queryFn: () => listarPostos(true) });
const apoio = useQuery({ queryKey: ['sadt', 'pedido', 'motivos'], queryFn: lerMotivosPedido });

const vazio = (): CorpoPosto => ({
  id: null,
  versao: null,
  codigo: '',
  descricao: '',
  tipo: 'interno',
  setorLaboratorio: null,
  horarioInicio: null,
  horarioFim: null,
  funcionaFimDeSemana: false,
  telefone: null,
});
const posto = ref<CorpoPosto>(vazio());
const tocado = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

const opcoesTipo = computed(() =>
  TIPOS_DE_POSTO.map((v) => ({ valor: v, rotulo: t(`sadt.pedido.postos.tipos.${v}`) })),
);
const opcoesSetor = computed(() => [
  { valor: '', rotulo: t('sadt.pedido.escolha') },
  ...(apoio.data.value?.setores ?? []).map((s) => ({ valor: String(s.id), rotulo: s.nome })),
]);
const problema = computed(() => problemaDoPosto(posto.value));

function editar(p: PostoDeColeta): void {
  posto.value = {
    id: p.id,
    versao: p.versao,
    codigo: p.codigo,
    descricao: p.descricao,
    tipo: p.tipo,
    setorLaboratorio: p.setorLaboratorio,
    horarioInicio: p.horarioInicio,
    horarioFim: p.horarioFim,
    funcionaFimDeSemana: p.funcionaFimDeSemana,
    telefone: p.telefone,
  };
  tocado.value = true;
  mensagem.value = null;
}
function limpar(): void {
  posto.value = vazio();
  tocado.value = false;
}
async function executar(fn: () => Promise<string>): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = await fn();
    await cliente.invalidateQueries({ queryKey: ['sadt', 'postos-coleta'] });
  } catch (x) {
    erro.value = x;
  }
}
const gravar = () =>
  executar(async () => {
    await salvarPosto(
      {
        ...posto.value,
        horarioInicio: posto.value.horarioInicio || null,
        horarioFim: posto.value.horarioFim || null,
        telefone: posto.value.telefone?.trim() || null,
      },
      novaChave('posto-coleta.salvar'),
    );
    limpar();
    return t('sadt.pedido.postos.salvo');
  });
const situar = (p: PostoDeColeta) =>
  executar(async () => {
    const r = await situarPosto(p.id, !p.ativo, novaChave('posto-coleta.situacao'));
    return t(`sadt.pedido.postos.situado.${r.ativo}`);
  });
</script>

<template>
  <section class="postos" data-testid="postos-coleta">
    <h1>{{ t('sadt.pedido.postos.titulo') }}</h1>
    <p>{{ t('sadt.pedido.postos.ajuda') }}</p>
    <RouterLink to="/sadt/recoletas" data-testid="postos-voltar">{{
      t('sadt.pedido.postos.voltar')
    }}</RouterLink>

    <h2 data-testid="posto-modo">
      {{
        posto.id === null
          ? t('sadt.pedido.postos.novo')
          : t('sadt.pedido.postos.editando', { codigo: posto.codigo })
      }}
    </h2>
    <div class="linha" @input="tocado = true">
      <label>
        {{ t('sadt.pedido.postos.codigo') }}
        <input v-model="posto.codigo" maxlength="30" data-testid="posto-codigo" />
      </label>
      <label>
        {{ t('sadt.pedido.postos.descricao') }}
        <input v-model="posto.descricao" maxlength="150" data-testid="posto-descricao" />
      </label>
      <SanteSelecao
        :model-value="posto.tipo"
        :rotulo="t('sadt.pedido.postos.tipo')"
        :opcoes="opcoesTipo"
        data-testid="posto-tipo"
        @update:model-value="(v: string) => (posto.tipo = v as TipoDePosto)"
      />
      <SanteSelecao
        :model-value="posto.setorLaboratorio === null ? '' : String(posto.setorLaboratorio)"
        :rotulo="t('sadt.pedido.postos.setor')"
        :opcoes="opcoesSetor"
        data-testid="posto-setor"
        @update:model-value="
          (v: string) => ((posto.setorLaboratorio = v ? Number(v) : null), (tocado = true))
        "
      />
      <label>
        {{ t('sadt.pedido.postos.inicio') }}
        <input v-model="posto.horarioInicio" type="time" data-testid="posto-inicio" />
      </label>
      <label>
        {{ t('sadt.pedido.postos.fim') }}
        <input v-model="posto.horarioFim" type="time" data-testid="posto-fim" />
      </label>
      <label>
        <input v-model="posto.funcionaFimDeSemana" type="checkbox" data-testid="posto-fds" />
        {{ t('sadt.pedido.postos.fimDeSemana') }}
      </label>
      <label>
        {{ t('sadt.pedido.postos.telefone') }}
        <input v-model="posto.telefone" maxlength="20" inputmode="tel" />
      </label>
    </div>
    <p v-if="tocado && problema" role="alert" data-testid="posto-problema">
      {{ t(`sadt.pedido.postos.problemas.${problema}`) }}
    </p>
    <div class="linha">
      <SanteBotao
        :rotulo="t('sadt.pedido.postos.salvar')"
        :desabilitado="problema !== null"
        data-testid="posto-salvar"
        @acionar="gravar"
      />
      <SanteBotao :rotulo="t('sadt.pedido.postos.limpar')" data-testid="posto-limpar" @acionar="limpar" />
    </div>
    <p v-if="mensagem" role="status" data-testid="posto-mensagem">{{ mensagem }}</p>
    <ErroSadt v-if="erro" :erro="erro" />
    <ErroSadt v-if="lista.isError.value" :erro="lista.error.value" />

    <p v-if="lista.isSuccess.value && (lista.data.value?.itens ?? []).length === 0">
      {{ t('sadt.pedido.postos.nenhum') }}
    </p>
    <article v-for="p in lista.data.value?.itens ?? []" :key="p.id" :data-testid="`posto-${p.id}`">
      <p>
        <strong>{{ p.codigo }}</strong> · {{ p.descricao }} · {{ t(`sadt.pedido.postos.tipos.${p.tipo}`) }} ·
        {{ p.setorNome }} ·
        {{
          p.horarioInicio && p.horarioFim
            ? t('sadt.pedido.postos.horario', { inicio: p.horarioInicio, fim: p.horarioFim })
            : t('sadt.pedido.postos.semHorario')
        }}
        <span v-if="!p.ativo" :data-testid="`posto-inativo-${p.id}`">
          · {{ t('sadt.pedido.postos.inativo') }}</span
        >
      </p>
      <div class="linha">
        <SanteBotao
          :rotulo="t('sadt.pedido.postos.editar')"
          :data-testid="`posto-editar-${p.id}`"
          @acionar="editar(p)"
        />
        <SanteBotao
          :rotulo="p.ativo ? t('sadt.pedido.postos.inativar') : t('sadt.pedido.postos.reativar')"
          :data-testid="`posto-situar-${p.id}`"
          @acionar="situar(p)"
        />
      </div>
    </article>
  </section>
</template>

<style scoped>
.postos {
  display: grid;
  gap: 0.75rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
</style>
