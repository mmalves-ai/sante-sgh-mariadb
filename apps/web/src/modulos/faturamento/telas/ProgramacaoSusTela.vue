<script setup lang="ts">
// Programação físico-orçamentária, tetos e cotas SUS (F7, 06-SUS linha 54) — `Faturamento > Faturamento SUS >
// Programação, tetos e cotas`. Uma tela só, pela competência: o saldo de cada limite em vigor (programação vigente,
// teto e cota) contra a produção do BPA, da APAC e da AIH já registrada, com o alerta e o excedente à vista; a
// importação do arquivo da programação do gestor (colado ou lido do disco) que entra em rascunho e é ativada em um
// clique; o teto e a cota incluídos no mesmo formulário; o remanejamento da cota pedido na própria linha e decidido por
// outra pessoa. A crítica da competência consulta o mesmo saldo. A validação aparece enquanto se digita; a regra final
// é a do domínio na API.
import { SanteSelecao } from '@sgh/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import {
  ativarProgramacao,
  cancelarProgramacao,
  decidirRemanejamentoSus,
  importarProgramacao,
  inativarLimiteSus,
  incluirLimiteSus,
  lerOpcoesProgramacao,
  lerPainelProgramacao,
  remanejarCotaSus,
  type SaldoSus,
} from '../api-programacao-sus.js';

const { t } = useI18n();
const cliente = useQueryClient();
const mesAtual = () => new Date().toISOString().slice(0, 7);
const mes = ref(mesAtual());
const competencia = computed(() => mes.value.replace('-', ''));
const painel = useQuery({
  queryKey: computed(() => ['sus', 'programacao', competencia.value]),
  queryFn: () => lerPainelProgramacao(competencia.value),
});
const opcoes = useQuery({ queryKey: ['sus', 'programacao', 'opcoes'], queryFn: lerOpcoesProgramacao });
const podeEditar = computed(() => pode('faturamento.susProgramacao.editar'));
const podeAprovar = computed(() => pode('faturamento.susProgramacao.aprovar'));

const inicioDe = (m: string) => `${m}-01`;
const fimDe = (m: string) => {
  const [a, mm] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10);
};
const moeda = (v: number | null) =>
  v === null
    ? t('faturamentoSus.programacao.semValor')
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qtd = (v: number | null) =>
  v === null ? t('faturamentoSus.programacao.semValor') : v.toLocaleString('pt-BR');
const rotuloSituacao = (x: SaldoSus['situacao']) => t(`faturamentoSus.programacao.situacoes.${x}`);
const rotuloTipo = (x: SaldoSus['tipo']) => t(`faturamentoSus.programacao.tipos.${x}`);

const opContratos = computed(() => [
  { valor: null, rotulo: t('faturamentoSus.programacao.importacao.semContrato') },
  ...(opcoes.data.value?.contratos ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
]);
const opSetores = computed(() => [
  { valor: null, rotulo: t('faturamentoSus.programacao.limite.todosSetores') },
  ...(opcoes.data.value?.setores ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
]);

const erro = ref<unknown>(null);
const aviso = ref('');
const acao = useMutation({
  mutationFn: (x: { fn: () => Promise<unknown>; msg: string }) => x.fn().then(() => x.msg),
  onSuccess: (msg) => {
    erro.value = null;
    aviso.value = msg;
    void cliente.invalidateQueries({ queryKey: ['sus', 'programacao'] });
  },
  onError: (e) => {
    erro.value = e;
    aviso.value = '';
  },
});

// Importação da programação.
const imp = reactive({
  contrato: null as number | null,
  descricao: '',
  inicio: mesAtual(),
  fim: '',
  conteudo: '',
});
const linhasArquivo = computed(
  () => imp.conteudo.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).length,
);
const problemasImp = computed(() => {
  const p: string[] = [];
  if (!imp.inicio) p.push(t('faturamentoSus.programacao.importacao.problemas.inicio'));
  if (imp.fim && imp.fim < imp.inicio) p.push(t('faturamentoSus.programacao.importacao.problemas.fim'));
  if (!linhasArquivo.value) p.push(t('faturamentoSus.programacao.importacao.problemas.conteudo'));
  return p;
});
const lerArquivo = async (ev: Event) => {
  const arq = (ev.target as HTMLInputElement).files?.[0];
  if (arq) imp.conteudo = await arq.text();
};
const importar = () =>
  acao.mutate({
    fn: () =>
      importarProgramacao({
        contrato: imp.contrato,
        descricao: imp.descricao.trim() || null,
        vigenciaInicio: inicioDe(imp.inicio),
        vigenciaFim: imp.fim ? fimDe(imp.fim) : null,
        conteudo: imp.conteudo,
      }),
    msg: t('faturamentoSus.programacao.importacao.importada'),
  });

// Teto e cota.
const lim = reactive({
  tipo: 'teto' as 'teto' | 'cota',
  instrumento: 'todos' as string,
  setor: null as number | null,
  municipio: '',
  codigo: '',
  financiamento: '',
  inicio: mesAtual(),
  fim: '',
  quantidade: '',
  valor: '',
  alerta: '90',
  bloqueia: false,
});
const opTipoLimite = computed(() => [
  { valor: 'teto', rotulo: t('faturamentoSus.programacao.limite.tipoTeto') },
  { valor: 'cota', rotulo: t('faturamentoSus.programacao.limite.tipoCota') },
]);
const opInstrumento = computed(() => [
  ...(lim.tipo === 'teto'
    ? [{ valor: 'todos', rotulo: t('faturamentoSus.programacao.limite.todosInstrumentos') }]
    : []),
  { valor: 'bpa', rotulo: t('faturamentoSus.programacao.limite.bpa') },
  { valor: 'apac', rotulo: t('faturamentoSus.programacao.limite.apac') },
  { valor: 'aih', rotulo: t('faturamentoSus.programacao.limite.aih') },
]);
const problemasLim = computed(() => {
  const p: string[] = [];
  const c = lim.codigo.trim();
  if (c && !/^(\d{2}|\d{4}|\d{6}|\d{10})$/.test(c))
    p.push(t('faturamentoSus.programacao.limite.problemas.codigo'));
  if (!lim.quantidade && !lim.valor) p.push(t('faturamentoSus.programacao.limite.problemas.valores'));
  if (lim.tipo === 'cota' && (!lim.quantidade || lim.instrumento === 'todos'))
    p.push(t('faturamentoSus.programacao.limite.problemas.cota'));
  if (lim.municipio && !/^\d{6,7}$/.test(lim.municipio))
    p.push(t('faturamentoSus.programacao.limite.problemas.municipio'));
  if (lim.financiamento && !/^\d{2}$/.test(lim.financiamento))
    p.push(t('faturamentoSus.programacao.limite.problemas.financiamento'));
  if (lim.fim && lim.fim < lim.inicio) p.push(t('faturamentoSus.programacao.limite.problemas.fim'));
  return p;
});
const incluirLimite = () => {
  const c = lim.codigo.trim();
  acao.mutate({
    fn: () =>
      incluirLimiteSus({
        tipo: lim.tipo,
        instrumento: lim.tipo === 'cota' && lim.instrumento === 'todos' ? 'bpa' : lim.instrumento,
        setor: lim.setor,
        municipio: lim.tipo === 'cota' && lim.municipio ? lim.municipio : null,
        procedimento: c.length === 10 ? c : null,
        grupo: c && c.length < 10 ? c : null,
        financiamento: lim.tipo === 'teto' && lim.financiamento ? lim.financiamento : null,
        vigenciaInicio: inicioDe(lim.inicio),
        vigenciaFim: lim.fim ? fimDe(lim.fim) : null,
        quantidade: lim.quantidade ? Number(lim.quantidade) : null,
        valor: lim.valor ? Number(lim.valor.replace(',', '.')) : null,
        percentualAlerta: lim.tipo === 'teto' ? Number(lim.alerta) : null,
        bloqueia: lim.tipo === 'teto' && lim.bloqueia,
      }),
    msg:
      lim.tipo === 'teto'
        ? t('faturamentoSus.programacao.limite.tetoIncluido')
        : t('faturamentoSus.programacao.limite.cotaIncluida'),
  });
};
const inativar = (s: SaldoSus) => {
  if (s.tipo === 'programacao' || s.versao === null) return;
  if (!window.confirm(t('faturamentoSus.programacao.saldos.confirmarInativar'))) return;
  const tipo = s.tipo;
  const versao = s.versao;
  acao.mutate({
    fn: () => inativarLimiteSus(tipo, s.id, versao),
    msg: t('faturamentoSus.programacao.saldos.inativado'),
  });
};

// Remanejamento da cota (na própria linha).
const remanejando = ref<number | null>(null);
const rem = reactive({
  tipo: 'setor' as 'setor' | 'municipio',
  setor: null as number | null,
  municipio: '',
  quantidade: '',
  valor: '',
  motivo: '',
});
const opTipoRem = computed(() => [
  { valor: 'setor', rotulo: t('faturamentoSus.programacao.remanejamento.paraSetor') },
  { valor: 'municipio', rotulo: t('faturamentoSus.programacao.remanejamento.paraMunicipio') },
]);
const saldoDe = (id: number) =>
  painel.data.value?.saldos.find((x) => x.tipo === 'cota' && x.id === id) ?? null;
const problemasRem = computed(() => {
  const p: string[] = [];
  const s = remanejando.value === null ? null : saldoDe(remanejando.value);
  const q = Number(rem.quantidade || 0);
  if (!q && !rem.valor) p.push(t('faturamentoSus.programacao.remanejamento.problemas.quantidade'));
  if (s && s.saldoQuantidade !== null && q > s.saldoQuantidade)
    p.push(
      t('faturamentoSus.programacao.remanejamento.problemas.saldo', {
        saldo: Math.max(0, s.saldoQuantidade),
      }),
    );
  if (rem.tipo === 'setor' && rem.setor === null)
    p.push(t('faturamentoSus.programacao.remanejamento.problemas.setor'));
  if (rem.tipo === 'municipio' && !/^\d{6,7}$/.test(rem.municipio))
    p.push(t('faturamentoSus.programacao.remanejamento.problemas.municipio'));
  if (rem.motivo.trim().length < 10) p.push(t('faturamentoSus.programacao.remanejamento.problemas.motivo'));
  return p;
});
const remanejar = () => {
  const id = remanejando.value;
  if (id === null) return;
  acao.mutate({
    fn: () =>
      remanejarCotaSus(id, {
        competencia: competencia.value,
        tipo: rem.tipo,
        destinoSetor: rem.tipo === 'setor' ? rem.setor : null,
        destinoMunicipio: rem.tipo === 'municipio' ? rem.municipio : null,
        quantidade: rem.quantidade ? Number(rem.quantidade) : null,
        valor: rem.valor ? Number(rem.valor.replace(',', '.')) : null,
        motivo: rem.motivo.trim(),
      }).then(() => {
        remanejando.value = null;
      }),
    msg: t('faturamentoSus.programacao.remanejamento.pedido'),
  });
};
const decidir = (id: number, versao: number, aprovar: boolean) => {
  if (!aprovar && !window.confirm(t('faturamentoSus.programacao.remanejamento.confirmarRecusa'))) return;
  acao.mutate({
    fn: () => decidirRemanejamentoSus(id, { aprovar, competencia: competencia.value, versao }),
    msg: aprovar
      ? t('faturamentoSus.programacao.remanejamento.aprovado')
      : t('faturamentoSus.programacao.remanejamento.recusado'),
  });
};
</script>

<template>
  <section class="tela" aria-labelledby="programacao-sus-titulo" data-testid="tela-programacao-sus">
    <h1 id="programacao-sus-titulo">{{ t('faturamentoSus.programacao.titulo') }}</h1>
    <p>{{ t('faturamentoSus.programacao.explicacao') }}</p>
    <RouterLink to="/faturamento/sus/contratualizacao">{{
      t('faturamentoSus.programacao.linkContratualizacao')
    }}</RouterLink>
    <span aria-hidden="true">{{ t('faturamentoSus.programacao.separador') }}</span>
    <RouterLink to="/faturamento/sus/bpa">{{ t('faturamentoSus.programacao.linkBpa') }}</RouterLink>
    <label class="campo">
      {{ t('faturamentoSus.programacao.competencia') }}
      <input v-model="mes" type="month" data-testid="programacao-competencia" />
    </label>
    <p v-if="aviso" role="status" data-testid="programacao-aviso">{{ aviso }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />

    <template v-else-if="painel.data.value">
      <p data-testid="programacao-registros">
        {{ t('faturamentoSus.programacao.registros', painel.data.value.registros) }}
      </p>
      <table data-testid="tabela-saldos">
        <caption>
          {{
            t('faturamentoSus.programacao.saldos.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('faturamentoSus.programacao.saldos.limite') }}</th>
            <th scope="col">{{ t('faturamentoSus.programacao.saldos.quantidade') }}</th>
            <th scope="col">{{ t('faturamentoSus.programacao.saldos.valor') }}</th>
            <th scope="col">{{ t('faturamentoSus.programacao.saldos.saldo') }}</th>
            <th scope="col">{{ t('faturamentoSus.programacao.saldos.uso') }}</th>
            <th scope="col">{{ t('faturamentoSus.programacao.saldos.situacao') }}</th>
            <th scope="col">
              <span class="visualmente-oculto">{{ t('faturamentoSus.programacao.saldos.acoes') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!painel.data.value.saldos.length">
            <td colspan="7">{{ t('faturamentoSus.programacao.saldos.vazio') }}</td>
          </tr>
          <template v-for="s in painel.data.value.saldos" :key="`${s.tipo}-${s.id}`">
            <tr :data-testid="`saldo-${s.tipo}-${s.id}`">
              <th scope="row">
                {{
                  t('faturamentoSus.programacao.saldos.linha', {
                    tipo: rotuloTipo(s.tipo),
                    descricao: s.descricao,
                  })
                }}
              </th>
              <td>
                {{
                  t('faturamentoSus.programacao.saldos.par', {
                    consumo: qtd(s.consumoQuantidade),
                    limite: qtd(s.quantidade),
                  })
                }}
              </td>
              <td>
                {{
                  t('faturamentoSus.programacao.saldos.par', {
                    consumo: moeda(s.consumoValor),
                    limite: moeda(s.valor),
                  })
                }}
              </td>
              <td>
                {{ s.saldoQuantidade !== null ? qtd(s.saldoQuantidade) : '' }}
                {{ s.saldoValor !== null ? moeda(s.saldoValor) : '' }}
              </td>
              <td>
                {{
                  s.percentual === null
                    ? t('faturamentoSus.programacao.semValor')
                    : t('faturamentoSus.programacao.saldos.percentual', { p: s.percentual })
                }}
              </td>
              <td :data-situacao="s.situacao">
                <strong>{{ rotuloSituacao(s.situacao) }}</strong>
                <span v-if="s.excedentes">{{
                  t('faturamentoSus.programacao.saldos.excedentes', { n: s.excedentes })
                }}</span>
                <span v-if="s.bloqueia">{{ t('faturamentoSus.programacao.saldos.bloqueia') }}</span>
              </td>
              <td>
                <button
                  v-if="podeEditar && s.tipo === 'cota'"
                  type="button"
                  :data-testid="`remanejar-${s.id}`"
                  @click="remanejando = remanejando === s.id ? null : s.id"
                >
                  {{ t('faturamentoSus.programacao.saldos.remanejar') }}
                </button>
                <button
                  v-if="podeEditar && s.tipo !== 'programacao'"
                  type="button"
                  :data-testid="`inativar-${s.tipo}-${s.id}`"
                  @click="inativar(s)"
                >
                  {{ t('faturamentoSus.programacao.saldos.inativar') }}
                </button>
              </td>
            </tr>
            <tr v-if="remanejando === s.id">
              <td colspan="7">
                <form data-testid="form-remanejar" @submit.prevent="remanejar">
                  <SanteSelecao
                    v-model="rem.tipo"
                    :rotulo="t('faturamentoSus.programacao.remanejamento.tipo')"
                    :opcoes="opTipoRem"
                    data-testid="rem-tipo"
                  />
                  <SanteSelecao
                    v-if="rem.tipo === 'setor'"
                    v-model="rem.setor"
                    :rotulo="t('faturamentoSus.programacao.remanejamento.setor')"
                    :opcoes="opSetores"
                    data-testid="rem-setor"
                  />
                  <label v-else class="campo">
                    {{ t('faturamentoSus.programacao.remanejamento.municipio') }}
                    <input
                      v-model="rem.municipio"
                      inputmode="numeric"
                      maxlength="7"
                      data-testid="rem-municipio"
                    />
                  </label>
                  <label class="campo">
                    {{ t('faturamentoSus.programacao.remanejamento.quantidade') }}
                    <input v-model="rem.quantidade" inputmode="decimal" data-testid="rem-quantidade" />
                  </label>
                  <label class="campo">
                    {{ t('faturamentoSus.programacao.remanejamento.valor') }}
                    <input v-model="rem.valor" inputmode="decimal" data-testid="rem-valor" />
                  </label>
                  <label class="campo">
                    {{ t('faturamentoSus.programacao.remanejamento.motivo') }}
                    <textarea v-model="rem.motivo" rows="2" maxlength="1000" data-testid="rem-motivo" />
                  </label>
                  <ul v-if="problemasRem.length" data-testid="rem-problemas">
                    <li v-for="p in problemasRem" :key="p">{{ p }}</li>
                  </ul>
                  <button type="submit" :disabled="problemasRem.length > 0" data-testid="rem-pedir">
                    {{ t('faturamentoSus.programacao.remanejamento.pedir') }}
                  </button>
                </form>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <h2>{{ t('faturamentoSus.programacao.remanejamento.titulo') }}</h2>
      <p v-if="!painel.data.value.remanejamentos.length">
        {{ t('faturamentoSus.programacao.remanejamento.vazio') }}
      </p>
      <ul v-else data-testid="lista-remanejamentos">
        <li v-for="r in painel.data.value.remanejamentos" :key="r.id" :data-testid="`remanejamento-${r.id}`">
          {{
            t('faturamentoSus.programacao.remanejamento.linha', {
              cota: r.cota,
              origem: r.origem ?? t('faturamentoSus.programacao.semValor'),
              destino: r.destino ?? t('faturamentoSus.programacao.semValor'),
              quantidade: qtd(r.quantidade),
              valor: r.valor !== null ? moeda(r.valor) : '',
              motivo: r.motivo,
            })
          }}
          <strong>{{ r.situacao }}</strong>
          <template v-if="r.situacao === 'solicitada' && podeAprovar && !r.doUsuario">
            <button type="button" :data-testid="`aprovar-${r.id}`" @click="decidir(r.id, r.versao, true)">
              {{ t('faturamentoSus.programacao.remanejamento.aprovar') }}
            </button>
            <button type="button" :data-testid="`recusar-${r.id}`" @click="decidir(r.id, r.versao, false)">
              {{ t('faturamentoSus.programacao.remanejamento.recusar') }}
            </button>
          </template>
          <span v-else-if="r.situacao === 'solicitada' && r.doUsuario">{{
            t('faturamentoSus.programacao.remanejamento.outraPessoa')
          }}</span>
        </li>
      </ul>

      <h2>{{ t('faturamentoSus.programacao.programacoes.titulo') }}</h2>
      <table data-testid="tabela-programacoes">
        <caption class="visualmente-oculto">
          {{
            t('faturamentoSus.programacao.programacoes.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('faturamentoSus.programacao.programacoes.programacao') }}</th>
            <th scope="col">{{ t('faturamentoSus.programacao.programacoes.vigencia') }}</th>
            <th scope="col">{{ t('faturamentoSus.programacao.programacoes.metas') }}</th>
            <th scope="col">{{ t('faturamentoSus.programacao.programacoes.valor') }}</th>
            <th scope="col">{{ t('faturamentoSus.programacao.programacoes.situacao') }}</th>
            <th scope="col">
              <span class="visualmente-oculto">{{ t('faturamentoSus.programacao.programacoes.acoes') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in painel.data.value.programacoes" :key="p.id" :data-testid="`programacao-${p.id}`">
            <th scope="row">
              {{ p.descricao ?? t('faturamentoSus.programacao.programacoes.semDescricao', { id: p.id }) }}
              {{
                p.contratoNumero
                  ? t('faturamentoSus.programacao.programacoes.contrato', { numero: p.contratoNumero })
                  : ''
              }}
            </th>
            <td>
              {{
                t('faturamentoSus.programacao.programacoes.periodo', {
                  inicio: p.vigenciaInicio.slice(0, 7),
                  fim: p.vigenciaFim
                    ? p.vigenciaFim.slice(0, 7)
                    : t('faturamentoSus.programacao.programacoes.emAberto'),
                })
              }}
            </td>
            <td>{{ p.itens }}</td>
            <td>{{ moeda(p.valorTotal) }}</td>
            <td>{{ p.situacao }}</td>
            <td>
              <template v-if="podeEditar && p.situacao === 'rascunho'">
                <button
                  type="button"
                  :data-testid="`ativar-${p.id}`"
                  @click="
                    acao.mutate({
                      fn: () => ativarProgramacao(p.id, p.versao),
                      msg: t('faturamentoSus.programacao.programacoes.ativada'),
                    })
                  "
                >
                  {{ t('faturamentoSus.programacao.programacoes.ativar') }}
                </button>
                <button
                  type="button"
                  :data-testid="`cancelar-${p.id}`"
                  @click="
                    acao.mutate({
                      fn: () => cancelarProgramacao(p.id, p.versao),
                      msg: t('faturamentoSus.programacao.programacoes.cancelada'),
                    })
                  "
                >
                  {{ t('faturamentoSus.programacao.programacoes.cancelar') }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-if="podeEditar">
      <h2>{{ t('faturamentoSus.programacao.importacao.titulo') }}</h2>
      <form data-testid="form-importar" @submit.prevent="importar">
        <SanteSelecao
          v-model="imp.contrato"
          :rotulo="t('faturamentoSus.programacao.importacao.contrato')"
          :opcoes="opContratos"
          data-testid="imp-contrato"
        />
        <label class="campo">
          {{ t('faturamentoSus.programacao.importacao.descricao') }}
          <input v-model="imp.descricao" maxlength="150" data-testid="imp-descricao" />
        </label>
        <label class="campo">
          {{ t('faturamentoSus.programacao.importacao.inicio') }}
          <input v-model="imp.inicio" type="month" data-testid="imp-inicio" />
        </label>
        <label class="campo">
          {{ t('faturamentoSus.programacao.importacao.fim') }}
          <input v-model="imp.fim" type="month" data-testid="imp-fim" />
        </label>
        <label class="campo">
          {{ t('faturamentoSus.programacao.importacao.arquivo') }}
          <input type="file" accept=".txt,.csv" data-testid="imp-arquivo" @change="lerArquivo" />
        </label>
        <label class="campo">
          {{ t('faturamentoSus.programacao.importacao.conteudo') }}
          <textarea v-model="imp.conteudo" rows="6" data-testid="imp-conteudo" />
        </label>
        <p>{{ t('faturamentoSus.programacao.importacao.linhas', { n: linhasArquivo }) }}</p>
        <ul v-if="problemasImp.length" data-testid="imp-problemas">
          <li v-for="p in problemasImp" :key="p">{{ p }}</li>
        </ul>
        <button type="submit" :disabled="problemasImp.length > 0" data-testid="imp-enviar">
          {{ t('faturamentoSus.programacao.importacao.enviar') }}
        </button>
      </form>

      <h2>{{ t('faturamentoSus.programacao.limite.titulo') }}</h2>
      <form data-testid="form-limite" @submit.prevent="incluirLimite">
        <SanteSelecao
          v-model="lim.tipo"
          :rotulo="t('faturamentoSus.programacao.limite.tipo')"
          :opcoes="opTipoLimite"
          data-testid="lim-tipo"
        />
        <SanteSelecao
          v-model="lim.instrumento"
          :rotulo="t('faturamentoSus.programacao.limite.instrumento')"
          :opcoes="opInstrumento"
          data-testid="lim-instrumento"
        />
        <SanteSelecao
          v-model="lim.setor"
          :rotulo="t('faturamentoSus.programacao.limite.setor')"
          :opcoes="opSetores"
          data-testid="lim-setor"
        />
        <label v-if="lim.tipo === 'cota'" class="campo">
          {{ t('faturamentoSus.programacao.limite.municipio') }}
          <input v-model="lim.municipio" inputmode="numeric" maxlength="7" data-testid="lim-municipio" />
        </label>
        <label class="campo">
          {{ t('faturamentoSus.programacao.limite.codigo') }}
          <input v-model="lim.codigo" inputmode="numeric" maxlength="10" data-testid="lim-codigo" />
        </label>
        <label v-if="lim.tipo === 'teto'" class="campo">
          {{ t('faturamentoSus.programacao.limite.financiamento') }}
          <input
            v-model="lim.financiamento"
            inputmode="numeric"
            maxlength="2"
            data-testid="lim-financiamento"
          />
        </label>
        <label class="campo">
          {{ t('faturamentoSus.programacao.limite.inicio') }}
          <input v-model="lim.inicio" type="month" data-testid="lim-inicio" />
        </label>
        <label class="campo">
          {{ t('faturamentoSus.programacao.limite.fim') }}
          <input v-model="lim.fim" type="month" data-testid="lim-fim" />
        </label>
        <label class="campo">
          {{ t('faturamentoSus.programacao.limite.quantidade') }}
          <input v-model="lim.quantidade" inputmode="decimal" data-testid="lim-quantidade" />
        </label>
        <label class="campo">
          {{ t('faturamentoSus.programacao.limite.valor') }}
          <input v-model="lim.valor" inputmode="decimal" data-testid="lim-valor" />
        </label>
        <template v-if="lim.tipo === 'teto'">
          <label class="campo">
            {{ t('faturamentoSus.programacao.limite.alerta') }}
            <input v-model="lim.alerta" inputmode="numeric" maxlength="3" data-testid="lim-alerta" />
          </label>
          <label>
            <input v-model="lim.bloqueia" type="checkbox" data-testid="lim-bloqueia" />
            {{ t('faturamentoSus.programacao.limite.bloqueia') }}
          </label>
        </template>
        <ul v-if="problemasLim.length" data-testid="lim-problemas">
          <li v-for="p in problemasLim" :key="p">{{ p }}</li>
        </ul>
        <button type="submit" :disabled="problemasLim.length > 0" data-testid="lim-incluir">
          {{ t('faturamentoSus.programacao.limite.incluir') }}
        </button>
      </form>
    </template>
  </section>
</template>
