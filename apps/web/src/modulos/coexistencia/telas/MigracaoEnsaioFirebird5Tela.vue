<script setup lang="ts">
// Migração gradual: o ensaio da versão 5 do motor do banco na cópia (M58, etapa 2; ficha, seções 2, 5, 10 e 11). No
// estabelecimento ativo: as 13 etapas reavaliadas pelo servidor (a situação escrita no relatório só vale se os números
// a sustentam), o que falta em cada uma, a janela estimada, as funções externas com a resolução que o ensaio sustenta e
// o que o registro dos passos diz do ensaio. Só leitura: o ensaio roda fora daqui, numa cópia isolada.
import type { EtapaEnsaioAvaliada, ResumoEnsaioFirebird5 } from '@sgh/contratos';
import { SanteAlerta } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { lerEnsaioFirebird5 } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';
import { chaveAchado } from '../i18n-ensaio-firebird5.js';

const { t } = useI18n();
const consulta = useQuery({
  queryKey: ['coexistencia', 'desligamento', 'ensaio-firebird5'],
  queryFn: lerEnsaioFirebird5,
});
const resumo = computed<ResumoEnsaioFirebird5 | undefined>(() => consulta.data.value);
const podeVerDesligamento = computed(() => pode('config.coexistencia.ler'));
const dia = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const instante = (d: string) => new Date(d).toLocaleString('pt-BR');
const aprovadas = computed(() => resumo.value?.etapas.filter((e) => e.situacao === 'aprovada').length ?? 0);

function textoAchado(a: string): string {
  const { codigo, nome } = chaveAchado(a);
  return t(`ensaioFirebird5.achados.${codigo}`, { nome });
}

function textoChamada(ok: boolean | null): string {
  if (ok === null) return t('ensaioFirebird5.naoChamada');
  return ok ? t('ensaioFirebird5.respondeu') : t('ensaioFirebird5.naoRespondeu');
}

const varianteSituacao = (e: EtapaEnsaioAvaliada) =>
  e.situacao === 'aprovada' ? 'ok' : e.situacao === 'reprovada' ? 'falha' : 'neutra';
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-ensaio-fb5" data-testid="tela-ensaio-firebird5">
    <h1 id="titulo-ensaio-fb5">{{ t('ensaioFirebird5.titulo') }}</h1>
    <AbasMigracao atual="ensaioFirebird5" />
    <p>{{ t('ensaioFirebird5.descricao') }}</p>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!resumo" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <p data-testid="ensaio-em">{{ t('ensaioFirebird5.atualizadoEm', { em: instante(resumo.em) }) }}</p>
      <SanteAlerta
        v-if="resumo.relatorioInvalido"
        :texto="t('ensaioFirebird5.naoEnsaiado', { motivo: resumo.relatorioInvalido })"
        variante="aviso"
        data-testid="ensaio-invalido"
      />
      <SanteAlerta
        :texto="
          resumo.aprovavel
            ? t('ensaioFirebird5.aprovavel')
            : t('ensaioFirebird5.naoAprovavel', { aprovadas, total: resumo.etapas.length })
        "
        :variante="resumo.aprovavel ? 'info' : 'aviso'"
        data-testid="ensaio-aprovavel"
      />

      <dl class="dados-ensaio">
        <dt>{{ t('ensaioFirebird5.relatorio') }}</dt>
        <dd>
          <code>{{ resumo.relatorio }}</code>
          <template v-if="resumo.ensaiadoEm">
            · {{ t('ensaioFirebird5.ensaiadoEm', { dia: dia(resumo.ensaiadoEm) }) }}</template
          >
        </dd>
        <dt>{{ t('ensaioFirebird5.origem') }}</dt>
        <dd data-testid="ensaio-origem">{{ resumo.origem ?? '—' }}</dd>
        <dt>{{ t('ensaioFirebird5.alvo') }}</dt>
        <dd data-testid="ensaio-alvo">{{ resumo.alvo ?? '—' }}</dd>
        <dt>{{ t('ensaioFirebird5.janela') }}</dt>
        <dd data-testid="ensaio-janela">
          {{
            resumo.janelaMinutos
              ? t('ensaioFirebird5.janelaMinutos', { n: resumo.janelaMinutos })
              : t('ensaioFirebird5.semJanela')
          }}
        </dd>
        <dt>{{ t('ensaioFirebird5.registro') }}</dt>
        <dd data-testid="ensaio-registro">
          {{
            resumo.registro
              ? t('ensaioFirebird5.registrado', {
                  dia: dia(resumo.registro.data),
                  resultado: t(`ensaioFirebird5.resultados.${resumo.registro.resultado}`),
                })
              : t('ensaioFirebird5.semRegistro')
          }}
        </dd>
      </dl>

      <!-- As etapas -->
      <div class="rolagem">
        <table class="tabela" data-testid="ensaio-etapas">
          <caption>
            {{
              t('ensaioFirebird5.resumoCartao', { aprovadas, total: resumo.etapas.length })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('ensaioFirebird5.colunas.etapa') }}</th>
              <th scope="col">{{ t('ensaioFirebird5.colunas.situacao') }}</th>
              <th scope="col">{{ t('ensaioFirebird5.colunas.achados') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in resumo.etapas" :key="e.etapa" :data-testid="`etapa-${e.etapa}`">
              <th scope="row">
                {{ t(`ensaioFirebird5.etapas.${e.etapa}.titulo`) }}
                <small>{{ t(`ensaioFirebird5.etapas.${e.etapa}.descricao`) }}</small>
              </th>
              <td :class="`situacao-${varianteSituacao(e)}`" :data-testid="`situacao-${e.etapa}`">
                {{ t(`ensaioFirebird5.situacoes.${e.situacao}`) }}
              </td>
              <td>
                <p v-if="e.bloqueio">{{ t(`ensaioFirebird5.bloqueios.${e.bloqueio}`) }}</p>
                <ul v-if="e.achados.length">
                  <li v-for="a in e.achados" :key="a">{{ textoAchado(a) }}</li>
                </ul>
                <template v-else-if="!e.bloqueio">{{ t('ensaioFirebird5.semAchados') }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- As funções externas -->
      <section aria-labelledby="ensaio-funcoes" data-testid="ensaio-funcoes">
        <h2 id="ensaio-funcoes">{{ t('ensaioFirebird5.funcoes') }}</h2>
        <p v-if="!resumo.funcoes.length">{{ t('ensaioFirebird5.semFuncoes') }}</p>
        <div v-else class="rolagem">
          <table class="tabela">
            <caption>
              {{
                t('ensaioFirebird5.funcoes')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('ensaioFirebird5.funcoesColunas.nome') }}</th>
                <th scope="col">{{ t('ensaioFirebird5.funcoesColunas.biblioteca') }}</th>
                <th scope="col">{{ t('ensaioFirebird5.funcoesColunas.chamada') }}</th>
                <th scope="col">{{ t('ensaioFirebird5.funcoesColunas.dependentes') }}</th>
                <th scope="col">{{ t('ensaioFirebird5.funcoesColunas.resolucao') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in resumo.funcoes" :key="f.nome" :data-testid="`funcao-${f.nome}`">
                <th scope="row">
                  <code>{{ f.nome }}</code>
                </th>
                <td>
                  <code>{{ f.modulo }}</code>
                  ({{ f.bibliotecaPresente ? t('ensaioFirebird5.presente') : t('ensaioFirebird5.ausente') }})
                </td>
                <td>{{ textoChamada(f.chamadaOk) }}</td>
                <td>
                  {{
                    t('ensaioFirebird5.dependentesLinha', {
                      validos: f.dependentesValidos,
                      total: f.dependentes,
                    })
                  }}
                </td>
                <td :data-testid="`resolucao-${f.nome}`">
                  {{ t(`ensaioFirebird5.resolucoes.${f.resolucaoProposta}`) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <p v-if="podeVerDesligamento">
        <RouterLink to="/administracao/coexistencia/desligamento" data-testid="ir-desligamento">{{
          t('coexistencia.abas.desligamento')
        }}</RouterLink>
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
