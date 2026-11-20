<script setup lang="ts">
// Carga de catálogo (M13, ficha seção 7): validação e comparação com o que o banco tem (novos, alterados, iguais,
// removidos na fonte, linhas com erro e as trocas de caracteres propostas), a decisão de publicar e as ações:
// aprovar (crítica: justificativa e a senha de novo), rejeitar e cancelar entre lotes.
import { CATALOGOS, type DetalheCargaCatalogo, permissaoAprovadorCatalogo } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import ConfirmacaoCritica from '../../precos/componentes/ConfirmacaoCritica.vue';
import { aprovarCarga, buscarCarga, encerrarCarga } from '../api-catalogos.js';

const props = defineProps<{ id: string }>();
const { t } = useI18n();
const pagina = ref(0);
const comparacao = ref('');
const resultado = ref('');
watch([comparacao, resultado], () => (pagina.value = 0));
const opcoesComparacao = computed(() => [
  { valor: '', rotulo: t('catalogos.carga.todas') },
  ...['novo', 'alterado', 'igual', 'removido'].map((x) => ({
    valor: x,
    rotulo: t(`catalogos.carga.comparacoes.${x}`),
  })),
]);
const opcoesResultado = computed(() => [
  { valor: '', rotulo: t('catalogos.carga.todas') },
  ...['valida', 'erro'].map((x) => ({ valor: x, rotulo: t(`catalogos.carga.resultados.${x}`) })),
]);
const detalhe = useQuery({
  queryKey: computed(() => ['catalogos', 'carga', props.id, pagina.value, comparacao.value, resultado.value]),
  queryFn: () =>
    buscarCarga(Number(props.id), {
      pagina: pagina.value,
      comparacao: comparacao.value || null,
      resultado: resultado.value || null,
    }),
});
const d = computed<DetalheCargaCatalogo | null>(() => detalhe.data.value ?? null);
const tituloCatalogo = computed(
  () => CATALOGOS.find((c) => c.codigo === d.value?.carga.catalogo)?.titulo ?? '',
);
// Aprovação pela área do catálogo (ficha, seção 5): catalogo.carga.publicar e a permissão da área (a API confere).
const podeAprovar = computed(() => {
  const def = CATALOGOS.find((c) => c.codigo === d.value?.carga.catalogo);
  return !!def && pode('catalogo.carga.publicar') && pode(permissaoAprovadorCatalogo(def.aprovador));
});
const tituloEntidade = (e: string) =>
  CATALOGOS.flatMap((c) => c.entidades).find((x) => x.codigo === e)?.titulo ?? e;
const ap = reactive({ justificativa: '', senha: '' });
const motivo = ref('');
const mensagem = ref<string | null>(null);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
function tratar(e: unknown): void {
  if (e instanceof ErroApi && e.problema?.detail && [400, 401, 403, 404, 409].includes(e.status))
    recusa.value = e.problema.detail;
  else erro.value = e;
}
async function aprovar(): Promise<void> {
  if (!d.value) return;
  recusa.value = null;
  try {
    const r = await aprovarCarga(d.value.carga.id, {
      justificativa: ap.justificativa,
      senha: ap.senha,
      versao: d.value.versao,
    });
    mensagem.value = `${t('catalogos.carga.aprovada')} ${r.mensagem}`;
    ap.senha = '';
    await detalhe.refetch();
  } catch (e) {
    tratar(e);
  }
}
async function encerrar(acao: 'rejeitar' | 'cancelar'): Promise<void> {
  if (!d.value) return;
  recusa.value = null;
  try {
    await encerrarCarga(d.value.carga.id, acao, motivo.value, d.value.versao);
    mensagem.value = acao === 'rejeitar' ? t('catalogos.carga.rejeitada') : t('catalogos.carga.cancelada');
    await detalhe.refetch();
  } catch (e) {
    tratar(e);
  }
}
const fmt = (v: Record<string, string | number | null> | null) =>
  v
    ? Object.entries(v)
        .map(([k, x]) => `${k}=${x ?? ''}`)
        .join(' · ')
    : '';
const totalPaginas = computed(() =>
  Math.max(1, Math.ceil((d.value?.total ?? 0) / (d.value?.porPagina ?? 50))),
);
</script>

<template>
  <section class="tela" aria-labelledby="carga-titulo">
    <MensagemErro v-if="detalhe.isError.value" :erro="detalhe.error.value" />
    <template v-if="d">
      <h1 id="carga-titulo">
        {{ t('catalogos.carga.titulo', { id: d.carga.id, catalogo: tituloCatalogo }) }}
      </h1>
      <p>
        <RouterLink :to="{ name: 'catalogos.painel' }">{{ t('catalogos.carga.voltar') }}</RouterLink>
      </p>
      <p data-testid="situacao-carga">
        <strong>{{ t(`catalogos.situacoes.${d.carga.situacao}`) }}</strong>
        <template v-if="d.carga.edicao">
          · {{ t('catalogos.carga.edicao', { edicao: d.carga.edicao }) }}</template
        >
      </p>
      <p>
        {{
          t('catalogos.carga.arquivo', {
            arquivo: d.carga.arquivo,
            bytes: d.carga.bytes,
            sha: d.carga.sha256.slice(0, 12),
          })
        }}
        ·
        {{ d.carga.arquivoGuardado ? t('catalogos.carga.guardado') : t('catalogos.carga.naoGuardado') }}
      </p>
      <p data-testid="totais-carga">{{ t('catalogos.carga.totais', d.carga.totais) }}</p>
      <p data-testid="lotes-carga">{{ t('catalogos.carga.lotes', d.carga.lotes) }}</p>
      <SanteAlerta
        v-if="d.carga.motivo"
        :texto="d.carga.motivo"
        variante="aviso"
        data-testid="motivo-carga"
      />
      <p v-if="mensagem" role="status" data-testid="mensagem-carga">{{ mensagem }}</p>
      <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="recusa-carga" />
      <MensagemErro v-if="erro" :erro="erro" />

      <div class="filtros">
        <div class="campo">
          <SanteSelecao
            id="carga-comparacao"
            v-model="comparacao"
            :rotulo="t('catalogos.carga.filtroComparacao')"
            :opcoes="opcoesComparacao"
            data-testid="filtro-comparacao"
          />
        </div>
        <div class="campo">
          <SanteSelecao
            id="carga-resultado"
            v-model="resultado"
            :rotulo="t('catalogos.carga.filtroResultado')"
            :opcoes="opcoesResultado"
            data-testid="filtro-resultado"
          />
        </div>
      </div>
      <div class="rolagem" tabindex="0" role="region" :aria-label="t('catalogos.comum.tabela')">
        <table data-testid="tabela-linhas">
          <caption>
            {{
              t('catalogos.carga.titulo', { id: d.carga.id, catalogo: tituloCatalogo })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('catalogos.carga.linha') }}</th>
              <th scope="col">{{ t('catalogos.carga.entidade') }}</th>
              <th scope="col">{{ t('catalogos.carga.chave') }}</th>
              <th scope="col">{{ t('catalogos.carga.resultado') }}</th>
              <th scope="col">{{ t('catalogos.carga.antes') }}</th>
              <th scope="col">{{ t('catalogos.carga.depois') }}</th>
              <th scope="col">{{ t('catalogos.carga.motivo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in d.linhas" :key="i" :data-testid="`linha-${l.chave}`">
              <td>{{ l.comparacao === 'removido' ? '' : l.linha }}</td>
              <td>{{ tituloEntidade(l.entidade) }}</td>
              <td>{{ l.chave }}</td>
              <td>
                {{
                  l.comparacao
                    ? t(`catalogos.carga.comparacoes.${l.comparacao}`)
                    : t(`catalogos.carga.resultados.${l.resultado}`)
                }}
              </td>
              <td>{{ fmt(l.antes) }}</td>
              <td>{{ fmt(l.depois) }}</td>
              <td>{{ l.motivo ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>{{ t('catalogos.comum.pagina', { pagina: pagina + 1, total: totalPaginas, n: d.total }) }}</p>
      <div class="botoes">
        <SanteBotao
          :rotulo="t('catalogos.comum.anterior')"
          variante="texto"
          :desabilitado="pagina === 0"
          @acionar="pagina--"
        />
        <SanteBotao
          :rotulo="t('catalogos.comum.proxima')"
          variante="texto"
          :desabilitado="pagina + 1 >= totalPaginas"
          @acionar="pagina++"
        />
      </div>

      <p v-if="d.carga.situacao === 'comparada' && !d.publicacao.pode" data-testid="nao-publica">
        {{ t('catalogos.carga.naoPublica', { motivo: d.publicacao.motivo ?? '' }) }}
      </p>
      <form
        v-if="d.carga.situacao === 'comparada' && podeAprovar"
        class="form"
        data-testid="form-aprovar"
        @submit.prevent="aprovar"
      >
        <p v-if="d.publicacao.pode && d.publicacao.motivo">{{ d.publicacao.motivo }}</p>
        <ConfirmacaoCritica
          v-model:justificativa="ap.justificativa"
          v-model:senha="ap.senha"
          testid="aprovar"
        />
        <SanteBotao :rotulo="t('catalogos.carga.aprovar')" tipo="submit" data-testid="carga-aprovar" />
      </form>
      <form
        v-if="
          ['comparada', 'aprovada', 'publicando', 'falhou'].includes(d.carga.situacao) &&
          pode('catalogo.carga.rejeitar')
        "
        class="form"
        @submit.prevent="encerrar(d.carga.situacao === 'comparada' ? 'rejeitar' : 'cancelar')"
      >
        <div class="campo">
          <label for="carga-motivo">{{ t('catalogos.comum.motivo') }}</label>
          <input id="carga-motivo" v-model="motivo" maxlength="200" required data-testid="carga-motivo" />
        </div>
        <SanteBotao
          :rotulo="
            d.carga.situacao === 'comparada' ? t('catalogos.carga.rejeitar') : t('catalogos.carga.cancelar')
          "
          tipo="submit"
          variante="secundario"
          data-testid="carga-encerrar"
        />
      </form>
    </template>
  </section>
</template>

<style scoped>
.form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
  max-width: 40rem;
  margin: var(--sgh-espaco-2) 0;
}
.filtros,
.botoes {
  display: flex;
  gap: var(--sgh-espaco-2);
  flex-wrap: wrap;
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
input,
select {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
