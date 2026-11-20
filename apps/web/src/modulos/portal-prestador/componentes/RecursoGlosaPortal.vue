<script setup lang="ts">
// Portal do prestador, W0-10 (M8): as glosas de um lote e o recurso de glosa por item. O prestador marca os itens
// glosados de uma guia, diz o valor recorrido de cada um (até o glosado) e a justificativa de cada item e da guia, e
// confirma num painel próprio: a guia aceita um recurso só, que não se altera depois (só inclusão). A decisão da
// operadora aparece item a item. O servidor confere tudo de novo (o lote é do prestador da sessão; a versão; os valores).
import type { GlosasContaPortal } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { numeroDe } from '../../operadora/componentes/f1/comum.js';
import { glosasPortalPrestador, recorrerPortalPrestador } from '../api-portal-prestador.js';

type Guia = GlosasContaPortal['guias'][number];
type Marca = { marcado: boolean; valor: string; justificativa: string };

const props = defineProps<{ conta: number }>();
const emit = defineEmits<{ fechar: []; enviado: [] }>();
const { t } = useI18n();

const dados = ref<GlosasContaPortal | null>(null);
const erro = ref<unknown>(null);
const marcas = ref<Record<number, Marca>>({});
const justificativas = ref<Record<number, string>>({});
const confirmando = ref<number | null>(null);
const ocupado = ref(false);
const enviado = ref('');

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (d: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d;
const virgula = (v: number) => String(v).replace('.', ',');

async function carregar(): Promise<void> {
  erro.value = null;
  try {
    const g = await glosasPortalPrestador(props.conta);
    dados.value = g;
    const m: Record<number, Marca> = {};
    for (const guia of g.guias)
      for (const i of guia.itens) m[i.id] = { marcado: false, valor: virgula(i.glosado), justificativa: '' };
    marcas.value = m;
    justificativas.value = Object.fromEntries(g.guias.map((x) => [x.id, '']));
  } catch (x) {
    erro.value = x;
  }
}
onMounted(carregar);

const marcados = (g: Guia) => g.itens.filter((i) => i.recurso === null && marcas.value[i.id]?.marcado);
const total = (g: Guia) => marcados(g).reduce((s, i) => s + (numeroDe(marcas.value[i.id]!.valor) ?? 0), 0);
function completa(g: Guia): boolean {
  const ms = marcados(g);
  if (!ms.length || (justificativas.value[g.id] ?? '').trim().length < 10) return false;
  return ms.every((i) => {
    const m = marcas.value[i.id]!;
    const v = numeroDe(m.valor);
    return v !== null && v > 0 && v <= i.glosado && m.justificativa.trim().length >= 10;
  });
}
const aberta = computed(() => dados.value?.guias.find((g) => g.id === confirmando.value) ?? null);

async function enviar(g: Guia): Promise<void> {
  const d = dados.value;
  if (!d || ocupado.value || !completa(g)) return;
  ocupado.value = true;
  erro.value = null;
  try {
    await recorrerPortalPrestador(d.id, {
      versao: d.versao,
      guia: g.id,
      itens: marcados(g).map((i) => ({
        item: i.id,
        valor: numeroDe(marcas.value[i.id]!.valor) ?? 0,
        justificativa: marcas.value[i.id]!.justificativa.trim(),
      })),
      justificativa: (justificativas.value[g.id] ?? '').trim(),
    });
    enviado.value = t('portalPrestador.contas.recurso.enviado', { guia: g.numeroGuiaPrestador });
    confirmando.value = null;
    emit('enviado');
    await carregar();
  } catch (x) {
    erro.value = x;
    confirmando.value = null;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section
    class="painel"
    aria-labelledby="pp-recurso-titulo"
    :data-testid="`pp-contas-recurso-painel-${conta}`"
  >
    <div class="acoes cabeca">
      <h2 id="pp-recurso-titulo" class="subtitulo">
        {{
          dados
            ? t('portalPrestador.contas.recurso.titulo', {
                lote: dados.numeroLote,
                protocolo: dados.protocolo,
              })
            : t('portalPrestador.contas.recurso.abrir')
        }}
      </h2>
      <SanteBotao
        variante="texto"
        :rotulo="t('portalPrestador.contas.recurso.fechar')"
        data-testid="pp-contas-recurso-fechar"
        @acionar="emit('fechar')"
      />
    </div>
    <MensagemErro v-if="erro" :erro="erro" />
    <SanteAlerta
      v-if="enviado"
      :texto="enviado"
      variante="info"
      anunciar
      data-testid="pp-contas-recurso-enviado"
    />
    <template v-if="dados">
      <p v-if="!dados.guias.length" class="secundario">{{ t('portalPrestador.contas.recurso.semGlosa') }}</p>
      <p v-else-if="!dados.podeRecorrer" class="secundario" data-testid="pp-contas-recurso-nao">
        {{ t('portalPrestador.contas.recurso.naoRecorre') }}
      </p>
      <section
        v-for="g in dados.guias"
        :key="g.id"
        class="painel"
        :aria-labelledby="`pp-recurso-guia-${g.id}`"
        :data-testid="`pp-recurso-guia-${g.id}`"
      >
        <h3 :id="`pp-recurso-guia-${g.id}`" class="subtitulo">
          {{
            t('portalPrestador.contas.recurso.guia', {
              numero: g.numeroGuiaPrestador,
              apresentado: reais(g.apresentado),
              glosado: reais(g.glosado),
              acatado: reais(g.acatado),
            })
          }}
        </h3>
        <p v-if="g.recurso" :data-testid="`pp-recurso-guia-${g.id}-situacao`">
          {{
            t('portalPrestador.contas.recurso.situacaoGuia', {
              situacao: t(`portalPrestador.contas.recurso.situacoes.${g.recurso.situacao}`),
              valor: reais(g.recurso.valor),
            })
          }}
          <template v-if="g.recurso.parecer">
            · {{ t('portalPrestador.contas.recurso.parecer', { parecer: g.recurso.parecer }) }}</template
          >
        </p>
        <div class="rolagem">
          <table>
            <thead>
              <tr>
                <th v-if="g.recorrivel && dados.podeRecorrer" scope="col">
                  {{ t('portalPrestador.contas.recurso.colunas.marcar') }}
                </th>
                <th scope="col">{{ t('portalPrestador.contas.recurso.colunas.item') }}</th>
                <th scope="col">{{ t('portalPrestador.contas.recurso.colunas.glosado') }}</th>
                <th scope="col">{{ t('portalPrestador.contas.recurso.colunas.motivo') }}</th>
                <th scope="col">{{ t('portalPrestador.contas.recurso.colunas.recurso') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in g.itens" :key="i.id" :data-testid="`pp-recurso-item-${i.id}`">
                <td v-if="g.recorrivel && dados.podeRecorrer">
                  <input
                    v-if="marcas[i.id]"
                    v-model="marcas[i.id]!.marcado"
                    type="checkbox"
                    :aria-label="t('portalPrestador.contas.recurso.marcarItem', { item: i.codigo })"
                    :data-testid="`pp-recurso-marca-${i.id}`"
                  />
                </td>
                <td>{{ i.codigo }} · {{ i.descricao }}</td>
                <td>{{ reais(i.glosado) }}</td>
                <td>
                  <template v-if="i.motivo !== null">{{ i.motivo }} · {{ i.motivoNome }}</template>
                  <br v-if="i.justificativa" /><span v-if="i.justificativa" class="secundario">{{
                    i.justificativa
                  }}</span>
                </td>
                <td :data-testid="`pp-recurso-item-${i.id}-recurso`">
                  <template v-if="i.recurso">
                    {{
                      t('portalPrestador.contas.recurso.itemRecorrido', {
                        valor: reais(i.recurso.valor),
                        em: dataBr(i.recurso.em),
                      })
                    }}
                    <br />
                    <span class="secundario">{{
                      i.recurso.decisao
                        ? t('portalPrestador.contas.recurso.itemDecidido', {
                            valor: reais(i.recurso.decisao.valorAcatado),
                            parecer: i.recurso.decisao.parecer,
                          })
                        : t('portalPrestador.contas.recurso.itemPendente')
                    }}</span>
                  </template>
                  <div v-else-if="marcas[i.id]?.marcado" class="campos">
                    <SanteCampoTexto
                      :id="`pp-recurso-valor-${i.id}`"
                      v-model="marcas[i.id]!.valor"
                      :rotulo="
                        t('portalPrestador.contas.recurso.valorItem', {
                          item: i.codigo,
                          glosado: reais(i.glosado),
                        })
                      "
                      :max-bytes="16"
                      obrigatorio
                    />
                    <SanteCampoTexto
                      :id="`pp-recurso-justificativa-${i.id}`"
                      v-model="marcas[i.id]!.justificativa"
                      :rotulo="t('portalPrestador.contas.recurso.justificativaItem', { item: i.codigo })"
                      :max-bytes="1000"
                      multilinha
                      obrigatorio
                    />
                  </div>
                  <template v-else>—</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <template v-if="g.recorrivel && dados.podeRecorrer">
          <SanteCampoTexto
            :id="`pp-recurso-justificativa-guia-${g.id}`"
            v-model="justificativas[g.id]!"
            :rotulo="t('portalPrestador.contas.recurso.justificativaGuia')"
            :max-bytes="1000"
            multilinha
            obrigatorio
          />
          <p v-if="marcados(g).length && !completa(g)" class="secundario">
            {{ t('portalPrestador.contas.recurso.faltam') }}
          </p>
          <div v-if="confirmando !== g.id" class="acoes">
            <SanteBotao
              :rotulo="t('portalPrestador.contas.recurso.recorrer')"
              :desabilitado="!completa(g) || ocupado"
              :data-testid="`pp-recurso-recorrer-${g.id}`"
              @acionar="confirmando = g.id"
            />
          </div>
          <div
            v-else-if="aberta"
            class="painel confirma"
            role="group"
            :data-testid="`pp-recurso-confirma-${g.id}`"
          >
            <p>
              {{
                t('portalPrestador.contas.recurso.confirma', {
                  itens: marcados(aberta).length,
                  guia: aberta.numeroGuiaPrestador,
                  total: reais(total(aberta)),
                })
              }}
            </p>
            <div class="acoes">
              <SanteBotao
                :rotulo="t('portalPrestador.contas.recurso.confirmar')"
                :desabilitado="ocupado"
                :data-testid="`pp-recurso-confirmar-${g.id}`"
                @acionar="enviar(aberta)"
              />
              <SanteBotao
                variante="secundario"
                :rotulo="t('portalPrestador.contas.recurso.voltar')"
                :data-testid="`pp-recurso-voltar-${g.id}`"
                @acionar="confirmando = null"
              />
            </div>
          </div>
        </template>
      </section>
    </template>
  </section>
</template>

<style scoped>
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
.cabeca {
  justify-content: space-between;
  align-items: center;
}
.campos {
  display: grid;
  gap: var(--sgh-espaco-1);
  min-width: 14rem;
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
  vertical-align: top;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--sgh-borda);
}
.secundario {
  color: var(--p-text-muted-color);
  font-size: 0.9em;
  overflow-wrap: anywhere;
}
</style>
