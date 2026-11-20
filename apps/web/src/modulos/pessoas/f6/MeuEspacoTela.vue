<script setup lang="ts">
// Meu espaço (M52.6; item `Gestão de pessoas > Autoatendimento do colaborador`; `pessoas.autoatendimento.ler`, só o
// próprio; regra 21): leve para o celular (uma coluna, cartões, alvos de 24 px). O vínculo é o do login; o servidor
// recusa outro. Mostra os próximos plantões publicados, o saldo do banco de horas (com o atalho para o próprio
// espelho), os treinamentos obrigatórios pendentes, os POPs para dar ciência e o próximo exame ocupacional e as vacinas
// pendentes (só datas e situações). Holerite e férias: só com a folha no sistema. W0-06 (6d): "Minhas solicitações"
// (férias, abono, ajuste de ponto, correção do nome e atestado, com desistência enquanto aguarda o gestor).
import { SITUACOES_TREINAMENTO, TIPOS_PLANTAO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MinhasSolicitacoes from '../autoatendimento/MinhasSolicitacoes.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr } from '../comum.js';
import { darCiencia, lerMeuEspaco } from './api-f6.js';

const { t } = useI18n();
const cliente = useQueryClient();
const vinculo = ref<number | null>(null);
const meu = useQuery({
  queryKey: computed(() => ['f6', 'meu', vinculo.value]),
  queryFn: () => lerMeuEspaco(vinculo.value ?? undefined),
});
const m = computed(() => meu.data.value ?? null);
const opcoesVinculo = computed(() =>
  m.value?.colaborador
    ? [
        { valor: m.value.colaborador.vinculo as number | null, rotulo: m.value.colaborador.cargo },
        ...m.value.outrosVinculos.map((v) => ({ valor: v.vinculo as number | null, rotulo: v.rotulo })),
      ]
    : [],
);
const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
async function ciencia(pop: number): Promise<void> {
  erro.value = null;
  try {
    aviso.value = (await darCiencia(pop, m.value?.colaborador?.vinculo ?? null)).mensagem;
    await cliente.invalidateQueries({ queryKey: ['f6', 'meu'] });
  } catch (x) {
    erro.value = x;
  }
}
const hora = (i: string) => i.slice(11, 16);
const saldo = (min: number) => {
  const s = min < 0 ? '−' : '+';
  const a = Math.abs(min);
  return `${s}${Math.floor(a / 60)} h ${String(a % 60).padStart(2, '0')} min`;
};
</script>

<template>
  <section class="meu" aria-labelledby="meu-titulo" data-testid="tela-meu-espaco">
    <h1 id="meu-titulo">{{ t('f6.meu.titulo') }}</h1>
    <p>{{ t('f6.meu.subtitulo') }}</p>
    <ErroPessoas v-if="meu.isError.value" :erro="meu.error.value" />
    <p v-else-if="!m" role="status">{{ t('f6.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!m.liberado.ligada"
        :texto="m.liberado.motivo ?? ''"
        variante="info"
        data-testid="meu-desligado"
      />
      <SanteAlerta
        v-else-if="!m.colaborador"
        :texto="t('f6.meu.semVinculo')"
        variante="info"
        data-testid="meu-sem-vinculo"
      />
      <template v-else>
        <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="meu-aviso" />
        <ErroPessoas v-if="erro" :erro="erro" />
        <article class="cartao" aria-labelledby="meu-vinculo" data-testid="meu-vinculo">
          <h2 id="meu-vinculo">{{ m.colaborador.nome }}</h2>
          <p>
            {{ m.colaborador.funcao ?? m.colaborador.cargo
            }}<template v-if="m.colaborador.unidadeNome"> · {{ m.colaborador.unidadeNome }}</template>
          </p>
          <p class="secundario">
            <template v-if="m.colaborador.matricula">{{ m.colaborador.matricula }} · </template>
            {{ t('f6.meu.admissao', { d: dataBr(m.colaborador.admissao) }) }}
            <template v-if="m.colaborador.desligamento">
              · {{ t('f6.meu.desligado', { d: dataBr(m.colaborador.desligamento) }) }}</template
            >
          </p>
          <SanteSelecao
            v-if="opcoesVinculo.length > 1"
            :model-value="m.colaborador.vinculo"
            :rotulo="t('f6.meu.vinculo')"
            :opcoes="opcoesVinculo"
            data-testid="meu-outro-vinculo"
            @update:model-value="(v: number | null) => (vinculo = v)"
          />
        </article>

        <MinhasSolicitacoes :vinculo="m.colaborador.vinculo" :nome-atual="m.colaborador.nome" />

        <article class="cartao" aria-labelledby="meu-plantoes" data-testid="meu-plantoes">
          <h2 id="meu-plantoes">{{ t('f6.meu.plantoes') }}</h2>
          <p
            v-if="m.indisponiveis.includes('plantoes')"
            role="status"
            data-testid="meu-plantoes-indisponivel"
          >
            {{ t('f6.meu.indisponivel') }}
          </p>
          <p v-else-if="m.plantoes.length === 0">{{ t('f6.meu.semPlantoes') }}</p>
          <ul v-else class="lista">
            <li v-for="p in m.plantoes" :key="p.id" :data-testid="`meu-plantao-${p.id}`">
              <strong>{{ dataBr(p.inicio) }}</strong>
              {{ t('f6.faixa', { inicio: hora(p.inicio), fim: hora(p.fim) }) }} ·
              {{ TIPOS_PLANTAO[p.tipo as keyof typeof TIPOS_PLANTAO] ?? p.tipo }}
              <span v-if="p.unidadeNome" class="secundario">· {{ p.unidadeNome }}</span>
              <div v-if="p.chegadaMin !== null" class="secundario">
                {{ t('f6.meu.chegada', { m: p.chegadaMin }) }}
              </div>
            </li>
          </ul>
          <RouterLink to="/pessoas/escala/trocas" class="atalho">{{ t('f6.meu.trocas') }}</RouterLink>
        </article>

        <article class="cartao" aria-labelledby="meu-ponto" data-testid="meu-ponto">
          <h2 id="meu-ponto">{{ t('f6.meu.ponto') }}</h2>
          <p v-if="m.indisponiveis.includes('ponto')" role="status" data-testid="meu-ponto-indisponivel">
            {{ t('f6.meu.indisponivel') }}
          </p>
          <p v-else>
            {{
              m.ponto.saldoBancoMin !== null
                ? t('f6.meu.saldo', { s: saldo(m.ponto.saldoBancoMin) })
                : t('f6.meu.semSaldo')
            }}
          </p>
          <RouterLink to="/pessoas/ponto/meu" class="atalho">{{ t('f6.meu.espelho') }}</RouterLink>
        </article>

        <article class="cartao" aria-labelledby="meu-treino" data-testid="meu-treinamentos">
          <h2 id="meu-treino">{{ t('f6.meu.treinamentos') }}</h2>
          <p v-if="m.treinamentos.length === 0">{{ t('f6.meu.semTreinamentos') }}</p>
          <ul v-else class="lista">
            <li v-for="c in m.treinamentos" :key="c.curso">
              {{ c.titulo }} — <strong>{{ SITUACOES_TREINAMENTO[c.situacao] }}</strong>
              <span v-if="c.validoAte" class="secundario">({{ dataBr(c.validoAte) }})</span>
            </li>
          </ul>
        </article>

        <article class="cartao" aria-labelledby="meu-pops" data-testid="meu-pops">
          <h2 id="meu-pops">{{ t('f6.meu.pops') }}</h2>
          <p v-if="m.pops.length === 0">{{ t('f6.meu.semPops') }}</p>
          <div v-for="p in m.pops" :key="p.id" class="pop" :data-testid="`meu-pop-${p.codigo}`">
            <h3>
              {{ p.codigo }} · {{ p.titulo }}
              <span class="secundario">{{ t('f6.versao', { v: p.versao }) }} · {{ dataBr(p.vigencia) }}</span>
            </h3>
            <p>{{ p.resumo }}</p>
            <p v-if="p.alteracoes" class="secundario">{{ t('f6.meu.alteracoes', { t: p.alteracoes }) }}</p>
            <p v-if="p.referencia" class="secundario">{{ t('f6.meu.referencia', { t: p.referencia }) }}</p>
            <SanteBotao
              :rotulo="t('f6.meu.lerPop')"
              :data-testid="`ciencia-${p.codigo}`"
              @acionar="ciencia(p.id)"
            />
          </div>
        </article>

        <article class="cartao" aria-labelledby="meu-saude" data-testid="meu-saude">
          <h2 id="meu-saude">{{ t('f6.meu.saude') }}</h2>
          <p v-if="m.indisponiveis.includes('saude')" role="status" data-testid="meu-saude-indisponivel">
            {{ t('f6.meu.indisponivel') }}
          </p>
          <template v-else>
            <p>
              {{
                m.saude.asoVencido || !m.saude.proximoAso
                  ? t('f6.meu.asoPendente')
                  : t('f6.meu.proximoAso', { d: dataBr(m.saude.proximoAso) })
              }}
            </p>
            <p>
              {{
                m.saude.vacinasPendentes.length
                  ? t('f6.meu.vacinas', { v: m.saude.vacinasPendentes.join(', ') })
                  : t('f6.meu.semVacinas')
              }}
            </p>
          </template>
        </article>
      </template>
      <article class="cartao" aria-labelledby="meu-folha" data-testid="meu-folha">
        <h2 id="meu-folha">{{ t('f6.meu.folha') }}</h2>
        <p>{{ m.folha.mensagem }}</p>
        <RouterLink
          v-if="m.folha.disponivel"
          :to="
            m.colaborador ? `/pessoas/meu/holerite?vinculo=${m.colaborador.vinculo}` : '/pessoas/meu/holerite'
          "
          class="atalho"
          data-testid="meu-holerite"
          >{{ t('folha.calculo.holerite.abrir') }}</RouterLink
        >
        <RouterLink
          v-if="m.folha.disponivel"
          :to="m.colaborador ? `/pessoas/meu/ferias?vinculo=${m.colaborador.vinculo}` : '/pessoas/meu/ferias'"
          class="atalho"
          data-testid="meu-ferias"
          >{{ t('folha.ferias.meu.abrir') }}</RouterLink
        >
      </article>
    </template>
  </section>
</template>

<style scoped>
.meu {
  display: grid;
  gap: 0.75rem;
  max-width: 40rem;
  margin: 0 auto;
}
.cartao {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.5rem;
}
.cartao h2 {
  font-size: 1.1rem;
  margin: 0;
}
.lista {
  margin: 0;
  padding-left: 1rem;
  display: grid;
  gap: 0.35rem;
}
.pop {
  display: grid;
  gap: 0.35rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--p-content-border-color);
}
.pop h3 {
  font-size: 1rem;
  margin: 0;
}
.atalho {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
}
.secundario {
  color: var(--p-text-muted-color);
}
</style>
