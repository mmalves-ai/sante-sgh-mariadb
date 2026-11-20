<script setup lang="ts">
// Regulação estadual (ficha do M44, seção 7, etapa 3; regra 14): `/internacao/nir/regulacao`. As solicitações de leito
// abertas com o número da regulação vigente e o histórico; registrar o número à mão (sempre possível), atualizar a
// situação informada pela central, um pedido novo depois de negada ou cancelada; as contagens por situação; o conector
// com a central (desligado até a confirmação da API, DP-29) e a configuração de regulação recebida em consulta.
import {
  CODIGOS_CENTRAL_REGULACAO,
  CODIGOS_SITUACAO_REGULACAO,
  type CentralRegulacao,
  type RegulacaoDaSolicitacao,
  type SituacaoRegulacao,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  CANAL_NIR,
  codigoDaRecusa,
  lerConfiguracaoRegulacao,
  lerRegulacao,
  novaChaveNir,
  registrarRegulacao,
} from '../api-nir.js';
import ErroAdt from '../componentes/ErroAdt.vue';
import { horaCurta } from '../regras-nir.js';
import { usarAvisosAtendimento } from '../../atendimento/vigia.js';

const { t, te } = useI18n();
const avisos = usarAvisosAtendimento(CANAL_NIR, () => void tela.refetch());
const tela = useQuery({
  queryKey: ['nir', 'regulacao'],
  queryFn: () => lerRegulacao(),
  refetchInterval: computed(() => avisos.intervalo()),
});
const verConfiguracao = ref(false);
const configuracao = useQuery({
  queryKey: ['nir', 'regulacao', 'configuracao'],
  queryFn: () => lerConfiguracaoRegulacao(),
  enabled: verConfiguracao,
});
const d = computed(() => tela.data.value);

const aberta = ref<number | null>(null);
const central = ref<CentralRegulacao>('estadual');
const sentido = ref<'entrada' | 'saida'>('saida');
const numero = ref('');
const situacao = ref<SituacaoRegulacao>('solicitada');
const observacao = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const textoErro = computed(() => {
  const c = codigoDaRecusa(erro.value);
  return c && te(`regulacao.erros.${c}`) ? t(`regulacao.erros.${c}`) : null;
});

const opcoesCentral = computed(() =>
  CODIGOS_CENTRAL_REGULACAO.map((c) => ({ valor: c, rotulo: t(`regulacao.centrais.${c}`) })),
);
const opcoesSituacao = computed(() =>
  CODIGOS_SITUACAO_REGULACAO.map((c) => ({ valor: c, rotulo: t(`regulacao.situacoes.${c}`) })),
);
const opcoesSentido = computed(() => [
  { valor: 'saida' as const, rotulo: t('regulacao.sentidos.saida') },
  { valor: 'entrada' as const, rotulo: t('regulacao.sentidos.entrada') },
]);
const encerrada = (s: RegulacaoDaSolicitacao) =>
  !!s.vigente && ['negada', 'cancelada'].includes(s.vigente.situacao);

function abrir(s: RegulacaoDaSolicitacao): void {
  aberta.value = s.solicitacao;
  erro.value = null;
  mensagem.value = null;
  if (s.vigente && !encerrada(s)) {
    central.value = s.vigente.central;
    sentido.value = s.vigente.sentido;
    numero.value = s.vigente.numero;
    situacao.value = s.vigente.situacao === 'solicitada' ? 'em_analise' : s.vigente.situacao;
  } else {
    numero.value = '';
    situacao.value = 'solicitada';
  }
  observacao.value = '';
}

async function salvar(s: RegulacaoDaSolicitacao): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    const r = await registrarRegulacao(
      {
        solicitacao: s.solicitacao,
        central: central.value,
        sentido: sentido.value,
        numero: numero.value.trim(),
        situacao: situacao.value,
        anterior: s.vigente?.id ?? null,
        observacao: observacao.value.trim() || null,
      },
      novaChaveNir('regulacao'),
    );
    mensagem.value = r.mensagem;
    aberta.value = null;
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
    await tela.refetch();
  }
}
const rotuloBotao = (s: RegulacaoDaSolicitacao) =>
  !s.vigente
    ? t('regulacao.form.novo')
    : encerrada(s)
      ? t('regulacao.form.pedidoNovo')
      : t('regulacao.form.atualizar');
</script>

<template>
  <section class="tela-agenda" aria-labelledby="regulacao-titulo" data-testid="tela-regulacao">
    <h1 id="regulacao-titulo">{{ t('regulacao.titulo') }}</h1>
    <p>{{ t('regulacao.texto') }}</p>
    <p class="acoes">
      <RouterLink to="/internacao/nir/fila">{{ t('regulacao.atalhos.fila') }}</RouterLink>
    </p>
    <ErroAdt v-if="tela.isError.value" :erro="tela.error.value" />
    <p v-else-if="!d" role="status">{{ t('regulacao.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        :variante="d.conector.ligado ? 'info' : 'aviso'"
        :texto="d.conector.ligado ? t('regulacao.conector.ligado') : (d.conector.motivo ?? '')"
        data-testid="regulacao-conector"
      />
      <SanteAlerta v-if="d.acoes.motivo" variante="info" :texto="d.acoes.motivo" />
      <p v-if="mensagem" role="status" data-testid="regulacao-mensagem">{{ mensagem }}</p>
      <div v-if="erro" role="alert" data-testid="regulacao-erro">
        <SanteAlerta v-if="textoErro" variante="alerta" :texto="textoErro" />
        <ErroAdt v-else :erro="erro" />
      </div>

      <section class="painel" aria-labelledby="regulacao-contagens" data-testid="regulacao-contagens">
        <h2 id="regulacao-contagens">{{ t('regulacao.contagens') }}</h2>
        <ul class="lista">
          <li v-for="(n, s) in d.contagens" :key="s" :data-testid="`contagem-${s}`">
            {{ t(`regulacao.situacoes.${s}`) }}: <strong>{{ n }}</strong>
          </li>
        </ul>
      </section>

      <section class="painel" aria-labelledby="regulacao-lista">
        <h2 id="regulacao-lista">{{ t('regulacao.lista.titulo') }}</h2>
        <p v-if="d.solicitacoes.length === 0">{{ t('regulacao.lista.nenhuma') }}</p>
        <article
          v-for="s in d.solicitacoes"
          :key="s.solicitacao"
          class="cartao"
          :data-testid="`regulacao-${s.solicitacao}`"
          :aria-labelledby="`regulacao-titulo-${s.solicitacao}`"
        >
          <h3 :id="`regulacao-titulo-${s.solicitacao}`">
            {{ t('regulacao.lista.solicitacao', { id: s.solicitacao }) }} · {{ s.paciente.nome }}
          </h3>
          <p class="secundario">
            {{
              t('regulacao.lista.pedidaEm', {
                em: horaCurta(s.solicitadoEm),
                prioridade: t(`nir.prioridades.${s.prioridade}`),
              })
            }}
          </p>
          <p v-if="s.vigente" data-testid="regulacao-vigente">
            {{
              t('regulacao.lista.vigente', {
                central: t(`regulacao.centrais.${s.vigente.central}`),
                numero: s.vigente.numero,
                situacao: t(`regulacao.situacoes.${s.vigente.situacao}`),
              })
            }}
          </p>
          <p v-else>{{ t('regulacao.lista.semRegistro') }}</p>
          <details v-if="s.historico.length > 1">
            <summary>{{ t('regulacao.lista.historico') }}</summary>
            <ul class="lista">
              <li v-for="h in s.historico" :key="h.id">
                {{
                  t('regulacao.lista.linha', {
                    em: horaCurta(h.em),
                    situacao: t(`regulacao.situacoes.${h.situacao}`),
                    numero: h.numero,
                    origem: t(`regulacao.origens.${h.origem}`),
                    por: h.por,
                  })
                }}
              </li>
            </ul>
          </details>
          <p
            v-if="d.acoes.registrar && aberta !== s.solicitacao && s.vigente?.situacao !== 'concluida'"
            class="acoes"
          >
            <SanteBotao
              variante="secundario"
              :rotulo="rotuloBotao(s)"
              :data-testid="`abrir-regulacao-${s.solicitacao}`"
              @acionar="abrir(s)"
            />
          </p>
          <form
            v-if="aberta === s.solicitacao"
            class="painel"
            :data-testid="`form-regulacao-${s.solicitacao}`"
            @submit.prevent="salvar(s)"
          >
            <SanteSelecao
              v-model="central"
              data-testid="reg-central"
              :rotulo="t('regulacao.form.central')"
              :opcoes="opcoesCentral"
            />
            <SanteOpcoes
              v-model="sentido"
              :legenda="t('regulacao.form.sentido')"
              :opcoes="opcoesSentido"
              :nome="`sentido-${s.solicitacao}`"
            />
            <SanteCampoTexto
              v-model="numero"
              data-testid="reg-numero"
              :rotulo="t('regulacao.form.numero')"
              :max-bytes="30"
              obrigatorio
            />
            <SanteSelecao
              v-model="situacao"
              data-testid="reg-situacao"
              :rotulo="t('regulacao.form.situacao')"
              :opcoes="opcoesSituacao"
            />
            <SanteCampoTexto v-model="observacao" :rotulo="t('regulacao.form.observacao')" :max-bytes="300" />
            <p class="acoes">
              <SanteBotao
                tipo="submit"
                :rotulo="t('regulacao.form.salvar')"
                :desabilitado="ocupado || numero.trim().length < 4"
                data-testid="salvar-regulacao"
              />
              <SanteBotao variante="texto" :rotulo="t('regulacao.form.cancelar')" @acionar="aberta = null" />
            </p>
          </form>
        </article>
      </section>

      <section class="painel" aria-labelledby="regulacao-config" data-testid="regulacao-configuracao">
        <h2 id="regulacao-config">{{ t('regulacao.configuracao.titulo') }}</h2>
        <p class="secundario">{{ t('regulacao.configuracao.texto') }}</p>
        <SanteBotao
          v-if="!verConfiguracao"
          variante="texto"
          :rotulo="t('regulacao.atalhos.configuracao')"
          data-testid="ver-configuracao"
          @acionar="verConfiguracao = true"
        />
        <template v-else-if="configuracao.data.value">
          <table class="tabela">
            <caption>
              {{
                t('regulacao.configuracao.sistemas')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('regulacao.configuracao.sigla') }}</th>
                <th scope="col">{{ t('regulacao.configuracao.ativo') }}</th>
                <th scope="col">{{ t('regulacao.configuracao.servicos') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in configuracao.data.value.sistemas" :key="x.id">
                <th scope="row">{{ x.sigla }}</th>
                <td>{{ x.ativo ? t('regulacao.configuracao.sim') : t('regulacao.configuracao.nao') }}</td>
                <td>{{ x.servicos }} ({{ x.servicosAtivos }})</td>
              </tr>
            </tbody>
          </table>
          <table class="tabela">
            <caption>
              {{
                t('regulacao.configuracao.endpoints')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('regulacao.configuracao.descricao') }}</th>
                <th scope="col">{{ t('regulacao.configuracao.metodo') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in configuracao.data.value.endpoints" :key="x.id">
                <th scope="row">{{ x.descricao }}</th>
                <td>{{ x.metodo ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
          <table class="tabela">
            <caption>
              {{
                t('regulacao.configuracao.tabelas')
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">{{ t('regulacao.configuracao.descricao') }}</th>
                <th scope="col">{{ t('regulacao.configuracao.ativo') }}</th>
                <th scope="col">{{ t('regulacao.configuracao.valores') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in configuracao.data.value.tabelas" :key="x.id">
                <th scope="row">{{ x.descricao }}</th>
                <td>{{ x.ativo ? t('regulacao.configuracao.sim') : t('regulacao.configuracao.nao') }}</td>
                <td>{{ x.valores }}</td>
              </tr>
            </tbody>
          </table>
        </template>
        <p v-else role="status">{{ t('regulacao.carregando') }}</p>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
