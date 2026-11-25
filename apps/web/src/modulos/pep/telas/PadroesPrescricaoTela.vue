<script setup lang="ts">
// Cadastro editável dos padrões da prescrição (03-PEP L107): protocolos de prescrição, kits de medicamentos e de
// soluções e receitas padrão, com os itens na mesma tela (lista à esquerda, edição ao lado, um clique para abrir).
// A regra do domínio corre a cada tecla (problemasDoProtocolo, problemasDoKit, problemasDaReceitaPadrao): o botão
// Salvar só libera sem problema e o servidor confere de novo. O item vem do catálogo da prescrição por busca; o que
// sai da lista fica retirado no banco (nunca apagado) e a prescrição que já o usou continua ligada.
import {
  ABRANGENCIAS_RECEITA,
  FORMATOS_RECEITA,
  MENSAGENS_CADASTRO_PROTOCOLO,
  PAPEIS_ITEM_KIT,
  problemasDaReceitaPadrao,
  problemasDoKit,
  problemasDoProtocolo,
  SEXOS_PROTOCOLO,
  TIPOS_ITEM_PROTOCOLO,
  TIPOS_KIT,
} from '@sgh/dominio-pep';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarProdutos, lerDominiosPrescricao } from '../api-prescricao.js';
import {
  gravarKitPadrao,
  gravarProtocoloPadrao,
  gravarReceitaPadrao,
  type KitPadrao,
  listarKitsPadrao,
  listarProtocolosPadrao,
  listarReceitasPadrao,
  type ProtocoloPadrao,
  type ReceitaPadrao,
} from '../api-padroes-prescricao.js';

type Secao = 'protocolos' | 'kits' | 'receitas';
const props = defineProps<{ secao: Secao }>();
const { t } = useI18n();
const qc = useQueryClient();

interface ItemForm {
  sequencia: number;
  tipoItem: (typeof TIPOS_ITEM_PROTOCOLO)[number];
  item: number | null;
  itemNome: string;
  descricao: string;
  dose: number | null;
  unidade: string;
  quantidade: number | null;
  papel: (typeof PAPEIS_ITEM_KIT)[number];
  posologia: string;
}
interface Form {
  id: number | null;
  versao: number | null;
  codigo: string;
  nome: string;
  indicacao: string;
  sexo: (typeof SEXOS_PROTOCOLO)[number];
  idadeMin: number | null;
  idadeMax: number | null;
  pesoMin: number | null;
  pesoMax: number | null;
  vigenciaInicio: string;
  vigenciaFim: string;
  todosEstabelecimentos: boolean;
  ativo: boolean;
  tipoKit: (typeof TIPOS_KIT)[number];
  abrangencia: (typeof ABRANGENCIAS_RECEITA)[number];
  especialidade: number | null;
  formato: (typeof FORMATOS_RECEITA)[number];
  texto: string;
  itens: ItemForm[];
}
const hoje = () => new Date().toISOString().slice(0, 10);
const itemVazio = (sequencia: number): ItemForm => ({
  sequencia,
  tipoItem: 'medicamento',
  item: null,
  itemNome: '',
  descricao: '',
  dose: null,
  unidade: '',
  quantidade: null,
  papel: 'componente',
  posologia: '',
});
const vazio = (): Form => ({
  id: null,
  versao: null,
  codigo: '',
  nome: '',
  indicacao: '',
  sexo: 'todos',
  idadeMin: null,
  idadeMax: null,
  pesoMin: null,
  pesoMax: null,
  vigenciaInicio: props.secao === 'receitas' ? hoje() : '',
  vigenciaFim: '',
  todosEstabelecimentos: false,
  ativo: true,
  tipoKit: 'medicamento',
  abrangencia: 'profissional',
  especialidade: null,
  formato: 'estruturada',
  texto: '',
  itens: [itemVazio(1)],
});
const form = reactive<Form>(vazio());
const aberto = ref(false);
const aviso = ref('');
const erro = ref<unknown>(null);

const lista = useQuery({
  queryKey: computed(() => ['presc', 'padroes', props.secao]),
  queryFn: async () => {
    if (props.secao === 'protocolos')
      return (await listarProtocolosPadrao()).map((p) => ({ ...p, rotulo: `${p.codigo} · ${p.nome}` }));
    if (props.secao === 'kits')
      return (await listarKitsPadrao()).map((k) => ({ ...k, rotulo: `${k.codigo} · ${k.nome}` }));
    return (await listarReceitasPadrao()).map((r) => ({ ...r, rotulo: r.nome }));
  },
});
const dominios = useQuery({
  queryKey: ['presc', 'dominios'],
  queryFn: () => lerDominiosPrescricao(),
  staleTime: 300_000,
});
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: '—' },
  ...(dominios.data.value?.['unidades'] ?? []).map((u) => ({ valor: u.id, rotulo: u.nome })),
]);
const opcoes = <T extends string>(valores: readonly T[], grupo: string) =>
  valores.map((v) => ({ valor: v, rotulo: t(`pep.padroes.${grupo}.${v}`) }));

function novo(): void {
  Object.assign(form, vazio());
  aberto.value = true;
  aviso.value = '';
}
type LinhaPadrao = ProtocoloPadrao | KitPadrao | ReceitaPadrao;
const textoOu = (v: unknown): string => (typeof v === 'string' ? v : '');
function abrir(linha: LinhaPadrao): void {
  const campo = (nome: string): unknown => (linha as Readonly<Record<string, unknown>>)[nome];
  const itens: readonly Readonly<Record<string, unknown>>[] = linha.itens;
  Object.assign(form, vazio(), linha, {
    indicacao: textoOu(campo('indicacao')),
    vigenciaInicio: textoOu(campo('vigenciaInicio')),
    vigenciaFim: textoOu(campo('vigenciaFim')),
    texto: textoOu(campo('texto')),
    itens: itens.map((i) => ({
      ...itemVazio(Number(i['sequencia'])),
      ...i,
      itemNome: textoOu(i['itemNome']),
      descricao: textoOu(i['descricao']) || textoOu(i['descricaoLivre']),
      unidade: i['unidade'] === null || i['unidade'] === undefined ? '' : String(i['unidade']),
      posologia: textoOu(i['posologia']),
    })),
  });
  aberto.value = true;
  aviso.value = '';
}
function incluirItem(): void {
  form.itens.push(itemVazio(Math.max(0, ...form.itens.map((i) => i.sequencia)) + 1));
}
function retirarItem(i: number): void {
  form.itens.splice(i, 1);
}

// Busca do item no catálogo da prescrição (lista sugerida; o nome escolhido vira o id do item).
const sugestoes = ref<{ produto: number; nome: string }[]>([]);
async function digitar(it: ItemForm): Promise<void> {
  it.item = sugestoes.value.find((s) => s.nome === it.itemNome)?.produto ?? null;
  if (it.item !== null || it.itemNome.trim().length < 3) return;
  sugestoes.value = (await buscarProdutos(it.itemNome.trim()).catch(() => [])).map((s) => ({
    produto: s.produto,
    nome: s.nome,
  }));
  it.item = sugestoes.value.find((s) => s.nome === it.itemNome)?.produto ?? null;
}

const nulo = (s: string) => (s.trim() ? s.trim() : null);
const unidade = (s: string) => (s ? Number(s) : null);
const base = computed(() => ({
  ...(form.id ? { id: form.id, versao: form.versao } : {}),
  ativo: form.ativo,
}));
const corpoProtocolo = computed(() => ({
  ...base.value,
  codigo: form.codigo,
  nome: form.nome,
  indicacao: nulo(form.indicacao),
  todosEstabelecimentos: form.todosEstabelecimentos,
  sexo: form.sexo,
  idadeMin: form.idadeMin,
  idadeMax: form.idadeMax,
  pesoMin: form.pesoMin,
  pesoMax: form.pesoMax,
  vigenciaInicio: nulo(form.vigenciaInicio),
  vigenciaFim: nulo(form.vigenciaFim),
  itens: form.itens.map((i) => ({
    sequencia: i.sequencia,
    tipoItem: i.tipoItem,
    item: i.item,
    descricao: nulo(i.descricao),
    dose: i.dose,
    unidade: unidade(i.unidade),
    quantidade: i.quantidade,
  })),
}));
const corpoKit = computed(() => ({
  ...base.value,
  codigo: form.codigo,
  nome: form.nome,
  tipoKit: form.tipoKit,
  itens: form.itens.map((i) => ({
    sequencia: i.sequencia,
    item: i.item,
    papel: i.papel,
    quantidade: i.quantidade ?? 0,
    unidade: unidade(i.unidade),
  })),
}));
const corpoReceita = computed(() => ({
  ...base.value,
  nome: form.nome,
  abrangencia: form.abrangencia,
  especialidade: form.abrangencia === 'especialidade' ? form.especialidade : null,
  formato: form.formato,
  texto: form.formato === 'livre' ? nulo(form.texto) : null,
  vigenciaInicio: form.vigenciaInicio || hoje(),
  vigenciaFim: nulo(form.vigenciaFim),
  itens:
    form.formato === 'estruturada'
      ? form.itens.map((i) => ({
          sequencia: i.sequencia,
          item: i.item,
          descricaoLivre: i.item ? null : nulo(i.descricao),
          dose: i.dose,
          unidade: unidade(i.unidade),
          quantidade: i.quantidade,
          posologia: nulo(i.posologia),
        }))
      : [],
}));

/** Validação na hora, pela mesma regra do servidor. */
const problemas = computed(() => {
  const ps =
    props.secao === 'protocolos'
      ? problemasDoProtocolo(corpoProtocolo.value)
      : props.secao === 'kits'
        ? problemasDoKit({
            ...corpoKit.value,
            doseInicial: null,
            doseFinal: null,
            velocidade: null,
            unidadeInfusao: null,
          })
        : problemasDaReceitaPadrao({
            ...corpoReceita.value,
            // A pessoal é do profissional da sessão (o servidor resolve); aqui só a especialidade é conferida.
            profissional: form.abrangencia === 'profissional' ? 1 : null,
            itens: corpoReceita.value.itens.map((i) => ({ ...i, duracao: null, unidadeDuracao: null })),
          });
  return [...new Set(ps.map((p) => MENSAGENS_CADASTRO_PROTOCOLO[p.codigo] ?? p.codigo))];
});

async function salvar(): Promise<void> {
  if (problemas.value.length) return;
  erro.value = null;
  try {
    const g =
      props.secao === 'protocolos'
        ? await gravarProtocoloPadrao(corpoProtocolo.value)
        : props.secao === 'kits'
          ? await gravarKitPadrao(corpoKit.value)
          : await gravarReceitaPadrao(corpoReceita.value);
    form.id = g.id;
    form.versao = g.versao;
    aviso.value = t('pep.padroes.gravado');
    await qc.invalidateQueries({ queryKey: ['presc', 'padroes', props.secao] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <main class="padroes" :data-testid="`padroes-${secao}`">
    <h1>{{ t(`pep.padroes.titulo.${secao}`) }}</h1>
    <p class="texto">{{ t(`pep.padroes.texto.${secao}`) }}</p>
    <div class="colunas">
      <section class="lista" :aria-label="t('pep.padroes.lista')">
        <SanteBotao :rotulo="t('pep.padroes.novo')" data-testid="padrao-novo" @acionar="novo" />
        <MensagemErro v-if="lista.error.value" :erro="lista.error.value" />
        <p v-else-if="lista.data.value && !lista.data.value.length">{{ t('pep.padroes.nenhum') }}</p>
        <ul>
          <li v-for="l in lista.data.value ?? []" :key="l.id">
            <button type="button" class="linha" :data-testid="`padrao-${l.id}`" @click="abrir(l)">
              <strong>{{ l.rotulo }}</strong>
              <small>
                {{ t('pep.padroes.itens', { n: l.itens.length }) }}
                <template v-if="!l.ativo"> · {{ t('pep.padroes.inativo') }}</template>
              </small>
            </button>
          </li>
        </ul>
      </section>

      <form v-if="aberto" class="edicao" data-testid="padrao-edicao" @submit.prevent="salvar">
        <div class="grade">
          <label v-if="secao !== 'receitas'"
            ><span>{{ t('pep.padroes.codigo') }}</span
            ><input v-model="form.codigo" maxlength="30" data-testid="padrao-codigo"
          /></label>
          <label
            ><span>{{ t('pep.padroes.nome') }}</span
            ><input v-model="form.nome" maxlength="150" data-testid="padrao-nome"
          /></label>
          <template v-if="secao === 'protocolos'">
            <SanteSelecao
              v-model="form.sexo"
              :rotulo="t('pep.padroes.sexo')"
              :opcoes="opcoes(SEXOS_PROTOCOLO, 'sexos')"
              data-testid="padrao-sexo"
            />
            <label
              ><span>{{ t('pep.padroes.idadeMin') }}</span
              ><input v-model.number="form.idadeMin" type="number" min="0" data-testid="padrao-idade-min"
            /></label>
            <label
              ><span>{{ t('pep.padroes.idadeMax') }}</span
              ><input v-model.number="form.idadeMax" type="number" min="0" data-testid="padrao-idade-max"
            /></label>
            <label
              ><span>{{ t('pep.padroes.pesoMin') }}</span
              ><input v-model.number="form.pesoMin" type="number" min="0" step="0.1"
            /></label>
            <label
              ><span>{{ t('pep.padroes.pesoMax') }}</span
              ><input v-model.number="form.pesoMax" type="number" min="0" step="0.1"
            /></label>
            <label class="largo"
              ><span>{{ t('pep.padroes.indicacao') }}</span
              ><textarea v-model="form.indicacao" rows="2" />
            </label>
            <label class="marca"
              ><input v-model="form.todosEstabelecimentos" type="checkbox" />
              <span>{{ t('pep.padroes.todosEstabelecimentos') }}</span></label
            >
          </template>
          <SanteSelecao
            v-if="secao === 'kits'"
            v-model="form.tipoKit"
            :rotulo="t('pep.padroes.tipoKit')"
            :opcoes="opcoes(TIPOS_KIT, 'tiposKit')"
            data-testid="padrao-tipo-kit"
          />
          <template v-if="secao === 'receitas'">
            <SanteSelecao
              v-model="form.abrangencia"
              :rotulo="t('pep.padroes.abrangencia')"
              :opcoes="opcoes(ABRANGENCIAS_RECEITA, 'abrangencias')"
              data-testid="padrao-abrangencia"
            />
            <label v-if="form.abrangencia === 'especialidade'"
              ><span>{{ t('pep.padroes.especialidade') }}</span
              ><input
                v-model.number="form.especialidade"
                type="number"
                min="1"
                data-testid="padrao-especialidade"
            /></label>
            <SanteSelecao
              v-model="form.formato"
              :rotulo="t('pep.padroes.formato')"
              :opcoes="opcoes(FORMATOS_RECEITA, 'formatos')"
              data-testid="padrao-formato"
            />
            <label v-if="form.formato === 'livre'" class="largo"
              ><span>{{ t('pep.padroes.texto_') }}</span
              ><textarea v-model="form.texto" rows="5" data-testid="padrao-texto" />
            </label>
          </template>
          <template v-if="secao !== 'kits'">
            <label
              ><span>{{ t('pep.padroes.vigenciaInicio') }}</span
              ><input v-model="form.vigenciaInicio" type="date" data-testid="padrao-vigencia-inicio"
            /></label>
            <label
              ><span>{{ t('pep.padroes.vigenciaFim') }}</span
              ><input v-model="form.vigenciaFim" type="date" data-testid="padrao-vigencia-fim"
            /></label>
          </template>
          <label class="marca"
            ><input v-model="form.ativo" type="checkbox" data-testid="padrao-ativo" />
            <span>{{ t('pep.padroes.ativo') }}</span></label
          >
        </div>

        <fieldset v-if="secao !== 'receitas' || form.formato === 'estruturada'" class="itens">
          <legend>{{ t('pep.padroes.item.titulo') }}</legend>
          <div
            v-for="(it, i) in form.itens"
            :key="it.sequencia"
            class="item"
            :data-testid="`padrao-item-${i}`"
          >
            <span class="seq">{{ it.sequencia }}</span>
            <SanteSelecao
              v-if="secao === 'protocolos'"
              v-model="it.tipoItem"
              :rotulo="t('pep.padroes.item.tipo')"
              :opcoes="opcoes(TIPOS_ITEM_PROTOCOLO, 'tipos')"
              :data-testid="`padrao-item-tipo-${i}`"
            />
            <SanteSelecao
              v-if="secao === 'kits'"
              v-model="it.papel"
              :rotulo="t('pep.padroes.item.papel')"
              :opcoes="opcoes(PAPEIS_ITEM_KIT, 'papeis')"
              :data-testid="`padrao-item-papel-${i}`"
            />
            <label
              ><span>{{ t('pep.padroes.item.catalogo') }}</span
              ><input
                v-model="it.itemNome"
                :list="`padrao-sugestoes-${i}`"
                :data-testid="`padrao-item-catalogo-${i}`"
                @input="digitar(it)" />
              <datalist :id="`padrao-sugestoes-${i}`">
                <option v-for="s in sugestoes" :key="s.produto" :value="s.nome" /></datalist
            ></label>
            <label v-if="secao !== 'kits'"
              ><span>{{ t('pep.padroes.item.descricao') }}</span
              ><input v-model="it.descricao" maxlength="500" :data-testid="`padrao-item-descricao-${i}`"
            /></label>
            <label v-if="secao !== 'kits'"
              ><span>{{ t('pep.padroes.item.dose') }}</span
              ><input
                v-model.number="it.dose"
                type="number"
                min="0"
                step="any"
                :data-testid="`padrao-item-dose-${i}`"
            /></label>
            <label
              ><span>{{ t('pep.padroes.item.quantidade') }}</span
              ><input
                v-model.number="it.quantidade"
                type="number"
                min="0"
                step="any"
                :data-testid="`padrao-item-quantidade-${i}`"
            /></label>
            <SanteSelecao
              v-model="it.unidade"
              :rotulo="t('pep.padroes.item.unidade')"
              :opcoes="opcoesUnidade"
              :data-testid="`padrao-item-unidade-${i}`"
            />
            <label v-if="secao === 'receitas'"
              ><span>{{ t('pep.padroes.item.posologia') }}</span
              ><input v-model="it.posologia" maxlength="2000"
            /></label>
            <SanteBotao
              :rotulo="t('pep.padroes.item.retirar')"
              variante="secundario"
              :data-testid="`padrao-item-retirar-${i}`"
              @acionar="retirarItem(i)"
            />
          </div>
          <SanteBotao
            :rotulo="t('pep.padroes.item.incluir')"
            variante="secundario"
            data-testid="padrao-item-incluir"
            @acionar="incluirItem"
          />
        </fieldset>

        <SanteAlerta
          v-if="problemas.length"
          variante="aviso"
          :texto="`${t('pep.padroes.corrija')} ${problemas.join(' ')}`"
          data-testid="padrao-problemas"
        />
        <MensagemErro v-if="erro" :erro="erro" />
        <p v-if="aviso" role="status" data-testid="padrao-aviso">{{ aviso }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('pep.padroes.salvar')"
            :desabilitado="problemas.length > 0"
            data-testid="padrao-salvar"
            @acionar="salvar"
          />
          <SanteBotao
            :rotulo="t('pep.padroes.cancelar')"
            variante="secundario"
            data-testid="padrao-cancelar"
            @acionar="aberto = false"
          />
        </div>
      </form>
    </div>
  </main>
</template>

<style scoped>
.padroes {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.texto {
  color: var(--sgh-texto-secundario);
}
.colunas {
  display: grid;
  grid-template-columns: minmax(14rem, 1fr) 3fr;
  gap: var(--sgh-espaco-4);
}
.lista ul {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-1);
}
.linha {
  display: grid;
  width: 100%;
  text-align: left;
  background: none;
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio);
  padding: var(--sgh-espaco-2);
  cursor: pointer;
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: var(--sgh-espaco-2);
}
.grade label,
.item label {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.largo {
  grid-column: 1 / -1;
}
.marca {
  display: flex !important;
  align-items: center;
}
.itens {
  display: grid;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio);
}
.item {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--sgh-espaco-2);
}
.seq {
  font-weight: 600;
  min-width: 2rem;
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
@media (max-width: 48rem) {
  .colunas {
    grid-template-columns: 1fr;
  }
}
</style>
