<script setup lang="ts">
// Migração gradual: a janela em produção de cada passo do desligamento (M58, etapa 5; ficha, seções 2, 5, 8 a 12).
// No estabelecimento ativo: o roteiro de cada passo (etapas em ordem, fase, papel, comando técnico e minutos pelo
// ensaio), a janela e a volta atrás estimadas, a verificação depois da janela (a da produção, que conta, e a do ensaio
// do roteiro na cópia), reavaliada pelo servidor pelos números, e a situação da restrição de entrada com o que falta
// para retirá-la. Só leitura: a execução é da TI do hospital; a retirada se faz na tela de funcionalidades.
import type { JanelaDoPasso, PainelJanela, VerificacaoJanelaAvaliada } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { lerJanela } from '../api.js';
import AbasMigracao from '../componentes/AbasMigracao.vue';

const { t } = useI18n();
const consulta = useQuery({
  queryKey: ['coexistencia', 'desligamento', 'janela'],
  queryFn: lerJanela,
});
const painel = computed<PainelJanela | undefined>(() => consulta.data.value);
const podeLiberacao = computed(() => pode('config.liberacao.ler'));
const instante = (d: string) => new Date(d).toLocaleString('pt-BR');

// O passo mostrado: o primeiro ainda não executado (ou o último), escolhível pelos botões.
const escolhido = ref<string | null>(null);
watch(
  painel,
  (p) => {
    if (!p || (escolhido.value && p.passos.some((x) => x.passo === escolhido.value))) return;
    escolhido.value = (p.passos.find((x) => !x.executado) ?? p.passos.at(-1))?.passo ?? null;
  },
  { immediate: true },
);
const passo = computed<JanelaDoPasso | undefined>(() =>
  painel.value?.passos.find((x) => x.passo === escolhido.value),
);
// O desligamento só encerra as sessões; parar o acesso ao banco é dos passos que mexem nele (D-DESLIG-F5-58).
const temParada = computed(() => passo.value?.roteiro.some((e) => e.etapa === 'parar-acesso') ?? false);

function verificacoes(p: JanelaDoPasso): Array<{ ambiente: string; v: VerificacaoJanelaAvaliada | null }> {
  return [
    { ambiente: 'producao', v: p.producao },
    { ambiente: 'ensaio', v: p.ensaio },
  ];
}

const textoNumeros = (v: VerificacaoJanelaAvaliada) =>
  t('janela.numeros', {
    iguais: v.numeros.tabelasIguais,
    tabelas: v.numeros.tabelas,
    verdes: v.numeros.operacoesVerdes,
    operacoes: v.numeros.operacoes,
    latencia:
      v.numeros.latenciaMs === null
        ? t('janela.semLatencia')
        : t('janela.latenciaMs', { n: v.numeros.latenciaMs }),
  });
const variante = (s: string) => (s === 'aprovada' ? 'ok' : s === 'reprovada' ? 'falha' : 'neutra');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-janela" data-testid="tela-janela">
    <h1 id="titulo-janela">{{ t('janela.titulo') }}</h1>
    <AbasMigracao atual="janela" />
    <p>{{ t('janela.descricao') }}</p>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!painel" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <p data-testid="janela-em">{{ t('janela.atualizadoEm', { em: instante(painel.em) }) }}</p>
      <SanteAlerta
        v-if="painel.relatorioInvalido"
        :texto="t('janela.relatorioInvalido', { motivo: painel.relatorioInvalido })"
        variante="aviso"
        data-testid="janela-relatorio-invalido"
      />
      <SanteAlerta
        v-if="painel.registroInvalido"
        :texto="t('janela.registroInvalido', { motivo: painel.registroInvalido })"
        variante="aviso"
        data-testid="janela-registro-invalido"
      />

      <!-- A restrição de entrada (regra 6; ficha, seção 12) -->
      <section aria-labelledby="janela-retirada" data-testid="janela-retirada">
        <h2 id="janela-retirada">{{ t('janela.retirada') }}</h2>
        <SanteAlerta
          :texto="t(`janela.situacoesRetirada.${painel.retirada.situacao}`)"
          :variante="painel.retirada.situacao === 'restrita' ? 'aviso' : 'info'"
          data-testid="retirada-situacao"
        />
        <dl class="dados-janela">
          <dt>{{ t('janela.chave') }}</dt>
          <dd>
            <code>{{ painel.retirada.chave }}</code>
          </dd>
          <dt>{{ t('janela.charsetBanco') }}</dt>
          <dd data-testid="retirada-banco">{{ painel.retirada.charsetBanco }}</dd>
          <dt>{{ t('janela.charsetParametro') }}</dt>
          <dd data-testid="retirada-parametro">{{ painel.retirada.charsetParametro }}</dd>
        </dl>
        <template v-if="painel.retirada.motivos.length">
          <h3>{{ t('janela.motivosTitulo') }}</h3>
          <ul data-testid="retirada-motivos">
            <li v-for="m in painel.retirada.motivos" :key="m" :data-testid="`motivo-${m}`">
              {{ t(`janela.motivos.${m}`) }}
            </li>
          </ul>
        </template>
        <p v-if="podeLiberacao && painel.retirada.situacao === 'pode-retirar'">
          <RouterLink to="/administracao/liberacao" data-testid="ir-funcionalidades">{{
            t('janela.irFuncionalidades')
          }}</RouterLink>
        </p>
      </section>

      <!-- Os passos -->
      <div class="passos" role="group" :aria-label="t('janela.roteiro')">
        <SanteBotao
          v-for="p in painel.passos"
          :key="p.passo"
          :rotulo="t(`desligamento.passos.nomes.${p.passo}`)"
          :variante="p.passo === escolhido ? 'primario' : 'secundario'"
          :data-testid="`passo-${p.passo}`"
          @acionar="escolhido = p.passo"
        />
      </div>

      <template v-if="passo">
        <dl class="dados-janela" data-testid="janela-passo">
          <dt>{{ t(`desligamento.passos.nomes.${passo.passo}`) }}</dt>
          <dd data-testid="passo-estado">
            {{ passo.autorizado ? t('janela.autorizado') : t('janela.naoAutorizado') }} ·
            {{ passo.executado ? t('janela.executado') : t('janela.naoExecutado') }} ·
            {{ passo.ensaioAprovado ? t('janela.ensaioAprovado') : t('janela.ensaioPendente') }}
          </dd>
          <dt>{{ t('janela.janela') }}</dt>
          <dd data-testid="passo-janela">
            {{
              !temParada
                ? t('janela.semParada')
                : passo.janelaMinutos
                  ? t('janela.janelaMinutos', { n: passo.janelaMinutos })
                  : t('janela.semJanela')
            }}
          </dd>
          <dt>{{ t('janela.voltaAtras') }}</dt>
          <dd data-testid="passo-volta-atras">
            {{
              passo.voltaAtrasMinutos
                ? t('janela.voltaAtrasMinutos', { n: passo.voltaAtrasMinutos })
                : t('janela.semVoltaAtras')
            }}
          </dd>
        </dl>

        <div class="rolagem">
          <table class="tabela" data-testid="janela-roteiro">
            <caption>
              {{
                t('janela.roteiro')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('janela.colunas.ordem') }}</th>
                <th scope="col">{{ t('janela.colunas.etapa') }}</th>
                <th scope="col">{{ t('janela.colunas.fase') }}</th>
                <th scope="col">{{ t('janela.colunas.responsavel') }}</th>
                <th scope="col">{{ t('janela.colunas.comando') }}</th>
                <th scope="col">{{ t('janela.colunas.minutos') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in passo.roteiro" :key="e.etapa" :data-testid="`etapa-${e.etapa}`">
                <td>{{ e.ordem }}</td>
                <th scope="row">
                  {{ t(`janela.etapas.${e.etapa}.titulo`) }}
                  <small>{{ t(`janela.etapas.${e.etapa}.descricao`) }}</small>
                  <small v-if="e.critica" class="critica">{{ t('janela.critica') }}</small>
                </th>
                <td>{{ t(`janela.fases.${e.fase}`) }}</td>
                <td>{{ t(`janela.responsaveis.${e.responsavel}`) }}</td>
                <td>
                  <code v-if="e.comando">{{ e.comando }}</code>
                  <template v-else>{{ t('janela.semComando') }}</template>
                </td>
                <td>{{ e.minutos ?? t('janela.semMinutos') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- A verificação depois da janela: a da produção conta; a do ensaio é o ensaio do roteiro -->
        <section aria-labelledby="janela-verificacoes" data-testid="janela-verificacoes">
          <h2 id="janela-verificacoes">{{ t('janela.verificacoes') }}</h2>
          <article
            v-for="x in verificacoes(passo)"
            :key="x.ambiente"
            :data-testid="`verificacao-${x.ambiente}`"
          >
            <h3>{{ t(`janela.ambientes.${x.ambiente}`) }}</h3>
            <p v-if="!x.v">{{ t('janela.semVerificacao') }}</p>
            <template v-else>
              <p :data-testid="`verificacao-${x.ambiente}-resumo`">
                <strong>{{ x.v.aprovada ? t('janela.aprovada') : t('janela.reprovada') }}</strong>
                · {{ t('janela.verificadaEm', { em: instante(x.v.em) }) }}
                <template v-if="x.v.duracaoMinutos !== null">
                  · {{ t('janela.duracao', { n: x.v.duracaoMinutos }) }}</template
                >
                <template v-if="x.v.versaoMotor">
                  ·
                  {{
                    t('janela.motor', { versao: x.v.versaoMotor, charset: x.v.charsetBanco ?? '—' })
                  }}</template
                >
              </p>
              <p>{{ textoNumeros(x.v) }}</p>
              <ul>
                <li
                  v-for="c in x.v.checagens"
                  :key="c.checagem"
                  :data-testid="`checagem-${x.ambiente}-${c.checagem}`"
                >
                  {{ t(`janela.checagens.${c.checagem}`) }}:
                  <span :class="`situacao-${variante(c.situacao)}`">{{
                    t(`janela.situacoesChecagem.${c.situacao}`)
                  }}</span>
                  <template v-for="a in c.achados" :key="a"> — {{ t(`janela.achados.${a}`) }}</template>
                </li>
              </ul>
            </template>
          </article>
        </section>
      </template>

      <p>
        <code data-testid="janela-relatorio">{{ painel.relatorio }}</code>
        ·
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
.dados-janela {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.dados-janela dd {
  margin: 0;
}
.passos {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-3) 0;
}
small {
  display: block;
}
.critica {
  font-weight: 700;
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
