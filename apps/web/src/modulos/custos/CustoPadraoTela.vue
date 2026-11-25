<script setup lang="ts">
// Custo-padrão por procedimento (F8, 07-FIN linha 140, C2-115; item `Controladoria > Custos hospitalares > Custo-padrão
// por procedimento`; `custos.apuracao.ler`): a ficha técnica do procedimento com os insumos, os minutos de sala, os gases,
// as diárias e a mão de obra. Ao escolher o item, o custo de referência vigente (custo médio, minuto de sala e de gás,
// diária padrão) já vem preenchido e o custo do item aparece na hora, conferido pela regra do domínio. A ficha ativa não
// muda: uma nova versão começa pelos itens dela e, ativada, encerra a anterior na véspera. A comparação mostra o padrão
// contra o custo apurado das contas da competência que lançaram o procedimento. Gravar pede `custos.apuracao.apurar`; o
// servidor confere tudo de novo. Nada se apaga: o item retirado e a ficha inativada ficam no histórico.
import {
  custoDoItemCent,
  problemasDoItemFicha,
  type SituacaoFichaCusto,
  SITUACOES_FICHA_CUSTO,
  TIPOS_ITEM_FICHA,
  type TipoItemFicha,
  UNIDADE_DO_TIPO,
} from '@sgh/dominio-custos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../casca/sessao/sessao.js';
import {
  ativarFicha,
  criarFicha,
  decimal4,
  type FichaResumo,
  inativarFicha,
  incluirItem,
  lerComparacao,
  lerDecimal4,
  lerFicha,
  lerFichas,
  lerProcedimentos,
  lerReferencias,
  retirarItem,
} from './api-custo-padrao.js';
import { percentual, reais } from './comum-apuracao.js';
import { competenciasAte, rotuloCompetencia } from './comum-custos.js';
import ErroCustos from './ErroCustos.vue';

const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const { permissoes } = usarSessao();
const K = 'custos.custoPadrao';
const hoje = computed(() => {
  if (props.hoje) return props.hoje;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});
const podeGravar = computed(() => permissoes.value.has('custos.apuracao.apurar'));
const dataBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '');

// ---- lista ----
const termo = ref('');
const situacao = ref<SituacaoFichaCusto | ''>('');
const opcoesSituacao = [
  { valor: '' as const, rotulo: t(`${K}.filtro.todas`) },
  ...SITUACOES_FICHA_CUSTO.map((s) => ({ valor: s, rotulo: t(`${K}.situacoes.${s}`) })),
];
const fichas = useQuery({
  queryKey: computed(() => ['custos', 'fichas-padrao', termo.value, situacao.value]),
  queryFn: () => lerFichas(termo.value.trim(), situacao.value),
  retry: false,
});
const vigencia = (f: { vigenciaInicio: string; vigenciaFim: string | null }) =>
  f.vigenciaFim
    ? t(`${K}.lista.ate`, { inicio: dataBr(f.vigenciaInicio), fim: dataBr(f.vigenciaFim) })
    : t(`${K}.lista.desde`, { inicio: dataBr(f.vigenciaInicio) });

// ---- ficha aberta ----
const aberta = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['custos', 'ficha-padrao', aberta.value]),
  queryFn: () => lerFicha(aberta.value!),
  enabled: computed(() => aberta.value !== null),
  retry: false,
});
const ficha = computed(() => (aberta.value === null ? null : (detalhe.data.value ?? null)));
const rascunho = computed(() => ficha.value?.situacao === 'rascunho');

const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
async function atualizar() {
  await cliente.invalidateQueries({ queryKey: ['custos', 'fichas-padrao'] });
  await cliente.invalidateQueries({ queryKey: ['custos', 'ficha-padrao'] });
}
async function executar(acao: () => Promise<string>) {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    mensagem.value = await acao();
    await atualizar();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
function abrir(f: FichaResumo | { id: number }) {
  aberta.value = f.id;
  mensagem.value = null;
  erro.value = null;
  novaAberta.value = false;
}

// ---- nova ficha ----
const novaAberta = ref(false);
const nova = reactive({
  busca: '',
  procedimento: null as number | null,
  descricao: '',
  inicio: null as string | null,
  copiar: true,
});
const procedimentos = useQuery({
  queryKey: computed(() => ['custos', 'fichas-padrao', 'procedimentos', nova.busca.trim()]),
  queryFn: () => lerProcedimentos(nova.busca.trim()),
  enabled: computed(() => novaAberta.value && nova.busca.trim().length >= 2),
  retry: false,
});
const opcoesProcedimento = computed(() => [
  { valor: null, rotulo: t(`${K}.nova.escolha`) },
  ...(procedimentos.data.value ?? []).map((p) => ({ valor: p.id, rotulo: `${p.codigo} — ${p.descricao}` })),
]);
watch(
  () => nova.procedimento,
  (id) => {
    const p = procedimentos.data.value?.find((x) => x.id === id);
    if (p && !nova.descricao.trim()) nova.descricao = p.descricao.slice(0, 200);
  },
);
const novaValida = computed(
  () => nova.procedimento !== null && nova.descricao.trim() !== '' && nova.inicio !== null,
);
function abrirNova() {
  novaAberta.value = true;
  aberta.value = null;
  Object.assign(nova, { busca: '', procedimento: null, descricao: '', inicio: hoje.value, copiar: true });
}
function criar() {
  if (!novaValida.value) return;
  void executar(async () => {
    const r = await criarFicha({
      procedimento: nova.procedimento!,
      descricao: nova.descricao.trim(),
      vigenciaInicio: nova.inicio!,
      vigenciaFim: null,
      setorFuncional: null,
      copiarVigente: nova.copiar,
    });
    novaAberta.value = false;
    aberta.value = r.id;
    return t(`${K}.nova.criada`);
  });
}

// ---- incluir item ----
const item = reactive({
  tipo: 'insumo' as TipoItemFicha,
  busca: '',
  referencia: null as number | null,
  descricao: '',
  quantidade: '1',
  unitario: '',
});
const opcoesTipo = TIPOS_ITEM_FICHA.map((x) => ({ valor: x, rotulo: t(`${K}.tipos.${x}`) }));
const semReferencia = computed(() => item.tipo === 'mao_de_obra' || item.tipo === 'outro');
const referencias = useQuery({
  queryKey: computed(() => ['custos', 'fichas-padrao', 'referencias', item.tipo, item.busca.trim()]),
  queryFn: () => lerReferencias(item.tipo, item.busca.trim()),
  enabled: computed(() => rascunho.value && !semReferencia.value && item.busca.trim().length >= 2),
  retry: false,
});
const opcoesReferencia = computed(() => [
  { valor: null, rotulo: t(`${K}.item.escolha`) },
  ...(referencias.data.value ?? []).map((r) => ({
    valor: r.id,
    rotulo: `${r.codigo} — ${r.descricao}${r.custoUnitario !== null ? ` (R$ ${decimal4(r.custoUnitario)})` : ''}`,
  })),
]);
const referenciaEscolhida = computed(
  () => referencias.data.value?.find((r) => r.id === item.referencia) ?? null,
);
watch(
  () => item.tipo,
  () => Object.assign(item, { busca: '', referencia: null, descricao: '', unitario: '' }),
);
watch(referenciaEscolhida, (r) => {
  item.unitario =
    r?.custoUnitario !== null && r?.custoUnitario !== undefined ? decimal4(r.custoUnitario) : '';
});
const quantidadeLida = computed(() => lerDecimal4(item.quantidade));
const unitarioLido = computed(() => (item.unitario.trim() === '' ? null : lerDecimal4(item.unitario)));
const custoReferencia = computed(() => referenciaEscolhida.value?.custoUnitario ?? null);
const problemasItem = computed(() =>
  problemasDoItemFicha(
    {
      tipo: item.tipo,
      referencia: semReferencia.value ? null : item.referencia,
      descricao: item.descricao.trim() || null,
      quantidade: quantidadeLida.value ?? 0,
      custoUnitario: unitarioLido.value ?? (item.unitario.trim() === '' ? null : -1),
    },
    custoReferencia.value,
  ),
);
const previa = computed(() => {
  const q = quantidadeLida.value;
  const u = unitarioLido.value ?? custoReferencia.value;
  return q !== null && u !== null ? reais(custoDoItemCent(q, u)) : null;
});
function incluir() {
  if (!ficha.value || problemasItem.value.length > 0) return;
  const f = ficha.value;
  void executar(async () => {
    await incluirItem(f.id, {
      versao: f.versao,
      tipo: item.tipo,
      referencia: semReferencia.value ? null : item.referencia,
      descricao: semReferencia.value ? item.descricao.trim() : null,
      quantidade: quantidadeLida.value!,
      custoUnitario: unitarioLido.value,
    });
    Object.assign(item, { busca: '', referencia: null, descricao: '', quantidade: '1', unitario: '' });
    return t(`${K}.item.incluido`);
  });
}
function retirar(id: number) {
  if (!ficha.value) return;
  const f = ficha.value;
  void executar(async () => {
    await retirarItem(f.id, id, f.versao);
    return t(`${K}.ficha.retirado`);
  });
}
function ativar() {
  if (!ficha.value) return;
  const f = ficha.value;
  void executar(async () => {
    await ativarFicha(f.id, f.versao);
    return t(`${K}.ficha.ativada`);
  });
}
const motivo = ref('');
function inativar() {
  if (!ficha.value || !motivo.value.trim()) return;
  const f = ficha.value;
  void executar(async () => {
    await inativarFicha(f.id, f.versao, motivo.value.trim());
    motivo.value = '';
    return t(`${K}.ficha.inativada`);
  });
}

// ---- comparação ----
const competencias = computed(() => competenciasAte(hoje.value.slice(0, 7), 12));
const competencia = ref<string>('');
watch(
  competencias,
  (l) => {
    if (!competencia.value) competencia.value = l[1] ?? l[0] ?? '';
  },
  { immediate: true },
);
const opcoesCompetencia = computed(() =>
  competencias.value.map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) })),
);
const comparacao = useQuery({
  queryKey: computed(() => ['custos', 'ficha-padrao', aberta.value, 'comparacao', competencia.value]),
  queryFn: () => lerComparacao(aberta.value!, competencia.value),
  enabled: computed(() => aberta.value !== null && competencia.value !== ''),
  retry: false,
});
</script>

<template>
  <section class="tela-custos" data-testid="tela-custo-padrao">
    <header>
      <h1>{{ t(`${K}.titulo`) }}</h1>
      <p class="secundario">{{ t(`${K}.subtitulo`) }}</p>
    </header>
    <SanteAlerta v-if="!podeGravar" :texto="t(`${K}.semPermissao`)" variante="info" />

    <div class="campos">
      <SanteCampoTexto
        v-model="termo"
        :rotulo="t(`${K}.filtro.termo`)"
        :max-bytes="100"
        data-testid="cp-filtro-termo"
      />
      <SanteSelecao
        v-model="situacao"
        :rotulo="t(`${K}.filtro.situacao`)"
        :opcoes="opcoesSituacao"
        data-testid="cp-filtro-situacao"
      />
      <div class="acoes">
        <SanteBotao
          v-if="podeGravar"
          :rotulo="t(`${K}.nova.botao`)"
          variante="secundario"
          data-testid="cp-nova"
          @acionar="abrirNova"
        />
      </div>
    </div>

    <ErroCustos v-if="fichas.isError.value" :erro="fichas.error.value" />
    <p v-else-if="fichas.isLoading.value">{{ t(`${K}.carregando`) }}</p>
    <div v-else class="rolagem">
      <p v-if="(fichas.data.value ?? []).length === 0" data-testid="cp-vazia">
        {{ t(`${K}.lista.nenhuma`) }}
      </p>
      <table v-else class="tabela" data-testid="cp-lista">
        <thead>
          <tr>
            <th>{{ t(`${K}.lista.procedimento`) }}</th>
            <th>{{ t(`${K}.lista.versao`) }}</th>
            <th>{{ t(`${K}.lista.vigencia`) }}</th>
            <th>{{ t(`${K}.lista.situacao`) }}</th>
            <th class="numero">{{ t(`${K}.lista.total`) }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in fichas.data.value" :key="f.id" :data-testid="`cp-ficha-${f.id}`">
            <td>
              {{ f.procedimento.codigo }} — {{ f.procedimento.descricao }}
              <div class="secundario">{{ f.descricao }}</div>
            </td>
            <td>{{ f.versaoFicha }}</td>
            <td>{{ vigencia(f) }}</td>
            <td>
              {{ t(`${K}.situacoes.${f.situacao}`) }}
              <span v-if="f.vigenteHoje" class="secundario"> · {{ t(`${K}.lista.vigente`) }}</span>
            </td>
            <td class="numero">{{ reais(f.custoTotal) }}</td>
            <td>
              <SanteBotao :rotulo="t(`${K}.lista.abrir`)" variante="texto" @acionar="abrir(f)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="mensagem" role="status" data-testid="cp-mensagem">{{ mensagem }}</p>
    <ErroCustos v-if="erro" :erro="erro" />

    <section v-if="novaAberta" class="bloco" data-testid="cp-painel-nova">
      <h2>{{ t(`${K}.nova.titulo`) }}</h2>
      <div class="campos">
        <SanteCampoTexto
          v-model="nova.busca"
          :rotulo="t(`${K}.nova.buscar`)"
          :max-bytes="100"
          data-testid="cp-nova-busca"
        />
        <SanteSelecao
          v-model="nova.procedimento"
          :rotulo="t(`${K}.nova.procedimento`)"
          :opcoes="opcoesProcedimento"
          obrigatorio
          data-testid="cp-nova-procedimento"
        />
        <SanteCampoTexto
          v-model="nova.descricao"
          :rotulo="t(`${K}.nova.descricao`)"
          :max-bytes="200"
          obrigatorio
          data-testid="cp-nova-descricao"
        />
        <SanteData
          v-model="nova.inicio"
          :rotulo="t(`${K}.nova.inicio`)"
          editavel
          data-testid="cp-nova-inicio"
        />
      </div>
      <label class="marca">
        <input v-model="nova.copiar" type="checkbox" data-testid="cp-nova-copiar" />
        {{ t(`${K}.nova.copiar`) }}
      </label>
      <div class="acoes">
        <SanteBotao
          :rotulo="t(`${K}.nova.criar`)"
          :desabilitado="!novaValida || ocupado"
          data-testid="cp-nova-criar"
          @acionar="criar"
        />
        <SanteBotao :rotulo="t(`${K}.ficha.fechar`)" variante="texto" @acionar="novaAberta = false" />
      </div>
    </section>

    <ErroCustos v-if="aberta !== null && detalhe.isError.value" :erro="detalhe.error.value" />
    <section v-if="ficha" class="bloco" data-testid="cp-detalhe">
      <h2>
        {{ ficha.procedimento.codigo }} — {{ ficha.procedimento.descricao }} · {{ t(`${K}.lista.versao`) }}
        {{ ficha.versaoFicha }}
      </h2>
      <dl class="dados">
        <dt>{{ t(`${K}.lista.situacao`) }}</dt>
        <dd data-testid="cp-situacao">{{ t(`${K}.situacoes.${ficha.situacao}`) }}</dd>
        <dt>{{ t(`${K}.lista.vigencia`) }}</dt>
        <dd>{{ vigencia(ficha) }}</dd>
        <dt>{{ t(`${K}.ficha.honorario`) }}</dt>
        <dd class="numero">{{ reais(ficha.custoHonorario) }}</dd>
        <dt>{{ t(`${K}.ficha.operacional`) }}</dt>
        <dd class="numero">{{ reais(ficha.custoOperacional) }}</dd>
        <dt>{{ t(`${K}.ficha.total`) }}</dt>
        <dd class="numero total" data-testid="cp-total">{{ reais(ficha.custoTotal) }}</dd>
      </dl>
      <p v-if="Object.keys(ficha.porTipo).length" class="secundario" data-testid="cp-por-tipo">
        {{ t(`${K}.ficha.porTipo`) }}:
        <span v-for="(v, tipo) in ficha.porTipo" :key="tipo">
          {{ `${t(`${K}.tipos.${tipo}`)} ${reais(v ?? 0)};` }}
        </span>
      </p>

      <h2>{{ t(`${K}.ficha.itens`) }}</h2>
      <p v-if="ficha.itens.length === 0">{{ t(`${K}.ficha.semItens`) }}</p>
      <div v-else class="rolagem">
        <table class="tabela" data-testid="cp-itens">
          <thead>
            <tr>
              <th>{{ t(`${K}.ficha.tipo`) }}</th>
              <th>{{ t(`${K}.ficha.item`) }}</th>
              <th class="numero">{{ t(`${K}.ficha.quantidade`) }}</th>
              <th class="numero">{{ t(`${K}.ficha.unitario`) }}</th>
              <th class="numero">{{ t(`${K}.ficha.custo`) }}</th>
              <th v-if="rascunho && podeGravar"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in ficha.itens" :key="i.id" :data-testid="`cp-item-${i.sequencia}`">
              <td>{{ t(`${K}.tipos.${i.tipo}`) }}</td>
              <td>{{ i.codigo ? `${i.codigo} — ` : '' }}{{ i.descricao }}</td>
              <td class="numero">
                {{ decimal4(i.quantidade) }} <span class="secundario">{{ i.unidade }}</span>
              </td>
              <td class="numero">{{ `R$ ${decimal4(i.custoUnitario)}` }}</td>
              <td class="numero">{{ reais(i.custoTotal) }}</td>
              <td v-if="rascunho && podeGravar">
                <SanteBotao
                  :rotulo="t(`${K}.ficha.retirar`)"
                  variante="destrutivo"
                  :confirmacao="t(`${K}.ficha.retirarConfirma`)"
                  :desabilitado="ocupado"
                  @acionar="retirar(i.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section v-if="rascunho && podeGravar" class="bloco" data-testid="cp-painel-item">
        <h2>{{ t(`${K}.item.titulo`) }}</h2>
        <div class="campos">
          <SanteSelecao
            v-model="item.tipo"
            :rotulo="t(`${K}.item.tipo`)"
            :opcoes="opcoesTipo"
            data-testid="cp-item-tipo"
          />
          <template v-if="!semReferencia">
            <SanteCampoTexto
              v-model="item.busca"
              :rotulo="t(`${K}.item.buscar`)"
              :max-bytes="100"
              data-testid="cp-item-busca"
            />
            <SanteSelecao
              v-model="item.referencia"
              :rotulo="t(`${K}.item.referencia`)"
              :opcoes="opcoesReferencia"
              obrigatorio
              data-testid="cp-item-referencia"
            />
          </template>
          <SanteCampoTexto
            v-else
            v-model="item.descricao"
            :rotulo="t(`${K}.item.descricao`)"
            :max-bytes="100"
            obrigatorio
            data-testid="cp-item-descricao"
          />
          <label class="campo-numero">
            {{ t(`${K}.item.quantidade`, { unidade: UNIDADE_DO_TIPO[item.tipo] }) }}
            <input v-model="item.quantidade" inputmode="decimal" data-testid="cp-item-quantidade" />
          </label>
          <label class="campo-numero">
            {{ t(`${K}.item.unitario`) }}
            <input v-model="item.unitario" inputmode="decimal" data-testid="cp-item-unitario" />
          </label>
        </div>
        <p v-if="referenciaEscolhida && custoReferencia !== null" class="secundario">
          {{ t(`${K}.item.referenciaVigente`, { valor: `R$ ${decimal4(custoReferencia)}` }) }}
        </p>
        <p v-else-if="referenciaEscolhida" class="secundario">{{ t(`${K}.item.semReferencia`) }}</p>
        <ul v-if="problemasItem.length" class="secundario" data-testid="cp-item-problemas">
          <li v-for="p in problemasItem" :key="p.codigo">{{ p.detalhe }}</li>
        </ul>
        <p v-if="previa" data-testid="cp-item-previa">{{ t(`${K}.item.previa`, { valor: previa }) }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t(`${K}.item.incluir`)"
            :desabilitado="problemasItem.length > 0 || ocupado"
            data-testid="cp-item-incluir"
            @acionar="incluir"
          />
        </div>
      </section>
      <p v-else-if="!rascunho" class="secundario">{{ t(`${K}.ficha.somenteRascunho`) }}</p>

      <div v-if="podeGravar" class="acoes">
        <SanteBotao
          v-if="rascunho"
          :rotulo="t(`${K}.ficha.ativar`)"
          :confirmacao="t(`${K}.ficha.ativarConfirma`)"
          :desabilitado="ocupado || ficha.itens.length === 0"
          data-testid="cp-ativar"
          @acionar="ativar"
        />
        <template v-if="ficha.situacao !== 'inativa'">
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="t(`${K}.ficha.motivo`)"
            :max-bytes="500"
            data-testid="cp-motivo"
          />
          <SanteBotao
            :rotulo="t(`${K}.ficha.inativar`)"
            variante="secundario"
            :desabilitado="ocupado || !motivo.trim()"
            data-testid="cp-inativar"
            @acionar="inativar"
          />
        </template>
      </div>

      <template v-if="ficha.versoes.length">
        <h2>{{ t(`${K}.ficha.versoes`) }}</h2>
        <ul data-testid="cp-versoes">
          <li v-for="v in ficha.versoes" :key="v.id">
            <SanteBotao
              :rotulo="`${t(`${K}.lista.versao`)} ${v.versaoFicha} · ${t(`${K}.situacoes.${v.situacao}`)} · ${vigencia(v)} · ${reais(v.custoTotal)}`"
              variante="texto"
              @acionar="abrir(v)"
            />
          </li>
        </ul>
      </template>

      <section class="bloco" data-testid="cp-comparacao">
        <h2>{{ t(`${K}.comparar.titulo`) }}</h2>
        <div class="campos">
          <SanteSelecao
            v-model="competencia"
            :rotulo="t(`${K}.comparar.competencia`)"
            :opcoes="opcoesCompetencia"
            data-testid="cp-competencia"
          />
        </div>
        <ErroCustos v-if="comparacao.isError.value" :erro="comparacao.error.value" />
        <template v-else-if="comparacao.data.value">
          <p v-if="!comparacao.data.value.apuracao">{{ t(`${K}.comparar.semApuracao`) }}</p>
          <template v-else>
            <p class="secundario">
              {{
                t(`${K}.comparar.apuracao`, {
                  versao: comparacao.data.value.apuracao.numeroVersao,
                  situacao: comparacao.data.value.apuracao.situacao,
                })
              }}
            </p>
            <p
              v-if="
                comparacao.data.value.linhas.length === 0 && comparacao.data.value.naoComparaveis.length === 0
              "
              data-testid="cp-comparacao-vazia"
            >
              {{ t(`${K}.comparar.semContas`) }}
            </p>
            <p
              v-else-if="comparacao.data.value.linhas.length === 0"
              data-testid="cp-comparacao-sem-comparaveis"
            >
              {{ t(`${K}.comparar.semComparaveis`) }}
            </p>
            <template v-else>
              <p class="secundario" data-testid="cp-comparacao-base">{{ t(`${K}.comparar.base`) }}</p>
              <p data-testid="cp-comparacao-resumo">
                {{
                  t(`${K}.comparar.resumo`, {
                    padrao: reais(comparacao.data.value.totalPadrao),
                    apurado: reais(comparacao.data.value.totalApurado),
                    variacao: reais(comparacao.data.value.variacao),
                    percentual: percentual(comparacao.data.value.variacaoPercentualCent),
                  })
                }}
                {{ t(`${K}.comparar.contagem`, comparacao.data.value.contagem) }}
              </p>
              <div class="rolagem">
                <table class="tabela" data-testid="cp-comparacao-tabela">
                  <thead>
                    <tr>
                      <th>{{ t(`${K}.comparar.conta`) }}</th>
                      <th class="numero">{{ t(`${K}.comparar.quantidade`) }}</th>
                      <th class="numero">{{ t(`${K}.comparar.padrao`) }}</th>
                      <th class="numero">{{ t(`${K}.comparar.apurado`) }}</th>
                      <th class="numero">{{ t(`${K}.comparar.variacao`) }}</th>
                      <th class="numero">{{ t(`${K}.comparar.percentual`) }}</th>
                      <th>{{ t(`${K}.comparar.classe`) }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="l in comparacao.data.value.linhas" :key="l.conta">
                      <td class="conta">{{ l.numero }}</td>
                      <td class="numero">{{ decimal4(l.quantidade) }}</td>
                      <td class="numero">{{ reais(l.custoPadrao) }}</td>
                      <td class="numero">{{ reais(l.custoApurado) }}</td>
                      <td class="numero">{{ reais(l.variacao) }}</td>
                      <td class="numero">{{ percentual(l.variacaoPercentualCent) }}</td>
                      <td>{{ t(`${K}.comparar.classes.${l.classe}`) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
            <template v-if="comparacao.data.value.naoComparaveis.length > 0">
              <h3>{{ t(`${K}.comparar.naoComparaveisTitulo`) }}</h3>
              <p class="secundario">{{ t(`${K}.comparar.naoComparaveisAviso`) }}</p>
              <div class="rolagem">
                <table class="tabela" data-testid="cp-nao-comparaveis">
                  <thead>
                    <tr>
                      <th>{{ t(`${K}.comparar.conta`) }}</th>
                      <th class="numero">{{ t(`${K}.comparar.quantidade`) }}</th>
                      <th class="numero">{{ t(`${K}.comparar.outrosItens`) }}</th>
                      <th class="numero">{{ t(`${K}.comparar.participacao`) }}</th>
                      <th class="numero">{{ t(`${K}.comparar.apuradoConta`) }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="l in comparacao.data.value.naoComparaveis" :key="l.conta">
                      <td class="conta">{{ l.numero }}</td>
                      <td class="numero">{{ decimal4(l.quantidade) }}</td>
                      <td class="numero">{{ l.outrosItens }}</td>
                      <td class="numero">{{ percentual(l.participacaoCent) }}</td>
                      <td class="numero">{{ reais(l.custoApurado) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </template>
        </template>
      </section>

      <div class="acoes">
        <SanteBotao :rotulo="t(`${K}.ficha.fechar`)" variante="texto" @acionar="aberta = null" />
      </div>
    </section>
  </section>
</template>

<style scoped src="./estilo-custos.css"></style>
