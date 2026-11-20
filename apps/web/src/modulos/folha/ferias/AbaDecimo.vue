<script setup lang="ts">
// Aba "13º salário" (M53.4, etapa F3; a lista com `pessoas.folha.ler`, o cálculo com `pessoas.decimo.calcular`; valores
// por colaborador com `pessoas.salario.ler`): as parcelas do ano da empresa (1ª parcela e final, com o histórico de
// substituídas e descartadas), a prévia sem gravar e o cálculo depois da confirmação (a data de pagamento com o prazo
// da lei; os avisos e as pendências traduzidos), os totais com a prova da soma impressa, a grade por colaborador com a
// memória (as rotas do cálculo: detalhe e linhas do vínculo; o descarte com motivo pela rota do 13º, com a permissão
// do 13º). O servidor confere tudo de novo.
import {
  type ApoioFeriasDecimo,
  type ColaboradorCalculado,
  type ConferenciaCalculoFolha,
  esquemaCalcularDecimo,
  esquemaDescartarProcessoFolha,
  type LinhaCalculoFolha,
  type PendenciaCalculo,
  type ResultadoCalculoDecimo,
  type ResumoProcessoFolha,
  type TotaisCalculoFolha,
} from '@sgh/contratos';
import {
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteData,
  SanteDialogo,
  SanteOpcoes,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../../pessoas/comum.js';
import {
  descartarDecimo,
  lerDetalheCalculo,
  lerLinhasDoVinculo,
  urlConferenciaPdf,
} from '../calculo/api-calculo.js';
import { reais } from '../calculo/comum-calculo.js';
import { instanteBr, rotuloCompetencia } from '../comum-folha.js';
import ErroFolha from '../telas/ErroFolha.vue';
import { calcularDecimo, lerDecimos } from './api-ferias.js';
import { anosDecimo, pagamentoPadraoDecimo } from './comum-ferias.js';
import MemoriaLinhas from './MemoriaLinhas.vue';

const props = defineProps<{ apoio: ApoioFeriasDecimo; empresa: number | null }>();
const { t } = useI18n();
const cliente = useQueryClient();
const pode = computed(() => props.apoio.gravacao.ligada && props.apoio.acoes.calcularDecimo);
const verSalario = computed(() => props.apoio.acoes.verSalario);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);

const anos = computed(() => anosDecimo(props.apoio.hoje).map((a) => ({ valor: a, rotulo: String(a) })));
const ano = ref<number>(Number(props.apoio.hoje.slice(0, 4)));
const parcela = ref<'1' | '2'>(props.apoio.hoje.slice(5, 7) === '12' ? '2' : '1');
const opcoesParcela = computed(() => [
  { valor: '1' as const, rotulo: t('folha.decimo.parcelas.1') },
  { valor: '2' as const, rotulo: t('folha.decimo.parcelas.2') },
]);
const pagamento = ref<string | null>(pagamentoPadraoDecimo(ano.value, 1));
watch(
  [ano, parcela],
  () => {
    pagamento.value = pagamentoPadraoDecimo(ano.value, parcela.value === '1' ? 1 : 2);
  },
  { immediate: true },
);
const pronto = computed(() => props.empresa !== null);

const lista = useQuery({
  queryKey: computed(() => ['folha', 'decimo', props.empresa, ano.value]),
  queryFn: () => lerDecimos({ empresa: props.empresa, ano: ano.value }),
  enabled: pronto,
});
const historico = computed(() => lista.data.value?.itens ?? null);
const tipoDaParcela = computed(() => (parcela.value === '1' ? 'decimo1' : 'decimo2'));
const vigente = computed(
  () => historico.value?.find((p) => p.situacao === 'calculada' && p.tipo === tipoDaParcela.value) ?? null,
);
const escolhido = ref<number | null>(null);
const aberto = computed(() => escolhido.value ?? vigente.value?.id ?? null);
const detalhe = useQuery({
  queryKey: computed(() => ['folha', 'calculo', aberto.value]),
  queryFn: () => lerDetalheCalculo(aberto.value!),
  enabled: computed(() => aberto.value !== null),
});

// ── Prévia e cálculo ────────────────────────────────────────────────────────────────────────────────────────
const entrada = computed(() =>
  esquemaCalcularDecimo.safeParse({
    empresa: props.empresa ?? -1,
    ano: ano.value,
    parcela: parcela.value === '1' ? 1 : 2,
    pagamento: pagamento.value ?? '',
    simular: true,
  }),
);
const previa = ref<ResultadoCalculoDecimo | null>(null);
const pendencias = ref<readonly PendenciaCalculo[]>([]);
const avisos = ref<ResultadoCalculoDecimo['avisos']>([]);
const ocupado = ref(false);
watch(
  () => [props.empresa, ano.value, parcela.value],
  () => {
    previa.value = null;
    pendencias.value = [];
    avisos.value = [];
    aviso.value = null;
    erro.value = null;
    escolhido.value = null;
  },
);
async function enviarCalculo(simular: boolean): Promise<ResultadoCalculoDecimo | null> {
  if (!entrada.value.success) return null;
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    const r = await calcularDecimo({ ...entrada.value.data, simular });
    pendencias.value = r.pendencias ?? [];
    avisos.value = r.avisos ?? [];
    return r;
  } catch (x) {
    erro.value = x;
    return null;
  } finally {
    ocupado.value = false;
  }
}
async function verPrevia(): Promise<void> {
  const r = await enviarCalculo(true);
  previa.value = r && r.pendencias.length === 0 ? r : null;
}
const confirmando = ref(false);
async function calcular(): Promise<void> {
  const r = await enviarCalculo(false);
  if (!r) return;
  confirmando.value = false;
  if (r.calculado && r.processo) {
    previa.value = null;
    escolhido.value = null;
    aviso.value = [
      t('folha.decimo.calculado', { numero: r.processo.numero }),
      r.substituido ? t('folha.decimo.substituiu', { id: r.substituido }) : '',
    ]
      .filter(Boolean)
      .join(' ');
    await cliente.invalidateQueries({ queryKey: ['folha', 'decimo'] });
  }
}
const textoAviso = (a: ResultadoCalculoDecimo['avisos'][number]) =>
  t(`folha.decimo.aviso.${a.codigo}`, { competencias: a.competencias.map(rotuloCompetencia).join(', ') });

// ── O que a tela mostra ─────────────────────────────────────────────────────────────────────────────────────
interface Visto {
  readonly origem: 'previa' | 'gravado';
  readonly processo: ResumoProcessoFolha | null;
  readonly totais: TotaisCalculoFolha;
  readonly colaboradores: readonly ColaboradorCalculado[];
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
  if (d && aberto.value !== null && d.processo.id === aberto.value)
    return {
      origem: 'gravado',
      processo: d.processo,
      totais: d.processo.totais,
      colaboradores: d.colaboradores,
      ocultos: d.colaboradoresOcultos,
      conferencia: d.conferencia,
    };
  return null;
});
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

// ── Descarte ────────────────────────────────────────────────────────────────────────────────────────────────
const descartando = ref(false);
const motivo = ref('');
const descarte = computed(() =>
  esquemaDescartarProcessoFolha.safeParse({
    versao: visto.value?.processo?.versao ?? 0,
    motivo: motivo.value.trim(),
  }),
);
async function descartar(): Promise<void> {
  const p = visto.value?.processo;
  if (!p || !descarte.value.success) return;
  erro.value = null;
  try {
    const r = await descartarDecimo(p.id, descarte.value.data);
    descartando.value = false;
    escolhido.value = null;
    aviso.value = r.mensagem || t('folha.decimo.descartado');
    await cliente.invalidateQueries({ queryKey: ['folha', 'decimo'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="bloco" :aria-label="t('folha.decimo.titulo')" data-testid="folha-decimo">
    <h2>{{ t('folha.decimo.titulo') }}</h2>
    <p class="secundario">{{ t('folha.decimo.descricao') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="folha-decimo-aviso" />
    <ErroFolha v-if="erro && !confirmando && !descartando" :erro="erro" />
    <p v-if="!pronto">{{ t('folha.decimo.escolhaEmpresa') }}</p>
    <template v-else>
      <div class="campos">
        <SanteSelecao
          v-model="ano"
          :rotulo="t('folha.decimo.ano')"
          :opcoes="anos"
          data-testid="folha-decimo-ano"
        />
        <SanteOpcoes
          v-model="parcela"
          :legenda="t('folha.decimo.parcela')"
          :opcoes="opcoesParcela"
          data-testid="folha-decimo-parcela"
        />
        <SanteData
          v-if="pode"
          v-model="pagamento"
          :rotulo="t('folha.decimo.pagamento')"
          editavel
          data-testid="folha-decimo-pagamento"
        />
      </div>
      <template v-if="pode">
        <p class="secundario">{{ t('folha.decimo.pagamentoAjuda') }}</p>
        <p v-if="!entrada.success" role="alert">{{ t('folha.decimo.dataInvalida') }}</p>
        <div class="acoes">
          <SanteBotao
            :rotulo="t('folha.decimo.previa')"
            variante="secundario"
            :desabilitado="ocupado || !entrada.success"
            data-testid="folha-decimo-previa"
            @acionar="verPrevia"
          />
          <SanteBotao
            :rotulo="vigente ? t('folha.decimo.recalcular') : t('folha.decimo.calcular')"
            :desabilitado="ocupado || !entrada.success"
            data-testid="folha-decimo-calcular"
            @acionar="confirmando = true"
          />
        </div>
      </template>

      <ul v-if="avisos.length" data-testid="folha-decimo-avisos">
        <li v-for="a in avisos" :key="a.codigo" :data-testid="`folha-decimo-aviso-${a.codigo}`">
          {{ textoAviso(a) }}
        </li>
      </ul>
      <section
        v-if="pendencias.length"
        class="bloco"
        role="alert"
        :aria-label="t('folha.calculo.pendenciasTitulo')"
        data-testid="folha-decimo-pendencias"
      >
        <h3>{{ t('folha.calculo.pendenciasTitulo') }}</h3>
        <ul>
          <li
            v-for="(p, i) in pendencias"
            :key="`${p.codigo}-${i}`"
            :data-testid="`folha-decimo-pendencia-${p.codigo}`"
          >
            {{ t(`folha.calculo.pendencia.${p.codigo}`) }}
            <span v-if="p.vinculos.length" class="secundario">
              ·
              {{
                t('folha.calculo.pendenciaVinculos', {
                  n: p.vinculos.length,
                  vinculos: p.vinculos.slice(0, 20).join(', '),
                })
              }}
            </span>
          </li>
        </ul>
      </section>

      <ErroFolha v-if="lista.isError.value" :erro="lista.error.value" />
      <ErroFolha v-else-if="detalhe.isError.value" :erro="detalhe.error.value" />
      <p v-else-if="!historico" role="status">{{ t('folha.carregando') }}</p>
      <p v-else-if="!visto && historico.length === 0" data-testid="folha-decimo-nenhum">
        {{ t('folha.decimo.nenhum') }}
      </p>

      <template v-if="visto">
        <h3 :data-testid="`folha-decimo-visto-${visto.origem}`">
          <template v-if="visto.origem === 'previa'">{{ t('folha.decimo.previaTitulo') }}</template>
          <template v-else-if="visto.processo">
            {{
              t('folha.decimo.emVigor', {
                parcela: t(`folha.decimo.tipos.${visto.processo.tipo}`),
                numero: visto.processo.numero,
              })
            }}
            <span class="secundario">
              · {{ t(`folha.calculo.situacoes.${visto.processo.situacao}`) }} ·
              {{ instanteBr(visto.processo.calculadoEm) }} · {{ visto.processo.calculadoPor }} ·
              {{ t('folha.decimo.pagamento') }} {{ dataBr(visto.processo.pagamento) }}
            </span>
          </template>
        </h3>
        <p v-if="visto.processo && visto.processo.foraDaFolha > 0" class="secundario">
          {{ t('folha.calculo.foraDaFolha', { n: visto.processo.foraDaFolha }) }}
        </p>
        <dl class="totais" data-testid="folha-decimo-totais">
          <div
            v-for="k in [
              'colaboradores',
              'proventos',
              'descontos',
              'liquido',
              'inss',
              'irrf',
              'fgts',
            ] as const"
            :key="k"
          >
            <dt>{{ t(`folha.calculo.totais.${k}`) }}</dt>
            <dd :data-testid="`folha-decimo-total-${k}`">
              {{ k === 'colaboradores' ? visto.totais.colaboradores : reais(visto.totais[k]) }}
            </dd>
          </div>
        </dl>
        <SanteAlerta
          :texto="visto.conferencia.ok ? t('folha.calculo.prova.ok') : t('folha.calculo.prova.divergente')"
          :variante="visto.conferencia.ok ? 'info' : 'aviso'"
          data-testid="folha-decimo-prova-situacao"
        />
        <p data-testid="folha-decimo-conta">
          {{ t('folha.calculo.totais.liquido') }}:
          {{
            t('folha.calculo.prova.conta', {
              proventos: reais(visto.totais.proventos),
              descontos: reais(visto.totais.descontos),
              liquido: reais(visto.totais.liquido),
            })
          }}
        </p>
        <table class="tabela">
          <tbody>
            <tr v-for="p in visto.conferencia.parcelas" :key="p.rotulo">
              <th scope="row">{{ t(`folha.calculo.prova.parcelas.${p.rotulo}`) }}</th>
              <td>{{ reais(p.valor) }}</td>
            </tr>
          </tbody>
        </table>
        <ul v-if="visto.conferencia.divergencias.length">
          <li v-for="d in visto.conferencia.divergencias" :key="d">{{ d }}</li>
        </ul>
        <div v-if="visto.processo" class="acoes">
          <a
            v-if="verSalario"
            :href="urlConferenciaPdf(visto.processo.id)"
            target="_blank"
            rel="noopener"
            data-testid="folha-decimo-pdf"
            >{{ t('folha.calculo.prova.pdf') }}</a
          >
          <SanteBotao
            v-if="pode && visto.processo.situacao === 'calculada'"
            :rotulo="t('folha.decimo.descartar')"
            variante="texto"
            data-testid="folha-decimo-descartar"
            @acionar="
              motivo = '';
              descartando = true;
            "
          />
        </div>

        <p v-if="visto.ocultos" role="status" data-testid="folha-decimo-grade-oculta">
          {{ t('folha.calculo.grade.oculta') }}
        </p>
        <table v-else class="tabela" data-testid="folha-decimo-grade">
          <thead>
            <tr>
              <th scope="col">{{ t('folha.calculo.grade.colaborador') }}</th>
              <th scope="col">{{ t('folha.calculo.totais.proventos') }}</th>
              <th scope="col">{{ t('folha.calculo.totais.descontos') }}</th>
              <th scope="col">{{ t('folha.calculo.totais.liquido') }}</th>
              <th scope="col">{{ t('folha.calculo.totais.encargos') }}</th>
              <th v-if="visto.processo && verSalario" scope="col">{{ t('folha.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in visto.colaboradores"
              :key="c.vinculo"
              :data-testid="`folha-decimo-colaborador-${c.vinculo}`"
            >
              <th scope="row">{{ quem(c) }}</th>
              <td>{{ reais(c.proventos) }}</td>
              <td>{{ reais(c.descontos) }}</td>
              <td>{{ reais(c.liquido) }}</td>
              <td>{{ reais(c.encargos) }}</td>
              <td v-if="visto.processo && verSalario">
                <SanteBotao
                  :rotulo="t('folha.calculo.grade.verMemoria')"
                  variante="texto"
                  :data-testid="`folha-decimo-memoria-${c.vinculo}`"
                  @acionar="verMemoria(c)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <section
        v-if="historico && historico.length"
        class="bloco"
        :aria-label="t('folha.decimo.lista')"
        data-testid="folha-decimo-lista"
      >
        <h4>{{ t('folha.decimo.lista') }}</h4>
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('folha.calculo.numero') }}</th>
              <th scope="col">{{ t('folha.decimo.parcela') }}</th>
              <th scope="col">{{ t('folha.situacao') }}</th>
              <th scope="col">{{ t('folha.decimo.pagamento') }}</th>
              <th scope="col">{{ t('folha.calculo.calculadoEm') }}</th>
              <th scope="col">{{ t('folha.calculo.totais.colaboradores') }}</th>
              <th scope="col">{{ t('folha.calculo.totais.liquido') }}</th>
              <th scope="col">{{ t('folha.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in historico" :key="p.id" :data-testid="`folha-decimo-processo-${p.id}`">
              <th scope="row">{{ p.numero }}</th>
              <td>{{ t(`folha.decimo.tipos.${p.tipo}`) }}</td>
              <td>
                {{ t(`folha.calculo.situacoes.${p.situacao}`) }}
                <span v-if="p.motivo" class="secundario">· {{ p.motivo }}</span>
              </td>
              <td>{{ dataBr(p.pagamento) }}</td>
              <td>{{ instanteBr(p.calculadoEm) }} · {{ p.calculadoPor }}</td>
              <td>{{ p.totais.colaboradores }}</td>
              <td>{{ reais(p.totais.liquido) }}</td>
              <td>
                <SanteBotao
                  :rotulo="t('folha.decimo.ver')"
                  variante="texto"
                  :data-testid="`folha-decimo-ver-${p.id}`"
                  @acionar="
                    previa = null;
                    escolhido = p.id;
                  "
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="lista.data.value?.limitado" class="secundario">{{ t('folha.interface.limitado') }}</p>
      </section>
    </template>

    <SanteDialogo
      v-model:visivel="confirmando"
      :titulo="vigente ? t('folha.decimo.recalcular') : t('folha.decimo.calcular')"
    >
      <p data-testid="folha-decimo-confirmacao">{{ t('folha.decimo.confirmar') }}</p>
      <ErroFolha v-if="erro && confirmando" :erro="erro" />
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="confirmando = false" />
        <SanteBotao
          :rotulo="t('folha.confirmar')"
          :desabilitado="ocupado"
          data-testid="folha-decimo-confirmar"
          @acionar="calcular"
        />
      </template>
    </SanteDialogo>

    <SanteDialogo v-model:visivel="descartando" :titulo="t('folha.decimo.descartar')">
      <SanteCampoTexto
        v-model="motivo"
        :rotulo="t('folha.decimo.motivoDescarte')"
        :max-bytes="200"
        data-testid="folha-decimo-motivo"
      />
      <ErroFolha v-if="erro && descartando" :erro="erro" />
      <template #rodape>
        <SanteBotao :rotulo="t('folha.fechar')" variante="texto" @acionar="descartando = false" />
        <SanteBotao
          :rotulo="t('folha.confirmar')"
          :desabilitado="!descarte.success"
          data-testid="folha-decimo-confirmar-descarte"
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
      <MemoriaLinhas v-else :linhas="linhas" prefixo="folha-decimo" />
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
