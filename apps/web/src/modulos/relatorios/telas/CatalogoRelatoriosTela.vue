<script setup lang="ts">
// Catálogo de relatórios parametrizados (M34; ficha, seção 7 e regras 1, 3 e 4): `/relatorios`. A lista do catálogo
// (área, papel dono, onda, fonte, régua, fórmula e a conferência do número), o formulário GERADO dos parâmetros do
// relatório (o mesmo Zod do servidor valida aqui e lá), a grade com os totais, a máscara do dado de pessoa e a
// exportação (CSV, planilha, PDF; sempre com a justificativa, W0-09: fica na execução e na trilha). O link do envio agendado
// abre aqui com o relatório e os parâmetros (`?relatorio=…&p.<campo>=…`).
import {
  esquemaParametrosRelatorio,
  FORMATOS_EXPORTACAO,
  type FormatoExportacao,
  relatorioDoCatalogo,
  type RelatorioDescrito,
  type ResultadoRelatorio,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  codigoDaRecusa,
  executarRelatorio,
  exportarRelatorio,
  lerCatalogo,
  lerExecucoes,
} from '../api-relatorios.js';

const { t, te } = useI18n();
const rota = useRoute();
const cliente = useQueryClient();
const catalogo = useQuery({ queryKey: ['relatorios', 'catalogo'], queryFn: () => lerCatalogo() });
const escolhido = ref<string>(typeof rota.query['relatorio'] === 'string' ? rota.query['relatorio'] : '');
const relatorio = computed<RelatorioDescrito | null>(
  () => catalogo.data.value?.find((r) => r.codigo === escolhido.value) ?? null,
);
const valores = reactive<Record<string, string>>({});
const resultado = ref<ResultadoRelatorio | null>(null);
const erro = ref<unknown>(null);
const emitindo = ref(false);
const formato = ref<FormatoExportacao>('csv');
const justificativa = ref('');
const exportado = ref(false);
const execucoes = useQuery({
  queryKey: computed(() => ['relatorios', 'execucoes', escolhido.value]),
  queryFn: () => lerExecucoes(escolhido.value || null),
  enabled: computed(() => escolhido.value !== ''),
});

const hoje = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
/** O padrão relativo do parâmetro no dia da tela (o servidor resolve de novo pelo relógio do banco). */
function padrao(v: string | undefined, tipo: string): string {
  if (!v) return '';
  const h = hoje();
  const d = new Date(`${h}T00:00:00Z`);
  const dia = (x: Date) => x.toISOString().slice(0, 10);
  const relativos: Record<string, string> = {
    hoje: h,
    ontem: dia(new Date(d.getTime() - 86_400_000)),
    inicioDoMes: `${h.slice(0, 7)}-01`,
    inicioDoMesAnterior: dia(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))),
    fimDoMesAnterior: dia(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))),
    mesAtual: h.slice(0, 7),
    mesAnterior: dia(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))).slice(0, 7),
  };
  return tipo === 'data' || tipo === 'mes' ? (relativos[v] ?? v) : v;
}

watch(
  relatorio,
  (r) => {
    resultado.value = null;
    erro.value = null;
    exportado.value = false;
    for (const k of Object.keys(valores)) delete valores[k];
    if (!r) return;
    for (const p of r.parametros) {
      const doLink = rota.query[`p.${p.campo}`];
      valores[p.campo] = typeof doLink === 'string' ? padrao(doLink, p.tipo) : padrao(p.padrao, p.tipo);
    }
  },
  { immediate: true },
);

/** Os valores tipados (inteiro como número; vazio do opcional fica de fora). */
const parametros = computed<Record<string, string | number>>(() => {
  const r = relatorio.value;
  const o: Record<string, string | number> = {};
  if (!r) return o;
  for (const p of r.parametros) {
    const v = (valores[p.campo] ?? '').trim();
    if (v === '') continue;
    o[p.campo] = p.tipo === 'inteiro' ? Number(v) : v;
  }
  return o;
});
/** O mesmo Zod do servidor (a definição pública do relatório). */
const validacao = computed(() => {
  const def = relatorio.value ? relatorioDoCatalogo(relatorio.value.codigo) : undefined;
  if (!def) return null;
  const r = esquemaParametrosRelatorio(def).safeParse(parametros.value);
  return r.success ? null : r.error.issues.map((i) => i.message).join(' ');
});
const recusa = computed(() => {
  const c = codigoDaRecusa(erro.value);
  return c && te(`relatorios.recusas.${c}`) ? `relatorios.recusas.${c}` : null;
});

async function emitir(): Promise<void> {
  if (!relatorio.value || validacao.value) return;
  emitindo.value = true;
  erro.value = null;
  exportado.value = false;
  try {
    resultado.value = await executarRelatorio(relatorio.value.codigo, parametros.value);
    await cliente.invalidateQueries({ queryKey: ['relatorios', 'execucoes'] });
  } catch (e) {
    erro.value = e;
    resultado.value = null;
  } finally {
    emitindo.value = false;
  }
}

async function exportar(): Promise<void> {
  if (!relatorio.value || validacao.value) return;
  erro.value = null;
  exportado.value = false;
  try {
    await exportarRelatorio(
      relatorio.value.codigo,
      parametros.value,
      formato.value,
      justificativa.value.trim(),
    );
    exportado.value = true;
    await cliente.invalidateQueries({ queryKey: ['relatorios', 'execucoes'] });
  } catch (e) {
    erro.value = e;
  }
}

const formatar = (v: string | number | null | undefined, tipo: string): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    if (tipo === 'dinheiro') return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (tipo === 'percentual') return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} %`;
    return v.toLocaleString('pt-BR');
  }
  if (tipo === 'data' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('/');
  if (tipo === 'dataHora' && /^\d{4}-\d{2}-\d{2}T/.test(v))
    return `${v.slice(0, 10).split('-').reverse().join('/')} ${v.slice(11, 16)}`;
  return v;
};
const opcoesRelatorio = computed(() => [
  { valor: '', rotulo: t('relatorios.catalogo.escolha') },
  ...(catalogo.data.value ?? []).map((r) => ({ valor: r.codigo, rotulo: `${r.titulo} (${r.area})` })),
]);
const opcoesFormato = computed(() =>
  FORMATOS_EXPORTACAO.map((f) => ({ valor: f, rotulo: t(`relatorios.catalogo.formatos.${f}`) })),
);
</script>

<template>
  <section class="tela-agenda" aria-labelledby="catalogo-titulo" data-testid="tela-catalogo-relatorios">
    <h1 id="catalogo-titulo">{{ t('relatorios.catalogo.titulo') }}</h1>
    <p>{{ t('relatorios.catalogo.texto') }}</p>
    <nav class="filtros" :aria-label="t('relatorios.acoes')">
      <RouterLink to="/relatorios/triagem">{{ t('relatorios.catalogo.links.triagem') }}</RouterLink>
      <RouterLink to="/relatorios/pedidos">{{ t('relatorios.catalogo.links.pedidos') }}</RouterLink>
      <RouterLink to="/relatorios/agendamentos">{{ t('relatorios.catalogo.links.agendamentos') }}</RouterLink>
    </nav>
    <MensagemErro v-if="catalogo.isError.value" :erro="catalogo.error.value" />
    <p v-else-if="!catalogo.data.value" role="status">{{ t('relatorios.carregando') }}</p>
    <template v-else>
      <div class="filtros">
        <SanteSelecao
          v-model="escolhido"
          :rotulo="t('relatorios.catalogo.escolha')"
          :opcoes="opcoesRelatorio"
          data-testid="catalogo-relatorio"
        />
      </div>
      <article v-if="relatorio" class="painel" data-testid="catalogo-ficha">
        <h2>{{ relatorio.titulo }}</h2>
        <p>{{ relatorio.descricao }}</p>
        <dl>
          <dt>{{ t('relatorios.catalogo.area') }}</dt>
          <dd>{{ relatorio.area }} · {{ t('relatorios.catalogo.onda', { n: relatorio.onda }) }}</dd>
          <dt>{{ t('relatorios.catalogo.dono') }}</dt>
          <dd>{{ relatorio.papelDono }}</dd>
          <dt>{{ t('relatorios.catalogo.fonte') }}</dt>
          <dd>{{ t(`relatorios.catalogo.fontes.${relatorio.fonte}`) }}</dd>
          <template v-if="relatorio.regua">
            <dt>{{ t('relatorios.catalogo.regua') }}</dt>
            <dd>{{ t(`relatorios.catalogo.reguas.${relatorio.regua}`) }}</dd>
          </template>
          <dt>{{ t('relatorios.catalogo.formula') }}</dt>
          <dd>{{ relatorio.formula }}</dd>
          <dt>{{ t('relatorios.catalogo.conferencia') }}</dt>
          <dd>
            {{ t(`relatorios.catalogo.conferencias.${relatorio.conferencia.situacao}`) }} —
            {{ relatorio.conferencia.como }}
          </dd>
          <dt>
            {{
              t('relatorios.catalogo.limites', {
                linhas: relatorio.tetoLinhas,
                segundos: relatorio.tempoMaximoMs / 1000,
              })
            }}
          </dt>
          <dd></dd>
        </dl>
        <div v-if="!relatorio.liberado" role="alert" data-testid="catalogo-desligado">
          <SanteAlerta
            variante="aviso"
            :texto="`${t('relatorios.catalogo.desligado')}: ${relatorio.motivo ?? ''}`"
          />
        </div>
        <div v-else-if="!relatorio.podeExecutar" role="alert">
          <SanteAlerta variante="aviso" :texto="t('relatorios.catalogo.semPermissao')" />
        </div>
        <form v-else class="filtros" data-testid="catalogo-parametros" @submit.prevent="emitir">
          <fieldset>
            <legend>{{ t('relatorios.catalogo.parametros') }}</legend>
            <template v-for="p in relatorio.parametros" :key="p.campo">
              <SanteSelecao
                v-if="p.tipo === 'escolha'"
                :model-value="valores[p.campo] ?? ''"
                @update:model-value="(v: string) => (valores[p.campo] = v)"
                :rotulo="p.rotulo"
                :opcoes="(p.opcoes ?? []).map((o) => ({ valor: o.valor, rotulo: o.rotulo }))"
                :data-testid="`parametro-${p.campo}`"
              />
              <span v-else class="campo">
                <label :for="`param-${p.campo}`">{{ p.rotulo }}</label>
                <input
                  :id="`param-${p.campo}`"
                  v-model="valores[p.campo]"
                  :type="p.tipo === 'data' ? 'date' : p.tipo === 'mes' ? 'month' : 'number'"
                  :required="p.obrigatorio"
                  :min="p.minimo"
                  :max="p.maximo"
                  :data-testid="`parametro-${p.campo}`"
                />
              </span>
            </template>
          </fieldset>
          <p v-if="validacao" role="alert" class="secundario" data-testid="catalogo-validacao">
            {{ validacao }}
          </p>
          <SanteBotao
            tipo="submit"
            :rotulo="emitindo ? t('relatorios.catalogo.emitindo') : t('relatorios.catalogo.emitir')"
            :desabilitado="emitindo || validacao !== null"
            data-testid="catalogo-emitir"
          />
        </form>
      </article>
      <div v-if="recusa" role="alert" data-testid="catalogo-recusa">
        <SanteAlerta variante="alerta" :texto="t(recusa)" />
      </div>
      <MensagemErro v-else-if="erro" :erro="erro" />
      <section
        v-if="resultado && relatorio"
        class="painel"
        aria-labelledby="resultado-titulo"
        data-testid="catalogo-resultado"
      >
        <h2 id="resultado-titulo">{{ t('relatorios.catalogo.resultado') }}</h2>
        <p role="status">
          {{ t('relatorios.catalogo.linhas', { n: resultado.quantidade, ms: resultado.duracaoMs }) }}
          <template v-if="resultado.dadosAte">
            · {{ t('relatorios.catalogo.dadosAte', { texto: resultado.dadosAte }) }}</template
          >
        </p>
        <p v-if="resultado.mascarado" class="secundario" data-testid="catalogo-mascarado">
          {{ t('relatorios.catalogo.mascarado') }}
        </p>
        <table class="tabela" data-testid="catalogo-grade">
          <caption>
            {{
              relatorio.titulo
            }}
          </caption>
          <thead>
            <tr>
              <th v-for="c in resultado.colunas" :key="c.campo" scope="col">{{ c.rotulo }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in resultado.linhas" :key="i">
              <td v-for="c in resultado.colunas" :key="c.campo">{{ formatar(l[c.campo], c.tipo) }}</td>
            </tr>
          </tbody>
          <tfoot v-if="Object.keys(resultado.totais).length">
            <tr>
              <th v-for="(c, i) in resultado.colunas" :key="c.campo" scope="row">
                {{
                  i === 0
                    ? t('relatorios.catalogo.total')
                    : c.campo in resultado.totais
                      ? formatar(resultado.totais[c.campo], c.tipo)
                      : ''
                }}
              </th>
            </tr>
          </tfoot>
        </table>
        <form
          v-if="relatorio.podeExportar"
          class="filtros"
          data-testid="catalogo-exportar"
          @submit.prevent="exportar"
        >
          <SanteSelecao
            v-model="formato"
            :rotulo="t('relatorios.catalogo.formato')"
            :opcoes="opcoesFormato"
          />
          <SanteCampoTexto
            v-model="justificativa"
            :rotulo="t('relatorios.catalogo.justificativa')"
            :max-bytes="500"
            multilinha
            obrigatorio
            data-testid="catalogo-justificativa"
          />
          <SanteBotao
            tipo="submit"
            variante="secundario"
            :rotulo="t('relatorios.catalogo.exportar')"
            :desabilitado="justificativa.trim().length < 10"
            data-testid="catalogo-botao-exportar"
          />
        </form>
        <p v-if="exportado" role="status" data-testid="catalogo-exportado">
          {{ t('relatorios.catalogo.exportado') }}
        </p>
      </section>
      <details v-if="escolhido && execucoes.data.value?.length" data-testid="catalogo-historico">
        <summary>{{ t('relatorios.catalogo.historico') }}</summary>
        <ul>
          <li v-for="x in execucoes.data.value" :key="x.id">
            {{ x.criadoEm.slice(0, 16).replace('T', ' ') }} · {{ t(`relatorios.catalogo.tipos.${x.tipo}`) }}
            {{ x.formato }} · {{ x.usuario }} · {{ x.linhas }} ·
            {{ t(`relatorios.catalogo.situacoes.${x.situacao}`) }}
          </li>
        </ul>
      </details>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
