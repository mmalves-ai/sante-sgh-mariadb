<script setup lang="ts">
// Tela "Fumaça do servidor" (M60, etapa 3), terceira aba da "Saúde do sistema": o que a instância confere de si depois
// da implantação (fuso, relógio contra o banco, Valkey, worker e filas, estrutura do banco contra a homologada, chaves
// de liberação contra as esperadas). É a mesma fumaça que `implantacao:verificar` lê pela sonda. Só leitura
// (sistema.saude.ler); só códigos e contagens: o escopo pessoa das chaves sai contado, nunca com o login.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { mensagemDoErro } from '../../../casca/erros/problem-details.js';
import AbasSaude from '../componentes/AbasSaude.vue';
import {
  buscarFumacaServidor,
  chaveSimNao,
  contagemOuTraco,
  contagemPorSituacao,
  derivaEmSegundos,
  filaSemConsumidor,
  fusoEmTexto,
  itensFumacaOrdenados,
  totalLigadas,
} from '../api.js';

const { t } = useI18n();
const consulta = useQuery({
  queryKey: ['implantacao', 'fumaca'],
  queryFn: () => buscarFumacaServidor(),
  staleTime: 0,
});
const dados = computed(() => consulta.data.value);
const itens = computed(() => itensFumacaOrdenados(dados.value?.itens));
const contagem = computed(() => contagemPorSituacao(dados.value?.itens));
const erro = computed(() => (consulta.isError.value ? t(mensagemDoErro(consulta.error.value).texto) : null));
const varianteGeral = computed(() =>
  dados.value?.situacao === 'falha' ? 'alerta' : dados.value?.situacao === 'alerta' ? 'aviso' : 'info',
);
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const naoLido = () => t('implantacao.fumaca.relogio.naoLido');
const linhasRelogio = computed(() => {
  const r = dados.value?.relogio;
  if (!r) return [];
  return [
    { campo: 'fuso', valor: r.fuso },
    { campo: 'servidorEm', valor: r.servidorEm },
    { campo: 'bancoLocal', valor: r.bancoLocal ?? naoLido() },
    { campo: 'fusoBanco', valor: fusoEmTexto(r.fusoBancoMin) ?? naoLido() },
    {
      campo: 'deriva',
      valor: (() => {
        const d = derivaEmSegundos(r.derivaMs);
        return d === null ? naoLido() : `${d} (${t('implantacao.fumaca.relogio.derivaNota')})`;
      })(),
    },
  ];
});
const estadoImpressao = computed(() => dados.value?.impressao.estado ?? 'nulo');
const inesperadas = computed(() => new Set(dados.value?.chaves.inesperadas ?? []));

function conferirDeNovo(): void {
  void consulta.refetch();
}
</script>

<template>
  <section class="tela" aria-labelledby="fumaca-titulo" data-testid="tela-fumaca-servidor">
    <h1 id="fumaca-titulo">{{ t('config.saude.tituloSistema') }}</h1>
    <AbasSaude atual="fumaca" />
    <h2>{{ t('implantacao.fumaca.titulo') }}</h2>
    <p>{{ t('implantacao.fumaca.texto') }}</p>
    <SanteBotao
      :rotulo="t('implantacao.fumaca.atualizar')"
      variante="secundario"
      :desabilitado="consulta.isFetching.value"
      data-testid="fumaca-atualizar"
      @acionar="conferirDeNovo"
    />
    <p v-if="consulta.isPending.value" aria-live="polite" data-testid="fumaca-carregando">
      {{ t('implantacao.fumaca.carregando') }}
    </p>
    <SanteAlerta
      v-if="erro"
      :texto="t('implantacao.fumaca.erro', { erro })"
      variante="alerta"
      anunciar
      data-testid="fumaca-erro"
    />
    <template v-if="dados">
      <p data-testid="fumaca-resumo">
        {{
          t('implantacao.fumaca.resumo', {
            hospital: dados.hospital,
            ambiente: dados.ambiente,
            em: dataHora(dados.em),
          })
        }}
      </p>
      <SanteAlerta
        :texto="t(`implantacao.fumaca.situacaoGeral.${dados.situacao}`)"
        :variante="varianteGeral"
        :icone="dados.situacao === 'ok' ? 'check' : 'alerta'"
        anunciar
        :data-situacao="dados.situacao"
        data-testid="fumaca-situacao"
      />
      <p data-testid="fumaca-contagem">{{ t('implantacao.contagem', contagem) }}</p>

      <table data-testid="fumaca-itens">
        <caption>
          {{
            t('implantacao.fumaca.itensLegenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('implantacao.itens.item') }}</th>
            <th scope="col">{{ t('implantacao.itens.situacao') }}</th>
            <th scope="col">{{ t('implantacao.itens.detalhe') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="i in itens"
            :key="i.codigo"
            :data-testid="`fumaca-item-${i.codigo}`"
            :data-situacao="i.situacao"
          >
            <th scope="row">{{ i.titulo }}</th>
            <td :class="`situacao-${i.situacao}`">{{ t(`implantacao.situacao.${i.situacao}`) }}</td>
            <td>{{ i.detalhe }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ t('implantacao.fumaca.relogio.titulo') }}</h3>
      <table data-testid="fumaca-relogio">
        <caption>
          {{
            t('implantacao.fumaca.relogio.legenda')
          }}
        </caption>
        <tbody>
          <tr v-for="l in linhasRelogio" :key="l.campo" :data-testid="`relogio-${l.campo}`">
            <th scope="row">{{ t(`implantacao.fumaca.relogio.${l.campo}`) }}</th>
            <td>{{ l.valor }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ t('implantacao.fumaca.valkey.titulo') }}</h3>
      <dl class="pares" data-testid="fumaca-valkey">
        <dt>{{ t('implantacao.fumaca.valkey.configurado') }}</dt>
        <dd>{{ t(`implantacao.simNao.${chaveSimNao(dados.valkey.configurado)}`) }}</dd>
        <dt>{{ t('implantacao.fumaca.valkey.responde') }}</dt>
        <dd data-testid="valkey-responde">
          {{ t(`implantacao.simNao.${chaveSimNao(dados.valkey.responde)}`) }}
        </dd>
        <dt>{{ t('implantacao.fumaca.valkey.latencia') }}</dt>
        <dd>
          {{
            dados.valkey.latenciaMs === null
              ? t('implantacao.fumaca.relogio.naoLido')
              : t('implantacao.fumaca.valkey.latenciaMs', { ms: dados.valkey.latenciaMs })
          }}
        </dd>
      </dl>

      <h3>{{ t('implantacao.fumaca.filas.titulo') }}</h3>
      <p v-if="dados.filas.length === 0" data-testid="filas-nenhuma">
        {{ t('implantacao.fumaca.filas.nenhuma') }}
      </p>
      <table v-else data-testid="fumaca-filas">
        <caption>
          {{
            t('implantacao.fumaca.filas.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('implantacao.fumaca.filas.fila') }}</th>
            <th scope="col">{{ t('implantacao.fumaca.filas.consumidores') }}</th>
            <th scope="col">{{ t('implantacao.fumaca.filas.aguardando') }}</th>
            <th scope="col">{{ t('implantacao.fumaca.filas.ativos') }}</th>
            <th scope="col">{{ t('implantacao.fumaca.filas.atrasados') }}</th>
            <th scope="col">{{ t('implantacao.fumaca.filas.falhas') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in dados.filas" :key="f.codigo" :data-testid="`fila-${f.codigo}`">
            <th scope="row">{{ t(`implantacao.fumaca.filas.nomes.${f.codigo}`) }}</th>
            <td :class="{ 'situacao-falha': filaSemConsumidor(f) === true }">
              {{ contagemOuTraco(f.consumidores) }}
              <span v-if="filaSemConsumidor(f) === true" data-testid="fila-sem-consumidor">
                ({{ t('implantacao.fumaca.filas.semConsumidor') }})</span
              >
            </td>
            <td>{{ contagemOuTraco(f.aguardando) }}</td>
            <td>{{ contagemOuTraco(f.ativos) }}</td>
            <td>{{ contagemOuTraco(f.atrasados) }}</td>
            <td>{{ contagemOuTraco(f.falhas) }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ t('implantacao.fumaca.impressao.titulo') }}</h3>
      <dl class="pares" data-testid="fumaca-impressao" :data-estado="estadoImpressao">
        <dt>{{ t('implantacao.fumaca.impressao.estado') }}</dt>
        <dd>{{ t(`implantacao.fumaca.impressao.estados.${estadoImpressao}`) }}</dd>
        <dt>{{ t('implantacao.fumaca.impressao.resumo') }}</dt>
        <dd>{{ dados.impressao.resumo ?? t('implantacao.fumaca.relogio.naoLido') }}</dd>
        <dt>{{ t('implantacao.fumaca.impressao.resumoHomologado') }}</dt>
        <dd>{{ dados.impressao.resumoHomologado ?? t('implantacao.fumaca.relogio.naoLido') }}</dd>
        <dt>{{ t('implantacao.fumaca.impressao.verificadaEm') }}</dt>
        <dd>
          {{
            dados.impressao.verificadaEm
              ? dataHora(dados.impressao.verificadaEm)
              : t('implantacao.fumaca.relogio.naoLido')
          }}
        </dd>
      </dl>
      <SanteAlerta
        v-if="dados.impressao.bloqueiaTudo || dados.impressao.tabelasBloqueadas > 0"
        :texto="
          dados.impressao.bloqueiaTudo
            ? t('implantacao.fumaca.impressao.bloqueioTotal')
            : t('implantacao.fumaca.impressao.bloqueio', { n: dados.impressao.tabelasBloqueadas })
        "
        variante="alerta"
        data-testid="impressao-bloqueio"
      />

      <h3>{{ t('implantacao.fumaca.chaves.titulo') }}</h3>
      <SanteAlerta
        v-if="!dados.chaves.lidas"
        :texto="t('implantacao.fumaca.chaves.naoLidas')"
        variante="alerta"
        data-testid="chaves-nao-lidas"
      />
      <template v-else>
        <p data-testid="chaves-esperadas">
          {{
            dados.chaves.esperadas.length === 0
              ? t('implantacao.fumaca.chaves.nenhumaEsperada')
              : t('implantacao.fumaca.chaves.esperadas', { lista: dados.chaves.esperadas.join(', ') })
          }}
        </p>
        <p v-if="dados.chaves.ligadas.length === 0" data-testid="chaves-nenhuma">
          {{ t('implantacao.fumaca.chaves.nenhuma') }}
        </p>
        <table v-else data-testid="fumaca-chaves">
          <caption>
            {{
              t('implantacao.fumaca.chaves.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('implantacao.fumaca.chaves.chave') }}</th>
              <th scope="col">{{ t('implantacao.fumaca.chaves.tipo') }}</th>
              <th scope="col">{{ t('implantacao.fumaca.chaves.linhas') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in dados.chaves.ligadas"
              :key="`${c.tipo}:${c.chave}`"
              :data-testid="`chave-${c.chave}`"
              :data-inesperada="inesperadas.has(c.chave) ? 'sim' : 'nao'"
            >
              <th scope="row">
                {{ c.chave }}
                <span v-if="inesperadas.has(c.chave)" class="situacao-falha">
                  ({{ t('implantacao.fumaca.chaves.inesperada') }})</span
                >
              </th>
              <td>{{ t(`implantacao.fumaca.chaves.tipos.${c.tipo}`) }}</td>
              <td>
                {{ totalLigadas(c) }}:
                {{
                  t('implantacao.fumaca.chaves.escopos', {
                    hospital: c.hospital,
                    setor: c.setor,
                    grupo: c.grupo,
                    pessoa: c.pessoa,
                  })
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  inline-size: 100%;
  margin-block: var(--sgh-espaco-3);
}
th,
td {
  padding: var(--sgh-espaco-2);
  border-block-end: 1px solid var(--sgh-borda);
  text-align: start;
  vertical-align: top;
}
.situacao-falha,
.situacao-alerta {
  font-weight: 700;
}
.pares {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--sgh-espaco-1) var(--sgh-espaco-3);
}
.pares dd {
  margin: 0;
}
</style>
