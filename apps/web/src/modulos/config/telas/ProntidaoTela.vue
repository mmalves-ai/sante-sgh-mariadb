<script setup lang="ts">
// Tela "Prontidão por setor" (M35, ficha seção 7; aba da tela "Testes de assinatura de dados"): o relatório de
// prontidão por setor e hospital gerado na consolidação da semana — o veredito de cada setor por onda, a lista do que
// libera um setor (o que já se sabe e o que é da Fase 4), as operações fora de `verde` com o motivo, a proposta das
// ondas 0 e 1 para o comitê, o público por papel e a carga somada. Cada estabelecimento separado; sem a cópia, o
// bloqueio. Só leitura (config.coexistencia.ler): nenhuma chave é ligada aqui.
import type { RelatorioProntidao } from '@sgh/contratos';
import { SanteAlerta, SanteSelecao } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { buscarProntidao, contagemExibida, setoresPorOnda } from '../api.js';
import AbasAssinaturas from '../componentes/AbasAssinaturas.vue';

const { t } = useI18n();
const dados = ref<RelatorioProntidao | null>(null);
const carregado = ref(false);
const erro = ref<string | null>(null);
const hospital = ref('');

const hospitais = computed(() => dados.value?.hospitais ?? []);
const atual = computed(
  () => hospitais.value.find((h) => h.codigo === hospital.value) ?? hospitais.value[0] ?? null,
);
const opcoesHospital = computed(() =>
  hospitais.value.map((h) => ({ valor: h.codigo, rotulo: `${h.nome} (${h.codigo})` })),
);
const nomeSetor = (id: string) => atual.value?.setores.find((s) => s.id === id)?.nome ?? id;
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

onMounted(async () => {
  try {
    dados.value = await buscarProntidao();
    hospital.value = dados.value?.hospitais[0]?.codigo ?? '';
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e);
  } finally {
    carregado.value = true;
  }
});
</script>

<template>
  <section aria-labelledby="titulo-prontidao" data-testid="tela-prontidao">
    <h1 id="titulo-prontidao">{{ t('config.prontidao.titulo') }}</h1>
    <AbasAssinaturas atual="prontidao" />
    <p>{{ t('config.prontidao.texto') }}</p>
    <p v-if="erro" role="alert">{{ t('config.prontidao.erro', { erro }) }}</p>
    <p v-else-if="carregado && !dados" data-testid="prontidao-vazia">
      <SanteAlerta variante="aviso" :texto="t('config.prontidao.semRelatorio')" />
    </p>
    <template v-if="dados && atual">
      <p data-testid="prontidao-gerado">
        {{
          t('config.prontidao.gerado', {
            data: dataHora(dados.geradoEm),
            liberadas: dados.liberadas,
          })
        }}
      </p>
      <form class="filtros" :aria-label="t('config.prontidao.filtros')" @submit.prevent>
        <SanteSelecao
          id="prontidao-hospital"
          v-model="hospital"
          :rotulo="t('config.prontidao.estabelecimento')"
          :opcoes="opcoesHospital"
          data-testid="filtro-hospital"
        />
      </form>

      <p v-if="atual.bloqueio" data-testid="prontidao-bloqueio">
        <SanteAlerta variante="aviso" :texto="t('config.prontidao.bloqueio', { motivo: atual.bloqueio })" />
      </p>

      <section aria-labelledby="titulo-proposta" data-testid="prontidao-proposta">
        <h2 id="titulo-proposta">{{ t('config.prontidao.proposta') }}</h2>
        <ul>
          <li data-testid="proposta-onda0">
            <strong>{{ t('config.prontidao.onda0') }}</strong>
            {{
              atual.proposta.onda0.length
                ? atual.proposta.onda0.map(nomeSetor).join('; ')
                : t('config.prontidao.nenhum')
            }}
          </li>
          <li data-testid="proposta-onda1">
            <strong>{{ t('config.prontidao.onda1') }}</strong>
            {{
              atual.proposta.onda1.length
                ? atual.proposta.onda1.map(nomeSetor).join('; ')
                : t('config.prontidao.nenhum')
            }}
          </li>
          <li v-for="f in atual.proposta.foraDaProposta" :key="f.setor">
            {{ t('config.prontidao.fora', { setor: nomeSetor(f.setor), motivo: f.motivo }) }}
          </li>
        </ul>
        <p data-testid="prontidao-chaves">
          {{
            t('config.prontidao.chaves', {
              preparadas: atual.chavesPreparadas ?? '—',
              ligadas: atual.chavesLigadas ?? '—',
            })
          }}
        </p>
      </section>

      <section
        v-for="g in setoresPorOnda(atual)"
        :key="g.onda"
        :aria-labelledby="`titulo-onda-${g.onda}`"
        :data-testid="`onda-${g.onda}`"
      >
        <h2 :id="`titulo-onda-${g.onda}`">{{ t(`config.prontidao.ondas.${g.onda}`) }}</h2>
        <article
          v-for="s in g.setores"
          :key="s.id"
          class="setor"
          :aria-labelledby="`setor-${s.id}`"
          :data-testid="`setor-${s.id}`"
        >
          <h3 :id="`setor-${s.id}`">
            {{ s.nome }}
            <span class="veredito" :data-veredito="s.veredito" data-testid="veredito">{{
              t(`config.prontidao.vereditos.${s.veredito}`)
            }}</span>
          </h3>
          <p>
            {{
              t('config.prontidao.resumoOperacoes', {
                verdes: s.operacoes.verdes,
                total: s.operacoes.total,
                marcos: s.marcos.map((m) => `${m.marco} (${m.status})`).join(', '),
              })
            }}
          </p>
          <table :data-testid="`itens-${s.id}`">
            <caption>
              {{
                t('config.prontidao.lista')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('config.prontidao.item') }}</th>
                <th scope="col">{{ t('config.prontidao.situacao') }}</th>
                <th scope="col">{{ t('config.prontidao.detalhe') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in s.itens" :key="i.item">
                <th scope="row">{{ t(`config.prontidao.itens.${i.item}`) }}</th>
                <td :data-situacao="i.situacao">{{ t(`config.prontidao.situacoes.${i.situacao}`) }}</td>
                <td>{{ i.detalhe }}</td>
              </tr>
            </tbody>
          </table>
          <details v-if="s.operacoes.fora.length && !atual.bloqueio" :data-testid="`fora-${s.id}`">
            <summary>{{ t('config.prontidao.foraDeVerde', { n: s.operacoes.fora.length }) }}</summary>
            <table>
              <caption>
                {{
                  t('config.prontidao.foraLegenda')
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{{ t('config.prontidao.operacao') }}</th>
                  <th scope="col">{{ t('config.prontidao.estado') }}</th>
                  <th scope="col">{{ t('config.prontidao.motivo') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in s.operacoes.fora" :key="f.nome">
                  <td>
                    <code>{{ f.nome }}</code>
                  </td>
                  <td>{{ t(`config.assinaturas.estadosOperacao.${f.estado}`) }}</td>
                  <td>{{ f.motivo }}</td>
                </tr>
              </tbody>
            </table>
          </details>
          <p v-if="s.ordemFase4.length">
            {{ t('config.prontidao.ordemFase4', { marcos: s.ordemFase4.join(' → ') }) }}
          </p>
          <p v-if="s.duvidas.length">
            {{ t('config.prontidao.duvidas', { duvidas: s.duvidas.join('; ') }) }}
          </p>
        </article>
      </section>

      <section aria-labelledby="titulo-publico" data-testid="prontidao-publico">
        <h2 id="titulo-publico">{{ t('config.prontidao.publico') }}</h2>
        <table>
          <caption>
            {{
              t('config.prontidao.publicoLegenda', { total: atual.publicoTotal ?? '—' })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('config.prontidao.papel') }}</th>
              <th scope="col">{{ t('config.prontidao.usuarios') }}</th>
              <th scope="col">{{ t('config.prontidao.referencia') }}</th>
              <th scope="col">{{ t('config.prontidao.ondasPapel') }}</th>
              <th scope="col">{{ t('config.prontidao.guias') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in atual.publico" :key="p.papel">
              <th scope="row">{{ p.nome }}</th>
              <td>{{ contagemExibida(p.usuarios, p.menorQue5) }}</td>
              <td>{{ p.referencia }}</td>
              <td>{{ p.ondas.join(', ') }}</td>
              <td>{{ p.guias }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="dados.carga" aria-labelledby="titulo-carga-prontidao" data-testid="prontidao-carga">
        <h2 id="titulo-carga-prontidao">{{ t('config.prontidao.carga') }}</h2>
        <p>
          {{
            t('config.prontidao.cargaResumo', {
              cenario: dados.carga.cenario,
              usuarios: dados.carga.usuarios,
              resultado: t(`config.prontidao.resultadosCarga.${dados.carga.resultado}`),
              data: dataHora(dados.carga.executadoEm),
            })
          }}
          <span v-if="dados.carga.indicativo">{{ t('config.prontidao.indicativo') }}</span>
        </p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.filtros {
  display: flex;
  gap: 1rem;
  margin-block: 1rem;
}
.filtros label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.setor {
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 6px);
  padding: var(--sgh-espaco-3);
  margin-block: var(--sgh-espaco-3);
}
.veredito {
  margin-inline-start: var(--sgh-espaco-2);
  font-size: var(--sgh-fonte-pequena);
  font-weight: 600;
  padding: 0 var(--sgh-espaco-2);
  border-radius: 999px;
  outline: 1px solid var(--sgh-borda);
}
</style>
