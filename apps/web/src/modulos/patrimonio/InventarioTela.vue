<script setup lang="ts">
// Inventário de bens pelo celular (M54, etapa 6; regra 13; `patrimonio.inventario.contar`, D-PERM-INV-546): a lista
// dos inventários, abrir (o estabelecimento inteiro ou um setor), contar (o setor onde se lê; o QR pela câmera, onde o
// navegador tem o leitor de códigos, ou a plaqueta digitada; cada leitura mostra o resultado na hora), o resumo com a
// conta impressa (esperados = no lugar + em outro setor + não encontrados) e encerrar (as divergências ficam
// registradas; nada é baixado sozinho). Feita para a tela estreita: campos e botões na largura toda.
import type { DetalheInventario, LeituraInventarioRegistrada } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../casca/MensagemErro.vue';
import {
  abrirInventario,
  cancelarInventario,
  encerrarInventario,
  lerApoioPatrimonio,
  lerInventario,
  lerInventarios,
  lerNoInventario,
} from './api-patrimonio.js';
import { instante, rotuloCentro } from './comum-patrimonio.js';
import ErroPatrimonio from './ErroPatrimonio.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const apoio = useQuery({
  queryKey: ['patrimonio', 'apoio', 'inventario'],
  queryFn: () => lerApoioPatrimonio('inventario'),
});
const a = computed(() => apoio.data.value ?? null);
const lista = useQuery({ queryKey: ['patrimonio', 'inventarios'], queryFn: lerInventarios });
const aberto = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['patrimonio', 'inventario', aberto.value]),
  queryFn: () => lerInventario(aberto.value!),
  enabled: computed(() => aberto.value !== null),
});
const d = computed(() => (aberto.value !== null ? (detalhe.data.value ?? null) : null));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
const opcoesCentro = computed(() =>
  (a.value?.centros ?? [])
    .filter((c) => c.ativo)
    .map((c) => ({ valor: c.id as number | null, rotulo: rotuloCentro(c) })),
);

// ── Abrir ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const novo = ref({ descricao: '', centro: null as number | null });
async function abrir() {
  if (!novo.value.descricao.trim()) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const x = await abrirInventario({ descricao: novo.value.descricao.trim(), centro: novo.value.centro });
    cliente.setQueryData(['patrimonio', 'inventario', x.id], x);
    aberto.value = x.id;
    onde.value = x.centro?.id ?? null;
    novo.value = { descricao: '', centro: null };
    await cliente.invalidateQueries({ queryKey: ['patrimonio', 'inventarios'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Contar ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const onde = ref<number | null>(null);
const codigo = ref('');
const observacao = ref('');
const ultima = ref<LeituraInventarioRegistrada | null>(null);
function abrirDetalhe(id: number, centro: number | null) {
  aberto.value = id;
  onde.value = centro;
  ultima.value = null;
  mensagem.value = null;
}
async function ler() {
  if (aberto.value === null || onde.value === null || !codigo.value.trim()) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await lerNoInventario(aberto.value, {
      codigo: codigo.value.trim(),
      centro: onde.value,
      observacao: observacao.value.trim() || null,
    });
    ultima.value = r.leitura;
    const atual = cliente.getQueryData<DetalheInventario>(['patrimonio', 'inventario', aberto.value]);
    if (atual)
      cliente.setQueryData(['patrimonio', 'inventario', aberto.value], {
        ...atual,
        leituras: [r.leitura, ...atual.leituras],
        resumo: r.resumo,
      });
    codigo.value = '';
    observacao.value = '';
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
async function encerrar() {
  if (aberto.value === null) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const x = await encerrarInventario(aberto.value);
    cliente.setQueryData(['patrimonio', 'inventario', x.id], x);
    mensagem.value = t('patrimonio.inventario.encerrado');
    await cliente.invalidateQueries({ queryKey: ['patrimonio', 'inventarios'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Cancelamento com motivo (W0-08) ─────────────────────────────────────────────────────────────────────────────────
const cancelando = ref(false);
const motivoCancelamento = ref('');
async function cancelar() {
  if (aberto.value === null || motivoCancelamento.value.trim().length < 5) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const x = await cancelarInventario(aberto.value, motivoCancelamento.value.trim());
    parar();
    cliente.setQueryData(['patrimonio', 'inventario', x.id], x);
    mensagem.value = t('patrimonio.inventario.cancelado');
    cancelando.value = false;
    motivoCancelamento.value = '';
    await cliente.invalidateQueries({ queryKey: ['patrimonio', 'inventarios'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}

// ── Câmera: só onde o navegador tem o leitor de códigos (BarcodeDetector) ──────────────────────────────────────────
interface Detector {
  detect(fonte: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
const temCamera = typeof (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector === 'function';
const video = ref<HTMLVideoElement | null>(null);
const lendo = ref(false);
let fluxo: MediaStream | null = null;
let laco: ReturnType<typeof setInterval> | null = null;
async function camera(): Promise<void> {
  if (!temCamera || lendo.value) return;
  try {
    fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    lendo.value = true;
    await nextTick();
    if (video.value) {
      video.value.srcObject = fluxo;
      await video.value.play();
    }
    const D = (globalThis as unknown as { BarcodeDetector: new (o: unknown) => Detector }).BarcodeDetector;
    const detector = new D({ formats: ['qr_code'] });
    let ocupadoLeitura = false;
    laco = setInterval(async () => {
      if (!video.value || ocupadoLeitura || ocupado.value) return;
      ocupadoLeitura = true;
      const r = await detector.detect(video.value).catch(() => []);
      ocupadoLeitura = false;
      // A câmera segue ligada: cada QR lido registra uma leitura (o servidor marca a repetida).
      if (r[0]?.rawValue && r[0].rawValue !== ultima.value?.codigo) {
        codigo.value = r[0].rawValue;
        await ler();
      }
    }, 500);
  } catch (x) {
    erro.value = x;
    parar();
  }
}
function parar(): void {
  if (laco) clearInterval(laco);
  laco = null;
  fluxo?.getTracks().forEach((k) => k.stop());
  fluxo = null;
  lendo.value = false;
}
onBeforeUnmount(parar);
</script>

<template>
  <section class="tela-patrimonio" aria-labelledby="inv-titulo" data-testid="tela-inventario">
    <h1 id="inv-titulo">{{ t('patrimonio.inventario.titulo') }}</h1>
    <p>{{ t('patrimonio.inventario.descricao') }}</p>
    <MensagemErro v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('patrimonio.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.liberacao.ligada"
        :texto="t('patrimonio.desligado')"
        variante="info"
        data-testid="patrimonio-desligado"
      />
      <p v-if="mensagem" role="status" class="ok" data-testid="inv-mensagem">{{ mensagem }}</p>
      <ErroPatrimonio v-if="erro" :erro="erro" />

      <!-- Inventário aberto: contar -->
      <section
        v-if="aberto !== null"
        class="bloco"
        aria-labelledby="inv-det-titulo"
        data-testid="inv-detalhe"
      >
        <MensagemErro v-if="detalhe.isError.value" :erro="detalhe.error.value" />
        <p v-else-if="!d" role="status">{{ t('patrimonio.carregando') }}</p>
        <template v-else>
          <h2 id="inv-det-titulo">
            {{ d.descricao }} ({{ t(`patrimonio.inventario.situacoes.${d.situacao}`) }})
          </h2>
          <p class="secundario">
            {{ d.centro ? rotuloCentro(d.centro) : t('patrimonio.inventario.inteiro') }}.
            {{ t('patrimonio.inventario.abertoPor', { por: d.abertoPor, em: instante(d.abertoEm) }) }}
            <template v-if="d.encerradoPor">
              {{
                t('patrimonio.inventario.encerradoPor', { por: d.encerradoPor, em: instante(d.encerradoEm) })
              }}
            </template>
          </p>
          <p v-if="d.canceladoPor" data-testid="inv-cancelado">
            {{
              t('patrimonio.inventario.canceladoPor', {
                por: d.canceladoPor,
                em: instante(d.canceladoEm),
                motivo: d.motivoCancelamento ?? '',
              })
            }}
          </p>

          <form
            v-if="d.situacao === 'aberto' && a.acoes.contar"
            class="leitor"
            data-testid="inv-leitor"
            @submit.prevent="ler"
          >
            <SanteSelecao
              v-model="onde"
              :rotulo="t('patrimonio.inventario.ondeEstou')"
              :opcoes="opcoesCentro"
              busca
              data-testid="inv-onde"
            />
            <SanteCampoTexto
              v-model="codigo"
              :rotulo="t('patrimonio.inventario.codigo')"
              :max-bytes="80"
              data-testid="inv-codigo"
            />
            <SanteCampoTexto
              v-model="observacao"
              :rotulo="t('patrimonio.inventario.observacao')"
              :max-bytes="400"
              data-testid="inv-observacao"
            />
            <div class="acoes">
              <SanteBotao
                tipo="submit"
                :rotulo="t('patrimonio.inventario.ler')"
                :desabilitado="ocupado || onde === null || !codigo.trim()"
                data-testid="inv-ler"
              />
              <SanteBotao
                v-if="temCamera && !lendo"
                variante="secundario"
                :rotulo="t('patrimonio.inventario.camera')"
                :desabilitado="onde === null"
                data-testid="inv-camera"
                @acionar="camera"
              />
              <SanteBotao
                v-if="lendo"
                variante="secundario"
                :rotulo="t('patrimonio.inventario.pararCamera')"
                data-testid="inv-parar-camera"
                @acionar="parar"
              />
            </div>
            <p v-if="!temCamera" class="secundario" data-testid="inv-sem-camera">
              {{ t('patrimonio.inventario.semCamera') }}
            </p>
            <video
              v-if="lendo"
              ref="video"
              muted
              playsinline
              :aria-label="t('patrimonio.inventario.camera')"
            ></video>
            <p v-if="ultima" role="status" aria-live="polite" data-testid="inv-ultima">
              {{
                t('patrimonio.inventario.lido', {
                  codigo: ultima.bem?.plaqueta ?? ultima.codigo,
                  resultado: t(`patrimonio.resultadosLeitura.${ultima.resultado}`),
                })
              }}
            </p>
          </form>

          <section class="bloco" aria-labelledby="inv-resumo-titulo" data-testid="inv-resumo">
            <h3 id="inv-resumo-titulo">
              {{ t('patrimonio.inventario.esperados') }} {{ d.resumo.esperados }} ·
              {{ t('patrimonio.inventario.leituras') }}
              {{ d.resumo.leituras }}
            </h3>
            <p data-testid="inv-conferencia">
              {{
                t('patrimonio.inventario.conferencia', {
                  esperados: d.resumo.esperados,
                  conforme: d.resumo.porResultado.conforme,
                  outro: d.resumo.porResultado['outro-local'],
                  faltam: d.resumo.naoEncontradosTotal,
                })
              }}
            </p>
            <ul>
              <li v-for="(n, r) in d.resumo.porResultado" :key="r">
                {{ t(`patrimonio.resultadosLeitura.${r}`) }}: {{ n }}
              </li>
            </ul>
            <details v-if="d.resumo.naoEncontradosTotal > 0" data-testid="inv-nao-encontrados">
              <summary>
                {{ t('patrimonio.inventario.naoEncontrados', { n: d.resumo.naoEncontradosTotal }) }}
              </summary>
              <p v-if="!d.resumo.listaCompleta" class="secundario">
                {{ t('patrimonio.inventario.listaCortada') }}
              </p>
              <ul>
                <li v-for="x in d.resumo.naoEncontrados" :key="x.bem">
                  {{ x.plaqueta }}: {{ x.descricao }} ({{
                    rotuloCentro(a.centros.find((c) => c.id === x.centro) ?? null)
                  }})
                </li>
              </ul>
            </details>
          </section>

          <details v-if="d.leituras.length > 0" data-testid="inv-leituras">
            <summary>{{ t('patrimonio.inventario.leiturasFeitas') }} ({{ d.leituras.length }})</summary>
            <ul>
              <li v-for="l in d.leituras" :key="l.id">
                {{ l.bem?.plaqueta ?? l.codigo }}: {{ t(`patrimonio.resultadosLeitura.${l.resultado}`) }} ·
                {{ rotuloCentro(a.centros.find((c) => c.id === l.centroLido) ?? null) }} ·
                {{ t('patrimonio.inventario.lidoPor', { por: l.lidoPor, em: instante(l.lidoEm) }) }}
              </li>
            </ul>
          </details>

          <form
            v-if="d.situacao === 'aberto' && cancelando"
            class="bloco"
            aria-labelledby="inv-cancelar-titulo"
            data-testid="inv-cancelamento"
            @submit.prevent
          >
            <h3 id="inv-cancelar-titulo">{{ t('patrimonio.inventario.cancelarTitulo') }}</h3>
            <p class="secundario">{{ t('patrimonio.inventario.cancelarAjuda') }}</p>
            <SanteCampoTexto
              v-model="motivoCancelamento"
              :rotulo="t('patrimonio.motivo')"
              :max-bytes="400"
              multilinha
              obrigatorio
              data-testid="inv-cancelar-motivo"
            />
            <div class="acoes">
              <SanteBotao
                variante="secundario"
                :rotulo="t('patrimonio.inventario.voltarSemCancelar')"
                @acionar="cancelando = false"
              />
              <SanteBotao
                variante="destrutivo"
                :rotulo="t('patrimonio.inventario.cancelar')"
                :confirmacao="t('patrimonio.inventario.confirmarCancelar')"
                :desabilitado="ocupado || motivoCancelamento.trim().length < 5"
                data-testid="inv-cancelar-confirmar"
                @acionar="cancelar"
              />
            </div>
          </form>

          <div class="acoes">
            <SanteBotao
              v-if="d.situacao === 'aberto' && a.acoes.contar"
              variante="destrutivo"
              :rotulo="t('patrimonio.inventario.encerrar')"
              :confirmacao="t('patrimonio.inventario.confirmarEncerrar')"
              :desabilitado="ocupado"
              data-testid="inv-encerrar"
              @acionar="encerrar"
            />
            <SanteBotao
              v-if="d.situacao === 'aberto' && a.acoes.contar && !cancelando"
              variante="secundario"
              :rotulo="t('patrimonio.inventario.cancelar')"
              data-testid="inv-cancelar"
              @acionar="cancelando = true"
            />
            <SanteBotao
              variante="texto"
              :rotulo="t('patrimonio.voltar')"
              data-testid="inv-voltar"
              @acionar="
                parar();
                aberto = null;
              "
            />
          </div>
        </template>
      </section>

      <!-- Lista e abertura -->
      <template v-else>
        <form v-if="a.acoes.contar" class="bloco" data-testid="inv-abrir" @submit.prevent="abrir">
          <h2>{{ t('patrimonio.inventario.abrirNovo') }}</h2>
          <div class="campos">
            <SanteCampoTexto
              v-model="novo.descricao"
              :rotulo="t('patrimonio.inventario.nome')"
              :max-bytes="120"
              obrigatorio
              data-testid="inv-nome"
            />
            <SanteSelecao
              v-model="novo.centro"
              :rotulo="t('patrimonio.inventario.escopo')"
              :opcoes="[{ valor: null, rotulo: t('patrimonio.inventario.inteiro') }, ...opcoesCentro]"
              busca
              data-testid="inv-escopo"
            />
            <SanteBotao
              tipo="submit"
              :rotulo="t('patrimonio.inventario.abrirNovo')"
              :desabilitado="ocupado || !novo.descricao.trim()"
              data-testid="inv-abrir-gravar"
            />
          </div>
        </form>
        <section class="bloco" aria-labelledby="inv-lista-titulo">
          <h2 id="inv-lista-titulo">{{ t('patrimonio.inventario.lista') }}</h2>
          <MensagemErro v-if="lista.isError.value" :erro="lista.error.value" />
          <p v-else-if="!lista.data.value" role="status">{{ t('patrimonio.carregando') }}</p>
          <p v-else-if="lista.data.value.length === 0" data-testid="inv-vazio">
            {{ t('patrimonio.inventario.nenhum') }}
          </p>
          <ul v-else class="lista-inv">
            <li v-for="i in lista.data.value" :key="i.id" :data-testid="`inventario-${i.id}`">
              <span>
                <strong>{{ i.descricao }}</strong> ({{ t(`patrimonio.inventario.situacoes.${i.situacao}`) }})
                · {{ i.centro ? rotuloCentro(i.centro) : t('patrimonio.inventario.inteiro') }} ·
                {{ t('patrimonio.inventario.abertoPor', { por: i.abertoPor, em: instante(i.abertoEm) }) }}
              </span>
              <SanteBotao
                variante="secundario"
                :rotulo="i.situacao === 'aberto' ? t('patrimonio.inventario.contar') : t('patrimonio.abrir')"
                :data-testid="`inventario-abrir-${i.id}`"
                @acionar="abrirDetalhe(i.id, i.centro?.id ?? null)"
              />
            </li>
          </ul>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped src="./estilo-patrimonio.css"></style>
<style scoped>
.lista-inv {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.lista-inv li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  justify-content: space-between;
}
</style>
