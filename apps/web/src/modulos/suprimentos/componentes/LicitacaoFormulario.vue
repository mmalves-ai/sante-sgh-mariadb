<script setup lang="ts">
// O termo de referência do processo (suprimentos.criarLicitacao) e a sua alteração pela versão
// (suprimentos.alterarLicitacao): regime, modalidade, critério, natureza, objeto, justificativa, fundamento da
// contratação direta, peso da técnica, orçamento sigiloso, agente (achado na busca) e os itens. Os itens só mudam no
// termo de referência (antes da pesquisa de preços). A tela confere o que dá antes de enviar (o mesmo Zod da API); o
// servidor confere tudo de novo.
import {
  CRITERIOS_JULGAMENTO,
  esquemaAlterarLicitacao,
  esquemaCriarLicitacao,
  MODALIDADES_LICITACAO,
  NATUREZAS_OBJETO_LICITACAO,
  REGIMES_LICITACAO,
  TETO_ITENS_LICITACAO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarLicitacaoTela,
  criarLicitacaoTela,
  type DetalheLicitacaoTela,
  novaChaveLicitacao,
} from '../api-licitacao.js';
import BuscaUsuarioLicitacao from './BuscaUsuarioLicitacao.vue';
import ErroSuprimentos from './ErroSuprimentos.vue';
import { ehDireta, lerNumero, opcoesDe } from './licitacao-tela.js';

const props = defineProps<{ licitacao?: DetalheLicitacaoTela | null; pode: boolean }>();
const emit = defineEmits<{ gravado: [id: number, mensagem: string]; cancelar: [] }>();
const { t } = useI18n();
const k = (s: string, p?: Record<string, unknown>) => t(`licitacao.formulario.${s}`, p ?? {});
const alterando = computed(() => !!props.licitacao);
const d = props.licitacao ?? null;
const p = d?.processo ?? null;
const itensFixos = computed(() => !!p && p.etapa !== 'planejamento');
const numeroTexto = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : String(n).replace('.', ',');

interface LinhaItem {
  descricao: string;
  unidade: string;
  quantidade: string;
  itemEstoque: string;
}
const f = reactive({
  numero: p?.numero ?? '',
  regime: (p?.regime ?? 'lei-14133') as string,
  modalidade: (p?.modalidade ?? 'pregao-eletronico') as string,
  criterio: (p?.criterio ?? 'menor-preco') as string,
  natureza: (p?.natureza ?? 'bens') as string,
  objeto: p?.objeto ?? '',
  justificativa: p?.justificativa ?? '',
  fundamento: p?.fundamento ?? '',
  pesoTecnica: p?.pesoTecnica === null || p?.pesoTecnica === undefined ? '' : String(p.pesoTecnica),
  sigiloso: p?.sigiloso ?? false,
  agente: p?.agente ?? '',
  itens: (d?.itensDetalhe.length
    ? d.itensDetalhe.map((i) => ({
        descricao: i.descricao,
        unidade: i.unidade,
        quantidade: numeroTexto(i.quantidade),
        itemEstoque: i.itemEstoque === null ? '' : String(i.itemEstoque),
      }))
    : [{ descricao: '', unidade: 'UN', quantidade: '', itemEstoque: '' }]) as LinhaItem[],
});
const regimes = opcoesDe(REGIMES_LICITACAO);
const modalidades = opcoesDe(MODALIDADES_LICITACAO);
const criterios = opcoesDe(CRITERIOS_JULGAMENTO);
const naturezas = opcoesDe(NATUREZAS_OBJETO_LICITACAO);
const direta = computed(() => ehDireta(f.modalidade));
const pedePeso = computed(() => f.criterio === 'tecnica-preco');

function incluirItem(): void {
  if (f.itens.length < TETO_ITENS_LICITACAO)
    f.itens.push({ descricao: '', unidade: 'UN', quantidade: '', itemEstoque: '' });
}
function removerItem(i: number): void {
  if (f.itens.length > 1) f.itens.splice(i, 1);
}

/** O corpo como a API recebe (sem a chave nem a versão). */
const corpoTermo = computed(() => ({
  regime: f.regime,
  modalidade: f.modalidade,
  criterio: f.criterio,
  natureza: f.natureza,
  objeto: f.objeto,
  justificativa: f.justificativa,
  fundamento: direta.value ? f.fundamento.trim() || null : null,
  pesoTecnica: pedePeso.value ? lerNumero(f.pesoTecnica) : null,
  sigiloso: f.sigiloso,
  agente: f.agente,
  centroCusto: p?.centroCusto ?? null,
  itens: f.itens.map((i) => ({
    descricao: i.descricao,
    unidade: i.unidade,
    quantidade: lerNumero(i.quantidade) ?? 0,
    itemEstoque: lerNumero(i.itemEstoque),
  })),
}));

/** Os problemas da conferência do Zod (as mensagens dele), únicas. */
const problemas = computed(() => {
  const r = alterando.value
    ? esquemaAlterarLicitacao.safeParse({ versao: p?.versao ?? 0, ...corpoTermo.value })
    : esquemaCriarLicitacao.safeParse({
        chave: 'previa.da.tela',
        numero: f.numero,
        ...corpoTermo.value,
      });
  return r.success ? [] : [...new Set(r.error.issues.map((x) => x.message))];
});
const erro = ref<unknown>(null);
const enviando = ref(false);
const tentou = ref(false);
let chave = novaChaveLicitacao('criar');

async function gravar(): Promise<void> {
  tentou.value = true;
  if (problemas.value.length || !props.pode) return;
  erro.value = null;
  enviando.value = true;
  try {
    const r = p
      ? await alterarLicitacaoTela(p.id, { versao: p.versao, ...corpoTermo.value })
      : await criarLicitacaoTela({ numero: f.numero, ...corpoTermo.value }, chave);
    chave = novaChaveLicitacao('criar');
    emit('gravado', r.id, r.mensagem);
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <form class="formulario-licitacao" data-testid="lic-formulario" @submit.prevent="gravar">
    <h2>{{ alterando ? k('tituloAlterar') : k('tituloNovo') }}</h2>
    <div class="barra">
      <span class="campo">
        <label for="lic-numero">{{ k('numero') }}</label>
        <input
          id="lic-numero"
          v-model="f.numero"
          maxlength="30"
          :disabled="alterando"
          required
          data-testid="lic-numero"
        />
      </span>
      <SanteSelecao v-model="f.regime" :rotulo="k('regime')" :opcoes="regimes" data-testid="lic-regime" />
      <SanteSelecao
        v-model="f.modalidade"
        :rotulo="k('modalidade')"
        :opcoes="modalidades"
        data-testid="lic-modalidade"
      />
      <SanteSelecao
        v-model="f.criterio"
        :rotulo="k('criterio')"
        :opcoes="criterios"
        data-testid="lic-criterio"
      />
      <SanteSelecao
        v-model="f.natureza"
        :rotulo="k('natureza')"
        :opcoes="naturezas"
        data-testid="lic-natureza"
      />
    </div>
    <span class="campo campo-largo">
      <label for="lic-objeto">{{ k('objeto') }}</label>
      <textarea id="lic-objeto" v-model="f.objeto" maxlength="400" rows="2" data-testid="lic-objeto" />
    </span>
    <span class="campo campo-largo">
      <label for="lic-justificativa">{{ k('justificativa') }}</label>
      <textarea
        id="lic-justificativa"
        v-model="f.justificativa"
        maxlength="2000"
        rows="3"
        data-testid="lic-justificativa"
      />
    </span>
    <div class="barra">
      <span v-if="direta" class="campo">
        <label for="lic-fundamento">{{ k('fundamento') }}</label>
        <input
          id="lic-fundamento"
          v-model="f.fundamento"
          maxlength="200"
          aria-describedby="lic-fundamento-ajuda"
          data-testid="lic-fundamento"
        />
        <small id="lic-fundamento-ajuda" class="secundario">{{ k('fundamentoAjuda') }}</small>
      </span>
      <span v-if="pedePeso" class="campo">
        <label for="lic-peso">{{ k('pesoTecnica') }}</label>
        <input
          id="lic-peso"
          v-model="f.pesoTecnica"
          inputmode="numeric"
          maxlength="2"
          data-testid="lic-peso"
        />
      </span>
      <span class="campo">
        <input id="lic-sigiloso" v-model="f.sigiloso" type="checkbox" data-testid="lic-sigiloso" />
        <label for="lic-sigiloso">{{ k('sigiloso') }}</label>
      </span>
    </div>
    <BuscaUsuarioLicitacao v-model="f.agente" :rotulo="k('agente')" testid="lic-agente" />

    <fieldset class="itens-licitacao" data-testid="lic-itens">
      <legend>{{ k('itens') }}</legend>
      <p v-if="itensFixos" class="secundario">{{ k('itensFixos') }}</p>
      <div v-for="(i, n) in f.itens" :key="n" class="barra" :data-testid="`lic-item-${n + 1}`">
        <strong>{{ k('item', { n: n + 1 }) }}</strong>
        <span class="campo campo-largo">
          <label :for="`lic-item-desc-${n}`">{{ k('descricao') }}</label>
          <input
            :id="`lic-item-desc-${n}`"
            v-model="i.descricao"
            maxlength="400"
            :disabled="itensFixos"
            :data-testid="`lic-item-desc-${n + 1}`"
          />
        </span>
        <span class="campo">
          <label :for="`lic-item-un-${n}`">{{ k('unidade') }}</label>
          <input
            :id="`lic-item-un-${n}`"
            v-model="i.unidade"
            maxlength="10"
            size="6"
            :disabled="itensFixos"
            :data-testid="`lic-item-un-${n + 1}`"
          />
        </span>
        <span class="campo">
          <label :for="`lic-item-qtd-${n}`">{{ k('quantidade') }}</label>
          <input
            :id="`lic-item-qtd-${n}`"
            v-model="i.quantidade"
            inputmode="decimal"
            size="10"
            :disabled="itensFixos"
            :data-testid="`lic-item-qtd-${n + 1}`"
          />
        </span>
        <span class="campo">
          <label :for="`lic-item-est-${n}`">{{ k('itemEstoque') }}</label>
          <input
            :id="`lic-item-est-${n}`"
            v-model="i.itemEstoque"
            inputmode="numeric"
            size="8"
            :disabled="itensFixos"
            :data-testid="`lic-item-est-${n + 1}`"
          />
        </span>
        <SanteBotao
          v-if="!itensFixos && f.itens.length > 1"
          variante="texto"
          :rotulo="k('removerItem', { n: n + 1 })"
          :data-testid="`lic-item-remover-${n + 1}`"
          @acionar="removerItem(n)"
        />
      </div>
      <SanteBotao
        v-if="!itensFixos"
        variante="secundario"
        :rotulo="k('incluirItem')"
        data-testid="lic-item-incluir"
        @acionar="incluirItem"
      />
    </fieldset>

    <SanteAlerta
      v-if="tentou && problemas.length"
      variante="aviso"
      :texto="k('faltam', { campos: problemas.join('; ') })"
      data-testid="lic-faltam"
    />
    <ErroSuprimentos v-if="erro" :erro="erro" />
    <div class="barra">
      <SanteBotao
        tipo="submit"
        :rotulo="k('gravar')"
        :desabilitado="!pode || enviando"
        data-testid="lic-gravar"
      />
      <SanteBotao
        variante="secundario"
        :rotulo="k('cancelar')"
        data-testid="lic-cancelar"
        @acionar="emit('cancelar')"
      />
    </div>
  </form>
</template>
