<script setup lang="ts">
// Tela "Conferência da instalação" (M60, etapa 2), aba da "Saúde do sistema": depois de instalar ou atualizar, a TI
// do hospital confere aqui a versão instalada, a conexão de verdade ao banco do estabelecimento ativo (motor,
// autenticação, cifragem do canal, conjunto de caracteres, conta técnica e papel) e as atualizações do banco do
// pacote contra as aplicadas. Cada item vem com a situação (em ordem, alerta, falha) e o detalhe; em produção o que
// seria alerta vira falha (regra do domínio). Só leitura (sistema.saude.ler); nada de pessoa, senha ou endereço.
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { mensagemDoErro } from '../../../casca/erros/problem-details.js';
import AbasSaude from '../componentes/AbasSaude.vue';
import {
  buscarConferenciaInstalacao,
  chaveSimNao,
  contagemPorSituacao,
  itensOrdenados,
  pendentesAlemDaLista,
} from '../api.js';

const { t } = useI18n();
const consulta = useQuery({
  queryKey: ['implantacao', 'conferencia'],
  queryFn: () => buscarConferenciaInstalacao(),
  staleTime: 0,
});
const dados = computed(() => consulta.data.value);
const itens = computed(() => itensOrdenados(dados.value?.itens));
const contagem = computed(() => contagemPorSituacao(dados.value?.itens));
const alem = computed(() => pendentesAlemDaLista(dados.value));
const erro = computed(() => (consulta.isError.value ? t(mensagemDoErro(consulta.error.value).texto) : null));
const varianteGeral = computed(() =>
  dados.value?.situacao === 'falha' ? 'alerta' : dados.value?.situacao === 'alerta' ? 'aviso' : 'info',
);
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const valor = (v: string | null) => v ?? t('implantacao.conexao.semValor');
const linhasConexao = computed(() => {
  const c = dados.value?.conexao;
  if (!c) return [];
  return [
    { campo: 'versaoMotor', valor: c.versaoMotor },
    { campo: 'charsetBanco', valor: c.charsetBanco },
    { campo: 'charsetConexao', valor: valor(c.charsetConexao) },
    { campo: 'charsetParametro', valor: c.charsetParametro },
    { campo: 'autenticacao', valor: valor(c.autenticacao) },
    { campo: 'canalCifrado', valor: t(`implantacao.simNao.${chaveSimNao(c.canalCifrado)}`) },
    { campo: 'canalComprimido', valor: t(`implantacao.simNao.${chaveSimNao(c.canalComprimido)}`) },
    { campo: 'protocolo', valor: valor(c.protocolo) },
    { campo: 'conta', valor: c.conta },
    { campo: 'papel', valor: valor(c.papel) },
  ];
});

function conferirDeNovo(): void {
  void consulta.refetch();
}
</script>

<template>
  <section class="tela" aria-labelledby="conferencia-titulo" data-testid="tela-conferencia-instalacao">
    <h1 id="conferencia-titulo">{{ t('config.saude.tituloSistema') }}</h1>
    <AbasSaude atual="conferencia" />
    <h2>{{ t('implantacao.titulo') }}</h2>
    <p>{{ t('implantacao.texto') }}</p>
    <SanteBotao
      :rotulo="t('implantacao.atualizar')"
      variante="secundario"
      :desabilitado="consulta.isFetching.value"
      data-testid="conferencia-atualizar"
      @acionar="conferirDeNovo"
    />
    <p v-if="consulta.isPending.value" aria-live="polite" data-testid="conferencia-carregando">
      {{ t('implantacao.carregando') }}
    </p>
    <SanteAlerta
      v-if="erro"
      :texto="t('implantacao.erro', { erro })"
      variante="alerta"
      anunciar
      data-testid="conferencia-erro"
    />
    <template v-if="dados">
      <p data-testid="conferencia-resumo">
        {{
          t('implantacao.resumo', {
            hospital: dados.hospital,
            ambiente: dados.ambiente,
            em: dataHora(dados.em),
          })
        }}
      </p>
      <SanteAlerta
        :texto="t(`implantacao.situacaoGeral.${dados.situacao}`)"
        :variante="varianteGeral"
        :icone="dados.situacao === 'ok' ? 'check' : 'alerta'"
        anunciar
        :data-situacao="dados.situacao"
        data-testid="conferencia-situacao"
      />
      <p data-testid="conferencia-contagem">{{ t('implantacao.contagem', contagem) }}</p>

      <table data-testid="tabela-itens">
        <caption>
          {{
            t('implantacao.itens.legenda')
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
            :data-testid="`item-${i.codigo}`"
            :data-situacao="i.situacao"
          >
            <th scope="row">{{ i.titulo }}</th>
            <td :class="`situacao-${i.situacao}`">{{ t(`implantacao.situacao.${i.situacao}`) }}</td>
            <td>{{ i.detalhe }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ t('implantacao.versao.titulo') }}</h3>
      <dl class="pares" data-testid="conferencia-versao">
        <dt>{{ t('implantacao.versao.versao') }}</dt>
        <dd>{{ dados.versao.versao }}</dd>
        <dt>{{ t('implantacao.versao.identificacao') }}</dt>
        <dd>{{ dados.versao.identificacao }}</dd>
      </dl>

      <h3>{{ t('implantacao.conexao.titulo') }}</h3>
      <table data-testid="tabela-conexao">
        <caption>
          {{
            t('implantacao.conexao.legenda')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('implantacao.conexao.campo') }}</th>
            <th scope="col">{{ t('implantacao.conexao.valor') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in linhasConexao" :key="l.campo" :data-testid="`conexao-${l.campo}`">
            <th scope="row">{{ t(`implantacao.conexao.${l.campo}`) }}</th>
            <td>{{ l.valor }}</td>
          </tr>
        </tbody>
      </table>

      <h3>{{ t('implantacao.scripts.titulo') }}</h3>
      <p v-if="!dados.scripts.registroLido" data-testid="scripts-nao-lido">
        {{
          t('implantacao.scripts.naoLido', {
            noPacote: dados.scripts.noPacote,
            ultimoNoPacote: dados.scripts.ultimoNoPacote ?? t('implantacao.scripts.nenhuma'),
          })
        }}
      </p>
      <p v-else data-testid="scripts-resumo">
        {{
          t('implantacao.scripts.resumo', {
            noPacote: dados.scripts.noPacote,
            ultimoNoPacote: dados.scripts.ultimoNoPacote ?? t('implantacao.scripts.nenhuma'),
            aplicados: dados.scripts.aplicados,
            ultimoAplicado: dados.scripts.ultimoAplicado ?? t('implantacao.scripts.nenhuma'),
          })
        }}
      </p>
      <p
        v-if="
          dados.scripts.registroLido &&
          dados.scripts.pendentesTotal === 0 &&
          dados.scripts.divergentes.length === 0 &&
          dados.scripts.desconhecidos.length === 0
        "
        data-testid="scripts-em-dia"
      >
        {{ t('implantacao.scripts.emDia') }}
      </p>
      <section v-if="dados.scripts.pendentesTotal > 0" data-testid="scripts-pendentes">
        <h4>{{ t('implantacao.scripts.pendentes', { total: dados.scripts.pendentesTotal }) }}</h4>
        <ul class="numeros">
          <li v-for="n in dados.scripts.pendentes" :key="n">{{ n }}</li>
        </ul>
        <p v-if="alem > 0">{{ t('implantacao.scripts.alemDaLista', { n: alem }) }}</p>
      </section>
      <section v-if="dados.scripts.divergentes.length > 0" data-testid="scripts-divergentes">
        <h4>{{ t('implantacao.scripts.divergentes') }}</h4>
        <ul class="numeros">
          <li v-for="n in dados.scripts.divergentes" :key="n">{{ n }}</li>
        </ul>
      </section>
      <section v-if="dados.scripts.desconhecidos.length > 0" data-testid="scripts-desconhecidos">
        <h4>{{ t('implantacao.scripts.desconhecidos') }}</h4>
        <ul class="numeros">
          <li v-for="n in dados.scripts.desconhecidos" :key="n">{{ n }}</li>
        </ul>
      </section>
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
.numeros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  list-style: none;
  padding: 0;
}
</style>
