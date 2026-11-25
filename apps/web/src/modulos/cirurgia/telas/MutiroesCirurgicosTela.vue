<script setup lang="ts">
// Projetos e mutirões cirúrgicos do SUS (C2-041, 04-CC linha 108). Padrão de mercado: a portaria com vigência, metas
// por procedimento SIGTAP (Tabela de Procedimentos do SUS), insumos e fornecedores previstos, e a AIH (autorização de
// internação hospitalar) ou a APAC (autorização de procedimento de alta complexidade) marcada com o projeto, como no
// Programa Nacional de Redução das Filas, sem faturamento à parte. Numa tela só: a lista com a meta contra a produção,
// o projeto aberto com o ritmo por procedimento, a marcação pelo número do documento com a conferência na hora (antes
// de gravar) e os documentos por paciente; a retirada pede a justificativa e fica no histórico. Nada é apagado.
import { conferirJustificativa, validarMeta, validarProjetoMutirao } from '@sgh/dominio-cirurgia';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  ativarJustificativaMutirao,
  buscarDocumentoMutirao,
  type DocumentoMutirao,
  incluirFornecedorMutirao,
  incluirInsumoMutirao,
  incluirJustificativaMutirao,
  incluirMetaMutirao,
  incluirProjetoMutirao,
  lerDetalheMutirao,
  lerPainelMutirao,
  mudarSituacaoMutirao,
  retirarItemMutirao,
  retirarVinculoMutirao,
  vincularDocumentoMutirao,
} from '../api-mutirao-cirurgico.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Mutirões cirúrgicos (SUS)',
      abaProjetos: 'Projetos',
      abaJustificativas: 'Justificativas',
      nenhum: 'Nenhum projeto cadastrado.',
      resumo: '{codigo} · {descricao} · {sit} · {real} de {prev} ({pct}%)',
      situacoes: {
        planejado: 'Planejado',
        em_andamento: 'Em andamento',
        encerrado: 'Encerrado',
        cancelado: 'Cancelado',
      },
      abrir: 'Abrir',
      novo: 'Novo projeto',
      codigo: 'Código',
      descricao: 'Descrição',
      portaria: 'Portaria, convênio ou emenda',
      inicio: 'Vigência desde',
      fim: 'Vigência até',
      valor: 'Valor do financiamento (R$)',
      fonte: 'Fonte pagadora',
      nenhuma: 'Nenhuma',
      incluir: 'Incluir',
      vigencia: 'Vigência {de} a {ate} · {portaria}',
      semFim: 'sem fim',
      acompanhamento: 'Meta contra produção: {real} de {prev} ({pct}%) · R$ {vreal} de R$ {vprev}',
      decorrido: ' · {pct}% da vigência decorrida',
      iniciar: 'Iniciar',
      encerrar: 'Encerrar',
      cancelar: 'Cancelar projeto',
      motivo: 'Motivo do cancelamento',
      metas: 'Metas por procedimento SIGTAP',
      meta: '{proc} (SIGTAP {sigtap}) · {real} de {prev} · saldo {saldo} · {ritmo}',
      ritmos: {
        atingida: 'meta atingida',
        no_ritmo: 'no ritmo',
        abaixo_do_ritmo: 'abaixo do ritmo (esperado {n} até hoje)',
        sem_vigencia: 'sem fim de vigência',
      },
      procedimento: 'Procedimento',
      quantidade: 'Quantidade prevista',
      valorUnitario: 'Valor por procedimento (R$)',
      incluirMeta: 'Incluir meta',
      retirar: 'Retirar',
      insumos: 'Insumos previstos',
      insumo: 'Insumo',
      insumoLinha: '{desc} · previsto {prev} · utilizado {uso}',
      fornecedores: 'Fornecedores',
      fornecedor: 'Fornecedor',
      documentos: 'AIH e APAC marcadas (por paciente)',
      semDocumentos: 'Nenhum documento marcado.',
      documento: '{tipo} {numero} · {paciente} · prontuário {pront} · {just}',
      retirado: 'retirado: {just}',
      marcar: 'Marcar AIH ou APAC',
      tipo: 'Documento',
      numero: 'Número (13 dígitos)',
      buscar: 'Conferir',
      achado: '{tipo} {numero} de {data} · {paciente} · {sit}',
      podeMarcar: 'Pronta para marcar.',
      justificativa: 'Justificativa',
      complemento: 'Complemento',
      marcarBotao: 'Marcar no projeto',
      naoAchado: 'Nenhum documento com este número neste estabelecimento.',
      retirarDoc: 'Retirar do projeto',
      justRetirada: 'Justificativa da retirada',
      confirmarRetirada: 'Confirmar retirada',
      novaJust: 'Nova justificativa',
      aplicaInclusao: 'Serve para incluir',
      aplicaAlteracao: 'Serve para retirar',
      exigeComplemento: 'Exige complemento',
      justLinha: '{codigo} · {descricao}{usos}',
      inativa: 'inativa',
      desativar: 'Desativar',
      reativar: 'Reativar',
      gravado: 'Gravado.',
    },
  },
});

const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeEditar = computed(() => permissoes.value.has('faturamento.susCadastro.editar'));
const podeAih = computed(() => permissoes.value.has('faturamento.susAih.registrar'));
const podeApac = computed(() => permissoes.value.has('faturamento.susApac.registrar'));
const aba = ref<'projetos' | 'justificativas'>('projetos');
const selecionado = ref<number | null>(null);
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

const painel = useQuery({ queryKey: ['cirurgia', 'mutiroes', 'painel'], queryFn: lerPainelMutirao });
const detalhe = useQuery({
  queryKey: computed(() => ['cirurgia', 'mutiroes', 'detalhe', selecionado.value]),
  queryFn: () => lerDetalheMutirao(selecionado.value!),
  enabled: computed(() => selecionado.value !== null),
});
const pa = computed(() => painel.data.value);
const d = computed(() => detalhe.data.value);
const editavel = computed(
  () =>
    !!d.value && (d.value.projeto.situacao === 'planejado' || d.value.projeto.situacao === 'em_andamento'),
);

async function rodar(fn: () => Promise<unknown>): Promise<boolean> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    await cliente.invalidateQueries({ queryKey: ['cirurgia', 'mutiroes'] });
    mensagem.value = t('gravado');
    return true;
  } catch (x) {
    erro.value = x;
    return false;
  } finally {
    ocupado.value = false;
  }
}
const numero = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const moeda = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const dataBr = (s: string | null) => (s ? s.split('-').reverse().join('/') : t('semFim'));

// ── Novo projeto (validação na hora, a mesma regra do servidor) ──
const vazio = () => ({
  codigo: '',
  descricao: '',
  portaria: '',
  inicio: null as string | null,
  fim: null as string | null,
  valor: '',
  fonte: null as number | null,
});
const n = ref(vazio());
const problemasProjeto = computed(() =>
  validarProjetoMutirao({
    codigo: n.value.codigo,
    descricao: n.value.descricao,
    portaria: n.value.portaria,
    periodoInicio: n.value.inicio ?? '',
    periodoFim: n.value.fim,
    valorFinanciamento: numero(n.value.valor),
  }),
);
const opcoesFonte = computed(() => [
  { valor: null, rotulo: t('nenhuma') },
  ...(pa.value?.opcoes.fontesPagadoras ?? []).map((o) => ({ valor: o.id, rotulo: o.rotulo })),
]);
const gravarProjeto = () =>
  rodar(async () => {
    const r = await incluirProjetoMutirao({
      codigo: n.value.codigo.trim().toUpperCase(),
      descricao: n.value.descricao.trim(),
      portaria: n.value.portaria.trim(),
      periodoInicio: n.value.inicio!,
      periodoFim: n.value.fim,
      valorFinanciamento: numero(n.value.valor),
      fontePagadora: n.value.fonte,
    });
    n.value = vazio();
    selecionado.value = r.id;
  });

// ── Situação ──
const motivo = ref('');
const mudar = (situacao: string) =>
  rodar(() =>
    mudarSituacaoMutirao(d.value!.projeto.id, d.value!.projeto.versao, situacao, motivo.value.trim() || null),
  );

// ── Metas, insumos e fornecedores ──
const meta = ref({ procedimento: null as number | null, quantidade: '', valor: '' });
const procedimentoEscolhido = computed(() =>
  pa.value?.opcoes.procedimentos.find((p) => p.id === meta.value.procedimento),
);
const problemasMeta = computed(() =>
  meta.value.procedimento === null
    ? []
    : validarMeta(
        {
          sigtap: procedimentoEscolhido.value?.sigtap ? Number(procedimentoEscolhido.value.sigtap) : null,
          quantidadePrevista: numero(meta.value.quantidade) ?? 0,
          valorUnitario: numero(meta.value.valor),
        },
        (d.value?.metas ?? []).flatMap((m) => (m.sigtap ? [Number(m.sigtap)] : [])),
      ),
);
const opcoesProcedimento = computed(() =>
  (pa.value?.opcoes.procedimentos ?? []).map((o) => ({
    valor: o.id,
    rotulo: o.sigtap ? `${o.rotulo} (SIGTAP ${o.sigtap})` : o.rotulo,
  })),
);
const gravarMeta = () =>
  rodar(async () => {
    await incluirMetaMutirao(d.value!.projeto.id, {
      procedimento: meta.value.procedimento!,
      quantidadePrevista: numero(meta.value.quantidade)!,
      valorUnitario: numero(meta.value.valor),
    });
    meta.value = { procedimento: null, quantidade: '', valor: '' };
  });
const insumo = ref({ id: null as number | null, quantidade: '' });
const opcoesInsumo = computed(() =>
  (pa.value?.opcoes.insumos ?? []).map((o) => ({ valor: o.id, rotulo: o.rotulo })),
);
const gravarInsumo = () =>
  rodar(async () => {
    await incluirInsumoMutirao(d.value!.projeto.id, insumo.value.id!, numero(insumo.value.quantidade)!);
    insumo.value = { id: null, quantidade: '' };
  });
const fornecedor = ref<number | null>(null);
const opcoesFornecedor = computed(() =>
  (pa.value?.opcoes.fornecedores ?? []).map((o) => ({ valor: o.id, rotulo: o.rotulo })),
);
const gravarFornecedor = () =>
  rodar(async () => {
    await incluirFornecedorMutirao(d.value!.projeto.id, fornecedor.value!);
    fornecedor.value = null;
  });
const retirarItem = (tipo: 'metas' | 'insumos' | 'fornecedores', item: number, versao: number) =>
  rodar(() => retirarItemMutirao(d.value!.projeto.id, tipo, item, versao));

// ── Marcar AIH ou APAC: conferência na hora pelo número ──
const tipoDoc = ref<'aih' | 'apac'>('aih');
const numeroDoc = ref('');
const achados = ref<DocumentoMutirao[] | null>(null);
const justInclusao = ref<number | null>(null);
const complemento = ref('');
watch([tipoDoc, numeroDoc, selecionado], () => (achados.value = null));
const opcoesTipo = computed(
  () =>
    [
      ...(podeAih.value ? [{ valor: 'aih', rotulo: 'AIH' }] : []),
      ...(podeApac.value ? [{ valor: 'apac', rotulo: 'APAC' }] : []),
    ] as { valor: 'aih' | 'apac'; rotulo: string }[],
);
const justificativas = computed(() => pa.value?.justificativas ?? []);
const opcoesJust = (uso: 'inclusao' | 'alteracao') =>
  justificativas.value
    .filter((j) => j.ativo && (uso === 'inclusao' ? j.aplicaInclusao : j.aplicaAlteracao))
    .map((j) => ({ valor: j.id, rotulo: `${j.codigo} - ${j.descricao}` }));
const problemasJust = (id: number | null, texto: string, uso: 'inclusao' | 'alteracao') =>
  conferirJustificativa(justificativas.value.find((j) => j.id === id) ?? null, texto, uso);
const conferir = () =>
  rodar(async () => {
    achados.value = (
      await buscarDocumentoMutirao(selecionado.value!, tipoDoc.value, numeroDoc.value)
    ).documentos;
  });
const marcar = (doc: DocumentoMutirao) =>
  rodar(async () => {
    await vincularDocumentoMutirao(
      selecionado.value!,
      doc.tipo,
      doc.id,
      justInclusao.value!,
      complemento.value.trim() || null,
    );
    numeroDoc.value = '';
    complemento.value = '';
    achados.value = null;
  });

// ── Retirada ──
const retirando = ref<number | null>(null);
const justRetirada = ref<number | null>(null);
const complRetirada = ref('');
const retirarDoc = (vinculo: number, versao: number) =>
  rodar(async () => {
    await retirarVinculoMutirao(
      selecionado.value!,
      vinculo,
      versao,
      justRetirada.value!,
      complRetirada.value.trim() || null,
    );
    retirando.value = null;
    justRetirada.value = null;
    complRetirada.value = '';
  });

// ── Justificativas ──
const nj = ref({ codigo: '', descricao: '', inclusao: true, alteracao: true, complemento: false });
const gravarJust = () =>
  rodar(async () => {
    await incluirJustificativaMutirao({
      codigo: nj.value.codigo.trim().toUpperCase(),
      descricao: nj.value.descricao.trim(),
      aplicaInclusao: nj.value.inclusao,
      aplicaAlteracao: nj.value.alteracao,
      exigeComplemento: nj.value.complemento,
    });
    nj.value = { codigo: '', descricao: '', inclusao: true, alteracao: true, complemento: false };
  });
</script>

<template>
  <main class="tela" data-testid="mutiroes-cirurgicos">
    <h1>{{ t('titulo') }}</h1>
    <nav class="linha" role="tablist">
      <SanteBotao
        :variante="aba === 'projetos' ? 'primario' : 'texto'"
        :rotulo="t('abaProjetos')"
        role="tab"
        :aria-selected="aba === 'projetos'"
        data-testid="mutirao-aba-projetos"
        @acionar="aba = 'projetos'"
      />
      <SanteBotao
        :variante="aba === 'justificativas' ? 'primario' : 'texto'"
        :rotulo="t('abaJustificativas')"
        role="tab"
        :aria-selected="aba === 'justificativas'"
        data-testid="mutirao-aba-justificativas"
        @acionar="aba = 'justificativas'"
      />
    </nav>
    <ErroCirurgia v-if="painel.isError.value" :erro="painel.error.value" />

    <section v-if="aba === 'projetos' && pa" aria-labelledby="projetos-titulo">
      <h2 id="projetos-titulo">{{ t('abaProjetos') }}</h2>
      <p v-if="!pa.projetos.length">{{ t('nenhum') }}</p>
      <ul v-else class="lista" data-testid="mutirao-projetos">
        <li v-for="p in pa.projetos" :key="p.id" :data-testid="`mutirao-projeto-${p.id}`">
          {{
            t('resumo', {
              codigo: p.codigo,
              descricao: p.descricao,
              sit: t(`situacoes.${p.situacao}`),
              real: p.realizada,
              prev: p.prevista,
              pct: p.percentual,
            })
          }}
          <SanteBotao
            variante="texto"
            :rotulo="t('abrir')"
            :data-testid="`mutirao-abrir-${p.id}`"
            @acionar="selecionado = p.id"
          />
        </li>
      </ul>

      <form v-if="podeEditar" class="formulario" data-testid="mutirao-novo" @submit.prevent>
        <h3>{{ t('novo') }}</h3>
        <SanteCampoTexto
          v-model="n.codigo"
          :rotulo="t('codigo')"
          :max-bytes="30"
          data-testid="mutirao-codigo"
        />
        <SanteCampoTexto
          v-model="n.descricao"
          :rotulo="t('descricao')"
          :max-bytes="200"
          data-testid="mutirao-descricao"
        />
        <SanteCampoTexto
          v-model="n.portaria"
          :rotulo="t('portaria')"
          :max-bytes="150"
          data-testid="mutirao-portaria"
        />
        <div class="linha">
          <SanteData v-model="n.inicio" :rotulo="t('inicio')" editavel data-testid="mutirao-inicio" />
          <SanteData v-model="n.fim" :rotulo="t('fim')" editavel data-testid="mutirao-fim" />
        </div>
        <SanteCampoTexto v-model="n.valor" :rotulo="t('valor')" :max-bytes="16" data-testid="mutirao-valor" />
        <SanteSelecao
          v-model="n.fonte"
          :rotulo="t('fonte')"
          :opcoes="opcoesFonte"
          data-testid="mutirao-fonte"
        />
        <ul v-if="n.codigo || n.descricao" class="problemas" data-testid="mutirao-problemas">
          <li v-for="x in problemasProjeto" :key="x.campo + x.mensagem">{{ x.mensagem }}</li>
        </ul>
        <SanteBotao
          :rotulo="t('incluir')"
          :desabilitado="problemasProjeto.length > 0 || ocupado"
          data-testid="mutirao-gravar"
          @acionar="gravarProjeto"
        />
      </form>

      <ErroCirurgia v-if="detalhe.isError.value" :erro="detalhe.error.value" />
      <article v-if="d" class="projeto" data-testid="mutirao-detalhe" :data-situacao="d.projeto.situacao">
        <h2>{{ d.projeto.codigo }} · {{ d.projeto.descricao }}</h2>
        <p>
          {{ t(`situacoes.${d.projeto.situacao}`) }} ·
          {{
            t('vigencia', {
              de: dataBr(d.projeto.periodoInicio),
              ate: dataBr(d.projeto.periodoFim),
              portaria: d.projeto.portaria ?? '',
            })
          }}
        </p>
        <p data-testid="mutirao-acompanhamento">
          {{
            t('acompanhamento', {
              real: d.acompanhamento.realizada,
              prev: d.acompanhamento.prevista,
              pct: d.acompanhamento.percentual,
              vreal: moeda(d.acompanhamento.valorRealizado),
              vprev: moeda(d.acompanhamento.valorPrevisto),
            })
          }}{{
            d.acompanhamento.decorrido === null
              ? ''
              : t('decorrido', { pct: Math.round(d.acompanhamento.decorrido * 100) })
          }}
        </p>
        <div v-if="podeEditar && editavel" class="linha">
          <SanteBotao
            v-if="d.projeto.situacao === 'planejado'"
            :rotulo="t('iniciar')"
            :desabilitado="ocupado"
            data-testid="mutirao-iniciar"
            @acionar="mudar('em_andamento')"
          />
          <SanteBotao
            v-if="d.projeto.situacao === 'em_andamento'"
            :rotulo="t('encerrar')"
            :desabilitado="ocupado"
            data-testid="mutirao-encerrar"
            @acionar="mudar('encerrado')"
          />
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="t('motivo')"
            :max-bytes="500"
            data-testid="mutirao-motivo"
          />
          <SanteBotao
            variante="texto"
            :rotulo="t('cancelar')"
            :desabilitado="motivo.trim().length < 5 || ocupado"
            data-testid="mutirao-cancelar"
            @acionar="mudar('cancelado')"
          />
        </div>

        <h3>{{ t('metas') }}</h3>
        <ul class="lista" data-testid="mutirao-metas">
          <li v-for="m in d.metas" :key="m.id" :data-ritmo="m.ritmo">
            {{
              t('meta', {
                proc: m.procedimentoDescricao,
                sigtap: m.sigtap ?? '—',
                real: m.realizada,
                prev: m.prevista,
                saldo: m.saldo,
                ritmo: t(`ritmos.${m.ritmo ?? 'sem_vigencia'}`, { n: m.esperadoAteHoje ?? 0 }),
              })
            }}
            <SanteBotao
              v-if="podeEditar && editavel"
              variante="texto"
              :rotulo="t('retirar')"
              @acionar="retirarItem('metas', m.id, m.versao)"
            />
          </li>
        </ul>
        <form v-if="podeEditar && editavel" class="formulario" @submit.prevent>
          <SanteSelecao
            v-model="meta.procedimento"
            :rotulo="t('procedimento')"
            :opcoes="opcoesProcedimento"
            data-testid="mutirao-meta-procedimento"
          />
          <SanteCampoTexto
            v-model="meta.quantidade"
            :rotulo="t('quantidade')"
            :max-bytes="8"
            data-testid="mutirao-meta-quantidade"
          />
          <SanteCampoTexto
            v-model="meta.valor"
            :rotulo="t('valorUnitario')"
            :max-bytes="12"
            data-testid="mutirao-meta-valor"
          />
          <ul class="problemas" data-testid="mutirao-meta-problemas">
            <li v-for="x in problemasMeta" :key="x.campo + x.mensagem">{{ x.mensagem }}</li>
          </ul>
          <SanteBotao
            :rotulo="t('incluirMeta')"
            :desabilitado="meta.procedimento === null || problemasMeta.length > 0 || ocupado"
            data-testid="mutirao-meta-gravar"
            @acionar="gravarMeta"
          />
        </form>

        <h3>{{ t('insumos') }}</h3>
        <ul class="lista">
          <li v-for="i in d.insumos" :key="i.id">
            {{
              t('insumoLinha', { desc: i.descricao, prev: i.quantidadePrevista, uso: i.quantidadeUtilizada })
            }}
            <SanteBotao
              v-if="podeEditar && editavel"
              variante="texto"
              :rotulo="t('retirar')"
              @acionar="retirarItem('insumos', i.id, i.versao)"
            />
          </li>
        </ul>
        <div v-if="podeEditar && editavel" class="linha">
          <SanteSelecao v-model="insumo.id" :rotulo="t('insumo')" :opcoes="opcoesInsumo" />
          <SanteCampoTexto v-model="insumo.quantidade" :rotulo="t('quantidade')" :max-bytes="12" />
          <SanteBotao
            :rotulo="t('incluir')"
            :desabilitado="insumo.id === null || !(numero(insumo.quantidade)! > 0) || ocupado"
            @acionar="gravarInsumo"
          />
        </div>

        <h3>{{ t('fornecedores') }}</h3>
        <ul class="lista">
          <li v-for="f in d.fornecedores" :key="f.id">
            {{ f.nome }}
            <SanteBotao
              v-if="podeEditar && editavel"
              variante="texto"
              :rotulo="t('retirar')"
              @acionar="retirarItem('fornecedores', f.id, f.versao)"
            />
          </li>
        </ul>
        <div v-if="podeEditar && editavel" class="linha">
          <SanteSelecao v-model="fornecedor" :rotulo="t('fornecedor')" :opcoes="opcoesFornecedor" />
          <SanteBotao
            :rotulo="t('incluir')"
            :desabilitado="fornecedor === null || ocupado"
            @acionar="gravarFornecedor"
          />
        </div>

        <h3>{{ t('documentos') }}</h3>
        <p v-if="!d.vinculos.length">{{ t('semDocumentos') }}</p>
        <ul v-else class="lista" data-testid="mutirao-vinculos">
          <li
            v-for="v in d.vinculos"
            :key="v.id"
            :data-testid="`mutirao-vinculo-${v.numero}`"
            :data-situacao="v.situacao"
          >
            {{
              t('documento', {
                tipo: v.tipo.toUpperCase(),
                numero: v.numero,
                paciente: v.paciente ?? '—',
                pront: v.prontuario ?? '—',
                just: v.justificativa,
              })
            }}
            <em v-if="v.situacao === 'retirado'"
              >· {{ t('retirado', { just: v.retiradaJustificativa ?? '' }) }}</em
            >
            <template v-else-if="podeEditar && editavel">
              <SanteBotao
                v-if="retirando !== v.id"
                variante="texto"
                :rotulo="t('retirarDoc')"
                :data-testid="`mutirao-retirar-${v.numero}`"
                @acionar="retirando = v.id"
              />
              <span v-else class="linha">
                <SanteSelecao
                  v-model="justRetirada"
                  :rotulo="t('justRetirada')"
                  :opcoes="opcoesJust('alteracao')"
                  data-testid="mutirao-retirada-justificativa"
                />
                <SanteCampoTexto
                  v-model="complRetirada"
                  :rotulo="t('complemento')"
                  :max-bytes="500"
                  data-testid="mutirao-retirada-complemento"
                />
                <SanteBotao
                  :rotulo="t('confirmarRetirada')"
                  :desabilitado="
                    problemasJust(justRetirada, complRetirada, 'alteracao').length > 0 || ocupado
                  "
                  data-testid="mutirao-retirada-confirmar"
                  @acionar="retirarDoc(v.id, v.versao)"
                />
              </span>
            </template>
          </li>
        </ul>

        <form
          v-if="d.projeto.situacao === 'em_andamento' && opcoesTipo.length"
          class="formulario"
          data-testid="mutirao-marcar"
          @submit.prevent
        >
          <h3>{{ t('marcar') }}</h3>
          <div class="linha">
            <SanteSelecao
              v-model="tipoDoc"
              :rotulo="t('tipo')"
              :opcoes="opcoesTipo"
              data-testid="mutirao-tipo"
            />
            <SanteCampoTexto
              v-model="numeroDoc"
              :rotulo="t('numero')"
              :max-bytes="13"
              data-testid="mutirao-numero"
            />
            <SanteBotao
              :rotulo="t('buscar')"
              :desabilitado="!/^\d{13}$/.test(numeroDoc) || ocupado"
              data-testid="mutirao-conferir"
              @acionar="conferir"
            />
          </div>
          <p v-if="achados && !achados.length" role="status">{{ t('naoAchado') }}</p>
          <ul v-if="achados" class="lista" data-testid="mutirao-achados">
            <li v-for="a in achados" :key="a.id">
              {{
                t('achado', {
                  tipo: a.tipo.toUpperCase(),
                  numero: a.numero,
                  data: dataBr(a.data),
                  paciente: a.paciente ?? '—',
                  sit: a.situacao,
                })
              }}
              <ul v-if="a.problemas.length" class="problemas" data-testid="mutirao-achado-problemas">
                <li v-for="x in a.problemas" :key="x.mensagem">{{ x.mensagem }}</li>
              </ul>
              <template v-else>
                <p>{{ t('podeMarcar') }}</p>
                <SanteSelecao
                  v-model="justInclusao"
                  :rotulo="t('justificativa')"
                  :opcoes="opcoesJust('inclusao')"
                  data-testid="mutirao-justificativa"
                />
                <SanteCampoTexto
                  v-model="complemento"
                  :rotulo="t('complemento')"
                  :max-bytes="500"
                  data-testid="mutirao-complemento"
                />
                <ul class="problemas">
                  <li v-for="x in problemasJust(justInclusao, complemento, 'inclusao')" :key="x.mensagem">
                    {{ x.mensagem }}
                  </li>
                </ul>
                <SanteBotao
                  :rotulo="t('marcarBotao')"
                  :desabilitado="problemasJust(justInclusao, complemento, 'inclusao').length > 0 || ocupado"
                  data-testid="mutirao-marcar-gravar"
                  @acionar="marcar(a)"
                />
              </template>
            </li>
          </ul>
        </form>
      </article>
    </section>

    <section v-if="aba === 'justificativas' && pa" aria-labelledby="just-titulo">
      <h2 id="just-titulo">{{ t('abaJustificativas') }}</h2>
      <ul class="lista" data-testid="mutirao-justificativas">
        <li v-for="j in pa.justificativas" :key="j.id">
          {{
            t('justLinha', {
              codigo: j.codigo,
              descricao: j.descricao,
              usos: j.ativo ? '' : ` · ${t('inativa')}`,
            })
          }}
          <SanteBotao
            v-if="podeEditar"
            variante="texto"
            :rotulo="j.ativo ? t('desativar') : t('reativar')"
            @acionar="rodar(() => ativarJustificativaMutirao(j.id, j.versao, !j.ativo))"
          />
        </li>
      </ul>
      <form v-if="podeEditar" class="formulario" data-testid="mutirao-nova-justificativa" @submit.prevent>
        <h3>{{ t('novaJust') }}</h3>
        <SanteCampoTexto
          v-model="nj.codigo"
          :rotulo="t('codigo')"
          :max-bytes="30"
          data-testid="just-codigo"
        />
        <SanteCampoTexto
          v-model="nj.descricao"
          :rotulo="t('descricao')"
          :max-bytes="150"
          data-testid="just-descricao"
        />
        <label><input v-model="nj.inclusao" type="checkbox" /> {{ t('aplicaInclusao') }}</label>
        <label><input v-model="nj.alteracao" type="checkbox" /> {{ t('aplicaAlteracao') }}</label>
        <label
          ><input v-model="nj.complemento" type="checkbox" data-testid="just-exige" />
          {{ t('exigeComplemento') }}</label
        >
        <SanteBotao
          :rotulo="t('incluir')"
          :desabilitado="
            !nj.codigo.trim() || nj.descricao.trim().length < 3 || (!nj.inclusao && !nj.alteracao) || ocupado
          "
          data-testid="just-gravar"
          @acionar="gravarJust"
        />
      </form>
    </section>

    <p v-if="mensagem" role="status" data-testid="mutirao-mensagem">{{ mensagem }}</p>
    <ErroCirurgia v-if="erro" :erro="erro" />
  </main>
</template>

<style scoped>
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
}
.lista li {
  padding: var(--sgh-espaco-1) 0;
  border-bottom: 1px solid var(--sgh-borda);
}
.problemas {
  color: var(--sgh-texto-secundario);
}
</style>
