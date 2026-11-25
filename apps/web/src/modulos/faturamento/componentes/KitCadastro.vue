<script setup lang="ts">
// Cadastro do kit de cobrança (F3.7, 06-FAT linha 16), aberto na própria tela de movimentos da conta: o kit nasce para a
// fonte pagadora da conta (ou para todas), com os itens escolhidos por código ou descrição. A regra do domínio
// (validarDefinicaoKit, a mesma da API) mostra o que falta enquanto se preenche; o servidor confere de novo.
import { validarDefinicaoKit } from '@sgh/dominio-faturamento';
import { SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarItensCobranca, cadastrarKit } from '../api-movimentos.js';

const props = defineProps<{ fontePagadoraId: number | null; fonte: string }>();
const emit = defineEmits<{ gravado: [codigo: string]; erro: [e: unknown] }>();
const { t } = useI18n();

const kit = reactive({
  codigo: '',
  descricao: '',
  modo: 'aberto' as 'aberto' | 'fechado',
  itemId: 0,
  gatilhoId: 0,
  daFonte: true,
});
const componentes = ref<{ itemId: number; quantidade: number }[]>([]);
const busca = ref('');
const achados = ref<{ id: number; codigo: string; descricao: string }[]>([]);
const gravando = ref(false);

async function buscar() {
  if (busca.value.trim().length < 2) return;
  try {
    const r = await buscarItensCobranca(busca.value.trim());
    const ja = new Set(achados.value.map((i) => i.id));
    achados.value = [...achados.value, ...r.filter((i) => !ja.has(i.id))];
  } catch (e) {
    emit('erro', e);
  }
}
const opcoesItem = computed(() =>
  achados.value.map((i) => ({ valor: i.id, rotulo: `${i.codigo} · ${i.descricao}` })),
);
const erros = computed(() =>
  validarDefinicaoKit({
    codigo: kit.codigo,
    descricao: kit.descricao,
    modo: kit.modo,
    item: kit.modo === 'fechado' && kit.itemId > 0 ? kit.itemId : null,
    gatilho: kit.gatilhoId > 0 ? kit.gatilhoId : null,
    componentes: componentes.value.map((c) => ({
      item: c.itemId > 0 ? c.itemId : null,
      equipamento: null,
      quantidade: c.quantidade,
    })),
  }),
);
const valido = computed(() => Object.keys(erros.value).length === 0);

async function salvar() {
  if (!valido.value || gravando.value) return;
  gravando.value = true;
  try {
    await cadastrarKit(
      {
        codigo: kit.codigo.trim(),
        descricao: kit.descricao.trim(),
        tipoKit: 'procedimento',
        modo: kit.modo,
        itemId: kit.modo === 'fechado' ? kit.itemId : null,
        gatilhoItemId: kit.gatilhoId > 0 ? kit.gatilhoId : null,
        fontePagadoraId: kit.daFonte ? props.fontePagadoraId : null,
        planoId: null,
        todosEstabelecimentos: false,
        componentes: componentes.value.map((c) => ({ ...c, inclusoNoPacote: kit.modo === 'fechado' })),
      },
      crypto.randomUUID(),
    );
    emit('gravado', kit.codigo.trim());
    Object.assign(kit, { codigo: '', descricao: '', modo: 'aberto', itemId: 0, gatilhoId: 0, daFonte: true });
    componentes.value = [];
  } catch (e) {
    emit('erro', e);
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <form class="filtros" data-testid="kit-cadastro" @submit.prevent="salvar">
    <h3>{{ t('movimentosConta.novoKit') }}</h3>
    <label>
      {{ t('movimentosConta.kitCodigo') }}
      <input v-model="kit.codigo" maxlength="30" required data-testid="kit-codigo" />
    </label>
    <span v-if="kit.codigo && erros['codigo']" role="alert">{{ erros['codigo'] }}</span>
    <label>
      {{ t('movimentosConta.kitDescricao') }}
      <input v-model="kit.descricao" maxlength="150" required data-testid="kit-descricao" />
    </label>
    <span v-if="kit.descricao && erros['descricao']" role="alert">{{ erros['descricao'] }}</span>
    <SanteSelecao
      v-model="kit.modo"
      :rotulo="t('movimentosConta.kitModo')"
      :opcoes="[
        { valor: 'aberto', rotulo: t('movimentosConta.modo.aberto') },
        { valor: 'fechado', rotulo: t('movimentosConta.modo.fechado') },
      ]"
      data-testid="kit-modo"
    />
    <label>
      <input
        v-model="kit.daFonte"
        type="checkbox"
        :disabled="fontePagadoraId === null"
        data-testid="kit-da-fonte"
      />
      {{ t('movimentosConta.kitDaFonte', { fonte }) }}
    </label>
    <label>
      {{ t('movimentosConta.kitBuscarItem') }}
      <input
        v-model="busca"
        type="search"
        minlength="2"
        data-testid="kit-busca"
        @keydown.enter.prevent="buscar"
      />
    </label>
    <button type="button" data-testid="kit-buscar" @click="buscar">{{ t('movimentosConta.buscar') }}</button>
    <template v-if="kit.modo === 'fechado'">
      <SanteSelecao
        v-model="kit.itemId"
        :rotulo="t('movimentosConta.kitItemCobrado')"
        :opcoes="[
          { valor: 0, rotulo: t('movimentosConta.kitEscolhaItem'), desabilitada: true },
          ...opcoesItem,
        ]"
        obrigatorio
        data-testid="kit-item"
      />
      <span v-if="erros['item']" role="alert" data-testid="kit-erro-item">{{ erros['item'] }}</span>
    </template>
    <SanteSelecao
      v-model="kit.gatilhoId"
      :rotulo="t('movimentosConta.kitGatilho')"
      :opcoes="[{ valor: 0, rotulo: t('movimentosConta.kitSemGatilho') }, ...opcoesItem]"
      data-testid="kit-gatilho"
    />
    <span v-if="erros['gatilho']" role="alert" data-testid="kit-erro-gatilho">{{ erros['gatilho'] }}</span>
    <fieldset v-for="(c, k) in componentes" :key="k" :data-testid="`kit-componente-${k}`">
      <SanteSelecao
        v-model="c.itemId"
        :rotulo="t('movimentosConta.kitComponente')"
        :opcoes="[
          { valor: 0, rotulo: t('movimentosConta.kitEscolhaItem'), desabilitada: true },
          ...opcoesItem,
        ]"
        obrigatorio
        :data-testid="`kit-componente-item-${k}`"
      />
      <label>
        {{ t('movimentosConta.quantidade') }}
        <input
          v-model.number="c.quantidade"
          type="number"
          min="0.0001"
          step="any"
          required
          :data-testid="`kit-componente-qtd-${k}`"
        />
      </label>
      <span
        v-if="erros[`componentes.${k}.item`] || erros[`componentes.${k}.quantidade`]"
        role="alert"
        :data-testid="`kit-erro-componente-${k}`"
      >
        {{ erros[`componentes.${k}.item`] ?? erros[`componentes.${k}.quantidade`] }}
      </span>
      <button type="button" @click="componentes.splice(k, 1)">{{ t('movimentosConta.retirar') }}</button>
    </fieldset>
    <span v-if="erros['componentes']" class="secundario">{{ erros['componentes'] }}</span>
    <button type="button" data-testid="kit-incluir" @click="componentes.push({ itemId: 0, quantidade: 1 })">
      {{ t('movimentosConta.kitIncluirComponente') }}
    </button>
    <button type="submit" :disabled="!valido || gravando" data-testid="kit-salvar">
      {{ t('movimentosConta.kitSalvar') }}
    </button>
  </form>
</template>
