<script setup lang="ts">
// Painel de cargas dos catálogos oficiais (M13, ficha seção 7): cada catálogo, quem o carrega hoje, a última carga
// feita aqui, a edição que o banco tem, o atraso, os erros e a licença; o envio do arquivo oficial (preparação,
// validação e comparação; nada é publicado sem aprovação) e as cargas recentes.
import { CATALOGOS, type CharsetArquivoCatalogo, type CodigoCatalogo } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import { buscarPainel, enviarCarga, listarCargas } from '../api-catalogos.js';
import { lerArquivoOficial } from '../arquivo.js';

const { t } = useI18n();
const router = useRouter();
const painel = useQuery({ queryKey: ['catalogos', 'painel'], queryFn: buscarPainel });
const cargas = useQuery({ queryKey: ['catalogos', 'cargas'], queryFn: () => listarCargas(null) });
// O catálogo pode vir escolhido pela rota (ex.: o atalho da tela de materiais e medicamentos: ?catalogo=brasindice).
const escolhido =
  CATALOGOS.find((c) => c.codigo === router.currentRoute.value.query['catalogo'])?.codigo ?? '';
const nova = reactive<{ catalogo: CodigoCatalogo | ''; edicao: string }>({ catalogo: escolhido, edicao: '' });
const opcoesCatalogo = CATALOGOS.map((c) => ({ valor: c.codigo as CodigoCatalogo | '', rotulo: c.titulo }));
const arquivos = ref<{ nome: string; conteudo: string; charset?: CharsetArquivoCatalogo }[]>([]);
const colado = reactive({ nome: '', conteudo: '' });
const enviando = ref(false);
const recusa = ref<string | null>(null);
const erro = ref<unknown>(null);
const aceitos = computed(
  () =>
    CATALOGOS.find((c) => c.codigo === nova.catalogo)
      ?.arquivos.map((a) => a.padrao)
      .join(', ') ?? '',
);

async function lerArquivos(ev: Event): Promise<void> {
  const lista = (ev.target as HTMLInputElement).files;
  if (!lista) return;
  // Bytes decodificados como UTF-8 ou, se não forem UTF-8 válido, Windows-1252 (arquivos oficiais em Latin-1).
  const lidos: { nome: string; conteudo: string; charset: CharsetArquivoCatalogo }[] = [];
  for (const f of Array.from(lista)) lidos.push(await lerArquivoOficial(f));
  arquivos.value = lidos;
}
function adicionarColado(): void {
  if (!colado.nome || !colado.conteudo) return;
  arquivos.value = [...arquivos.value, { nome: colado.nome, conteudo: colado.conteudo }];
  colado.nome = '';
  colado.conteudo = '';
}
async function preparar(): Promise<void> {
  if (!nova.catalogo || arquivos.value.length === 0) return;
  recusa.value = null;
  erro.value = null;
  enviando.value = true;
  try {
    const r = await enviarCarga({
      catalogo: nova.catalogo,
      arquivos: arquivos.value,
      ...(nova.edicao ? { edicao: nova.edicao } : {}),
    });
    await router.push({ name: 'catalogos.carga', params: { id: String(r.id) } });
  } catch (e) {
    if (e instanceof ErroApi && e.problema?.detail && [400, 403, 409].includes(e.status))
      recusa.value = e.problema.detail;
    else erro.value = e;
  } finally {
    enviando.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="painel-titulo">
    <h1 id="painel-titulo">{{ t('catalogos.painel.titulo') }}</h1>
    <p>{{ t('catalogos.painel.texto') }}</p>
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-if="painel.data.value" data-testid="janela-publicacao">
      {{
        t('catalogos.painel.janela', {
          inicio: painel.data.value.janela.inicio,
          fim: painel.data.value.janela.fim,
          agora: painel.data.value.janela.agoraDentro
            ? t('catalogos.painel.dentro')
            : t('catalogos.painel.fora'),
        })
      }}
    </p>
    <div class="rolagem" tabindex="0" role="region" :aria-label="t('catalogos.comum.tabela')">
      <table data-testid="tabela-painel">
        <caption>
          {{
            t('catalogos.painel.titulo')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('catalogos.painel.catalogo') }}</th>
            <th scope="col">{{ t('catalogos.painel.responsavel') }}</th>
            <th scope="col">{{ t('catalogos.painel.ultimaCarga') }}</th>
            <th scope="col">{{ t('catalogos.painel.noBanco') }}</th>
            <th scope="col">{{ t('catalogos.painel.atraso') }}</th>
            <th scope="col">{{ t('catalogos.painel.erros') }}</th>
            <th scope="col">{{ t('catalogos.painel.licenca') }}</th>
            <th scope="col">{{ t('catalogos.painel.consultar') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in painel.data.value?.catalogos ?? []"
            :key="c.codigo"
            :data-testid="`painel-${c.codigo}`"
          >
            <th scope="row">{{ c.titulo }}</th>
            <td :data-testid="`responsavel-${c.codigo}`">
              {{ t(`catalogos.painel.responsaveis.${c.responsavel}`) }}
            </td>
            <td>
              <template v-if="c.ultimaCarga">
                <RouterLink :to="{ name: 'catalogos.carga', params: { id: String(c.ultimaCarga.id) } }">
                  {{ c.ultimaCarga.id }}
                </RouterLink>
                · {{ t(`catalogos.situacoes.${c.ultimaCarga.situacao}`) }} · {{ c.ultimaCarga.quando }}
              </template>
              <template v-else>{{ t('catalogos.painel.nenhumaCarga') }}</template>
            </td>
            <td>
              {{ c.edicaoNoBanco.descricao }} {{ c.edicaoNoBanco.valor ?? '' }} ({{
                c.edicaoNoBanco.linhas.toLocaleString('pt-BR')
              }})
            </td>
            <td>{{ c.atraso ?? '' }}</td>
            <td>{{ c.erros }}</td>
            <td>
              {{
                !c.licenca.exigida
                  ? t('catalogos.painel.licencaOk')
                  : c.licenca.vigente
                    ? t('catalogos.painel.licencaVigente')
                    : (c.licenca.motivo ?? '')
              }}
            </td>
            <td>
              <RouterLink :to="c.rota">{{ t('catalogos.painel.consultar') }}</RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <section v-if="pode('catalogo.carga.criar')" class="painel" aria-labelledby="enviar-titulo">
      <h2 id="enviar-titulo">{{ t('catalogos.painel.enviar') }}</h2>
      <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="recusa-envio" />
      <MensagemErro v-if="erro" :erro="erro" />
      <form class="form" data-testid="form-envio" @submit.prevent="preparar">
        <div class="campo">
          <SanteSelecao
            id="env-catalogo"
            v-model="nova.catalogo"
            obrigatorio
            :rotulo="t('catalogos.painel.escolha')"
            :opcoes="opcoesCatalogo"
            data-testid="envio-catalogo"
          />
        </div>
        <p v-if="aceitos">{{ t('catalogos.painel.arquivosAjuda', { lista: aceitos }) }}</p>
        <div class="campo">
          <label for="env-arquivos">{{ t('catalogos.painel.arquivos') }}</label>
          <input
            id="env-arquivos"
            type="file"
            multiple
            accept=".csv,.txt,text/plain,text/csv"
            @change="lerArquivos"
          />
        </div>
        <div class="campo">
          <label for="env-nome">{{ t('catalogos.painel.nomeArquivo') }}</label>
          <input id="env-nome" v-model="colado.nome" maxlength="120" data-testid="envio-nome" />
        </div>
        <div class="campo">
          <label for="env-conteudo">{{ t('catalogos.painel.conteudo') }}</label>
          <textarea id="env-conteudo" v-model="colado.conteudo" rows="5" data-testid="envio-conteudo" />
        </div>
        <SanteBotao
          :rotulo="t('catalogos.painel.adicionar')"
          variante="secundario"
          data-testid="envio-adicionar"
          @acionar="adicionarColado"
        />
        <ul v-if="arquivos.length" data-testid="envio-lista">
          <li v-for="a in arquivos" :key="a.nome">{{ a.nome }}</li>
        </ul>
        <div class="campo">
          <label for="env-edicao">{{ t('catalogos.painel.edicao') }}</label>
          <input id="env-edicao" v-model="nova.edicao" maxlength="12" data-testid="envio-edicao" />
        </div>
        <SanteBotao
          :rotulo="enviando ? t('catalogos.painel.preparando') : t('catalogos.painel.preparar')"
          tipo="submit"
          :desabilitado="enviando"
          data-testid="envio-preparar"
        />
      </form>
    </section>

    <section class="painel" aria-labelledby="recentes-titulo">
      <h2 id="recentes-titulo">{{ t('catalogos.painel.recentes') }}</h2>
      <MensagemErro v-if="cargas.isError.value" :erro="cargas.error.value" />
      <ul data-testid="lista-cargas">
        <li v-for="c in cargas.data.value?.cargas ?? []" :key="c.id">
          {{ c.id }} — {{ c.catalogo }} · {{ c.arquivo }} ·
          <strong>{{ t(`catalogos.situacoes.${c.situacao}`) }}</strong>
          <RouterLink
            :to="{ name: 'catalogos.carga', params: { id: String(c.id) } }"
            :data-testid="`abrir-carga-${c.id}`"
          >
            {{ t('catalogos.painel.abrir') }}
          </RouterLink>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.form,
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
  max-width: 44rem;
  margin: var(--sgh-espaco-2) 0;
}
.painel {
  margin-top: var(--sgh-espaco-3);
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
}
input,
select,
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
</style>
