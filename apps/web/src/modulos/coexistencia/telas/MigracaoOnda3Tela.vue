<script setup lang="ts">
// Migração gradual: onda 3 (M41; ficha, campos 2, 10 e 12, regras 1 e 5 da onda e as regras 1 a 8 do M40): por setor
// da onda 3 (almoxarifado central e compras; farmácia central; farmácias satélites; farmácia clínica), na ordem
// recomendada, o critério de liberação no estabelecimento ativo, item a item: os gerais do M40 (as operações conferidas
// e o teste de invasão calculados) e os da onda (inventário recente, documentos conferidos no sistema anterior,
// conferência de saldo e preço médio e, nas farmácias, a prescrição em uso na unidade), registrados pelo comitê com a
// evidência e a data. Por setor: as operações P1 e P2, o aviso da ordem, os registros que só existem aqui e o
// recolhimento. No topo, a regra 1 por local (unidades atendidas e as que faltam); embaixo, o que fica fora da onda
// (farmácia ambulatorial e livro oficial) e os códigos "a confirmar".
import {
  ITENS_REGISTRAVEIS_ONDA_2,
  ITENS_SEM_NAO_SE_APLICA_ONDA_2,
  type ItemCriterioLiberacao,
  type PainelMigracaoOnda3,
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
import { gravarItensOnda3, lerOnda3 } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';
import VoltarCriterioPendente from '../componentes/VoltarCriterioPendente.vue';

const { t } = useI18n();
const { permissoes } = usarSessao();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['coexistencia', 'onda3'], queryFn: lerOnda3 });
const painel = computed<PainelMigracaoOnda3 | undefined>(() => consulta.data.value);
const podeEditar = computed(() => permissoes.value.has('config.coexistenciaSetor.editar'));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);

const filtroSetor = ref<string>('');
const opcoesSetor = computed(() => [
  { valor: '', rotulo: t('coexistencia.onda2.todos') },
  ...(painel.value?.setores ?? []).map((s) => ({ valor: s.setor, rotulo: `${s.passo}. ${s.nome}` })),
]);
const setoresVisiveis = computed(() =>
  (painel.value?.setores ?? []).filter((s) => !filtroSetor.value || s.setor === filtroSetor.value),
);
const nomeSetor = (id: string) => painel.value?.setores.find((s) => s.setor === id)?.nome ?? id;
const nomesSetores = (ids: readonly string[]) => ids.map(nomeSetor).join(', ');

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
    .map((i) => ({ valor: i.item, rotulo: ROTULOS_CRITERIO_LIBERACAO[i.item as ItemCriterioLiberacao] })),
);
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
    const r = await gravarItensOnda3(setor, {
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
    mensagem.value = t('coexistencia.onda3.gravado', { n: r.gravados, setor: nomeSetor(setor) });
    form.item = '';
    form.evidencia = '';
    form.justificativa = '';
    await cliente.invalidateQueries({ queryKey: ['coexistencia', 'onda3'] });
  } catch (e) {
    erro.value = e;
  }
}
const faltamRegra1 = computed(() => (painel.value?.regra1.locais ?? []).some((l) => l.faltam.length > 0));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-onda3" data-testid="tela-migracao-onda3">
    <h1 id="titulo-onda3">{{ t('coexistencia.onda3.titulo') }}</h1>
    <AbasMigracao atual="onda3" />
    <p>{{ t('coexistencia.onda3.texto') }}</p>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!painel" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="painel.seguramHospital.length"
        :texto="t('coexistencia.onda2.seguram', { setores: painel.seguramHospital.join(', ') })"
        variante="aviso"
        data-testid="onda3-seguram"
      />
      <p v-else data-testid="onda3-sem-espera">{{ t('coexistencia.onda2.semEspera') }}</p>
      <p data-testid="onda3-pentest">
        <strong>{{ t('coexistencia.onda2.pentest') }}:</strong> {{ painel.pentest.motivo }}
      </p>

      <section aria-labelledby="onda3-regra1" data-testid="onda3-regra1">
        <h2 id="onda3-regra1">{{ t('coexistencia.onda3.regra1') }}</h2>
        <p>{{ t('coexistencia.onda3.regra1Texto') }}</p>
        <SanteAlerta
          v-if="!painel.regra1.lido"
          :texto="t('coexistencia.onda3.regra1NaoLida')"
          variante="aviso"
        />
        <template v-else>
          <p data-testid="onda3-com-prescricao">
            {{
              t('coexistencia.onda3.comPrescricao', {
                u: painel.regra1.unidadesComPrescricao.join(', ') || t('coexistencia.onda3.nenhuma'),
              })
            }}
          </p>
          <table class="tabela">
            <caption>
              {{
                t('coexistencia.onda3.regra1')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('suprimentos.onda3.local') }}</th>
                <th scope="col">{{ t('coexistencia.onda3.unidades') }}</th>
                <th scope="col">{{ t('coexistencia.onda3.faltam') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in painel.regra1.locais" :key="l.local" :data-testid="`regra1-local-${l.local}`">
                <th scope="row">{{ t('coexistencia.onda3.local', { l: l.local }) }}</th>
                <td>{{ l.unidades.join(', ') }}</td>
                <td data-testid="faltam">{{ l.faltam.join(', ') || t('coexistencia.onda3.nenhuma') }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!faltamRegra1" data-testid="onda3-regra1-ok">{{ t('coexistencia.onda3.regra1Ok') }}</p>
        </template>
      </section>

      <div class="filtros">
        <SanteSelecao
          id="onda3-filtro-setor"
          v-model="filtroSetor"
          :rotulo="t('coexistencia.onda2.filtroSetor')"
          :opcoes="opcoesSetor"
          busca
          data-testid="onda3-filtro-setor"
        />
      </div>

      <section
        v-for="s in setoresVisiveis"
        :key="s.setor"
        :aria-labelledby="`onda3-${s.setor}`"
        :data-testid="`onda3-setor-${s.setor}`"
      >
        <h2 :id="`onda3-${s.setor}`">{{ t('coexistencia.onda2.passo', { n: s.passo }) }}: {{ s.nome }}</h2>
        <p>
          <strong data-testid="veredito">{{
            s.podeLiberar ? t('coexistencia.onda2.podeLiberar') : t('coexistencia.onda2.falta')
          }}</strong>
        </p>
        <p v-if="s.antesFaltam.length" data-testid="antes">
          {{ t('coexistencia.onda3.antes', { s: nomesSetores(s.antesFaltam) }) }}
        </p>
        <p v-if="s.exigePrescricao" data-testid="exige-prescricao">
          {{ t('coexistencia.onda3.exigePrescricao') }}
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
                  onda="onda3"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <details>
          <summary>{{ t('coexistencia.onda2.operacoes', { n: s.operacoes.length }) }}</summary>
          <ul>
            <li v-for="o in s.operacoes" :key="o.nome" :data-testid="`operacao-${o.nome}`">
              {{ o.nome }} ({{ t('coexistencia.onda3.prioridade') }} {{ o.prioridade }}): {{ o.estado
              }}<template v-if="o.fora"> ({{ t('coexistencia.onda2.fora') }})</template>
            </li>
          </ul>
        </details>
        <p v-if="s.recursosSoNoNovo.length" data-testid="recursos-novos">
          {{ t('coexistencia.onda3.recursos') }}: {{ s.recursosSoNoNovo.map((r) => r.imprime).join('; ') }}.
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
          :data-testid="`onda3-abrir-${s.setor}`"
          @acionar="abrir(s.setor)"
        />
      </section>

      <section
        v-if="setorAberto && podeEditar"
        aria-labelledby="titulo-registrar-onda3"
        data-testid="form-onda3"
      >
        <h2 id="titulo-registrar-onda3">
          {{ t('coexistencia.onda2.registrarDe', { setor: setorAberto.nome }) }}
        </h2>
        <form class="filtros" @submit.prevent="registrar">
          <SanteSelecao
            id="onda3-item"
            v-model="form.item"
            :rotulo="t('coexistencia.onda1.item')"
            :opcoes="opcoesItem"
            obrigatorio
            busca
            data-testid="onda3-item"
          />
          <SanteSelecao
            id="onda3-situacao"
            v-model="form.situacao"
            :rotulo="t('coexistencia.situacao')"
            :opcoes="opcoesSituacao"
            data-testid="onda3-situacao"
          />
          <SanteCampoTexto
            v-model="form.evidencia"
            :rotulo="t('coexistencia.onda1.evidencia')"
            :max-bytes="300"
            data-testid="onda3-evidencia"
          />
          <SanteData v-model="form.em" :rotulo="t('coexistencia.onda1.em')" editavel data-testid="onda3-em" />
          <SanteCampoTexto
            v-model="form.justificativa"
            :rotulo="t('coexistencia.justificativa')"
            :max-bytes="200"
            obrigatorio
            data-testid="onda3-justificativa"
          />
          <SanteBotao
            :rotulo="t('coexistencia.gravar')"
            variante="primario"
            tipo="submit"
            data-testid="onda3-gravar"
          />
        </form>
      </section>

      <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" anunciar data-testid="mensagem-onda3" />
      <MensagemErro v-if="erro" :erro="erro" />

      <section aria-labelledby="onda3-fora" data-testid="onda3-fora">
        <h2 id="onda3-fora">{{ t('coexistencia.onda3.foraDaOnda') }}</h2>
        <ul>
          <li v-for="f in painel.foraDaOnda" :key="f.chave">{{ f.chave }}: {{ f.motivo }}</li>
        </ul>
      </section>

      <section aria-labelledby="onda3-codigos" data-testid="onda3-codigos">
        <h2 id="onda3-codigos">{{ t('coexistencia.onda2.codigos') }}</h2>
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
