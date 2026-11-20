<script setup lang="ts">
// Custo por procedimento e por paciente (M54, etapa 5; item `Controladoria > Custos hospitalares > Custo por
// procedimento e por paciente`; `custos.apuracao.ler` / `custos.apuracao.apurar`, `custos.apuracao.aprovar`,
// `custos.apuracao.exportar`): a competência; os bloqueios da estrutura; apurar (com o limite da linha atípica e, para
// refazer a aprovada, a justificativa); a apuração vigente com a completude (parcial sem pessoal), a conservação com as
// parcelas, o custo por centro e as pendências; aprovar pela versão lida; o relatório em PDF/A; a exportação da aprovada
// (só gerada, baixada aqui); o histórico da competência. As ações aparecem só com a permissão e a liberação; o
// servidor confere de novo.
import {
  type ApuracaoCustos,
  type ArquivoExportacaoCustos,
  type DestinoExportacaoCustos,
  LIMITE_LINHA_SAIDA_PADRAO_CENTAVOS,
  ROTULOS_SITUACAO_APURACAO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  aprovarApuracao,
  apurarCustos,
  baixarArquivo,
  exportarCustos,
  lerApoioApuracao,
  lerPainelApuracao,
  lerRelatorioCustos,
} from './api-apuracao.js';
import { conservacao, dataHora, lerReais, reais, somaEmReais } from './comum-apuracao.js';
import { competenciasAte, rotuloCompetencia } from './comum-custos.js';
import ErroCustos from './ErroCustos.vue';
import TabelaCentrosApuracao from './TabelaCentrosApuracao.vue';

const props = defineProps<{ hoje?: string }>();
const { t } = useI18n();
const cliente = useQueryClient();
const hoje = props.hoje ?? new Date().toISOString().slice(0, 10);

const apoio = useQuery({ queryKey: ['custos', 'apuracao', 'apoio'], queryFn: lerApoioApuracao });
const a = computed(() => apoio.data.value ?? null);
const competencias = competenciasAte(hoje, 36);
const competencia = ref<string>(competencias[1] ?? competencias[0]!);
const opcoesCompetencia = competencias.map((c) => ({ valor: c, rotulo: rotuloCompetencia(c) }));

const painel = useQuery({
  queryKey: computed(() => ['custos', 'apuracao', competencia.value]),
  queryFn: () => lerPainelApuracao(competencia.value),
});
const p = computed(() => painel.data.value ?? null);
const vigente = computed<ApuracaoCustos | null>(() => p.value?.apuracao ?? null);
const ligada = computed(() => a.value?.liberacao.ligada ?? false);
const podeApurar = computed(() => !!a.value?.acoes.apurar && ligada.value);
const podeAprovar = computed(() => !!a.value?.acoes.aprovar && ligada.value);
const podeExportar = computed(() => !!a.value?.acoes.exportar && ligada.value);
const aviso = computed(() => {
  const x = a.value;
  if (!x) return null;
  if (!x.liberacao.ligada) return t('custos.apuracao.desligada');
  if (!x.acoes.apurar && !x.acoes.aprovar && !x.acoes.exportar) return t('custos.apuracao.semPermissao');
  return null;
});
const cons = computed(() => (vigente.value ? conservacao(vigente.value.totais) : null));

// ── Mensagens e erro ──────────────────────────────────────────────────────────────────────────────────────────────
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
watch(competencia, () => {
  erro.value = null;
  feito.value = null;
  arquivo.value = null;
  justificativa.value = '';
});
async function recarregar(): Promise<void> {
  await cliente.invalidateQueries({ queryKey: ['custos', 'apuracao', competencia.value] });
  await cliente.invalidateQueries({ queryKey: ['custos', 'resultado'] });
}

// ── Apurar ────────────────────────────────────────────────────────────────────────────────────────────────────────
const limite = ref(
  reais(a.value?.limiteLinhaSaidaPadrao ?? LIMITE_LINHA_SAIDA_PADRAO_CENTAVOS).replace('R$ ', ''),
);
const limiteCent = computed(() => lerReais(limite.value));
const limiteInvalido = computed(() => limiteCent.value === null || limiteCent.value < 100);
const justificativa = ref('');
const refazAprovada = computed(() => vigente.value?.situacao === 'aprovada');
const justificativaOk = computed(() => !refazAprovada.value || justificativa.value.trim().length >= 10);
const apurando = ref(false);
async function apurar(): Promise<void> {
  if (limiteInvalido.value || !justificativaOk.value) return;
  apurando.value = true;
  erro.value = null;
  feito.value = null;
  arquivo.value = null;
  try {
    const r = await apurarCustos({
      competencia: competencia.value,
      limiteLinhaSaida: limiteCent.value!,
      justificativa: refazAprovada.value ? justificativa.value.trim() : null,
    });
    feito.value = t('custos.apuracao.apurar.apurada', {
      segundos: (r.duracaoMs / 1000).toFixed(1).replace('.', ','),
      centros: r.linhas.length,
      contas: r.totais.contas,
    });
    justificativa.value = '';
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    apurando.value = false;
  }
}

// ── Aprovar ───────────────────────────────────────────────────────────────────────────────────────────────────────
const aprovando = ref(false);
async function aprovar(): Promise<void> {
  const v = vigente.value;
  if (!v) return;
  aprovando.value = true;
  erro.value = null;
  feito.value = null;
  try {
    await aprovarApuracao(v.id, v.versao);
    feito.value = t('custos.apuracao.aprovar.aprovada', { competencia: rotuloCompetencia(v.competencia) });
    await recarregar();
  } catch (x) {
    erro.value = x;
  } finally {
    aprovando.value = false;
  }
}

// ── Relatório (PDF/A) ─────────────────────────────────────────────────────────────────────────────────────────────
const gerandoRelatorio = ref(false);
async function relatorio(): Promise<void> {
  gerandoRelatorio.value = true;
  erro.value = null;
  try {
    const b = await lerRelatorioCustos(competencia.value);
    const pdf = b.type.startsWith('application/pdf');
    baixarArquivo(b, `relatorio-custos-${competencia.value}.${pdf ? 'pdf' : 'html'}`);
  } catch (x) {
    erro.value = x;
  } finally {
    gerandoRelatorio.value = false;
  }
}

// ── Exportação ────────────────────────────────────────────────────────────────────────────────────────────────────
const opcoesDestino = computed(() =>
  (a.value?.destinos ?? []).filter((d) => d.ativo).map((d) => ({ valor: d.valor, rotulo: d.rotulo })),
);
const destino = ref<DestinoExportacaoCustos | null>(null);
watch(
  opcoesDestino,
  (o) => {
    if (!destino.value || !o.some((x) => x.valor === destino.value)) destino.value = o[0]?.valor ?? null;
  },
  { immediate: true },
);
const exportando = ref(false);
const arquivo = ref<ArquivoExportacaoCustos | null>(null);
const nomes = computed(
  () => new Map((vigente.value?.linhas ?? []).map((l) => [l.centro, `${l.codigo} ${l.nome}`])),
);
async function exportar(): Promise<void> {
  if (!destino.value) return;
  exportando.value = true;
  erro.value = null;
  arquivo.value = null;
  try {
    arquivo.value = await exportarCustos(competencia.value, destino.value);
  } catch (x) {
    erro.value = x;
  } finally {
    exportando.value = false;
  }
}
function baixarExportacao(): void {
  const x = arquivo.value;
  if (!x) return;
  baixarArquivo(new Blob([x.conteudo], { type: 'text/csv;charset=utf-8' }), x.nomeArquivo);
}
</script>

<template>
  <section class="tela-custos" aria-labelledby="apuracao-titulo" data-testid="tela-apuracao-custos">
    <h1 id="apuracao-titulo">{{ t('custos.apuracao.titulo') }}</h1>
    <p>{{ t('custos.apuracao.subtitulo') }}</p>
    <ErroCustos v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('custos.apuracao.carregando') }}</p>
    <template v-else>
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" data-testid="apuracao-aviso" />
      <div class="campos">
        <SanteSelecao
          v-model="competencia"
          :rotulo="t('custos.apuracao.competencia')"
          :opcoes="opcoesCompetencia"
          busca
          data-testid="apuracao-competencia"
        />
      </div>
      <div class="acoes">
        <RouterLink to="/custos/centros">{{ t('custos.apuracao.irEstrutura') }}</RouterLink>
        <RouterLink v-if="a.acoes.resultado" to="/custos/resultado">{{
          t('custos.apuracao.irResultado')
        }}</RouterLink>
      </div>

      <ErroCustos v-if="painel.isError.value" :erro="painel.error.value" />
      <p v-else-if="!p" role="status">{{ t('custos.apuracao.carregando') }}</p>
      <template v-else>
        <section
          v-if="p.bloqueios.length"
          class="bloco"
          :aria-label="t('custos.apuracao.bloqueios')"
          data-testid="apuracao-bloqueios"
        >
          <h2>{{ t('custos.apuracao.bloqueios') }}</h2>
          <SanteAlerta v-for="(b, i) in p.bloqueios" :key="i" :texto="b.mensagem" variante="aviso" />
        </section>

        <ErroCustos v-if="erro" :erro="erro" />
        <SanteAlerta v-if="feito" :texto="feito" variante="info" anunciar data-testid="apuracao-feito" />

        <form
          v-if="podeApurar"
          class="bloco"
          :aria-label="t('custos.apuracao.apurar.titulo')"
          data-testid="apuracao-form-apurar"
          @submit.prevent="apurar"
        >
          <h2>{{ t('custos.apuracao.apurar.titulo') }}</h2>
          <div class="campos">
            <label class="campo-numero">
              <span>{{ t('custos.apuracao.apurar.limite') }}</span>
              <input
                v-model="limite"
                inputmode="decimal"
                maxlength="20"
                required
                :aria-invalid="limiteInvalido"
                aria-describedby="apuracao-limite-ajuda"
                data-testid="apuracao-limite"
              />
              <span id="apuracao-limite-ajuda" class="secundario">{{
                t('custos.apuracao.apurar.limiteAjuda')
              }}</span>
              <span v-if="limiteInvalido" class="secundario" role="alert">{{
                t('custos.apuracao.apurar.limiteInvalido')
              }}</span>
            </label>
          </div>
          <template v-if="refazAprovada">
            <SanteCampoTexto
              v-model="justificativa"
              :rotulo="t('custos.apuracao.apurar.justificativa')"
              :max-bytes="400"
              multilinha
              obrigatorio
              data-testid="apuracao-justificativa"
            />
            <p class="secundario">{{ t('custos.apuracao.apurar.justificativaAjuda') }}</p>
          </template>
          <div class="acoes">
            <SanteBotao
              tipo="submit"
              :rotulo="
                apurando
                  ? t('custos.apuracao.apurar.apurando')
                  : vigente
                    ? t('custos.apuracao.apurar.reapurar')
                    : t('custos.apuracao.apurar.botao', { competencia: rotuloCompetencia(competencia) })
              "
              :desabilitado="apurando || limiteInvalido || !justificativaOk || p.bloqueios.length > 0"
              data-testid="apuracao-apurar"
            />
          </div>
        </form>

        <p v-if="!vigente" data-testid="apuracao-nao-apurada">
          {{ t('custos.apuracao.naoApurada', { competencia: rotuloCompetencia(competencia) }) }}
        </p>
        <template v-else>
          <section
            class="bloco"
            :aria-label="t('custos.apuracao.resumo.titulo')"
            data-testid="apuracao-resumo"
          >
            <h2>{{ t('custos.apuracao.resumo.titulo') }}</h2>
            <SanteAlerta
              v-if="vigente.completude.parcial && vigente.completude.rotulo"
              :texto="t('custos.apuracao.resumo.parcial', { rotulo: vigente.completude.rotulo })"
              variante="aviso"
              data-testid="apuracao-parcial"
            />
            <dl class="dados">
              <dt>{{ t('custos.apuracao.resumo.situacao') }}</dt>
              <dd data-testid="apuracao-situacao">{{ ROTULOS_SITUACAO_APURACAO[vigente.situacao] }}</dd>
              <dt>{{ t('custos.apuracao.resumo.versao') }}</dt>
              <dd>{{ vigente.versao }}</dd>
              <dt>{{ t('custos.apuracao.resumo.completude') }}</dt>
              <dd>{{ vigente.completude.rotulo ?? t('custos.apuracao.resumo.completa') }}</dd>
              <dt>{{ t('custos.apuracao.resumo.fontes') }}</dt>
              <dd>
                <ul>
                  <li v-for="f in vigente.completude.fontes" :key="f.fonte">
                    {{ f.fonte }}:
                    {{
                      f.presente ? t('custos.apuracao.resumo.presente') : t('custos.apuracao.resumo.ausente')
                    }}
                    ({{ f.detalhe }})
                  </li>
                </ul>
              </dd>
              <dt>{{ t('custos.apuracao.resumo.impressao') }}</dt>
              <dd class="impressao" data-testid="apuracao-impressao">{{ vigente.impressao }}</dd>
            </dl>
            <p>
              {{
                t('custos.apuracao.resumo.apuradaPor', {
                  quem: vigente.apuradaPor,
                  quando: dataHora(vigente.apuradaEm),
                })
              }}
            </p>
            <p v-if="vigente.aprovadaPor">
              {{
                t('custos.apuracao.resumo.aprovadaPor', {
                  quem: vigente.aprovadaPor,
                  quando: dataHora(vigente.aprovadaEm ?? ''),
                })
              }}
            </p>
            <p v-if="vigente.justificativa">
              {{ t('custos.apuracao.resumo.justificativa', { texto: vigente.justificativa }) }}
            </p>
            <div class="acoes">
              <SanteBotao
                v-if="podeAprovar && vigente.situacao === 'apurada'"
                :rotulo="t('custos.apuracao.aprovar.botao')"
                :desabilitado="aprovando"
                data-testid="apuracao-aprovar"
                @acionar="aprovar"
              />
              <SanteBotao
                :rotulo="
                  gerandoRelatorio
                    ? t('custos.apuracao.relatorio.gerando')
                    : t('custos.apuracao.relatorio.botao')
                "
                variante="secundario"
                :desabilitado="gerandoRelatorio"
                data-testid="apuracao-relatorio"
                @acionar="relatorio"
              />
            </div>
          </section>

          <section
            v-if="cons"
            class="bloco"
            :aria-label="t('custos.apuracao.conservacao.titulo')"
            data-testid="apuracao-conservacao"
          >
            <h2>{{ t('custos.apuracao.conservacao.titulo') }}</h2>
            <p class="conta">
              {{ t('custos.apuracao.conservacao.lido', { conta: somaEmReais(cons.lidas) }) }}
            </p>
            <p class="conta">
              {{ t('custos.apuracao.conservacao.destino', { conta: somaEmReais(cons.destinos) }) }}
            </p>
            <p :class="{ total: true }" data-testid="apuracao-fecha">
              {{
                cons.fecha
                  ? t('custos.apuracao.conservacao.fecha')
                  : t('custos.apuracao.conservacao.naoFecha')
              }}
            </p>
            <p>{{ t('custos.apuracao.conservacao.fora', { valor: reais(vigente.totais.foraDoCusteio) }) }}</p>
            <p>
              {{
                t('custos.apuracao.conservacao.atipicas', {
                  limite: reais(vigente.limiteLinhaSaida),
                  linhas: vigente.totais.atipicas.linhas,
                  valor: reais(vigente.totais.atipicas.centavos),
                })
              }}
            </p>
            <p>
              {{
                t('custos.apuracao.conservacao.devolucoes', {
                  linhas: vigente.totais.devolucoes?.linhas ?? 0,
                  valor: reais(vigente.totais.devolucoes?.centavos ?? 0),
                  linhasAtipicas: vigente.totais.devolucoes?.linhasAtipicas ?? 0,
                  valorAtipicas: reais(vigente.totais.devolucoes?.centavosAtipicas ?? 0),
                })
              }}
            </p>
            <p class="conta">
              {{
                t('custos.apuracao.conservacao.contas', {
                  contas: vigente.totais.contas,
                  bruta: reais(vigente.totais.receitaBruta),
                  liquida: reais(vigente.totais.receitaLiquida),
                  nasContas: reais(vigente.totais.custoNasContas),
                  semConta: reais(vigente.totais.custoSemConta),
                  total: reais(vigente.totais.custoNasContas + vigente.totais.custoSemConta),
                })
              }}
            </p>
          </section>

          <TabelaCentrosApuracao :linhas="vigente.linhas" />

          <section
            class="bloco"
            :aria-label="t('custos.apuracao.pendencias.titulo')"
            data-testid="apuracao-pendencias"
          >
            <h2>{{ t('custos.apuracao.pendencias.titulo') }}</h2>
            <p v-if="vigente.pendencias.length === 0">{{ t('custos.apuracao.pendencias.nenhuma') }}</p>
            <ul v-else>
              <li v-for="(x, i) in vigente.pendencias" :key="i" :data-testid="`apuracao-pendencia-${x.tipo}`">
                {{ x.mensagem }}
                <template v-if="x.centavos">({{ reais(x.centavos) }})</template>
                <template v-if="x.centros.length">
                  · {{ x.centros.map((c) => nomes.get(c) ?? String(c)).join(', ') }}
                </template>
              </li>
            </ul>
          </section>

          <section
            class="bloco"
            :aria-label="t('custos.apuracao.exportar.titulo')"
            data-testid="apuracao-exportacao"
          >
            <h2>{{ t('custos.apuracao.exportar.titulo') }}</h2>
            <p class="secundario">{{ t('custos.apuracao.exportar.ajuda') }}</p>
            <p v-if="vigente.situacao !== 'aprovada'">{{ t('custos.apuracao.exportar.soAprovada') }}</p>
            <template v-else-if="podeExportar">
              <div class="campos">
                <SanteSelecao
                  v-model="destino"
                  :rotulo="t('custos.apuracao.exportar.destino')"
                  :opcoes="opcoesDestino"
                  data-testid="apuracao-destino"
                />
              </div>
              <div class="acoes">
                <SanteBotao
                  :rotulo="
                    exportando ? t('custos.apuracao.exportar.gerando') : t('custos.apuracao.exportar.gerar')
                  "
                  :desabilitado="exportando || !destino"
                  data-testid="apuracao-exportar"
                  @acionar="exportar"
                />
              </div>
              <template v-if="arquivo">
                <SanteAlerta
                  :texto="
                    t('custos.apuracao.exportar.gerado', {
                      nome: arquivo.nomeArquivo,
                      linhas: arquivo.linhas,
                      sha: arquivo.sha256,
                    })
                  "
                  variante="info"
                  anunciar
                  data-testid="apuracao-arquivo"
                />
                <SanteAlerta
                  v-if="arquivo.semCodigo.length"
                  :texto="
                    t('custos.apuracao.exportar.semCodigo', {
                      n: arquivo.semCodigo.length,
                      centros: arquivo.semCodigo.map((c) => nomes.get(c) ?? String(c)).join(', '),
                    })
                  "
                  variante="aviso"
                  data-testid="apuracao-sem-codigo"
                />
                <SanteAlerta v-for="(x, i) in arquivo.avisos" :key="i" :texto="x" variante="aviso" />
                <div class="acoes">
                  <SanteBotao
                    :rotulo="t('custos.apuracao.exportar.baixar', { nome: arquivo.nomeArquivo })"
                    variante="secundario"
                    data-testid="apuracao-baixar"
                    @acionar="baixarExportacao"
                  />
                </div>
              </template>
            </template>
          </section>
        </template>

        <section
          v-if="p.historico.length"
          class="bloco"
          :aria-label="t('custos.apuracao.historico.titulo')"
          data-testid="apuracao-historico"
        >
          <h2>{{ t('custos.apuracao.historico.titulo') }}</h2>
          <div class="rolagem">
            <table class="tabela">
              <thead>
                <tr>
                  <th scope="col">{{ t('custos.apuracao.historico.colunas.situacao') }}</th>
                  <th scope="col" class="numero">{{ t('custos.apuracao.historico.colunas.custo') }}</th>
                  <th scope="col">{{ t('custos.apuracao.historico.colunas.completude') }}</th>
                  <th scope="col">{{ t('custos.apuracao.historico.colunas.apurada') }}</th>
                  <th scope="col">{{ t('custos.apuracao.historico.colunas.aprovada') }}</th>
                  <th scope="col">{{ t('custos.apuracao.historico.colunas.impressao') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="h in p.historico" :key="h.id">
                  <td>{{ ROTULOS_SITUACAO_APURACAO[h.situacao] }}</td>
                  <td class="numero">{{ reais(h.custoFinalProdutivos) }}</td>
                  <td>{{ h.rotuloParcial ?? t('custos.apuracao.resumo.completa') }}</td>
                  <td>{{ h.apuradaPor }} · {{ dataHora(h.apuradaEm) }}</td>
                  <td>{{ h.aprovadaPor ? `${h.aprovadaPor} · ${dataHora(h.aprovadaEm ?? '')}` : '—' }}</td>
                  <td class="impressao">{{ h.impressao.slice(0, 12) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped src="./estilo-custos.css"></style>
