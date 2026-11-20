<script setup lang="ts">
// Aba "Cálculo" (M53.3, etapa F2; `pessoas.folha.ler`, gravações com `pessoas.folha.calcular`): o cálculo mensal da
// empresa e competência. A prévia calcula sem gravar; calcular grava depois da confirmação (o recálculo substitui o em
// vigor, que fica no histórico); as pendências que barram vêm traduzidas, só com IDs de vínculo. Os totais trazem a
// prova da soma com as parcelas impressas (proventos − descontos = líquido, no total e na soma dos colaboradores); a
// grade lista os colaboradores (filtro e ordem locais sobre a resposta inteira) e abre a memória de cada um (leitura
// auditada no servidor). O descarte pede motivo. O servidor confere tudo de novo.
import {
  type ApoioCalculoFolha,
  type ColaboradorCalculado,
  type ConferenciaCalculoFolha,
  esquemaDescartarProcessoFolha,
  type LinhaCalculoFolha,
  type PendenciaCalculo,
  type ResultadoCalculoFolha,
  type ResumoProcessoFolha,
  type TotaisCalculoFolha,
  TIPOS_LINHA_FOLHA,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../pessoas/comum.js';
import { instanteBr, rotuloCompetencia } from '../comum-folha.js';
import ErroFolha from '../telas/ErroFolha.vue';
import {
  calcularFolha,
  descartarCalculo,
  lerCalculos,
  lerDetalheCalculo,
  lerLinhasDoVinculo,
  urlConferenciaPdf,
} from './api-calculo.js';
import {
  type CampoGrade,
  filtrarColaboradores,
  quantidadeDaLinha,
  reais,
  somaDoTipo,
} from './comum-calculo.js';

const props = defineProps<{ apoio: ApoioCalculoFolha; empresa: number | null; competencia: string | null }>();
const { t } = useI18n();
const cliente = useQueryClient();
const pronto = computed(() => props.empresa !== null && props.competencia !== null);
const pode = computed(() => props.apoio.gravacao.ligada && props.apoio.acoes.calcular);
/** Valores e memória por colaborador revelam o salário: só com a permissão de consultá-lo (D-PERM-SAL-533). */
const verSalario = computed(() => props.apoio.acoes.verSalario);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);

const lista = useQuery({
  queryKey: computed(() => ['folha', 'calculos', props.empresa, props.competencia]),
  queryFn: () => lerCalculos({ empresa: props.empresa, competencia: props.competencia }),
  enabled: pronto,
});
const historico = computed(() => lista.data.value?.itens ?? null);
const vigente = computed(() => historico.value?.find((p) => p.situacao === 'calculada') ?? null);
const detalhe = useQuery({
  queryKey: computed(() => ['folha', 'calculo', vigente.value?.id ?? null]),
  queryFn: () => lerDetalheCalculo(vigente.value!.id),
  enabled: computed(() => vigente.value !== null),
});

// ── Prévia e cálculo ────────────────────────────────────────────────────────────────────────────────────────
const previa = ref<ResultadoCalculoFolha | null>(null);
const pendencias = ref<readonly PendenciaCalculo[]>([]);
const ocupado = ref(false);
watch(
  () => [props.empresa, props.competencia],
  () => {
    previa.value = null;
    pendencias.value = [];
    aviso.value = null;
    erro.value = null;
    filtro.value = '';
  },
);
async function verPrevia(): Promise<void> {
  if (!pronto.value) return;
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    const r = await calcularFolha({
      empresa: props.empresa!,
      competencia: props.competencia!,
      simular: true,
    });
    pendencias.value = r.pendencias;
    previa.value = r.pendencias.length === 0 ? r : null;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
const confirmando = ref(false);
async function calcular(): Promise<void> {
  if (!pronto.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await calcularFolha({
      empresa: props.empresa!,
      competencia: props.competencia!,
      simular: false,
    });
    confirmando.value = false;
    pendencias.value = r.pendencias;
    if (r.calculado && r.processo) {
      previa.value = null;
      aviso.value = [
        t('folha.calculo.calculado', { numero: r.processo.numero }),
        r.substituido ? t('folha.calculo.substituiu', { id: r.substituido }) : '',
      ]
        .filter(Boolean)
        .join(' ');
      await cliente.invalidateQueries({ queryKey: ['folha', 'calculos'] });
    }
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── O que a tela mostra: a prévia (se pedida) ou o cálculo em vigor ─────────────────────────────────────────
interface Visto {
  readonly origem: 'previa' | 'vigente';
  readonly processo: ResumoProcessoFolha | null;
  readonly totais: TotaisCalculoFolha;
  readonly colaboradores: readonly ColaboradorCalculado[];
  /** A lista por colaborador foi omitida (sem a permissão de consultar o salário; D-PERM-SAL-533). */
  readonly ocultos: boolean;
  readonly conferencia: ConferenciaCalculoFolha;
}
const visto = computed<Visto | null>(() => {
  const p = previa.value;
  if (p?.totais && p.conferencia)
    return {
      origem: 'previa',
      processo: null,
      totais: p.totais,
      colaboradores: p.colaboradores,
      ocultos: false,
      conferencia: p.conferencia,
    };
  const d = detalhe.data.value;
  if (d && vigente.value && d.processo.id === vigente.value.id)
    return {
      origem: 'vigente',
      processo: d.processo,
      totais: d.processo.totais,
      colaboradores: d.colaboradores,
      ocultos: d.colaboradoresOcultos,
      conferencia: d.conferencia,
    };
  return null;
});
const encargos = computed(() => {
  const x = visto.value?.totais;
  return x ? x.inssPatronal + x.rat + x.terceiros : 0;
});
const custo = computed(() => {
  const x = visto.value?.totais;
  return x ? x.proventos + encargos.value + x.fgts : 0;
});

// ── Grade ───────────────────────────────────────────────────────────────────────────────────────────────────
const filtro = ref('');
const ordem = ref<{ campo: CampoGrade; direcao: 'asc' | 'desc' }>({ campo: 'vinculo', direcao: 'asc' });
const COLUNAS: readonly CampoGrade[] = ['proventos', 'descontos', 'liquido', 'encargos'];
function ordenar(campo: CampoGrade): void {
  ordem.value =
    ordem.value.campo === campo
      ? { campo, direcao: ordem.value.direcao === 'asc' ? 'desc' : 'asc' }
      : { campo, direcao: campo === 'vinculo' ? 'asc' : 'desc' };
}
const linhasGrade = computed(() =>
  visto.value ? filtrarColaboradores(visto.value.colaboradores, filtro.value, ordem.value) : [],
);
const ariaOrdem = (campo: CampoGrade) =>
  ordem.value.campo === campo ? (ordem.value.direcao === 'asc' ? 'ascending' : 'descending') : 'none';
const quem = (c: { vinculo: number; matricula: string | null }) =>
  c.matricula
    ? `${t('folha.matricula', { m: c.matricula })} · ${t('folha.vinculo', { v: c.vinculo })}`
    : t('folha.vinculo', { v: c.vinculo });

// ── Memória do colaborador ──────────────────────────────────────────────────────────────────────────────────
const memoriaVisivel = ref(false);
const memoriaDe = ref<ColaboradorCalculado | null>(null);
const linhas = ref<readonly LinhaCalculoFolha[] | null>(null);
const erroMemoria = ref<unknown>(null);
async function verMemoria(c: ColaboradorCalculado): Promise<void> {
  const p = visto.value?.processo;
  if (!p) return;
  memoriaDe.value = c;
  linhas.value = null;
  erroMemoria.value = null;
  memoriaVisivel.value = true;
  try {
    linhas.value = (await lerLinhasDoVinculo(p.id, c.vinculo)).linhas;
  } catch (x) {
    erroMemoria.value = x;
  }
}
const linhasPorTipo = computed(() =>
  TIPOS_LINHA_FOLHA.map((tipo) => ({
    tipo,
    itens: (linhas.value ?? []).filter((l) => l.tipo === tipo),
  })).filter((g) => g.itens.length > 0),
);

// ── Descarte ────────────────────────────────────────────────────────────────────────────────────────────────
const descartando = ref(false);
const motivo = ref('');
const descarte = computed(() =>
  esquemaDescartarProcessoFolha.safeParse({
    versao: vigente.value?.versao ?? 0,
    motivo: motivo.value.trim(),
  }),
);
function abrirDescarte(): void {
  motivo.value = '';
  erro.value = null;
  aviso.value = null;
  descartando.value = true;
}
async function descartar(): Promise<void> {
  if (!vigente.value || !descarte.value.success) return;
  erro.value = null;
  try {
    const r = await descartarCalculo(vigente.value.id, descarte.value.data);
    descartando.value = false;
    aviso.value = r.mensagem || t('folha.calculo.descartado');
    await cliente.invalidateQueries({ queryKey: ['folha', 'calculos'] });
  } catch (x) {
    erro.value = x;
  }
}
const papel = (p: string) => t(`folha.calculo.papeis.${p}`);
const vinculosTexto = (vs: readonly number[]) =>
  vs.length > 20 ? `${vs.slice(0, 20).join(', ')}…` : vs.join(', ');
</script>

<template>
  <section class="bloco" :aria-label="t('folha.calculo.titulo')" data-testid="folha-calculo">
    <h2>
      {{ t('folha.calculo.titulo') }}
      <span v-if="competencia" class="secundario">· {{ rotuloCompetencia(competencia) }}</span>
    </h2>
    <p class="secundario">{{ t('folha.calculo.descricao') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="folha-calculo-aviso" />
    <ErroFolha v-if="erro && !confirmando && !descartando" :erro="erro" />
    <p v-if="!pronto">{{ t('folha.calculo.escolhaEmpresa') }}</p>
    <template v-else>
      <div v-if="pode" class="acoes">
        <SanteBotao
          :rotulo="t('folha.calculo.previa')"
          variante="secundario"
          :desabilitado="ocupado"
          data-testid="folha-calculo-previa"
          @acionar="verPrevia"
        />
        <SanteBotao
          :rotulo="vigente ? t('folha.calculo.recalcular') : t('folha.calculo.calcular')"
          :desabilitado="ocupado"
          data-testid="folha-calculo-calcular"
          @acionar="confirmando = true"
        />
        <SanteBotao
          v-if="vigente"
          :rotulo="t('folha.calculo.descartar')"
          variante="texto"
          data-testid="folha-calculo-descartar"
          @acionar="abrirDescarte"
        />
      </div>

      <section
        v-if="pendencias.length"
        class="bloco"
        role="alert"
        :aria-label="t('folha.calculo.pendenciasTitulo')"
        data-testid="folha-calculo-pendencias"
      >
        <h3>{{ t('folha.calculo.pendenciasTitulo') }}</h3>
        <ul>
          <li
            v-for="(p, i) in pendencias"
            :key="`${p.codigo}-${i}`"
            :data-testid="`folha-calculo-pendencia-${p.codigo}`"
          >
            {{ t(`folha.calculo.pendencia.${p.codigo}`) }}
            <span v-if="p.papel" class="secundario"
              >· {{ t('folha.calculo.pendenciaPapel', { papel: papel(p.papel) }) }}</span
            >
            <span v-if="p.vinculos.length" class="secundario">
              ·
              {{
                t('folha.calculo.pendenciaVinculos', {
                  n: p.vinculos.length,
                  vinculos: vinculosTexto(p.vinculos),
                })
              }}
            </span>
          </li>
        </ul>
      </section>

      <ErroFolha v-if="lista.isError.value" :erro="lista.error.value" />
      <ErroFolha v-else-if="detalhe.isError.value" :erro="detalhe.error.value" />
      <p v-else-if="!historico" role="status">{{ t('folha.carregando') }}</p>
      <p v-else-if="!vigente && !visto" data-testid="folha-calculo-nenhum">{{ t('folha.calculo.nenhum') }}</p>
      <p v-else-if="!visto" role="status">{{ t('folha.carregando') }}</p>

      <template v-if="visto">
        <h3 :data-testid="`folha-calculo-visto-${visto.origem}`">
          <template v-if="visto.origem === 'previa'">{{ t('folha.calculo.previaTitulo') }}</template>
          <template v-else-if="visto.processo">
            {{ t('folha.calculo.emVigor') }} · {{ t('folha.calculo.numero') }} {{ visto.processo.numero }}
            <span class="secundario">
              · {{ instanteBr(visto.processo.calculadoEm) }} · {{ visto.processo.calculadoPor }} ·
              {{ t('folha.calculo.tabelaLegal') }} {{ dataBr(visto.processo.tabelaLegal) }} ·
              {{ t('folha.calculo.parametros') }} {{ dataBr(visto.processo.parametros) }}
            </span>
          </template>
        </h3>
        <p v-if="visto.processo && visto.processo.foraDaFolha > 0" class="secundario">
          {{ t('folha.calculo.foraDaFolha', { n: visto.processo.foraDaFolha }) }}
        </p>

        <section
          class="bloco"
          :aria-label="t('folha.calculo.totais.titulo')"
          data-testid="folha-calculo-totais"
        >
          <h4>{{ t('folha.calculo.totais.titulo') }}</h4>
          <dl class="totais">
            <div
              v-for="k in [
                'colaboradores',
                'proventos',
                'descontos',
                'liquido',
                'inss',
                'irrf',
                'fgts',
                'inssPatronal',
                'rat',
                'terceiros',
              ] as const"
              :key="k"
            >
              <dt>{{ t(`folha.calculo.totais.${k}`) }}</dt>
              <dd :data-testid="`folha-calculo-total-${k}`">
                {{ k === 'colaboradores' ? visto.totais.colaboradores : reais(visto.totais[k]) }}
              </dd>
            </div>
          </dl>
          <div class="prova" data-testid="folha-calculo-prova">
            <h4>{{ t('folha.calculo.prova.titulo') }}</h4>
            <SanteAlerta
              :texto="
                visto.conferencia.ok ? t('folha.calculo.prova.ok') : t('folha.calculo.prova.divergente')
              "
              :variante="visto.conferencia.ok ? 'info' : 'aviso'"
              data-testid="folha-calculo-prova-situacao"
            />
            <p data-testid="folha-calculo-conta">
              {{ t('folha.calculo.totais.liquido') }}:
              {{
                t('folha.calculo.prova.conta', {
                  proventos: reais(visto.totais.proventos),
                  descontos: reais(visto.totais.descontos),
                  liquido: reais(visto.totais.liquido),
                })
              }}
            </p>
            <p data-testid="folha-calculo-conta-encargos">
              {{ t('folha.calculo.totais.encargos') }}:
              {{
                t('folha.calculo.prova.contaEncargos', {
                  inssPatronal: reais(visto.totais.inssPatronal),
                  rat: reais(visto.totais.rat),
                  terceiros: reais(visto.totais.terceiros),
                  encargos: reais(encargos),
                })
              }}
            </p>
            <p data-testid="folha-calculo-conta-custo">
              {{ t('folha.calculo.totais.custo') }}:
              {{
                t('folha.calculo.prova.contaCusto', {
                  proventos: reais(visto.totais.proventos),
                  encargos: reais(encargos),
                  fgts: reais(visto.totais.fgts),
                  custo: reais(custo),
                })
              }}
            </p>
            <p v-if="visto.origem === 'vigente' && visto.processo && verSalario">
              <a
                :href="urlConferenciaPdf(visto.processo.id)"
                target="_blank"
                rel="noopener"
                data-testid="folha-calculo-pdf"
                >{{ t('folha.calculo.prova.pdf') }}</a
              >
            </p>
            <table class="tabela">
              <tbody>
                <tr v-for="p in visto.conferencia.parcelas" :key="p.rotulo">
                  <th scope="row">{{ t(`folha.calculo.prova.parcelas.${p.rotulo}`) }}</th>
                  <td>{{ reais(p.valor) }}</td>
                </tr>
              </tbody>
            </table>
            <ul v-if="visto.conferencia.divergencias.length" data-testid="folha-calculo-divergencias">
              <li v-for="d in visto.conferencia.divergencias" :key="d">{{ d }}</li>
            </ul>
          </div>
        </section>

        <section
          class="bloco"
          :aria-label="t('folha.calculo.grade.titulo')"
          data-testid="folha-calculo-grade"
        >
          <h4>{{ t('folha.calculo.grade.titulo') }}</h4>
          <div v-if="!visto.ocultos" class="campos">
            <SanteCampoTexto
              v-model="filtro"
              :rotulo="t('folha.calculo.grade.filtrar')"
              :max-bytes="20"
              data-testid="folha-calculo-filtro"
            />
          </div>
          <p v-if="visto.ocultos" role="status" data-testid="folha-calculo-grade-oculta">
            {{ t('folha.calculo.grade.oculta') }}
          </p>
          <p v-else class="secundario" role="status">
            {{
              t('folha.calculo.grade.mostrando', { n: linhasGrade.length, total: visto.colaboradores.length })
            }}
          </p>
          <p v-if="!visto.ocultos && linhasGrade.length === 0">{{ t('folha.calculo.grade.nenhum') }}</p>
          <table v-else-if="!visto.ocultos" class="tabela">
            <thead>
              <tr>
                <th scope="col" :aria-sort="ariaOrdem('vinculo')">
                  <SanteBotao
                    :rotulo="t('folha.calculo.grade.colaborador')"
                    variante="texto"
                    data-testid="folha-calculo-ordem-vinculo"
                    @acionar="ordenar('vinculo')"
                  />
                </th>
                <th scope="col">{{ t('folha.calculo.grade.centroCusto') }}</th>
                <th scope="col">{{ t('folha.calculo.grade.dias') }}</th>
                <th v-for="c in COLUNAS" :key="c" scope="col" :aria-sort="ariaOrdem(c)">
                  <SanteBotao
                    :rotulo="t(`folha.calculo.totais.${c}`)"
                    variante="texto"
                    :data-testid="`folha-calculo-ordem-${c}`"
                    @acionar="ordenar(c)"
                  />
                </th>
                <th v-if="visto.processo && verSalario" scope="col">{{ t('folha.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in linhasGrade"
                :key="c.vinculo"
                :data-testid="`folha-calculo-colaborador-${c.vinculo}`"
              >
                <th scope="row">{{ quem(c) }}</th>
                <td>{{ c.centroCusto }}</td>
                <td>{{ c.diasPagos }}</td>
                <td>{{ reais(c.proventos) }}</td>
                <td>{{ reais(c.descontos) }}</td>
                <td>{{ reais(c.liquido) }}</td>
                <td>{{ reais(c.encargos) }}</td>
                <td v-if="visto.processo && verSalario">
                  <SanteBotao
                    :rotulo="t('folha.calculo.grade.verMemoria')"
                    variante="texto"
                    :data-testid="`folha-calculo-memoria-${c.vinculo}`"
                    @acionar="verMemoria(c)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>

      <section
        v-if="historico && historico.length"
        class="bloco"
        :aria-label="t('folha.calculo.historico')"
        data-testid="folha-calculo-historico"
      >
        <h4>{{ t('folha.calculo.historico') }}</h4>
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('folha.calculo.numero') }}</th>
              <th scope="col">{{ t('folha.situacao') }}</th>
              <th scope="col">{{ t('folha.calculo.calculadoEm') }}</th>
              <th scope="col">{{ t('folha.calculo.calculadoPor') }}</th>
              <th scope="col">{{ t('folha.calculo.totais.colaboradores') }}</th>
              <th scope="col">{{ t('folha.calculo.totais.liquido') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in historico" :key="p.id" :data-testid="`folha-calculo-processo-${p.id}`">
              <th scope="row">{{ p.numero }}</th>
              <td>
                {{ t(`folha.calculo.situacoes.${p.situacao}`) }}
                <span v-if="p.motivo" class="secundario">· {{ p.motivo }}</span>
              </td>
              <td>{{ instanteBr(p.calculadoEm) }}</td>
              <td>{{ p.calculadoPor }}</td>
              <td>{{ p.totais.colaboradores }}</td>
              <td>{{ reais(p.totais.liquido) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="lista.data.value?.limitado" class="secundario">{{ t('folha.interface.limitado') }}</p>
      </section>
    </template>

    <SanteDialogo
      v-model:visivel="confirmando"
      :titulo="vigente ? t('folha.calculo.recalcular') : t('folha.calculo.calcular')"
    >
      <p data-testid="folha-calculo-confirmacao">
        {{
          vigente
            ? t('folha.calculo.confirmarRecalculo', { numero: vigente.numero })
            : t('folha.calculo.confirmarCalculo')
        }}
      </p>
      <ErroFolha v-if="erro && confirmando" :erro="erro" />
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="confirmando = false" />
        <SanteBotao
          :rotulo="t('folha.confirmar')"
          :desabilitado="ocupado"
          data-testid="folha-calculo-confirmar"
          @acionar="calcular"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="descartando" :titulo="t('folha.calculo.descartar')">
      <p v-if="vigente">
        {{ t('folha.calculo.numero') }} {{ vigente.numero }} · {{ rotuloCompetencia(vigente.competencia) }}
      </p>
      <SanteCampoTexto
        v-model="motivo"
        :rotulo="t('folha.calculo.motivoDescarte')"
        :max-bytes="200"
        data-testid="folha-calculo-motivo-descarte"
      />
      <ErroFolha v-if="erro && descartando" :erro="erro" />
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="descartando = false" />
        <SanteBotao
          :rotulo="t('folha.confirmar')"
          :desabilitado="!descarte.success"
          data-testid="folha-calculo-confirmar-descarte"
          @acionar="descartar"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo
      v-model:visivel="memoriaVisivel"
      :titulo="
        memoriaDe
          ? t('folha.calculo.memoria.de', { quem: quem(memoriaDe) })
          : t('folha.calculo.memoria.titulo')
      "
    >
      <ErroFolha v-if="erroMemoria" :erro="erroMemoria" />
      <p v-else-if="!linhas" role="status">{{ t('folha.carregando') }}</p>
      <div
        v-else
        class="rolagem"
        tabindex="0"
        role="region"
        :aria-label="t('folha.calculo.memoria.titulo')"
        data-testid="folha-calculo-memoria"
      >
        <section
          v-for="g in linhasPorTipo"
          :key="g.tipo"
          :aria-label="t(`folha.calculo.memoria.tipos.${g.tipo}`)"
        >
          <h4>{{ t(`folha.calculo.memoria.tipos.${g.tipo}`) }}</h4>
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">{{ t('folha.calculo.memoria.papel') }}</th>
                <th scope="col">{{ t('folha.calculo.memoria.rubrica') }}</th>
                <th scope="col">{{ t('folha.calculo.memoria.quantidade') }}</th>
                <th scope="col">{{ t('folha.calculo.memoria.valor') }}</th>
                <th scope="col">{{ t('folha.calculo.memoria.conta') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in g.itens" :key="l.papel" :data-testid="`folha-calculo-linha-${l.papel}`">
                <th scope="row">{{ papel(l.papel) }}</th>
                <td>{{ l.codigoRubrica ?? '' }}</td>
                <td>{{ quantidadeDaLinha(l) }}</td>
                <td>{{ reais(l.valor) }}</td>
                <td class="secundario">{{ l.memoria }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <p data-testid="folha-calculo-memoria-prova">
          {{ t('folha.calculo.memoria.liquido') }}:
          {{
            t('folha.calculo.prova.conta', {
              proventos: reais(somaDoTipo(linhas, 'provento')),
              descontos: reais(somaDoTipo(linhas, 'desconto')),
              liquido: reais(somaDoTipo(linhas, 'provento') - somaDoTipo(linhas, 'desconto')),
            })
          }}
        </p>
      </div>
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="memoriaVisivel = false" />
      </template>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
<style scoped>
.totais {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: 0.5rem 1rem;
  margin: 0;
}
.totais dt {
  font-size: 0.875rem;
}
.totais dd {
  margin: 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
