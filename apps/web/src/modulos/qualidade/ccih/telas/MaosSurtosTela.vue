<script setup lang="ts">
// Qualidade e segurança › CCIH › Higiene das mãos e surtos (M48, etapa 3; ficha, seção 7; tela para tablet): a sessão
// de observação pelos 5 momentos da OMS (categoria do profissional, sem identificá-lo; cada oportunidade com o que foi
// feito e as luvas), o painel da competência (adesão total, por momento e por categoria, e o consumo de preparação
// alcoólica por paciente-dia, sempre com as parcelas) e os surtos (abrir, atualizar casos e medidas, encerrar).
import '../../componentes/estilo-qualidade.css';
import '../componentes/estilo-ccih.css';
import {
  ACOES_HIGIENE_MAOS,
  CATEGORIAS_OBSERVADAS,
  type MomentoHigieneMaos,
  MOMENTOS_HIGIENE_MAOS,
  rotuloMomentoHigiene,
  SITUACOES_SURTO,
} from '@sgh/contratos';
import {
  SanteAlerta,
  SanteBotao,
  SanteCampoTexto,
  SanteData,
  SanteHora,
  SanteOpcoes,
  SanteSelecao,
} from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import {
  atualizarSurto,
  lerFormularioCcih,
  lerInternadosCcih,
  lerMaos,
  lerSurtos,
  novaChaveCcih,
  registrarConsumoAlcool,
  registrarObservacaoMaos,
  registrarSurto,
  type SurtoTela,
} from '../api-ccih.js';
import ContaParcela from '../componentes/ContaParcela.vue';
import ErroCcih from '../componentes/ErroCcih.vue';
import SessoesMaos from '../componentes/SessoesMaos.vue';
import NavCcih from '../componentes/NavCcih.vue';
import {
  adesaoDaSessao,
  competenciaDe,
  competenciasRecentes,
  inteiroPositivo,
  instanteLocal,
  montarObservacao,
  type OportunidadeTela,
  rotuloCompetencia,
  setoresDe,
} from '../regras-ccih.js';

const { t } = useI18n();
const cliente = useQueryClient();
const formulario = useQuery({
  queryKey: ['ccih', 'formulario'],
  queryFn: lerFormularioCcih,
  staleTime: 60_000,
});
const podeRegistrar = computed(() => formulario.data.value?.acoes.registrar ?? false);
const secao = ref<'observar' | 'sessoes' | 'painel' | 'surtos'>('observar');
const opSecao = computed(() => [
  { valor: 'observar' as const, rotulo: t('ccih.maos.observar') },
  // W0-04: as sessões da competência, com a correção e o estorno.
  { valor: 'sessoes' as const, rotulo: t('qualidade.correcao.maos.titulo') },
  { valor: 'painel' as const, rotulo: t('ccih.maos.painel') },
  { valor: 'surtos' as const, rotulo: t('ccih.maos.surtos') },
]);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);

const opUnidade = computed(() => [
  { valor: null as number | null, rotulo: '' },
  ...(formulario.data.value?.unidades ?? []).map((u) => ({
    valor: u.codigo as number | null,
    rotulo: u.nome,
  })),
]);
const internados = useQuery({ queryKey: ['ccih', 'internados'], queryFn: lerInternadosCcih });
const opSetor = computed(() => [
  { valor: '', rotulo: t('ccih.maos.semSetor') },
  ...setoresDe(internados.data.value?.itens ?? []).map((s) => ({ valor: s, rotulo: s })),
]);

// ── Observação ──
const sessao = reactive({
  unidade: null as number | null,
  setor: '',
  categoria: '',
  data: null as string | null,
  hora: null as string | null,
  observacao: '',
});
const oportunidades = ref<OportunidadeTela[]>([]);
const atual = reactive({
  momento: 'antesContato' as MomentoHigieneMaos,
  acao: 'friccao' as OportunidadeTela['acao'],
  luvas: false,
});
const opCategoria = CATEGORIAS_OBSERVADAS.map((c) => ({ valor: c.codigo as string, rotulo: c.rotulo }));
const opMomento = MOMENTOS_HIGIENE_MAOS.map((m) => ({ valor: m.codigo, rotulo: m.rotulo }));
const opAcao = ACOES_HIGIENE_MAOS.map((a) => ({ valor: a.codigo, rotulo: a.rotulo }));
const rotuloAcao = (c: string) => ACOES_HIGIENE_MAOS.find((a) => a.codigo === c)?.rotulo ?? c;
const parcial = computed(() => adesaoDaSessao(oportunidades.value));
function adicionar(): void {
  oportunidades.value = [...oportunidades.value, { ...atual }];
}
function remover(k: number): void {
  oportunidades.value = oportunidades.value.filter((_, i) => i !== k);
}
const incompleta = ref(false);
const chaveObs = ref(novaChaveCcih('observacao'));
async function gravarSessao(): Promise<void> {
  erro.value = null;
  const e = montarObservacao({
    ...sessao,
    observadoEm: instanteLocal(sessao.data, sessao.hora),
    oportunidades: oportunidades.value,
  });
  incompleta.value = e === null;
  if (!e) return;
  try {
    await registrarObservacaoMaos(e, chaveObs.value);
    chaveObs.value = novaChaveCcih('observacao');
    oportunidades.value = [];
    aviso.value = t('ccih.maos.sessaoGravada');
    await cliente.invalidateQueries({ queryKey: ['ccih', 'maos'] });
  } catch (x) {
    erro.value = x;
  }
}

// ── Painel ──
const competencia = ref('');
watch(
  formulario.data,
  (f) => {
    if (f && !competencia.value) competencia.value = competenciaDe(f.agora);
  },
  { immediate: true },
);
const opCompetencia = computed(() =>
  formulario.data.value
    ? competenciasRecentes(formulario.data.value.agora).map((c) => ({
        valor: c,
        rotulo: rotuloCompetencia(c),
      }))
    : [],
);
const maos = useQuery({
  queryKey: computed(() => ['ccih', 'maos', competencia.value]),
  queryFn: () => lerMaos(competencia.value),
  enabled: computed(() => secao.value === 'painel' && !!competencia.value),
});
const rotuloCategoria = (c: string) => CATEGORIAS_OBSERVADAS.find((x) => x.codigo === c)?.rotulo ?? c;
const nomeUnidade = (c: number) =>
  formulario.data.value?.unidades.find((u) => u.codigo === c)?.nome ?? String(c);
const consumo = reactive({ unidade: null as number | null, setor: '', mililitros: '' });
const chaveConsumo = ref(novaChaveCcih('consumo'));
const consumoInvalido = ref(false);
async function gravarConsumo(): Promise<void> {
  erro.value = null;
  const ml = inteiroPositivo(consumo.mililitros, 100_000_000);
  consumoInvalido.value = ml === null || consumo.unidade === null;
  if (ml === null || consumo.unidade === null) return;
  try {
    await registrarConsumoAlcool(
      {
        unidade: consumo.unidade,
        setor: consumo.setor || null,
        competencia: competencia.value,
        mililitros: ml,
      },
      chaveConsumo.value,
    );
    chaveConsumo.value = novaChaveCcih('consumo');
    consumo.mililitros = '';
    aviso.value = t('ccih.maos.consumoGravado');
    await cliente.invalidateQueries({ queryKey: ['ccih', 'maos'] });
  } catch (x) {
    erro.value = x;
  }
}

// ── Surtos ──
const surtos = useQuery({
  queryKey: ['ccih', 'surtos'],
  queryFn: lerSurtos,
  enabled: computed(() => secao.value === 'surtos'),
});
const opTipoSurto = computed(() => [
  { valor: null as number | null, rotulo: t('ccih.surtos.semTipo') },
  ...(formulario.data.value?.tiposSurto ?? []).map((x) => ({
    valor: x.codigo as number | null,
    rotulo: x.nome,
  })),
]);
const opSituacao = SITUACOES_SURTO.map((s) => ({ valor: s.codigo as string, rotulo: s.rotulo }));
const rotuloSituacao = (c: string) => SITUACOES_SURTO.find((s) => s.codigo === c)?.rotulo ?? c;
const novo = reactive({
  aberto: false,
  titulo: '',
  tipoSurto: null as number | null,
  agente: '',
  unidade: null as number | null,
  setor: '',
  inicio: null as string | null,
  casos: '1',
  medidas: '',
});
const novoIncompleto = ref(false);
const chaveSurto = ref(novaChaveCcih('surto'));
async function gravarSurto(): Promise<void> {
  erro.value = null;
  const casos = inteiroPositivo(novo.casos, 10_000);
  novoIncompleto.value =
    novo.titulo.trim().length < 5 || novo.unidade === null || !novo.inicio || casos === null || casos < 1;
  if (novoIncompleto.value || novo.unidade === null || !novo.inicio || casos === null) return;
  try {
    await registrarSurto(
      {
        titulo: novo.titulo.trim(),
        tipoSurto: novo.tipoSurto,
        agente: novo.agente.trim() || null,
        unidade: novo.unidade,
        setor: novo.setor || null,
        inicio: novo.inicio,
        casos,
        medidas: novo.medidas.trim() || null,
      },
      chaveSurto.value,
    );
    chaveSurto.value = novaChaveCcih('surto');
    Object.assign(novo, { aberto: false, titulo: '', agente: '', inicio: null, casos: '1', medidas: '' });
    aviso.value = t('ccih.surtos.gravado');
    await cliente.invalidateQueries({ queryKey: ['ccih', 'surtos'] });
  } catch (x) {
    erro.value = x;
  }
}
const edicao = reactive({ id: 0, situacao: '', casos: '', medidas: '', encerradoEm: null as string | null });
const chaveEdicao = ref(novaChaveCcih('surto-atualizar'));
function abrirEdicao(s: SurtoTela): void {
  Object.assign(edicao, {
    id: s.id,
    situacao: s.situacao,
    casos: String(s.casos),
    medidas: s.medidas ?? '',
    encerradoEm: null,
  });
}
async function gravarEdicao(s: SurtoTela): Promise<void> {
  erro.value = null;
  const casos = inteiroPositivo(edicao.casos, 10_000);
  if (casos === null || casos < 1) {
    novoIncompleto.value = true;
    return;
  }
  try {
    await atualizarSurto(
      s.id,
      {
        versao: s.versao,
        situacao: edicao.situacao,
        casos,
        medidas: edicao.medidas.trim() || null,
        encerradoEm: edicao.situacao === 'encerrado' ? edicao.encerradoEm : null,
      },
      chaveEdicao.value,
    );
    chaveEdicao.value = novaChaveCcih('surto-atualizar');
    edicao.id = 0;
    aviso.value = t('ccih.surtos.gravado');
    await cliente.invalidateQueries({ queryKey: ['ccih', 'surtos'] });
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section
    class="tela-agenda tablet-ccih"
    aria-labelledby="ccih-maos-titulo"
    data-testid="tela-ccih-maos-surtos"
  >
    <h1 id="ccih-maos-titulo">{{ t('ccih.maos.titulo') }}</h1>
    <NavCcih />
    <SanteAlerta
      v-if="formulario.data.value && !formulario.data.value.ligada"
      variante="info"
      :texto="formulario.data.value.motivo ?? t('ccih.desligado')"
    />
    <SanteOpcoes v-model="secao" :legenda="t('ccih.maos.abas')" :opcoes="opSecao" nome="secao-maos" />
    <div v-if="aviso" role="status" data-testid="maos-aviso">{{ aviso }}</div>
    <ErroCcih v-if="erro" :erro="erro" />

    <section v-if="secao === 'observar'" class="painel-ccih" data-testid="maos-observar">
      <p class="secundario">{{ t('ccih.maos.explicacaoObservacao') }}</p>
      <div class="linha-ccih">
        <SanteSelecao
          v-model="sessao.unidade"
          :rotulo="t('ccih.unidade')"
          :opcoes="opUnidade"
          obrigatorio
          data-testid="obs-unidade"
        />
        <SanteSelecao
          v-model="sessao.setor"
          :rotulo="t('ccih.setor')"
          :opcoes="opSetor"
          data-testid="obs-setor"
        />
        <SanteData
          v-model="sessao.data"
          :rotulo="t('ccih.maos.observadoEm')"
          editavel
          data-testid="obs-data"
        />
        <SanteHora
          v-model="sessao.hora"
          :rotulo="t('ccih.maos.horaObservacao')"
          editavel
          data-testid="obs-hora"
        />
      </div>
      <SanteOpcoes
        v-model="sessao.categoria"
        :legenda="t('ccih.maos.categoria')"
        :opcoes="opCategoria"
        nome="obs-categoria"
      />
      <SanteOpcoes
        v-model="atual.momento"
        :legenda="t('ccih.maos.momento')"
        :opcoes="opMomento"
        nome="obs-momento"
      />
      <SanteOpcoes v-model="atual.acao" :legenda="t('ccih.maos.acao')" :opcoes="opAcao" nome="obs-acao" />
      <label
        ><input v-model="atual.luvas" type="checkbox" data-testid="obs-luvas" />
        {{ t('ccih.maos.luvas') }}</label
      >
      <SanteBotao
        :rotulo="t('ccih.maos.adicionar')"
        variante="secundario"
        data-testid="obs-adicionar"
        @acionar="adicionar"
      />
      <p role="status" data-testid="obs-parcial">
        {{ t('ccih.maos.sessao', { total: parcial.total, conformes: parcial.conformes }) }}
      </p>
      <p v-if="!oportunidades.length" class="secundario">{{ t('ccih.maos.semOportunidade') }}</p>
      <ol v-else class="lista-ccih" data-testid="obs-lista">
        <li v-for="(o, k) in oportunidades" :key="k">
          {{ rotuloMomentoHigiene(o.momento) }} · {{ rotuloAcao(o.acao) }}
          <span v-if="o.luvas">· {{ t('ccih.maos.luvas') }}</span>
          <SanteBotao :rotulo="t('ccih.maos.remover')" variante="texto" @acionar="remover(k)" />
        </li>
      </ol>
      <SanteCampoTexto v-model="sessao.observacao" :rotulo="t('ccih.observacao')" :max-bytes="200" />
      <p v-if="incompleta" role="alert" data-testid="obs-incompleta">{{ t('ccih.maos.sessaoIncompleta') }}</p>
      <SanteBotao
        v-if="podeRegistrar"
        :rotulo="t('ccih.maos.gravarSessao')"
        variante="primario"
        data-testid="obs-gravar"
        @acionar="gravarSessao"
      />
    </section>

    <template v-else-if="secao === 'sessoes'">
      <form class="filtros" @submit.prevent>
        <SanteSelecao
          v-model="competencia"
          :rotulo="t('ccih.competencia')"
          :opcoes="opCompetencia"
          data-testid="sessoes-competencia"
        />
      </form>
      <SessoesMaos
        :competencia="competencia"
        :pode-registrar="podeRegistrar"
        @alterado="(x) => (aviso = x)"
      />
    </template>

    <section v-else-if="secao === 'painel'" class="painel-ccih" data-testid="maos-painel">
      <SanteSelecao v-model="competencia" :rotulo="t('ccih.competencia')" :opcoes="opCompetencia" />
      <ErroCcih v-if="maos.isError.value" :erro="maos.error.value" />
      <p v-else-if="!maos.data.value" role="status">{{ t('ccih.carregando') }}</p>
      <template v-else>
        <p>{{ t('ccih.maos.observacoes', { n: maos.data.value.observacoes }) }}</p>
        <p data-testid="maos-adesao-total">
          {{ t('ccih.maos.adesaoTotal') }}: <ContaParcela :parcela="maos.data.value.adesao.total" />
        </p>
        <table class="tabela" data-testid="tabela-momentos">
          <caption>
            {{
              t('ccih.maos.legendaMomentos')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('ccih.maos.colMomento') }}</th>
              <th scope="col">{{ t('ccih.maos.colAdesao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in maos.data.value.adesao.porMomento" :key="m.momento">
              <th scope="row">{{ rotuloMomentoHigiene(m.momento as never) }}</th>
              <td><ContaParcela :parcela="m" /></td>
            </tr>
          </tbody>
        </table>
        <table class="tabela" data-testid="tabela-categorias">
          <caption>
            {{
              t('ccih.maos.legendaCategorias')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('ccih.maos.colCategoria') }}</th>
              <th scope="col">{{ t('ccih.maos.colAdesao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in maos.data.value.adesao.porCategoria" :key="c.categoria">
              <th scope="row">{{ rotuloCategoria(c.categoria) }}</th>
              <td><ContaParcela :parcela="c" /></td>
            </tr>
          </tbody>
        </table>
        <h2>{{ t('ccih.maos.consumo') }}</h2>
        <table v-if="maos.data.value.consumo.length" class="tabela" data-testid="tabela-alcool">
          <caption>
            {{
              t('ccih.maos.legendaConsumo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('ccih.unidade') }}</th>
              <th scope="col">{{ t('ccih.setor') }}</th>
              <th scope="col">{{ t('ccih.maos.colMililitros') }}</th>
              <th scope="col">{{ t('ccih.maos.colPorPacienteDia') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, k) in maos.data.value.consumo" :key="k">
              <td>{{ nomeUnidade(c.unidade) }}</td>
              <td>{{ c.setor ?? t('ccih.maos.semSetor') }}</td>
              <td>{{ c.mililitros.toLocaleString('pt-BR') }}</td>
              <td><ContaParcela :parcela="c.porPacienteDia" /></td>
            </tr>
          </tbody>
        </table>
        <div v-if="podeRegistrar" class="linha-ccih" data-testid="form-consumo">
          <SanteSelecao
            v-model="consumo.unidade"
            :rotulo="t('ccih.unidade')"
            :opcoes="opUnidade"
            obrigatorio
          />
          <SanteSelecao v-model="consumo.setor" :rotulo="t('ccih.setor')" :opcoes="opSetor" />
          <SanteCampoTexto
            v-model="consumo.mililitros"
            :rotulo="t('ccih.maos.mililitros')"
            :max-bytes="9"
            data-testid="consumo-ml"
          />
          <SanteBotao
            :rotulo="t('ccih.maos.registrarConsumo')"
            variante="secundario"
            data-testid="consumo-gravar"
            @acionar="gravarConsumo"
          />
          <p v-if="consumoInvalido" role="alert">{{ t('ccih.campoObrigatorio') }}</p>
        </div>
      </template>
    </section>

    <section v-else class="painel-ccih" data-testid="maos-surtos">
      <template v-if="podeRegistrar">
        <SanteBotao
          v-if="!novo.aberto"
          :rotulo="t('ccih.surtos.novo')"
          variante="secundario"
          data-testid="surto-novo"
          @acionar="novo.aberto = true"
        />
        <form v-else class="painel-ccih" data-testid="form-surto" @submit.prevent>
          <div class="linha-ccih">
            <SanteCampoTexto
              v-model="novo.titulo"
              :rotulo="t('ccih.surtos.titulo')"
              :max-bytes="80"
              obrigatorio
              data-testid="surto-titulo"
            />
            <SanteSelecao
              v-model="novo.tipoSurto"
              :rotulo="t('ccih.surtos.tipo')"
              :opcoes="opTipoSurto"
              busca
            />
            <SanteCampoTexto v-model="novo.agente" :rotulo="t('ccih.surtos.agente')" :max-bytes="80" />
          </div>
          <div class="linha-ccih">
            <SanteSelecao
              v-model="novo.unidade"
              :rotulo="t('ccih.unidade')"
              :opcoes="opUnidade"
              obrigatorio
              data-testid="surto-unidade"
            />
            <SanteSelecao v-model="novo.setor" :rotulo="t('ccih.setor')" :opcoes="opSetor" />
            <SanteData
              v-model="novo.inicio"
              :rotulo="t('ccih.surtos.inicio')"
              editavel
              data-testid="surto-inicio"
            />
            <SanteCampoTexto
              v-model="novo.casos"
              :rotulo="t('ccih.surtos.casos')"
              :max-bytes="5"
              data-testid="surto-casos"
            />
          </div>
          <SanteCampoTexto
            v-model="novo.medidas"
            :rotulo="t('ccih.surtos.medidas')"
            :max-bytes="2000"
            multilinha
          />
          <p v-if="novoIncompleto" role="alert" data-testid="surto-incompleto">
            {{ t('ccih.campoObrigatorio') }}
          </p>
          <p class="linha-ccih">
            <SanteBotao
              :rotulo="t('ccih.gravar')"
              variante="primario"
              data-testid="surto-gravar"
              @acionar="gravarSurto"
            />
            <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="novo.aberto = false" />
          </p>
        </form>
      </template>
      <ErroCcih v-if="surtos.isError.value" :erro="surtos.error.value" />
      <p v-else-if="!surtos.data.value" role="status">{{ t('ccih.carregando') }}</p>
      <p v-else-if="!surtos.data.value.itens.length" data-testid="surtos-nenhum">
        {{ t('ccih.surtos.nenhum') }}
      </p>
      <table v-else class="tabela" data-testid="tabela-surtos">
        <caption>
          {{
            t('ccih.surtos.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('ccih.surtos.colTitulo') }}</th>
            <th scope="col">{{ t('ccih.surtos.colInicio') }}</th>
            <th scope="col">{{ t('ccih.surtos.colCasos') }}</th>
            <th scope="col">{{ t('ccih.surtos.colSituacao') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in surtos.data.value.itens" :key="s.id" :data-testid="`surto-${s.id}`">
            <td>
              {{ s.titulo }}
              <div class="secundario">
                {{ nomeUnidade(s.unidade) }}<template v-if="s.setor"> · {{ s.setor }}</template
                ><template v-if="s.agente"> · {{ s.agente }}</template>
              </div>
              <div v-if="s.medidas" class="secundario">{{ s.medidas }}</div>
            </td>
            <td>{{ dataHora(s.inicio) }}</td>
            <td>{{ s.casos }}</td>
            <td>
              {{ rotuloSituacao(s.situacao) }}
              <div v-if="s.encerradoEm" class="secundario">
                {{ t('ccih.surtos.encerrado', { data: dataHora(s.encerradoEm) }) }}
              </div>
              <SanteBotao
                v-if="podeRegistrar && s.situacao !== 'encerrado' && edicao.id !== s.id"
                :rotulo="t('ccih.surtos.atualizar')"
                variante="texto"
                :data-testid="`surto-atualizar-${s.id}`"
                @acionar="abrirEdicao(s)"
              />
              <div v-if="edicao.id === s.id" class="linha-ccih" data-testid="form-surto-edicao">
                <SanteSelecao
                  v-model="edicao.situacao"
                  :rotulo="t('ccih.surtos.situacao')"
                  :opcoes="opSituacao"
                  data-testid="surto-situacao"
                />
                <SanteCampoTexto v-model="edicao.casos" :rotulo="t('ccih.surtos.casos')" :max-bytes="5" />
                <SanteData
                  v-if="edicao.situacao === 'encerrado'"
                  v-model="edicao.encerradoEm"
                  :rotulo="t('ccih.surtos.encerradoEm')"
                  editavel
                  data-testid="surto-encerrado-em"
                />
                <SanteCampoTexto
                  v-model="edicao.medidas"
                  :rotulo="t('ccih.surtos.medidas')"
                  :max-bytes="2000"
                  multilinha
                />
                <SanteBotao
                  :rotulo="t('ccih.gravar')"
                  variante="primario"
                  data-testid="surto-edicao-gravar"
                  @acionar="gravarEdicao(s)"
                />
                <SanteBotao :rotulo="t('ccih.cancelar')" variante="texto" @acionar="edicao.id = 0" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<style src="../../../agenda/componentes/estilo-agenda.css"></style>
