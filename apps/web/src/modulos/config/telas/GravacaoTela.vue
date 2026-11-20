<script setup lang="ts">
// Tela "Conferência de gravação (triggers, generators, sentinelas)" (M04): por operação, a receita (tabelas,
// colunas e classes), os triggers que disparam e o que fazem (conferidos no banco de cada estabelecimento), o
// que o novo não faz, o estado por estabelecimento e as provas pós-escrita (só contagens). Só leitura
// (config.gravacao.ler). Revisão do M35: com mais de 500 operações no catálogo, a tela ganhou o filtro pelo nome ou
// pelo módulo da operação (também o primeiro ponto de foco da área rolável, critério do axe).
import type { PainelGravacao, PainelHomologacao } from '@sgh/contratos';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarPainelGravacao, buscarPainelHomologacao } from '../api.js';
import TriggersVistos from '../componentes/TriggersVistos.vue';

const { t } = useI18n();
const dados = ref<PainelGravacao | null>(null);
const erro = ref<string | null>(null);
const filtro = ref('');
// M36: triggers vistos no rastreamento dos cenários controlados × catálogo (painel da homologação).
const homologacao = ref<PainelHomologacao | null>(null);
const operacoes = computed(() => {
  const f = filtro.value.trim().toLowerCase();
  const todas = dados.value?.operacoes ?? [];
  return f ? todas.filter((o) => o.nome.toLowerCase().includes(f)) : todas;
});

onMounted(async () => {
  try {
    dados.value = await buscarPainelGravacao();
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  }
  if (!pode('config.coexistencia.ler')) return;
  try {
    homologacao.value = await buscarPainelHomologacao();
  } catch {
    homologacao.value = null; // o painel da homologação é complementar: a tela segue sem ele
  }
});
</script>

<template>
  <section aria-labelledby="titulo-gravacao">
    <h1 id="titulo-gravacao">{{ t('config.gravacao.titulo') }}</h1>
    <p>{{ t('config.gravacao.texto') }}</p>
    <p v-if="erro" role="alert">{{ t('config.gravacao.erro', { erro }) }}</p>
    <p v-if="dados?.limitacao">{{ dados.limitacao }}</p>
    <form v-if="dados" class="filtro" :aria-label="t('config.gravacao.filtro')" @submit.prevent>
      <label>
        {{ t('config.gravacao.filtro') }}
        <input v-model="filtro" type="search" data-testid="filtro-gravacao" />
      </label>
      <span role="status">{{ t('config.gravacao.contagem', { n: operacoes.length }) }}</span>
    </form>
    <TriggersVistos v-if="homologacao" :painel="homologacao" :filtro="filtro" />
    <article v-for="o in operacoes" :key="o.nome" :data-testid="`operacao-${o.nome}`">
      <h2>{{ o.nome }}</h2>
      <p>{{ o.descricao }}</p>
      <p>
        {{ t('config.gravacao.estados') }}:
        <span v-for="e in dados?.estabelecimentos ?? []" :key="e"
          >{{ t('config.gravacao.estadoEm', { estabelecimento: e, estado: o.estados[e] }) }}
        </span>
      </p>
      <p v-if="!o.receita">{{ t('config.gravacao.semReceita') }}</p>
      <template v-else>
        <table v-for="p in o.receita.passos" :key="p.ordem">
          <caption>
            {{
              t('config.gravacao.receita')
            }}:
            {{
              p.ordem
            }}.
            {{
              p.tabela
            }}
            ({{
              p.acao
            }})
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('config.gravacao.coluna') }}</th>
              <th scope="col">{{ t('config.gravacao.classe') }}</th>
              <th scope="col">{{ t('config.gravacao.origem') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in p.colunas" :key="c.coluna">
              <td>{{ c.coluna }}</td>
              <td>{{ c.classe }}</td>
              <td>{{ c.origem }}</td>
            </tr>
          </tbody>
        </table>
        <h3>{{ t('config.gravacao.naoFaz') }}</h3>
        <ul>
          <li v-for="n in o.receita.naoFaz" :key="n">{{ n }}</li>
        </ul>
        <dl>
          <dt>{{ t('config.gravacao.condicao') }}</dt>
          <dd>{{ o.receita.condicao }}</dd>
          <dt>{{ t('config.gravacao.concorrencia') }}</dt>
          <dd>{{ o.receita.concorrencia }}</dd>
          <dt>{{ t('config.gravacao.prova') }}</dt>
          <dd>{{ o.receita.prova }}</dd>
          <dt>{{ t('config.gravacao.provas') }}</dt>
          <dd>
            <span v-for="(p, e) in o.provas" :key="e"
              >{{
                t('config.gravacao.provaEm', {
                  estabelecimento: e,
                  sucesso: p.sucesso,
                  desfeitas: p.desfeitas,
                })
              }}
            </span>
          </dd>
        </dl>
      </template>
      <table>
        <caption>
          {{
            t('config.gravacao.triggers')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('config.gravacao.trigger') }}</th>
            <th scope="col">{{ t('config.gravacao.tabela') }}</th>
            <th scope="col">{{ t('config.gravacao.faz') }}</th>
            <th v-for="e in Object.keys(o.triggersNoBanco)" :key="e" scope="col">
              {{ t('config.gravacao.noBanco') }} {{ e }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tr in o.triggers" :key="tr.nome">
            <td>{{ tr.nome }}</td>
            <td>{{ tr.tabela }}</td>
            <td>{{ tr.efeito }}</td>
            <td v-for="(m, e) in o.triggersNoBanco" :key="e">
              {{ t(`config.gravacao.${m[tr.nome] ?? 'ausente'}`) }}
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  </section>
</template>

<style scoped>
.filtro {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 1rem;
  margin-block: 1rem;
}
.filtro label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
</style>
