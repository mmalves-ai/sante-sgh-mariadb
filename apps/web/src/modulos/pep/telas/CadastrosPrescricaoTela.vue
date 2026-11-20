<script setup lang="ts">
// Cadastros clínicos e de prescrição (M24; ficha, seção 7) em consulta: protocolos de prescrição (com a
// aplicabilidade e os itens), frequências com os horários relativos e a simulação dos horários na grade da regra
// de cada unidade, kits de medicamentos e de soluções, receitas padrão, itens não padronizados e os parâmetros
// clínicos e fiscais do item. P-CAD-1: abaixo da consulta, a edição de cada cadastro pelo CRUD genérico (as mesmas
// tabelas de toda a prescrição do estabelecimento; a gravação desligada aparece com o motivo, POL-3).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import ConsultaCadastro from '../componentes/prescricao/ConsultaCadastro.vue';
import {
  itensDoProtocolo,
  lerDominiosPrescricao,
  lerHorariosPadrao,
  listarProtocolos,
  type ItemProtocolo,
} from '../api-prescricao.js';

const props = defineProps<{
  secao: 'protocolos' | 'frequencias' | 'kits' | 'receitasPadrao' | 'naoPadronizados' | 'parametrosItem';
}>();
const TITULOS: Readonly<Record<string, string>> = {
  kits: 'tituloKits',
  receitasPadrao: 'tituloReceitasPadrao',
  naoPadronizados: 'tituloNaoPadronizados',
  parametrosItem: 'tituloParametrosItem',
};
const TEXTOS: Readonly<Record<string, string>> = {
  kits: 'textoKits',
  receitasPadrao: 'textoReceitasPadrao',
  naoPadronizados: 'textoNaoPadronizados',
  parametrosItem: 'textoParametrosItem',
};
/** O cadastro de cada seção no CRUD genérico (subitem das declarações do M24). */
const SUBITEM: Readonly<Record<string, string>> = {
  protocolos: 'prescricaoProtocolos',
  frequencias: 'prescricaoFrequencias',
  kits: 'prescricaoKits',
  receitasPadrao: 'prescricaoReceitas',
  naoPadronizados: 'prescricaoNaoPadronizados',
  parametrosItem: 'prescricaoParametrosItem',
};
const { t } = useI18n();
const protocolos = useQuery({
  queryKey: ['presc', 'protocolos'],
  queryFn: () => listarProtocolos(),
  enabled: computed(() => props.secao === 'protocolos'),
});
const dominios = useQuery({
  queryKey: ['presc', 'dominios'],
  queryFn: () => lerDominiosPrescricao(),
  staleTime: 300_000,
  enabled: computed(() => props.secao === 'frequencias'),
});
const horarios = useQuery({
  queryKey: ['presc', 'horarios'],
  queryFn: () => lerHorariosPadrao(),
  enabled: computed(() => props.secao === 'frequencias'),
});
const aberto = ref<number | null>(null);
const itens = ref<ItemProtocolo[]>([]);
async function verItens(id: number): Promise<void> {
  aberto.value = id;
  itens.value = await itensDoProtocolo(id);
}
const frequencia = ref('');
const regra = ref('');
const DOSES: Readonly<Record<string, number>> = {
  '24/24': 1,
  '24 em 24 horas': 1,
  '12/12': 2,
  '08/08': 3,
  '06/06': 4,
  '04/04': 6,
  '03/03': 8,
  '02/02': 12,
  '01/01': 24,
};
const simulado = computed(() => {
  const f = dominios.data.value?.['frequencias']?.find((x) => x.id === frequencia.value);
  const r = horarios.data.value?.regras.find((x) => String(x.id) === regra.value);
  if (!f || !r) return null;
  const n = DOSES[f.nome];
  const hs = n ? (r.grade.find((g) => g.doses === n)?.horas ?? []) : [];
  return { regra: r.id, horas: hs.map((h) => `${h.slice(0, 2)}:${h.slice(2)}`).join(' · ') || '—' };
});
</script>

<template>
  <section class="tela" :aria-labelledby="`cad-${secao}`" :data-testid="`tela-cadastro-${secao}`">
    <template v-if="secao === 'protocolos'">
      <h1 :id="`cad-${secao}`">{{ t('pep.presc.cadastros.tituloProtocolos') }}</h1>
      <p>{{ t('pep.presc.cadastros.textoProtocolos') }}</p>
      <MensagemErro v-if="protocolos.isError.value" :erro="protocolos.error.value" />
      <p v-else-if="!protocolos.data.value" role="status">{{ t('pep.presc.carregando') }}</p>
      <ul v-else class="lista" data-testid="lista-protocolos">
        <li v-for="p in protocolos.data.value" :key="p.id">
          <strong>{{ p.nome }}</strong> · {{ t('pep.presc.cadastros.itens', { n: p.itens }) }} ·
          {{
            p.aplicavel
              ? t('pep.presc.cadastros.aplicavel')
              : `${t('pep.presc.cadastros.inaplicavel')}: ${p.motivo ?? ''}`
          }}
          <SanteBotao
            :rotulo="t('pep.presc.cadastros.verItens', { nome: p.nome })"
            variante="texto"
            @acionar="verItens(p.id)"
          />
          <ul v-if="aberto === p.id" :data-testid="`itens-protocolo-${p.id}`">
            <li v-for="i in itens" :key="i.id">
              {{ i.planoNome }} · {{ i.frequenciaNome ?? '' }} · {{ i.via ?? '' }}
            </li>
          </ul>
        </li>
      </ul>
    </template>
    <template v-else-if="secao in TITULOS">
      <h1 :id="`cad-${secao}`">{{ t(`pep.presc.cadastros.${TITULOS[secao]}`) }}</h1>
      <p>{{ t(`pep.presc.cadastros.${TEXTOS[secao]}`) }}</p>
      <template v-if="secao === 'kits'">
        <ConsultaCadastro secao="kitsMedicamento" :titulo="t('pep.presc.cadastros.kitsMedicamento')" />
        <ConsultaCadastro secao="kitsSolucao" :titulo="t('pep.presc.cadastros.kitsSolucao')" />
      </template>
      <ConsultaCadastro
        v-else-if="secao === 'receitasPadrao'"
        secao="receitasPadrao"
        :titulo="t('pep.presc.cadastros.tituloReceitasPadrao')"
      />
      <ConsultaCadastro
        v-else-if="secao === 'naoPadronizados'"
        secao="naoPadronizados"
        :titulo="t('pep.presc.cadastros.tituloNaoPadronizados')"
      />
      <ConsultaCadastro
        v-else
        secao="parametrosItem"
        :titulo="t('pep.presc.cadastros.tituloParametrosItem')"
        exige-termo
      />
    </template>
    <template v-else>
      <h1 :id="`cad-${secao}`">{{ t('pep.presc.cadastros.tituloFrequencias') }}</h1>
      <p>{{ t('pep.presc.cadastros.textoFrequencias') }}</p>
      <MensagemErro v-if="dominios.isError.value" :erro="dominios.error.value" />
      <p v-else-if="!dominios.data.value" role="status">{{ t('pep.presc.carregando') }}</p>
      <template v-else>
        <table data-testid="lista-frequencias">
          <caption>
            {{
              t('pep.presc.cadastros.frequencias')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('pep.presc.item.frequencia') }}</th>
              <th scope="col">{{ t('pep.presc.cadastros.natureza') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in dominios.data.value['frequencias']" :key="f.id">
              <td>{{ f.nome }}</td>
              <td>{{ t(`pep.presc.cadastros.naturezas.${f.grupo ?? 'sem'}`) }}</td>
            </tr>
          </tbody>
        </table>
        <table>
          <caption>
            {{
              t('pep.presc.cadastros.relativos')
            }}
          </caption>
          <tbody>
            <tr v-for="r in dominios.data.value['relativos']" :key="r.id">
              <th scope="row">{{ r.nome }}</th>
              <td>{{ r.grupo }}</td>
            </tr>
          </tbody>
        </table>
        <section class="bloco" data-testid="simular-frequencia">
          <h2>{{ t('pep.presc.cadastros.simular') }}</h2>
          <div class="barra">
            <SanteSelecao
              v-model="frequencia"
              :rotulo="t('pep.presc.cadastros.simularFrequencia')"
              :opcoes="[
                { valor: '', rotulo: t('pep.presc.item.escolha') },
                ...(dominios.data.value['frequencias'] ?? []).map((f) => ({ valor: f.id, rotulo: f.nome })),
              ]"
            />
            <SanteSelecao
              v-model="regra"
              :rotulo="t('pep.presc.horarios.regras')"
              :opcoes="[
                { valor: '', rotulo: t('pep.presc.item.escolha') },
                ...(horarios.data.value?.regras ?? []).map((r) => ({
                  valor: String(r.id),
                  rotulo: t('pep.presc.horarios.regra', { id: r.id }),
                })),
              ]"
            />
          </div>
          <SanteAlerta
            v-if="simulado"
            variante="info"
            :texto="t('pep.presc.cadastros.resultado', simulado)"
            data-testid="resultado-frequencia"
          />
        </section>
      </template>
    </template>
    <section class="bloco" data-testid="edicao-cadastro" :aria-label="t('pep.presc.cadastros.edicao')">
      <GrupoDominiosTela :subitem="SUBITEM[secao] ?? ''" embutida />
    </section>
  </section>
</template>

<style scoped>
.tela,
.bloco {
  display: grid;
  gap: var(--sgh-espaco-3);
}
.barra {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.lista {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-2);
}
table {
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
h2 {
  margin: 0;
}
</style>
