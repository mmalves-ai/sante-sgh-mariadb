<script setup lang="ts">
// Migração gradual: onda 2 (M40; ficha, regra 1 e campo 4; cap-15 §15.3.2 e §15.3.4): por setor da onda 2, na ordem
// recomendada (campo 12), o critério de liberação no estabelecimento ativo, item a item: as operações conferidas e o
// teste de invasão calculados; os demais o comitê registra com a evidência e a data (sem nome de pessoa nem dado de
// paciente). Por setor também: as operações (as desligadas até a prova ficam no sistema anterior), os registros que só
// existem no novo (regra 6) e o que o recolhimento desliga (regra 4). No topo, o Serrano depois do primeiro hospital
// (regra 8), a janela sem versão (regra 16) e o teste de invasão; embaixo, o acompanhamento agregado (campo 4) e os
// códigos com a legenda "a confirmar" (regra 14).
import {
  type AcompanhamentoOnda2,
  ITENS_REGISTRAVEIS_ONDA_2,
  ITENS_SEM_NAO_SE_APLICA_ONDA_2,
  type ItemCriterioLiberacao,
  type PainelOnda2,
  ROTULOS_CRITERIO_LIBERACAO,
  SITUACOES_ITEM_CRITERIO,
  type SituacaoItemCriterio,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { gravarItensOnda2, lerAcompanhamentoOnda2, lerOnda2 } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';
import VoltarCriterioPendente from '../componentes/VoltarCriterioPendente.vue';

const { t } = useI18n();
const { permissoes } = usarSessao();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['coexistencia', 'onda2'], queryFn: lerOnda2 });
const painel = computed<PainelOnda2 | undefined>(() => consulta.data.value);
const podeEditar = computed(() => permissoes.value.has('config.coexistenciaSetor.editar'));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

// ── Filtro de setor (lista com busca, ADR 0027) ────────────────────────────────────────────────────────
const filtroSetor = ref<string>('');
const opcoesSetor = computed(() => [
  { valor: '', rotulo: t('coexistencia.onda2.todos') },
  ...(painel.value?.setores ?? []).map((s) => ({ valor: s.setor, rotulo: `${s.passo}. ${s.nome}` })),
]);
const setoresVisiveis = computed(() =>
  (painel.value?.setores ?? []).filter((s) => !filtroSetor.value || s.setor === filtroSetor.value),
);
const nomeSetor = (id: string) => painel.value?.setores.find((s) => s.setor === id)?.nome ?? id;

// ── Registro de item do critério ───────────────────────────────────────────────────────────────────────
const aberto = ref<string | null>(null);
const form = reactive({
  item: '' as ItemCriterioLiberacao | '',
  situacao: 'cumprido' as SituacaoItemCriterio,
  evidencia: '',
  em: null as string | null,
  justificativa: '',
});
const setorAberto = computed(() => painel.value?.setores.find((s) => s.setor === aberto.value) ?? null);
const opcoesItem = computed(() =>
  (setorAberto.value?.itens ?? [])
    .filter((i) => (ITENS_REGISTRAVEIS_ONDA_2 as readonly string[]).includes(i.item))
    .map((i) => ({ valor: i.item, rotulo: ROTULOS_CRITERIO_LIBERACAO[i.item] })),
);
// "Não se aplica" só aparece para o item que a admite (estações, carga, apoio); os demais só se cumprem.
const opcoesSituacao = computed(() =>
  SITUACOES_ITEM_CRITERIO.filter(
    (s) =>
      s !== 'nao-se-aplica' ||
      !form.item ||
      !(ITENS_SEM_NAO_SE_APLICA_ONDA_2 as readonly string[]).includes(form.item),
  ).map((s) => ({ valor: s, rotulo: t(`coexistencia.onda1.situacoesItem.${s}`) })),
);
watch(
  () => form.item,
  (item) => {
    if (
      form.situacao === 'nao-se-aplica' &&
      item &&
      (ITENS_SEM_NAO_SE_APLICA_ONDA_2 as readonly string[]).includes(item)
    )
      form.situacao = 'cumprido';
  },
);

function abrir(setor: string): void {
  aberto.value = setor;
  form.item = '';
  form.situacao = 'cumprido';
  form.evidencia = '';
  form.em = null;
  form.justificativa = '';
  mensagem.value = null;
}

async function registrar(): Promise<void> {
  const setor = aberto.value;
  if (!setor || !form.item) return;
  erro.value = null;
  try {
    const r = await gravarItensOnda2(setor, {
      itens: [
        {
          item: form.item,
          situacao: form.situacao,
          evidencia: form.evidencia,
          em: form.situacao === 'pendente' ? null : form.em,
        },
      ],
      justificativa: form.justificativa,
    });
    mensagem.value = t('coexistencia.onda2.gravado', { n: r.gravados, setor: nomeSetor(setor) });
    form.item = '';
    form.evidencia = '';
    form.justificativa = '';
    await cliente.invalidateQueries({ queryKey: ['coexistencia', 'onda2'] });
  } catch (e) {
    erro.value = e;
  }
}

// ── Acompanhamento (campo 4) ───────────────────────────────────────────────────────────────────────────
const hoje = new Date();
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const periodo = reactive({
  de: iso(new Date(hoje.getTime() - 6 * 86_400_000)) as string | null,
  ate: iso(hoje) as string | null,
});
const pedido = ref({ de: periodo.de ?? '', ate: periodo.ate ?? '' });
const acompanhamento = useQuery({
  queryKey: computed(() => ['coexistencia', 'onda2', 'acompanhamento', pedido.value.de, pedido.value.ate]),
  queryFn: () => lerAcompanhamentoOnda2(pedido.value.de, pedido.value.ate),
});
const dados = computed<AcompanhamentoOnda2 | undefined>(() => acompanhamento.data.value);
const filtroUnidade = ref('');
const opcoesUnidade = computed(() => [
  { valor: '', rotulo: t('coexistencia.onda2.todasUnidades') },
  ...[
    ...new Set(
      [...(dados.value?.checagem ?? []), ...(dados.value?.higienizacao ?? [])].map((x) => x.unidade),
    ),
  ]
    .sort()
    .map((u) => ({ valor: u, rotulo: u })),
]);
const daUnidade = <T extends { unidade: string }>(xs: readonly T[]) =>
  xs.filter((x) => !filtroUnidade.value || x.unidade === filtroUnidade.value);
function consultar(): void {
  if (periodo.de && periodo.ate) pedido.value = { de: periodo.de, ate: periodo.ate };
}
const janelasTexto = computed(() =>
  (painel.value?.versao.janelas ?? [])
    .map((j) => t('coexistencia.onda2.janela', { de: j.de, ate: j.ate, motivo: j.motivo }))
    .join('; '),
);
const pct = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-onda2" data-testid="tela-migracao-onda2">
    <h1 id="titulo-onda2">{{ t('coexistencia.onda2.titulo') }}</h1>
    <AbasMigracao atual="onda2" />
    <p>{{ t('coexistencia.onda2.texto') }}</p>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!painel" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="painel.seguramHospital.length"
        :texto="t('coexistencia.onda2.seguram', { setores: painel.seguramHospital.join(', ') })"
        variante="aviso"
        data-testid="onda2-seguram"
      />
      <p v-else data-testid="onda2-sem-espera">{{ t('coexistencia.onda2.semEspera') }}</p>
      <p data-testid="onda2-versao">
        {{
          painel.versao.permitida
            ? t('coexistencia.onda2.versaoPermitida', { hoje: painel.versao.hoje })
            : t('coexistencia.onda2.versaoBloqueada', {
                hoje: painel.versao.hoje,
                motivo: painel.versao.motivo,
              })
        }}
        {{ t('coexistencia.onda2.janelas') }}: {{ janelasTexto }}.
      </p>
      <p data-testid="onda2-pentest">
        <strong>{{ t('coexistencia.onda2.pentest') }}:</strong> {{ painel.pentest.motivo }}
      </p>

      <div class="filtros">
        <SanteSelecao
          id="onda2-filtro-setor"
          v-model="filtroSetor"
          :rotulo="t('coexistencia.onda2.filtroSetor')"
          :opcoes="opcoesSetor"
          busca
          data-testid="onda2-filtro-setor"
        />
      </div>

      <section
        v-for="s in setoresVisiveis"
        :key="s.setor"
        :aria-labelledby="`onda2-${s.setor}`"
        :data-testid="`onda2-setor-${s.setor}`"
      >
        <h2 :id="`onda2-${s.setor}`">{{ t('coexistencia.onda2.passo', { n: s.passo }) }}: {{ s.nome }}</h2>
        <p>
          <strong data-testid="veredito">{{
            s.podeLiberar ? t('coexistencia.onda2.podeLiberar') : t('coexistencia.onda2.falta')
          }}</strong>
        </p>
        <table class="tabela">
          <caption>
            {{
              t('coexistencia.onda2.criterio', { setor: s.nome })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.onda1.item') }}</th>
              <th scope="col">{{ t('coexistencia.onda2.origem') }}</th>
              <th scope="col">{{ t('coexistencia.situacao') }}</th>
              <th scope="col">{{ t('coexistencia.onda2.oQueFalta') }}</th>
              <th v-if="podeEditar" scope="col">{{ t('coexistencia.ciclo.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in s.itens" :key="i.item" :data-testid="`item-${i.item}`">
              <th scope="row">{{ i.rotulo }}</th>
              <td>{{ t(`coexistencia.onda2.origens.${i.origem}`) }}</td>
              <td data-testid="situacao">{{ t(`coexistencia.onda1.situacoesItem.${i.situacao}`) }}</td>
              <td data-testid="falta">{{ i.falta ?? i.detalhe }}</td>
              <td v-if="podeEditar">
                <VoltarCriterioPendente
                  :setor="s.setor"
                  :item="i.item"
                  :rotulo="i.rotulo"
                  :situacao="i.situacao"
                  onda="onda2"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <details>
          <summary>{{ t('coexistencia.onda2.operacoes', { n: s.operacoes.length }) }}</summary>
          <ul>
            <li v-for="o in s.operacoes" :key="o.nome" :data-testid="`operacao-${o.nome}`">
              {{ o.nome }}: {{ o.estado
              }}<template v-if="o.fora"> ({{ t('coexistencia.onda2.fora') }})</template>
            </li>
          </ul>
        </details>
        <p v-if="s.recursosSoNoNovo.length" data-testid="recursos-novos">
          {{ t('coexistencia.onda2.recursos') }}: {{ s.recursosSoNoNovo.map((r) => r.imprime).join('; ') }}.
        </p>
        <p data-testid="recolhimento">
          {{ t('coexistencia.onda2.recolhimento') }}:
          {{ s.recolhimento.chaves.join(', ') || t('coexistencia.onda2.nenhuma') }}.
          {{ t('coexistencia.onda2.bloquear') }}:
          {{ s.recolhimento.bloquear.join(', ') || t('coexistencia.onda2.nenhuma') }}.
        </p>
        <SanteBotao
          v-if="podeEditar"
          :rotulo="t('coexistencia.onda2.registrar')"
          variante="secundario"
          :data-testid="`onda2-abrir-${s.setor}`"
          @acionar="abrir(s.setor)"
        />
      </section>

      <section
        v-if="setorAberto && podeEditar"
        aria-labelledby="titulo-registrar-onda2"
        data-testid="form-onda2"
      >
        <h2 id="titulo-registrar-onda2">
          {{ t('coexistencia.onda2.registrarDe', { setor: setorAberto.nome }) }}
        </h2>
        <form class="filtros" @submit.prevent="registrar">
          <SanteSelecao
            id="onda2-item"
            v-model="form.item"
            :rotulo="t('coexistencia.onda1.item')"
            :opcoes="opcoesItem"
            obrigatorio
            busca
            data-testid="onda2-item"
          />
          <SanteSelecao
            id="onda2-situacao"
            v-model="form.situacao"
            :rotulo="t('coexistencia.situacao')"
            :opcoes="opcoesSituacao"
            data-testid="onda2-situacao"
          />
          <SanteCampoTexto
            v-model="form.evidencia"
            :rotulo="t('coexistencia.onda1.evidencia')"
            :max-bytes="300"
            data-testid="onda2-evidencia"
          />
          <SanteData v-model="form.em" :rotulo="t('coexistencia.onda1.em')" editavel data-testid="onda2-em" />
          <SanteCampoTexto
            v-model="form.justificativa"
            :rotulo="t('coexistencia.justificativa')"
            :max-bytes="200"
            obrigatorio
            data-testid="onda2-justificativa"
          />
          <SanteBotao
            :rotulo="t('coexistencia.gravar')"
            variante="primario"
            tipo="submit"
            data-testid="onda2-gravar"
          />
        </form>
      </section>

      <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" anunciar data-testid="mensagem-onda2" />
      <MensagemErro v-if="erro" :erro="erro" />

      <section aria-labelledby="onda2-acompanhamento" data-testid="onda2-acompanhamento">
        <h2 id="onda2-acompanhamento">{{ t('coexistencia.onda2.acompanhamento') }}</h2>
        <p>{{ t('coexistencia.onda2.acompanhamentoTexto') }}</p>
        <form class="filtros" @submit.prevent="consultar">
          <SanteData
            v-model="periodo.de"
            :rotulo="t('coexistencia.onda2.de')"
            editavel
            data-testid="onda2-de"
          />
          <SanteData
            v-model="periodo.ate"
            :rotulo="t('coexistencia.onda2.ate')"
            editavel
            data-testid="onda2-ate"
          />
          <SanteBotao
            :rotulo="t('coexistencia.onda2.consultar')"
            variante="secundario"
            tipo="submit"
            data-testid="onda2-consultar"
          />
          <SanteSelecao
            id="onda2-filtro-unidade"
            v-model="filtroUnidade"
            :rotulo="t('coexistencia.onda2.unidade')"
            :opcoes="opcoesUnidade"
            busca
            data-testid="onda2-filtro-unidade"
          />
        </form>
        <MensagemErro v-if="acompanhamento.error.value" :erro="acompanhamento.error.value" />
        <p v-else-if="!dados" role="status">{{ t('coexistencia.carregando') }}</p>
        <template v-else>
          <table class="tabela" data-testid="onda2-checagem">
            <caption>
              {{
                t('coexistencia.onda2.checagem')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('coexistencia.onda2.dia') }}</th>
                <th scope="col">{{ t('coexistencia.onda2.unidade') }}</th>
                <th scope="col">{{ t('coexistencia.onda2.horarios') }}</th>
                <th scope="col">{{ t('coexistencia.onda2.checados') }}</th>
                <th scope="col">{{ t('coexistencia.onda2.percentual') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in daUnidade(dados.checagem)" :key="`${x.dia}|${x.unidade}`">
                <th scope="row">{{ x.dia }}</th>
                <td>{{ x.unidade }}</td>
                <td>{{ x.horarios }}</td>
                <td>{{ x.checados }}</td>
                <td>{{ pct(x.percentual) }}</td>
              </tr>
              <tr v-if="daUnidade(dados.checagem).length === 0">
                <td colspan="5">{{ t('coexistencia.onda2.vazio') }}</td>
              </tr>
            </tbody>
          </table>
          <table class="tabela" data-testid="onda2-higienizacao">
            <caption>
              {{
                t('coexistencia.onda2.higienizacao')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('coexistencia.onda2.dia') }}</th>
                <th scope="col">{{ t('coexistencia.onda2.unidade') }}</th>
                <th scope="col">{{ t('coexistencia.onda2.solicitacoes') }}</th>
                <th scope="col">{{ t('coexistencia.onda2.avancaram') }}</th>
                <th scope="col">{{ t('coexistencia.onda2.percentual') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in daUnidade(dados.higienizacao)" :key="`${x.dia}|${x.unidade}`">
                <th scope="row">{{ x.dia }}</th>
                <td>{{ x.unidade }}</td>
                <td>{{ x.solicitacoes }}</td>
                <td>{{ x.avancaram }}</td>
                <td>{{ pct(x.percentual) }}</td>
              </tr>
              <tr v-if="daUnidade(dados.higienizacao).length === 0">
                <td colspan="5">{{ t('coexistencia.onda2.vazio') }}</td>
              </tr>
            </tbody>
          </table>
          <table class="tabela" data-testid="onda2-registros">
            <caption>
              {{
                t('coexistencia.onda2.registros')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('coexistencia.onda2.dia') }}</th>
                <th scope="col">{{ t('coexistencia.onda2.tipo') }}</th>
                <th scope="col">{{ t('coexistencia.onda2.conta') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="x in dados.registros"
                :key="`${x.dia}|${x.tipo}`"
                :data-testid="`registro-${x.dia}-${x.tipo}`"
              >
                <th scope="row">{{ x.dia }}</th>
                <td>{{ t(`coexistencia.onda2.tipos.${x.tipo}`) }}</td>
                <td>
                  {{
                    t('coexistencia.onda2.contaRegistro', {
                      novo: x.peloNovo,
                      outro: x.peloOutro,
                      total: x.total,
                    })
                  }}
                </td>
              </tr>
              <tr v-if="dados.registros.length === 0">
                <td colspan="3">{{ t('coexistencia.onda2.vazio') }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>

      <section aria-labelledby="onda2-codigos" data-testid="onda2-codigos">
        <h2 id="onda2-codigos">{{ t('coexistencia.onda2.codigos') }}</h2>
        <table class="tabela">
          <caption>
            {{
              t('coexistencia.onda2.codigos')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.onda2.tabela') }}</th>
              <th scope="col">{{ t('coexistencia.onda2.coluna') }}</th>
              <th scope="col">{{ t('coexistencia.onda2.vistos') }}</th>
              <th scope="col">{{ t('coexistencia.onda2.decisao') }}</th>
              <th scope="col">{{ t('coexistencia.onda2.confirma') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in painel.codigosAConfirmar" :key="`${c.tabela}.${c.coluna}`">
              <th scope="row">{{ c.tabela }}</th>
              <td>{{ c.coluna }}</td>
              <td>{{ c.vistos.join(', ') }} ({{ t('coexistencia.onda2.legenda') }})</td>
              <td>{{ c.decisao }}</td>
              <td>{{ c.confirma }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
