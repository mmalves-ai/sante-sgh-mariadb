<script setup lang="ts">
// Migração gradual: onda 1 (M39; ficha, regra 1 e entregável 3; cap-15 §15.3.2): por setor da onda 1 (cadastros,
// agendamento e call center, recepção ambulatorial), a lista para ligar no estabelecimento ativo, item a item, com o
// veredito (pode ligar, falta ou bloqueado, DP-4). O item das operações é calculado pelo catálogo (nunca registrado à
// mão); os demais o comitê registra com a evidência e a data (sem nome de pessoa nem dado de paciente). Embaixo, os
// indicadores de disputa do dia com a conta impressa e as telas da onda com as permissões do catálogo.
import {
  INDICADORES_DISPUTA,
  ITENS_POR_SETOR,
  type PainelOnda1,
  SITUACOES_ITEM_LIGAR,
  type SituacaoItemLigar,
  type ItemLigarSetor,
  type SetorOnda1,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { gravarItensLigar, lerOnda1 } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';
import VoltarCriterioPendente from '../componentes/VoltarCriterioPendente.vue';

const { t } = useI18n();
const { permissoes } = usarSessao();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['coexistencia', 'onda1'], queryFn: lerOnda1 });
const painel = computed<PainelOnda1 | undefined>(() => consulta.data.value);
const podeEditar = computed(() => permissoes.value.has('config.coexistenciaSetor.editar'));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const aberto = ref<SetorOnda1 | null>(null);
const form = reactive({
  item: '' as ItemLigarSetor | '',
  situacao: 'cumprido' as SituacaoItemLigar,
  evidencia: '',
  em: null as string | null,
  justificativa: '',
});

const avaliacaoAberta = computed(
  () => painel.value?.avaliacoes.find((a) => a.setor === aberto.value) ?? null,
);
const opcoesItem = computed(() =>
  aberto.value
    ? ITENS_POR_SETOR[aberto.value]
        .filter((i) => i !== 'operacoes-conferidas')
        .map((i) => ({
          valor: i,
          rotulo: avaliacaoAberta.value?.itens.find((x) => x.item === i)?.rotulo ?? i,
        }))
    : [],
);
const opcoesSituacao = SITUACOES_ITEM_LIGAR.map((s) => ({
  valor: s,
  rotulo: t(`coexistencia.onda1.situacoesItem.${s}`),
}));

function abrir(setor: SetorOnda1): void {
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
    const r = await gravarItensLigar(setor, {
      itens: [
        {
          item: form.item as Exclude<ItemLigarSetor, 'operacoes-conferidas'>,
          situacao: form.situacao,
          evidencia: form.evidencia,
          em: form.situacao === 'pendente' ? null : form.em,
        },
      ],
      justificativa: form.justificativa,
    });
    mensagem.value = t('coexistencia.onda1.gravado', {
      n: r.gravados,
      setor: avaliacaoAberta.value?.nome ?? setor,
    });
    form.item = '';
    form.evidencia = '';
    form.justificativa = '';
    await cliente.invalidateQueries({ queryKey: ['coexistencia', 'onda1'] });
  } catch (e) {
    erro.value = e;
  }
}

const valorDisputa = (
  s: PainelOnda1['disputa']['setores'][number],
  i: (typeof INDICADORES_DISPUTA)[number],
): string =>
  i === 'colisoes-grade'
    ? String(s.colisoesGrade)
    : i === 'recusas-horario-ocupado'
      ? String(s.recusasHorarioOcupado)
      : i === 'esperas-trava'
        ? String(s.esperasTrava)
        : s.senhas
          ? String(s.senhas.total)
          : '—';
const nomeSetor = (setor: string) => painel.value?.avaliacoes.find((a) => a.setor === setor)?.nome ?? setor;
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-onda1" data-testid="tela-migracao-onda1">
    <h1 id="titulo-onda1">{{ t('coexistencia.onda1.titulo') }}</h1>
    <AbasMigracao atual="onda1" />
    <p>{{ t('coexistencia.onda1.texto') }}</p>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!painel" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <section
        v-for="a in painel.avaliacoes"
        :key="a.setor"
        :aria-labelledby="`onda1-${a.setor}`"
        :data-testid="`onda1-setor-${a.setor}`"
      >
        <h2 :id="`onda1-${a.setor}`">{{ t('coexistencia.onda1.lista', { setor: a.nome }) }}</h2>
        <p>
          <strong data-testid="veredito">{{ t(`coexistencia.onda1.vereditos.${a.veredito}`) }}</strong>
          <span v-if="a.bloqueio" data-testid="bloqueio">: {{ a.bloqueio }}</span>
        </p>
        <table class="tabela">
          <caption>
            {{
              t('coexistencia.onda1.lista', { setor: a.nome })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.onda1.item') }}</th>
              <th scope="col">{{ t('coexistencia.situacao') }}</th>
              <th scope="col">{{ t('coexistencia.onda1.detalhe') }}</th>
              <th v-if="podeEditar" scope="col">{{ t('coexistencia.ciclo.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in a.itens" :key="i.item" :data-testid="`item-${i.item}`">
              <th scope="row">{{ i.rotulo }}</th>
              <td data-testid="situacao">{{ t(`coexistencia.onda1.situacoesItem.${i.situacao}`) }}</td>
              <td>{{ i.detalhe }}</td>
              <td v-if="podeEditar">
                <VoltarCriterioPendente
                  :setor="a.setor"
                  :item="i.item"
                  :rotulo="i.rotulo"
                  :situacao="i.situacao"
                  onda="onda1"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <details v-if="a.operacoesPendentes.length">
          <summary>
            {{ t('coexistencia.onda1.operacoesPendentes') }} ({{ a.operacoesPendentes.length }})
          </summary>
          <ul>
            <li v-for="o in a.operacoesPendentes" :key="o.nome">{{ o.nome }}: {{ o.estado }}</li>
          </ul>
        </details>
        <details v-if="a.foraDaOnda.length">
          <summary>{{ t('coexistencia.onda1.foraDaOnda') }} ({{ a.foraDaOnda.length }})</summary>
          <ul>
            <li v-for="o in a.foraDaOnda" :key="o.nome">{{ o.nome }}: {{ o.motivo }}</li>
          </ul>
        </details>
        <SanteBotao
          v-if="podeEditar"
          :rotulo="t('coexistencia.onda1.registrar')"
          variante="secundario"
          :data-testid="`onda1-abrir-${a.setor}`"
          @acionar="abrir(a.setor)"
        />
      </section>

      <section
        v-if="aberto && avaliacaoAberta && podeEditar"
        aria-labelledby="titulo-registrar"
        data-testid="form-onda1"
      >
        <h2 id="titulo-registrar">
          {{ t('coexistencia.onda1.registrarDe', { setor: avaliacaoAberta.nome }) }}
        </h2>
        <form class="filtros" @submit.prevent="registrar">
          <SanteSelecao
            id="onda1-item"
            v-model="form.item"
            :rotulo="t('coexistencia.onda1.item')"
            :opcoes="opcoesItem"
            obrigatorio
            busca
            data-testid="onda1-item"
          />
          <SanteSelecao
            id="onda1-situacao"
            v-model="form.situacao"
            :rotulo="t('coexistencia.situacao')"
            :opcoes="opcoesSituacao"
            data-testid="onda1-situacao"
          />
          <SanteCampoTexto
            v-model="form.evidencia"
            :rotulo="t('coexistencia.onda1.evidencia')"
            :max-bytes="300"
            data-testid="onda1-evidencia"
          />
          <SanteData v-model="form.em" :rotulo="t('coexistencia.onda1.em')" editavel data-testid="onda1-em" />
          <SanteCampoTexto
            v-model="form.justificativa"
            :rotulo="t('coexistencia.justificativa')"
            :max-bytes="200"
            obrigatorio
            data-testid="onda1-justificativa"
          />
          <SanteBotao
            :rotulo="t('coexistencia.gravar')"
            variante="primario"
            tipo="submit"
            data-testid="onda1-gravar"
          />
        </form>
      </section>

      <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" anunciar data-testid="mensagem-onda1" />
      <MensagemErro v-if="erro" :erro="erro" />

      <section aria-labelledby="onda1-disputa" data-testid="onda1-disputa">
        <h2 id="onda1-disputa">{{ t('coexistencia.onda1.disputa') }} ({{ painel.disputa.dia }})</h2>
        <table class="tabela">
          <caption>
            {{
              t('coexistencia.onda1.disputa')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.setor') }}</th>
              <th v-for="i in INDICADORES_DISPUTA" :key="i" scope="col">
                {{ t(`coexistencia.onda1.indicadores.${i}`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in painel.disputa.setores" :key="s.setor" :data-testid="`disputa-${s.setor}`">
              <th scope="row">{{ nomeSetor(s.setor) }}</th>
              <td v-for="i in INDICADORES_DISPUTA" :key="i" :data-testid="`disputa-${s.setor}-${i}`">
                <strong>{{ valorDisputa(s, i) }}</strong>
                <br />
                <small>{{ s.parcelas[i] }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="onda1-telas" data-testid="onda1-telas">
        <h2 id="onda1-telas">{{ t('coexistencia.onda1.telas') }}</h2>
        <table class="tabela">
          <caption>
            {{
              t('coexistencia.onda1.telas')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.onda1.tela') }}</th>
              <th scope="col">{{ t('coexistencia.setor') }}</th>
              <th scope="col">{{ t('coexistencia.onda1.caminho') }}</th>
              <th scope="col">{{ t('coexistencia.onda1.permissoesLer') }}</th>
              <th scope="col">{{ t('coexistencia.onda1.permissoesAgir') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in painel.telas" :key="x.tela">
              <th scope="row">{{ x.tela }}</th>
              <td>{{ nomeSetor(x.setor) }}</td>
              <td>{{ x.item }}</td>
              <td>{{ x.ler.join(', ') || t('coexistencia.onda1.dispositivo') }}</td>
              <td>{{ x.agir.join(', ') || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
