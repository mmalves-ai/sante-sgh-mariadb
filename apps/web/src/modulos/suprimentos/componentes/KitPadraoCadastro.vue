<script setup lang="ts">
// Cadastro do kit padrão (F3.6, 05-SUP linha 13): a lista dos kits (ativos e inativos) e, num painel só, a composição
// (insumo e quantidade, com a unidade do estoque do item) e os procedimentos que usam o kit, com o padrão de cada um.
// Validação na hora pelas mesmas regras da API (`conferirKitPadrao`); o botão fica desligado enquanto houver recusa.
// Nada se apaga: tirar um item ou um procedimento marca a saída, e o kit inativo continua na lista.
import {
  conferirKitPadrao,
  type ItemBusca,
  type KitPadraoCadastro,
  type ProcedimentoKitBusca,
  TIPOS_KIT_PADRAO,
  type TipoKitPadrao,
} from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarProcedimentosKit, gravarKitPadrao, listarKitsPadraoCadastro } from '../api-kit-padrao.js';
import { novaChave } from '../api-suprimentos.js';
import BuscaItem from './BuscaItem.vue';
import ErroSuprimentos from './ErroSuprimentos.vue';

const props = defineProps<{ podeEditar: boolean }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Kits padrão (composição por procedimento ou cirurgia)',
      novo: 'Novo kit padrão',
      editar: 'Editar',
      fechar: 'Fechar',
      codigo: 'Código',
      nome: 'Nome',
      tipo: 'Tipo',
      ativo: 'Ativo',
      inativo: 'inativo',
      acima: 'Permite lançar acima da quantidade padrão',
      similar: 'Permite item similar',
      observacao: 'Observação',
      itens: 'Composição',
      item: 'Item',
      unidade: 'Unidade',
      quantidade: 'Quantidade',
      obrigatorio: 'Obrigatório no carrinho',
      substituto: 'Aceita substituto',
      tirar: 'Tirar',
      incluirItem: 'Incluir item',
      procedimentos: 'Procedimentos e cirurgias que usam o kit',
      procedimento: 'Procedimento',
      kits: 'Kits por procedimento',
      padrao: 'Kit padrão do procedimento',
      buscarProc: 'Buscar cirurgia ou procedimento (código ou nome)',
      buscar: 'Buscar',
      cirurgia: 'cirurgia',
      faturavel: 'procedimento',
      gravar: 'Gravar kit',
      nenhum: 'Nenhum kit padrão cadastrado.',
      semPermissao: 'Seu cargo só consulta os kits padrão.',
      tipos: {
        procedimento: 'Procedimento',
        cirurgia: 'Cirurgia',
        rotina: 'Rotina',
        emergencia: 'Emergência',
        caixa_cirurgica: 'Caixa cirúrgica',
      },
    },
  },
});
const cliente = useQueryClient();
const lista = useQuery({
  queryKey: ['suprimentos', 'kits-padrao', 'cadastro'],
  queryFn: listarKitsPadraoCadastro,
});

interface LinhaItem {
  insumo: number;
  nome: string;
  unidade: string;
  quantidade: number;
  obrigatorioRastreavel: boolean;
  permiteSubstituto: boolean;
}
interface LinhaProc {
  procedimentoCirurgico: number | null;
  itemFaturavel: number | null;
  codigo: string;
  nome: string;
  quantidadeKits: number;
  padrao: boolean;
}
interface Formulario {
  kit?: number;
  versao?: number;
  codigo: string;
  nome: string;
  tipo: TipoKitPadrao;
  permiteQuantidadeAcima: boolean;
  permiteSimilar: boolean;
  observacao: string;
  ativo: boolean;
  itens: LinhaItem[];
  procedimentos: LinhaProc[];
}
const form = ref<Formulario | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const termoProc = ref('');
const achadosProc = ref<ProcedimentoKitBusca[]>([]);

function novo(): void {
  form.value = {
    codigo: '',
    nome: '',
    tipo: 'procedimento',
    permiteQuantidadeAcima: false,
    permiteSimilar: false,
    observacao: '',
    ativo: true,
    itens: [],
    procedimentos: [],
  };
  erro.value = null;
  mensagem.value = null;
}
function editar(k: KitPadraoCadastro): void {
  form.value = {
    kit: k.id,
    versao: k.versao,
    codigo: k.codigo,
    nome: k.nome,
    tipo: k.tipo,
    permiteQuantidadeAcima: k.permiteQuantidadeAcima,
    permiteSimilar: k.permiteSimilar,
    observacao: k.observacao ?? '',
    ativo: k.ativo,
    itens: k.itens.map((i) => ({ ...i })),
    procedimentos: k.procedimentos.map((p) => ({ ...p })),
  };
  erro.value = null;
  mensagem.value = null;
}
function incluirItem(i: ItemBusca): void {
  const f = form.value;
  if (!f) return;
  const ja = f.itens.find((x) => x.insumo === i.codigo);
  if (ja) ja.quantidade += 1;
  else
    f.itens.push({
      insumo: i.codigo,
      nome: i.nome,
      unidade: i.unidade,
      quantidade: 1,
      obrigatorioRastreavel: false,
      permiteSubstituto: false,
    });
}
async function buscarProc(): Promise<void> {
  achadosProc.value = await buscarProcedimentosKit(termoProc.value.trim());
}
function incluirProc(p: ProcedimentoKitBusca): void {
  const f = form.value;
  if (!f) return;
  f.procedimentos.push({ ...p, quantidadeKits: 1, padrao: f.procedimentos.length === 0 });
  achadosProc.value = [];
  termoProc.value = '';
}

const recusas = computed(() => (form.value ? conferirKitPadrao(form.value) : []));
const campoComErro = (c: string) =>
  recusas.value.some((r) => (r.campos ?? []).some((x) => x === c || x.startsWith(`${c}.`)));

async function gravar(): Promise<void> {
  const f = form.value;
  if (!f || recusas.value.length > 0) return;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await gravarKitPadrao(
      {
        ...(f.kit !== undefined ? { kit: f.kit, versao: f.versao } : {}),
        codigo: f.codigo.trim(),
        nome: f.nome.trim(),
        tipo: f.tipo,
        permiteQuantidadeAcima: f.permiteQuantidadeAcima,
        permiteSimilar: f.permiteSimilar,
        observacao: f.observacao.trim() || null,
        ativo: f.ativo,
        itens: f.itens.map((i) => ({
          insumo: i.insumo,
          quantidade: Number(i.quantidade),
          obrigatorioRastreavel: i.obrigatorioRastreavel,
          permiteSubstituto: i.permiteSubstituto,
        })),
        procedimentos: f.procedimentos.map((p) => ({
          procedimentoCirurgico: p.procedimentoCirurgico,
          itemFaturavel: p.itemFaturavel,
          quantidadeKits: Number(p.quantidadeKits),
          padrao: p.padrao,
        })),
      },
      novaChave('kit-padrao'),
    );
    mensagem.value = r.mensagem;
    form.value = null;
    await cliente.invalidateQueries({ queryKey: ['suprimentos', 'kits-padrao'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section aria-labelledby="kit-padrao-titulo" data-testid="kit-padrao-cadastro">
    <h2 id="kit-padrao-titulo">{{ t('titulo') }}</h2>
    <p v-if="!props.podeEditar" class="secundario">{{ t('semPermissao') }}</p>
    <SanteBotao
      v-else
      variante="secundario"
      :rotulo="t('novo')"
      data-testid="kit-padrao-novo"
      @acionar="novo()"
    />
    <ErroSuprimentos v-if="lista.error.value" :erro="lista.error.value" />
    <p v-else-if="lista.data.value && lista.data.value.length === 0">{{ t('nenhum') }}</p>
    <ul v-else>
      <li v-for="k in lista.data.value ?? []" :key="k.id" :data-testid="`kit-padrao-${k.codigo}`">
        <strong>{{ k.codigo }}</strong> · {{ k.nome }} · {{ t(`tipos.${k.tipo}`) }}
        <span v-if="!k.ativo" class="secundario"> · {{ t('inativo') }}</span
        >:
        {{ k.itens.map((i) => `${i.nome} (${i.quantidade} ${i.unidade})`).join(', ') }}
        <template v-if="k.procedimentos.length">
          · {{ k.procedimentos.map((p) => `${p.codigo}${p.padrao ? ' ★' : ''}`).join(', ') }}
        </template>
        <SanteBotao
          v-if="props.podeEditar"
          variante="secundario"
          :rotulo="t('editar')"
          :data-testid="`kit-padrao-editar-${k.codigo}`"
          @acionar="editar(k)"
        />
      </li>
    </ul>
    <p v-if="mensagem" role="status" data-testid="kit-padrao-mensagem">{{ mensagem }}</p>

    <form v-if="form" class="painel" data-testid="kit-padrao-form" @submit.prevent="gravar()">
      <span class="campo">
        <label for="kp-codigo">{{ t('codigo') }}</label>
        <input
          id="kp-codigo"
          v-model="form.codigo"
          maxlength="30"
          :aria-invalid="campoComErro('codigo')"
          data-testid="kit-padrao-codigo"
        />
      </span>
      <span class="campo">
        <label for="kp-nome">{{ t('nome') }}</label>
        <input
          id="kp-nome"
          v-model="form.nome"
          maxlength="150"
          :aria-invalid="campoComErro('nome')"
          data-testid="kit-padrao-nome"
        />
      </span>
      <span class="campo">
        <label for="kp-tipo">{{ t('tipo') }}</label>
        <select id="kp-tipo" v-model="form.tipo" data-testid="kit-padrao-tipo">
          <option v-for="x in TIPOS_KIT_PADRAO" :key="x" :value="x">{{ t(`tipos.${x}`) }}</option>
        </select>
      </span>
      <span class="campo">
        <input id="kp-ativo" v-model="form.ativo" type="checkbox" data-testid="kit-padrao-ativo" />
        <label for="kp-ativo">{{ t('ativo') }}</label>
      </span>
      <span class="campo">
        <input id="kp-acima" v-model="form.permiteQuantidadeAcima" type="checkbox" />
        <label for="kp-acima">{{ t('acima') }}</label>
      </span>
      <span class="campo">
        <input id="kp-similar" v-model="form.permiteSimilar" type="checkbox" />
        <label for="kp-similar">{{ t('similar') }}</label>
      </span>
      <span class="campo">
        <label for="kp-obs">{{ t('observacao') }}</label>
        <input id="kp-obs" v-model="form.observacao" maxlength="2000" />
      </span>

      <table class="tabela">
        <caption>
          {{
            t('itens')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('item') }}</th>
            <th scope="col">{{ t('quantidade') }}</th>
            <th scope="col">{{ t('unidade') }}</th>
            <th scope="col">{{ t('obrigatorio') }}</th>
            <th scope="col">{{ t('substituto') }}</th>
            <th scope="col">
              <span class="sgh-visualmente-oculto">{{ t('tirar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(i, x) in form.itens" :key="i.insumo" :data-testid="`kit-padrao-item-${i.insumo}`">
            <td>{{ i.nome }}</td>
            <td>
              <label :for="`kp-q-${i.insumo}`" class="sgh-visualmente-oculto"
                >{{ t('quantidade') }} {{ i.nome }}</label
              >
              <input
                :id="`kp-q-${i.insumo}`"
                v-model.number="i.quantidade"
                type="number"
                min="0"
                step="any"
                :aria-invalid="campoComErro(`itens.${x}.quantidade`)"
                :data-testid="`kit-padrao-qtd-${i.insumo}`"
              />
            </td>
            <td>{{ i.unidade }}</td>
            <td>
              <label :for="`kp-o-${i.insumo}`" class="sgh-visualmente-oculto"
                >{{ t('obrigatorio') }} {{ i.nome }}</label
              >
              <input :id="`kp-o-${i.insumo}`" v-model="i.obrigatorioRastreavel" type="checkbox" />
            </td>
            <td>
              <label :for="`kp-s-${i.insumo}`" class="sgh-visualmente-oculto"
                >{{ t('substituto') }} {{ i.nome }}</label
              >
              <input :id="`kp-s-${i.insumo}`" v-model="i.permiteSubstituto" type="checkbox" />
            </td>
            <td>
              <SanteBotao
                variante="secundario"
                :rotulo="t('tirar')"
                :data-testid="`kit-padrao-tirar-${i.insumo}`"
                @acionar="form.itens.splice(x, 1)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <BuscaItem :rotulo="t('incluirItem')" testid="kit-padrao-busca" @escolher="incluirItem" />

      <table class="tabela">
        <caption>
          {{
            t('procedimentos')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('procedimento') }}</th>
            <th scope="col">{{ t('kits') }}</th>
            <th scope="col">{{ t('padrao') }}</th>
            <th scope="col">
              <span class="sgh-visualmente-oculto">{{ t('tirar') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(p, x) in form.procedimentos" :key="`${p.procedimentoCirurgico}-${p.itemFaturavel}`">
            <td>
              {{ p.codigo }} · {{ p.nome }}
              <span class="secundario"
                >({{ p.procedimentoCirurgico !== null ? t('cirurgia') : t('faturavel') }})</span
              >
            </td>
            <td>
              <label :for="`kp-pq-${x}`" class="sgh-visualmente-oculto">{{ t('kits') }} {{ p.codigo }}</label>
              <input
                :id="`kp-pq-${x}`"
                v-model.number="p.quantidadeKits"
                type="number"
                min="0"
                step="any"
                :aria-invalid="campoComErro(`procedimentos.${x}`)"
              />
            </td>
            <td>
              <label :for="`kp-pp-${x}`" class="sgh-visualmente-oculto"
                >{{ t('padrao') }} {{ p.codigo }}</label
              >
              <input
                :id="`kp-pp-${x}`"
                v-model="p.padrao"
                type="checkbox"
                :data-testid="`kit-padrao-padrao-${x}`"
              />
            </td>
            <td>
              <SanteBotao
                variante="secundario"
                :rotulo="t('tirar')"
                @acionar="form.procedimentos.splice(x, 1)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <span class="campo">
        <label for="kp-proc">{{ t('buscarProc') }}</label>
        <input id="kp-proc" v-model="termoProc" maxlength="100" data-testid="kit-padrao-proc-termo" />
      </span>
      <SanteBotao
        variante="secundario"
        :rotulo="t('buscar')"
        :desabilitado="termoProc.trim().length < 2"
        data-testid="kit-padrao-proc-buscar"
        @acionar="buscarProc()"
      />
      <ul v-if="achadosProc.length">
        <li v-for="p in achadosProc" :key="`${p.procedimentoCirurgico}-${p.itemFaturavel}`">
          <SanteBotao
            variante="secundario"
            :rotulo="`${p.codigo} · ${p.nome}`"
            :data-testid="`kit-padrao-proc-${p.codigo}`"
            @acionar="incluirProc(p)"
          />
        </li>
      </ul>

      <ul v-if="recusas.length" role="alert" data-testid="kit-padrao-recusas">
        <li v-for="r in recusas" :key="`${r.codigo}-${(r.campos ?? []).join()}`">{{ r.mensagem }}</li>
      </ul>
      <SanteBotao
        tipo="submit"
        :rotulo="t('gravar')"
        :desabilitado="recusas.length > 0"
        data-testid="kit-padrao-gravar"
      />
      <SanteBotao variante="secundario" :rotulo="t('fechar')" @acionar="form = null" />
      <ErroSuprimentos v-if="erro" :erro="erro" />
    </form>
  </section>
</template>
