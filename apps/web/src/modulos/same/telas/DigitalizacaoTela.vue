<script setup lang="ts">
// Digitalização certificada (ficha do M50, seção 7; regra 12; Lei 13.787/2018): `/same/digitalizacao`. A captura do papel
// (o prontuário e a internação, o tipo documental, a descrição, a data, as páginas, a resolução e a cor; o PDF do escâner
// com o SHA-256 calculado aqui e recalculado no servidor), a fila por situação com as contagens, o PDF guardado, a
// conferência da fidelidade por outra pessoa (fiel ou recusado com o motivo) e a assinatura ICP-Brasil de quem conferiu
// (um ou o lote: o provedor em nuvem ou o agente local), com o carimbo do tempo. O papel nunca é eliminado por aqui.
import {
  CORES_DIGITALIZACAO,
  type CorDigitalizacao,
  type DesafioAgenteLocal,
  type DigitalizacaoLida,
  SITUACOES_DIGITALIZACAO,
  type SituacaoDigitalizacao,
  TIPOS_DOCUMENTO_DIGITALIZADO,
  type TipoDocumentoDigitalizado,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { assinarNoAgente, lerMeuCertificado, responderAgente } from '../../assinatura/api-assinatura.js';
import ErroDigitalizacao from '../componentes/ErroDigitalizacao.vue';
import {
  conferir,
  digitalizar,
  enderecoArquivo,
  lerArquivo,
  lerFilaDigitalizacao,
  lerGravacaoDigitalizacao,
  lerPacienteDigitalizacao,
  novaChaveDigitalizacao,
  pedirAssinaturaDigitalizacao,
} from '../api-digitalizacao.js';

const { t } = useI18n();
const rota = useRoute();
const roteador = useRouter();
const gravacao = useQuery({
  queryKey: ['digitalizacao', 'gravacao'],
  queryFn: lerGravacaoDigitalizacao,
  staleTime: 30_000,
});
const pode = (acao: string) => gravacao.data.value?.operacoes[acao]?.pode ?? false;
const motivoDe = (acao: string) => gravacao.data.value?.operacoes[acao]?.motivo ?? null;
const login = computed(() => (gravacao.data.value?.login ?? '').toUpperCase());

const situacao = ref<SituacaoDigitalizacao | null>(null);
const fila = useQuery({
  queryKey: computed(() => ['digitalizacao', 'fila', situacao.value]),
  queryFn: () => lerFilaDigitalizacao(situacao.value),
});
const opcoesSituacao = computed(() => [
  { valor: null as SituacaoDigitalizacao | null, rotulo: t('digitalizacao.todas') },
  ...SITUACOES_DIGITALIZACAO.map((s) => ({
    valor: s as SituacaoDigitalizacao | null,
    rotulo: `${t(`digitalizacao.situacoes.${s}`)} (${fila.data.value?.contagens[s] ?? 0})`,
  })),
]);

const erro = ref<unknown>(null);
const aviso = ref<{ texto: string; variante: 'info' | 'alerta' } | null>(null);
const ocupado = ref(false);
async function agir<T>(fn: () => Promise<T>): Promise<T | null> {
  erro.value = null;
  aviso.value = null;
  ocupado.value = true;
  try {
    return await fn();
  } catch (x) {
    erro.value = x;
    return null;
  } finally {
    ocupado.value = false;
  }
}

// ── Captura ──
const termoProntuario = ref('');
const prontuario = ref<number | null>(null);
const paciente = useQuery({
  queryKey: computed(() => ['digitalizacao', 'paciente', prontuario.value]),
  queryFn: () => lerPacienteDigitalizacao(prontuario.value!),
  enabled: computed(() => prontuario.value !== null),
  retry: false,
});
const internacao = ref<number | null>(null);
const tipo = ref<TipoDocumentoDigitalizado>('evolucao');
const descricao = ref('');
const dataDocumento = ref<string | null>(null);
const paginas = ref(1);
const resolucao = ref(300);
const cor = ref<CorDigitalizacao>('cinza');
const ultimoLote = ref<number | null>(null);
const continuarLote = ref(false);
const arquivo = ref<{ base64: string; hash: string; bytes: number } | null>(null);
const opcoesTipo = computed(() =>
  TIPOS_DOCUMENTO_DIGITALIZADO.map((x) => ({ valor: x, rotulo: t(`digitalizacao.tipos.${x}`) })),
);
const opcoesCor = computed(() =>
  CORES_DIGITALIZACAO.map((x) => ({ valor: x, rotulo: t(`digitalizacao.cores.${x}`) })),
);
const opcoesInternacao = computed(() => [
  { valor: null as number | null, rotulo: t('digitalizacao.captura.semInternacao') },
  ...(paciente.data.value?.internacoes ?? []).map((i) => ({
    valor: i.reg as number | null,
    rotulo: `${i.reg} · ${i.entrada}${i.saida ? ` a ${i.saida}` : ''}`,
  })),
]);
watch(prontuario, () => {
  internacao.value = null;
});
function buscarProntuario(): void {
  const n = Number(termoProntuario.value.trim());
  prontuario.value = Number.isInteger(n) && n > 0 ? n : null;
}
async function escolherArquivo(ev: Event): Promise<void> {
  const f = (ev.target as HTMLInputElement).files?.[0];
  arquivo.value = f ? await lerArquivo(f) : null;
}
const podeCapturar = computed(
  () =>
    !!paciente.data.value &&
    !!arquivo.value &&
    !!dataDocumento.value &&
    descricao.value.trim().length >= 3 &&
    !ocupado.value,
);
async function capturar(): Promise<void> {
  const p = paciente.data.value;
  const a = arquivo.value;
  if (!p || !a || !dataDocumento.value) return;
  const r = await agir(() =>
    digitalizar(
      {
        prontuario: p.prontuario,
        internacao: internacao.value,
        tipoDocumento: tipo.value,
        descricao: descricao.value.trim(),
        dataDocumento: dataDocumento.value!,
        paginas: Number(paginas.value),
        resolucaoDpi: Number(resolucao.value),
        cor: cor.value,
        lote: continuarLote.value ? ultimoLote.value : null,
        conteudo: a.base64,
        hashConteudo: a.hash,
      },
      novaChaveDigitalizacao('capturar'),
    ),
  );
  if (!r) return;
  aviso.value = { texto: r.mensagem, variante: 'info' };
  ultimoLote.value = r.lote;
  continuarLote.value = true;
  descricao.value = '';
  arquivo.value = null;
  await fila.refetch();
}

// ── Conferência ──
const motivos = ref<Record<number, string>>({});
async function conferirDoc(d: DigitalizacaoLida, resultado: 'fiel' | 'recusar'): Promise<void> {
  const motivo = motivos.value[d.id]?.trim();
  const r = await agir(() =>
    conferir(
      { id: d.id, resultado, versao: d.versao, ...(resultado === 'recusar' && motivo ? { motivo } : {}) },
      novaChaveDigitalizacao(resultado),
    ),
  );
  if (r) aviso.value = { texto: r.mensagem, variante: 'info' };
  await fila.refetch();
}

// ── Assinatura ──
const certificados = useQuery({
  queryKey: ['digitalizacao', 'certificados'],
  queryFn: lerMeuCertificado,
  enabled: computed(() => pode('assinar')),
});
const certificado = ref<number | null>(null);
watch(
  () => certificados.data.value?.certificados,
  (cs) => {
    if (cs?.length && !cs.some((c) => c.id === certificado.value)) certificado.value = cs[0]!.id;
  },
  { immediate: true },
);
const opcoesCertificado = computed(() =>
  (certificados.data.value?.certificados ?? []).map((c) => ({
    valor: c.id as number | null,
    rotulo: `${c.midia}${c.provedor ? ` · ${c.provedor}` : ''} · ${c.serie}`,
  })),
);
const marcados = ref<number[]>([]);
const meus = computed(() =>
  (fila.data.value?.itens ?? []).filter(
    (d) => d.situacao === 'conferido' && (d.conferidoPor ?? '').toUpperCase() === login.value,
  ),
);
async function assinar(): Promise<void> {
  if (!certificado.value || marcados.value.length === 0) return;
  const p = await agir(() =>
    pedirAssinaturaDigitalizacao(
      { ids: marcados.value, certificado: certificado.value! },
      novaChaveDigitalizacao('assinar'),
    ),
  );
  if (!p) return;
  if (p.tipo === 'nuvem') {
    window.location.assign(p.endereco);
    return;
  }
  const endereco = certificados.data.value?.agenteLocal;
  if (!endereco) {
    aviso.value = { texto: t('digitalizacao.assinatura.agenteAusente'), variante: 'alerta' };
    return;
  }
  const r = await agir(async () => {
    const resp = await assinarNoAgente(endereco, p as DesafioAgenteLocal);
    return responderAgente({ desafio: (p as DesafioAgenteLocal).desafio, ...resp });
  });
  if (!r) return;
  aviso.value = {
    texto: t('digitalizacao.assinatura.resultado', {
      assinados: r.lote?.assinados ?? 0,
      recusados: r.lote?.recusados ?? 0,
    }),
    variante: r.ok ? 'info' : 'alerta',
  };
  marcados.value = [];
  await fila.refetch();
}

onMounted(() => {
  const q = rota.query;
  if (q['finalidade'] === 'digitalizacao' && typeof q['resultado'] === 'string') {
    const n = (k: string) => Number(q[k] ?? 0) || 0;
    aviso.value =
      n('assinados') > 0
        ? {
            texto: t('digitalizacao.assinatura.resultado', {
              assinados: n('assinados'),
              recusados: n('recusados'),
            }),
            variante: n('recusados') ? 'alerta' : 'info',
          }
        : {
            texto: t('digitalizacao.assinatura.voltaRecusada', { motivo: String(q['motivo'] ?? '') }),
            variante: 'alerta',
          };
    void roteador.replace({ path: rota.path });
  }
});

const minuto = (s: string | null) =>
  s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}` : '';
const dia = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
</script>

<template>
  <section class="tela-agenda" aria-labelledby="digit-titulo" data-testid="tela-digitalizacao">
    <h1 id="digit-titulo">{{ t('digitalizacao.titulo') }}</h1>
    <p>{{ t('digitalizacao.texto') }}</p>
    <div
      v-if="gravacao.data.value && !gravacao.data.value.ligada"
      class="aviso"
      data-testid="digit-em-consulta"
    >
      <SanteAlerta variante="aviso" :texto="t('digitalizacao.emConsulta')" />
      <p>{{ gravacao.data.value.motivo }}</p>
    </div>
    <SanteAlerta
      v-if="aviso"
      :variante="aviso.variante"
      :texto="aviso.texto"
      anunciar
      data-testid="digit-aviso"
    />
    <ErroDigitalizacao v-if="erro" :erro="erro" />

    <section class="painel" aria-labelledby="digit-captura">
      <h2 id="digit-captura">{{ t('digitalizacao.captura.titulo') }}</h2>
      <p v-if="!pode('capturar')" class="secundario">{{ motivoDe('capturar') }}</p>
      <template v-else>
        <form class="filtros" role="search" @submit.prevent="buscarProntuario">
          <div class="campo">
            <label for="digit-prontuario">{{ t('digitalizacao.captura.prontuario') }}</label>
            <input
              id="digit-prontuario"
              v-model="termoProntuario"
              inputmode="numeric"
              autocomplete="off"
              data-testid="digit-prontuario"
            />
          </div>
          <SanteBotao tipo="submit" variante="secundario" :rotulo="t('digitalizacao.captura.buscar')" />
        </form>
        <ErroDigitalizacao v-if="paciente.isError.value" :erro="paciente.error.value" />
        <form
          v-if="paciente.data.value"
          class="formulario"
          data-testid="form-captura"
          @submit.prevent="capturar"
        >
          <p data-testid="digit-paciente">
            {{
              t('digitalizacao.captura.paciente', {
                nome: paciente.data.value.nome,
                prontuario: paciente.data.value.prontuario,
              })
            }}
          </p>
          <div class="grade">
            <SanteSelecao
              v-model="internacao"
              :rotulo="t('digitalizacao.captura.internacao')"
              :opcoes="opcoesInternacao"
              data-testid="digit-internacao"
            />
            <SanteSelecao
              v-model="tipo"
              :rotulo="t('digitalizacao.captura.tipo')"
              :opcoes="opcoesTipo"
              data-testid="digit-tipo"
            />
            <SanteData
              v-model="dataDocumento"
              :rotulo="t('digitalizacao.captura.data')"
              editavel
              data-testid="digit-data"
            />
            <div class="campo">
              <label for="digit-paginas">{{ t('digitalizacao.captura.paginas') }}</label>
              <input
                id="digit-paginas"
                v-model.number="paginas"
                type="number"
                min="1"
                max="500"
                data-testid="digit-paginas"
              />
            </div>
            <div class="campo">
              <label for="digit-resolucao">{{ t('digitalizacao.captura.resolucao') }}</label>
              <input
                id="digit-resolucao"
                v-model.number="resolucao"
                type="number"
                min="75"
                max="1200"
                data-testid="digit-resolucao"
              />
            </div>
            <SanteSelecao v-model="cor" :rotulo="t('digitalizacao.captura.cor')" :opcoes="opcoesCor" />
          </div>
          <SanteCampoTexto
            v-model="descricao"
            :rotulo="t('digitalizacao.captura.descricao')"
            :max-bytes="120"
            obrigatorio
            data-testid="digit-descricao"
          />
          <label v-if="ultimoLote" class="opcao">
            <input v-model="continuarLote" type="checkbox" data-testid="digit-continuar-lote" />
            {{ t('digitalizacao.captura.loteAtual', { lote: ultimoLote }) }}
          </label>
          <div class="campo">
            <label for="digit-arquivo">{{ t('digitalizacao.captura.arquivo') }}</label>
            <input
              id="digit-arquivo"
              type="file"
              accept="application/pdf"
              data-testid="digit-arquivo"
              @change="escolherArquivo"
            />
          </div>
          <p v-if="arquivo" class="secundario resumo" data-testid="digit-resumo">
            {{ t('digitalizacao.captura.resumo', { hash: arquivo.hash }) }}
          </p>
          <SanteBotao
            tipo="submit"
            :rotulo="t('digitalizacao.captura.gravar')"
            :desabilitado="!podeCapturar"
            data-testid="digit-capturar"
          />
        </form>
      </template>
    </section>

    <section v-if="pode('assinar') && meus.length" class="painel" aria-labelledby="digit-assinatura">
      <h2 id="digit-assinatura">{{ t('digitalizacao.assinatura.titulo') }}</h2>
      <p>{{ t('digitalizacao.assinatura.texto') }}</p>
      <p v-if="certificados.data.value && !certificados.data.value.certificados.length" class="secundario">
        {{ t('digitalizacao.assinatura.semCertificado') }}
        <RouterLink to="/conta/certificado">{{ t('digitalizacao.assinatura.meuCertificado') }}</RouterLink>
      </p>
      <div v-else class="filtros">
        <SanteSelecao
          v-model="certificado"
          :rotulo="t('digitalizacao.assinatura.certificado')"
          :opcoes="opcoesCertificado"
          data-testid="digit-certificado"
        />
        <SanteBotao
          :rotulo="t('digitalizacao.assinatura.assinar', { n: marcados.length })"
          :desabilitado="ocupado || !certificado || marcados.length === 0"
          data-testid="digit-assinar"
          @acionar="assinar"
        />
      </div>
    </section>

    <section class="painel" aria-labelledby="digit-fila">
      <h2 id="digit-fila">{{ t('digitalizacao.fila.titulo') }}</h2>
      <SanteSelecao
        v-model="situacao"
        :rotulo="t('digitalizacao.filtro')"
        :opcoes="opcoesSituacao"
        data-testid="digit-filtro"
      />
      <ErroDigitalizacao v-if="fila.isError.value" :erro="fila.error.value" />
      <p v-else-if="!fila.data.value" role="status">{{ t('digitalizacao.carregando') }}</p>
      <template v-else>
        <p v-if="fila.data.value.cortada" role="status">{{ t('digitalizacao.cortada') }}</p>
        <p v-if="fila.data.value.itens.length === 0">{{ t('digitalizacao.nenhum') }}</p>
        <table v-else class="tabela" data-testid="digit-tabela">
          <caption>
            {{
              t('digitalizacao.fila.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('digitalizacao.fila.lote') }}</th>
              <th scope="col">{{ t('digitalizacao.fila.documento') }}</th>
              <th scope="col">{{ t('digitalizacao.fila.paciente') }}</th>
              <th scope="col">{{ t('digitalizacao.fila.situacao') }}</th>
              <th scope="col">{{ t('digitalizacao.fila.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in fila.data.value.itens" :key="d.id" :data-testid="`digit-${d.id}`">
              <td>{{ d.lote }}/{{ d.ordem }}</td>
              <td>
                <strong>{{ t(`digitalizacao.tipos.${d.tipoDocumento}`) }}</strong> · {{ d.descricao }}
                <div class="secundario">
                  {{ dia(d.dataDocumento) }} ·
                  {{ t('digitalizacao.fila.imagem', { paginas: d.paginas, dpi: d.resolucaoDpi }) }} ·
                  {{ t(`digitalizacao.cores.${d.cor}`) }} ·
                  {{ t('digitalizacao.fila.guarda', { data: dia(d.guardaAte) }) }}
                </div>
              </td>
              <td>
                {{ d.nome }}
                <div class="secundario">{{ d.prontuario }}{{ d.internacao ? ` · ${d.internacao}` : '' }}</div>
              </td>
              <td>
                {{ t(`digitalizacao.situacoes.${d.situacao}`) }}
                <div class="secundario">
                  {{
                    t('digitalizacao.fila.capturadoPor', { por: d.capturadoPor, em: minuto(d.capturadoEm) })
                  }}
                </div>
                <div v-if="d.conferidoPor" class="secundario">
                  {{
                    t('digitalizacao.fila.conferidoPor', { por: d.conferidoPor, em: minuto(d.conferidoEm) })
                  }}
                </div>
                <div v-if="d.motivo" class="secundario">{{ d.motivo }}</div>
                <div v-if="d.assinadoPor" class="secundario">
                  {{ t('digitalizacao.fila.assinadoPor', { por: d.assinadoPor, em: minuto(d.assinadoEm) }) }}
                  <span v-if="d.carimboEm">
                    · {{ t('digitalizacao.fila.carimbo', { em: minuto(d.carimboEm) }) }}</span
                  >
                </div>
              </td>
              <td>
                <a
                  :href="enderecoArquivo(d.id)"
                  target="_blank"
                  rel="noopener"
                  :data-testid="`digit-abrir-${d.id}`"
                  >{{ t('digitalizacao.fila.abrir') }}</a
                >
                <template v-if="d.situacao === 'capturado' && pode('conferir')">
                  <p v-if="d.capturadoPor.toUpperCase() === login" class="secundario">
                    {{ t('digitalizacao.fila.suaCaptura') }}
                  </p>
                  <template v-else>
                    <SanteBotao
                      :rotulo="t('digitalizacao.fila.fiel')"
                      :desabilitado="ocupado"
                      :data-testid="`digit-fiel-${d.id}`"
                      @acionar="conferirDoc(d, 'fiel')"
                    />
                    <SanteCampoTexto
                      :model-value="motivos[d.id] ?? ''"
                      :rotulo="t('digitalizacao.fila.motivo')"
                      :max-bytes="200"
                      :data-testid="`digit-motivo-${d.id}`"
                      @update:model-value="(v: string) => (motivos[d.id] = v)"
                    />
                    <SanteBotao
                      variante="secundario"
                      :rotulo="t('digitalizacao.fila.recusar')"
                      :desabilitado="ocupado || (motivos[d.id] ?? '').trim().length < 3"
                      :data-testid="`digit-recusar-${d.id}`"
                      @acionar="conferirDoc(d, 'recusar')"
                    />
                  </template>
                </template>
                <label v-if="meus.some((x) => x.id === d.id)" class="opcao">
                  <input
                    v-model="marcados"
                    type="checkbox"
                    :value="d.id"
                    :data-testid="`digit-marcar-${d.id}`"
                  />
                  {{ t('digitalizacao.fila.marcar') }}
                </label>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.formulario {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--sgh-espaco-2);
  align-items: end;
}
.resumo {
  word-break: break-all;
}
.aviso p {
  margin: 0;
}
</style>
