<script setup lang="ts">
// "Termo de aceite de uso do prontuário" (M10, ficha seção 7 e regra 11; W1-01 parte 6b): o texto vigente, as versões
// (a vigente e as anteriores) e os aceites de cada uma, paginados. A versão publicada não se edita: "Publicar nova
// versão" grava a nova (com motivo; operação crítica, a senha num diálogo, na hora e nunca guardada), a anterior sai de
// vigência com os aceites intactos e todos aceitam a nova no próximo acesso. O aceite em si é o diálogo depois do login.
import { tipoDoProblema } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { buscarVersaoTermo, buscarVersoesTermo, publicarTermo } from '../api.js';
import SenhaConfirmacao from '../componentes/SenhaConfirmacao.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const versoes = useQuery({ queryKey: ['adm', 'termo', 'versoes'], queryFn: () => buscarVersoesTermo() });
const vigente = computed(() => versoes.data.value?.versoes.find((v) => v.vigente) ?? null);

const escolhida = ref<number | null>(null);
const pagina = ref(1);
watch(
  vigente,
  (v) => {
    if (escolhida.value === null && v) escolhida.value = v.id;
  },
  { immediate: true },
);
const detalhe = useQuery({
  queryKey: computed(() => ['adm', 'termo', 'versao', escolhida.value, pagina.value]),
  queryFn: () => buscarVersaoTermo(escolhida.value ?? 0, pagina.value),
  enabled: computed(() => escolhida.value !== null),
});
const paginas = computed(() => Math.max(1, Math.ceil((detalhe.data.value?.aceites ?? 0) / 50)));

function ver(id: number): void {
  escolhida.value = id;
  pagina.value = 1;
}

const aviso = ref('');
const recusa = ref('');
const dialogo = ref(false);
const texto = ref('');
const motivo = ref('');
const senha = ref('');
const erroSenha = ref('');
const ocupado = ref(false);
const formulario = ref<HTMLFormElement | null>(null);

watch(dialogo, (aberto) => {
  if (!aberto) {
    senha.value = '';
    erroSenha.value = '';
  }
});

async function abrirPublicar(): Promise<void> {
  aviso.value = '';
  recusa.value = '';
  motivo.value = '';
  texto.value = '';
  const v = vigente.value;
  if (v) {
    // O texto da vigente é o ponto de partida da nova versão (a vigente em si não muda).
    const d = await cliente
      .fetchQuery({
        queryKey: ['adm', 'termo', 'versao', v.id, 1],
        queryFn: () => buscarVersaoTermo(v.id, 1),
      })
      .catch(() => null);
    texto.value = d?.texto ?? '';
  }
  dialogo.value = true;
}

const pronto = computed(
  () =>
    !ocupado.value &&
    senha.value.length > 0 &&
    texto.value.trim().length >= 20 &&
    motivo.value.trim().length >= 10,
);

function senhaRecusada(e: unknown): string | null {
  if (!(e instanceof ErroApi)) return null;
  const tipo = e.problema ? tipoDoProblema(e.problema) : null;
  if (tipo === 'reautenticacao-necessaria' || e.status === 401) return t('adm.termo.senhaErrada');
  if (tipo === 'muitas-tentativas') return e.problema?.detail || t('adm.termo.senhaErrada');
  return null;
}

async function confirmar(): Promise<void> {
  if (!pronto.value) return;
  ocupado.value = true;
  erroSenha.value = '';
  try {
    const r = await publicarTermo({
      termoAnterior: vigente.value?.id ?? null,
      texto: texto.value.trim(),
      motivo: motivo.value.trim(),
      senha: senha.value,
    });
    dialogo.value = false;
    aviso.value = t('adm.termo.publicado', { id: r.id });
    escolhida.value = r.id;
    pagina.value = 1;
    await cliente.invalidateQueries({ queryKey: ['adm', 'termo'] });
  } catch (e) {
    const msg = senhaRecusada(e);
    if (msg) {
      erroSenha.value = msg;
      senha.value = '';
      void nextTick(() =>
        formulario.value?.querySelector<HTMLInputElement>('[data-testid="termo-senha"]')?.focus(),
      );
      return;
    }
    dialogo.value = false;
    const p = e instanceof ErroApi ? e.problema : null;
    recusa.value = p?.detail || p?.title || t('adm.termo.falha');
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="termo-titulo">
    <h1 id="termo-titulo">{{ t('adm.termo.titulo') }}</h1>
    <p>{{ t('adm.termo.texto') }}</p>
    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="termo-aviso" />
    <SanteAlerta v-if="recusa" :texto="recusa" variante="aviso" anunciar data-testid="termo-recusa" />
    <MensagemErro v-if="versoes.isError.value" :erro="versoes.error.value" />
    <p v-else-if="versoes.isPending.value">{{ t('adm.comum.carregando') }}</p>
    <template v-else-if="versoes.data.value">
      <div class="termo__acoes">
        <SanteBotao
          :rotulo="t('adm.termo.publicar')"
          :desabilitado="!versoes.data.value.publicarPossivel"
          data-testid="termo-publicar"
          @acionar="abrirPublicar"
        />
      </div>
      <SanteAlerta
        v-if="!versoes.data.value.publicarPossivel && versoes.data.value.motivo"
        :texto="versoes.data.value.motivo"
        variante="aviso"
        data-testid="termo-publicar-motivo"
      />
      <p v-if="!vigente" data-testid="termo-nenhum">{{ t('adm.termo.nenhum') }}</p>

      <h2>{{ t('adm.termo.versoes') }}</h2>
      <div class="termo__rolagem">
        <table data-testid="termo-versoes">
          <thead>
            <tr>
              <th scope="col">{{ t('adm.termo.colVersao') }}</th>
              <th scope="col">{{ t('adm.termo.colDesde') }}</th>
              <th scope="col">{{ t('adm.termo.colPor') }}</th>
              <th scope="col">{{ t('adm.termo.colSituacao') }}</th>
              <th scope="col">{{ t('adm.termo.colAceites') }}</th>
              <th scope="col">
                <span class="sr-only">{{ t('adm.termo.ver') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in versoes.data.value.versoes" :key="v.id" :data-testid="`termo-versao-${v.id}`">
              <td>{{ v.id }}</td>
              <td>{{ v.desde }}</td>
              <td>{{ v.publicadoPor }}</td>
              <td>{{ v.vigente ? t('adm.termo.vigente') : t('adm.termo.anterior') }}</td>
              <td>{{ v.aceites }}</td>
              <td>
                <SanteBotao
                  :rotulo="t('adm.termo.ver')"
                  variante="texto"
                  :data-testid="`termo-ver-${v.id}`"
                  @acionar="ver(v.id)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <MensagemErro v-if="detalhe.isError.value" :erro="detalhe.error.value" />
      <template v-else-if="detalhe.data.value">
        <h2 data-testid="termo-detalhe-titulo">
          {{
            detalhe.data.value.vigente
              ? t('adm.termo.textoVigente')
              : t('adm.termo.textoAnterior', { id: detalhe.data.value.id })
          }}
        </h2>
        <p>
          {{ t('adm.termo.desde', { desde: detalhe.data.value.desde }) }} ·
          <span data-testid="termo-aceites">{{
            t('adm.termo.aceites', { n: detalhe.data.value.aceites })
          }}</span>
        </p>
        <blockquote class="texto" data-testid="termo-texto">{{ detalhe.data.value.texto }}</blockquote>
        <h3>{{ t('adm.termo.ultimos') }}</h3>
        <ul data-testid="termo-aceites-lista">
          <li v-for="(a, i) in detalhe.data.value.itens" :key="i">{{ a.login }} — {{ a.em }}</li>
        </ul>
        <div v-if="paginas > 1" class="termo__acoes">
          <SanteBotao
            :rotulo="t('adm.termo.paginaAnterior')"
            variante="texto"
            :desabilitado="pagina <= 1"
            @acionar="pagina = pagina - 1"
          />
          <span>{{ t('adm.termo.pagina', { pagina, total: paginas }) }}</span>
          <SanteBotao
            :rotulo="t('adm.termo.paginaSeguinte')"
            variante="texto"
            :desabilitado="pagina >= paginas"
            data-testid="termo-pagina-seguinte"
            @acionar="pagina = pagina + 1"
          />
        </div>
      </template>
    </template>

    <!-- Reautenticação: a senha de novo na hora da gravação (nunca guardada). -->
    <SanteDialogo v-model:visivel="dialogo" :titulo="t('adm.termo.dialogoPublicar')">
      <form
        ref="formulario"
        class="termo__form"
        data-testid="termo-form"
        :aria-busy="ocupado ? 'true' : undefined"
        @submit.prevent="confirmar"
      >
        <p>{{ t('adm.termo.explicaPublicar') }}</p>
        <div class="campo">
          <label for="termo-novo-texto">{{ t('adm.termo.campoTexto') }}</label>
          <textarea id="termo-novo-texto" v-model="texto" rows="12" required data-testid="termo-novo-texto" />
        </div>
        <SanteCampoTexto
          v-model="motivo"
          :rotulo="t('adm.termo.campoMotivo')"
          :max-bytes="255"
          data-testid="termo-motivo"
        />
        <SanteAlerta
          v-if="erroSenha"
          :texto="erroSenha"
          variante="aviso"
          anunciar
          data-testid="termo-senha-erro"
        />
        <SenhaConfirmacao v-model="senha" testid="termo-senha" />
        <div class="termo__botoes">
          <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
          <SanteBotao
            :rotulo="ocupado ? t('adm.termo.gravando') : t('adm.termo.confirmarPublicar')"
            tipo="submit"
            :desabilitado="!pronto"
            data-testid="termo-confirmar"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
.texto {
  white-space: pre-wrap;
  border-left: 4px solid var(--sgh-borda-forte);
  padding: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
  max-height: 24rem;
  overflow: auto;
}
.termo__acoes,
.termo__botoes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sgh-espaco-2);
  margin: var(--sgh-espaco-2) 0;
}
.termo__botoes {
  justify-content: flex-end;
}
.termo__rolagem {
  overflow-x: auto;
}
.termo__form {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
  vertical-align: top;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
