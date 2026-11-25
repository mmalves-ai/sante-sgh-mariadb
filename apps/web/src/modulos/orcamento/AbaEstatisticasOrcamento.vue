<script setup lang="ts">
// Aba "Estatísticas e indicadores" do orçamento empresarial (C1-129; ficha 07-FIN linha 131): escolhida a versão do ano,
// o painel dos indicadores (orçado × realizado por grupo, com o atingimento, a situação e a conta com as parcelas por
// setor), a grade indicador × setor × mês com o realizado e a projeção ao lado (um clique copia a projeção para a linha;
// a quantidade é validada na hora pela regra do domínio) e o cadastro dos indicadores (grupo, dado estatístico de origem
// do realizado, visão e projeção). Gravar exige `financeiro.orcamento.editar` e a versão em elaboração (o servidor
// confere de novo); a célula esvaziada é retirada (lógica, nunca apagada).
import {
  type IndicadorOrcamentarioEntrada,
  lerQuantidade,
  PROJECOES_INDICADOR_ORCAMENTARIO,
  type ProjecaoIndicadorOrcamentario,
  quantidadeTexto,
  validarIndicadorOrcamentario,
  VISOES_INDICADOR_ORCAMENTARIO,
  type VisaoIndicadorOrcamentario,
} from '@sgh/dominio-financeiro';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarIndicadorOrcamentario,
  type CelulaParaEnviar,
  criarIndicadorOrcamentario,
  type IndicadorOrcamentarioVisao,
  lerCatalogoIndicadores,
  lerGradeEstatistica,
  lerProjecaoLinha,
  gravarLinhaEstatistica,
  type LinhaDaGrade,
} from './api-estatisticas-orcamento.js';
import { lerVersoesOrcamento } from './api-orcamento.js';
import { anosDoOrcamento, NOMES_MESES } from './comum-orcamento.js';
import ErroOrcamento from './ErroOrcamento.vue';

const props = defineProps<{ hoje: string; podeEditar: boolean }>();
const { t } = useI18n();
const T = (k: string, p: Record<string, unknown> = {}) => t(`orcamentoEmpresarial.estatisticas.${k}`, p);
const cliente = useQueryClient();

const ano = ref<number>(Number(props.hoje.slice(0, 4)));
const opcoesAno = anosDoOrcamento(props.hoje).map((a) => ({ valor: a, rotulo: String(a) }));
const versoes = useQuery({
  queryKey: computed(() => ['orcamento', 'versoes', ano.value]),
  queryFn: () => lerVersoesOrcamento(ano.value),
});
const listaVersoes = computed(() =>
  (versoes.data.value?.versoes ?? []).filter((v) => v.situacao !== 'descartado'),
);
const versaoId = ref<number | null>(null);
watch(listaVersoes, (l) => {
  if (!l.some((v) => v.id === versaoId.value))
    versaoId.value = (l.find((v) => v.situacao === 'rascunho') ?? l[0])?.id ?? null;
});
const opcoesVersao = computed(() =>
  listaVersoes.value.map((v) => ({
    valor: v.id,
    rotulo: T('versaoOpcao', { numero: v.numero, descricao: v.descricao }),
  })),
);
const ate = ref<string | null>(null);
watch(versaoId, () => (ate.value = null));

const catalogo = useQuery({
  queryKey: ['orcamento', 'indicadores-estatisticos'],
  queryFn: lerCatalogoIndicadores,
});
const grade = useQuery({
  queryKey: computed(() => ['orcamento', 'estatisticas', versaoId.value, ate.value]),
  queryFn: () => lerGradeEstatistica(versaoId.value!, ate.value),
  enabled: computed(() => versaoId.value !== null),
});
const g = computed(() => grade.data.value ?? null);
const editavel = computed(() => !!g.value?.editavel && props.podeEditar);
const opcoesAte = computed(() =>
  (g.value?.meses ?? []).map((m) => ({
    valor: m,
    rotulo: `${NOMES_MESES[Number(m.slice(5)) - 1]}/${m.slice(0, 4)}`,
  })),
);
const ateEscolhido = computed<string>({
  get: () => ate.value ?? g.value?.ate ?? '',
  set: (v) => (ate.value = v || null),
});
const nomeMes = (m: string) => NOMES_MESES[Number(m.slice(5)) - 1] ?? m;
const nomeSetor = (id: number) => g.value?.centros.find((c) => c.id === id)?.nome ?? String(id);
const nomeIndicador = (id: number) =>
  catalogo.data.value?.indicadores.find((i) => i.id === id)?.descricao ?? String(id);
const qtd = (c: number | null | undefined) =>
  c === null || c === undefined ? T('painel.vazio') : quantidadeTexto(c);

// ── Grade: rascunho local por linha ────────────────────────────────────────────────────────────────────────────────

const chave = (i: number, c: number) => `${i}|${c}`;
const linhas = ref<LinhaDaGrade[]>([]);
const textos = reactive<Record<string, Record<string, string>>>({});
watch(
  g,
  (x) => {
    linhas.value = [...(x?.linhas ?? [])];
    for (const k of Object.keys(textos)) delete textos[k];
    for (const l of linhas.value) {
      const k = chave(l.indicadorId, l.centroId);
      textos[k] = Object.fromEntries(
        (x?.meses ?? []).map((m) => [m, l.celulas[m] ? quantidadeTexto(l.celulas[m]!.orcadoCent) : '']),
      );
    }
  },
  { immediate: true },
);
const invalida = (k: string, m: string) => lerQuantidade(textos[k]?.[m] ?? '') === 'invalida';
const totalLinha = (k: string) =>
  Object.values(textos[k] ?? {}).reduce((s, v) => {
    const q = lerQuantidade(v);
    return typeof q === 'number' ? s + q : s;
  }, 0);
const linhaInvalida = (k: string) => (g.value?.meses ?? []).some((m) => invalida(k, m));

function usarProjecao(l: LinhaDaGrade): void {
  const k = chave(l.indicadorId, l.centroId);
  for (const m of g.value?.meses ?? []) {
    const p = l.projecao[m];
    if (p !== null && p !== undefined) textos[k]![m] = quantidadeTexto(p);
  }
}

const enviando = ref(false);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

async function gravarLinha(l: LinhaDaGrade): Promise<void> {
  const k = chave(l.indicadorId, l.centroId);
  if (!g.value || enviando.value || linhaInvalida(k)) return;
  const celulas: CelulaParaEnviar[] = [];
  for (const m of g.value.meses) {
    const q = lerQuantidade(textos[k]?.[m] ?? '');
    if (q === 'invalida') return;
    const atual = l.celulas[m];
    if (q === null && !atual) continue;
    if (atual && q === atual.orcadoCent) continue;
    celulas.push({
      competencia: m,
      quantidade: q,
      projetada: l.projecao[m] ?? null,
      versao: atual?.versao ?? null,
    });
  }
  if (!celulas.length) return;
  enviando.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await gravarLinhaEstatistica(g.value.versaoId, {
      indicador: l.indicadorId,
      centro: l.centroId,
      celulas,
    });
    mensagem.value = T('grade.gravada', { ...r });
    await cliente.invalidateQueries({ queryKey: ['orcamento', 'estatisticas'] });
  } catch (x) {
    erro.value = x;
  } finally {
    enviando.value = false;
  }
}

// Nova linha: indicador × setor, com a projeção trazida do realizado.
const novoIndicador = ref<number | null>(null);
const novoSetor = ref<number | null>(null);
const opcoesIndicador = computed(() =>
  (catalogo.data.value?.indicadores ?? [])
    .filter((i) => i.ativo)
    .map((i) => ({ valor: i.id, rotulo: `${i.codigo} · ${i.descricao}` })),
);
const opcoesSetor = computed(() =>
  (g.value?.centros ?? []).map((c) => ({ valor: c.id, rotulo: `${c.codigo} · ${c.nome}` })),
);
const novaRepetida = computed(
  () =>
    novoIndicador.value !== null &&
    novoSetor.value !== null &&
    linhas.value.some((l) => l.indicadorId === novoIndicador.value && l.centroId === novoSetor.value),
);
async function incluirLinha(): Promise<void> {
  if (!g.value || novoIndicador.value === null || novoSetor.value === null || novaRepetida.value) return;
  erro.value = null;
  try {
    const p = await lerProjecaoLinha(g.value.versaoId, novoIndicador.value, novoSetor.value);
    const l: LinhaDaGrade = {
      indicadorId: novoIndicador.value,
      centroId: novoSetor.value,
      celulas: {},
      realizado: p.realizado,
      projecao: p.projecao,
    };
    textos[chave(l.indicadorId, l.centroId)] = Object.fromEntries(g.value.meses.map((m) => [m, '']));
    linhas.value = [...linhas.value, l];
    novoIndicador.value = null;
    novoSetor.value = null;
  } catch (x) {
    erro.value = x;
  }
}

// ── Cadastro dos indicadores ───────────────────────────────────────────────────────────────────────────────────────

const form = reactive({
  codigo: '',
  descricao: '',
  grupoId: null as number | null,
  tipoDadoId: null as number | null,
  unidade: '',
  visao: 'acumulado' as VisaoIndicadorOrcamentario,
  tipoProjecao: 'media' as ProjecaoIndicadorOrcamentario,
  meses: '6',
});
const tocado = ref(false);
const entradaForm = computed<IndicadorOrcamentarioEntrada>(() => ({
  codigo: form.codigo.trim().toUpperCase(),
  descricao: form.descricao.trim(),
  grupoId: form.grupoId,
  tipoDadoId: form.tipoDadoId,
  unidade: form.unidade.trim() || null,
  visao: form.visao,
  tipoProjecao: form.tipoProjecao,
  mesesProjecao: form.tipoProjecao === 'nenhuma' || form.meses.trim() === '' ? null : Number(form.meses),
  observacao: null,
  ativo: true,
}));
const falhas = computed(() => validarIndicadorOrcamentario(entradaForm.value));
const falhaDe = (campo: string) =>
  tocado.value ? (falhas.value.find((f) => f.campo === campo)?.mensagem ?? null) : null;
const opcoesGrupo = computed(() => [
  { valor: null, rotulo: T('indicadores.semGrupo') },
  ...(catalogo.data.value?.grupos ?? []).map((x) => ({ valor: x.id, rotulo: x.descricao })),
]);
const opcoesDado = computed(() => [
  { valor: null, rotulo: T('indicadores.semDado') },
  ...(catalogo.data.value?.tiposDado ?? []).map((x) => ({
    valor: x.id,
    rotulo: `${x.descricao} (${x.unidade})`,
  })),
]);
const opcoesVisao = VISOES_INDICADOR_ORCAMENTARIO.map((v) => ({ valor: v, rotulo: T(`visoes.${v}`) }));
const opcoesProjecao = PROJECOES_INDICADOR_ORCAMENTARIO.map((v) => ({
  valor: v,
  rotulo: T(`projecoes.${v}`),
}));
const nomeGrupo = (id: number | null) =>
  catalogo.data.value?.grupos.find((x) => x.id === id)?.descricao ?? T('indicadores.semGrupo');

async function cadastrar(): Promise<void> {
  tocado.value = true;
  if (falhas.value.length || enviando.value) return;
  enviando.value = true;
  erro.value = null;
  try {
    await criarIndicadorOrcamentario(entradaForm.value);
    mensagem.value = T('indicadores.gravado');
    Object.assign(form, { codigo: '', descricao: '', unidade: '', grupoId: null, tipoDadoId: null });
    tocado.value = false;
    await cliente.invalidateQueries({ queryKey: ['orcamento'] });
  } catch (x) {
    erro.value = x;
  } finally {
    enviando.value = false;
  }
}
async function alternar(i: IndicadorOrcamentarioVisao): Promise<void> {
  if (enviando.value) return;
  enviando.value = true;
  erro.value = null;
  try {
    await alterarIndicadorOrcamentario(i.id, {
      codigo: i.codigo,
      descricao: i.descricao,
      grupoId: i.grupoId,
      tipoDadoId: i.tipoDadoId,
      unidade: i.unidade,
      visao: i.visao,
      tipoProjecao: i.tipoProjecao,
      mesesProjecao: i.mesesProjecao,
      observacao: i.observacao,
      ativo: !i.ativo,
      versao: i.versao,
    });
    mensagem.value = T('indicadores.alterado');
    await cliente.invalidateQueries({ queryKey: ['orcamento'] });
  } catch (x) {
    erro.value = x;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <section class="bloco" aria-labelledby="orc-est-titulo" data-testid="orc-estatisticas">
    <h2 id="orc-est-titulo">{{ T('titulo') }}</h2>
    <p class="secundario">{{ T('ajuda') }}</p>
    <div class="acoes">
      <SanteSelecao v-model="ano" :rotulo="T('ano')" :opcoes="opcoesAno" busca data-testid="orc-est-ano" />
      <SanteSelecao
        v-if="opcoesVersao.length"
        v-model="versaoId"
        :rotulo="T('versao')"
        :opcoes="opcoesVersao"
        data-testid="orc-est-versao"
      />
      <SanteSelecao
        v-if="g"
        v-model="ateEscolhido"
        :rotulo="T('ate')"
        :opcoes="opcoesAte"
        data-testid="orc-est-ate"
      />
    </div>
    <ErroOrcamento v-if="versoes.isError.value" :erro="versoes.error.value" />
    <ErroOrcamento v-if="grade.isError.value" :erro="grade.error.value" />
    <ErroOrcamento v-if="catalogo.isError.value" :erro="catalogo.error.value" />
    <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" anunciar data-testid="orc-est-mensagem" />
    <ErroOrcamento v-if="erro" :erro="erro" />
    <p v-if="versoes.data.value && !opcoesVersao.length" data-testid="orc-est-sem-versao">
      {{ T('nenhumaVersao') }}
    </p>

    <template v-if="g">
      <SanteAlerta v-if="!g.editavel" :texto="T('fechada')" variante="info" data-testid="orc-est-fechada" />

      <section class="bloco" aria-labelledby="orc-est-painel" data-testid="orc-est-painel">
        <h3 id="orc-est-painel">{{ T('painel.titulo') }}</h3>
        <p v-if="!g.painel.length" data-testid="orc-est-painel-vazio">{{ T('painel.nenhum') }}</p>
        <table v-for="grupo in g.painel" :key="grupo.grupo?.id ?? 0" class="tabela">
          <caption>
            {{
              grupo.grupo?.descricao ?? T('painel.semGrupo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ T('painel.colunas.indicador') }}</th>
              <th scope="col">{{ T('painel.colunas.visao') }}</th>
              <th scope="col">{{ T('painel.colunas.orcado') }}</th>
              <th scope="col">{{ T('painel.colunas.realizado') }}</th>
              <th scope="col">{{ T('painel.colunas.desvio') }}</th>
              <th scope="col">{{ T('painel.colunas.atingimento') }}</th>
              <th scope="col">{{ T('painel.colunas.situacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="i in grupo.indicadores" :key="i.indicador.id">
              <tr :data-testid="`orc-est-ind-${i.indicador.codigo}`">
                <th scope="row">
                  {{ i.indicador.descricao }}
                  <span v-if="i.indicador.unidade" class="secundario">({{ i.indicador.unidade }})</span>
                </th>
                <td>{{ T(`visoes.${i.indicador.visao}`) }}</td>
                <td class="numero">{{ qtd(i.orcadoCent) }}</td>
                <td class="numero">{{ qtd(i.realizadoCent) }}</td>
                <td class="numero">{{ qtd(i.desvioCent) }}</td>
                <td class="numero">
                  {{
                    i.atingimentoDecimos === null
                      ? T('painel.vazio')
                      : T('painel.atingimento', {
                          valor: (i.atingimentoDecimos / 10).toFixed(1).replace('.', ','),
                        })
                  }}
                </td>
                <td :data-testid="`orc-est-sit-${i.indicador.codigo}`">
                  {{ T(`painel.situacoes.${i.situacao}`) }}
                </td>
              </tr>
              <tr>
                <td colspan="7" class="secundario" :data-testid="`orc-est-conta-${i.indicador.codigo}`">
                  {{ i.conta }}
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>

      <section class="bloco" aria-labelledby="orc-est-grade" data-testid="orc-est-grade">
        <h3 id="orc-est-grade">{{ T('grade.titulo') }}</h3>
        <p v-if="!linhas.length" data-testid="orc-est-grade-vazia">{{ T('grade.nenhuma') }}</p>
        <div v-else class="rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">{{ T('grade.novaLinha') }}</th>
                <th v-for="m in g.meses" :key="m" scope="col">{{ nomeMes(m) }}</th>
                <th scope="col">{{ T('grade.total') }}</th>
                <th v-if="editavel" scope="col"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="l in linhas" :key="chave(l.indicadorId, l.centroId)">
                <tr :data-testid="`orc-est-linha-${l.indicadorId}-${l.centroId}`">
                  <th scope="row">
                    {{
                      T('grade.linha', {
                        indicador: nomeIndicador(l.indicadorId),
                        setor: nomeSetor(l.centroId),
                      })
                    }}
                  </th>
                  <td v-for="m in g.meses" :key="m">
                    <input
                      v-if="editavel"
                      v-model="textos[chave(l.indicadorId, l.centroId)]![m]"
                      inputmode="decimal"
                      maxlength="16"
                      size="7"
                      :aria-label="
                        T('grade.celula', {
                          linha: T('grade.linha', {
                            indicador: nomeIndicador(l.indicadorId),
                            setor: nomeSetor(l.centroId),
                          }),
                          mes: nomeMes(m),
                        })
                      "
                      :aria-invalid="invalida(chave(l.indicadorId, l.centroId), m)"
                      :placeholder="l.projecao[m] != null ? quantidadeTexto(l.projecao[m]!) : ''"
                      :data-testid="`orc-est-cel-${l.indicadorId}-${l.centroId}-${m}`"
                    />
                    <span v-else>{{
                      textos[chave(l.indicadorId, l.centroId)]?.[m] || T('painel.vazio')
                    }}</span>
                  </td>
                  <td class="numero" :data-testid="`orc-est-total-${l.indicadorId}-${l.centroId}`">
                    {{ quantidadeTexto(totalLinha(chave(l.indicadorId, l.centroId))) }}
                  </td>
                  <td v-if="editavel">
                    <div class="acoes">
                      <SanteBotao
                        variante="secundario"
                        :rotulo="T('grade.usarProjecao')"
                        :desabilitado="enviando"
                        :data-testid="`orc-est-projetar-${l.indicadorId}-${l.centroId}`"
                        @acionar="usarProjecao(l)"
                      />
                      <SanteBotao
                        variante="primario"
                        :rotulo="T('grade.gravar')"
                        :desabilitado="enviando || linhaInvalida(chave(l.indicadorId, l.centroId))"
                        :data-testid="`orc-est-gravar-${l.indicadorId}-${l.centroId}`"
                        @acionar="gravarLinha(l)"
                      />
                    </div>
                  </td>
                </tr>
                <tr class="secundario">
                  <th scope="row">{{ T('grade.realizado') }}</th>
                  <td v-for="m in g.meses" :key="m" class="numero">
                    {{ l.realizado[m] != null ? quantidadeTexto(l.realizado[m]!) : '' }}
                  </td>
                  <td :colspan="editavel ? 2 : 1"></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <p v-if="linhas.some((l) => linhaInvalida(chave(l.indicadorId, l.centroId)))" role="alert">
          {{ T('grade.invalida') }}
        </p>
        <div v-if="editavel" class="acoes" data-testid="orc-est-nova">
          <SanteSelecao
            v-model="novoIndicador"
            :rotulo="T('grade.indicador')"
            :opcoes="opcoesIndicador"
            busca
            data-testid="orc-est-nova-indicador"
          />
          <SanteSelecao
            v-model="novoSetor"
            :rotulo="T('grade.setor')"
            :opcoes="opcoesSetor"
            busca
            data-testid="orc-est-nova-setor"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="T('grade.incluir')"
            :desabilitado="novoIndicador === null || novoSetor === null || novaRepetida"
            data-testid="orc-est-nova-incluir"
            @acionar="incluirLinha"
          />
          <span v-if="novaRepetida" role="alert">{{ T('grade.jaExiste') }}</span>
        </div>
      </section>
    </template>
    <p v-else-if="versaoId === null && opcoesVersao.length">{{ T('escolhaVersao') }}</p>

    <section class="bloco" aria-labelledby="orc-est-ind" data-testid="orc-est-indicadores">
      <h3 id="orc-est-ind">{{ T('indicadores.titulo') }}</h3>
      <p v-if="!catalogo.data.value?.indicadores.length">{{ T('indicadores.nenhum') }}</p>
      <table v-else class="tabela">
        <thead>
          <tr>
            <th scope="col">{{ T('indicadores.colunas.codigo') }}</th>
            <th scope="col">{{ T('indicadores.colunas.descricao') }}</th>
            <th scope="col">{{ T('indicadores.colunas.grupo') }}</th>
            <th scope="col">{{ T('indicadores.colunas.visao') }}</th>
            <th scope="col">{{ T('indicadores.colunas.projecao') }}</th>
            <th scope="col">{{ T('indicadores.colunas.situacao') }}</th>
            <th v-if="props.podeEditar" scope="col">{{ T('indicadores.colunas.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="i in catalogo.data.value?.indicadores ?? []"
            :key="i.id"
            :data-testid="`orc-est-cad-${i.codigo}`"
          >
            <td>{{ i.codigo }}</td>
            <td>{{ i.descricao }}</td>
            <td>{{ nomeGrupo(i.grupoId) }}</td>
            <td>{{ T(`visoes.${i.visao}`) }}</td>
            <td>{{ T(`projecoes.${i.tipoProjecao}`) }}</td>
            <td>{{ i.ativo ? T('indicadores.ativo') : T('indicadores.inativo') }}</td>
            <td v-if="props.podeEditar">
              <SanteBotao
                variante="secundario"
                :rotulo="i.ativo ? T('indicadores.desativar') : T('indicadores.ativar')"
                :desabilitado="enviando"
                :data-testid="`orc-est-alternar-${i.codigo}`"
                @acionar="alternar(i)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <form v-if="props.podeEditar" class="bloco" data-testid="orc-est-form" @submit.prevent="cadastrar">
        <h4>{{ T('indicadores.novo') }}</h4>
        <SanteCampoTexto
          v-model="form.codigo"
          :rotulo="T('indicadores.codigo')"
          :max-bytes="30"
          obrigatorio
          data-testid="orc-est-codigo"
        />
        <span v-if="falhaDe('codigo')" class="secundario" role="alert">{{ falhaDe('codigo') }}</span>
        <SanteCampoTexto
          v-model="form.descricao"
          :rotulo="T('indicadores.descricao')"
          :max-bytes="150"
          obrigatorio
          data-testid="orc-est-descricao"
        />
        <span v-if="falhaDe('descricao')" class="secundario" role="alert">{{ falhaDe('descricao') }}</span>
        <SanteSelecao
          v-model="form.grupoId"
          :rotulo="T('indicadores.grupo')"
          :opcoes="opcoesGrupo"
          data-testid="orc-est-grupo"
        />
        <SanteSelecao
          v-model="form.tipoDadoId"
          :rotulo="T('indicadores.dado')"
          :opcoes="opcoesDado"
          data-testid="orc-est-dado"
        />
        <span v-if="falhaDe('tipoDadoId')" class="secundario" role="alert" data-testid="orc-est-dado-erro">{{
          falhaDe('tipoDadoId')
        }}</span>
        <SanteCampoTexto
          v-model="form.unidade"
          :rotulo="T('indicadores.unidade')"
          :max-bytes="30"
          data-testid="orc-est-unidade"
        />
        <SanteSelecao
          v-model="form.visao"
          :rotulo="T('indicadores.visao')"
          :opcoes="opcoesVisao"
          obrigatorio
          data-testid="orc-est-visao"
        />
        <SanteSelecao
          v-model="form.tipoProjecao"
          :rotulo="T('indicadores.projecao')"
          :opcoes="opcoesProjecao"
          obrigatorio
          data-testid="orc-est-projecao"
        />
        <label v-if="form.tipoProjecao !== 'nenhuma'">
          {{ T('indicadores.meses') }}
          <input
            v-model="form.meses"
            inputmode="numeric"
            maxlength="2"
            size="3"
            :aria-invalid="falhaDe('mesesProjecao') !== null"
            data-testid="orc-est-meses"
          />
        </label>
        <span v-if="falhaDe('mesesProjecao')" class="secundario" role="alert">{{
          falhaDe('mesesProjecao')
        }}</span>
        <div class="acoes">
          <SanteBotao
            tipo="submit"
            variante="primario"
            :rotulo="T('indicadores.gravar')"
            :desabilitado="enviando || (tocado && falhas.length > 0)"
            data-testid="orc-est-gravar-indicador"
          />
        </div>
      </form>
    </section>
  </section>
</template>

<style scoped src="./estilo-orcamento.css"></style>
