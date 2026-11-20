<script setup lang="ts">
// Minhas avaliações (W0-06, parte 5d-3-2; M2 de mercado; `pessoas.avaliacao.ciencia`, toda pessoa, só o próprio
// vínculo): as avaliações de desempenho finalizadas do próprio colaborador, com as notas, o parecer do avaliador e as
// versões anteriores (a correção nunca apaga a versão corrigida), e a ciência dada pelo próprio colaborador, com a
// observação opcional (a discordância, se houver). A ciência registra que a pessoa tomou conhecimento; não é
// concordância. O servidor confere de novo que a avaliação é de um vínculo do login (`acoes.cienciaPropria`).
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataBr } from '../comum.js';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { cienciaPropria, lerMinhaAvaliacao, lerMinhasAvaliacoes } from './api-avaliacao.js';
import { textoOuNulo } from './avaliacao-comum.js';

const { t } = useI18n();
const qc = useQueryClient();
const lista = useQuery({ queryKey: ['pessoas', 'avaliacao', 'minhas'], queryFn: lerMinhasAvaliacoes });
const avaliacoes = computed(() => lista.data.value ?? null);
/** A avaliação aberta (a lista ou uma versão anterior). */
const aberta = ref<number | null>(null);
const ficha = useQuery({
  queryKey: computed(() => ['pessoas', 'avaliacao', 'minhas', aberta.value]),
  queryFn: () => lerMinhaAvaliacao(aberta.value as number),
  enabled: computed(() => typeof aberta.value === 'number'),
});
const f = computed(() => ficha.data.value ?? null);
const a = computed(() => f.value?.avaliacao ?? null);
const outras = computed(() => (f.value?.versoes ?? []).filter((v) => v.avaliacao.id !== a.value?.id));

const quando = (em: string | null) => (em ? `${dataBr(em.slice(0, 10))} ${em.slice(11, 16)}` : '—');
const marco = (m: 45 | 90 | null) => (m === null ? '' : t('pessoas.avaliacao.ficha.marcoTexto', { m }));
const resultado = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);
const dialogo = ref(false);
const observacao = ref('');

function abrir(id: number): void {
  resultado.value = null;
  erro.value = null;
  aberta.value = id;
}
function pedirCiencia(): void {
  observacao.value = '';
  erro.value = null;
  dialogo.value = true;
}
async function darCiencia(): Promise<void> {
  if (!a.value) return;
  erro.value = null;
  ocupado.value = true;
  try {
    const r = await cienciaPropria({
      avaliacao: a.value.id,
      versao: a.value.versao,
      observacao: textoOuNulo(observacao.value),
    });
    resultado.value = r.mensagem;
    dialogo.value = false;
    await qc.invalidateQueries({ queryKey: ['pessoas', 'avaliacao'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="pes-minhas-titulo" data-testid="tela-minhas-avaliacoes">
    <h1 id="pes-minhas-titulo">{{ t('pessoas.avaliacao.minhas.titulo') }}</h1>
    <p>{{ t('pessoas.avaliacao.minhas.subtitulo') }}</p>
    <div role="status" aria-live="polite">
      <SanteAlerta v-if="resultado" :texto="resultado" variante="info" data-testid="minhas-resultado" />
    </div>
    <ErroPessoas v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!avaliacoes" role="status">{{ t('pessoas.carregando') }}</p>
    <SanteAlerta
      v-else-if="avaliacoes.length === 0"
      :texto="t('pessoas.avaliacao.minhas.vazio')"
      variante="info"
      data-testid="minhas-vazio"
    />
    <table v-else class="tabela" data-testid="minhas-lista">
      <caption class="secundario">
        {{
          t('pessoas.avaliacao.minhas.legenda')
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('pessoas.avaliacao.ficha.finalizada') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.ciclos.avaliador') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.ciclos.numero') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.ciclos.situacao') }}</th>
          <th scope="col">{{ t('pessoas.avaliacao.minhas.ficha') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="x in avaliacoes"
          :key="x.id"
          :data-testid="`minha-avaliacao-${x.id}`"
          :data-situacao="x.situacao"
        >
          <td>{{ quando(x.finalizadaEm) }} {{ marco(x.marco) }}</td>
          <td>{{ x.avaliador }}</td>
          <td>{{ x.numero }}</td>
          <td>
            {{ t(`pessoas.avaliacao.situacoesAvaliacao.${x.situacao}`) }}
            <span v-if="x.substituida" class="secundario">({{ t('pessoas.avaliacao.substituida') }})</span>
          </td>
          <td>
            <SanteBotao
              :rotulo="t('pessoas.avaliacao.minhas.abrir')"
              variante="texto"
              :data-testid="`minha-abrir-${x.id}`"
              @acionar="abrir(x.id)"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <section v-if="aberta !== null" class="bloco" aria-labelledby="pes-minha-ficha" data-testid="minha-ficha">
      <h2 id="pes-minha-ficha">
        {{ a ? t('pessoas.avaliacao.minhas.fichaTitulo', { numero: a.numero }) : '' }}
      </h2>
      <ErroPessoas v-if="ficha.isError.value" :erro="ficha.error.value" />
      <p v-else-if="!f || !a" role="status">{{ t('pessoas.carregando') }}</p>
      <template v-else>
        <dl class="dados">
          <dt>{{ t('pessoas.avaliacao.ficha.ciclo') }}</dt>
          <dd>{{ f.ciclo.nome }} {{ marco(a.marco) }}</dd>
          <dt>{{ t('pessoas.avaliacao.ciclos.avaliador') }}</dt>
          <dd>{{ a.avaliador }}</dd>
          <dt>{{ t('pessoas.avaliacao.ciclos.situacao') }}</dt>
          <dd data-testid="minha-situacao">
            {{ t(`pessoas.avaliacao.situacoesAvaliacao.${a.situacao}`) }}
            <span v-if="a.substituida" class="secundario">({{ t('pessoas.avaliacao.substituida') }})</span>
          </dd>
          <dt>{{ t('pessoas.avaliacao.ciclos.escala') }}</dt>
          <dd>{{ t('pessoas.avaliacao.ciclos.escalaTexto', { max: f.ciclo.notaMax }) }}</dd>
          <template v-if="a.motivoCorrecao">
            <dt>{{ t('pessoas.avaliacao.ficha.motivoCorrecao') }}</dt>
            <dd>{{ a.motivoCorrecao }}</dd>
          </template>
          <template v-if="a.finalizadaEm">
            <dt>{{ t('pessoas.avaliacao.ficha.finalizada') }}</dt>
            <dd>
              {{ t('pessoas.avaliacao.ficha.porEm', { por: a.finalizadaPor, em: quando(a.finalizadaEm) }) }}
            </dd>
          </template>
          <template v-if="a.cienciaEm">
            <dt>{{ t('pessoas.avaliacao.ficha.ciencia') }}</dt>
            <dd data-testid="minha-ciencia">
              {{ t('pessoas.avaliacao.ficha.porEm', { por: a.cienciaPor, em: quando(a.cienciaEm) }) }}
              · {{ t(`pessoas.avaliacao.ficha.modos.${a.cienciaModo ?? 'proprio'}`) }}
              <div v-if="a.cienciaObs" class="secundario">{{ a.cienciaObs }}</div>
            </dd>
          </template>
        </dl>

        <h3>{{ t('pessoas.avaliacao.ficha.notas') }}</h3>
        <table class="tabela" data-testid="minha-notas">
          <thead>
            <tr>
              <th scope="col">{{ t('pessoas.avaliacao.competencias.nome') }}</th>
              <th scope="col">{{ t('pessoas.avaliacao.ficha.nota') }}</th>
              <th scope="col">{{ t('pessoas.avaliacao.ficha.comentario') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in f.notas" :key="n.competencia" :data-testid="`minha-nota-${n.competencia}`">
              <th scope="row">{{ n.nome }}</th>
              <td>{{ n.nota ?? '—' }}</td>
              <td>{{ n.comentario || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <template v-if="a.parecer">
          <h4>{{ t('pessoas.avaliacao.ficha.parecer') }}</h4>
          <p data-testid="minha-parecer">{{ a.parecer }}</p>
        </template>
        <SanteAlerta
          v-if="f.acoes.cienciaPropria"
          :texto="t('pessoas.avaliacao.minhas.cienciaPendente')"
          variante="info"
          data-testid="minha-ciencia-pendente"
        />
        <div class="acoes">
          <SanteBotao
            v-if="f.acoes.cienciaPropria"
            :rotulo="t('pessoas.avaliacao.minhas.darCiencia')"
            data-testid="minha-dar-ciencia"
            @acionar="pedirCiencia"
          />
          <SanteBotao :rotulo="t('pessoas.avaliacao.fechar')" variante="texto" @acionar="aberta = null" />
        </div>

        <section v-if="outras.length > 0" class="bloco" data-testid="minha-versoes">
          <h3>{{ t('pessoas.avaliacao.ficha.versoes') }}</h3>
          <ul>
            <li v-for="v in outras" :key="v.avaliacao.id" :data-testid="`minha-versao-${v.avaliacao.numero}`">
              {{
                t('pessoas.avaliacao.ficha.versaoLinha', {
                  numero: v.avaliacao.numero,
                  situacao: t(`pessoas.avaliacao.situacoesAvaliacao.${v.avaliacao.situacao}`),
                  em: quando(v.avaliacao.finalizadaEm ?? v.avaliacao.criadoEm),
                })
              }}
              <div v-if="v.avaliacao.motivoCorrecao" class="secundario">{{ v.avaliacao.motivoCorrecao }}</div>
              <ul class="secundario">
                <li v-for="n in v.notas" :key="n.competencia">
                  {{ t('pessoas.avaliacao.ficha.notaLinha', { nome: n.nome, nota: n.nota ?? '—' }) }}
                </li>
              </ul>
              <SanteBotao
                v-if="v.avaliacao.situacao !== 'rascunho'"
                :rotulo="t('pessoas.avaliacao.ficha.verVersao', { numero: v.avaliacao.numero })"
                variante="texto"
                :data-testid="`minha-ver-versao-${v.avaliacao.numero}`"
                @acionar="abrir(v.avaliacao.id)"
              />
            </li>
          </ul>
        </section>
      </template>
    </section>

    <SanteDialogo v-model:visivel="dialogo" :titulo="t('pessoas.avaliacao.minhas.darCiencia')">
      <form class="bloco" data-testid="dialogo-minha-ciencia" @submit.prevent="darCiencia">
        <p>{{ t('pessoas.avaliacao.minhas.cienciaTexto') }}</p>
        <SanteCampoTexto
          v-model="observacao"
          :rotulo="t('pessoas.avaliacao.minhas.observacao')"
          :max-bytes="2000"
          multilinha
          data-testid="minha-ciencia-observacao"
        />
        <ErroPessoas v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            :rotulo="t('pessoas.avaliacao.minhas.confirmarCiencia')"
            tipo="submit"
            :desabilitado="ocupado"
            data-testid="minha-ciencia-confirmar"
          />
          <SanteBotao :rotulo="t('pessoas.avaliacao.fechar')" variante="texto" @acionar="dialogo = false" />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
