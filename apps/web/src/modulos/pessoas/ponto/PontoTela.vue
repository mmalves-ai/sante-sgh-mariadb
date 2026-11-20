<script setup lang="ts">
// Ponto: importação e tratamento (M52.4; item `Gestão de pessoas > Ponto eletrônico (marcações, justificativas)`;
// `pessoas.ponto.ler` / `.importar`; regras 12 e 15): a importação do arquivo do relógio com o resultado (a quarentena
// mostra as falhas pelo código e pela linha), os arquivos importados, o período de cada colaborador na competência (com
// os filtros e o link para o espelho), os arquivos da competência (AEJ e eventos para a folha) e o aviso da biometria
// desligada. Os domínios do ponto do item seguem embutidos (CRUD genérico).
import {
  CODIGOS_TIPO_REP,
  type ArquivoAfdDetalhe,
  type FiltroArquivosAfdEntrada,
  type FiltroPontoEntrada,
  SITUACOES_AFD,
  TIPOS_REP,
  type TipoRep,
} from '@sgh/contratos';
import { horasMinutos } from '@sgh/dominio-pessoas';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import ErroPessoas from '../componentes/ErroPessoas.vue';
import { dataBr } from '../comum.js';
import {
  importarAfd,
  lerApoioPonto,
  lerArquivoAfd,
  lerArquivosAfd,
  lerPainelPonto,
  urlAej,
  urlEventosFolha,
} from './api-ponto.js';

type Situacao = FiltroPontoEntrada['situacao'];
const { t } = useI18n();
const cliente = useQueryClient();
const apoio = useQuery({ queryKey: ['ponto', 'apoio'], queryFn: lerApoioPonto });
const a = computed(() => apoio.data.value ?? null);
const competencia = ref('');
const comp = computed(() =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(competencia.value) ? competencia.value : (a.value?.competenciaPadrao ?? ''),
);
const situacao = ref<Situacao>('todos');
const termo = ref('');
const termoAplicado = ref('');
const pagina = ref(0);
const painel = useQuery({
  queryKey: computed(() => [
    'ponto',
    'painel',
    comp.value,
    situacao.value,
    termoAplicado.value,
    pagina.value,
  ]),
  queryFn: () =>
    lerPainelPonto({
      competencia: comp.value,
      situacao: situacao.value,
      ...(termoAplicado.value ? { termo: termoAplicado.value } : {}),
      pagina: pagina.value,
      limite: 50,
    }),
  enabled: computed(() => comp.value !== ''),
});
const pn = computed(() => painel.data.value ?? null);
// Os arquivos do relógio: a situação, o período coberto e a página; cada linha abre o detalhe com as falhas (regra 12).
const situacaoArq = ref<FiltroArquivosAfdEntrada['situacao']>('todos');
const deArq = ref<string | null>(null);
const ateArq = ref<string | null>(null);
const filtroArq = ref<{
  situacao: FiltroArquivosAfdEntrada['situacao'];
  de: string | null;
  ate: string | null;
}>({
  situacao: 'todos',
  de: null,
  ate: null,
});
const paginaArq = ref(0);
const arquivos = useQuery({
  queryKey: computed(() => ['ponto', 'arquivos', filtroArq.value, paginaArq.value]),
  queryFn: () =>
    lerArquivosAfd({
      situacao: filtroArq.value.situacao,
      ...(filtroArq.value.de ? { de: filtroArq.value.de } : {}),
      ...(filtroArq.value.ate ? { ate: filtroArq.value.ate } : {}),
      pagina: paginaArq.value,
      limite: 20,
    }),
});
const opcoesSituacaoArq = computed(() =>
  (['todos', 'importado', 'quarentena'] as const).map((s) => ({
    valor: s,
    rotulo: t(`ponto.arquivos.situacoes.${s}`),
  })),
);
function filtrarArquivos(): void {
  filtroArq.value = { situacao: situacaoArq.value, de: deArq.value, ate: ateArq.value };
  paginaArq.value = 0;
}
const detalheId = ref<number | null>(null);
const detalhe = useQuery({
  queryKey: computed(() => ['ponto', 'arquivo', detalheId.value]),
  queryFn: (): Promise<ArquivoAfdDetalhe> => lerArquivoAfd(detalheId.value!),
  enabled: computed(() => detalheId.value !== null),
});

const tipoRep = ref<TipoRep>('REP-C');
const modelo = ref<number | null>(null);
const arquivo = ref<File | null>(null);
const enviando = ref(false);
const erro = ref<unknown>(null);
const resultado = ref<Awaited<ReturnType<typeof importarAfd>> | null>(null);
const opcoesTipoRep = CODIGOS_TIPO_REP.map((c) => ({ valor: c, rotulo: TIPOS_REP[c] }));
const opcoesModelo = computed(() =>
  (a.value?.dominios.modelosRelogio ?? []).map((m) => ({ valor: m.codigo, rotulo: m.rotulo })),
);
const opcoesSituacao = computed(() =>
  (['todos', 'abertos', 'fechados', 'pendentes', 'sem-ciencia'] as const).map((s) => ({
    valor: s,
    rotulo: t(`ponto.painel.situacoes.${s}`),
  })),
);
function escolherArquivo(ev: Event): void {
  arquivo.value = (ev.target as HTMLInputElement).files?.[0] ?? null;
  resultado.value = null;
}
async function importar(): Promise<void> {
  if (!arquivo.value) return;
  erro.value = null;
  enviando.value = true;
  try {
    const conteudo = new TextDecoder('windows-1252').decode(await arquivo.value.arrayBuffer());
    resultado.value = await importarAfd({
      nome: arquivo.value.name.slice(0, 120),
      tipoRep: tipoRep.value,
      modelo: modelo.value,
      conteudo,
    });
    await cliente.invalidateQueries({ queryKey: ['ponto'] });
  } catch (x) {
    erro.value = x;
  } finally {
    enviando.value = false;
  }
}
function filtrar(): void {
  termoAplicado.value = termo.value.trim();
  pagina.value = 0;
}
</script>

<template>
  <section class="tela-pessoas" aria-labelledby="ponto-titulo" data-testid="tela-ponto">
    <h1 id="ponto-titulo">{{ t('ponto.titulo') }}</h1>
    <p>{{ t('ponto.subtitulo') }}</p>
    <ErroPessoas v-if="apoio.isError.value" :erro="apoio.error.value" />
    <p v-else-if="!a" role="status">{{ t('ponto.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        v-if="!a.gravacao.ligada"
        :texto="a.gravacao.motivo ?? ''"
        variante="info"
        data-testid="ponto-gravacao-desligada"
      />
      <SanteAlerta v-else-if="a.acoes.motivo" :texto="a.acoes.motivo" variante="info" />
      <SanteAlerta :texto="a.biometria.motivo" variante="info" data-testid="ponto-biometria" />

      <form
        v-if="a.acoes.importar"
        class="bloco"
        :aria-label="t('ponto.importacao.titulo')"
        data-testid="form-importar-afd"
        @submit.prevent="importar"
      >
        <h2>{{ t('ponto.importacao.titulo') }}</h2>
        <p class="secundario">{{ t('ponto.importacao.ajuda') }}</p>
        <div class="campos">
          <div class="campo-arquivo">
            <label for="ponto-arquivo">{{ t('ponto.importacao.arquivo') }}</label>
            <input
              id="ponto-arquivo"
              type="file"
              accept=".txt,.afd,text/plain"
              data-testid="ponto-arquivo"
              @change="escolherArquivo"
            />
          </div>
          <SanteSelecao
            v-model="tipoRep"
            :rotulo="t('ponto.importacao.tipoRep')"
            :opcoes="opcoesTipoRep"
            data-testid="ponto-tipo-rep"
          />
          <SanteSelecao
            v-model="modelo"
            :rotulo="t('ponto.importacao.modelo')"
            :opcoes="opcoesModelo"
            data-testid="ponto-modelo"
          />
        </div>
        <ErroPessoas v-if="erro" :erro="erro" />
        <div class="acoes">
          <SanteBotao
            :rotulo="enviando ? t('ponto.importacao.lendo') : t('ponto.importacao.importar')"
            tipo="submit"
            :desabilitado="!arquivo || enviando"
            data-testid="ponto-importar"
          />
        </div>
        <div v-if="resultado" data-testid="ponto-resultado-importacao">
          <SanteAlerta
            :texto="resultado.mensagem"
            :variante="resultado.situacao === 'importado' ? 'info' : 'aviso'"
            anunciar
          />
          <template v-if="resultado.falhas.length > 0">
            <h3>{{ t('ponto.importacao.falhas') }}</h3>
            <ul data-testid="ponto-falhas">
              <li v-for="(f, i) in resultado.falhas" :key="i">
                {{ f.rotulo }} ·
                {{
                  f.linha !== null
                    ? t('ponto.importacao.linha', { n: f.linha })
                    : t('ponto.importacao.arquivoTodo')
                }}
              </li>
            </ul>
          </template>
        </div>
      </form>

      <section class="bloco" aria-labelledby="ponto-arquivos" data-testid="ponto-arquivos">
        <h2 id="ponto-arquivos">{{ t('ponto.arquivos.titulo') }}</h2>
        <form class="campos" :aria-label="t('ponto.arquivos.titulo')" @submit.prevent="filtrarArquivos">
          <SanteSelecao
            v-model="situacaoArq"
            :rotulo="t('ponto.arquivos.situacao')"
            :opcoes="opcoesSituacaoArq"
            data-testid="arquivos-situacao"
          />
          <SanteData v-model="deArq" :rotulo="t('ponto.arquivos.de_')" editavel data-testid="arquivos-de" />
          <SanteData
            v-model="ateArq"
            :rotulo="t('ponto.arquivos.ate_')"
            editavel
            data-testid="arquivos-ate"
          />
          <SanteBotao :rotulo="t('ponto.arquivos.filtrar')" tipo="submit" data-testid="arquivos-filtrar" />
        </form>
        <ErroPessoas v-if="arquivos.isError.value" :erro="arquivos.error.value" />
        <p v-else-if="(arquivos.data.value?.itens.length ?? 0) === 0">{{ t('ponto.nenhum') }}</p>
        <table v-else class="tabela">
          <thead>
            <tr>
              <th scope="col">{{ t('ponto.arquivos.nome') }}</th>
              <th scope="col">{{ t('ponto.arquivos.situacao') }}</th>
              <th scope="col">{{ t('ponto.arquivos.periodo') }}</th>
              <th scope="col">{{ t('ponto.arquivos.novas') }}</th>
              <th scope="col">{{ t('ponto.arquivos.jaImportadas') }}</th>
              <th scope="col">{{ t('ponto.arquivos.semColaborador') }}</th>
              <th scope="col">{{ t('ponto.arquivos.falhas') }}</th>
              <th scope="col">{{ t('ponto.arquivos.importadoPor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in arquivos.data.value?.itens ?? []" :key="x.id" :data-testid="`arquivo-${x.id}`">
              <th scope="row">
                <button
                  type="button"
                  class="ligacao"
                  :aria-label="t('ponto.arquivos.abrir', { nome: x.nome })"
                  :aria-expanded="detalheId === x.id"
                  :data-testid="`abrir-arquivo-${x.id}`"
                  @click="detalheId = detalheId === x.id ? null : x.id"
                >
                  {{ x.nome }}
                </button>
              </th>
              <td>{{ SITUACOES_AFD[x.situacao] }}</td>
              <td>{{ t('ponto.arquivos.de', { de: dataBr(x.de), ate: dataBr(x.ate) }) }}</td>
              <td>{{ x.novas }}</td>
              <td>{{ x.jaImportadas }}</td>
              <td>{{ x.semColaborador }}</td>
              <td>{{ x.totalFalhas }}</td>
              <td>
                {{ x.importadoPor }} <span class="secundario">{{ dataBr(x.importadoEm.slice(0, 10)) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div
          v-if="arquivos.data.value && (arquivos.data.value.pagina > 0 || arquivos.data.value.temMais)"
          class="acoes"
        >
          <SanteBotao
            :rotulo="t('ponto.painel.anterior')"
            variante="texto"
            :desabilitado="arquivos.data.value.pagina === 0"
            @acionar="paginaArq--"
          />
          <span>{{ t('ponto.arquivos.paginaN', { p: arquivos.data.value.pagina + 1 }) }}</span>
          <SanteBotao
            :rotulo="t('ponto.painel.proxima')"
            variante="texto"
            :desabilitado="!arquivos.data.value.temMais"
            data-testid="arquivos-proxima"
            @acionar="paginaArq++"
          />
        </div>
        <div
          v-if="detalheId !== null"
          class="bloco"
          role="region"
          :aria-label="t('ponto.arquivos.titulo')"
          data-testid="arquivo-detalhe"
        >
          <ErroPessoas v-if="detalhe.isError.value" :erro="detalhe.error.value" />
          <p v-else-if="!detalhe.data.value" role="status">{{ t('ponto.carregando') }}</p>
          <template v-else>
            <h3>{{ t('ponto.arquivos.detalhe', { nome: detalhe.data.value.nome }) }}</h3>
            <p>
              {{ SITUACOES_AFD[detalhe.data.value.situacao] }} · {{ TIPOS_REP[detalhe.data.value.tipoRep] }}
              <template v-if="detalhe.data.value.modelo"> · {{ detalhe.data.value.modelo }}</template>
              <template v-if="detalhe.data.value.numeroRep">
                · {{ t('ponto.arquivos.relogio', { numero: detalhe.data.value.numeroRep }) }}</template
              >
              <template v-if="detalhe.data.value.de">
                ·
                {{
                  t('ponto.arquivos.de', {
                    de: dataBr(detalhe.data.value.de),
                    ate: dataBr(detalhe.data.value.ate),
                  })
                }}</template
              >
            </p>
            <p data-testid="arquivo-detalhe-contagem">
              {{
                t('ponto.arquivos.contagem', {
                  marcacoes: detalhe.data.value.marcacoes,
                  novas: detalhe.data.value.novas,
                  ja: detalhe.data.value.jaImportadas,
                  sem: detalhe.data.value.semColaborador,
                })
              }}
            </p>
            <p v-if="detalhe.data.value.falhas.length === 0">{{ t('ponto.arquivos.semFalhas') }}</p>
            <template v-else>
              <p class="secundario">
                {{ t('ponto.arquivos.falhasTotal', { n: detalhe.data.value.totalFalhas }) }}
              </p>
              <ul data-testid="arquivo-detalhe-falhas">
                <li v-for="(f, i) in detalhe.data.value.falhas" :key="i">
                  {{ f.rotulo }} ·
                  {{
                    f.linha !== null
                      ? t('ponto.importacao.linha', { n: f.linha })
                      : t('ponto.importacao.arquivoTodo')
                  }}
                </li>
              </ul>
            </template>
            <div class="acoes">
              <SanteBotao :rotulo="t('ponto.arquivos.fechar')" variante="texto" @acionar="detalheId = null" />
            </div>
          </template>
        </div>
      </section>

      <section class="bloco" aria-labelledby="ponto-painel" data-testid="ponto-painel">
        <h2 id="ponto-painel">{{ t('ponto.painel.titulo') }}</h2>
        <form class="campos" :aria-label="t('ponto.painel.titulo')" @submit.prevent="filtrar">
          <SanteCampoTexto
            v-model="competencia"
            :rotulo="t('ponto.competencia')"
            :max-bytes="7"
            data-testid="ponto-competencia"
          />
          <SanteSelecao
            v-model="situacao"
            :rotulo="t('ponto.painel.situacao')"
            :opcoes="opcoesSituacao"
            data-testid="ponto-situacao"
          />
          <SanteCampoTexto v-model="termo" :rotulo="t('ponto.painel.termo')" :max-bytes="60" />
          <SanteBotao :rotulo="t('ponto.buscar')" tipo="submit" data-testid="ponto-filtrar" />
        </form>
        <ErroPessoas v-if="painel.isError.value" :erro="painel.error.value" />
        <p v-else-if="!pn" role="status">{{ t('ponto.carregando') }}</p>
        <template v-else>
          <p class="secundario" data-testid="ponto-contagens">
            {{
              t('ponto.painel.contagens', {
                abertos: pn.contagens.abertos,
                fechados: pn.contagens.fechados,
                pendentes: pn.contagens.comAjustePendente,
                semCiencia: pn.contagens.semCiencia,
              })
            }}
          </p>
          <p v-if="pn.itens.length === 0">{{ t('ponto.nenhum') }}</p>
          <table v-else class="tabela" data-testid="ponto-tabela-painel">
            <thead>
              <tr>
                <th scope="col">{{ t('ponto.painel.colaborador') }}</th>
                <th scope="col">{{ t('ponto.painel.lotacao') }}</th>
                <th scope="col">{{ t('ponto.painel.estado') }}</th>
                <th scope="col">{{ t('ponto.painel.marcacoes') }}</th>
                <th scope="col">{{ t('ponto.painel.pendentes') }}</th>
                <th scope="col">{{ t('ponto.painel.ciencia') }}</th>
                <th scope="col">{{ t('ponto.painel.saldo') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in pn.itens" :key="l.vinculo" :data-testid="`painel-${l.vinculo}`">
                <th scope="row">
                  <RouterLink
                    :to="`/pessoas/ponto/${l.vinculo}/${pn.competencia}`"
                    :aria-label="t('ponto.painel.abrirEspelho', { nome: l.nome })"
                  >
                    {{ l.nome }}
                  </RouterLink>
                  <span v-if="l.matricula" class="secundario"> · {{ l.matricula }}</span>
                </th>
                <td>{{ [l.unidadeNome, l.setor].filter(Boolean).join(' · ') }}</td>
                <td>{{ l.estado === 'fechado' ? t('ponto.painel.fechado') : t('ponto.painel.aberto') }}</td>
                <td>{{ l.marcacoes }}</td>
                <td>{{ l.ajustesPendentes }}</td>
                <td>{{ l.estado === 'fechado' ? (l.ciencia ? '✓' : '—') : '' }}</td>
                <td>{{ l.saldoBancoMin !== null ? horasMinutos(l.saldoBancoMin) : '' }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="pn.paginas > 1" class="acoes">
            <SanteBotao
              :rotulo="t('ponto.painel.anterior')"
              variante="texto"
              :desabilitado="pn.pagina === 0"
              @acionar="pagina--"
            />
            <span>{{ t('ponto.painel.pagina', { p: pn.pagina + 1, t: pn.paginas }) }}</span>
            <SanteBotao
              :rotulo="t('ponto.painel.proxima')"
              variante="texto"
              :desabilitado="pn.pagina + 1 >= pn.paginas"
              @acionar="pagina++"
            />
          </div>
        </template>
      </section>

      <section
        v-if="a.acoes.exportar && comp"
        class="bloco"
        aria-labelledby="ponto-exportar"
        data-testid="ponto-exportar"
      >
        <h2 id="ponto-exportar">{{ t('ponto.exportar.titulo') }}</h2>
        <p class="secundario">{{ t('ponto.exportar.ajuda') }}</p>
        <div class="acoes">
          <a :href="urlAej(comp)" data-testid="ponto-aej">{{ t('ponto.exportar.aej') }}</a>
          <a :href="urlEventosFolha(comp)" data-testid="ponto-eventos-folha">{{
            t('ponto.exportar.eventos')
          }}</a>
        </div>
      </section>
    </template>
    <GrupoDominiosTela subitem="rhPontoEletronicoMarcacoesJustificativas" embutida />
  </section>
</template>

<style scoped src="../estilo-pessoas.css"></style>
<style scoped>
.campo-arquivo {
  display: grid;
  gap: 0.25rem;
}
.campo-arquivo input {
  min-height: 24px;
}
.ligacao {
  min-height: 24px;
  padding: 0;
  border: none;
  background: none;
  color: var(--sgh-primaria);
  font: inherit;
  text-align: start;
  text-decoration: underline;
  cursor: pointer;
}
</style>
