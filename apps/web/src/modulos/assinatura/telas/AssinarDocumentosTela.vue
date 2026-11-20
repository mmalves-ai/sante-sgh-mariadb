<script setup lang="ts">
// Assinar documento e assinar em lote (ficha do M49, seção 7; etapa 2): `/pep/assinaturas`. Os documentos emitidos
// pelo profissional que a política manda assinar com certificado ICP-Brasil (receita de controle especial e atestado
// primeiro), cada um com a prévia EXATA (o PDF/A com o selo, o rodapé legal e o QR; o hash mostrado é o do arquivo que
// será assinado, regra 4). Em lote: a prévia de cada um e UMA autorização no provedor (OAuth 2.0 com PKCE) ou um
// desafio no agente local (A1/A3). Pendente (verificação externa fora do ar, regra 5): a situação, a próxima tentativa
// e "tentar de novo"; os avisos ao autor e, para a direção técnica, as pendências do estabelecimento. Os assinados: o
// selo, o código do verificador e o PDF assinado para conferir fora do sistema (regra 8). A tela não promete o
// prontuário inteiro assinado (regra 11).
import {
  type DesafioAgenteLocal,
  MOTIVOS_RECUSA_ASSINATURA,
  MOTIVOS_VALIDACAO_ICP,
  type ItemPendenciaIcp,
  type PreviaIcp,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteDialogo, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import ErroAssinatura from '../componentes/ErroAssinatura.vue';
import {
  assinarNoAgente,
  enderecoPdfAssinado,
  enderecoPdfPrevia,
  gerarPrevia,
  lerFilaIcp,
  marcarAvisos,
  pedirAssinatura,
  prepararLote,
  reprocessarAssinatura,
  responderAgente,
} from '../api-assinatura.js';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const q = useQuery({ queryKey: ['assinatura', 'documentos'], queryFn: lerFilaIcp, staleTime: 0 });
const erro = ref<unknown>(null);
const aviso = ref<{ texto: string; variante: 'info' | 'alerta' } | null>(null);
const ocupado = ref(false);
const certificado = ref<number | null>(null);
const marcados = ref<number[]>([]);
const preparadas = ref<readonly PreviaIcp[]>([]);
const recusasPreparo = ref<readonly { documento: number; motivo: string }[]>([]);
const previa = ref<PreviaIcp | null>(null);
const previaCertificado = ref<number | null>(null);
const previaVisivel = computed({
  get: () => previa.value !== null,
  set: (v) => {
    if (!v) previa.value = null;
  },
});

const textoMotivo = (m: string | null | undefined) =>
  (m &&
    ((MOTIVOS_RECUSA_ASSINATURA as Record<string, string>)[m] ??
      (MOTIVOS_VALIDACAO_ICP as Record<string, string>)[m])) ||
  t('assinatura.nenhum');
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

const opcoesCertificado = computed(() =>
  (q.data.value?.certificados ?? []).map((c) => ({
    valor: c.id,
    rotulo: `${t(`assinatura.midias.${c.midia}`)}${c.provedor ? ` · ${c.provedor}` : ''} · ${c.serie}`,
  })),
);
watch(
  () => q.data.value?.certificados,
  (cs) => {
    if (cs?.length && !cs.some((c) => c.id === certificado.value)) certificado.value = cs[0]!.id;
  },
  { immediate: true },
);
const aAssinar = computed(() => (q.data.value?.itens ?? []).filter((i) => i.situacao === 'a-assinar'));
const titulos = computed(() => new Map((q.data.value?.itens ?? []).map((i) => [i.documento, i.titulo])));

onMounted(() => {
  const r = rota.query;
  if (r['finalidade'] === 'documento' && typeof r['resultado'] === 'string') {
    const n = (k: string) => Number(r[k] ?? 0) || 0;
    aviso.value =
      n('assinados') + n('pendentes') > 0
        ? {
            texto: t('assinatura.assinar.resultado', {
              assinados: n('assinados'),
              pendentes: n('pendentes'),
              recusados: n('recusados'),
            }),
            variante: n('recusados') || n('pendentes') ? 'alerta' : 'info',
          }
        : {
            texto: t('assinatura.assinar.voltaRecusada', { motivo: textoMotivo(String(r['motivo'] ?? '')) }),
            variante: 'alerta',
          };
    void roteador.replace({ path: rota.path });
  }
});

async function agir(fn: () => Promise<void>) {
  erro.value = null;
  ocupado.value = true;
  try {
    await fn();
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

const verPrevia = (i: ItemPendenciaIcp) =>
  agir(async () => {
    if (!certificado.value) return;
    previaCertificado.value = certificado.value;
    previa.value = await gerarPrevia(i.documento, certificado.value);
  });

/**
 * Assina o documento a partir da prévia conferida: o pedido leva o hash DESTA prévia (nenhuma prévia nova é gerada); se
 * ela tiver sido trocada no meio, o servidor recusa com "hash-divergente".
 */
const assinarDaPrevia = () => {
  const pv = previa.value;
  if (!pv || !previaCertificado.value) return;
  certificado.value = previaCertificado.value;
  preparadas.value = [pv];
  recusasPreparo.value = [];
  previa.value = null;
  return autorizar();
};

function todos(): void {
  marcados.value = aAssinar.value.map((i) => i.documento);
}

const preparar = () =>
  agir(async () => {
    if (!certificado.value || !marcados.value.length) return;
    aviso.value = { texto: t('assinatura.assinar.preparando'), variante: 'info' };
    const l = await prepararLote(marcados.value, certificado.value);
    preparadas.value = l.itens;
    recusasPreparo.value = l.recusados;
    aviso.value = { texto: t('assinatura.assinar.preparado', { n: l.itens.length }), variante: 'info' };
  });

const autorizar = () =>
  agir(async () => {
    if (!certificado.value || !preparadas.value.length) return;
    const p = await pedirAssinatura({
      documentos: preparadas.value.map((x) => x.documento),
      hashes: preparadas.value.map((x) => x.hash),
      certificado: certificado.value,
    });
    recusasPreparo.value = p.recusados;
    if (!p.inicio) {
      aviso.value = {
        texto: t('assinatura.assinar.voltaRecusada', { motivo: textoMotivo(p.recusados[0]?.motivo) }),
        variante: 'alerta',
      };
      return;
    }
    if (p.inicio.tipo === 'nuvem') {
      window.location.assign(p.inicio.endereco);
      return;
    }
    const endereco = q.data.value?.agenteLocal;
    if (!endereco) {
      aviso.value = { texto: t('assinatura.assinar.agenteAusente'), variante: 'alerta' };
      return;
    }
    let resp: Awaited<ReturnType<typeof assinarNoAgente>>;
    try {
      resp = await assinarNoAgente(endereco, p.inicio as DesafioAgenteLocal);
    } catch {
      aviso.value = { texto: t('assinatura.assinar.agenteAusente'), variante: 'alerta' };
      return;
    }
    const r = await responderAgente({ desafio: p.inicio.desafio, ...resp });
    aviso.value = {
      texto: t('assinatura.assinar.resultado', {
        assinados: r.lote?.assinados ?? 0,
        pendentes: r.lote?.pendentes ?? 0,
        recusados: r.lote?.recusados ?? 0,
      }),
      variante: r.ok ? 'info' : 'alerta',
    };
    preparadas.value = [];
    marcados.value = [];
    await q.refetch();
  });

const reprocessar = (assinatura: number, direcaoTecnica = false) =>
  agir(async () => {
    const r = await reprocessarAssinatura(assinatura, direcaoTecnica);
    aviso.value = {
      texto: t('assinatura.assinar.reprocessado', { estado: t(`assinatura.estados.${r.estado}`) }),
      variante: r.estado === 'assinada' ? 'info' : 'alerta',
    };
    await q.refetch();
  });

const lerAvisos = (ids: readonly number[], direcaoTecnica = false) =>
  agir(async () => {
    await marcarAvisos(ids, direcaoTecnica);
    await q.refetch();
  });

const falha = (f: string | null) => (f ? t(`assinatura.falhas.${f}`) : '—');
</script>

<template>
  <section class="tela-assinatura" aria-labelledby="docs-titulo" data-testid="tela-assinar-documentos">
    <h1 id="docs-titulo">{{ t('assinatura.assinar.titulo') }}</h1>
    <p>{{ t('assinatura.assinar.subtitulo') }}</p>
    <SanteAlerta
      v-if="aviso"
      :texto="aviso.texto"
      :variante="aviso.variante"
      anunciar
      data-testid="docs-aviso"
    />
    <ErroAssinatura v-if="erro || q.error.value" :erro="erro ?? q.error.value" />
    <p v-if="q.isLoading.value" role="status">{{ t('assinatura.carregando') }}</p>
    <template v-if="q.data.value">
      <SanteAlerta
        v-if="q.data.value.modo === 'simulador'"
        :texto="t('assinatura.assinar.simulador')"
        variante="aviso"
        data-testid="docs-simulador"
      />
      <SanteAlerta
        v-if="!q.data.value.liberada"
        :texto="`${t('assinatura.assinar.desligada')} ${q.data.value.motivoDesligada ?? ''} ${t('assinatura.assinar.papel')}`"
        variante="aviso"
        data-testid="docs-desligada"
      />
      <p class="secundario" data-testid="docs-concessao">{{ t('assinatura.assinar.concessao') }}</p>
      <p class="secundario">{{ t('assinatura.assinar.semIcpExplicacao') }}</p>

      <div class="bloco">
        <SanteAlerta
          v-if="!q.data.value.certificados.length"
          :texto="t('assinatura.assinar.semCertificado')"
          variante="aviso"
          data-testid="docs-sem-certificado"
        />
        <SanteSelecao
          v-else
          v-model="certificado"
          :rotulo="t('assinatura.assinar.certificado')"
          :opcoes="opcoesCertificado"
          data-testid="docs-certificado"
        />
        <RouterLink to="/conta/certificado">{{ t('assinatura.assinar.meuCertificado') }}</RouterLink>
      </div>

      <SanteAlerta v-if="!q.data.value.itens.length" variante="info" :texto="t('assinatura.assinar.vazio')" />
      <template v-else>
        <p role="status" data-testid="docs-total">
          {{ t('assinatura.assinar.total', { n: aAssinar.length }) }}
        </p>
        <SanteAlerta v-if="q.data.value.limitado" variante="info" :texto="t('assinatura.assinar.limitado')" />
        <SanteBotao
          variante="texto"
          :rotulo="t('assinatura.assinar.selecionarTodos')"
          :desabilitado="!aAssinar.length"
          data-testid="docs-todos"
          @acionar="todos"
        />
        <table class="tabela" data-testid="docs-lista">
          <caption class="secundario">
            {{
              t('assinatura.assinar.titulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span class="sr-only">{{ t('assinatura.assinar.selecionarTodos') }}</span>
              </th>
              <th scope="col">{{ t('assinatura.assinar.colunaDocumento') }}</th>
              <th scope="col">{{ t('assinatura.assinar.colunaPaciente') }}</th>
              <th scope="col">{{ t('assinatura.assinar.colunaEmitido') }}</th>
              <th scope="col">{{ t('assinatura.assinar.colunaExigido') }}</th>
              <th scope="col">{{ t('assinatura.assinar.colunaSituacao') }}</th>
              <th scope="col">{{ t('assinatura.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in q.data.value.itens" :key="i.documento" :data-testid="`doc-${i.documento}`">
              <td>
                <input
                  v-if="i.situacao === 'a-assinar'"
                  v-model="marcados"
                  type="checkbox"
                  :value="i.documento"
                  :aria-label="t('assinatura.assinar.selecionar', { titulo: i.titulo, nome: i.nome })"
                  :data-testid="`doc-marcar-${i.documento}`"
                />
              </td>
              <td>{{ i.titulo }}</td>
              <td>{{ i.nome }}</td>
              <td>{{ data(i.emitidoEm) }}</td>
              <td>
                {{
                  t('assinatura.assinar.exigencia', {
                    nivel: t(`assinatura.niveis.${i.exigencia.nivel}`),
                    politica: i.exigencia.politicaIcp
                      ? t(`assinatura.politicas.${i.exigencia.politicaIcp}`)
                      : '—',
                  })
                }}
              </td>
              <td :data-testid="`doc-situacao-${i.documento}`">
                {{ t(`assinatura.assinar.situacoes.${i.situacao}`) }}
                <span v-if="i.situacao !== 'a-assinar'" class="secundario">
                  · {{ falha(i.falha) }}
                  <template v-if="i.proximaTentativaEm">
                    ·
                    {{
                      t('assinatura.assinar.tentativas', {
                        n: i.tentativas,
                        quando: data(i.proximaTentativaEm),
                      })
                    }}
                  </template>
                </span>
              </td>
              <td>
                <SanteBotao
                  v-if="i.situacao === 'a-assinar'"
                  variante="texto"
                  :rotulo="t('assinatura.assinar.gerarPrevia')"
                  :desabilitado="!certificado || !q.data.value.liberada || ocupado"
                  :data-testid="`doc-previa-${i.documento}`"
                  @acionar="verPrevia(i)"
                />
                <SanteBotao
                  v-else-if="i.assinatura"
                  variante="texto"
                  :rotulo="t('assinatura.assinar.reprocessar')"
                  :desabilitado="ocupado"
                  :data-testid="`doc-reprocessar-${i.documento}`"
                  @acionar="reprocessar(i.assinatura)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p class="secundario">{{ t('assinatura.assinar.autorizarProvedor') }}</p>
        <SanteBotao
          :rotulo="t('assinatura.assinar.preparar', { n: marcados.length })"
          :desabilitado="!marcados.length || !certificado || !q.data.value.liberada || ocupado"
          data-testid="docs-preparar"
          @acionar="preparar"
        />
      </template>

      <section v-if="preparadas.length || recusasPreparo.length" class="bloco" data-testid="docs-preparadas">
        <h2>{{ t('assinatura.assinar.previaExata') }}</h2>
        <ul>
          <li v-for="p in preparadas" :key="p.documento" :data-testid="`preparada-${p.documento}`">
            <strong>{{ titulos.get(p.documento) ?? p.titulo }}</strong> ·
            <a :href="enderecoPdfPrevia(p.documento)" target="_blank" rel="noopener">{{
              t('assinatura.assinar.abrirPdf')
            }}</a>
            <div class="secundario hash">{{ t('assinatura.assinar.hashPrevia', { hash: p.hash }) }}</div>
          </li>
        </ul>
        <SanteAlerta
          v-for="r in recusasPreparo"
          :key="r.documento"
          variante="alerta"
          :texto="
            t('assinatura.assinar.resultadoRecusa', {
              documento: titulos.get(r.documento) ?? r.documento,
              motivo: textoMotivo(r.motivo),
            })
          "
        />
        <SanteBotao
          v-if="preparadas.length"
          :rotulo="t('assinatura.assinar.autorizar', { n: preparadas.length })"
          :desabilitado="ocupado"
          data-testid="docs-autorizar"
          @acionar="autorizar"
        />
      </section>

      <section v-if="q.data.value.avisos.length" class="bloco" data-testid="docs-avisos">
        <h2>{{ t('assinatura.assinar.avisosTitulo') }}</h2>
        <p class="secundario">{{ t('assinatura.assinar.pendenteExplicacao') }}</p>
        <ul>
          <li v-for="v in q.data.value.avisos" :key="v.id">
            {{
              t('assinatura.assinar.aviso', {
                titulo: (v.documento && titulos.get(v.documento)) || t('assinatura.assinar.colunaDocumento'),
                estado: t(`assinatura.estados.${v.estado}`),
                falha: falha(v.falha),
              })
            }}
          </li>
        </ul>
        <SanteBotao
          variante="texto"
          :rotulo="t('assinatura.assinar.marcarLido')"
          data-testid="docs-avisos-lidos"
          @acionar="lerAvisos(q.data.value.avisos.map((v) => v.id))"
        />
      </section>

      <section v-if="q.data.value.assinados.length" class="bloco" data-testid="docs-assinados">
        <h2>{{ t('assinatura.assinar.assinadosTitulo') }}</h2>
        <p class="secundario">{{ t('assinatura.assinar.baixarAjuda') }}</p>
        <ul>
          <li
            v-for="a in q.data.value.assinados"
            :key="a.assinatura"
            :data-testid="`assinado-${a.documento}`"
          >
            <span class="selo">{{ t('assinatura.assinar.selo') }}</span>
            <strong>{{ a.titulo }}</strong> · {{ a.nome }} · {{ data(a.assinadoEm) }} ·
            {{ t(`assinatura.politicas.${a.politicaIcp}`) }}
            <span v-if="a.resultado"> · {{ t(`assinatura.resultados.${a.resultado}`) }}</span>
            <div class="secundario">
              {{ t('assinatura.assinar.codigoVerificacao', { codigo: a.codigo }) }}
            </div>
            <a :href="enderecoPdfAssinado(a.assinatura)" :data-testid="`baixar-${a.documento}`" download>{{
              t('assinatura.assinar.baixarAssinado')
            }}</a>
          </li>
        </ul>
      </section>

      <section
        v-if="q.data.value.estabelecimento"
        class="bloco"
        aria-labelledby="dt-titulo"
        data-testid="docs-estabelecimento"
      >
        <h2 id="dt-titulo">{{ t('assinatura.assinar.estabelecimentoTitulo') }}</h2>
        <p role="status">
          {{
            t('assinatura.assinar.estabelecimentoResumo', {
              pendentes: q.data.value.estabelecimento.pendentes,
              falhas: q.data.value.estabelecimento.falhas,
            })
          }}
        </p>
        <ul>
          <li
            v-for="v in q.data.value.estabelecimento.avisos"
            :key="v.id"
            :data-testid="`dt-aviso-${v.assinatura}`"
          >
            {{
              t('assinatura.assinar.avisoDoAutor', {
                autor: v.autor ?? '—',
                estado: t(`assinatura.estados.${v.estado}`),
                falha: falha(v.falha),
              })
            }}
            <SanteBotao
              variante="texto"
              :rotulo="t('assinatura.assinar.reprocessar')"
              :desabilitado="ocupado"
              :data-testid="`dt-reprocessar-${v.assinatura}`"
              @acionar="reprocessar(v.assinatura, true)"
            />
          </li>
        </ul>
        <SanteBotao
          v-if="q.data.value.estabelecimento.avisos.length"
          variante="texto"
          :rotulo="t('assinatura.assinar.marcarLido')"
          data-testid="dt-avisos-lidos"
          @acionar="
            lerAvisos(
              q.data.value.estabelecimento.avisos.map((v) => v.id),
              true,
            )
          "
        />
      </section>
    </template>

    <SanteDialogo
      v-model:visivel="previaVisivel"
      :titulo="previa?.titulo ?? t('assinatura.assinar.previa')"
      largura="56rem"
    >
      <article v-if="previa" data-testid="docs-previa">
        <p>{{ t('assinatura.assinar.previaExata') }}</p>
        <iframe
          :src="enderecoPdfPrevia(previa.documento)"
          :title="t('assinatura.assinar.previa')"
          class="pdf"
        ></iframe>
        <p class="secundario hash" data-testid="docs-previa-hash">
          {{ t('assinatura.assinar.hashPrevia', { hash: previa.hash }) }}
        </p>
        <p class="secundario">{{ t('assinatura.assinar.codigoVerificacao', { codigo: previa.codigo }) }}</p>
        <p class="secundario">{{ t('assinatura.assinar.autorizarProvedor') }}</p>
        <SanteBotao
          :rotulo="t('assinatura.assinar.assinarEste')"
          :desabilitado="ocupado || !q.data.value?.liberada"
          data-testid="docs-previa-assinar"
          @acionar="assinarDaPrevia"
        />
      </article>
    </SanteDialogo>
  </section>
</template>

<style src="../estilo-assinatura.css"></style>
<style scoped>
.hash {
  overflow-wrap: anywhere;
  font-family: var(--sgh-fonte-mono, monospace);
}
.pdf {
  width: 100%;
  height: 60vh;
  border: 1px solid var(--p-content-border-color);
}
.selo {
  display: inline-block;
  margin-right: 0.5rem;
  padding: 0 0.5rem;
  border: 1px solid currentColor;
  border-radius: 0.25rem;
  font-weight: 600;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
