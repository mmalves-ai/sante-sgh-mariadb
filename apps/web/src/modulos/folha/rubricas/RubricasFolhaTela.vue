<script setup lang="ts">
// Rubricas, incidências e tabelas legais (M53.2, etapa F1; item `Gestão de pessoas > Folha de pagamento`;
// `pessoas.rubrica.ler` / `pessoas.rubrica.editar`; regras 3 e 7): a competência e a empresa com busca (ADR 0027); as
// rubricas em vigor com as incidências, os códigos do eSocial e a conferência; a tabela legal da vigência com as faixas
// e a conferência; e os cadastros genéricos da folha embutidos (onde se grava, com a versão lida e a trilha).
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import type { RubricaFolha } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import AbaCadastrosFolha from './AbaCadastrosFolha.vue';
import AbaRubricas from './AbaRubricas.vue';
import AbaTabelasLegais from './AbaTabelasLegais.vue';
import { lerApoioRubricas } from './api-rubricas.js';
import { competenciasAte, rotuloCompetencia } from './comum-rubricas.js';

const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const apoio = useQuery({ queryKey: ['folha', 'rubricas', 'apoio'], queryFn: lerApoioRubricas });
const a = computed(() => apoio.data.value ?? null);

type Aba = 'rubricas' | 'tabelas' | 'cadastros';
// M53.2 (D-ABRIR-532): cada aba com a sua permissão (o apoio diz quais o perfil consulta); a dos cadastros, com os que
// ele consulta.
const abas = computed<Aba[]>(() =>
  a.value
    ? ([
        a.value.lerRubricas ? 'rubricas' : null,
        a.value.tabelaLegal.ler ? 'tabelas' : null,
        a.value.cadastros.length > 0 ? 'cadastros' : null,
      ].filter((x) => x !== null) as Aba[])
    : [],
);
const aba = ref<Aba>('rubricas');
watch(abas, (l) => {
  if (l.length > 0 && !l.includes(aba.value)) aba.value = l[0]!;
});
const hoje = props.hoje ?? new Date().toISOString().slice(0, 10);
const competencias = competenciasAte(hoje, 36);
const competencia = ref<string>(competencias[0]!);
const opcoesCompetencia = competencias.map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) }));
const cadastro = ref<string | null>(null);
const abrir = ref<{ recurso: string; codigo: string; busca: string } | null>(null);

function abrirCadastro(recurso: string, r: RubricaFolha | null = null) {
  cadastro.value = recurso;
  // A rubrica do detalhe: o cadastro abre filtrado na descrição dela e, se a gravação deixar, na alteração (código = o
  // identificador da rubrica, a chave do cadastro).
  abrir.value = r ? { recurso, codigo: String(r.id), busca: r.descricao } : null;
  aba.value = 'cadastros';
}
// Trocou de cadastro: a rubrica escolhida no detalhe não vale mais (voltar não reabre a alteração).
watch(cadastro, (c) => {
  if (abrir.value && c !== abrir.value.recurso) abrir.value = null;
});
// Aviso da gravação por aba (a tabela legal não depende da chave da folha, D-CHAVE-532).
const aviso = computed(() => {
  const x = a.value;
  if (!x) return null;
  if (aba.value === 'tabelas')
    return x.tabelaLegal.gravacaoLigada
      ? null
      : (x.tabelaLegal.motivoDesligada ?? t('rubricasFolha.soConsulta'));
  return x.gravacaoLigada ? null : (x.motivoDesligada ?? t('rubricasFolha.soConsulta'));
});
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="rubricas-titulo" data-testid="tela-rubricas-folha">
    <h1 id="rubricas-titulo">{{ t('rubricasFolha.titulo') }}</h1>
    <p>{{ t('rubricasFolha.subtitulo') }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('rubricasFolha.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="aviso"
        :texto="
          aba === 'cadastros' && a.tabelaLegal.gravacaoLigada
            ? `${aviso} ${t('rubricasFolha.tabelaLegalGrava')}`
            : aviso
        "
        variante="info"
        data-testid="rubricas-gravacao-desligada"
      />
      <p v-if="abas.length === 0" role="status" data-testid="rubricas-sem-abas">
        {{ t('rubricasFolha.semAbas') }}
      </p>
      <div class="campos" data-testid="rubricas-filtros">
        <SanteSelecao
          v-model="competencia"
          :rotulo="t('rubricasFolha.competencia')"
          :opcoes="opcoesCompetencia"
          busca
          data-testid="rubricas-competencia"
        />
      </div>
      <div class="acoes" role="tablist">
        <SanteBotao
          v-for="x in abas"
          :key="x"
          role="tab"
          :aria-selected="aba === x"
          :variante="aba === x ? 'primario' : 'secundario'"
          :rotulo="t(`rubricasFolha.abas.${x}`)"
          :data-testid="`rubricas-aba-${x}`"
          @acionar="aba = x"
        />
      </div>
      <AbaRubricas
        v-if="aba === 'rubricas' && abas.includes('rubricas')"
        :apoio="a"
        :competencia="competencia"
        @alterar="(r) => abrirCadastro('pessoas.rubrica', r)"
      />
      <AbaTabelasLegais
        v-else-if="aba === 'tabelas' && abas.includes('tabelas')"
        :competencia="competencia"
        @abrir-cadastro="abrirCadastro('pessoas.tabelaLegalFolha')"
      />
      <AbaCadastrosFolha
        v-else-if="aba === 'cadastros' && abas.includes('cadastros')"
        v-model="cadastro"
        :apoio="a"
        :abrir="abrir"
      />
    </template>
  </section>
</template>

<style scoped src="../../pessoas/estilo-pessoas.css"></style>
