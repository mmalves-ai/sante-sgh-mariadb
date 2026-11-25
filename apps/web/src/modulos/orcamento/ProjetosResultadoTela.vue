<script setup lang="ts">
// Projetos como centro de resultado (C2-107, 07-FIN linha 128), em `/financeiro/orcamento/projetos`, aberta pelo
// orçamento empresarial. Numa tela só: a lista dos projetos com verba, despesa, receita e o aviso de estouro; o
// cadastro do projeto inteiro (verba, prazo, etapas, centros participantes, produtos e serviços previstos) com os
// problemas na hora; e o projeto aberto com o resultado (orçado × realizado, receita − despesa, por etapa e por centro),
// a apropriação de um documento do financeiro (busca pelo número, valor livre e prévia do valor apropriado) e o
// estorno com o motivo. Mesmas regras do domínio que a API aplica; nada se apaga.
import {
  conferirApropriacao,
  conferirProjeto,
  naturezaDaOrigem,
  ORIGENS_APROPRIACAO,
  SITUACOES_ETAPA,
  SITUACOES_PROJETO,
  type SituacaoEtapa,
  type SituacaoProjeto,
  TIPOS_PROJETO,
} from '@sgh/dominio-financeiro';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../casca/sessao/pode.js';
import {
  apropriarAoProjeto,
  type DocumentoProjeto,
  estornarApropriacao,
  lerDocumentosProjeto,
  lerProjeto,
  lerProjetos,
  type OrigemDocumento,
  type ProjetoProposto,
  salvarProjeto,
} from './api-projeto-resultado.js';
import ErroOrcamento from './ErroOrcamento.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const podeGravar = computed(() => pode('financeiro.orcamento.editar'));
const D = 'orcamentoEmpresarial.projetos';
type Id = number | '';
const nulo = (v: Id) => (v === '' ? null : v);
const hoje = () => new Date().toISOString().slice(0, 10);
const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = (v: string | number) => {
  const x = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(x) ? x : NaN;
};

const dados = useQuery({ queryKey: ['orcamento', 'projetos'], queryFn: lerProjetos });
const aberto = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['orcamento', 'projetos', 'detalhe', aberto.value]),
  queryFn: () => lerProjeto(aberto.value!),
  enabled: computed(() => aberto.value !== null),
});
const recarregar = () => cliente.invalidateQueries({ queryKey: ['orcamento', 'projetos'] });

const comVazio = (vazio: string, itens: readonly { id: number; nome: string }[]) => [
  { valor: '' as Id, rotulo: vazio },
  ...itens.map((x) => ({ valor: x.id as Id, rotulo: x.nome })),
];
const opCentros = computed(() => comVazio(t(`${D}.nenhum`), dados.data.value?.centros ?? []));
const opInsumos = computed(() => comVazio(t(`${D}.servico`), dados.data.value?.insumos ?? []));
const opTipos = computed(() =>
  TIPOS_PROJETO.map((x) => ({ valor: x as string, rotulo: t(`${D}.tipos.${x}`) })),
);
const opSituacoes = computed(() =>
  SITUACOES_PROJETO.map((x) => ({ valor: x as string, rotulo: t(`${D}.situacoes.${x}`) })),
);
const opSituacoesEtapa = computed(() =>
  SITUACOES_ETAPA.map((x) => ({ valor: x as string, rotulo: t(`${D}.situacoesEtapa.${x}`) })),
);
const opOrigens = computed(() =>
  ORIGENS_APROPRIACAO.map((x) => ({ valor: x as string, rotulo: t(`${D}.origens.${x}`) })),
);
const opNaturezas = computed(() => [
  { valor: '', rotulo: t(`${D}.escolha`) },
  { valor: 'despesa', rotulo: t(`${D}.naturezas.despesa`) },
  { valor: 'receita', rotulo: t(`${D}.naturezas.receita`) },
]);

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (fn: () => Promise<unknown>) => fn(),
  onSuccess: () => {
    erro.value = null;
    aviso.value = t(`${D}.feito`);
    void recarregar();
  },
  onError: (e) => {
    aviso.value = '';
    erro.value = e;
  },
});

// ------------------------------------------------------------ cadastro do projeto
interface EtapaForm {
  sequencia: number;
  descricao: string;
  centroCusto: Id;
  inicioPrevisto: string;
  fimPrevisto: string;
  valorPrevisto: string;
  percentualConcluido: string;
  situacao: string;
}
interface ProdutoForm {
  insumo: Id;
  servico: string;
  quantidade: string;
  valorPrevisto: string;
}
const editando = ref<number | null | 'novo'>(null);
const versao = ref<number | undefined>(undefined);
const situacaoGravada = ref<SituacaoProjeto | null>(null);
const etapasGravadas = ref<number[]>([]);
const etapasComApropriacao = ref<number[]>([]);
const f = ref({
  codigo: '',
  descricao: '',
  tipo: 'obra',
  verba: '0',
  inicioPrevisto: '',
  fimPrevisto: '',
  centroResultado: '' as Id,
  convenio: '',
  situacao: 'planejado',
});
const etapas = ref<EtapaForm[]>([]);
const centros = ref<{ centroCusto: Id; percentual: string }[]>([]);
const produtos = ref<ProdutoForm[]>([]);

function novoProjeto() {
  editando.value = 'novo';
  versao.value = undefined;
  situacaoGravada.value = null;
  etapasGravadas.value = [];
  etapasComApropriacao.value = [];
  f.value = {
    codigo: '',
    descricao: '',
    tipo: 'obra',
    verba: '0',
    inicioPrevisto: '',
    fimPrevisto: '',
    centroResultado: '',
    convenio: '',
    situacao: 'planejado',
  };
  etapas.value = [];
  centros.value = [];
  produtos.value = [];
}

function editarProjeto() {
  const p = detalhe.data.value;
  if (!p) return;
  editando.value = p.id;
  versao.value = p.versao;
  situacaoGravada.value = p.situacao;
  etapasGravadas.value = p.etapas.map((e) => e.sequencia);
  etapasComApropriacao.value = [
    ...new Set(p.apropriacoes.filter((a) => !a.estornada && a.etapa !== null).map((a) => a.etapa!)),
  ];
  f.value = {
    codigo: p.codigo,
    descricao: p.descricao,
    tipo: p.tipo,
    verba: String(p.verba),
    inicioPrevisto: p.inicioPrevisto ?? '',
    fimPrevisto: p.fimPrevisto ?? '',
    centroResultado: p.centroResultado ?? '',
    convenio: p.convenio ?? '',
    situacao: p.situacao,
  };
  etapas.value = p.etapas.map((e) => ({
    sequencia: e.sequencia,
    descricao: e.descricao,
    centroCusto: e.centroCusto ?? '',
    inicioPrevisto: e.inicioPrevisto ?? '',
    fimPrevisto: e.fimPrevisto ?? '',
    valorPrevisto: String(e.valorPrevisto),
    percentualConcluido: String(e.percentualConcluido),
    situacao: e.situacao,
  }));
  centros.value = p.centros.map((c) => ({
    centroCusto: c.centroCusto,
    percentual: c.percentual === null ? '' : String(c.percentual),
  }));
  produtos.value = p.produtos.map((x) => ({
    insumo: x.insumo ?? '',
    servico: x.servico ?? '',
    quantidade: String(x.quantidade),
    valorPrevisto: x.valorPrevisto === null ? '' : String(x.valorPrevisto),
  }));
}

const incluirEtapa = () =>
  etapas.value.push({
    sequencia: Math.max(0, ...etapas.value.map((e) => e.sequencia)) + 1,
    descricao: '',
    centroCusto: '',
    inicioPrevisto: '',
    fimPrevisto: '',
    valorPrevisto: '0',
    percentualConcluido: '0',
    situacao: 'planejada',
  });

const proposta = computed<ProjetoProposto>(() => ({
  codigo: f.value.codigo.trim(),
  descricao: f.value.descricao.trim(),
  tipo: f.value.tipo,
  verba: numero(f.value.verba),
  inicioPrevisto: f.value.inicioPrevisto || null,
  fimPrevisto: f.value.fimPrevisto || null,
  centroResultado: nulo(f.value.centroResultado),
  convenio: f.value.convenio.trim() || null,
  situacao: f.value.situacao,
  etapas: etapas.value.map((e) => ({
    sequencia: e.sequencia,
    descricao: e.descricao.trim(),
    centroCusto: nulo(e.centroCusto),
    inicioPrevisto: e.inicioPrevisto || null,
    fimPrevisto: e.fimPrevisto || null,
    valorPrevisto: numero(e.valorPrevisto || '0'),
    percentualConcluido: numero(e.percentualConcluido || '0'),
    situacao: e.situacao,
  })),
  centros: centros.value
    .filter((c) => c.centroCusto !== '')
    .map((c) => ({
      centroCusto: c.centroCusto as number,
      percentual: c.percentual === '' ? null : numero(c.percentual),
    })),
  produtos: produtos.value.map((x) => ({
    insumo: nulo(x.insumo),
    servico: x.insumo === '' ? x.servico.trim() || null : null,
    quantidade: numero(x.quantidade || '0'),
    valorPrevisto: x.valorPrevisto === '' ? null : numero(x.valorPrevisto),
  })),
  ...(versao.value !== undefined ? { versao: versao.value } : {}),
}));

const problemasProjeto = computed(() => {
  const p = proposta.value;
  return conferirProjeto({
    ...p,
    situacao: p.situacao as SituacaoProjeto,
    situacaoAnterior: situacaoGravada.value,
    etapas: p.etapas.map((e) => ({ ...e, situacao: e.situacao as SituacaoEtapa })),
    etapasGravadas: etapasGravadas.value,
    etapasComApropriacao: etapasComApropriacao.value,
  });
});

function gravarProjeto() {
  const alvo = editando.value === 'novo' ? null : editando.value;
  acao.mutate(async () => {
    const r = await salvarProjeto(alvo, proposta.value);
    editando.value = null;
    if (typeof r.id === 'number') aberto.value = r.id;
  });
}

// ------------------------------------------------------------ apropriação
const origem = ref<string>('titulo');
const busca = ref('');
const documentos = ref<DocumentoProjeto[]>([]);
const doc = ref<Id>('');
const natureza = ref('');
const etapaApr = ref<Id>('');
const modo = ref<'percentual' | 'valor'>('percentual');
const percentual = ref('100');
const valor = ref('');
const dataApr = ref(hoje());
const observacao = ref('');

async function buscarDocumentos() {
  try {
    documentos.value = await lerDocumentosProjeto(origem.value as OrigemDocumento, busca.value.trim());
    doc.value = documentos.value.length === 1 ? documentos.value[0]!.id : '';
    erro.value = null;
  } catch (e) {
    erro.value = e;
  }
}
const opDocumentos = computed(() => [
  { valor: '' as Id, rotulo: t(`${D}.escolha`) },
  ...documentos.value.map((d) => ({
    valor: d.id as Id,
    rotulo: `${d.numero} · ${moeda(d.valor)} · ${t(`${D}.livre`)} ${moeda(d.livre)}${d.descricao ? ` · ${d.descricao}` : ''}`,
  })),
]);
const opEtapas = computed(() =>
  comVazio(
    t(`${D}.nenhum`),
    (detalhe.data.value?.etapas ?? [])
      .filter((e) => e.situacao !== 'cancelada')
      .map((e) => ({ id: e.id, nome: `${e.sequencia} · ${e.descricao}` })),
  ),
);
const docEscolhido = computed(() => documentos.value.find((d) => d.id === doc.value) ?? null);
const naturezaFixa = computed(() => naturezaDaOrigem(origem.value as OrigemDocumento));

const previa = computed(() => {
  const p = detalhe.data.value;
  const d = docEscolhido.value;
  if (!p || !d) return null;
  return conferirApropriacao({
    origem: origem.value as OrigemDocumento,
    natureza: naturezaFixa.value === null ? ((natureza.value || null) as 'receita' | 'despesa' | null) : null,
    situacaoProjeto: p.situacao,
    valorOrigem: d.valor,
    jaApropriado: d.valor - d.livre,
    percentual: modo.value === 'percentual' ? numero(percentual.value) : null,
    valor: modo.value === 'valor' ? numero(valor.value) : null,
    data: dataApr.value,
    etapa: etapaApr.value === '' ? null : 'planejada',
    origemCancelada: d.cancelado,
  });
});

function apropriar() {
  const p = detalhe.data.value;
  if (!p || doc.value === '') return;
  acao.mutate(async () => {
    await apropriarAoProjeto(p.id, {
      origem: origem.value as OrigemDocumento,
      documento: doc.value as number,
      natureza:
        naturezaFixa.value === null ? ((natureza.value || null) as 'receita' | 'despesa' | null) : null,
      etapa: nulo(etapaApr.value),
      percentual: modo.value === 'percentual' ? numero(percentual.value) : null,
      valor: modo.value === 'valor' ? numero(valor.value) : null,
      data: dataApr.value,
      observacao: observacao.value.trim() || null,
    });
    documentos.value = [];
    doc.value = '';
    observacao.value = '';
  });
}

const estornando = ref<number | null>(null);
const motivo = ref('');
function estornar(id: number, v: number) {
  acao.mutate(async () => {
    await estornarApropriacao(id, v, motivo.value.trim());
    estornando.value = null;
    motivo.value = '';
  });
}
</script>

<template>
  <section class="tela-projetos" aria-labelledby="prj-titulo" data-testid="tela-projetos-resultado">
    <h1 id="prj-titulo">{{ t(`${D}.titulo`) }}</h1>
    <p>{{ t(`${D}.texto`) }}</p>
    <p>
      <RouterLink :to="{ name: 'financeiro.orcamento' }" data-testid="prj-ir-orcamento">{{
        t(`${D}.irOrcamento`)
      }}</RouterLink>
    </p>
    <SanteAlerta v-if="!podeGravar" :texto="t(`${D}.somenteLeitura`)" variante="info" />
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="prj-aviso" />
    <ErroOrcamento v-if="erro" :erro="erro" />
    <ErroOrcamento v-if="dados.isError.value" :erro="dados.error.value" />

    <!-- Lista dos projetos -->
    <section v-if="editando === null" aria-labelledby="prj-lista">
      <h2 id="prj-lista">{{ t(`${D}.titulo`) }}</h2>
      <SanteBotao v-if="podeGravar" :rotulo="t(`${D}.novo`)" data-testid="prj-novo" @acionar="novoProjeto" />
      <p v-if="dados.data.value && !dados.data.value.projetos.length" role="status">{{ t(`${D}.vazio`) }}</p>
      <table v-else-if="dados.data.value" data-testid="prj-lista">
        <thead>
          <tr>
            <th scope="col">{{ t(`${D}.codigo`) }}</th>
            <th scope="col">{{ t(`${D}.descricao`) }}</th>
            <th scope="col">{{ t(`${D}.situacao`) }}</th>
            <th scope="col">{{ t(`${D}.verba`) }}</th>
            <th scope="col">{{ t(`${D}.despesa`) }}</th>
            <th scope="col">{{ t(`${D}.receita`) }}</th>
            <th scope="col">
              <span class="sgh-visualmente-oculto">{{ t(`${D}.abrir`) }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in dados.data.value.projetos" :key="p.id" :data-testid="`prj-linha-${p.codigo}`">
            <td>{{ p.codigo }}</td>
            <td>{{ p.descricao }}</td>
            <td>{{ t(`${D}.situacoes.${p.situacao}`) }}</td>
            <td>{{ moeda(p.verba) }}</td>
            <td>
              {{ moeda(p.despesa) }}
              <strong v-if="p.estourado" :data-testid="`prj-estouro-${p.codigo}`">{{
                t(`${D}.estourado`)
              }}</strong>
            </td>
            <td>{{ moeda(p.receita) }}</td>
            <td>
              <SanteBotao
                variante="secundario"
                :rotulo="t(`${D}.abrir`)"
                :data-testid="`prj-abrir-${p.codigo}`"
                @acionar="aberto = p.id"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Cadastro do projeto -->
    <form v-if="editando !== null" aria-labelledby="prj-form" data-testid="prj-form" @submit.prevent>
      <h2 id="prj-form">{{ editando === 'novo' ? t(`${D}.novo`) : t(`${D}.editar`) }}</h2>
      <div class="grade">
        <label
          >{{ t(`${D}.codigo`) }}
          <input v-model="f.codigo" maxlength="20" data-testid="prj-codigo" />
        </label>
        <label
          >{{ t(`${D}.descricao`) }}
          <input v-model="f.descricao" maxlength="150" data-testid="prj-descricao" />
        </label>
        <SanteSelecao v-model="f.tipo" :rotulo="t(`${D}.tipo`)" :opcoes="opTipos" data-testid="prj-tipo" />
        <SanteSelecao
          v-model="f.situacao"
          :rotulo="t(`${D}.situacao`)"
          :opcoes="opSituacoes"
          data-testid="prj-situacao"
        />
        <label
          >{{ t(`${D}.verba`) }}
          <input v-model="f.verba" inputmode="decimal" data-testid="prj-verba" />
        </label>
        <label
          >{{ t(`${D}.inicio`) }}
          <input v-model="f.inicioPrevisto" type="date" data-testid="prj-inicio" />
        </label>
        <label
          >{{ t(`${D}.fim`) }}
          <input v-model="f.fimPrevisto" type="date" data-testid="prj-fim" />
        </label>
        <SanteSelecao
          v-model="f.centroResultado"
          :rotulo="t(`${D}.centroResultado`)"
          :opcoes="opCentros"
          data-testid="prj-centro-resultado"
        />
        <label
          >{{ t(`${D}.convenio`) }}
          <input v-model="f.convenio" maxlength="30" data-testid="prj-convenio" />
        </label>
      </div>

      <fieldset data-testid="prj-etapas">
        <legend>{{ t(`${D}.etapas`) }}</legend>
        <div v-for="(e, i) in etapas" :key="i" class="grade" :data-testid="`prj-etapa-${i}`">
          <span>{{ t(`${D}.sequencia`) }} {{ e.sequencia }}</span>
          <label
            >{{ t(`${D}.descricao`) }}
            <input v-model="e.descricao" maxlength="150" :data-testid="`prj-etapa-${i}-descricao`" />
          </label>
          <SanteSelecao
            v-model="e.centroCusto"
            :rotulo="t(`${D}.centro`)"
            :opcoes="opCentros"
            :data-testid="`prj-etapa-${i}-centro`"
          />
          <label
            >{{ t(`${D}.inicio`) }}
            <input v-model="e.inicioPrevisto" type="date" :data-testid="`prj-etapa-${i}-inicio`" />
          </label>
          <label
            >{{ t(`${D}.fim`) }}
            <input v-model="e.fimPrevisto" type="date" :data-testid="`prj-etapa-${i}-fim`" />
          </label>
          <label
            >{{ t(`${D}.valorPrevisto`) }}
            <input v-model="e.valorPrevisto" inputmode="decimal" :data-testid="`prj-etapa-${i}-valor`" />
          </label>
          <label
            >{{ t(`${D}.concluido`) }}
            <input
              v-model="e.percentualConcluido"
              inputmode="decimal"
              :data-testid="`prj-etapa-${i}-concluido`"
            />
          </label>
          <SanteSelecao
            v-model="e.situacao"
            :rotulo="t(`${D}.situacao`)"
            :opcoes="opSituacoesEtapa"
            :data-testid="`prj-etapa-${i}-situacao`"
          />
          <SanteBotao
            v-if="!etapasGravadas.includes(e.sequencia)"
            variante="texto"
            :rotulo="t(`${D}.retirar`)"
            @acionar="etapas.splice(i, 1)"
          />
        </div>
        <SanteBotao
          variante="secundario"
          :rotulo="t(`${D}.incluirEtapa`)"
          data-testid="prj-incluir-etapa"
          @acionar="incluirEtapa"
        />
      </fieldset>

      <fieldset data-testid="prj-centros">
        <legend>{{ t(`${D}.centros`) }}</legend>
        <div v-for="(c, i) in centros" :key="i" class="grade">
          <SanteSelecao
            v-model="c.centroCusto"
            :rotulo="t(`${D}.centro`)"
            :opcoes="opCentros"
            :data-testid="`prj-centro-${i}`"
          />
          <label
            >{{ t(`${D}.participacao`) }}
            <input v-model="c.percentual" inputmode="decimal" :data-testid="`prj-centro-${i}-percentual`" />
          </label>
          <SanteBotao variante="texto" :rotulo="t(`${D}.retirar`)" @acionar="centros.splice(i, 1)" />
        </div>
        <SanteBotao
          variante="secundario"
          :rotulo="t(`${D}.incluirCentro`)"
          data-testid="prj-incluir-centro"
          @acionar="centros.push({ centroCusto: '', percentual: '' })"
        />
      </fieldset>

      <fieldset data-testid="prj-produtos">
        <legend>{{ t(`${D}.produtos`) }}</legend>
        <div v-for="(x, i) in produtos" :key="i" class="grade">
          <SanteSelecao
            v-model="x.insumo"
            :rotulo="t(`${D}.produto`)"
            :opcoes="opInsumos"
            :data-testid="`prj-produto-${i}`"
          />
          <label v-if="x.insumo === ''"
            >{{ t(`${D}.servico`) }}
            <input v-model="x.servico" maxlength="150" :data-testid="`prj-produto-${i}-servico`" />
          </label>
          <label
            >{{ t(`${D}.quantidade`) }}
            <input v-model="x.quantidade" inputmode="decimal" :data-testid="`prj-produto-${i}-quantidade`" />
          </label>
          <label
            >{{ t(`${D}.valorPrevisto`) }}
            <input v-model="x.valorPrevisto" inputmode="decimal" :data-testid="`prj-produto-${i}-valor`" />
          </label>
          <SanteBotao variante="texto" :rotulo="t(`${D}.retirar`)" @acionar="produtos.splice(i, 1)" />
        </div>
        <SanteBotao
          variante="secundario"
          :rotulo="t(`${D}.incluirProduto`)"
          data-testid="prj-incluir-produto"
          @acionar="produtos.push({ insumo: '', servico: '', quantidade: '1', valorPrevisto: '' })"
        />
      </fieldset>

      <ul v-if="problemasProjeto.length" role="alert" data-testid="prj-problemas">
        <li v-for="(p, i) in problemasProjeto" :key="i">{{ p.mensagem }}</li>
      </ul>
      <div class="acoes">
        <SanteBotao
          :rotulo="t(`${D}.gravar`)"
          :desabilitado="problemasProjeto.length > 0 || acao.isPending.value"
          data-testid="prj-gravar"
          @acionar="gravarProjeto"
        />
        <SanteBotao variante="secundario" :rotulo="t(`${D}.cancelarEdicao`)" @acionar="editando = null" />
      </div>
    </form>

    <!-- Projeto aberto: resultado, apropriações -->
    <section
      v-if="editando === null && aberto !== null && detalhe.data.value"
      aria-labelledby="prj-aberto"
      data-testid="prj-detalhe"
    >
      <h2 id="prj-aberto">{{ detalhe.data.value.codigo }} · {{ detalhe.data.value.descricao }}</h2>
      <div class="acoes">
        <SanteBotao
          v-if="podeGravar"
          variante="secundario"
          :rotulo="t(`${D}.editar`)"
          data-testid="prj-editar"
          @acionar="editarProjeto"
        />
        <SanteBotao variante="texto" :rotulo="t(`${D}.fechar`)" @acionar="aberto = null" />
      </div>
      <dl class="resumo" data-testid="prj-resultado">
        <div>
          <dt>{{ t(`${D}.verba`) }}</dt>
          <dd>{{ moeda(detalhe.data.value.resultado.orcado) }}</dd>
        </div>
        <div>
          <dt>{{ t(`${D}.despesa`) }}</dt>
          <dd data-testid="prj-res-despesa">{{ moeda(detalhe.data.value.resultado.despesa) }}</dd>
        </div>
        <div>
          <dt>{{ t(`${D}.receita`) }}</dt>
          <dd data-testid="prj-res-receita">{{ moeda(detalhe.data.value.resultado.receita) }}</dd>
        </div>
        <div>
          <dt>{{ t(`${D}.resultado`) }}</dt>
          <dd data-testid="prj-res-resultado">{{ moeda(detalhe.data.value.resultado.resultado) }}</dd>
        </div>
        <div>
          <dt>{{ t(`${D}.saldo`) }}</dt>
          <dd data-testid="prj-res-saldo">{{ moeda(detalhe.data.value.resultado.saldoVerba) }}</dd>
        </div>
        <div v-if="detalhe.data.value.resultado.percentualConsumido !== null">
          <dt>{{ t(`${D}.consumido`) }}</dt>
          <dd>{{ detalhe.data.value.resultado.percentualConsumido }}%</dd>
        </div>
      </dl>
      <SanteAlerta
        v-if="detalhe.data.value.resultado.estourado"
        :texto="t(`${D}.estourado`)"
        variante="aviso"
        data-testid="prj-res-estouro"
      />

      <table v-if="detalhe.data.value.resultado.etapas.length" data-testid="prj-res-etapas">
        <caption>
          {{
            t(`${D}.etapas`)
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t(`${D}.sequencia`) }}</th>
            <th scope="col">{{ t(`${D}.descricao`) }}</th>
            <th scope="col">{{ t(`${D}.previsto`) }}</th>
            <th scope="col">{{ t(`${D}.realizado`) }}</th>
            <th scope="col">{{ t(`${D}.diferenca`) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in detalhe.data.value.resultado.etapas" :key="e.sequencia">
            <td>{{ e.sequencia }}</td>
            <td>{{ e.descricao }}</td>
            <td>{{ moeda(e.previsto) }}</td>
            <td>{{ moeda(e.realizado) }}</td>
            <td>
              {{ moeda(e.diferenca) }} <strong v-if="e.estourada">{{ t(`${D}.estourada`) }}</strong>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="detalhe.data.value.resultado.semEtapa">
        {{ t(`${D}.semEtapa`) }}: {{ moeda(detalhe.data.value.resultado.semEtapa) }}
      </p>
      <table v-if="detalhe.data.value.resultado.centros.length" data-testid="prj-res-centros">
        <caption>
          {{
            t(`${D}.centros`)
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t(`${D}.centro`) }}</th>
            <th scope="col">{{ t(`${D}.participacao`) }}</th>
            <th scope="col">{{ t(`${D}.despesa`) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in detalhe.data.value.resultado.centros" :key="c.centroCusto">
            <td>
              {{
                detalhe.data.value.centros.find((x) => x.centroCusto === c.centroCusto)?.nome ?? c.centroCusto
              }}
            </td>
            <td>{{ c.percentual }}%</td>
            <td>{{ moeda(c.despesa) }}</td>
          </tr>
        </tbody>
      </table>

      <form v-if="podeGravar" aria-labelledby="prj-apropriar" data-testid="prj-apropriar" @submit.prevent>
        <h3 id="prj-apropriar">{{ t(`${D}.apropriar`) }}</h3>
        <div class="grade">
          <SanteSelecao
            v-model="origem"
            :rotulo="t(`${D}.origem`)"
            :opcoes="opOrigens"
            data-testid="prj-apr-origem"
            @update:model-value="documentos = []"
          />
          <label
            >{{ t(`${D}.buscarDocumento`) }}
            <input
              v-model="busca"
              maxlength="40"
              data-testid="prj-apr-busca"
              @keyup.enter="buscarDocumentos"
            />
          </label>
          <SanteBotao
            variante="secundario"
            :rotulo="t(`${D}.buscar`)"
            data-testid="prj-apr-buscar"
            @acionar="buscarDocumentos"
          />
          <SanteSelecao
            v-model="doc"
            :rotulo="t(`${D}.documento`)"
            :opcoes="opDocumentos"
            data-testid="prj-apr-documento"
          />
          <SanteSelecao
            v-if="naturezaFixa === null"
            v-model="natureza"
            :rotulo="t(`${D}.natureza`)"
            :opcoes="opNaturezas"
            data-testid="prj-apr-natureza"
          />
          <SanteSelecao
            v-model="etapaApr"
            :rotulo="t(`${D}.etapa`)"
            :opcoes="opEtapas"
            data-testid="prj-apr-etapa"
          />
          <fieldset>
            <legend>{{ t(`${D}.modo`) }}</legend>
            <label
              ><input v-model="modo" type="radio" value="percentual" data-testid="prj-apr-modo-percentual" />
              {{ t(`${D}.porPercentual`) }}</label
            >
            <label
              ><input v-model="modo" type="radio" value="valor" data-testid="prj-apr-modo-valor" />
              {{ t(`${D}.porValor`) }}</label
            >
          </fieldset>
          <label v-if="modo === 'percentual'"
            >{{ t(`${D}.percentual`) }}
            <input v-model="percentual" inputmode="decimal" data-testid="prj-apr-percentual" />
          </label>
          <label v-else
            >{{ t(`${D}.valor`) }}
            <input v-model="valor" inputmode="decimal" data-testid="prj-apr-valor" />
          </label>
          <label
            >{{ t(`${D}.data`) }}
            <input v-model="dataApr" type="date" data-testid="prj-apr-data" />
          </label>
          <label
            >{{ t(`${D}.observacao`) }}
            <input v-model="observacao" maxlength="500" data-testid="prj-apr-observacao" />
          </label>
        </div>
        <ul v-if="previa && previa.problemas.length" role="alert" data-testid="prj-apr-problemas">
          <li v-for="(p, i) in previa.problemas" :key="i">{{ p.mensagem }}</li>
        </ul>
        <p v-else-if="previa?.aprovada" role="status" data-testid="prj-apr-previa">
          {{
            t(`${D}.previa`, {
              valor: moeda(previa.aprovada.valor),
              natureza: t(`${D}.naturezas.${previa.aprovada.natureza}`),
            })
          }}
        </p>
        <SanteBotao
          :rotulo="t(`${D}.apropriar`)"
          :desabilitado="!previa?.aprovada || acao.isPending.value"
          data-testid="prj-apr-gravar"
          @acionar="apropriar"
        />
      </form>

      <table v-if="detalhe.data.value.apropriacoes.length" data-testid="prj-apropriacoes">
        <caption>
          {{
            t(`${D}.apropriacoes`)
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t(`${D}.data`) }}</th>
            <th scope="col">{{ t(`${D}.origem`) }}</th>
            <th scope="col">{{ t(`${D}.natureza`) }}</th>
            <th scope="col">{{ t(`${D}.etapa`) }}</th>
            <th scope="col">{{ t(`${D}.valor`) }}</th>
            <th scope="col">{{ t(`${D}.situacao`) }}</th>
            <th scope="col">
              <span class="sgh-visualmente-oculto">{{ t(`${D}.estornar`) }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in detalhe.data.value.apropriacoes" :key="a.id" :data-testid="`prj-apr-linha-${a.id}`">
            <td>{{ a.data }}</td>
            <td>{{ t(`${D}.origens.${a.origem}`) }}</td>
            <td>{{ t(`${D}.naturezas.${a.natureza}`) }}</td>
            <td>{{ a.etapa ?? '' }}</td>
            <td>
              {{ moeda(a.valor) }}<span v-if="a.percentual !== null"> ({{ a.percentual }}%)</span>
            </td>
            <td>{{ a.estornada ? t(`${D}.estornada`) : t(`${D}.ativa`) }}</td>
            <td>
              <template v-if="podeGravar && !a.estornada">
                <SanteBotao
                  v-if="estornando !== a.id"
                  variante="texto"
                  :rotulo="t(`${D}.estornar`)"
                  :data-testid="`prj-estornar-${a.id}`"
                  @acionar="estornando = a.id"
                />
                <template v-else>
                  <label
                    >{{ t(`${D}.motivo`) }}
                    <input v-model="motivo" maxlength="400" data-testid="prj-estorno-motivo" />
                  </label>
                  <SanteBotao
                    variante="destrutivo"
                    :rotulo="t(`${D}.confirmarEstorno`)"
                    :confirmacao="t(`${D}.confirmarEstorno`)"
                    :desabilitado="motivo.trim().length < 3"
                    data-testid="prj-estorno-confirmar"
                    @acionar="estornar(a.id, a.versao)"
                  />
                </template>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<style scoped>
.grade {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
.acoes {
  display: flex;
  gap: 0.5rem;
  margin: 0.5rem 0;
}
.resumo {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
}
.resumo dd {
  margin: 0;
  font-weight: 600;
}
table {
  border-collapse: collapse;
  margin: 0.75rem 0;
}
th,
td {
  padding: 0.25rem 0.5rem;
  text-align: left;
}
fieldset {
  margin: 0.75rem 0;
}
</style>
