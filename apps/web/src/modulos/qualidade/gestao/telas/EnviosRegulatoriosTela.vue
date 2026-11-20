<script setup lang="ts">
// Relatórios e BI › Envios regulatórios (PM-QUALISS, IRAS, Notivisa) (M48, etapa 5; ficha, seção 7; regra 10; manual
// "Envios regulatórios"). Para cada envio: gerar o arquivo da competência (com o resumo SHA-256; gerar de novo
// substitui o ainda não transmitido), baixar o arquivo gerado de novo pelo servidor (conferido com o resumo gravado) e
// registrar a transmissão feita no portal, com o protocolo e o resumo do arquivo enviado. Nenhum canal recebe envio
// automático (só em produção e com a autorização do dono para cada canal).
import '../../componentes/estilo-qualidade.css';
import '../../ccih/componentes/estilo-ccih.css';
import '../componentes/estilo-gestao.css';
import { rotuloSituacaoEnvioRegulatorio, type TipoEnvioRegulatorio } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteHora, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dataHora } from '../../regras-qualidade.js';
import {
  type EnvioTela,
  gerarEnvio,
  lerArquivoEnvio,
  lerEnvios,
  novaChaveGestao,
  registrarTransmissao,
} from '../api-gestao.js';
import ErroGestao from '../componentes/ErroGestao.vue';
import ErrosFormulario from '../componentes/ErrosFormulario.vue';
import NavGestao from '../componentes/NavGestao.vue';
import {
  baixarTexto,
  competenciaBr,
  competenciasRecentes,
  montarTransmissao,
  textoDoResumo,
} from '../regras-gestao.js';

const { t } = useI18n();
const cliente = useQueryClient();
const lista = useQuery({ queryKey: ['gestaoQualidade', 'envios'], queryFn: lerEnvios });
const podeGerar = computed(() => lista.data.value?.podeGerar ?? false);
const agora = computed(() => lista.data.value?.agora ?? '');

const competencias = reactive<Record<TipoEnvioRegulatorio, string>>({
  pmQualiss: '',
  iras: '',
  notivisa: '',
});
const opCompetencias = computed(() =>
  lista.data.value
    ? competenciasRecentes(lista.data.value.competenciaSugerida).map((c) => ({
        valor: c,
        rotulo: competenciaBr(c),
      }))
    : [],
);
watch(
  () => lista.data.value,
  (d) => {
    if (!d) return;
    for (const x of d.tipos) if (!competencias[x.codigo]) competencias[x.codigo] = d.competenciaSugerida;
  },
  { immediate: true },
);
const comHistorico = ref(false);
const doTipo = (tipo: TipoEnvioRegulatorio): EnvioTela[] =>
  (lista.data.value?.itens ?? []).filter(
    (e) => e.tipo === tipo && (comHistorico.value || e.situacao !== 'substituido'),
  );

const aviso = ref<string | null>(null);
const erro = ref<unknown>(null);
const gerando = ref<string | null>(null);
const chaves: Record<string, string> = {};
const chave = (k: string) => (chaves[k] ??= novaChaveGestao(k));
async function gerar(tipo: TipoEnvioRegulatorio): Promise<void> {
  erro.value = null;
  aviso.value = null;
  gerando.value = tipo;
  try {
    const r = await gerarEnvio({ tipo, competencia: competencias[tipo] }, chave(`gerar-${tipo}`));
    delete chaves[`gerar-${tipo}`];
    baixados[r.id] = { hash: r.hash, igual: true };
    baixarTexto(r.arquivo, r.conteudo);
    aviso.value = t('gestaoQualidade.envios.gerado', { arquivo: r.arquivo, linhas: r.linhas });
    await cliente.invalidateQueries({ queryKey: ['gestaoQualidade', 'envios'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gerando.value = null;
  }
}

/** O arquivo baixado nesta sessão (gerado de novo pelo servidor) e se os dados são os da geração. */
const baixados = reactive<Record<number, { hash: string; igual: boolean }>>({});
async function baixar(e: EnvioTela): Promise<void> {
  erro.value = null;
  try {
    const a = await lerArquivoEnvio(e.id);
    baixados[e.id] = { hash: a.hash, igual: a.igual };
    baixarTexto(a.arquivo, a.conteudo);
  } catch (x) {
    erro.value = x;
  }
}

const transmitindo = ref<EnvioTela | null>(null);
const ft = reactive({ data: null as string | null, hora: null as string | null, protocolo: '', hash: '' });
const erros = ref<Record<string, string>>({});
function abrirTransmissao(e: EnvioTela): void {
  transmitindo.value = e;
  erros.value = {};
  ft.data = agora.value.slice(0, 10) || null;
  ft.hora = agora.value.slice(11, 16) || null;
  ft.protocolo = '';
  ft.hash = baixados[e.id]?.igual ? (baixados[e.id]?.hash ?? '') : '';
}
const gravando = ref(false);
async function transmitir(): Promise<void> {
  const e = transmitindo.value;
  if (!e) return;
  erro.value = null;
  const m = montarTransmissao(e, ft);
  if (!m.ok) {
    erros.value = { ...m.erros };
    return;
  }
  erros.value = {};
  gravando.value = true;
  try {
    await registrarTransmissao(e.id, m.entrada, chave(`transmitir-${e.id}`));
    delete chaves[`transmitir-${e.id}`];
    transmitindo.value = null;
    aviso.value = t('gestaoQualidade.envios.form.gravada');
    await cliente.invalidateQueries({ queryKey: ['gestaoQualidade', 'envios'] });
  } catch (x) {
    erro.value = x;
  } finally {
    gravando.value = false;
  }
}
</script>

<template>
  <section class="tela-gestao" aria-labelledby="envios-titulo" data-testid="tela-envios">
    <NavGestao />
    <h1 id="envios-titulo">{{ t('gestaoQualidade.envios.titulo') }}</h1>
    <p class="secundario">{{ t('gestaoQualidade.envios.explicacao') }}</p>
    <SanteAlerta
      v-if="lista.data.value && !lista.data.value.ligada"
      variante="info"
      :texto="lista.data.value.motivo ?? t('gestaoQualidade.desligado')"
      data-testid="gestao-desligada"
    />
    <div v-if="aviso" role="status" data-testid="gestao-aviso">{{ aviso }}</div>
    <ErroGestao v-if="erro" :erro="erro" />
    <ErroGestao v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('gestaoQualidade.carregando') }}</p>
    <template v-else>
      <label class="marcar-gestao"
        ><input v-model="comHistorico" type="checkbox" data-testid="envios-historico" />
        {{ t('gestaoQualidade.envios.historico') }}</label
      >
      <section
        v-for="tp in lista.data.value.tipos"
        :key="tp.codigo"
        class="painel-ccih"
        :aria-labelledby="`envio-${tp.codigo}-titulo`"
        :data-testid="`envio-${tp.codigo}`"
      >
        <h2 :id="`envio-${tp.codigo}-titulo`">{{ tp.rotulo }}</h2>
        <p class="secundario">{{ t('gestaoQualidade.envios.destino', { destino: tp.destino }) }}</p>
        <div v-if="podeGerar" class="linha-ccih">
          <SanteSelecao
            v-model="competencias[tp.codigo]"
            :rotulo="t('gestaoQualidade.competencia')"
            :opcoes="opCompetencias"
            :data-testid="`envio-competencia-${tp.codigo}`"
          />
          <SanteBotao
            :rotulo="t('gestaoQualidade.envios.gerar')"
            :desabilitado="gerando !== null"
            :data-testid="`envio-gerar-${tp.codigo}`"
            @acionar="gerar(tp.codigo)"
          />
        </div>
        <p v-if="podeGerar" class="secundario">{{ t('gestaoQualidade.envios.regerarAviso') }}</p>
        <p v-if="!doTipo(tp.codigo).length">{{ t('gestaoQualidade.envios.nenhum') }}</p>
        <table v-else class="tabela" :data-testid="`tabela-envios-${tp.codigo}`">
          <caption>
            {{
              t('gestaoQualidade.envios.legenda', { tipo: tp.rotulo })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('gestaoQualidade.envios.colCompetencia') }}</th>
              <th scope="col">{{ t('gestaoQualidade.envios.colArquivo') }}</th>
              <th scope="col">{{ t('gestaoQualidade.envios.colResumo') }}</th>
              <th scope="col">{{ t('gestaoQualidade.envios.colHash') }}</th>
              <th scope="col">{{ t('gestaoQualidade.envios.colSituacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in doTipo(tp.codigo)" :key="e.id" :data-testid="`envio-linha-${e.id}`">
              <td>{{ competenciaBr(e.competencia) }}</td>
              <td>
                {{ e.arquivo }}
                <div class="secundario">
                  {{
                    t('gestaoQualidade.registradoPor', { usuario: e.geradoPor, data: dataHora(e.geradoEm) })
                  }}
                </div>
                <SanteBotao
                  variante="texto"
                  :rotulo="t('gestaoQualidade.envios.baixar')"
                  :data-testid="`envio-baixar-${e.id}`"
                  @acionar="baixar(e)"
                />
                <p
                  v-if="baixados[e.id]"
                  :class="baixados[e.id]?.igual ? 'prazo prazo--cumprido' : 'prazo prazo--vencido'"
                  :data-testid="`envio-conferido-${e.id}`"
                >
                  {{
                    baixados[e.id]?.igual
                      ? t('gestaoQualidade.envios.conferido')
                      : t('gestaoQualidade.envios.mudou')
                  }}
                </p>
              </td>
              <td>
                {{
                  t('gestaoQualidade.envios.linhasResumo', {
                    linhas: e.linhas,
                    resumo: textoDoResumo(e.resumo),
                  })
                }}
              </td>
              <td class="hash-gestao">{{ e.hash }}</td>
              <td>
                {{ rotuloSituacaoEnvioRegulatorio(e.situacao) }}
                <div v-if="e.situacao === 'transmitido'" class="secundario">
                  {{
                    t('gestaoQualidade.envios.transmitido', {
                      data: dataHora(e.transmitidoEm),
                      protocolo: e.protocolo ?? '',
                    })
                  }}
                </div>
                <SanteBotao
                  v-if="podeGerar && e.situacao === 'gerado' && transmitindo?.id !== e.id"
                  variante="secundario"
                  :rotulo="t('gestaoQualidade.envios.transmitir')"
                  :data-testid="`envio-transmitir-${e.id}`"
                  @acionar="abrirTransmissao(e)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <form
          v-if="transmitindo && transmitindo.tipo === tp.codigo"
          class="painel-ccih"
          data-testid="form-transmissao"
          @submit.prevent="transmitir"
        >
          <h3>{{ t('gestaoQualidade.envios.form.titulo', { arquivo: transmitindo.arquivo }) }}</h3>
          <p class="secundario">{{ t('gestaoQualidade.envios.form.explicacao') }}</p>
          <div class="linha-ccih">
            <SanteData
              v-model="ft.data"
              :rotulo="t('gestaoQualidade.envios.form.data')"
              editavel
              data-testid="tx-data"
            />
            <SanteHora
              v-model="ft.hora"
              :rotulo="t('gestaoQualidade.envios.form.hora')"
              editavel
              data-testid="tx-hora"
            />
            <SanteCampoTexto
              v-model="ft.protocolo"
              :rotulo="t('gestaoQualidade.envios.form.protocolo')"
              :max-bytes="40"
              obrigatorio
              data-testid="tx-protocolo"
            />
          </div>
          <SanteCampoTexto
            v-model="ft.hash"
            :rotulo="t('gestaoQualidade.envios.form.hash')"
            :max-bytes="64"
            obrigatorio
            data-testid="tx-hash"
          />
          <ErrosFormulario :erros="erros" />
          <div class="linha-ccih">
            <SanteBotao
              tipo="submit"
              :rotulo="t('gestaoQualidade.gravar')"
              :desabilitado="gravando"
              data-testid="tx-gravar"
            />
            <SanteBotao
              :rotulo="t('gestaoQualidade.cancelar')"
              variante="texto"
              @acionar="transmitindo = null"
            />
          </div>
        </form>
      </section>
    </template>
  </section>
</template>
