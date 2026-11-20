<script setup lang="ts">
// Migração gradual: o ensaio da conversão do texto do banco para UTF-8 na cópia já em versão 5 (M58, etapa 3; ficha,
// seções 5, 7, 8 e 11). No estabelecimento ativo: as 16 etapas reavaliadas pelo servidor (a situação escrita no
// relatório só vale se os números a sustentam), o que falta em cada uma, a janela estimada, a página do banco
// convertido com os índices que pedem página maior, a dependência do ensaio da versão 5 e o que o registro dos passos
// diz do ensaio. Só leitura: o ensaio roda fora daqui, numa cópia isolada.
import type { EtapaEnsaioUtf8Avaliada, ResumoEnsaioUtf8 } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { lerEnsaioUtf8 } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';
import { chaveAchadoUtf8 } from '../i18n-ensaio-utf8.js';

const { t } = useI18n();
const consulta = useQuery({
  queryKey: ['coexistencia', 'desligamento', 'ensaio-utf8'],
  queryFn: lerEnsaioUtf8,
});
const resumo = computed<ResumoEnsaioUtf8 | undefined>(() => consulta.data.value);
const podeVerDesligamento = computed(() => pode('config.coexistencia.ler'));
const dia = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const instante = (d: string) => new Date(d).toLocaleString('pt-BR');
const aprovadas = computed(() => resumo.value?.etapas.filter((e) => e.situacao === 'aprovada').length ?? 0);

function textoAchado(a: string): string {
  const { codigo, nome } = chaveAchadoUtf8(a);
  return t(`ensaioUtf8.achados.${codigo}`, { nome });
}

const varianteSituacao = (e: EtapaEnsaioUtf8Avaliada) =>
  e.situacao === 'aprovada' ? 'ok' : e.situacao === 'reprovada' ? 'falha' : 'neutra';
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-ensaio-utf8" data-testid="tela-ensaio-utf8">
    <h1 id="titulo-ensaio-utf8">{{ t('ensaioUtf8.titulo') }}</h1>
    <AbasMigracao atual="ensaioUtf8" />
    <p>{{ t('ensaioUtf8.descricao') }}</p>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!resumo" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <p data-testid="ensaio-em">{{ t('ensaioUtf8.atualizadoEm', { em: instante(resumo.em) }) }}</p>
      <SanteAlerta
        v-if="resumo.relatorioInvalido"
        :texto="t('ensaioUtf8.naoEnsaiado', { motivo: resumo.relatorioInvalido })"
        variante="aviso"
        data-testid="ensaio-invalido"
      />
      <SanteAlerta
        :texto="
          resumo.aprovavel
            ? t('ensaioUtf8.aprovavel')
            : t('ensaioUtf8.naoAprovavel', { aprovadas, total: resumo.etapas.length })
        "
        :variante="resumo.aprovavel ? 'info' : 'aviso'"
        data-testid="ensaio-aprovavel"
      />

      <dl class="dados-ensaio">
        <dt>{{ t('ensaioUtf8.relatorio') }}</dt>
        <dd>
          <code>{{ resumo.relatorio }}</code>
          <template v-if="resumo.ensaiadoEm">
            · {{ t('ensaioUtf8.ensaiadoEm', { dia: dia(resumo.ensaiadoEm) }) }}</template
          >
        </dd>
        <dt>{{ t('ensaioUtf8.firebird5') }}</dt>
        <dd data-testid="ensaio-firebird5">
          {{
            resumo.firebird5Aprovado ? t('ensaioUtf8.firebird5Aprovado') : t('ensaioUtf8.firebird5Pendente')
          }}
        </dd>
        <dt>{{ t('ensaioUtf8.origem') }}</dt>
        <dd data-testid="ensaio-origem">{{ resumo.origem ?? '—' }}</dd>
        <dt>{{ t('ensaioUtf8.alvo') }}</dt>
        <dd data-testid="ensaio-alvo">{{ resumo.alvo ?? '—' }}</dd>
        <dt>{{ t('ensaioUtf8.pagina') }}</dt>
        <dd data-testid="ensaio-pagina">
          {{
            resumo.paginaAlvo
              ? t('ensaioUtf8.paginaBytes', { n: resumo.paginaAlvo })
              : t('ensaioUtf8.semPagina')
          }}
        </dd>
        <dt>{{ t('ensaioUtf8.janela') }}</dt>
        <dd data-testid="ensaio-janela">
          {{
            resumo.janelaMinutos
              ? t('ensaioUtf8.janelaMinutos', { n: resumo.janelaMinutos })
              : t('ensaioUtf8.semJanela')
          }}
        </dd>
        <dt>{{ t('ensaioUtf8.registro') }}</dt>
        <dd data-testid="ensaio-registro">
          {{
            resumo.registro
              ? t('ensaioUtf8.registrado', {
                  dia: dia(resumo.registro.data),
                  resultado: t(`ensaioUtf8.resultados.${resumo.registro.resultado}`),
                })
              : t('ensaioUtf8.semRegistro')
          }}
        </dd>
      </dl>

      <!-- As etapas -->
      <div class="rolagem">
        <table class="tabela" data-testid="ensaio-etapas">
          <caption>
            {{
              t('ensaioUtf8.resumoCartao', { aprovadas, total: resumo.etapas.length })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('ensaioUtf8.colunas.etapa') }}</th>
              <th scope="col">{{ t('ensaioUtf8.colunas.situacao') }}</th>
              <th scope="col">{{ t('ensaioUtf8.colunas.achados') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in resumo.etapas" :key="e.etapa" :data-testid="`etapa-${e.etapa}`">
              <th scope="row">
                {{ t(`ensaioUtf8.etapas.${e.etapa}.titulo`) }}
                <small>{{ t(`ensaioUtf8.etapas.${e.etapa}.descricao`) }}</small>
              </th>
              <td :class="`situacao-${varianteSituacao(e)}`" :data-testid="`situacao-${e.etapa}`">
                {{ t(`ensaioUtf8.situacoes.${e.situacao}`) }}
              </td>
              <td>
                <p v-if="e.bloqueio">{{ t(`ensaioUtf8.bloqueios.${e.bloqueio}`) }}</p>
                <ul v-if="e.achados.length">
                  <li v-for="a in e.achados" :key="a">{{ textoAchado(a) }}</li>
                </ul>
                <template v-else-if="!e.bloqueio">{{ t('ensaioUtf8.semAchados') }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Os índices que pedem página maior -->
      <section aria-labelledby="ensaio-indices" data-testid="ensaio-indices">
        <h2 id="ensaio-indices">{{ t('ensaioUtf8.indices') }}</h2>
        <p v-if="!resumo.indicesEstourados.length">{{ t('ensaioUtf8.semIndices') }}</p>
        <div v-else class="rolagem">
          <table class="tabela">
            <caption>
              {{
                t('ensaioUtf8.indices')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('ensaioUtf8.indicesColunas.nome') }}</th>
                <th scope="col">{{ t('ensaioUtf8.indicesColunas.tabela') }}</th>
                <th scope="col">{{ t('ensaioUtf8.indicesColunas.chave') }}</th>
                <th scope="col">{{ t('ensaioUtf8.indicesColunas.pagina') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in resumo.indicesEstourados" :key="i.nome" :data-testid="`indice-${i.nome}`">
                <th scope="row">
                  <code>{{ i.nome }}</code>
                </th>
                <td>
                  <code>{{ i.tabela }}</code>
                </td>
                <td>{{ t('ensaioUtf8.chaveBytes', { n: i.chaveBytes }) }}</td>
                <td>
                  {{
                    i.paginaMinima
                      ? t('ensaioUtf8.paginaBytes', { n: i.paginaMinima })
                      : t('ensaioUtf8.nenhumaPagina')
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <p>
        <RouterLink
          to="/administracao/coexistencia/desligamento/ensaio-firebird5"
          data-testid="ir-ensaio-firebird5"
          >{{ t('ensaioFirebird5.verTela') }}</RouterLink
        >
        <template v-if="podeVerDesligamento">
          ·
          <RouterLink to="/administracao/coexistencia/desligamento" data-testid="ir-desligamento">{{
            t('coexistencia.abas.desligamento')
          }}</RouterLink>
        </template>
      </p>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.rolagem {
  overflow-x: auto;
}
.dados-ensaio {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.dados-ensaio dd {
  margin: 0;
}
small {
  display: block;
}
.situacao-ok {
  font-weight: 700;
}
.situacao-falha {
  font-weight: 700;
  text-decoration: underline;
}
ul {
  margin: 0;
  padding-left: var(--sgh-espaco-3);
}
</style>
