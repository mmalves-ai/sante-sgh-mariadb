<script setup lang="ts">
// Logotipos do estabelecimento (F3.1, 02-CAD linha 26). O painel mostra, por finalidade de uso, o logotipo ativo; um
// envio serve a várias finalidades de uma vez, e a tela avisa na hora quais logotipos ativos ele substitui (o
// anterior fica no histórico). A imagem é conferida antes do envio (PNG ou JPEG, até 512 KB). Alterar e excluir ficam
// na lista; excluir pede motivo e nunca apaga o registro.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  alterarLogotipo,
  CHAVE_IDENTIDADE,
  type Corpo,
  enviarLogotipo,
  excluirLogotipo,
  imagemLogotipo,
  lerIdentidade,
  type Logotipo,
} from '../api-identidade.js';

const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`identidadeEstabelecimento.${k}`, p ?? {});
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: CHAVE_IDENTIDADE, queryFn: lerIdentidade });
const dados = computed(() => consulta.data.value);
const erro = ref<unknown>(null);
const ok = ref(false);

async function fazer(fn: () => Promise<unknown>, depois?: () => void): Promise<void> {
  erro.value = null;
  ok.value = false;
  try {
    await fn();
    ok.value = true;
    depois?.();
    await cliente.invalidateQueries({ queryKey: CHAVE_IDENTIDADE });
  } catch (e) {
    erro.value = e;
  }
}

const nomeFinalidade = (f: string) => T(`logotipo.finalidadesNomes.${f}`);
const ativoDe = (f: string): Logotipo | null =>
  dados.value?.logotipos.find((l) => l.ativo && l.finalidade === f) ?? null;

// Miniaturas dos logotipos ativos (a imagem vem da porta de arquivos, pela API).
const miniaturas = ref<Record<number, string>>({});
watch(
  dados,
  (d) => {
    for (const l of d?.logotipos ?? [])
      if (l.ativo && !miniaturas.value[l.id])
        void imagemLogotipo(l.id)
          .then((i) => {
            miniaturas.value = { ...miniaturas.value, [l.id]: `data:${i.tipo};base64,${i.conteudo}` };
          })
          .catch(() => undefined);
  },
  { immediate: true },
);

// ── Envio ──
const novo = () => ({
  conteudo: '',
  nomeOriginal: '',
  finalidades: [] as string[],
  cabecalhoRelatorio: '',
  rodapeRelatorio: '',
  imprimeEmRelatorio: true,
});
const envio = ref(novo());
const arquivoErro = ref(false);
const campoArquivo = ref<HTMLInputElement | null>(null);
function escolherImagem(ev: Event): void {
  const arq = (ev.target as HTMLInputElement).files?.[0];
  envio.value.conteudo = '';
  arquivoErro.value = false;
  if (!arq) return;
  if (!/^image\/(png|jpeg)$/.test(arq.type) || arq.size > 512 * 1024) {
    arquivoErro.value = true;
    return;
  }
  const leitor = new FileReader();
  leitor.onload = () => {
    envio.value.conteudo = String(leitor.result);
    envio.value.nomeOriginal = arq.name;
  };
  leitor.readAsDataURL(arq);
}
const substituidos = computed(() =>
  envio.value.finalidades.filter((f) => ativoDe(f) !== null).map(nomeFinalidade),
);
const podeEnviar = computed(() => envio.value.conteudo !== '' && envio.value.finalidades.length > 0);
function limparEnvio(): void {
  envio.value = novo();
  if (campoArquivo.value) campoArquivo.value.value = '';
}

// ── Alteração e exclusão ──
const edicao = ref<Corpo | null>(null);
const exclusao = ref<Logotipo | null>(null);
const motivo = ref('');
const doisAtivos = computed(() => {
  const e = edicao.value;
  if (!e || !e['ativo']) return false;
  return (dados.value?.logotipos ?? []).some(
    (l) => l.id !== e['id'] && l.ativo && l.finalidade === e['finalidade'],
  );
});
const dimensoes = (l: Logotipo) => `${l.largura ?? '?'} × ${l.altura ?? '?'}`;
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;
</script>

<template>
  <section aria-labelledby="logotipos-titulo">
    <h2 id="logotipos-titulo">{{ T('logotipo.titulo') }}</h2>
    <p>{{ T('logotipo.ajuda') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="ok" role="status" data-testid="logotipo-gravado">{{ T('comum.gravado') }}</p>
    <p v-if="consulta.isPending.value">{{ T('comum.carregando') }}</p>

    <template v-else-if="dados">
      <!-- Painel: o logotipo ativo de cada finalidade -->
      <ul class="painel" data-testid="painel-logotipos">
        <li v-for="f in dados.opcoes.finalidades" :key="f" :data-testid="`finalidade-${f}`">
          <strong>{{ nomeFinalidade(f) }}</strong>
          <template v-if="ativoDe(f)">
            <img
              v-if="miniaturas[ativoDe(f)!.id]"
              :src="miniaturas[ativoDe(f)!.id]"
              :alt="`${T('logotipo.imagem')}: ${nomeFinalidade(f)}`"
            />
            <small>{{ dimensoes(ativoDe(f)!) }}</small>
          </template>
          <small v-else class="aviso">{{ T('logotipo.semLogotipo') }}</small>
        </li>
      </ul>

      <!-- Envio: uma imagem para uma ou mais finalidades -->
      <form class="grade" @submit.prevent="fazer(() => enviarLogotipo(envio), limparEnvio)">
        <label
          >{{ T('logotipo.arquivo') }}
          <input
            ref="campoArquivo"
            type="file"
            accept="image/png,image/jpeg"
            data-testid="arquivo-logotipo"
            :aria-invalid="arquivoErro"
            @change="escolherImagem"
        /></label>
        <small v-if="arquivoErro" class="aviso" data-testid="arquivo-logotipo-erro">{{
          T('logotipo.arquivoInvalido')
        }}</small>
        <fieldset class="marcas">
          <legend>{{ T('logotipo.finalidades') }}</legend>
          <label v-for="f in dados.opcoes.finalidades" :key="f" class="marca"
            ><input v-model="envio.finalidades" type="checkbox" :value="f" :name="`usar-${f}`" />
            {{ nomeFinalidade(f) }}</label
          >
        </fieldset>
        <small v-if="substituidos.length" class="aviso" data-testid="logotipo-substitui">{{
          T('logotipo.substitui', { lista: substituidos.join(', ') })
        }}</small>
        <label
          >{{ T('logotipo.cabecalhoRelatorio') }}
          <input v-model="envio.cabecalhoRelatorio" name="cabecalhoRelatorio" maxlength="150"
        /></label>
        <label
          >{{ T('logotipo.rodapeRelatorio') }}
          <input v-model="envio.rodapeRelatorio" name="rodapeRelatorio" maxlength="150"
        /></label>
        <label class="marca"
          ><input v-model="envio.imprimeEmRelatorio" type="checkbox" name="imprimeEmRelatorio" />
          {{ T('logotipo.imprimeEmRelatorio') }}</label
        >
        <SanteBotao
          tipo="submit"
          :rotulo="T('logotipo.enviar')"
          :desabilitado="!podeEnviar"
          data-testid="enviar-logotipo"
        />
      </form>

      <!-- Lista: ativos e histórico -->
      <h3>{{ T('logotipo.lista') }}</h3>
      <p v-if="!dados.logotipos.length">{{ T('logotipo.nenhum') }}</p>
      <table v-else data-testid="lista-logotipos">
        <thead>
          <tr>
            <th scope="col">{{ T('logotipo.numero') }}</th>
            <th scope="col">{{ T('logotipo.finalidade') }}</th>
            <th scope="col">{{ T('logotipo.imagem') }}</th>
            <th scope="col">{{ T('logotipo.dimensoes') }}</th>
            <th scope="col">{{ T('logotipo.enviadoEm') }}</th>
            <th scope="col">{{ T('logotipo.situacao') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in dados.logotipos" :key="l.id" :data-testid="`logotipo-${l.sequencia}`">
            <td>{{ l.sequencia }}</td>
            <td>{{ nomeFinalidade(l.finalidade) }}</td>
            <td>{{ l.nomeOriginal }} ({{ kb(l.tamanho) }})</td>
            <td>{{ dimensoes(l) }}</td>
            <td>{{ l.enviadoEm }}</td>
            <td>{{ l.ativo ? T('comum.ativo') : T('comum.inativo') }}</td>
            <td>
              <button
                type="button"
                :data-testid="`editar-logotipo-${l.sequencia}`"
                @click="((edicao = { ...l }), (exclusao = null))"
              >
                {{ T('comum.editar') }}
              </button>
              <button
                type="button"
                :data-testid="`excluir-logotipo-${l.sequencia}`"
                @click="((exclusao = l), (edicao = null), (motivo = ''))"
              >
                {{ T('logotipo.excluir') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <form
        v-if="edicao"
        class="grade"
        @submit.prevent="
          fazer(
            () => alterarLogotipo(Number(edicao!['id']), edicao!),
            () => (edicao = null),
          )
        "
      >
        <SanteSelecao
          v-model="edicao['finalidade'] as string"
          :rotulo="T('logotipo.finalidade')"
          :opcoes="dados.opcoes.finalidades.map((f) => ({ valor: f, rotulo: nomeFinalidade(f) }))"
          data-testid="logotipo-finalidade"
        />
        <label
          >{{ T('logotipo.cabecalhoRelatorio') }}
          <input v-model="edicao['cabecalhoRelatorio'] as string" name="edicao-cabecalho" maxlength="150"
        /></label>
        <label
          >{{ T('logotipo.rodapeRelatorio') }}
          <input v-model="edicao['rodapeRelatorio'] as string" name="edicao-rodape" maxlength="150"
        /></label>
        <label class="marca"
          ><input v-model="edicao['imprimeEmRelatorio']" type="checkbox" name="edicao-imprime" />
          {{ T('logotipo.imprimeEmRelatorio') }}</label
        >
        <label class="marca"
          ><input v-model="edicao['ativo']" type="checkbox" name="edicao-ativo" />
          {{ T('comum.ativo') }}</label
        >
        <small v-if="doisAtivos" class="aviso" data-testid="logotipo-dois-ativos">{{
          T('logotipo.doisAtivos')
        }}</small>
        <SanteBotao
          tipo="submit"
          :rotulo="T('comum.gravar')"
          :desabilitado="doisAtivos"
          data-testid="gravar-logotipo"
        />
        <SanteBotao variante="secundario" :rotulo="T('comum.cancelar')" @acionar="edicao = null" />
      </form>

      <form
        v-if="exclusao"
        class="grade"
        @submit.prevent="
          fazer(
            () => excluirLogotipo(exclusao!.id, { versao: exclusao!.versao, motivo }),
            () => (exclusao = null),
          )
        "
      >
        <label
          >{{ T('comum.motivo') }} <input v-model="motivo" name="motivo-exclusao" maxlength="200"
        /></label>
        <SanteBotao
          tipo="submit"
          :rotulo="`${T('logotipo.confirmarExclusao')} ${exclusao.sequencia}`"
          :desabilitado="motivo.trim().length < 10"
          data-testid="confirmar-exclusao-logotipo"
        />
        <SanteBotao variante="secundario" :rotulo="T('comum.cancelar')" @acionar="exclusao = null" />
      </form>
    </template>
  </section>
</template>

<style scoped>
.painel {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  gap: var(--sgh-espaco-2);
  list-style: none;
  padding: 0;
}
.painel li {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.painel img {
  max-width: 100%;
  max-height: 4rem;
  object-fit: contain;
  align-self: flex-start;
}
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-2) var(--sgh-espaco-3);
  margin-top: var(--sgh-espaco-3);
}
.grade label {
  display: flex;
  flex-direction: column;
}
.grade label.marca,
.marcas label.marca {
  flex-direction: row;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.marcas {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.aviso {
  color: var(--sgh-alerta);
}
</style>
