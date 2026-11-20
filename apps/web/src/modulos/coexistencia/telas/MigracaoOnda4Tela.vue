<script setup lang="ts">
// Migração gradual: onda 4 (M42; ficha, campos 7 e 12, regras 1 a 9 da onda e as regras 1 a 8 do M40): por setor do
// faturamento, da auditoria de contas, dos lotes e do protocolo, da glosa e do recurso, do contas a pagar, do contas a
// receber, da tesouraria, do repasse e do fiscal, na ordem recomendada e com o momento de cada um dentro da
// competência, o critério de liberação no estabelecimento ativo, item a item: os gerais do M40 (as operações conferidas
// e o teste de invasão calculados) e os da onda (registros conferidos no sistema anterior, reprodução da competência
// sem diferença e, no faturamento e na auditoria, o início na abertura de uma competência: a data registrada tem de
// ser o primeiro dia útil). Por setor: as operações, as respostas do faturamento e do fiscal (regra 8), os registros que
// só existem aqui e o recolhimento. No topo, a abertura da competência (regra 1) e os dias sem versão (regra 4);
// embaixo, as saídas externas (regra 5), os envios SUS (regra 6), a carga dos catálogos e os códigos "a confirmar".
import {
  ITENS_REGISTRAVEIS_ONDA_2,
  ITENS_SEM_NAO_SE_APLICA_ONDA_2,
  type ItemCriterioLiberacao,
  type PainelMigracaoOnda4,
  ROTULOS_CRITERIO_LIBERACAO,
  SITUACOES_ITEM_CRITERIO,
  type SituacaoItemCriterio,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { gravarItensOnda4, lerOnda4 } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';
import VoltarCriterioPendente from '../componentes/VoltarCriterioPendente.vue';

const { t } = useI18n();
const { permissoes } = usarSessao();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['coexistencia', 'onda4'], queryFn: lerOnda4 });
const painel = computed<PainelMigracaoOnda4 | undefined>(() => consulta.data.value);
const podeEditar = computed(() => permissoes.value.has('config.coexistenciaSetor.editar'));
const erro = ref<unknown>(null);
const recusa = ref<string | null>(null);
const mensagem = ref<string | null>(null);
const dia = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');

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
  recusa.value = null;
  mensagem.value = null;
  try {
    const r = await gravarItensOnda4(setor, {
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
    mensagem.value = t('coexistencia.onda4.gravado', { n: r.gravados, setor: nomeSetor(setor) });
    form.item = '';
    form.evidencia = '';
    form.justificativa = '';
    await cliente.invalidateQueries({ queryKey: ['coexistencia', 'onda4'] });
  } catch (e) {
    // A recusa de negócio (regra 1: fora da abertura da competência) mostra o motivo do servidor.
    if (e instanceof ErroApi && e.status === 409 && e.problema?.detail) recusa.value = e.problema.detail;
    else erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-onda4" data-testid="tela-migracao-onda4">
    <h1 id="titulo-onda4">{{ t('coexistencia.onda4.titulo') }}</h1>
    <AbasMigracao atual="onda4" />
    <p>{{ t('coexistencia.onda4.texto') }}</p>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!painel" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="painel.seguramHospital.length"
        :texto="t('coexistencia.onda2.seguram', { setores: painel.seguramHospital.join(', ') })"
        variante="aviso"
        data-testid="onda4-seguram"
      />
      <p v-else data-testid="onda4-sem-espera">{{ t('coexistencia.onda2.semEspera') }}</p>
      <p data-testid="onda4-pentest">
        <strong>{{ t('coexistencia.onda2.pentest') }}:</strong> {{ painel.pentest.motivo }}
      </p>

      <section aria-labelledby="onda4-abertura" data-testid="onda4-abertura">
        <h2 id="onda4-abertura">{{ t('coexistencia.onda4.abertura') }}</h2>
        <p>
          {{
            t('coexistencia.onda4.aberturaTexto', {
              hoje: dia(painel.abertura.hoje),
              competencia: `${painel.abertura.competencia.slice(5)}/${painel.abertura.competencia.slice(0, 4)}`,
              abertura: dia(painel.abertura.abertura),
            })
          }}
        </p>
        <p v-if="painel.abertura.hojeEhAbertura" data-testid="onda4-hoje-abertura">
          {{ t('coexistencia.onda4.hojeEhAbertura') }}
        </p>
        <p v-else data-testid="onda4-proxima">
          {{ t('coexistencia.onda4.proxima', { d: dia(painel.abertura.proximaAbertura) }) }}
        </p>
      </section>

      <section aria-labelledby="onda4-sem-versao" data-testid="onda4-sem-versao">
        <h2 id="onda4-sem-versao">{{ t('coexistencia.onda4.semVersao') }}</h2>
        <p>
          {{ t('coexistencia.onda4.semVersaoTexto', { dias: painel.semVersao.dias.map(dia).join(', ') }) }}
        </p>
        <SanteAlerta
          v-if="painel.semVersao.hojeSemVersao"
          :texto="t('coexistencia.onda4.hojeSemVersao')"
          variante="aviso"
        />
      </section>

      <div class="filtros">
        <SanteSelecao
          id="onda4-filtro-setor"
          v-model="filtroSetor"
          :rotulo="t('coexistencia.onda2.filtroSetor')"
          :opcoes="opcoesSetor"
          busca
          data-testid="onda4-filtro-setor"
        />
      </div>

      <section
        v-for="s in setoresVisiveis"
        :key="s.setor"
        :aria-labelledby="`onda4-${s.setor}`"
        :data-testid="`onda4-setor-${s.setor}`"
      >
        <h2 :id="`onda4-${s.setor}`">{{ t('coexistencia.onda2.passo', { n: s.passo }) }}: {{ s.nome }}</h2>
        <p data-testid="momento">
          <strong>{{ t('coexistencia.onda4.momento') }}:</strong> {{ s.momentoRotulo }}
        </p>
        <p>
          <strong data-testid="veredito">{{
            s.podeLiberar ? t('coexistencia.onda2.podeLiberar') : t('coexistencia.onda2.falta')
          }}</strong>
        </p>
        <p v-if="s.antesFaltam.length" data-testid="antes">
          {{ t('coexistencia.onda3.antes', { s: nomesSetores(s.antesFaltam) }) }}
        </p>
        <p v-if="s.exigeAbertura" data-testid="exige-abertura">{{ t('coexistencia.onda4.exigeAbertura') }}</p>
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
                  onda="onda4"
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
        <table v-if="s.respostas.length" class="tabela" data-testid="respostas">
          <caption>
            {{
              t('coexistencia.onda4.respostas')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.onda4.pergunta') }}</th>
              <th scope="col">{{ t('coexistencia.onda4.parte') }}</th>
              <th scope="col">{{ t('coexistencia.onda4.comoEntra') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in s.respostas" :key="r.pergunta">
              <th scope="row">{{ r.pergunta }}</th>
              <td>{{ r.parte }}</td>
              <td>{{ t(`coexistencia.onda4.comoEntraRotulos.${r.comoEntra}`) }}</td>
            </tr>
          </tbody>
        </table>
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
          :data-testid="`onda4-abrir-${s.setor}`"
          @acionar="abrir(s.setor)"
        />
      </section>

      <section
        v-if="setorAberto && podeEditar"
        aria-labelledby="titulo-registrar-onda4"
        data-testid="form-onda4"
      >
        <h2 id="titulo-registrar-onda4">
          {{ t('coexistencia.onda2.registrarDe', { setor: setorAberto.nome }) }}
        </h2>
        <form class="filtros" @submit.prevent="registrar">
          <SanteSelecao
            id="onda4-item"
            v-model="form.item"
            :rotulo="t('coexistencia.onda1.item')"
            :opcoes="opcoesItem"
            obrigatorio
            busca
            data-testid="onda4-item"
          />
          <SanteSelecao
            id="onda4-situacao"
            v-model="form.situacao"
            :rotulo="t('coexistencia.situacao')"
            :opcoes="opcoesSituacao"
            data-testid="onda4-situacao"
          />
          <SanteCampoTexto
            v-model="form.evidencia"
            :rotulo="t('coexistencia.onda1.evidencia')"
            :max-bytes="300"
            data-testid="onda4-evidencia"
          />
          <SanteData v-model="form.em" :rotulo="t('coexistencia.onda1.em')" editavel data-testid="onda4-em" />
          <SanteCampoTexto
            v-model="form.justificativa"
            :rotulo="t('coexistencia.justificativa')"
            :max-bytes="200"
            obrigatorio
            data-testid="onda4-justificativa"
          />
          <SanteBotao
            :rotulo="t('coexistencia.gravar')"
            variante="primario"
            tipo="submit"
            data-testid="onda4-gravar"
          />
        </form>
      </section>

      <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" anunciar data-testid="mensagem-onda4" />
      <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="recusa-onda4" />
      <MensagemErro v-if="erro" :erro="erro" />

      <section aria-labelledby="onda4-saidas" data-testid="onda4-saidas">
        <h2 id="onda4-saidas">{{ t('coexistencia.onda4.saidas') }}</h2>
        <p>{{ t('coexistencia.onda4.saidasTexto') }}</p>
        <ul>
          <li v-for="x in painel.saidasExternas" :key="x.id">
            {{ x.nome }}:
            {{ x.permitida ? t('coexistencia.onda4.permitida') : t('coexistencia.onda4.desligada') }}
          </li>
        </ul>
      </section>

      <section aria-labelledby="onda4-sus" data-testid="onda4-sus">
        <h2 id="onda4-sus">{{ t('coexistencia.onda4.sus') }}</h2>
        <p>{{ t('coexistencia.onda4.susTexto', { envios: painel.sus.fora.join(', ') }) }}</p>
        <p v-if="painel.sus.operacoesSus.length">
          {{ t('coexistencia.onda4.susOperacoes', { ops: painel.sus.operacoesSus.join(', ') }) }}
        </p>
      </section>

      <section aria-labelledby="onda4-catalogos" data-testid="onda4-catalogos">
        <h2 id="onda4-catalogos">{{ t('coexistencia.onda4.catalogos') }}</h2>
        <p>{{ painel.catalogos.motivo }}: {{ painel.catalogos.operacoes.join(', ') }}.</p>
      </section>

      <section aria-labelledby="onda4-codigos" data-testid="onda4-codigos">
        <h2 id="onda4-codigos">{{ t('coexistencia.onda2.codigos') }}</h2>
        <table class="tabela">
          <caption>
            {{
              t('coexistencia.onda2.codigos')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.onda2.coluna') }}</th>
              <th scope="col">{{ t('coexistencia.onda4.citados') }}</th>
              <th scope="col">{{ t('coexistencia.onda4.vistos') }}</th>
              <th scope="col">{{ t('coexistencia.onda2.decisao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in painel.codigosAConfirmar" :key="c.coluna" :data-testid="`codigo-${c.coluna}`">
              <th scope="row">{{ c.coluna }}</th>
              <td>{{ c.citados.join(', ') || '—' }}</td>
              <td>
                {{ c.vistos.map((v) => v || t('coexistencia.onda4.vazio')).join(', ') || '—' }} ({{
                  t('coexistencia.onda2.legenda')
                }})
              </td>
              <td>{{ c.dp }} · {{ c.pergunta }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
