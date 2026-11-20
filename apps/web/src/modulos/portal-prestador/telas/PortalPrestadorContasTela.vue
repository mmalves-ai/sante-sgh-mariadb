<script setup lang="ts">
// Portal do prestador credenciado, W0-10 (M8): o envio do lote XML TISS 04.03.00 (com confirmação: o lote recebido não
// se altera; corrige-se com lote novo), a lista dos lotes do prestador (só os dele) e o download do demonstrativo de
// análise. O arquivo vai em bytes (base64), nunca lido como texto: o hash do epílogo depende dos bytes. O servidor
// confere a sessão, o CSRF, a versão, o XSD, o hash e se o lote é do prestador da sessão. O lote analisado ou pago abre
// o painel das glosas e do recurso por item (RecursoGlosaPortal).
import { type ContaMedicaResumo, MAXIMO_BYTES_CONTA, SITUACOES_CONTA_MEDICA } from '@sgh/contratos';
import { SanteAlerta, SanteBotao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { arquivoEmBase64, baixarDemonstrativo } from '../../operadora/api-contas.js';
import {
  contasPortalPrestador,
  demonstrativoPagamentoPortalPrestador,
  demonstrativoPortalPrestador,
  enviarLotePortalPrestador,
} from '../api-portal-prestador.js';
import PortalPrestadorCasca from '../componentes/PortalPrestadorCasca.vue';
import RecursoGlosaPortal from '../componentes/RecursoGlosaPortal.vue';

type Lote = ContaMedicaResumo & { demonstrativo: boolean; demonstrativoPagamento: boolean };

const { t } = useI18n();
const arquivo = ref<File | null>(null);
const aviso = ref('');
const confirmando = ref(false);
const ocupado = ref(false);
const erro = ref<unknown>(null);
/** A recusa do servidor com o motivo (XSD, lote repetido, lote de outro prestador) e o que o schema apontou. */
const recusa = ref('');
const errosXsd = ref<string[]>([]);
const recebido = ref<{ protocolo: string; avisos: string[] } | null>(null);
const lotes = ref<Lote[]>([]);
const proxima = ref<number | null>(null);
const campo = ref<HTMLInputElement | null>(null);
/** W0-10 (M8): o lote aberto no painel das glosas e do recurso por item. */
const recurso = ref<number | null>(null);

const podeEnviar = computed(() => arquivo.value !== null && !ocupado.value);
const dataBr = (d: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d;
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function carregar(apos?: number): Promise<void> {
  try {
    const r = await contasPortalPrestador(apos);
    lotes.value = apos === undefined ? r.itens : [...lotes.value, ...r.itens];
    proxima.value = r.proxima;
  } catch (x) {
    erro.value = x;
  }
}

function escolher(ev: Event): void {
  const f = (ev.target as HTMLInputElement).files?.[0] ?? null;
  aviso.value = '';
  recusa.value = '';
  errosXsd.value = [];
  confirmando.value = false;
  arquivo.value = null;
  if (!f) return;
  if (!/\.xml$/i.test(f.name)) aviso.value = t('portalPrestador.contas.naoXml');
  else if (f.size > MAXIMO_BYTES_CONTA) aviso.value = t('portalPrestador.contas.grande', { nome: f.name });
  else arquivo.value = f;
}

async function enviar(): Promise<void> {
  const f = arquivo.value;
  if (!f || ocupado.value) return;
  ocupado.value = true;
  erro.value = null;
  recusa.value = '';
  errosXsd.value = [];
  try {
    const r = await enviarLotePortalPrestador({ arquivo: await arquivoEmBase64(f), nome: f.name });
    recebido.value = { protocolo: r.protocolo, avisos: r.avisos };
    arquivo.value = null;
    confirmando.value = false;
    if (campo.value) campo.value.value = '';
    await carregar();
  } catch (x) {
    if (x instanceof ErroApi && x.problema?.detail && [400, 409].includes(x.status)) {
      recusa.value = x.problema.detail;
      const avisos = (x.problema as { avisos?: unknown }).avisos;
      errosXsd.value = Array.isArray(avisos) ? avisos.map(String) : [];
    } else erro.value = x;
    confirmando.value = false;
  } finally {
    ocupado.value = false;
  }
}

async function baixar(id: number, tipo: 'analise' | 'pagamento' = 'analise'): Promise<void> {
  erro.value = null;
  try {
    baixarDemonstrativo(
      await (tipo === 'pagamento'
        ? demonstrativoPagamentoPortalPrestador(id)
        : demonstrativoPortalPrestador(id)),
    );
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <PortalPrestadorCasca :titulo="t('portalPrestador.contas.titulo')" @sessao="carregar()">
    <div class="contas" data-testid="pp-contas">
      <p class="secundario">{{ t('portalPrestador.contas.texto') }}</p>
      <form class="painel" data-testid="pp-contas-form" @submit.prevent>
        <label class="campo">
          <span>{{ t('portalPrestador.contas.arquivo') }}</span>
          <input
            ref="campo"
            type="file"
            accept=".xml,application/xml,text/xml"
            data-testid="pp-contas-arquivo"
            @change="escolher"
          />
        </label>
        <SanteAlerta v-if="aviso" :texto="aviso" variante="alerta" anunciar />
        <div v-if="!confirmando" class="acoes">
          <SanteBotao
            :rotulo="t('portalPrestador.contas.enviar')"
            :desabilitado="!podeEnviar"
            data-testid="pp-contas-enviar"
            @acionar="confirmando = true"
          />
        </div>
        <div v-else class="painel confirma" role="group" data-testid="pp-contas-confirma">
          <p>{{ t('portalPrestador.contas.confirma', { nome: arquivo?.name ?? '' }) }}</p>
          <div class="acoes">
            <SanteBotao
              :rotulo="t('portalPrestador.contas.confirmar')"
              :desabilitado="ocupado"
              data-testid="pp-contas-confirmar"
              @acionar="enviar"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('portalPrestador.contas.voltar')"
              data-testid="pp-contas-voltar"
              @acionar="confirmando = false"
            />
          </div>
        </div>
      </form>
      <div v-if="recusa" class="painel" data-testid="pp-contas-recusa">
        <SanteAlerta :texto="recusa" variante="alerta" anunciar />
        <template v-if="errosXsd.length">
          <p class="secundario">{{ t('portalPrestador.contas.errosXsd') }}</p>
          <ul class="secundario" data-testid="pp-contas-erros-xsd">
            <li v-for="(x, i) in errosXsd" :key="i">{{ x }}</li>
          </ul>
        </template>
      </div>
      <MensagemErro v-if="erro" :erro="erro" />
      <section v-if="recebido" class="painel" data-testid="pp-contas-recebido" aria-live="polite">
        <SanteAlerta
          :texto="t('portalPrestador.contas.recebido', { protocolo: recebido.protocolo })"
          variante="info"
          anunciar
        />
        <ul v-if="recebido.avisos.length">
          <li v-for="a in recebido.avisos" :key="a">{{ a }}</li>
        </ul>
      </section>

      <RecursoGlosaPortal
        v-if="recurso !== null"
        :key="recurso"
        :conta="recurso"
        @fechar="recurso = null"
        @enviado="carregar()"
      />
      <section class="painel" aria-labelledby="pp-contas-lotes" data-testid="pp-contas-lotes">
        <h2 id="pp-contas-lotes" class="subtitulo">{{ t('portalPrestador.contas.lotes') }}</h2>
        <p v-if="!lotes.length" class="secundario">{{ t('portalPrestador.contas.nenhum') }}</p>
        <div v-else class="rolagem">
          <table>
            <thead>
              <tr>
                <th scope="col">{{ t('portalPrestador.contas.colunas.protocolo') }}</th>
                <th scope="col">{{ t('portalPrestador.contas.colunas.lote') }}</th>
                <th scope="col">{{ t('portalPrestador.contas.colunas.competencia') }}</th>
                <th scope="col">{{ t('portalPrestador.contas.colunas.guias') }}</th>
                <th scope="col">{{ t('portalPrestador.contas.colunas.recebidaEm') }}</th>
                <th scope="col">{{ t('portalPrestador.contas.colunas.situacao') }}</th>
                <th scope="col">{{ t('portalPrestador.contas.colunas.apresentado') }}</th>
                <th scope="col">{{ t('portalPrestador.contas.colunas.liberado') }}</th>
                <th scope="col">{{ t('portalPrestador.contas.colunas.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in lotes" :key="l.id" :data-testid="`pp-contas-linha-${l.id}`">
                <td>{{ l.protocolo }}</td>
                <td>{{ l.numeroLote }}</td>
                <td>{{ l.competencia }}</td>
                <td>{{ l.guias }}</td>
                <td>{{ dataBr(l.recebidaEm) }}</td>
                <td>{{ SITUACOES_CONTA_MEDICA[l.situacao] }}</td>
                <td>{{ reais(l.apresentado) }}</td>
                <td>{{ reais(l.liberado) }}</td>
                <td>
                  <SanteBotao
                    v-if="l.demonstrativo"
                    variante="secundario"
                    :rotulo="t('portalPrestador.contas.demonstrativo')"
                    :data-testid="`pp-contas-demonstrativo-${l.id}`"
                    @acionar="baixar(l.id)"
                  />
                  <SanteBotao
                    v-if="l.demonstrativoPagamento"
                    variante="secundario"
                    :rotulo="t('portalPrestador.contas.demonstrativoPagamento')"
                    :data-testid="`pp-contas-demonstrativo-pagamento-${l.id}`"
                    @acionar="baixar(l.id, 'pagamento')"
                  />
                  <SanteBotao
                    v-if="l.demonstrativo"
                    variante="secundario"
                    :rotulo="t('portalPrestador.contas.recurso.abrir')"
                    :data-testid="`pp-contas-recurso-${l.id}`"
                    @acionar="recurso = l.id"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="proxima !== null" class="acoes">
          <SanteBotao
            variante="secundario"
            :rotulo="t('portalPrestador.contas.mais')"
            data-testid="pp-contas-mais"
            @acionar="carregar(proxima ?? undefined)"
          />
        </div>
      </section>
    </div>
  </PortalPrestadorCasca>
</template>

<style scoped>
.contas {
  display: grid;
  gap: var(--sgh-espaco-3);
  max-width: 64rem;
}
.painel {
  display: grid;
  gap: var(--sgh-espaco-2);
  padding: var(--sgh-espaco-3);
  border: 1px solid var(--sgh-borda);
  border-radius: var(--sgh-raio, 6px);
}
.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.subtitulo {
  font-size: 1rem;
  margin: 0;
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--sgh-borda);
}
.secundario {
  color: var(--p-text-muted-color);
  font-size: 0.9em;
  overflow-wrap: anywhere;
}
</style>
